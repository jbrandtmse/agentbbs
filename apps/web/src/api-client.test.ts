// Unit tests for the apps/web JSON-API + SSE client helpers (Story 9.3, Task 4).
//
// Pure logic — node env. `fetchDirectory` is exercised with an injected fetch (no real
// server; the AC3 integration test proves the real wiring). `foldDelta` is the SSE-delta
// reducer the shell applies; it must advance the high-water-mark monotonically, count
// deltas, and record the latest event.

import { describe, expect, it } from 'vitest';

import {
  announceProject,
  ApiError,
  appendPendingPost,
  buildRoomViewModel,
  deriveAgreedSeq,
  fetchDirectory,
  fetchRoom,
  foldDelta,
  foldRoomDelta,
  foldTreeDelta,
  INITIAL_LIVE_STATE,
  loadTreeModel,
  makePendingPost,
  markPendingPostFailed,
  postAddParticipant,
  postAnnouncement,
  postJoin,
  postReply,
  removePendingPost,
  selectRoom,
} from './api-client.js';

import type {
  ContractResponse,
  EventWire,
  RoomResponse,
} from './api-client.js';
import type { NavTreeModel, RoomViewModel } from '@agentbbs/ui-shared';

describe('fetchDirectory', () => {
  it('returns the parsed { projects } envelope on 200', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ projects: [{ project_id: 'p' }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const res = await fetchDirectory('', fakeFetch);
    expect(res.projects).toHaveLength(1);
    expect(res.projects[0].project_id).toBe('p');
  });

  it('throws on a non-2xx response', async () => {
    const fakeFetch = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchDirectory('', fakeFetch)).rejects.toThrow(/HTTP 500/);
  });
});

describe('foldDelta', () => {
  const event = (seq: number): EventWire => ({
    seq,
    type: 'announcement.posted',
    actor: 'alice',
    created_at: '2026-06-01T00:00:00.000Z',
    payload: {},
  });

  it('advances lastSeq, counts deltas, records the latest', () => {
    let state = INITIAL_LIVE_STATE;
    state = foldDelta(state, event(5));
    expect(state).toMatchObject({ lastSeq: 5, deltaCount: 1 });
    expect(state.latest?.seq).toBe(5);
    state = foldDelta(state, event(8));
    expect(state).toMatchObject({ lastSeq: 8, deltaCount: 2 });
  });

  it('does not regress lastSeq on an out-of-order/older delta', () => {
    let state = foldDelta(INITIAL_LIVE_STATE, event(10));
    state = foldDelta(state, event(3));
    expect(state.lastSeq).toBe(10);
    expect(state.deltaCount).toBe(2);
  });
});

// --- Story 9.4: tree-model builder + immutable SSE tree fold ---

/** A minimal tree model fixture for the fold tests. */
function makeModel(): NavTreeModel {
  return {
    operatorHandle: 'ops',
    activeRoomId: null,
    needsYou: [],
    projects: [
      {
        projectId: 'calling-interface',
        title: 'Calling Interface',
        announcementCount: 1,
        rooms: [
          {
            roomId: 'design-sync',
            subject: 'Design sync',
            unread: false,
            activityCount: 0,
            needsYou: false,
          },
          {
            roomId: 'ledger',
            subject: 'Ledger',
            unread: false,
            activityCount: 0,
            needsYou: false,
          },
        ],
      },
    ],
  };
}

const treeEvent = (
  type: string,
  payload: Record<string, unknown>,
  seq = 1,
): EventWire => ({
  seq,
  type,
  actor: 'alice',
  created_at: '2026-06-01T00:00:00.000Z',
  payload,
});

describe('foldTreeDelta — live decorations (AC2), immutable', () => {
  it('bumps unread + activity count on a room.replied, returning a NEW model', () => {
    const model = makeModel();
    const next = foldTreeDelta(
      model,
      treeEvent('room.replied', { room_id: 'design-sync', body: 'hi' }),
    );
    expect(next).not.toBe(model); // new object (immutable)
    expect(model.projects[0].rooms[0].unread).toBe(false); // original untouched
    const room = next.projects[0].rooms[0];
    expect(room.unread).toBe(true);
    expect(room.activityCount).toBe(1);
    // A second delta increments again.
    const after = foldTreeDelta(
      next,
      treeEvent('room.replied', { room_id: 'design-sync', body: 'more' }, 2),
    );
    expect(after.projects[0].rooms[0].activityCount).toBe(2);
  });

  it('does NOT bump unread for the active (currently-selected) room', () => {
    const model = { ...makeModel(), activeRoomId: 'design-sync' };
    const next = foldTreeDelta(
      model,
      treeEvent('room.replied', { room_id: 'design-sync', body: 'hi' }),
    );
    expect(next).toBe(model); // no-op → same reference
  });

  it('ignores an event for a room not in the model (no throw, same model)', () => {
    const model = makeModel();
    const next = foldTreeDelta(
      model,
      treeEvent('room.replied', { room_id: 'unknown-room', body: 'x' }),
    );
    expect(next).toBe(model);
  });

  it('adds a room to NEEDS YOU + flags its row on a participant_added naming the operator', () => {
    const model = makeModel();
    const next = foldTreeDelta(
      model,
      treeEvent('room.participant_added', {
        room_id: 'ledger',
        handle: 'ops',
      }),
    );
    expect(next.needsYou.map((r) => r.roomId)).toEqual(['ledger']);
    expect(next.projects[0].rooms[1].needsYou).toBe(true);
    // Original model untouched (immutability).
    expect(model.needsYou).toEqual([]);
  });

  it('a DUPLICATE participant_added for the operator does NOT double-add to NEEDS YOU (idempotent)', () => {
    // The host derivation dedups idempotent adds (a Set); the live fold must too — a second
    // room.participant_added for the SAME room+operator (e.g. an idempotent re-add, or the
    // host replaying) must leave NEEDS YOU at one entry. Pins the `already` guard in
    // applyEscalation — dropping it would push a second {roomId} and double-list the room.
    const model = makeModel();
    const escalation = treeEvent('room.participant_added', {
      room_id: 'ledger',
      handle: 'ops',
    });
    const once = foldTreeDelta(model, escalation);
    expect(once.needsYou.map((r) => r.roomId)).toEqual(['ledger']);
    const twice = foldTreeDelta(once, { ...escalation, seq: 2 });
    expect(twice.needsYou.map((r) => r.roomId)).toEqual(['ledger']); // still ONE entry
    // The already-escalated prior model is not mutated by the second fold.
    expect(once.needsYou).toHaveLength(1);
  });

  it('does NOT escalate when the participant_added names a DIFFERENT handle', () => {
    const model = makeModel();
    const next = foldTreeDelta(
      model,
      treeEvent('room.participant_added', {
        room_id: 'ledger',
        handle: 'someone-else',
      }),
    );
    expect(next.needsYou).toEqual([]);
  });
});

describe('selectRoom — basic clear-on-select (AC2), immutable', () => {
  it('sets the active room and clears its unread + count', () => {
    let model = makeModel();
    model = foldTreeDelta(
      model,
      treeEvent('room.replied', { room_id: 'design-sync', body: 'hi' }),
    );
    expect(model.projects[0].rooms[0].unread).toBe(true);
    const selected = selectRoom(model, 'design-sync');
    expect(selected).not.toBe(model);
    expect(selected.activeRoomId).toBe('design-sync');
    expect(selected.projects[0].rooms[0].unread).toBe(false);
    expect(selected.projects[0].rooms[0].activityCount).toBe(0);
  });
});

describe('loadTreeModel — builds the model from the JSON API (global read FR28)', () => {
  it('assembles operator, NEEDS YOU, and EVERY project/room from the API', async () => {
    const responses: Record<string, unknown> = {
      '/api/me': { handle: 'ops' },
      '/api/needs-you': {
        rooms: [
          {
            room_id: 'need-ops',
            project_id: 'p1',
            subject: 'Need ops',
            body: '',
            posted_by: 'alice',
            seq: 5,
            active: true,
          },
        ],
      },
      '/api/directory': {
        projects: [
          {
            project_id: 'p1',
            title: 'Project One',
            description: '',
            announcer: 'alice',
            members: ['alice'],
          },
          {
            project_id: 'p2',
            title: 'Project Two',
            description: '',
            announcer: 'bob',
            members: ['bob'],
          },
        ],
      },
      '/api/projects/p1/rooms': {
        rooms: [
          {
            room_id: 'need-ops',
            project_id: 'p1',
            subject: 'Need ops',
            body: '',
            posted_by: 'alice',
            seq: 5,
            active: true,
          },
        ],
      },
      '/api/projects/p1/announcements': { announcements: [] },
      '/api/projects/p2/rooms': { rooms: [] },
      '/api/projects/p2/announcements': {
        announcements: [
          {
            room_id: 'proto',
            project_id: 'p2',
            subject: 'Proto',
            body: '',
            posted_by: 'bob',
            seq: 9,
            active: false,
          },
        ],
      },
    };
    const fakeFetch = (async (url: string) => {
      const path = url.replace('', '');
      const body = responses[path];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const model = await loadTreeModel('', fakeFetch);
    expect(model.operatorHandle).toBe('ops');
    // Global read: BOTH projects present regardless of membership.
    expect(model.projects.map((p) => p.projectId)).toEqual(['p1', 'p2']);
    expect(model.projects[1].announcementCount).toBe(1);
    // The NEEDS YOU room is flagged on its row.
    const needOps = model.projects[0].rooms.find(
      (r) => r.roomId === 'need-ops',
    );
    expect(needOps?.needsYou).toBe(true);
    expect(model.needsYou.map((r) => r.roomId)).toEqual(['need-ops']);
  });

  // --- Story 9.14 (AC1) — loadTreeModel builds each project's rooms from BOTH the active rooms
  // AND the proto-rooms (announcements, `active:false`), so an announced-but-unanswered room is a
  // navigable PENDING row. Deduped by roomId (defensive); the announcements (N) bucket count is
  // unchanged. ---
  it('builds proto-rooms as PENDING rows (active rooms first, then pending), deduped by roomId, bucket count unchanged', async () => {
    const responses: Record<string, unknown> = {
      '/api/me': { handle: 'ops' },
      '/api/needs-you': { rooms: [] },
      '/api/directory': {
        projects: [
          {
            project_id: 'p1',
            title: 'Project One',
            description: '',
            announcer: 'alice',
            members: ['alice'],
          },
        ],
      },
      '/api/projects/p1/rooms': {
        rooms: [
          {
            room_id: 'active-room',
            project_id: 'p1',
            subject: 'Active',
            body: '',
            posted_by: 'alice',
            seq: 5,
            active: true,
          },
        ],
      },
      // Two announcements: one is a genuine proto-room; the other is `active-room` again (a
      // defensive dedupe target — an active room must NOT also appear as a stale proto-row).
      '/api/projects/p1/announcements': {
        announcements: [
          {
            room_id: 'proto-room',
            project_id: 'p1',
            subject: 'Proto',
            body: 'unanswered',
            posted_by: 'bob',
            seq: 9,
            active: false,
          },
          {
            room_id: 'active-room',
            project_id: 'p1',
            subject: 'Active (stale proto echo)',
            body: '',
            posted_by: 'alice',
            seq: 5,
            active: false,
          },
        ],
      },
    };
    const fakeFetch = (async (url: string) => {
      const body = responses[url];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const model = await loadTreeModel('', fakeFetch);
    const p1 = model.projects[0];
    // Active room first, then the pending proto-room — `active-room` appears ONCE (deduped).
    expect(p1.rooms.map((r) => r.roomId)).toEqual([
      'active-room',
      'proto-room',
    ]);
    const active = p1.rooms.find((r) => r.roomId === 'active-room');
    const proto = p1.rooms.find((r) => r.roomId === 'proto-room');
    expect(active?.pending).toBe(false);
    expect(proto?.pending).toBe(true);
    // The announcements bucket count still reflects ALL announcements (2), unchanged by the rows.
    expect(p1.announcementCount).toBe(2);
  });
});

// --- Story 9.5: room fetch + the RoomViewModel builder (operator posture + seq order) ---

/** A room envelope fixture (the `/api/rooms/:id` shape). */
function roomResponse(): RoomResponse {
  return {
    room: {
      room_id: 'need-a-reviewer',
      project_id: 'calling-interface',
      subject: 'Need a reviewer',
      body: 'seed',
      posted_by: 'alice',
      seq: 5,
      active: true,
      activated_by: 'bob',
      activated_at_seq: 6,
    },
    messages: [
      {
        seq: 5,
        actor: 'alice',
        body: 'seed',
        kind: 'announcement',
        reactions: [],
        created_at: '2026-06-01T09:00:00.000Z',
      },
      {
        seq: 6,
        actor: 'bob',
        body: 'first',
        kind: 'reply',
        reactions: [],
        created_at: '2026-06-01T09:01:00.000Z',
      },
    ],
    participants: ['alice', 'bob'],
  };
}

describe('fetchRoom', () => {
  it('returns the parsed { room, messages, participants } envelope on 200', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify(roomResponse()), {
        status: 200,
      })) as unknown as typeof fetch;
    const res = await fetchRoom('need-a-reviewer', '', fakeFetch);
    expect(res.room.room_id).toBe('need-a-reviewer');
    expect(res.messages).toHaveLength(2);
    expect(res.participants).toEqual(['alice', 'bob']);
    expect(res.messages[0].created_at).toBe('2026-06-01T09:00:00.000Z');
  });

  it('throws on a non-2xx response', async () => {
    const fakeFetch = (async () =>
      new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchRoom('x', '', fakeFetch)).rejects.toThrow(/HTTP 404/);
  });
});

describe('buildRoomViewModel — maps the envelope + computes the operator posture (AC2)', () => {
  it('maps room metadata, participants, and the display created_at onto each post', () => {
    const model = buildRoomViewModel(roomResponse(), 'ops');
    expect(model.roomId).toBe('need-a-reviewer');
    expect(model.projectId).toBe('calling-interface');
    expect(model.participants).toEqual(['alice', 'bob']);
    expect(model.messages.map((m) => m.seq)).toEqual([5, 6]);
    // The host-layer created_at is carried onto the post's display createdAt.
    expect(model.messages[0].createdAt).toBe('2026-06-01T09:00:00.000Z');
    expect(model.messages[0].kind).toBe('announcement');
  });

  it('posture is `watching` when the operator is NOT a participant', () => {
    const model = buildRoomViewModel(roomResponse(), 'ops');
    expect(model.operatorPosture).toEqual({ kind: 'watching' });
  });

  it('posture is `peer` when the operator IS a participant', () => {
    const model = buildRoomViewModel(roomResponse(), 'bob');
    expect(model.operatorPosture).toEqual({ kind: 'peer', handle: 'bob' });
  });

  it('posture is `watching` for a null operator (watching-only), even if a same-named handle exists', () => {
    const model = buildRoomViewModel(roomResponse(), null);
    expect(model.operatorPosture).toEqual({ kind: 'watching' });
  });

  it('posture is `peer` for a PULLED-IN operator who never posted a message (derives from participants, not authorship)', () => {
    // The operator was added to the room (so is in `participants`) but authored no message.
    // Posture must be `peer` — the AC2 derivation is the participant list, NOT message
    // authorship. Mirrors the host test's pulled-in-non-replying peer.
    const envelope = roomResponse();
    envelope.participants = ['alice', 'bob', 'ops'];
    const model = buildRoomViewModel(envelope, 'ops');
    expect(model.operatorPosture).toEqual({ kind: 'peer', handle: 'ops' });
    // And `ops` authored none of the rendered posts.
    expect(model.messages.some((m) => m.actor === 'ops')).toBe(false);
  });
});

// --- Story 9.6 AC2 — the UI HONORS the FR21 computed-agreed semantic. buildRoomViewModel sets
// `agreedSeq` to the room CONTRACT's seq (the highest-`seq` live-👍'd message, supplied by
// /api/rooms/:id/contract), NEVER a stored flag. The mark MOVES when the contract moves and
// DISAPPEARS (agreedSeq=null) when the contract is null. operatorHandle flows through so each
// post can compute its operator-👍'd state. (The core selection itself is mutation-tested in
// Story 5.3; the host MOVES/REVERTS/DISAPPEARS in json-api.test.ts; here we pin the UI mapping.)
//
// MUTATION-TEST TARGET (Rule 7): the `agreedSeq` derivation in buildRoomViewModel
// (`contract.contract.seq`). Pinning it to a WRONG rule — e.g. the LOWEST-seq message, or the
// MOST-reactors message, or a hard `null` — turns the "honors the contract seq" assertions RED.
// (Verified manually during dev: see the story Dev Agent Record.) ---
describe('buildRoomViewModel — computed agreed-mark seq (Story 9.6 AC2, FR21)', () => {
  /** A contract envelope naming `seq` as the converged message (the rest of the wire is filler). */
  function contractAt(seq: number | null): ContractResponse {
    return {
      room_id: 'need-a-reviewer',
      contract:
        seq === null
          ? null
          : {
              seq,
              actor: 'bob',
              body: 'agreed text',
              kind: 'reply',
              reactions: ['bob'],
              created_at: '2026-06-01T09:01:00.000Z',
            },
    };
  }

  it('agreedSeq = the contract message seq (the highest-seq live-👍d one), NOT a stored flag', () => {
    // The room has messages 5 (announcement) and 6 (reply). The CONTRACT names seq 6.
    const model = buildRoomViewModel(roomResponse(), 'bob', contractAt(6));
    expect(model.agreedSeq).toBe(6);
  });

  it('honors a contract that names a HIGHER-seq message — NOT the lowest, NOT "most reactors"', () => {
    // Build a room whose LOWER-seq message (5) has MORE reactors than the contract message (6).
    // The UI must mark seq 6 (the contract = highest-seq live-👍d) — a "most reactors" or
    // "lowest seq" rule would mark 5 and this assertion would go RED.
    const env = roomResponse();
    env.messages[0].reactions = ['alice', 'bob', 'cleo']; // seq 5, three reactors
    env.messages[1].reactions = ['bob']; // seq 6, one reactor (the contract)
    const model = buildRoomViewModel(env, 'bob', contractAt(6));
    expect(model.agreedSeq).toBe(6);
    expect(model.agreedSeq).not.toBe(5);
  });

  it('agreedSeq is null when the contract is null (mark GONE — all live 👍s retracted)', () => {
    const model = buildRoomViewModel(roomResponse(), 'bob', contractAt(null));
    expect(model.agreedSeq).toBeNull();
  });

  it('agreedSeq defaults to null when no contract is supplied (no contract fetched yet)', () => {
    const model = buildRoomViewModel(roomResponse(), 'bob');
    expect(model.agreedSeq).toBeNull();
  });

  it('threads operatorHandle so each post can compute its own 👍 state', () => {
    const model = buildRoomViewModel(roomResponse(), 'bob', contractAt(6));
    expect(model.operatorHandle).toBe('bob');
    const nullOp = buildRoomViewModel(roomResponse(), null, contractAt(6));
    expect(nullOp.operatorHandle).toBeNull();
  });
});

// --- Story 9.7 — the join/reply/add_participant WRITE helpers. They POST to the right
// host endpoint with the right method + JSON body, parse the envelope, and propagate a
// non-2xx as a throw (the composer surfaces a calm error). A capturing fake fetch records
// the request shape so we pin the path/method/body the host expects. ---
describe('postJoin / postReply / postAddParticipant write helpers (Story 9.7)', () => {
  interface Captured {
    url: string;
    method?: string;
    headers?: HeadersInit;
    body?: string;
  }

  /** A fetch fake that records the request and returns `responseBody` at `status`. */
  function capturingFetch(
    responseBody: unknown,
    status = 200,
  ): { fetch: typeof fetch; calls: Captured[] } {
    const calls: Captured[] = [];
    const fn = (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        headers: init?.headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return new Response(JSON.stringify(responseBody), { status });
    }) as unknown as typeof fetch;
    return { fetch: fn, calls };
  }

  it('postJoin POSTs to /api/projects/:id/join (no body) and returns { project }', async () => {
    const { fetch: fake, calls } = capturingFetch({
      project: { project_id: 'calling-interface', members: ['ops'] },
    });
    const res = await postJoin('calling-interface', '', fake);
    expect(calls[0].url).toBe('/api/projects/calling-interface/join');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toBeUndefined();
    expect(res.project.project_id).toBe('calling-interface');
  });

  it('postReply POSTs to /api/rooms/:id/reply with a JSON { body } and returns { room }', async () => {
    const { fetch: fake, calls } = capturingFetch({
      room: { room_id: 'need-a-reviewer', active: true },
    });
    const res = await postReply('need-a-reviewer', 'ship it', '', fake);
    expect(calls[0].url).toBe('/api/rooms/need-a-reviewer/reply');
    expect(calls[0].method).toBe('POST');
    // The body is the JSON-serialized { body } payload.
    expect(JSON.parse(calls[0].body!)).toEqual({ body: 'ship it' });
    expect(res.room.room_id).toBe('need-a-reviewer');
  });

  it('postAddParticipant POSTs to /api/rooms/:id/participants with a JSON { handle }', async () => {
    const { fetch: fake, calls } = capturingFetch({
      room: { room_id: 'need-a-reviewer' },
      participants: ['ops', 'cleo'],
    });
    const res = await postAddParticipant('need-a-reviewer', 'cleo', '', fake);
    expect(calls[0].url).toBe('/api/rooms/need-a-reviewer/participants');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body!)).toEqual({ handle: 'cleo' });
    expect(res.participants).toContain('cleo');
  });

  it('a non-2xx (e.g. 413 BODY_TOO_LARGE) propagates as a throw the composer surfaces', async () => {
    // Story 9.11: postJsonBody now parses the host { code, message } envelope and throws an
    // ApiError carrying .code (the calm inline / handoff surfaces branch on it) with the host's
    // message as .message. The body cap surfaces as BODY_TOO_LARGE (not a bare `HTTP 413`).
    const { fetch: fake } = capturingFetch(
      { code: 'BODY_TOO_LARGE', message: 'too big' },
      413,
    );
    await expect(postReply('need-a-reviewer', 'x', '', fake)).rejects.toThrow(
      /too big/,
    );
    const again = capturingFetch(
      { code: 'BODY_TOO_LARGE', message: 'too big' },
      413,
    );
    const err = await postReply('need-a-reviewer', 'x', '', again.fetch).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('BODY_TOO_LARGE');
    expect((err as ApiError).status).toBe(413);
  });

  it('a 403 (NO_OPERATOR / NOT_A_MEMBER) on join/add_participant propagates as a throw', async () => {
    const join = capturingFetch({ code: 'NO_OPERATOR' }, 403);
    await expect(postJoin('calling-interface', '', join.fetch)).rejects.toThrow(
      /HTTP 403/,
    );
    const add = capturingFetch({ code: 'NOT_A_MEMBER' }, 403);
    await expect(
      postAddParticipant('need-a-reviewer', 'cleo', '', add.fetch),
    ).rejects.toThrow(/HTTP 403/);
  });
});

// =============================================================================
// Story 9.11 — the operator INITIATE-surface write helpers (announceProject /
// postAnnouncement) + the ApiError code-surfacing the calm inline / join-first
// handoff branches on.
// =============================================================================

describe('announceProject / postAnnouncement write helpers + ApiError code (Story 9.11)', () => {
  interface Captured {
    url: string;
    method?: string;
    body?: string;
  }

  function capturingFetch(
    responseBody: unknown,
    status = 200,
  ): { fetch: typeof fetch; calls: Captured[] } {
    const calls: Captured[] = [];
    const fn = (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return new Response(JSON.stringify(responseBody), { status });
    }) as unknown as typeof fetch;
    return { fetch: fn, calls };
  }

  it('announceProject POSTs /api/projects with { title, description } and returns { project }', async () => {
    const { fetch: fake, calls } = capturingFetch({
      project: { project_id: 'retry-budget', members: ['ops'] },
    });
    const res = await announceProject('Retry Budget', 'Who owns it.', '', fake);
    expect(calls[0].url).toBe('/api/projects');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body!)).toEqual({
      title: 'Retry Budget',
      description: 'Who owns it.',
    });
    expect(res.project.project_id).toBe('retry-budget');
  });

  it('announceProject on 409 throws an ApiError carrying .code === PROJECT_EXISTS (the calm inline surface)', async () => {
    const { fetch: fake } = capturingFetch(
      { code: 'PROJECT_EXISTS', message: 'a project with that title exists.' },
      409,
    );
    const err = await announceProject('Dup', 'x', '', fake).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('PROJECT_EXISTS');
    expect((err as ApiError).status).toBe(409);
    // .message carries the HOST's message (not a synthetic `HTTP 409`) — the calm inline text.
    expect((err as ApiError).message).toContain('exists');
  });

  it('postAnnouncement POSTs /api/projects/:id/announcements with { subject, body } and returns { room }', async () => {
    const { fetch: fake, calls } = capturingFetch({
      room: { room_id: 'need-a-decision', project_id: 'retry-budget' },
    });
    const res = await postAnnouncement(
      'retry-budget',
      'Need a decision',
      'who owns it?',
      '',
      fake,
    );
    expect(calls[0].url).toBe('/api/projects/retry-budget/announcements');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body!)).toEqual({
      subject: 'Need a decision',
      body: 'who owns it?',
    });
    expect(res.room.room_id).toBe('need-a-decision');
  });

  it('postAnnouncement on 403 NOT_A_MEMBER throws an ApiError carrying .code (the join-first handoff branch)', async () => {
    const { fetch: fake } = capturingFetch({ code: 'NOT_A_MEMBER' }, 403);
    const err = await postAnnouncement(
      'retry-budget',
      's',
      'b',
      '',
      fake,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_A_MEMBER');
    expect((err as ApiError).status).toBe(403);
  });

  it('postAnnouncement on 413 BODY_TOO_LARGE throws an ApiError carrying .code (the calm inline cap surface)', async () => {
    const { fetch: fake } = capturingFetch(
      { code: 'BODY_TOO_LARGE', message: 'that body is too large.' },
      413,
    );
    const err = await postAnnouncement(
      'retry-budget',
      's',
      'b',
      '',
      fake,
    ).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('BODY_TOO_LARGE');
  });

  it('a non-JSON error body degrades to a synthetic HTTP_<status> code (still an ApiError, never silent)', async () => {
    const fn = (async () =>
      new Response('<html>500</html>', {
        status: 500,
      })) as unknown as typeof fetch;
    const err = await announceProject('T', 'd', '', fn).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('HTTP_500');
  });
});

// =============================================================================
// Story 9.9 — the OPEN-room live SSE fold + optimistic-post helpers (pure, immutable).
// =============================================================================

/** A minimal open-room model fixture (ops is a peer; two confirmed messages, no live 👍). */
function roomModel(): RoomViewModel {
  return {
    roomId: 'ledger-rollover',
    projectId: 'payments',
    subject: 'Ledger rollover',
    participants: ['alice', 'ops'],
    messages: [
      {
        seq: 9,
        actor: 'alice',
        body: 'How do we roll the ledger?',
        kind: 'announcement',
        reactions: [],
      },
      { seq: 10, actor: 'ops', body: 'Discuss.', kind: 'reply', reactions: [] },
    ],
    operatorPosture: { kind: 'peer', handle: 'ops' },
    agreedSeq: null,
    operatorHandle: 'ops',
  };
}

const repliedDelta = (seq: number, actor: string, body: string): EventWire => ({
  seq,
  type: 'room.replied',
  actor,
  created_at: '2026-06-01T09:00:00.000Z',
  payload: { room_id: 'ledger-rollover', body },
});

const reactDelta = (
  type: 'message.reacted' | 'message.unreacted',
  actor: string,
  messageSeq: number,
): EventWire => ({
  seq: 999,
  type,
  actor,
  created_at: '2026-06-01T09:00:00.000Z',
  payload: { room_id: 'ledger-rollover', message_seq: messageSeq },
});

describe('foldRoomDelta — live SSE fold into the OPEN thread (AC1), immutable', () => {
  it('appends a room.replied for THIS room to the thread (new message at the event seq)', () => {
    const before = roomModel();
    const after = foldRoomDelta(before, repliedDelta(11, 'bob', 'A new reply'));
    expect(after.messages.map((m) => m.seq)).toEqual([9, 10, 11]);
    const added = after.messages.find((m) => m.seq === 11);
    expect(added?.actor).toBe('bob');
    expect(added?.body).toBe('A new reply');
    expect(added?.kind).toBe('reply');
  });

  it('is IMMUTABLE — the prior model + its messages array are not mutated', () => {
    const before = roomModel();
    const beforeMessages = before.messages;
    const beforeLen = before.messages.length;
    const after = foldRoomDelta(before, repliedDelta(11, 'bob', 'x'));
    expect(after).not.toBe(before);
    expect(after.messages).not.toBe(beforeMessages);
    expect(before.messages).toBe(beforeMessages);
    expect(before.messages).toHaveLength(beforeLen); // prior array untouched
  });

  it('is idempotent by seq — a re-delivered room.replied does NOT double-append', () => {
    const before = roomModel();
    const once = foldRoomDelta(before, repliedDelta(11, 'bob', 'x'));
    const twice = foldRoomDelta(once, repliedDelta(11, 'bob', 'x'));
    expect(twice.messages.map((m) => m.seq)).toEqual([9, 10, 11]);
    expect(twice).toBe(once); // no-op returns the same reference
  });

  it('ignores a room.replied for a DIFFERENT room (returns the same model)', () => {
    const before = roomModel();
    const other: EventWire = {
      seq: 12,
      type: 'room.replied',
      actor: 'bob',
      created_at: '2026-06-01T09:00:00.000Z',
      payload: { room_id: 'some-other-room', body: 'x' },
    };
    expect(foldRoomDelta(before, other)).toBe(before);
  });

  it('a message.reacted adds the actor to the post reactions + re-derives the agreed seq', () => {
    const before = roomModel();
    const after = foldRoomDelta(
      before,
      reactDelta('message.reacted', 'cleo', 10),
    );
    const post10 = after.messages.find((m) => m.seq === 10);
    expect(post10?.reactions).toEqual(['cleo']);
    // The highest-seq live-👍'd message is the contract (FR21).
    expect(after.agreedSeq).toBe(10);
    // Immutable: prior post #10 untouched.
    expect(before.messages.find((m) => m.seq === 10)?.reactions).toEqual([]);
  });

  it('a message.unreacted removes the actor + the agreed mark reverts when no 👍 remains', () => {
    const reacted = foldRoomDelta(
      roomModel(),
      reactDelta('message.reacted', 'cleo', 10),
    );
    expect(reacted.agreedSeq).toBe(10);
    const unreacted = foldRoomDelta(
      reacted,
      reactDelta('message.unreacted', 'cleo', 10),
    );
    expect(unreacted.messages.find((m) => m.seq === 10)?.reactions).toEqual([]);
    expect(unreacted.agreedSeq).toBeNull();
  });

  it('agreed mark tracks the HIGHEST-seq live-👍 message (not the most reactors)', () => {
    // 👍 post #9 by two actors, 👍 post #10 by one → #10 wins (highest seq, FR21).
    let m = foldRoomDelta(roomModel(), reactDelta('message.reacted', 'a', 9));
    m = foldRoomDelta(m, reactDelta('message.reacted', 'b', 9));
    m = foldRoomDelta(m, reactDelta('message.reacted', 'c', 10));
    expect(m.agreedSeq).toBe(10);
  });
});

describe('optimistic-post helpers (AC2) — pending echo, fail, reconcile, immutable', () => {
  it('makePendingPost + appendPendingPost echo a pending post at the END, immutably', () => {
    const before = roomModel();
    const token = 'tok-1';
    const echo = makePendingPost('ops', 'optimistic body', token);
    expect(echo.pending).toBe(true);
    expect(echo.clientToken).toBe(token);
    expect(echo.seq).toBeGreaterThan(1e14); // synthetic large seq → sorts last
    const after = appendPendingPost(before, echo);
    expect(after).not.toBe(before);
    expect(after.messages).toHaveLength(before.messages.length + 1);
    expect(after.messages.at(-1)?.clientToken).toBe(token);
    expect(before.messages).toHaveLength(2); // prior untouched
  });

  it('markPendingPostFailed flips pending → failed for the matching token (draft body kept)', () => {
    const echo = makePendingPost('ops', 'keep me', 'tok-2');
    const withEcho = appendPendingPost(roomModel(), echo);
    const failed = markPendingPostFailed(withEcho, 'tok-2');
    const post = failed.messages.find((m) => m.clientToken === 'tok-2');
    expect(post?.failed).toBe(true);
    expect(post?.pending).toBe(false);
    expect(post?.body).toBe('keep me'); // draft preserved
    expect(failed).not.toBe(withEcho); // immutable
  });

  it('removePendingPost drops the echo (the reconciliation de-dup path)', () => {
    const echo = makePendingPost('ops', 'x', 'tok-3');
    const withEcho = appendPendingPost(roomModel(), echo);
    const reconciled = removePendingPost(withEcho, 'tok-3');
    expect(reconciled.messages.some((m) => m.clientToken === 'tok-3')).toBe(
      false,
    );
    expect(reconciled.messages).toHaveLength(2);
  });

  it('foldRoomDelta DE-DUPS: a room.replied matching a pending echo (actor+body) REPLACES it (no duplicate)', () => {
    const echo = makePendingPost('ops', 'my optimistic post', 'tok-4');
    const withEcho = appendPendingPost(roomModel(), echo);
    expect(withEcho.messages).toHaveLength(3); // 9, 10, pending echo
    // The SSE confirmation for the operator's own reply arrives.
    const confirmed = foldRoomDelta(
      withEcho,
      repliedDelta(11, 'ops', 'my optimistic post'),
    );
    // The pending echo is REPLACED (reconciled), not appended alongside → still 3 messages,
    // and the confirmed message #11 (no longer pending) is present.
    expect(confirmed.messages).toHaveLength(3);
    const post11 = confirmed.messages.find((m) => m.seq === 11);
    expect(post11).toBeDefined();
    expect(post11?.pending).toBeUndefined();
    // No pending echo remains.
    expect(confirmed.messages.some((m) => m.pending === true)).toBe(false);
  });
});

describe('deriveAgreedSeq (FR21) — highest-seq live-👍 message, ignoring optimistic echoes', () => {
  it('returns null when no message holds a live 👍', () => {
    expect(deriveAgreedSeq(roomModel().messages)).toBeNull();
  });

  it('returns the highest seq among messages with a non-empty reactions array', () => {
    const messages = roomModel().messages.map((m) =>
      m.seq === 9 ? { ...m, reactions: ['a', 'b'] } : m,
    );
    expect(deriveAgreedSeq(messages)).toBe(9);
  });

  it('never counts a pending optimistic echo (no real seq)', () => {
    const echo = { ...makePendingPost('ops', 'x', 't'), reactions: ['ops'] };
    const messages = [...roomModel().messages, echo];
    // The echo has reactions but is pending → excluded; no real message has a 👍 → null.
    expect(deriveAgreedSeq(messages)).toBeNull();
  });
});

// =============================================================================
// Story 9.9 QA HARDENING — the brief asks every fold to be proven IMMUTABLE at the
// REFERENCE level (not just by value) and IDEMPOTENT (a re-delivered delta does not
// double-apply). The append-fold immutability is covered above; these pin the REACTION
// fold (the under-covered fold) to the same discipline, plus reaction idempotency.
// =============================================================================
describe('foldRoomDelta reaction fold — immutability (reference + deep) + idempotency (QA)', () => {
  it('a message.reacted does NOT mutate the prior model, its messages array, or the target post reactions array (reference-level)', () => {
    const before = roomModel();
    const beforeModelRef = before;
    const beforeMessagesRef = before.messages;
    const beforePost10 = before.messages.find((m) => m.seq === 10)!;
    const beforePost10ReactionsRef = beforePost10.reactions;

    const after = foldRoomDelta(
      before,
      reactDelta('message.reacted', 'cleo', 10),
    );

    // A NEW model + a NEW messages array + a NEW post object + a NEW reactions array.
    expect(after).not.toBe(before);
    expect(after.messages).not.toBe(beforeMessagesRef);
    const afterPost10 = after.messages.find((m) => m.seq === 10)!;
    expect(afterPost10).not.toBe(beforePost10);
    expect(afterPost10.reactions).not.toBe(beforePost10ReactionsRef);

    // The PRIOR state is byte-for-byte untouched (reference identity preserved + empty).
    expect(before).toBe(beforeModelRef);
    expect(before.messages).toBe(beforeMessagesRef);
    expect(beforePost10.reactions).toBe(beforePost10ReactionsRef);
    expect(beforePost10ReactionsRef).toEqual([]); // not pushed into in place
    expect(before.agreedSeq).toBeNull(); // prior agreed mark not re-derived in place
  });

  it('a message.unreacted does NOT mutate the prior (already-reacted) post reactions array', () => {
    const reacted = foldRoomDelta(
      roomModel(),
      reactDelta('message.reacted', 'cleo', 10),
    );
    const reactedPost10 = reacted.messages.find((m) => m.seq === 10)!;
    const reactedReactionsRef = reactedPost10.reactions;
    expect(reactedReactionsRef).toEqual(['cleo']);

    const after = foldRoomDelta(
      reacted,
      reactDelta('message.unreacted', 'cleo', 10),
    );
    expect(after.messages.find((m) => m.seq === 10)?.reactions).toEqual([]);
    // The PRIOR (reacted) state's reactions array is untouched — filtered into a NEW array.
    expect(reactedPost10.reactions).toBe(reactedReactionsRef);
    expect(reactedReactionsRef).toEqual(['cleo']);
  });

  it('is IDEMPOTENT — a re-delivered message.reacted (same actor already present) is a no-op (no double-add, same reference)', () => {
    const once = foldRoomDelta(
      roomModel(),
      reactDelta('message.reacted', 'cleo', 10),
    );
    const twice = foldRoomDelta(
      once,
      reactDelta('message.reacted', 'cleo', 10),
    );
    // No double-apply: still exactly one 'cleo', and the no-op returns the SAME reference.
    expect(twice.messages.find((m) => m.seq === 10)?.reactions).toEqual([
      'cleo',
    ]);
    expect(twice).toBe(once);
  });

  it('a message.unreacted for an actor NOT holding a 👍 is a no-op (same reference, no negative drift)', () => {
    const before = roomModel();
    const after = foldRoomDelta(
      before,
      reactDelta('message.unreacted', 'ghost', 10),
    );
    expect(after).toBe(before); // nothing to remove → unchanged reference
    expect(after.messages.find((m) => m.seq === 10)?.reactions).toEqual([]);
  });
});
