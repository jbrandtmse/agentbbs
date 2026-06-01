// Unit/contract tests for the JSON API router (Story 9.3, Task 4).
//
// Exercises the route handlers against a REAL in-memory createDataAccess ledger (no
// mocks): the snake_case envelope shapes mirror the MCP tool contract, the closed
// BoardError codes map to the right HTTP status, an unknown route is 404 NOT_FOUND, and
// a non-/api path returns null (the host falls through to static serving). The route
// table is read-first — no write endpoints exist yet (the 9.6/9.7 seam).

import {
  addParticipant,
  announceProject,
  BOARD_ERROR_CODES,
  MAX_BODY_BYTES,
  postAnnouncement,
  register,
  reply,
} from '@agentbbs/core';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleApiRequest } from './json-api.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

let dataAccess: DataAccessHandle;

beforeEach(async () => {
  dataAccess = createDataAccess({ dbPath: ':memory:' });
  await register(dataAccess, { handle: 'alice', currentFocus: 'f' });
  await announceProject(dataAccess, 'alice', {
    title: 'Calling Interface',
    description: 'How agents dial in.',
  });
});

afterEach(() => {
  dataAccess.close();
});

describe('handleApiRequest — read routes', () => {
  it('GET /api/directory returns { projects } in snake_case', async () => {
    const res = await handleApiRequest('GET', '/api/directory', dataAccess);
    expect(res?.status).toBe(200);
    const body = res?.body as {
      projects: { project_id: string; title: string; members: string[] }[];
    };
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].project_id).toBe('calling-interface');
    expect(Array.isArray(body.projects[0].members)).toBe(true);
  });

  it('GET /api/projects is an alias returning the same { projects }', async () => {
    const res = await handleApiRequest('GET', '/api/projects', dataAccess);
    const body = res?.body as { projects: unknown[] };
    expect(body.projects).toHaveLength(1);
  });

  it('GET /api/projects/:id/members returns { members } in snake_case', async () => {
    const res = await handleApiRequest(
      'GET',
      '/api/projects/calling-interface/members',
      dataAccess,
    );
    expect(res?.status).toBe(200);
    const body = res?.body as {
      members: { handle: string; current_focus: string; last_seen: string }[];
    };
    expect(body.members[0]).toMatchObject({
      handle: 'alice',
      current_focus: 'f',
    });
    expect(typeof body.members[0].last_seen).toBe('string');
  });

  it('GET /api/projects/:id/announcements + /rooms return room arrays', async () => {
    const ann = await handleApiRequest(
      'GET',
      '/api/projects/calling-interface/announcements',
      dataAccess,
    );
    expect((ann?.body as { announcements: unknown[] }).announcements).toEqual(
      [],
    );
    const rooms = await handleApiRequest(
      'GET',
      '/api/projects/calling-interface/rooms',
      dataAccess,
    );
    expect((rooms?.body as { rooms: unknown[] }).rooms).toEqual([]);
  });

  it('GET /api/rooms/:id/contract returns contract null for an existing-but-empty room is N/A; unknown room → 404', async () => {
    const res = await handleApiRequest(
      'GET',
      '/api/rooms/calling-interface/contract',
      dataAccess,
    );
    // calling-interface is a PROJECT id, not a room id — there is no such room.
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('ROOM_NOT_FOUND');
  });
});

// --- Story 9.5: /api/rooms/:id carries each message's DISPLAY created_at + the room's
// participant list (host-layer additive fields; core RoomMessage + the ratified MCP message
// wire are UNTOUCHED — created_at is attached at the host, ordering stays by `seq`). Real
// in-memory ledger (Rule 3). ---
describe('handleApiRequest — /api/rooms/:id display timestamp + participants (Story 9.5)', () => {
  async function seedRoom(): Promise<string> {
    await register(dataAccess, { handle: 'bob', currentFocus: 'init' });
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Need a reviewer',
      body: 'announcement body',
    });
    await reply(dataAccess, 'alice', { roomId: room.roomId, body: 'starting' });
    await reply(dataAccess, 'bob', { roomId: room.roomId, body: 'on it' });
    return room.roomId;
  }

  it('each message carries a created_at (ISO string) alongside the ratified seq/actor/body/kind/reactions', async () => {
    const roomId = await seedRoom();
    const res = await handleApiRequest(
      'GET',
      `/api/rooms/${roomId}`,
      dataAccess,
    );
    expect(res?.status).toBe(200);
    const body = res?.body as {
      messages: {
        seq: number;
        actor: string;
        body: string;
        kind: string;
        reactions: string[];
        created_at: string;
      }[];
    };
    expect(body.messages).toHaveLength(3);
    for (const m of body.messages) {
      expect(typeof m.created_at).toBe('string');
      // A real ISO-8601 UTC string round-trips through Date.
      expect(new Date(m.created_at).toISOString()).toBe(m.created_at);
    }
    // The ratified fields are still present + unchanged (created_at is purely additive).
    expect(body.messages[0]).toMatchObject({
      kind: 'announcement',
      actor: 'alice',
      body: 'announcement body',
    });
  });

  it('messages stay ordered by seq even though created_at is now present (order key is seq, NOT created_at)', async () => {
    const roomId = await seedRoom();
    const res = await handleApiRequest(
      'GET',
      `/api/rooms/${roomId}`,
      dataAccess,
    );
    const body = res?.body as {
      messages: { seq: number; created_at: string }[];
    };
    const seqs = body.messages.map((m) => m.seq);
    // Strictly ascending by seq — the authoritative order.
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    // created_at for the highest-seq message is NOT necessarily the max timestamp the UI
    // would sort on — assert the ordering follows seq, not the created_at strings.
    const bySeq = [...body.messages].sort((a, b) => a.seq - b.seq);
    expect(body.messages).toEqual(bySeq);
  });

  it('carries the room participant list (the joined-row + operator-posture source)', async () => {
    const roomId = await seedRoom();
    const res = await handleApiRequest(
      'GET',
      `/api/rooms/${roomId}`,
      dataAccess,
    );
    const body = res?.body as { participants: string[] };
    // Both repliers are participants (announcer alice replied; bob replied), in seq order.
    expect(body.participants).toEqual(['alice', 'bob']);
  });

  it('a pulled-in (added) non-replying peer is a participant even though it has no message', async () => {
    const roomId = await seedRoom();
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    await addParticipant(dataAccess, 'alice', { roomId, handle: 'ops' });
    const res = await handleApiRequest(
      'GET',
      `/api/rooms/${roomId}`,
      dataAccess,
    );
    const body = res?.body as {
      participants: string[];
      messages: { actor: string }[];
    };
    // ops never posted, so it is NOT a message actor, but IS a participant (pulled-in).
    expect(body.messages.some((m) => m.actor === 'ops')).toBe(false);
    expect(body.participants).toContain('ops');
  });
});

describe('handleApiRequest — error + routing model', () => {
  it('an unknown sub-board → 404 BOARD_NOT_FOUND', async () => {
    const res = await handleApiRequest(
      'GET',
      '/api/projects/no-such-board/members',
      dataAccess,
    );
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('BOARD_NOT_FOUND');
  });

  it('a malformed slug → 400 (client error, not a 404)', async () => {
    const res = await handleApiRequest(
      'GET',
      '/api/projects/Not_A_Slug/members',
      dataAccess,
    );
    expect(res?.status).toBe(400);
    expect((res?.body as { code: string }).code).toBe('BOARD_NOT_FOUND');
    expect((res?.body as { message: string }).message).toContain('Malformed');
  });

  it('an unknown /api/ route → 404 NOT_FOUND', async () => {
    const res = await handleApiRequest('GET', '/api/nope', dataAccess);
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a wrong method on a known route → 404 NOT_FOUND (no write endpoints in 9.3)', async () => {
    const res = await handleApiRequest('POST', '/api/directory', dataAccess);
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-/api path returns null (host falls through to static serving)', async () => {
    const res = await handleApiRequest('GET', '/index.html', dataAccess);
    expect(res).toBeNull();
  });
});

// --- Story 9.4: operator identity + NEEDS YOU endpoints (Task 1 / AC #3, Rule 3 — real
// ledger). /api/me returns the resolved operator handle (or null); /api/needs-you returns
// the rooms the operator was EXPLICITLY add_participant-ed into (deterministic, never
// time-based). snake_case wire. ---
describe('handleApiRequest — operator identity + NEEDS YOU (Story 9.4)', () => {
  it('GET /api/me returns { handle: null } when no operator is configured', async () => {
    const res = await handleApiRequest('GET', '/api/me', dataAccess);
    expect(res?.status).toBe(200);
    expect(res?.body).toEqual({ handle: null });
  });

  it('GET /api/me returns the resolved operator handle when configured', async () => {
    const res = await handleApiRequest('GET', '/api/me', dataAccess, 'ops');
    expect(res?.status).toBe(200);
    expect(res?.body).toEqual({ handle: 'ops' });
  });

  it('GET /api/needs-you returns a room the operator was add_participant-ed into (snake_case)', async () => {
    // Seed: register ops, post + activate a room, then pull ops in (the escalation).
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Need a human decision',
      body: 'Pulling ops in.',
    });
    await reply(dataAccess, 'alice', { roomId: room.roomId, body: 'starting' });
    await addParticipant(dataAccess, 'alice', {
      roomId: room.roomId,
      handle: 'ops',
    });

    const res = await handleApiRequest(
      'GET',
      '/api/needs-you',
      dataAccess,
      'ops',
    );
    expect(res?.status).toBe(200);
    const body = res?.body as {
      rooms: { room_id: string; project_id: string; subject: string }[];
    };
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0]).toMatchObject({
      room_id: room.roomId,
      project_id: 'calling-interface',
      subject: 'Need a human decision',
    });
  });

  it('GET /api/needs-you is EMPTY for a quiet room the operator was never added to (never time-based)', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    // An active room where alice & bob talk but ops is never pulled in.
    await register(dataAccess, { handle: 'bob', currentFocus: 'init' });
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Quiet & not escalated',
      body: 'No one pulls ops in.',
    });
    await reply(dataAccess, 'alice', { roomId: room.roomId, body: 'hi' });
    await reply(dataAccess, 'bob', { roomId: room.roomId, body: 'hey' });

    const res = await handleApiRequest(
      'GET',
      '/api/needs-you',
      dataAccess,
      'ops',
    );
    expect(res?.status).toBe(200);
    expect((res?.body as { rooms: unknown[] }).rooms).toEqual([]);
  });

  it('GET /api/needs-you is EMPTY with no operator handle (watching-only)', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Escalated to ops',
      body: 'body',
    });
    await reply(dataAccess, 'alice', { roomId: room.roomId, body: 'x' });
    await addParticipant(dataAccess, 'alice', {
      roomId: room.roomId,
      handle: 'ops',
    });

    // No operatorHandle passed → null → empty (nothing escalated to "nobody").
    const res = await handleApiRequest('GET', '/api/needs-you', dataAccess);
    expect((res?.body as { rooms: unknown[] }).rooms).toEqual([]);
  });
});

// --- Story 9.6: the WRITE seam's first use — react/unreact POST endpoints (Task 1, Rule 3
// real in-memory ledger). A PARTICIPANT operator react → live count up + operator in
// reactions; unreact → removed; a NON-participant operator react → 403 NOT_A_MEMBER with
// NOTHING appended (maxSeq unchanged); a watching-only host (no operator) → 403 NO_OPERATOR;
// an unknown message seq → 404 MESSAGE_NOT_FOUND; a malformed seq → 400. snake_case wire. ---
describe('handleApiRequest — react/unreact write endpoints (Story 9.6)', () => {
  /** Seed an active room with two replies; return its id + the two REPLY MESSAGE seqs. */
  async function seedRoom(): Promise<{
    roomId: string;
    m1: number;
    m2: number;
  }> {
    await register(dataAccess, { handle: 'bob', currentFocus: 'init' });
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Need a reviewer',
      body: 'announcement body',
    });
    await reply(dataAccess, 'alice', {
      roomId: room.roomId,
      body: 'first option',
    });
    await reply(dataAccess, 'bob', {
      roomId: room.roomId,
      body: 'second option',
    });
    // `reply` returns the (activated) ROOM (its `seq` is NOT a message seq); read the actual
    // per-message reply seqs from /api/rooms/:id (announcement #1, then the two replies).
    const res = await handleApiRequest(
      'GET',
      `/api/rooms/${room.roomId}`,
      dataAccess,
    );
    const body = res?.body as { messages: { seq: number; kind: string }[] };
    const replySeqs = body.messages
      .filter((m) => m.kind === 'reply')
      .map((m) => m.seq)
      .sort((a, b) => a - b);
    return { roomId: room.roomId, m1: replySeqs[0]!, m2: replySeqs[1]! };
  }

  /** The current MAX(seq) in the ledger — to assert nothing was appended on a rejection. */
  async function maxSeq(): Promise<number> {
    const events = await dataAccess.eventsSince(0);
    return events.reduce((max, e) => Math.max(max, e.seq), 0);
  }

  it('a PARTICIPANT operator react → 200, live count up + operator in reactions (snake_case)', async () => {
    const { roomId, m1 } = await seedRoom();
    // alice is a participant (she replied). React to her own first reply as the operator.
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/${m1}/react`,
      dataAccess,
      'alice',
    );
    expect(res?.status).toBe(200);
    expect(res?.body).toEqual({ message_seq: m1, reactions: ['alice'] });
  });

  it('react then unreact by the same operator removes the live 👍 (toggle round-trip)', async () => {
    const { roomId, m1 } = await seedRoom();
    await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/${m1}/react`,
      dataAccess,
      'alice',
    );
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/${m1}/unreact`,
      dataAccess,
      'alice',
    );
    expect(res?.status).toBe(200);
    expect(res?.body).toEqual({ message_seq: m1, reactions: [] });
  });

  it('a NON-participant operator react → 403 NOT_A_MEMBER, NOTHING appended (maxSeq unchanged)', async () => {
    const { roomId, m1 } = await seedRoom();
    // ops is registered but is NOT a participant of the room.
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const before = await maxSeq();
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/${m1}/react`,
      dataAccess,
      'ops',
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NOT_A_MEMBER');
    // The gate appends nothing — the ledger high-water-mark is unchanged.
    expect(await maxSeq()).toBe(before);
  });

  it('a watching-only host (no operator) react → 403 NO_OPERATOR, NOTHING appended', async () => {
    const { roomId, m1 } = await seedRoom();
    const before = await maxSeq();
    // No operatorHandle argument → watching-only → cannot act.
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/${m1}/react`,
      dataAccess,
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NO_OPERATOR');
    expect(await maxSeq()).toBe(before);
  });

  it('an unknown message seq → 404 MESSAGE_NOT_FOUND', async () => {
    const { roomId } = await seedRoom();
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/9999/react`,
      dataAccess,
      'alice',
    );
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('MESSAGE_NOT_FOUND');
  });

  it('a malformed (non-positive-integer) seq → 400 (client error, not a 404)', async () => {
    const { roomId } = await seedRoom();
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/not-a-seq/react`,
      dataAccess,
      'alice',
    );
    expect(res?.status).toBe(400);
    expect((res?.body as { code: string }).code).toBe('MESSAGE_NOT_FOUND');
    expect((res?.body as { message: string }).message).toContain('Malformed');
  });

  it('GET on a write route → 404 NOT_FOUND (method-scoped routing)', async () => {
    const { roomId, m1 } = await seedRoom();
    const res = await handleApiRequest(
      'GET',
      `/api/rooms/${roomId}/messages/${m1}/react`,
      dataAccess,
      'alice',
    );
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('NOT_FOUND');
  });

  // --- QA hardening (Story 9.6 qa stage): the gates the dev's react-only cases left the
  // UNREACT route unproven for. `requireOperator` + the core NOT_A_MEMBER gate run PER ROUTE
  // (react and unreact each call them independently), so a regression that drops a gate from
  // unreact ONLY would slip past the react-only tests. These pin unreact's gates symmetrically,
  // each asserting NOTHING is appended on the rejection (maxSeq unchanged). ---

  it('a watching-only host (no operator) UNREACT → 403 NO_OPERATOR, NOTHING appended (gate is per-route, not react-only)', async () => {
    const { roomId, m1 } = await seedRoom();
    const before = await maxSeq();
    // No operatorHandle → watching-only → cannot act, even to RETRACT a 👍.
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/${m1}/unreact`,
      dataAccess,
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NO_OPERATOR');
    expect(await maxSeq()).toBe(before);
  });

  it('a NON-participant operator UNREACT → 403 NOT_A_MEMBER, NOTHING appended (the gate applies to unreact too)', async () => {
    const { roomId, m1 } = await seedRoom();
    // ops is registered but is NOT a participant — core gates unreact the same as react.
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const before = await maxSeq();
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/${m1}/unreact`,
      dataAccess,
      'ops',
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NOT_A_MEMBER');
    expect(await maxSeq()).toBe(before);
  });

  it('an unknown message seq on UNREACT → 404 MESSAGE_NOT_FOUND (mirrors react)', async () => {
    const { roomId } = await seedRoom();
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/9999/unreact`,
      dataAccess,
      'alice',
    );
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('MESSAGE_NOT_FOUND');
  });

  it('GET on the UNREACT write route → 404 NOT_FOUND (method-scoped, like react)', async () => {
    const { roomId, m1 } = await seedRoom();
    const res = await handleApiRequest(
      'GET',
      `/api/rooms/${roomId}/messages/${m1}/unreact`,
      dataAccess,
      'alice',
    );
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('NOT_FOUND');
  });
});

// --- QA hardening (Story 9.6 qa stage, Rule 10 — agent error-contract drift guard): the
// host's `NO_OPERATOR` write-gate code is a HOST-surface code, deliberately NOT a member of
// core's CLOSED, VERSIONED `BOARD_ERROR_CODES` set (the agent-facing error contract the MCP
// surface exposes). The dev's Completion Notes make this a LOAD-BEARING claim. Pin it to the
// live source of truth so a future "tidy" that moves NO_OPERATOR into core (silently widening
// the agent contract) turns this RED. (A host-surface code MUST be a 403 the host raises
// before/instead of reaching core — verified by the watching-only cases above.)
describe('NO_OPERATOR stays OUT of the core closed error set (Story 9.6 qa, Rule 10 drift guard)', () => {
  it('NO_OPERATOR is NOT a core BoardError code (the agent error contract is unchanged)', () => {
    // The host raises NO_OPERATOR (proven by the watching-only react/unreact 403s above), yet
    // it must NEVER appear in core's closed set — that set is the agent-facing contract.
    expect(BOARD_ERROR_CODES as readonly string[]).not.toContain('NO_OPERATOR');
  });

  it('the closed set is EXACTLY the ratified ten codes (no silent additions in this story)', () => {
    // Pin the full membership so ANY drift — adding NO_OPERATOR, dropping a code, a rename —
    // surfaces here, not at an agent that calls a tool returning a code it cannot map.
    expect([...BOARD_ERROR_CODES].sort()).toEqual(
      [
        'BOARD_NOT_FOUND',
        'BODY_TOO_LARGE',
        'HANDLE_NOT_FOUND',
        'HANDLE_TAKEN',
        'LOGIN_UNKNOWN',
        'MESSAGE_NOT_FOUND',
        'NOT_A_MEMBER',
        'NO_IDENTITY',
        'PROJECT_EXISTS',
        'ROOM_NOT_FOUND',
      ].sort(),
    );
  });
});

// --- Story 9.6 AC2 — the marquee FR21 semantic, END-TO-END over the real HTTP-shaped seam
// the UI consumes (react/unreact writes → /contract read). The ✓ agreed mark is the
// HIGHEST-`seq` message currently holding a live 👍 (COMPUTED, never stored): it MOVES to a
// higher-seq message that gains the contract, REVERTS to the next-highest on retraction, and
// DISAPPEARS when all live 👍s retract. This is the UI's source of truth (the agreedSeq the
// shell marks); the apps/web buildRoomViewModel mutation-test (api-client.test.ts) pins that
// the UI HONORS this seq. (The core selection itself was mutation-tested in Story 5.3.) ---
describe('handleApiRequest — agreed contract MOVES/REVERTS/DISAPPEARS with live 👍s (Story 9.6 AC2, real ledger)', () => {
  async function seedTwoReplies(): Promise<{
    roomId: string;
    m1: number;
    m2: number;
  }> {
    await register(dataAccess, { handle: 'bob', currentFocus: 'init' });
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Need a reviewer',
      body: 'announcement body',
    });
    await reply(dataAccess, 'alice', {
      roomId: room.roomId,
      body: 'first option',
    });
    await reply(dataAccess, 'bob', {
      roomId: room.roomId,
      body: 'second option',
    });
    // `reply` returns the (activated) ROOM, not the message — its `seq` is the room/activation
    // seq, NOT a message seq. The MESSAGE seqs are the per-message `seq`s from /api/rooms/:id
    // (announcement #1, then the two replies, ascending). m1/m2 are the two REPLY seqs.
    const replySeqs = await replyMessageSeqs(room.roomId);
    return { roomId: room.roomId, m1: replySeqs[0]!, m2: replySeqs[1]! };
  }

  /** The seqs of a room's REPLY messages (kind === 'reply'), seq-ascending — via /api/rooms/:id. */
  async function replyMessageSeqs(roomId: string): Promise<number[]> {
    const res = await handleApiRequest(
      'GET',
      `/api/rooms/${roomId}`,
      dataAccess,
    );
    const body = res?.body as { messages: { seq: number; kind: string }[] };
    return body.messages
      .filter((m) => m.kind === 'reply')
      .map((m) => m.seq)
      .sort((a, b) => a - b);
  }

  /** The seq the UI would mark `✓ agreed` — the /contract endpoint's contract.seq, or null. */
  async function agreedSeq(roomId: string): Promise<number | null> {
    const res = await handleApiRequest(
      'GET',
      `/api/rooms/${roomId}/contract`,
      dataAccess,
    );
    const body = res?.body as { contract: { seq: number } | null };
    return body.contract === null ? null : body.contract.seq;
  }

  async function react(
    roomId: string,
    seq: number,
    actor: string,
  ): Promise<void> {
    await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/${seq}/react`,
      dataAccess,
      actor,
    );
  }
  async function unreact(
    roomId: string,
    seq: number,
    actor: string,
  ): Promise<void> {
    await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/messages/${seq}/unreact`,
      dataAccess,
      actor,
    );
  }

  it('no live 👍 → no agreed message (null); a 👍 on M1 → M1 is agreed', async () => {
    const { roomId, m1 } = await seedTwoReplies();
    expect(await agreedSeq(roomId)).toBeNull();
    await react(roomId, m1, 'alice');
    expect(await agreedSeq(roomId)).toBe(m1);
  });

  it('a 👍 on a HIGHER-seq M2 MOVES the agreed mark to M2 (highest-seq live-reacted wins, NOT most reactors)', async () => {
    const { roomId, m1, m2 } = await seedTwoReplies();
    // M1 gets TWO reactors; M2 gets ONE. "Most reactors" would pick M1 — FR21 picks M2 (higher seq).
    await react(roomId, m1, 'alice');
    await react(roomId, m1, 'bob');
    expect(await agreedSeq(roomId)).toBe(m1);
    await react(roomId, m2, 'alice');
    // Highest-seq live-👍'd wins: M2 (1 reactor) over M1 (2 reactors).
    expect(await agreedSeq(roomId)).toBe(m2);
  });

  it('retracting the higher M2 REVERTS the mark to the next-highest live-reacted M1', async () => {
    const { roomId, m1, m2 } = await seedTwoReplies();
    await react(roomId, m1, 'alice');
    await react(roomId, m2, 'alice');
    expect(await agreedSeq(roomId)).toBe(m2);
    await unreact(roomId, m2, 'alice');
    expect(await agreedSeq(roomId)).toBe(m1);
  });

  it('retracting ALL live 👍s makes the agreed mark DISAPPEAR (null) — computed, never stored', async () => {
    const { roomId, m1, m2 } = await seedTwoReplies();
    await react(roomId, m1, 'alice');
    await react(roomId, m2, 'alice');
    await unreact(roomId, m2, 'alice');
    await unreact(roomId, m1, 'alice');
    expect(await agreedSeq(roomId)).toBeNull();
  });
});

// --- Story 9.7: the join + reply + add_participant WRITE endpoints — the UI write path
// (Rule 3, real in-memory ledger). The operator acts over the SAME core ops agents use
// (joinBoard / reply / addParticipant), with the actor = the operator handle:
//   POST /api/projects/:id/join        → joinBoard (sub-board membership; the ✓ you joined)
//   POST /api/rooms/:id/reply { body } → reply (the post AND grant-on-act room participation)
//   POST /api/rooms/:id/participants { handle } → addParticipant (gated on operator being a
//                                                  participant)
// BODY-carrying writes pass the parsed JSON body as handleApiRequest's 5th arg (server.ts
// parses + size-bounds the real stream — covered in host.integration.test.ts). The Design
// reconciliation (project-rules Rule 8): the board has NO standalone "join room as
// participant" op — joinBoard is sub-board membership; the operator becomes a ROOM
// PARTICIPANT only by ACTING (reply), exactly the agent rule. ---
describe('handleApiRequest — join/reply/add_participant write endpoints (Story 9.7)', () => {
  /** The current MAX(seq) in the ledger — to assert nothing was appended on a rejection. */
  async function maxSeq(): Promise<number> {
    const events = await dataAccess.eventsSince(0);
    return events.reduce((max, e) => Math.max(max, e.seq), 0);
  }

  /** Seed an active room (alice announced + replied) and return its id. */
  async function seedRoom(): Promise<string> {
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Need a reviewer',
      body: 'announcement body',
    });
    await reply(dataAccess, 'alice', { roomId: room.roomId, body: 'starting' });
    return room.roomId;
  }

  it('POST /api/projects/:id/join → 200, the operator becomes a SUB-BOARD member (not yet a room participant)', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const res = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/join',
      dataAccess,
      'ops',
    );
    expect(res?.status).toBe(200);
    const body = res?.body as {
      project: { project_id: string; members: string[] };
    };
    expect(body.project.project_id).toBe('calling-interface');
    expect(body.project.members).toContain('ops');

    // joinBoard is sub-board membership — it is NOT room participation (no room to be in yet).
    const members = await handleApiRequest(
      'GET',
      '/api/projects/calling-interface/members',
      dataAccess,
    );
    expect(
      (members?.body as { members: { handle: string }[] }).members.map(
        (m) => m.handle,
      ),
    ).toContain('ops');
  });

  it('POST /api/projects/:id/join is idempotent (re-join a board the operator is already in → 200, no extra event)', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/join',
      dataAccess,
      'ops',
    );
    const after = await maxSeq();
    const res = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/join',
      dataAccess,
      'ops',
    );
    expect(res?.status).toBe(200);
    // Idempotent re-join appends nothing (joinBoard's no-op re-join).
    expect(await maxSeq()).toBe(after);
  });

  it('POST /api/projects/:id/join an unknown board → 404 BOARD_NOT_FOUND', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const res = await handleApiRequest(
      'POST',
      '/api/projects/no-such-board/join',
      dataAccess,
      'ops',
    );
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('BOARD_NOT_FOUND');
  });

  it('POST /api/projects/:id/join with NO operator (watching-only) → 403 NO_OPERATOR, nothing appended', async () => {
    const before = await maxSeq();
    const res = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/join',
      dataAccess,
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NO_OPERATOR');
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/rooms/:id/reply { body } → 200 + the operator becomes a ROOM PARTICIPANT (grant-on-act) and a member', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const roomId = await seedRoom();
    // ops has NOT joined or posted — it is watching. The reply is the act that joins.
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/reply`,
      dataAccess,
      'ops',
      { body: 'I think we should ship.' },
    );
    expect(res?.status).toBe(200);
    const body = res?.body as { room: { room_id: string; active: boolean } };
    expect(body.room.room_id).toBe(roomId);
    expect(body.room.active).toBe(true);

    // Grant-on-act: ops is now a ROOM PARTICIPANT (read back via /api/rooms/:id), and a
    // sub-board member (read back via /members) — exactly the agent "acting = joining" rule.
    const roomRes = await handleApiRequest(
      'GET',
      `/api/rooms/${roomId}`,
      dataAccess,
    );
    const roomBody = roomRes?.body as {
      participants: string[];
      messages: { actor: string; body: string }[];
    };
    expect(roomBody.participants).toContain('ops');
    // The operator's posted message appears in the thread authored by the operator handle.
    expect(
      roomBody.messages.some(
        (m) => m.actor === 'ops' && m.body === 'I think we should ship.',
      ),
    ).toBe(true);

    const members = await handleApiRequest(
      'GET',
      '/api/projects/calling-interface/members',
      dataAccess,
    );
    expect(
      (members?.body as { members: { handle: string }[] }).members.map(
        (m) => m.handle,
      ),
    ).toContain('ops');
  });

  it('POST /api/rooms/:id/reply over the body cap → 413 BODY_TOO_LARGE (the core cap, nothing appended)', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const roomId = await seedRoom();
    const before = await maxSeq();
    // One byte over the 256 KB core cap.
    const tooBig = 'x'.repeat(MAX_BODY_BYTES + 1);
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/reply`,
      dataAccess,
      'ops',
      { body: tooBig },
    );
    expect(res?.status).toBe(413);
    expect((res?.body as { code: string }).code).toBe('BODY_TOO_LARGE');
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/rooms/:id/reply to an unknown room → 404 ROOM_NOT_FOUND', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const res = await handleApiRequest(
      'POST',
      '/api/rooms/no-such-room/reply',
      dataAccess,
      'ops',
      { body: 'hello' },
    );
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('ROOM_NOT_FOUND');
  });

  it('POST /api/rooms/:id/reply with NO operator (watching-only) → 403 NO_OPERATOR, nothing appended', async () => {
    const roomId = await seedRoom();
    const before = await maxSeq();
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/reply`,
      dataAccess,
      null,
      { body: 'hello' },
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NO_OPERATOR');
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/rooms/:id/reply with a missing/empty body field → 400 BAD_REQUEST, nothing appended', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const roomId = await seedRoom();
    const before = await maxSeq();
    // Missing field entirely.
    const missing = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/reply`,
      dataAccess,
      'ops',
      {},
    );
    expect(missing?.status).toBe(400);
    expect((missing?.body as { code: string }).code).toBe('BAD_REQUEST');
    // Empty string body.
    const empty = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/reply`,
      dataAccess,
      'ops',
      { body: '' },
    );
    expect(empty?.status).toBe(400);
    expect((empty?.body as { code: string }).code).toBe('BAD_REQUEST');
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/rooms/:id/participants { handle } (by a room participant) → 200, target added', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    await register(dataAccess, { handle: 'cleo', currentFocus: 'reviewing' });
    const roomId = await seedRoom();
    // ops first REPLIES → becomes a room participant (grant-on-act), so it can add_participant.
    await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/reply`,
      dataAccess,
      'ops',
      { body: 'on it' },
    );
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/participants`,
      dataAccess,
      'ops',
      { handle: 'cleo' },
    );
    expect(res?.status).toBe(200);
    const body = res?.body as {
      room: { room_id: string };
      participants: string[];
    };
    expect(body.room.room_id).toBe(roomId);
    expect(body.participants).toContain('cleo');
    expect(body.participants).toContain('ops');
  });

  it('POST /api/rooms/:id/participants by a NON-participant operator → 403 NOT_A_MEMBER, nothing appended', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    await register(dataAccess, { handle: 'cleo', currentFocus: 'reviewing' });
    const roomId = await seedRoom();
    const before = await maxSeq();
    // ops has NOT replied/joined the room → it is not a participant → cannot add a peer.
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/participants`,
      dataAccess,
      'ops',
      { handle: 'cleo' },
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NOT_A_MEMBER');
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/rooms/:id/participants with an unknown target handle → 404 HANDLE_NOT_FOUND', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const roomId = await seedRoom();
    await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/reply`,
      dataAccess,
      'ops',
      { body: 'on it' },
    );
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/participants`,
      dataAccess,
      'ops',
      { handle: 'ghost' },
    );
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('HANDLE_NOT_FOUND');
  });

  it('POST /api/rooms/:id/participants with a missing handle field → 400 BAD_REQUEST', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const roomId = await seedRoom();
    await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/reply`,
      dataAccess,
      'ops',
      { body: 'on it' },
    );
    const res = await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/participants`,
      dataAccess,
      'ops',
      {},
    );
    expect(res?.status).toBe(400);
    expect((res?.body as { code: string }).code).toBe('BAD_REQUEST');
  });

  it('SAME-CORE proof: the operator reply is a real room.replied event (the same type an agent produces)', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const roomId = await seedRoom();
    const before = await dataAccess.eventsSince(0);
    const beforeReplied = before.filter(
      (e) => e.type === 'room.replied',
    ).length;
    await handleApiRequest(
      'POST',
      `/api/rooms/${roomId}/reply`,
      dataAccess,
      'ops',
      { body: 'operator peer post' },
    );
    const after = await dataAccess.eventsSince(0);
    const opsReplied = after.filter(
      (e) => e.type === 'room.replied' && e.actor === 'ops',
    );
    // The operator's post is a NORMAL room.replied (same event type any agent reply produces)
    // — proving the operator is a peer over the SAME core, not a special operator-only path.
    expect(opsReplied).toHaveLength(1);
    expect(after.filter((e) => e.type === 'room.replied').length).toBe(
      beforeReplied + 1,
    );
  });

  it('a wrong method (GET) on a write route → 404 NOT_FOUND (method-scoped routing)', async () => {
    const roomId = await seedRoom();
    const res = await handleApiRequest(
      'GET',
      `/api/rooms/${roomId}/reply`,
      dataAccess,
      'alice',
    );
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('NOT_FOUND');
  });
});

// --- Story 9.11: the operator INITIATE-surface write endpoints (announce_project /
// post_announcement) at the UNIT layer (handleApiRequest with a parsed-object body). These mirror
// the agent ops EXACTLY (no operator backdoor): POST /api/projects { title, description } →
// announceProject (operator = first member; duplicate → PROJECT_EXISTS 409, nothing appended);
// POST /api/projects/:id/announcements { subject, body } → postAnnouncement (member-gate FIRST →
// NOT_A_MEMBER 403 for a non-member / BOARD_NOT_FOUND 404 unknown board, then BODY_TOO_LARGE 413
// over-cap, then announcement.posted). NO_OPERATOR (watching-only) + BAD_REQUEST (missing field)
// gate every write. The host re-implements NONE of the core gates. ---
describe('handleApiRequest — start-a-negotiation write endpoints (Story 9.11)', () => {
  /** The current MAX(seq) in the ledger — to assert nothing was appended on a rejection. */
  async function maxSeq(): Promise<number> {
    const events = await dataAccess.eventsSince(0);
    return events.reduce((max, e) => Math.max(max, e.seq), 0);
  }

  it('POST /api/projects { title, description } → 200, operator is the new sub-board first member', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'initiating' });
    const res = await handleApiRequest(
      'POST',
      '/api/projects',
      dataAccess,
      'ops',
      {
        title: 'Retry Budget',
        description: 'Who owns the retry budget.',
      },
    );
    expect(res?.status).toBe(200);
    const body = res?.body as {
      project: { project_id: string; announcer: string; members: string[] };
    };
    expect(body.project.project_id).toBe('retry-budget');
    expect(body.project.announcer).toBe('ops');
    expect(body.project.members).toEqual(['ops']);
  });

  it('POST /api/projects with a DUPLICATE title → 409 PROJECT_EXISTS, nothing appended (atomic rollback)', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'initiating' });
    // The beforeEach already announced "Calling Interface" by alice — re-announce it.
    const before = await maxSeq();
    const res = await handleApiRequest(
      'POST',
      '/api/projects',
      dataAccess,
      'ops',
      {
        title: 'Calling Interface',
        description: 'a duplicate title.',
      },
    );
    expect(res?.status).toBe(409);
    expect((res?.body as { code: string }).code).toBe('PROJECT_EXISTS');
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/projects with NO operator (watching-only) → 403 NO_OPERATOR, nothing appended', async () => {
    const before = await maxSeq();
    const res = await handleApiRequest(
      'POST',
      '/api/projects',
      dataAccess,
      null,
      {
        title: 'No Operator',
        description: 'x.',
      },
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NO_OPERATOR');
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/projects with a missing/empty title or description → 400 BAD_REQUEST, nothing appended', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'initiating' });
    const before = await maxSeq();
    const noTitle = await handleApiRequest(
      'POST',
      '/api/projects',
      dataAccess,
      'ops',
      {
        description: 'no title.',
      },
    );
    expect(noTitle?.status).toBe(400);
    expect((noTitle?.body as { code: string }).code).toBe('BAD_REQUEST');
    const noDesc = await handleApiRequest(
      'POST',
      '/api/projects',
      dataAccess,
      'ops',
      {
        title: 'No Description',
      },
    );
    expect(noDesc?.status).toBe(400);
    expect((noDesc?.body as { code: string }).code).toBe('BAD_REQUEST');
    const emptyTitle = await handleApiRequest(
      'POST',
      '/api/projects',
      dataAccess,
      'ops',
      {
        title: '',
        description: 'x.',
      },
    );
    expect(emptyTitle?.status).toBe(400);
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/projects/:id/announcements { subject, body } by a MEMBER → 200, announcement.posted lands', async () => {
    // alice (the beforeEach announcer) is a member of calling-interface.
    const res = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/announcements',
      dataAccess,
      'alice',
      { subject: 'Need a decision', body: 'who owns the retry budget?' },
    );
    expect(res?.status).toBe(200);
    const body = res?.body as {
      room: { room_id: string; project_id: string; posted_by: string };
    };
    expect(body.room.project_id).toBe('calling-interface');
    expect(body.room.posted_by).toBe('alice');
    const events = await dataAccess.eventsSince(0);
    expect(
      events.some(
        (e) => e.type === 'announcement.posted' && e.actor === 'alice',
      ),
    ).toBe(true);
  });

  it('POST /api/projects/:id/announcements by a NON-member → 403 NOT_A_MEMBER, nothing appended (join-first trigger)', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const before = await maxSeq();
    // ops is NOT a member of calling-interface (alice announced it).
    const res = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/announcements',
      dataAccess,
      'ops',
      { subject: 'sneak in', body: 'not a member' },
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NOT_A_MEMBER');
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/projects/:id/announcements for an UNKNOWN board → 404 BOARD_NOT_FOUND', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const res = await handleApiRequest(
      'POST',
      '/api/projects/no-such-board/announcements',
      dataAccess,
      'ops',
      { subject: 's', body: 'b' },
    );
    expect(res?.status).toBe(404);
    expect((res?.body as { code: string }).code).toBe('BOARD_NOT_FOUND');
  });

  it('POST /api/projects/:id/announcements with an over-cap body → 413 BODY_TOO_LARGE, nothing appended', async () => {
    const before = await maxSeq();
    const tooBig = 'x'.repeat(MAX_BODY_BYTES + 1);
    const res = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/announcements',
      dataAccess,
      'alice',
      { subject: 'big', body: tooBig },
    );
    expect(res?.status).toBe(413);
    expect((res?.body as { code: string }).code).toBe('BODY_TOO_LARGE');
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/projects/:id/announcements with NO operator → 403 NO_OPERATOR, nothing appended', async () => {
    const before = await maxSeq();
    const res = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/announcements',
      dataAccess,
      null,
      { subject: 's', body: 'b' },
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NO_OPERATOR');
    expect(await maxSeq()).toBe(before);
  });

  it('POST /api/projects/:id/announcements with a missing subject or body field → 400 BAD_REQUEST', async () => {
    const noSubject = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/announcements',
      dataAccess,
      'alice',
      { body: 'b' },
    );
    expect(noSubject?.status).toBe(400);
    expect((noSubject?.body as { code: string }).code).toBe('BAD_REQUEST');
    const noBody = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/announcements',
      dataAccess,
      'alice',
      { subject: 's' },
    );
    expect(noBody?.status).toBe(400);
    expect((noBody?.body as { code: string }).code).toBe('BAD_REQUEST');
  });

  // Rule 13 drift-guard — this story adds NO core code and NO new error code. The operator
  // INITIATE surface maps to the EXISTING core ops over EXISTING closed codes; the closed set is
  // EXACTLY the ratified ten (any drift — a new code smuggled in, a rename, a drop — fails here).
  it('Rule 13 — BOARD_ERROR_CODES is unchanged: EXACTLY the ratified ten codes (no new code in this story)', () => {
    expect([...BOARD_ERROR_CODES].sort()).toEqual(
      [
        'BOARD_NOT_FOUND',
        'BODY_TOO_LARGE',
        'HANDLE_NOT_FOUND',
        'HANDLE_TAKEN',
        'LOGIN_UNKNOWN',
        'MESSAGE_NOT_FOUND',
        'NOT_A_MEMBER',
        'NO_IDENTITY',
        'PROJECT_EXISTS',
        'ROOM_NOT_FOUND',
      ].sort(),
    );
    // NO_OPERATOR is a HOST-surface code only — it must NEVER enter core's closed agent contract.
    expect(BOARD_ERROR_CODES as readonly string[]).not.toContain('NO_OPERATOR');
  });
});

// --- QA hardening (Story 9.11 qa stage) — the LOAD-BEARING semantics the dev's happy/gate cases
// assert COARSELY (maxSeq only) or do not cover at all. The dev proves "nothing appended on a
// rejection" via the ledger high-water-mark (maxSeq unchanged); these SHARPEN that to "neither of
// the SPECIFIC events is present" (a partial-append regression that lands ONE event of an atomic
// pair could, in principle, leave maxSeq tracking differently — the event-presence assertion is
// the faithful "atomic rollback" pin), and add the GATE-ORDER case the dev's per-gate tests cannot
// catch: post_announcement runs the membership gate BEFORE the body cap, so a NON-member with an
// OVER-CAP body must get NOT_A_MEMBER (403), never BODY_TOO_LARGE (413). Real in-memory ledger
// (Rule 3); each rejection asserted by the SPECIFIC missing event(s), not just maxSeq. ---
describe('handleApiRequest — Story 9.11 qa: atomicity + gate-order (the load-bearing semantics)', () => {
  /** All event types appended by `actor` (to assert the SPECIFIC events of an atomic op). */
  async function typesByActor(actor: string): Promise<string[]> {
    const events = await dataAccess.eventsSince(0);
    return events.filter((e) => e.actor === actor).map((e) => e.type);
  }

  // ATOMICITY (announce_project, AC1/AC3) — a duplicate-title announce must roll back BOTH events
  // of the atomic pair. The dev's duplicate test asserts maxSeq is unchanged; this asserts the
  // STRONGER property the AC actually promises: NEITHER project.announced NOR board.joined from the
  // re-announcing operator is present (a partial append that landed one but not the other — the
  // exact failure "atomic" forbids — is invisible to a maxSeq-only check if the count happened to
  // align, but is caught here by the specific-event absence).
  it('a duplicate-title announce_project appends NEITHER project.announced NOR board.joined (atomic, by specific event)', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'initiating' });
    // alice already announced "Calling Interface" in the beforeEach. ops re-announces the SAME title.
    const res = await handleApiRequest(
      'POST',
      '/api/projects',
      dataAccess,
      'ops',
      { title: 'Calling Interface', description: 'a duplicate.' },
    );
    expect(res?.status).toBe(409);
    expect((res?.body as { code: string }).code).toBe('PROJECT_EXISTS');
    // ops appended NOTHING — neither half of the atomic announce+join pair landed.
    const opsTypes = await typesByActor('ops');
    expect(opsTypes).not.toContain('project.announced');
    expect(opsTypes).not.toContain('board.joined');
    // And the original project is intact: still announced by alice, still exactly one project.
    const dir = await handleApiRequest('GET', '/api/directory', dataAccess);
    const projects = (dir?.body as { projects: { announcer: string }[] })
      .projects;
    expect(projects).toHaveLength(1);
    expect(projects[0].announcer).toBe('alice');
  });

  // ATOMICITY (post_announcement, AC2/AC3) — a non-member post rejects at the membership gate with
  // NOTHING appended; sharpen the dev's maxSeq check to "no announcement.posted by the non-member".
  it('a NON-member post_announcement appends NO announcement.posted (the membership gate rejects before any append)', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const res = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/announcements',
      dataAccess,
      'ops',
      { subject: 'sneak in', body: 'not a member' },
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NOT_A_MEMBER');
    // The SPECIFIC event the op would have produced is absent (not merely "maxSeq unchanged").
    expect(await typesByActor('ops')).not.toContain('announcement.posted');
  });

  // GATE ORDER (post_announcement) — THE marquee semantic the dev's separate NOT_A_MEMBER and
  // BODY_TOO_LARGE cases cannot prove in isolation: a NON-member submitting an OVER-CAP body hits
  // BOTH conditions, and core runs the membership gate FIRST (post-announcement.ts:123 before :129),
  // so the operator gets NOT_A_MEMBER (403) — the JOIN-FIRST handoff — NOT BODY_TOO_LARGE (413). If
  // the gate order ever flipped, a non-member would be told "your body is too large" and shrink it
  // forever instead of being routed to join. This pins the order; nothing is appended either way.
  it('a NON-member with an OVER-CAP body → 403 NOT_A_MEMBER (gate runs BEFORE the body cap), NOT 413 BODY_TOO_LARGE', async () => {
    await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
    const before = await dataAccess.eventsSince(0);
    const beforeMax = before.reduce((m, e) => Math.max(m, e.seq), 0);
    // ops is NOT a member of calling-interface AND the body is one byte over the core cap.
    const overCap = 'x'.repeat(MAX_BODY_BYTES + 1);
    const res = await handleApiRequest(
      'POST',
      '/api/projects/calling-interface/announcements',
      dataAccess,
      'ops',
      { subject: 'big AND not a member', body: overCap },
    );
    expect(res?.status).toBe(403);
    expect((res?.body as { code: string }).code).toBe('NOT_A_MEMBER');
    // Explicitly NOT the body-cap outcome — the membership gate short-circuited first.
    expect(res?.status).not.toBe(413);
    expect((res?.body as { code: string }).code).not.toBe('BODY_TOO_LARGE');
    // Nothing appended by the POST (the gate rejected before the cap check, let alone the append):
    // the ledger high-water-mark is unchanged from before the POST (the `register` above is part
    // of the seed, so `beforeMax` is captured AFTER it), and ops produced NO announcement.posted.
    const after = await dataAccess.eventsSince(0);
    expect(after.reduce((m, e) => Math.max(m, e.seq), 0)).toBe(beforeMax);
    expect(
      after.some((e) => e.actor === 'ops' && e.type === 'announcement.posted'),
    ).toBe(false);
  });
});
