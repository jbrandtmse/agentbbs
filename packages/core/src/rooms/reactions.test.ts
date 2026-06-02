// Reactions projection + message-resolver unit tests (Story 5.2, Task 2 / AC #1, #2, #3).
//
// Pure folds over a hand-built, `seq`-ordered Event stream (mirrors participants.test.ts /
// room-history.test.ts). No I/O. Three pure functions are pinned here:
//
//   - `liveReactors(events, messageSeq)` — the LIVE 👍 reactors of a message, derived by
//     latest-react-wins per actor (an actor is live iff their LATEST message.reacted /
//     message.unreacted for that messageSeq is a `react`), returned in the `seq` order of each
//     live actor's current (live) react. This is the projection Story 5.3's contract reads.
//   - `hasLiveReaction(events, messageSeq, actor)` — the single-actor convenience.
//   - `findMessage(events, messageSeq)` — resolve the event at `messageSeq` to a message IFF
//     its type is `announcement.posted` / `room.replied` (returns its `roomId` for the
//     react/unreact participation gate); `undefined` otherwise (drives MESSAGE_NOT_FOUND).
//
// What is proven (DERIVED state, never stored — THE APPEND INVARIANT):
//   - react → live includes the actor; react then unreact → not live; unreact then re-react →
//     live again (LATEST wins); two actors independent (A's unreact leaves B live);
//   - no reactions → empty; ordering by the live react's `seq`; only the named messageSeq's
//     reactions count (cross-message isolation);
//   - findMessage resolves an announcement / a reply (→ its roomId), and is `undefined` for a
//     non-message seq, a missing seq, and a non-room event type.

import { describe, expect, it } from 'vitest';

import { findMessage, hasLiveReaction, liveReactors } from './reactions.js';

import type { Event } from '../events/event.js';

/** Build an announcement.posted Event (mints a proto-room — a message, message #1). */
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

/** Build a room.replied Event (a reply IS a message). */
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

/** Build a message.reacted Event (actor places a 👍 on the message at messageSeq). */
function reacted(seq: number, actor: string, messageSeq: number): Event {
  return {
    seq,
    type: 'message.reacted',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { messageSeq },
  };
}

/** Build a message.unreacted Event (actor retracts their 👍 from the message at messageSeq). */
function unreacted(seq: number, actor: string, messageSeq: number): Event {
  return {
    seq,
    type: 'message.unreacted',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { messageSeq },
  };
}

/** Build an unrelated identity.registered Event (must be ignored by the reaction fold). */
function reg(seq: number, handle: string): Event {
  return {
    seq,
    type: 'identity.registered',
    actor: handle,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { handle, currentFocus: 'x' },
  };
}

describe('liveReactors — latest-react-wins per actor (AC #1)', () => {
  it('react → the actor is a live reactor', () => {
    const events: Event[] = [
      replied(1, 'bob', 'room', 'a message'),
      reacted(2, 'ada', 1),
    ];
    expect(liveReactors(events, 1)).toEqual(['ada']);
    expect(hasLiveReaction(events, 1, 'ada')).toBe(true);
    expect(hasLiveReaction(events, 1, 'bob')).toBe(false);
  });

  it('react then unreact (same actor) → NOT live (latest is the unreact)', () => {
    const events: Event[] = [
      replied(1, 'bob', 'room', 'a message'),
      reacted(2, 'ada', 1),
      unreacted(3, 'ada', 1),
    ];
    expect(liveReactors(events, 1)).toEqual([]);
    expect(hasLiveReaction(events, 1, 'ada')).toBe(false);
  });

  it('unreact then re-react (same actor) → live again (LATEST react wins)', () => {
    const events: Event[] = [
      replied(1, 'bob', 'room', 'a message'),
      reacted(2, 'ada', 1),
      unreacted(3, 'ada', 1),
      reacted(4, 'ada', 1),
    ];
    expect(liveReactors(events, 1)).toEqual(['ada']);
    expect(hasLiveReaction(events, 1, 'ada')).toBe(true);
  });

  it('a leading unreact with no prior react → NOT live (latest is the unreact)', () => {
    // A defensive no-op unreact (the op layer prevents this, but the projection must be robust):
    // an unreact with no preceding react still leaves the actor NOT live.
    const events: Event[] = [
      replied(1, 'bob', 'room', 'a message'),
      unreacted(2, 'ada', 1),
    ];
    expect(liveReactors(events, 1)).toEqual([]);
    expect(hasLiveReaction(events, 1, 'ada')).toBe(false);
  });
});

describe('liveReactors — two actors independent (AC #2 — cannot-retract-another)', () => {
  it("A's unreact leaves B's live 👍 intact", () => {
    const events: Event[] = [
      replied(1, 'cleo', 'room', 'a message'),
      reacted(2, 'ada', 1),
      reacted(3, 'bob', 1),
      unreacted(4, 'ada', 1),
    ];
    // ada retracted only her own; bob is still live.
    expect(liveReactors(events, 1)).toEqual(['bob']);
    expect(hasLiveReaction(events, 1, 'ada')).toBe(false);
    expect(hasLiveReaction(events, 1, 'bob')).toBe(true);
  });

  it('the AC #5 sequence: A reacts → [A]; B reacts → [A, B]; A unreacts → [B]', () => {
    const base: Event[] = [replied(1, 'cleo', 'room', 'a message')];
    const afterA = [...base, reacted(2, 'ada', 1)];
    expect(liveReactors(afterA, 1)).toEqual(['ada']);

    const afterB = [...afterA, reacted(3, 'bob', 1)];
    expect(liveReactors(afterB, 1)).toEqual(['ada', 'bob']);

    const afterAUnreact = [...afterB, unreacted(4, 'ada', 1)];
    expect(liveReactors(afterAUnreact, 1)).toEqual(['bob']);
  });
});

describe('liveReactors — ordering by each live actor’s current (live) react seq', () => {
  it('orders live reactors by the seq of their currently-live react', () => {
    const events: Event[] = [
      replied(1, 'zed', 'room', 'a message'),
      reacted(2, 'ada', 1),
      reacted(3, 'bob', 1),
      reacted(4, 'cleo', 1),
    ];
    expect(liveReactors(events, 1)).toEqual(['ada', 'bob', 'cleo']);
  });

  it('a re-react re-orders the actor to the seq of the NEW (live) react, not the original', () => {
    // ada reacts first (seq 2), bob reacts (seq 3), ada unreacts (seq 4) then re-reacts (seq 5):
    // ada's CURRENT live react is seq 5 (> bob's seq 3), so ada orders AFTER bob now.
    const events: Event[] = [
      replied(1, 'zed', 'room', 'a message'),
      reacted(2, 'ada', 1),
      reacted(3, 'bob', 1),
      unreacted(4, 'ada', 1),
      reacted(5, 'ada', 1),
    ];
    expect(liveReactors(events, 1)).toEqual(['bob', 'ada']);
  });

  it('is order-independent of the INPUT stream ordering (computes by seq, not array position)', () => {
    // Hand the fold the reaction events out of seq order — the result must be seq-correct.
    const events: Event[] = [
      reacted(4, 'cleo', 1),
      reacted(2, 'ada', 1),
      replied(1, 'zed', 'room', 'a message'),
      reacted(3, 'bob', 1),
    ];
    expect(liveReactors(events, 1)).toEqual(['ada', 'bob', 'cleo']);
  });
});

describe('liveReactors — empty / isolation', () => {
  it('no reactions → empty list', () => {
    const events: Event[] = [replied(1, 'bob', 'room', 'a message')];
    expect(liveReactors(events, 1)).toEqual([]);
    expect(hasLiveReaction(events, 1, 'anyone')).toBe(false);
  });

  it('an empty stream → empty list', () => {
    expect(liveReactors([], 1)).toEqual([]);
    expect(hasLiveReaction([], 1, 'ada')).toBe(false);
  });

  it('only the named messageSeq’s reactions count — cross-message isolation', () => {
    // Two messages (seq 1 and seq 2). Reactions on each must not bleed into the other.
    const events: Event[] = [
      replied(1, 'bob', 'room', 'message one'),
      replied(2, 'cleo', 'room', 'message two'),
      reacted(3, 'ada', 1), // → message 1
      reacted(4, 'eve', 2), // → message 2
      unreacted(5, 'ada', 2), // a stray unreact on message 2 for ada (no live react there)
    ];
    expect(liveReactors(events, 1)).toEqual(['ada']);
    expect(liveReactors(events, 2)).toEqual(['eve']);
    // ada is live on message 1, NOT on message 2 (her unreact there had no live react).
    expect(hasLiveReaction(events, 1, 'ada')).toBe(true);
    expect(hasLiveReaction(events, 2, 'ada')).toBe(false);
  });
});

describe('findMessage — resolves a message to its room (AC #1, #2) or undefined (AC #3)', () => {
  it('resolves a room.replied at messageSeq → its roomId / actor / kind=reply', () => {
    const events: Event[] = [
      posted(1, 'ada', 'board', 'a-room', 'Subject', 'announce body'),
      replied(2, 'bob', 'a-room', 'a reply'),
    ];
    expect(findMessage(events, 2)).toEqual({
      messageSeq: 2,
      roomId: 'a-room',
      actor: 'bob',
      kind: 'reply',
    });
  });

  it('resolves an announcement.posted at messageSeq (message #1) → its roomId / actor / kind=announcement', () => {
    const events: Event[] = [
      posted(1, 'ada', 'board', 'a-room', 'Subject', 'announce body'),
    ];
    expect(findMessage(events, 1)).toEqual({
      messageSeq: 1,
      roomId: 'a-room',
      actor: 'ada',
      kind: 'announcement',
    });
  });

  it('a seq with NO event → undefined (drives MESSAGE_NOT_FOUND)', () => {
    const events: Event[] = [
      posted(1, 'ada', 'board', 'a-room', 'Subject', 'body'),
      replied(2, 'bob', 'a-room', 'reply'),
    ];
    expect(findMessage(events, 99)).toBeUndefined();
    expect(findMessage([], 1)).toBeUndefined();
  });

  it('a seq whose event is NOT a message (e.g. identity.registered, board.joined) → undefined', () => {
    const events: Event[] = [
      reg(1, 'ada'),
      posted(2, 'ada', 'board', 'a-room', 'Subject', 'body'),
    ];
    // seq 1 is an identity.registered — not a message.
    expect(findMessage(events, 1)).toBeUndefined();
    // seq 2 IS a message (the announcement).
    expect(findMessage(events, 2)).toMatchObject({
      messageSeq: 2,
      roomId: 'a-room',
      kind: 'announcement',
    });
  });
});
