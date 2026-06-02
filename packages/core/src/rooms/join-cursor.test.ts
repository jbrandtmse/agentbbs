// Join-cursor projection unit tests (Story 4.6, Task 1/2 / AC #1–#5).
//
// Pins the per-(identity, room) JOIN FLOOR — `roomJoinSeq` derives the `seq` of the EARLIEST
// event by which a handle became a participant of a room (MIN over their `room.replied` for the
// room + the `room.participant_added` naming them), or `undefined` if they are not a participant.
// `roomMessagesSince` filters `roomMessages` (Story 4.4) to `seq > sinceSeq` (STRICT) — the floor
// expression Story 6.1's `check` applies. No I/O — pure folds over hand-built, `seq`-ordered
// Event streams (the unit half; the real-ledger proof is join-cursor.integration.test.ts).
//
// Coverage:
//   roomJoinSeq —
//     - replier → their (min-`seq`) `room.replied` for the room (AC #3);
//     - added participant → the `room.participant_added` `seq`;
//     - added-then-replied → the ADD `seq` (earliest, AC #4);
//     - replied-then-added → the REPLY `seq` (earliest, AC #4);
//     - multiple replies → the FIRST reply's `seq` (earliest);
//     - non-participant (incl. the announcer-who-never-replied) → `undefined` (AC #5);
//     - unknown room → `undefined`; empty stream → `undefined`;
//     - cross-room isolation: a join in room A sets NO floor in room B;
//     - order-independence: an out-of-order input still yields the MIN `seq`.
//   roomMessagesSince —
//     - [announcement, replyA, replyB], floor = replyA.seq → only [replyB] is "new"
//       (announcement + replyA excluded; AC #2/#3);
//     - a participant added AFTER the last message → [] new (all history is back-history);
//     - STRICT `>`: the message AT sinceSeq is excluded, later ones included;
//     - cross-room isolation; `roomMessages` (full history) is NOT cursor-scoped (AC #2).

import { describe, expect, it } from 'vitest';

import { roomJoinSeq, roomMessagesSince } from './join-cursor.js';
import { roomMessages } from './room-history.js';

import type { Event } from '../events/event.js';

/** Build an announcement.posted Event (mints a room; its actor is NOT thereby a participant). */
function posted(
  seq: number,
  actor: string,
  projectId: string,
  roomId: string,
  subject: string,
  body: string,
): Event {
  return {
    seq,
    type: 'announcement.posted',
    actor,
    createdAt: `2026-05-31T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload: { projectId, roomId, subject, body },
  };
}

/** Build a room.replied Event (its actor becomes a participant of `roomId`). */
function replied(
  seq: number,
  actor: string,
  roomId: string,
  body: string,
): Event {
  return {
    seq,
    type: 'room.replied',
    actor,
    createdAt: `2026-05-31T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload: { roomId, body },
  };
}

/** Build a room.participant_added Event (its payload `handle` becomes a participant). */
function added(
  seq: number,
  actor: string,
  roomId: string,
  handle: string,
): Event {
  return {
    seq,
    type: 'room.participant_added',
    actor,
    createdAt: `2026-05-31T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload: { roomId, handle },
  };
}

/** Build an unrelated identity.registered Event (must be ignored by the fold). */
function reg(seq: number, handle: string): Event {
  return {
    seq,
    type: 'identity.registered',
    actor: handle,
    createdAt: `2026-05-31T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload: { handle, currentFocus: 'x' },
  };
}

describe('roomJoinSeq — the per-(identity, room) join floor (Story 4.6, AC #1, #3, #4, #5)', () => {
  it('a replier joins at their room.replied seq (AC #3)', () => {
    const events = [
      reg(1, 'ada'),
      posted(
        2,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(3, 'bob', 'calling-interface', 'on it'),
    ];
    // bob became a participant by replying at seq 3 → his floor is 3.
    expect(roomJoinSeq(events, 'calling-interface', 'bob')).toBe(3);
  });

  it('a replier with MULTIPLE replies joins at their FIRST (min-seq) reply (AC #3)', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'first'),
      replied(4, 'bob', 'calling-interface', 'second'),
      replied(6, 'bob', 'calling-interface', 'third'),
    ];
    // The floor is the EARLIEST participating event — bob's first reply (seq 2), not a later one.
    expect(roomJoinSeq(events, 'calling-interface', 'bob')).toBe(2);
  });

  it('an added participant joins at their room.participant_added seq', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'on it'),
      added(3, 'bob', 'calling-interface', 'cleo'),
    ];
    // cleo was pulled in at seq 3 (never replied) → her floor is 3.
    expect(roomJoinSeq(events, 'calling-interface', 'cleo')).toBe(3);
  });

  it('added-then-replied → the floor is the ADD seq (earliest, AC #4)', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'on it'),
      added(3, 'bob', 'calling-interface', 'cleo'),
      replied(5, 'cleo', 'calling-interface', 'thanks for the add'),
    ];
    // cleo was added at seq 3, then replied at seq 5 — her floor is the moment she FIRST became
    // a participant (the add, seq 3), so nothing between the add and her reply is lost.
    expect(roomJoinSeq(events, 'calling-interface', 'cleo')).toBe(3);
  });

  it('replied-then-added → the floor is the REPLY seq (earliest, AC #4)', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'on it'),
      // cleo replies FIRST (seq 3), and is later (redundantly) added (seq 7).
      replied(3, 'cleo', 'calling-interface', 'jumping in'),
      added(7, 'bob', 'calling-interface', 'cleo'),
    ];
    // The earliest participating event is her reply (seq 3), not the later add.
    expect(roomJoinSeq(events, 'calling-interface', 'cleo')).toBe(3);
  });

  it('a non-participant (announcer who never replied) → undefined (AC #5)', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'on it'),
    ];
    // ada announced the room but never replied / was never added → not a participant → no floor.
    expect(roomJoinSeq(events, 'calling-interface', 'ada')).toBeUndefined();
    // A registered handle that never engaged the room is likewise floor-less.
    expect(roomJoinSeq(events, 'calling-interface', 'nobody')).toBeUndefined();
  });

  it('an announcer who LATER replies gets a floor at that reply', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'on it'),
      replied(4, 'ada', 'calling-interface', 'replying to my own announcement'),
    ];
    // ada becomes a participant only when she replies (seq 4) — announcing alone is not joining.
    expect(roomJoinSeq(events, 'calling-interface', 'ada')).toBe(4);
  });

  it('returns undefined for an unknown room and for an empty stream', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'on it'),
    ];
    expect(roomJoinSeq(events, 'no-such-room', 'bob')).toBeUndefined();
    expect(roomJoinSeq([], 'calling-interface', 'bob')).toBeUndefined();
  });

  it('is isolated per room: a join in room A sets NO floor in room B', () => {
    const events = [
      posted(1, 'ada', 'board-a', 'room-a', 'Room A', 'a'),
      posted(2, 'ada', 'board-a', 'room-b', 'Room B', 'b'),
      replied(3, 'bob', 'room-a', 'a'),
      added(4, 'bob', 'room-a', 'cleo'),
      // bob/cleo never touch room-b.
      replied(5, 'dave', 'room-b', 'b'),
    ];
    expect(roomJoinSeq(events, 'room-a', 'bob')).toBe(3);
    expect(roomJoinSeq(events, 'room-a', 'cleo')).toBe(4);
    // bob is a participant of room-a but has NO floor in room-b (and dave the reverse).
    expect(roomJoinSeq(events, 'room-b', 'bob')).toBeUndefined();
    expect(roomJoinSeq(events, 'room-b', 'cleo')).toBeUndefined();
    expect(roomJoinSeq(events, 'room-b', 'dave')).toBe(5);
    expect(roomJoinSeq(events, 'room-a', 'dave')).toBeUndefined();
  });

  it('distinguishes the adder (actor) from the added handle (payload.handle)', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'on it'),
      // bob (actor) adds cleo (payload.handle). The add gives cleo a floor, NOT bob.
      added(3, 'bob', 'calling-interface', 'cleo'),
    ];
    expect(roomJoinSeq(events, 'calling-interface', 'cleo')).toBe(3);
    // bob's floor is his own reply (seq 2), unaffected by his act of adding cleo at seq 3.
    expect(roomJoinSeq(events, 'calling-interface', 'bob')).toBe(2);
  });

  it('takes the MIN seq even when the input stream is not seq-ordered', () => {
    // Order-independence: the fold returns the minimum participating `seq` regardless of input
    // order (the floor is a min, not a first-seen). Robust to any caller passing an unsorted slice.
    const events = [
      replied(6, 'cleo', 'calling-interface', 'later'),
      added(3, 'bob', 'calling-interface', 'cleo'),
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'first'),
    ];
    // cleo: added@3 and replied@6 → min is 3. bob: replied@2 → 2.
    expect(roomJoinSeq(events, 'calling-interface', 'cleo')).toBe(3);
    expect(roomJoinSeq(events, 'calling-interface', 'bob')).toBe(2);
  });

  it('ignores non-room events (identity events do not establish a floor)', () => {
    const events = [reg(1, 'ada'), reg(2, 'bob')];
    expect(roomJoinSeq(events, 'calling-interface', 'ada')).toBeUndefined();
  });
});

describe('roomMessagesSince — the per-room "new for me" floor (Story 4.6, AC #2, #3)', () => {
  // A room with three messages: the seeding announcement (#1), then two replies.
  const events: Event[] = [
    posted(
      1,
      'ada',
      'board-a',
      'calling-interface',
      'Calling Interface',
      'the need',
    ),
    replied(2, 'bob', 'calling-interface', 'reply A'),
    replied(3, 'cleo', 'calling-interface', 'reply B'),
  ];

  it('with floor = the joiner-reply seq, only LATER messages are new (back-history excluded, AC #2/#3)', () => {
    // bob joined by replying at seq 2 (his roomJoinSeq). His "new in this room" is seq > 2 →
    // only cleo's reply B (seq 3). The announcement (seq 1) AND bob's OWN reply (seq 2) are
    // excluded (no flood; own join not re-surfaced).
    const bobFloor = roomJoinSeq(events, 'calling-interface', 'bob');
    expect(bobFloor).toBe(2);
    const since = roomMessagesSince(events, 'calling-interface', bobFloor ?? 0);
    expect(since.map((m) => m.seq)).toEqual([3]);
    expect(since.map((m) => m.body)).toEqual(['reply B']);
    // STRICT `>`: bob's own reply (seq 2 == floor) is NOT in the new set.
    expect(since.some((m) => m.seq === bobFloor)).toBe(false);
  });

  it('a participant added AFTER the last message sees [] new (all history is back-history, AC #2)', () => {
    // erin is added at seq 4 — after every existing message. Her floor is 4, so seq > 4 is empty:
    // the entire room is back-history to her (no flood).
    const withErin: Event[] = [
      ...events,
      added(4, 'bob', 'calling-interface', 'erin'),
    ];
    const erinFloor = roomJoinSeq(withErin, 'calling-interface', 'erin');
    expect(erinFloor).toBe(4);
    expect(
      roomMessagesSince(withErin, 'calling-interface', erinFloor ?? 0),
    ).toEqual([]);
  });

  it('is STRICT (>) at the boundary: the message AT sinceSeq is excluded, later ones included', () => {
    // sinceSeq = 1 (the announcement's seq) → both replies (2, 3) are new, the announcement is not.
    expect(
      roomMessagesSince(events, 'calling-interface', 1).map((m) => m.seq),
    ).toEqual([2, 3]);
    // sinceSeq = 0 → everything (announcement included) — the "never joined / read all" extreme.
    expect(
      roomMessagesSince(events, 'calling-interface', 0).map((m) => m.seq),
    ).toEqual([1, 2, 3]);
    // sinceSeq = 3 (the last message) → nothing newer.
    expect(roomMessagesSince(events, 'calling-interface', 3)).toEqual([]);
  });

  it('does NOT cursor-scope the FULL history: read_room (roomMessages) still returns everything (AC #2)', () => {
    // The floor helper is for `check`'s delta; the full ordered history (what read_room renders)
    // is NEVER cursor-scoped — both bob (floor 2) and a hypothetical later joiner still get all 3.
    expect(roomMessages(events, 'calling-interface').map((m) => m.seq)).toEqual(
      [1, 2, 3],
    );
  });

  it('is isolated per room', () => {
    const twoRooms: Event[] = [
      posted(1, 'ada', 'board-a', 'room-a', 'Room A', 'a'),
      posted(2, 'ada', 'board-a', 'room-b', 'Room B', 'b'),
      replied(3, 'bob', 'room-a', 'a-reply'),
      replied(4, 'cleo', 'room-b', 'b-reply'),
    ];
    // since=0 in room-a returns only room-a's messages (announce@1 + reply@3), never room-b's.
    expect(roomMessagesSince(twoRooms, 'room-a', 0).map((m) => m.seq)).toEqual([
      1, 3,
    ]);
    expect(roomMessagesSince(twoRooms, 'room-b', 0).map((m) => m.seq)).toEqual([
      2, 4,
    ]);
  });
});

// QA-added (Story 4.6, AC #2/#3/#5): the floor is genuinely PER-IDENTITY, not a single global
// position. The dev's suite proves single-participant floors and per-ROOM isolation; this block
// proves that within ONE shared room, multiple participants who joined at DISTINCT points each get
// a DISTINCT "new for me" delta off the SAME history — which a global/shared floor could not
// produce. It also pins the trickiest actor (the announcer who authored msg #1 but joins late) and
// the non-participant gate, in one cohesive scenario.
describe('QA: many participants, distinct join points — the floor is per-identity, not global (Story 4.6, AC #2/#3/#5)', () => {
  // ONE room. ann posts the announcement (msg #1 — NOT yet a participant), then alice, bob, cleo
  // reply at distinct seqs (each joins at their own reply), then ann FINALLY replies (joins late).
  // The shared history is [announce@1, alice@2, bob@3, cleo@4, ann@5]; each identity's floor is
  // their own joining seq, so each sees a different tail.
  const events: Event[] = [
    posted(
      1,
      'ann',
      'board-a',
      'calling-interface',
      'Calling Interface',
      'the need',
    ),
    replied(2, 'alice', 'calling-interface', 'alice in'),
    replied(3, 'bob', 'calling-interface', 'bob in'),
    replied(4, 'cleo', 'calling-interface', 'cleo in'),
    replied(5, 'ann', 'calling-interface', 'ann finally weighs in'),
  ];

  it('each participant floors at their OWN joining seq (one shared room)', () => {
    expect(roomJoinSeq(events, 'calling-interface', 'alice')).toBe(2);
    expect(roomJoinSeq(events, 'calling-interface', 'bob')).toBe(3);
    expect(roomJoinSeq(events, 'calling-interface', 'cleo')).toBe(4);
    // The announcer is NOT a participant by announcing (msg #1, seq 1); ann's floor is their
    // own LATER reply (seq 5), NOT the announcement seq — 4.5 semantics (AC #3, Design dec. 5).
    expect(roomJoinSeq(events, 'calling-interface', 'ann')).toBe(5);
  });

  it('each participant sees a DISTINCT "new for me" tail off the SAME shared history', () => {
    // alice (floor 2): everything AFTER her reply — bob@3, cleo@4, ann@5. NOT the announcement
    // (back-history) and NOT her own reply@2 (strict `>`).
    expect(
      roomMessagesSince(events, 'calling-interface', 2).map((m) => m.seq),
    ).toEqual([3, 4, 5]);
    // bob (floor 3): only cleo@4 + ann@5.
    expect(
      roomMessagesSince(events, 'calling-interface', 3).map((m) => m.seq),
    ).toEqual([4, 5]);
    // cleo (floor 4): only ann@5.
    expect(
      roomMessagesSince(events, 'calling-interface', 4).map((m) => m.seq),
    ).toEqual([5]);
    // The four deltas differ — proof the floor is per-identity. A single GLOBAL floor would have
    // to yield the SAME tail for everyone, which it does not.
  });

  it('the announcer who replies LATE does NOT see the pre-reply history (incl. their OWN msg #1) as new (AC #2/#3)', () => {
    const annFloor = roomJoinSeq(events, 'calling-interface', 'ann');
    expect(annFloor).toBe(5);
    // ann joined at seq 5 (the newest message). seq > 5 is empty: alice@2, bob@3, cleo@4 are all
    // back-history to ann, AND ann's OWN announcement (msg #1, seq 1) is NOT re-surfaced as "new"
    // even though ann authored it — the floor is the JOIN event, not authorship of the seed.
    expect(
      roomMessagesSince(events, 'calling-interface', annFloor ?? 0),
    ).toEqual([]);
    // Sanity that ann genuinely authored the announcement (so the no-flood is non-vacuous): msg #1
    // is ann's, yet excluded from ann's "new" delta.
    const msg1 = roomMessages(events, 'calling-interface')[0];
    expect(msg1).toMatchObject({ seq: 1, actor: 'ann', kind: 'announcement' });
  });

  it('a non-participant in this populated room has NO floor → undefined (the per-identity check-scope gate, AC #5)', () => {
    // zoe never replied / was never added → not a participant → undefined, even though the room is
    // busy. Per Design decision 5, `check` (6.1) simply omits this room from zoe's scope (it does
    // NOT floor her at 0 and flood her — see the composition note in the integration suite).
    expect(roomJoinSeq(events, 'calling-interface', 'zoe')).toBeUndefined();
  });
});
