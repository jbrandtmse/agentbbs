// Unit tests for the apps/web JSON-API + SSE client helpers (Story 9.3, Task 4).
//
// Pure logic — node env. `fetchDirectory` is exercised with an injected fetch (no real
// server; the AC3 integration test proves the real wiring). `foldDelta` is the SSE-delta
// reducer the shell applies; it must advance the high-water-mark monotonically, count
// deltas, and record the latest event.

import { describe, expect, it } from 'vitest';

import {
  buildRoomViewModel,
  fetchDirectory,
  fetchRoom,
  foldDelta,
  foldTreeDelta,
  INITIAL_LIVE_STATE,
  loadTreeModel,
  selectRoom,
} from './api-client.js';

import type {
  ContractResponse,
  EventWire,
  RoomResponse,
} from './api-client.js';
import type { NavTreeModel } from '@agentbbs/ui-shared';

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
