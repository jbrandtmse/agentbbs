// Unit tests for the apps/web JSON-API + SSE client helpers (Story 9.3, Task 4).
//
// Pure logic — node env. `fetchDirectory` is exercised with an injected fetch (no real
// server; the AC3 integration test proves the real wiring). `foldDelta` is the SSE-delta
// reducer the shell applies; it must advance the high-water-mark monotonically, count
// deltas, and record the latest event.

import { describe, expect, it } from 'vitest';

import {
  fetchDirectory,
  foldDelta,
  foldTreeDelta,
  INITIAL_LIVE_STATE,
  loadTreeModel,
  selectRoom,
} from './api-client.js';

import type { EventWire } from './api-client.js';
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
