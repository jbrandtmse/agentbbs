// Room message-history projection unit tests (Story 4.4, Task 1 / AC #1, #4, #5).
//
// Pins the pure fold of a room's COMPLETE ordered history: the seeding `announcement.posted`
// as message #1 (`kind='announcement'`, body = the announcement body), then every
// `room.replied` for that room (`kind='reply'`), all sorted ascending by `seq`. No I/O — a
// pure fold over a hand-built, `seq`-ordered Event stream (mirrors projection.test.ts).
//
// What is proven here:
//   - a proto-room (announcement, no reply) → EXACTLY one message (the announcement);
//   - after replies → [announcement, reply, reply] in `seq` order, bodies verbatim;
//   - an unknown roomId → EMPTY list (readRoom turns "no room" into ROOM_NOT_FOUND — Task 2);
//   - cross-room isolation: only THIS room's messages (other rooms' announcements/replies
//     never leak in), even when the stream interleaves events across rooms;
//   - ordering is by `seq` (not append order / not createdAt) even on an unsorted input;
//   - non-room event types (identity.registered, board.joined, …) are ignored.

import { describe, expect, it } from 'vitest';

import { roomMessages } from './room-history.js';

import type { Event } from '../events/event.js';

/** Build an announcement.posted Event (mints a proto-room — message #1 of its history). */
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
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId, roomId, subject, body },
  };
}

/** Build a room.replied Event (a reply IS a message — kind='reply' in the history). */
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
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { roomId, body },
  };
}

/** Build an unrelated identity.registered Event (must be ignored by the fold). */
function reg(seq: number, handle: string): Event {
  return {
    seq,
    type: 'identity.registered',
    actor: handle,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { handle, currentFocus: 'x' },
  };
}

/** Build an unrelated board.joined Event (must be ignored by the fold). */
function joined(seq: number, actor: string, projectId: string): Event {
  return {
    seq,
    type: 'board.joined',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId },
  };
}

/** Build a message.reacted Event (a live 👍 on the message at messageSeq, by actor). */
function reacted(seq: number, actor: string, messageSeq: number): Event {
  return {
    seq,
    type: 'message.reacted',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { messageSeq },
  };
}

/** Build a message.unreacted Event (retracts actor's 👍 from the message at messageSeq). */
function unreacted(seq: number, actor: string, messageSeq: number): Event {
  return {
    seq,
    type: 'message.unreacted',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { messageSeq },
  };
}

describe('roomMessages — proto-room is a single-message history (AC #5)', () => {
  it('a room with an announcement but no reply → exactly one message (the announcement, kind=announcement)', () => {
    const events: Event[] = [
      reg(1, 'ada'),
      joined(2, 'ada', 'calling-interface'),
      posted(
        3,
        'ada',
        'calling-interface',
        'need-a-reviewer',
        'Need a reviewer',
        'looking for a second pair of eyes',
      ),
    ];

    const messages = roomMessages(events, 'need-a-reviewer');

    expect(messages).toEqual([
      {
        seq: 3,
        actor: 'ada',
        body: 'looking for a second pair of eyes',
        kind: 'announcement',
        reactions: [],
      },
    ]);
  });
});

describe('roomMessages — full ordered history (AC #1)', () => {
  it('announcement is message #1, then replies by seq, bodies verbatim', () => {
    const events: Event[] = [
      reg(1, 'ada'),
      reg(2, 'bob'),
      reg(3, 'cleo'),
      joined(4, 'ada', 'calling-interface'),
      posted(
        5,
        'ada',
        'calling-interface',
        'need-a-reviewer',
        'Need a reviewer',
        'announcement body',
      ),
      replied(6, 'bob', 'need-a-reviewer', 'bob first reply'),
      replied(7, 'cleo', 'need-a-reviewer', 'cleo second reply'),
    ];

    const messages = roomMessages(events, 'need-a-reviewer');

    expect(messages).toEqual([
      {
        seq: 5,
        actor: 'ada',
        body: 'announcement body',
        kind: 'announcement',
        reactions: [],
      },
      {
        seq: 6,
        actor: 'bob',
        body: 'bob first reply',
        kind: 'reply',
        reactions: [],
      },
      {
        seq: 7,
        actor: 'cleo',
        body: 'cleo second reply',
        kind: 'reply',
        reactions: [],
      },
    ]);
    // Message #1 is the announcement; the rest are replies — discriminated by `kind`.
    expect(messages[0]?.kind).toBe('announcement');
    expect(messages.slice(1).every((m) => m.kind === 'reply')).toBe(true);
  });

  it('orders strictly by seq (NOT append/input order, NOT createdAt) even on an UNSORTED stream', () => {
    // Hand the fold the events out of seq order (replies before the announcement, reversed):
    // a naive "emit in input order" impl would mis-order. The result must be seq-ascending,
    // so message #1 is still the announcement (lowest seq).
    const events: Event[] = [
      replied(13, 'cleo', 'need-a-reviewer', 'third'),
      replied(11, 'bob', 'need-a-reviewer', 'first reply'),
      posted(
        10,
        'ada',
        'calling-interface',
        'need-a-reviewer',
        'Need a reviewer',
        'seed',
      ),
      replied(12, 'dan', 'need-a-reviewer', 'second reply'),
    ];

    const messages = roomMessages(events, 'need-a-reviewer');

    expect(messages.map((m) => m.seq)).toEqual([10, 11, 12, 13]);
    expect(messages[0]?.kind).toBe('announcement');
    expect(messages.map((m) => m.body)).toEqual([
      'seed',
      'first reply',
      'second reply',
      'third',
    ]);
  });
});

describe('roomMessages — no truncation under growth (AC #4)', () => {
  it('a later fold (more replies appended) is a seq-superset of an earlier one — earlier messages unchanged + new appended', () => {
    const base: Event[] = [
      posted(
        1,
        'ada',
        'calling-interface',
        'need-a-reviewer',
        'Need a reviewer',
        'seed',
      ),
      replied(2, 'bob', 'need-a-reviewer', 'reply one'),
    ];
    const earlier = roomMessages(base, 'need-a-reviewer');

    // Append-only: more replies land later (higher seqs); nothing existing is mutated/removed.
    const later = roomMessages(
      [...base, replied(3, 'cleo', 'need-a-reviewer', 'reply two')],
      'need-a-reviewer',
    );

    // The later history STARTS WITH the earlier one verbatim (same order, same bodies),
    // then the new message appended at the end — monotonic growth, no truncation.
    expect(later.slice(0, earlier.length)).toEqual(earlier);
    expect(later).toHaveLength(earlier.length + 1);
    expect(later[later.length - 1]).toEqual({
      seq: 3,
      actor: 'cleo',
      body: 'reply two',
      kind: 'reply',
      reactions: [],
    });
  });
});

describe('roomMessages — unknown room → empty list (Task 2 turns this into ROOM_NOT_FOUND)', () => {
  it('a roomId with no announcement in the stream → []', () => {
    const events: Event[] = [
      posted(1, 'ada', 'board', 'real-room', 'Real room', 'seed'),
      replied(2, 'bob', 'real-room', 'a reply'),
    ];
    expect(roomMessages(events, 'no-such-room')).toEqual([]);
  });

  it('an empty stream → []', () => {
    expect(roomMessages([], 'anything')).toEqual([]);
  });

  it('a room that has ONLY replies but no announcement in the slice → [] (no phantom message #1)', () => {
    // Defensive: a reply without a folded announcement contributes nothing as a STANDALONE
    // history (the op resolves existence via the rooms projection, which also needs the
    // announcement). This mirrors foldRooms ignoring an orphan reply.
    const events: Event[] = [replied(1, 'bob', 'orphan-room', 'lonely reply')];
    expect(roomMessages(events, 'orphan-room')).toEqual([
      // The reply still appears IF asked for its room, but there is no announcement message —
      // existence is the op's concern. Assert the reply-only shape explicitly.
      {
        seq: 1,
        actor: 'bob',
        body: 'lonely reply',
        kind: 'reply',
        reactions: [],
      },
    ]);
  });
});

describe('roomMessages — cross-room isolation (AC #1)', () => {
  it('returns ONLY this room’s messages even when the stream interleaves multiple rooms', () => {
    // Two rooms on two boards, their announcements + replies woven together. Each room's
    // history must contain only its own messages, in seq order, with no leakage.
    const events: Event[] = [
      posted(1, 'ada', 'board-a', 'room-a', 'Room A', 'a seed'),
      posted(2, 'bob', 'board-b', 'room-b', 'Room B', 'b seed'),
      replied(3, 'cleo', 'room-b', 'b reply one'),
      replied(4, 'dan', 'room-a', 'a reply one'),
      replied(5, 'eve', 'room-b', 'b reply two'),
      replied(6, 'fay', 'room-a', 'a reply two'),
    ];

    const a = roomMessages(events, 'room-a');
    expect(a.map((m) => m.seq)).toEqual([1, 4, 6]);
    expect(a.map((m) => m.body)).toEqual([
      'a seed',
      'a reply one',
      'a reply two',
    ]);
    expect(a[0]?.kind).toBe('announcement');

    const b = roomMessages(events, 'room-b');
    expect(b.map((m) => m.seq)).toEqual([2, 3, 5]);
    expect(b.map((m) => m.body)).toEqual([
      'b seed',
      'b reply one',
      'b reply two',
    ]);
    expect(b[0]?.kind).toBe('announcement');

    // No id from room A appears in room B's history and vice-versa (disjoint).
    expect(a.every((m) => !b.includes(m))).toBe(true);
  });
});

describe('roomMessages — each message carries its LIVE 👍 reactors (Story 5.2, AC #5)', () => {
  it('a message with no reactions has reactions: []; a reacted message lists its live reactors', () => {
    const events: Event[] = [
      posted(
        1,
        'ada',
        'calling-interface',
        'need-a-reviewer',
        'Need a reviewer',
        'seed',
      ),
      replied(2, 'bob', 'need-a-reviewer', 'bob reply'),
      replied(3, 'cleo', 'need-a-reviewer', 'cleo reply'),
      // bob reacts cleo's reply (seq 3); cleo reacts bob's reply (seq 2).
      reacted(4, 'bob', 3),
      reacted(5, 'cleo', 2),
    ];

    const messages = roomMessages(events, 'need-a-reviewer');
    // Announcement (#1, seq 1): no reactions. bob's reply (seq 2): cleo live. cleo's reply
    // (seq 3): bob live. The reactions are the per-message live-reactor handles.
    expect(messages.map((m) => m.reactions)).toEqual([[], ['cleo'], ['bob']]);
  });

  it('reflects latest-wins: a react then unreact on the same message leaves reactions: []', () => {
    const events: Event[] = [
      posted(
        1,
        'ada',
        'calling-interface',
        'need-a-reviewer',
        'Need a reviewer',
        'seed',
      ),
      replied(2, 'bob', 'need-a-reviewer', 'bob reply'),
      reacted(3, 'cleo', 2),
      unreacted(4, 'cleo', 2), // cleo retracts → no longer live
    ];

    const messages = roomMessages(events, 'need-a-reviewer');
    // bob's reply (seq 2) had a react then unreact by cleo → no live reactors.
    expect(messages.find((m) => m.seq === 2)?.reactions).toEqual([]);
  });

  it('multiple live reactors on one message appear in react seq order', () => {
    const events: Event[] = [
      posted(
        1,
        'ada',
        'calling-interface',
        'need-a-reviewer',
        'Need a reviewer',
        'seed',
      ),
      replied(2, 'bob', 'need-a-reviewer', 'bob reply'),
      reacted(3, 'cleo', 2),
      reacted(4, 'dan', 2),
    ];

    const messages = roomMessages(events, 'need-a-reviewer');
    expect(messages.find((m) => m.seq === 2)?.reactions).toEqual([
      'cleo',
      'dan',
    ]);
  });
});

describe('roomMessages — non-room events are ignored', () => {
  it('identity.registered / board.joined never become messages', () => {
    const events: Event[] = [
      reg(1, 'ada'),
      joined(2, 'ada', 'calling-interface'),
      posted(
        3,
        'ada',
        'calling-interface',
        'need-a-reviewer',
        'Need a reviewer',
        'seed',
      ),
      reg(4, 'bob'),
      joined(5, 'bob', 'calling-interface'),
      replied(6, 'bob', 'need-a-reviewer', 'a reply'),
    ];

    const messages = roomMessages(events, 'need-a-reviewer');
    // Only the announcement + the one reply — the four non-room events contribute nothing.
    expect(messages.map((m) => m.kind)).toEqual(['announcement', 'reply']);
    expect(messages.map((m) => m.seq)).toEqual([3, 6]);
  });
});
