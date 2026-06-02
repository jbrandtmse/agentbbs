// Room-participants projection unit tests (Story 4.5, Task 1 / AC #1, #4, #5).
//
// Pins the pure fold of a room's PARTICIPANTS — the set of handles that have
// `room.replied` to it UNION the handles `room.participant_added` to it, de-duplicated
// in first-seen (`seq`) order. The announcer who never replied is NOT a participant
// (participation = posted-in or pulled-in, never the mere act of announcing). No I/O — a
// pure fold over a hand-built, `seq`-ordered Event stream.
//
// Coverage:
//   - repliers are participants (a `room.replied` actor joins the set);
//   - added handles are participants (a `room.participant_added` payload `handle` joins);
//   - the announcer who never replied is NOT a participant;
//   - de-dup: a handle that BOTH replied and was added appears once, at its FIRST seq;
//   - ordering: the set is in first-seen `seq` order;
//   - cross-room isolation: only events for the queried room contribute;
//   - unknown room → empty;
//   - `isParticipant` agrees with the array (membership + the announcer-excluded case).

import { describe, expect, it } from 'vitest';

import { isParticipant, roomParticipants } from './participants.js';

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
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
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
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
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
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { roomId, handle },
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

describe('roomParticipants — the participants set (Story 4.5, AC #1, #4, #5)', () => {
  it('repliers are participants (a room.replied actor joins the set)', () => {
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
    expect(roomParticipants(events, 'calling-interface')).toEqual(['bob']);
  });

  it('the announcer who never replied is NOT a participant', () => {
    // ada announced the room but never replied to it — she is not a participant.
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
    ];
    expect(roomParticipants(events, 'calling-interface')).toEqual([]);
    expect(isParticipant(events, 'calling-interface', 'ada')).toBe(false);
  });

  it('an announcer who later replies BECOMES a participant', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'ada', 'calling-interface', 'replying to my own announcement'),
    ];
    expect(roomParticipants(events, 'calling-interface')).toEqual(['ada']);
    expect(isParticipant(events, 'calling-interface', 'ada')).toBe(true);
  });

  it('added handles are participants (a room.participant_added payload handle joins)', () => {
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
      // bob (a participant) pulls in cleo.
      added(3, 'bob', 'calling-interface', 'cleo'),
    ];
    expect(roomParticipants(events, 'calling-interface')).toEqual([
      'bob',
      'cleo',
    ]);
    expect(isParticipant(events, 'calling-interface', 'cleo')).toBe(true);
  });

  it('de-dups a handle that BOTH replied and was added (appears once, at its FIRST seq)', () => {
    // cleo is added at seq 3, then replies at seq 4 — she must appear ONCE, at first-seen.
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
      replied(4, 'cleo', 'calling-interface', 'thanks for the add'),
    ];
    expect(roomParticipants(events, 'calling-interface')).toEqual([
      'bob',
      'cleo',
    ]);
  });

  it('de-dups a handle added twice (idempotent re-add appears once)', () => {
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
      added(4, 'bob', 'calling-interface', 'cleo'),
    ];
    expect(roomParticipants(events, 'calling-interface')).toEqual([
      'bob',
      'cleo',
    ]);
  });

  it('orders participants by first-seen seq (reply-then-add interleave)', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'bob first'),
      added(3, 'bob', 'calling-interface', 'cleo'),
      replied(4, 'dave', 'calling-interface', 'dave third'),
      added(5, 'bob', 'calling-interface', 'erin'),
    ];
    expect(roomParticipants(events, 'calling-interface')).toEqual([
      'bob',
      'cleo',
      'dave',
      'erin',
    ]);
  });

  it('is isolated per room (only the queried room contributes)', () => {
    const events = [
      posted(1, 'ada', 'board-a', 'room-a', 'Room A', 'a'),
      posted(2, 'ada', 'board-a', 'room-b', 'Room B', 'b'),
      replied(3, 'bob', 'room-a', 'a'),
      replied(4, 'cleo', 'room-b', 'b'),
      added(5, 'bob', 'room-a', 'dave'),
      added(6, 'cleo', 'room-b', 'erin'),
    ];
    expect(roomParticipants(events, 'room-a')).toEqual(['bob', 'dave']);
    expect(roomParticipants(events, 'room-b')).toEqual(['cleo', 'erin']);
  });

  it('returns [] for an unknown room', () => {
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
    expect(roomParticipants(events, 'no-such-room')).toEqual([]);
    expect(roomParticipants([], 'anything')).toEqual([]);
  });

  it('ignores non-room events (identity events do not contribute)', () => {
    const events = [reg(1, 'ada'), reg(2, 'bob')];
    expect(roomParticipants(events, 'calling-interface')).toEqual([]);
  });
});

describe('isParticipant — single membership check (Story 4.5, AC #4, #5)', () => {
  it('agrees with the array for a replier and an added handle, and is false otherwise', () => {
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
    expect(isParticipant(events, 'calling-interface', 'bob')).toBe(true); // replier
    expect(isParticipant(events, 'calling-interface', 'cleo')).toBe(true); // added
    expect(isParticipant(events, 'calling-interface', 'ada')).toBe(false); // announcer-only
    expect(isParticipant(events, 'calling-interface', 'nobody')).toBe(false);
    expect(isParticipant(events, 'no-such-room', 'bob')).toBe(false);
  });
});
