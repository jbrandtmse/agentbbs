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
