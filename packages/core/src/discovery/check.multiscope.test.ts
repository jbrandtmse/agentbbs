// `check` MULTI-SCOPE delta union (Story 6.1 QA, AC #1 — the cross-board + cross-room union the
// dev's single-scope unit tests don't reach).
//
// THE GAP THIS CLOSES. The dev's check.test.ts proves each scope SEPARATELY: one in-scope
// announcement (one board), one in-scope message (one room), and the cross-scope EXCLUSIONS (an
// announcement in a board I'm not a member of → excluded; a message in a room I don't participate
// in → excluded). What it does NOT prove is the POSITIVE UNION that AC #1 actually promises —
// "new ANNOUNCEMENTS in my sub-boards (plural) and new MESSAGES in rooms I participate in
// (plural) … ordered by seq" — in ONE check, with:
//   - announcements from MULTIPLE member boards (B1 + B2) both returned, seq-ordered;
//   - messages from MULTIPLE participated rooms (R1 + R2) MERGED into ONE seq-ordered list (the
//     cross-room merge-sort in check.ts — a single participated room can't exercise it);
//   - simultaneously NOTHING from a board the actor isn't a member of, nor a room they don't
//     participate in (cross-scope exclusion holding WHILE the in-scope union is non-trivial);
//   - the cursor advancing to the max seq across the COMBINED announcements ∪ messages delta.
// A union bug (e.g. only the first participated room folded, or announcements/messages not both
// considered for maxReturned) would pass every single-scope test yet fail here.
//
// In-memory fold tier (mirrors check.test.ts): core depends only on the DataAccess port, and this
// is pure scope/union logic over a hand-built seq-ordered stream — no real ledger needed (the
// real-runtime proof is check.integration.test.ts). The fake is the same Map-backed shape the
// dev's unit suite uses, kept self-contained.

import { describe, expect, it } from 'vitest';

import { check } from './check.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/** A minimal in-memory DataAccess (same shape as check.test.ts's): seq-ordered store + cursors. */
function memoryDataAccess(seed: Event[] = []): DataAccess {
  let seq = seed.reduce((m, e) => Math.max(m, e.seq), 0);
  const store: Event[] = [...seed];
  const cursors = new Map<string, number>();
  let tick = 0;
  const clock = (): string => {
    tick += 1;
    return new Date(Date.UTC(2026, 4, 31, 0, 0, tick)).toISOString();
  };
  const appendAll = (events: NewEvent[]): number[] => {
    const createdAt = clock();
    return events.map((e) => {
      seq += 1;
      store.push({ ...e, seq, createdAt } as Event);
      return seq;
    });
  };
  return {
    append: (events) => Promise.resolve(appendAll(events)),
    appendGuarded: (events) => Promise.resolve(appendAll(events)),
    eventsSince: (cursor) =>
      Promise.resolve(
        store.filter((e) => e.seq > cursor).sort((a, b) => a.seq - b.seq),
      ),
    eventsByType: (type) =>
      Promise.resolve(
        store.filter((e) => e.type === type).sort((a, b) => a.seq - b.seq),
      ),
    eventsByActor: (actor) =>
      Promise.resolve(
        store.filter((e) => e.actor === actor).sort((a, b) => a.seq - b.seq),
      ),
    maxSeq: () => Promise.resolve(seq),
    getCursor: (handle) => Promise.resolve(cursors.get(handle) ?? 0),
    setCursor: (handle, value) => {
      cursors.set(handle, value);
      return Promise.resolve();
    },
  };
}

// --- Event builders (hand-built, seq-ordered streams) ---
function ev(
  seq: number,
  type: Event['type'],
  actor: string,
  payload: unknown,
): Event {
  return {
    seq,
    type,
    actor,
    createdAt: `2026-05-31T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload,
  } as unknown as Event;
}
function reg(seq: number, handle: string): Event {
  return ev(seq, 'identity.registered', handle, { handle, currentFocus: 'x' });
}
function announced(seq: number, actor: string, projectId: string): Event {
  return ev(seq, 'project.announced', actor, {
    projectId,
    title: projectId,
    description: 'd',
  });
}
function joined(seq: number, actor: string, projectId: string): Event {
  return ev(seq, 'board.joined', actor, { projectId });
}
function posted(
  seq: number,
  actor: string,
  projectId: string,
  roomId: string,
): Event {
  return ev(seq, 'announcement.posted', actor, {
    projectId,
    roomId,
    subject: roomId,
    body: `body-${roomId}`,
  });
}
function replied(seq: number, actor: string, roomId: string): Event {
  return ev(seq, 'room.replied', actor, { roomId, body: `reply-${seq}` });
}

describe('check — multi-board + multi-room delta union (AC #1)', () => {
  it('returns new announcements from BOTH member boards AND new messages from BOTH participated rooms in ONE check, seq-ordered, excluding every out-of-scope board/room', async () => {
    // bob is a MEMBER of board-1 and board-2 (joined both, early), and a PARTICIPANT of room-1
    // (in board-1) and room-2 (in board-2). cleo owns a third board-3 bob is NOT in. The stream
    // is built so that, AFTER bob's join floors and his starting cursor (0):
    //   - board-1 gets a NEW announcement (room-1a) bob should see (member);
    //   - board-2 gets a NEW announcement (room-2a) bob should see (member);
    //   - board-3 gets an announcement (room-3a) bob should NOT see (non-member);
    //   - room-1 (bob participates) gets a NEW reply from cleo;
    //   - room-2 (bob participates) gets a NEW reply from ada;
    //   - a room in board-3 (room-3a) gets replies bob should NOT see (non-participant).
    const da = memoryDataAccess([
      reg(1, 'ada'),
      reg(2, 'bob'),
      reg(3, 'cleo'),
      // board-1: ada announces (auto-join seq 5), seeds room-1; bob joins, then replies room-1.
      announced(4, 'ada', 'board-1'),
      joined(5, 'ada', 'board-1'),
      posted(6, 'ada', 'board-1', 'room-1'), // pre-join for bob → below his board-1 floor
      joined(7, 'bob', 'board-1'), // bob's board-1 floor = 7
      replied(8, 'bob', 'room-1'), // bob participates in room-1 (room floor 8)
      // board-2: ada announces (auto-join seq 10), seeds room-2; bob joins, then replies room-2.
      announced(9, 'ada', 'board-2'),
      joined(10, 'ada', 'board-2'),
      posted(11, 'ada', 'board-2', 'room-2'), // pre-join for bob → below his board-2 floor
      joined(12, 'bob', 'board-2'), // bob's board-2 floor = 12
      replied(13, 'bob', 'room-2'), // bob participates in room-2 (room floor 13)
      // board-3: cleo owns it; bob is NOT a member. A room + a reply here are all out of scope.
      announced(14, 'cleo', 'board-3'),
      joined(15, 'cleo', 'board-3'),
      posted(16, 'cleo', 'board-3', 'room-3a'),
      replied(17, 'cleo', 'room-3a'),
    ]);

    // bob's FIRST check establishes his cursor past all the seeding activity above (his own
    // joining replies + the pre-join announcements are below his floors; room-1/room-2 seeding
    // announcements are below his room floors). Drains the setup so the NEXT delta is strictly new.
    const firstCursor = (await check(da, 'bob')).cursor;

    // Now the genuinely-NEW union activity, interleaved across both boards + both rooms so the
    // combined delta must merge them by seq:
    await da.append([
      {
        type: 'announcement.posted',
        actor: 'ada',
        payload: {
          projectId: 'board-1',
          roomId: 'room-1a',
          subject: 'room-1a',
          body: 'b',
        },
      }, // new announcement, board-1
    ]);
    await da.append([
      {
        type: 'room.replied',
        actor: 'cleo',
        payload: { roomId: 'room-2', body: 'in room-2' },
      }, // new message, room-2 (board-2)
    ]);
    await da.append([
      {
        type: 'announcement.posted',
        actor: 'ada',
        payload: {
          projectId: 'board-2',
          roomId: 'room-2a',
          subject: 'room-2a',
          body: 'b',
        },
      }, // new announcement, board-2
    ]);
    await da.append([
      {
        type: 'room.replied',
        actor: 'ada',
        payload: { roomId: 'room-1', body: 'in room-1' },
      }, // new message, room-1 (board-1)
    ]);
    // OUT OF SCOPE, interleaved at the highest seqs: a board-3 announcement + a board-3 room reply.
    await da.append([
      {
        type: 'announcement.posted',
        actor: 'cleo',
        payload: {
          projectId: 'board-3',
          roomId: 'room-3b',
          subject: 'room-3b',
          body: 'b',
        },
      }, // board-3 — NOT bob's
    ]);
    await da.append([
      {
        type: 'room.replied',
        actor: 'cleo',
        payload: { roomId: 'room-3a', body: 'more board-3' },
      }, // room bob doesn't participate in
    ]);

    const result = await check(da, 'bob');

    // ANNOUNCEMENT UNION: both new member-board announcements (room-1a from board-1, room-2a from
    // board-2) are returned — and NOTHING from board-3 (room-3b). Returned seq-ordered.
    expect(result.announcements.map((r) => r.roomId)).toEqual([
      'room-1a',
      'room-2a',
    ]);
    expect(result.announcements.map((r) => r.roomId)).not.toContain('room-3b');

    // MESSAGE UNION across TWO participated rooms, MERGED into ONE seq-ordered list: cleo's room-2
    // reply and ada's room-1 reply, in seq order (room-2 reply landed first). NOTHING from room-3a
    // (bob is not a participant).
    expect(
      result.messages.map((m) => ({ roomId: m.roomId, actor: m.actor })),
    ).toEqual([
      { roomId: 'room-2', actor: 'cleo' }, // landed first (lower seq)
      { roomId: 'room-1', actor: 'ada' }, // landed later (higher seq)
    ]);
    expect(result.messages.map((m) => m.roomId)).not.toContain('room-3a');
    // The merged message list is strictly seq-ascending across the two rooms (the cross-room sort).
    const msgSeqs = result.messages.map((m) => m.seq);
    expect([...msgSeqs].sort((a, b) => a - b)).toEqual(msgSeqs);

    // CURSOR: advances to the max seq across the COMBINED announcements ∪ messages delta — i.e. the
    // highest of bob's four in-scope new events (ada's room-1 reply, the last in-scope append),
    // NOT the global maxSeq (which is the out-of-scope board-3 room-3a reply). Proves both scopes
    // feed maxReturned and the out-of-scope higher-seq events are not swallowed into the cursor.
    const inScopeSeqs = [
      ...result.announcements.map((r) => r.seq),
      ...result.messages.map((m) => m.seq),
    ];
    const expectedCursor = Math.max(...inScopeSeqs);
    expect(result.cursor).toBe(expectedCursor);
    expect(result.cursor).toBeGreaterThan(firstCursor);
    // The global ledger max is strictly higher than bob's cursor (the out-of-scope board-3 events
    // sit above it) — so a later in-scope event below the global max would still surface (AC #3).
    expect(await da.maxSeq()).toBeGreaterThan(result.cursor);
  });
});
