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
