// `readRoom` board-read tests (Story 4.4, Task 2 / AC #1, #2, #3, #5).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included — from
// importing @agentbbs/data-access), so these drive `readRoom` against an IN-MEMORY DataAccess
// fake. The fake models the one contract `readRoom` relies on: eventsSince(0) returns ALL
// events, seq-ordered. `readRoom` is a thin read over `findRoom` (existence → ROOM_NOT_FOUND)
// + `roomMessages` (the ordered history), so the tests pin the WIRING:
//   - an activated room → the room record + the ordered messages (announcement #1, replies);
//   - a proto-room → the room record (active=false) + a SINGLE announcement message (AC #5);
//   - an unknown room → ROOM_NOT_FOUND (AC #3);
//   - no truncation across a re-read after another reply (AC #4 at the op layer).
// The fold + ordering are exhaustively tested in room-history.test.ts; the rooms projection
// in projection.test.ts. Here we prove the existence-check + assemble-the-RoomHistory wiring.

import { describe, expect, it } from 'vitest';

import { readRoom } from './read-room.js';
import { BoardError } from '../errors.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * A minimal in-memory DataAccess exposing the seq-ordered event stream `readRoom` consumes.
 * `append` assigns a monotonic seq + stamps createdAt; `eventsSince(cursor)` returns events
 * with seq > cursor, seq-ordered. Other port methods are present (interface conformance) but
 * unused by this read.
 */
function memoryDataAccess(): DataAccess {
  let seq = 0;
  const store: Event[] = [];

  const appendAll = (events: NewEvent[]): number[] => {
    const createdAt = new Date().toISOString();
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
      Promise.resolve(store.filter((e) => e.type === type)),
    eventsByActor: (actor) =>
      Promise.resolve(store.filter((e) => e.actor === actor)),
    maxSeq: () => Promise.resolve(seq),
  };
}

/** Announce a board the way `announceProject` does: project.announced + the announcer's board.joined. */
async function announce(
  da: DataAccess,
  actor: string,
  projectId: string,
): Promise<void> {
  await da.append([
    {
      type: 'project.announced',
      actor,
      payload: {
        projectId,
        title: projectId,
        description: `the ${projectId} board`,
      },
    },
    { type: 'board.joined', actor, payload: { projectId } },
  ]);
}

/** Post an announcement (open a proto-room) the way `postAnnouncement` does. */
async function post(
  da: DataAccess,
  actor: string,
  projectId: string,
  roomId: string,
  subject: string,
  body: string,
): Promise<void> {
  await da.append([
    {
      type: 'announcement.posted',
      actor,
      payload: { projectId, roomId, subject, body },
    },
  ]);
}

/** Seed a reply (a message; the first activates the room) directly through the port. */
async function reply(
  da: DataAccess,
  actor: string,
  roomId: string,
  body: string,
): Promise<void> {
  await da.append([{ type: 'room.replied', actor, payload: { roomId, body } }]);
}

describe('readRoom — activated room → metadata + ordered history (AC #1)', () => {
  it('returns the room record and the messages [announcement #1, reply, reply] by seq', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'calling-interface');
    await post(
      da,
      'ada',
      'calling-interface',
      'need-a-reviewer',
      'Need a reviewer',
      'looking for a second pair of eyes',
    );
    await reply(da, 'bob', 'need-a-reviewer', 'I can take a look');
    await reply(da, 'cleo', 'need-a-reviewer', 'me too');

    const { room, messages } = await readRoom(da, 'need-a-reviewer');

    // Room metadata: subject is room-level (carried ONCE here), the room is active, and the
    // activator is the min-seq reply (bob).
    expect(room).toMatchObject({
      roomId: 'need-a-reviewer',
      projectId: 'calling-interface',
      subject: 'Need a reviewer',
      body: 'looking for a second pair of eyes',
      postedBy: 'ada',
      active: true,
      activatedBy: 'bob',
    });

    // The ordered history: announcement (#1, its BODY — not the subject), then the two
    // replies by seq, bodies verbatim.
    expect(messages).toEqual([
      {
        seq: room.seq,
        actor: 'ada',
        body: 'looking for a second pair of eyes',
        kind: 'announcement',
      },
      {
        seq: room.activatedAtSeq,
        actor: 'bob',
        body: 'I can take a look',
        kind: 'reply',
      },
      {
        seq: room.activatedAtSeq! + 1,
        actor: 'cleo',
        body: 'me too',
        kind: 'reply',
      },
    ]);
    // Message #1 is the announcement, identified by the room's announcement seq.
    expect(messages[0]?.kind).toBe('announcement');
    expect(messages[0]?.seq).toBe(room.seq);
  });
});

describe('readRoom — proto-room → single-message history, active=false (AC #5)', () => {
  it('returns the room record (active=false, no activator) + exactly one announcement message', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'calling-interface');
    await post(
      da,
      'ada',
      'calling-interface',
      'need-a-reviewer',
      'Need a reviewer',
      'seed body',
    );

    const { room, messages } = await readRoom(da, 'need-a-reviewer');

    // A proto-room is readable (FR9) — its metadata shows active=false, no activator.
    expect(room.active).toBe(false);
    expect(room.activatedBy).toBeUndefined();
    expect(room.activatedAtSeq).toBeUndefined();

    // Exactly one message: the seeding announcement (its body, kind=announcement).
    expect(messages).toEqual([
      { seq: room.seq, actor: 'ada', body: 'seed body', kind: 'announcement' },
    ]);
  });
});

describe('readRoom — unknown room → ROOM_NOT_FOUND (AC #3)', () => {
  it('throws ROOM_NOT_FOUND (a BoardError) for a room that was never announced', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'calling-interface');
    await post(
      da,
      'ada',
      'calling-interface',
      'real-room',
      'Real room',
      'seed',
    );

    await expect(readRoom(da, 'no-such-room')).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND',
    });
    await expect(readRoom(da, 'no-such-room')).rejects.toBeInstanceOf(
      BoardError,
    );
  });

  it('an empty ledger → ROOM_NOT_FOUND (no room exists at all)', async () => {
    const da = memoryDataAccess();
    await expect(readRoom(da, 'anything')).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND',
    });
  });
});

describe('readRoom — no truncation across a re-read (AC #4)', () => {
  it('re-reading after another reply returns the SAME earlier messages plus the new one appended', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'calling-interface');
    await post(
      da,
      'ada',
      'calling-interface',
      'need-a-reviewer',
      'Need a reviewer',
      'seed',
    );
    await reply(da, 'bob', 'need-a-reviewer', 'first');

    const first = await readRoom(da, 'need-a-reviewer');
    expect(first.messages.map((m) => m.body)).toEqual(['seed', 'first']);

    // Another reply lands (append-only); re-read.
    await reply(da, 'cleo', 'need-a-reviewer', 'second');
    const second = await readRoom(da, 'need-a-reviewer');

    // The re-read STARTS WITH the earlier messages verbatim, then the new one appended.
    expect(second.messages.slice(0, first.messages.length)).toEqual(
      first.messages,
    );
    expect(second.messages).toHaveLength(first.messages.length + 1);
    expect(second.messages[second.messages.length - 1]).toMatchObject({
      actor: 'cleo',
      body: 'second',
      kind: 'reply',
    });
  });
});

describe('readRoom — cross-room isolation (AC #1)', () => {
  it('returns only the requested room’s metadata + messages, not another room’s', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'board');
    await post(da, 'ada', 'board', 'room-a', 'Room A', 'a seed');
    await post(da, 'ada', 'board', 'room-b', 'Room B', 'b seed');
    await reply(da, 'bob', 'room-a', 'a reply');
    await reply(da, 'cleo', 'room-b', 'b reply');

    const a = await readRoom(da, 'room-a');
    expect(a.room.roomId).toBe('room-a');
    expect(a.messages.map((m) => m.body)).toEqual(['a seed', 'a reply']);

    const b = await readRoom(da, 'room-b');
    expect(b.room.roomId).toBe('room-b');
    expect(b.messages.map((m) => m.body)).toEqual(['b seed', 'b reply']);
  });
});
