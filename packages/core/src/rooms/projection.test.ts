// Rooms-projection unit tests (Story 4.1, Task 4 / AC #1; activation read-model: Story 4.2).
//
// Pins the pure fold of `announcement.posted` into proto-room records: the record shape
// (roomId / projectId / subject / body / postedBy / seq / active=false), `findRoom`
// miss → undefined, multiple rooms keyed by roomId in `seq` order, and that NON-room or
// non-announcement events are ignored (only `announcement.posted` mints a record). No
// I/O — a pure fold over a hand-built, `seq`-ordered Event stream.
//
// Story 4.2 adds the ACTIVATION read-model coverage: a `room.replied` flips its room's
// `active` to `true` (existence-of-reply); a room with no reply stays `false`; multiple
// replies keep it active (idempotent); a `room.replied` for an unknown room is ignored
// (mints no phantom room, flips nothing).
//
// Story 4.3 adds the ACTIVATOR read-model coverage: the MIN-`seq` `room.replied` for a
// room is its activator, exposed as `activatedBy`/`activatedAtSeq` (undefined for a
// proto-room). Because the fold consumes events in `seq` order, the FIRST reply seen sets
// the activator once and a later (higher-`seq`) reply never overwrites it — even when the
// stream interleaves replies across rooms.

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

/** Build a room.replied Event (the activating reply — Story 4.2 folds its existence). */
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

describe('foldRooms — activation read-model (Story 4.2, AC #1)', () => {
  it('a room with a folded room.replied is active (active=true)', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'need a hand',
      ),
      replied(2, 'bob', 'calling-interface', 'on it'),
    ];
    const room = findRoom(events, 'calling-interface');
    expect(room?.active).toBe(true);
    // Activation does NOT disturb the announcement-derived fields (subject/body/postedBy/seq).
    expect(room).toMatchObject({
      roomId: 'calling-interface',
      subject: 'Calling Interface',
      body: 'need a hand',
      postedBy: 'ada',
      seq: 1,
    });
  });

  it('a room with no reply stays inactive (active=false)', () => {
    const events = [
      posted(1, 'ada', 'board-a', 'proto', 'Proto', 'x'),
      // A reply to a DIFFERENT room must not activate this one.
      posted(2, 'bob', 'board-a', 'other', 'Other', 'y'),
      replied(3, 'cleo', 'other', 'activating other'),
    ];
    expect(findRoom(events, 'proto')?.active).toBe(false);
    expect(findRoom(events, 'other')?.active).toBe(true);
  });

  it('multiple replies keep the room active (idempotent flip)', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'first reply'),
      replied(3, 'cleo', 'calling-interface', 'second reply'),
      replied(4, 'ada', 'calling-interface', 'third reply'),
    ];
    expect(findRoom(events, 'calling-interface')?.active).toBe(true);
  });

  it('a room.replied for an unknown room is ignored (mints no phantom, flips nothing)', () => {
    const events = [
      posted(1, 'ada', 'board-a', 'real-room', 'Real Room', 'x'),
      // No announcement for "ghost-room" was ever folded — the reply is defensively ignored.
      replied(2, 'bob', 'ghost-room', 'reply to a non-existent room'),
    ];
    const dir = foldRooms(events);
    // No phantom room minted; the only record is the real proto-room, still inactive.
    expect([...dir.keys()]).toEqual(['real-room']);
    expect(dir.get('real-room')?.active).toBe(false);
    expect(findRoom(events, 'ghost-room')).toBeUndefined();
  });
});

describe('foldRooms — activator read-model (Story 4.3, AC #1, #4)', () => {
  it('a proto-room (no reply) has activatedBy/activatedAtSeq undefined', () => {
    const events = [
      posted(1, 'ada', 'board-a', 'proto', 'Proto', 'need a hand'),
    ];
    const room = findRoom(events, 'proto');
    expect(room?.active).toBe(false);
    expect(room?.activatedBy).toBeUndefined();
    expect(room?.activatedAtSeq).toBeUndefined();
  });

  it('the first reply sets the activator to that reply (handle + its seq)', () => {
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
    const room = findRoom(events, 'calling-interface');
    expect(room?.active).toBe(true);
    expect(room?.activatedBy).toBe('bob');
    expect(room?.activatedAtSeq).toBe(2);
  });

  it('a second (higher-seq) reply leaves the activator unchanged (still the first), room stays active', () => {
    const events = [
      posted(
        1,
        'ada',
        'board-a',
        'calling-interface',
        'Calling Interface',
        'x',
      ),
      replied(2, 'bob', 'calling-interface', 'first reply (the activator)'),
      replied(3, 'cleo', 'calling-interface', 'second reply'),
      replied(4, 'ada', 'calling-interface', 'third reply'),
    ];
    const room = findRoom(events, 'calling-interface');
    expect(room?.active).toBe(true);
    // The MIN-seq reply is the activator; later replies never overwrite it.
    expect(room?.activatedBy).toBe('bob');
    expect(room?.activatedAtSeq).toBe(2);
  });

  it('the activator is the LOWEST-seq reply even when replies interleave across rooms', () => {
    // A single seq-ordered stream with two rooms whose replies are interleaved. Each
    // room's activator must be its own MIN-seq reply, independent of the other room.
    const events = [
      posted(1, 'ada', 'board-a', 'room-a', 'Room A', 'a'),
      posted(2, 'ada', 'board-a', 'room-b', 'Room B', 'b'),
      // room-b is replied to FIRST (seq 3), then room-a (seq 4), then more, interleaved.
      replied(3, 'bob', 'room-b', 'b activator'),
      replied(4, 'cleo', 'room-a', 'a activator'),
      replied(5, 'dave', 'room-b', 'b second'),
      replied(6, 'erin', 'room-a', 'a second'),
    ];
    const a = findRoom(events, 'room-a');
    const b = findRoom(events, 'room-b');
    expect(a?.activatedBy).toBe('cleo');
    expect(a?.activatedAtSeq).toBe(4);
    expect(b?.activatedBy).toBe('bob');
    expect(b?.activatedAtSeq).toBe(3);
    expect(a?.active).toBe(true);
    expect(b?.active).toBe(true);
  });
});
