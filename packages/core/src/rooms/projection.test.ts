// Rooms-projection unit tests (Story 4.1, Task 4 / AC #1).
//
// Pins the pure fold of `announcement.posted` into proto-room records: the record shape
// (roomId / projectId / subject / body / postedBy / seq / active=false), `findRoom`
// miss → undefined, multiple rooms keyed by roomId in `seq` order, and that NON-room or
// non-announcement events are ignored (only `announcement.posted` mints a record). No
// I/O — a pure fold over a hand-built, `seq`-ordered Event stream.

import { describe, expect, it } from 'vitest';

import { findRoom, foldRooms } from './projection.js';

import type { Event } from '../events/event.js';

/** Build an announcement.posted Event. */
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

describe('foldRooms — proto-room folds (AC #1)', () => {
  it('folds one announcement.posted into a proto-room record (active=false)', () => {
    const events = [
      reg(1, 'ada'),
      posted(
        2,
        'ada',
        'calling-interface',
        'calling-interface',
        'Calling Interface',
        'need a hand',
      ),
    ];

    const room = findRoom(events, 'calling-interface');
    expect(room).toEqual({
      roomId: 'calling-interface',
      projectId: 'calling-interface',
      subject: 'Calling Interface',
      body: 'need a hand',
      postedBy: 'ada',
      seq: 2,
      active: false,
    });
  });

  it('keys rooms by roomId and preserves seq order across multiple announcements', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'a',
      ),
      posted(
        2,
        'bob',
        'board-a',
        'calling-interface-2',
        'Calling Interface',
        'b',
      ),
      posted(3, 'cleo', 'board-b', 'wire-mapping', 'Wire Mapping', 'c'),
    ];

    const dir = foldRooms(events);
    expect([...dir.keys()]).toEqual([
      'calling-interface',
      'calling-interface-2',
      'wire-mapping',
    ]);
    // seq carried per record, in announcement order.
    expect([...dir.values()].map((r) => r.seq)).toEqual([1, 2, 3]);
    // Distinct rooms for the same subject (disambiguated ids) keep distinct bodies/actors.
    expect(dir.get('calling-interface')?.postedBy).toBe('ada');
    expect(dir.get('calling-interface-2')?.postedBy).toBe('bob');
    expect(dir.get('calling-interface')?.body).toBe('a');
    expect(dir.get('calling-interface-2')?.body).toBe('b');
  });

  it('first announcement wins the record (a defensive duplicate roomId does not clobber)', () => {
    // The op's room_id guard forbids a real duplicate; this proves the fold is
    // defensive — a stray second announcement for the same roomId keeps the first.
    const events = [
      posted(1, 'ada', 'board-a', 'dup', 'First', 'first body'),
      posted(2, 'bob', 'board-b', 'dup', 'Second', 'second body'),
    ];
    const room = findRoom(events, 'dup');
    expect(room?.subject).toBe('First');
    expect(room?.body).toBe('first body');
    expect(room?.postedBy).toBe('ada');
    expect(room?.seq).toBe(1);
  });

  it('ignores non-announcement events (only announcement.posted mints a room)', () => {
    const events = [reg(1, 'ada'), reg(2, 'bob')];
    expect(foldRooms(events).size).toBe(0);
  });
});

describe('findRoom — single lookup (AC #1)', () => {
  it('returns undefined for a room id that was never posted', () => {
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
    expect(findRoom(events, 'no-such-room')).toBeUndefined();
  });

  it('returns undefined from an empty stream', () => {
    expect(findRoom([], 'anything')).toBeUndefined();
  });
});
