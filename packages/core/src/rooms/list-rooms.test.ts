// `listAnnouncements` / `listRooms` board-read tests (Story 4.2, Task 2 / AC #1, #2, #3).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included — from
// importing @agentbbs/data-access), so these drive the two reads against an IN-MEMORY
// DataAccess fake. The fake models the one contract these reads rely on:
//   - eventsSince(0) returns ALL events, seq-ordered ascending.
// Both ops are thin reads over `foldRooms` (the activation read-model) + `findProject` (the
// existence check), so the tests pin: a proto-only board → listAnnouncements returns all,
// listRooms empty; a seeded room.replied MOVES that room from announcements to rooms; an
// unknown board → BOARD_NOT_FOUND (both ops); ordering by seq; cross-board isolation (rooms
// of board A absent from board B's lists). The fold + activation are exhaustively tested in
// projection.test.ts; here we prove the existence-check + filter + sort wiring.

import { describe, expect, it } from 'vitest';

import { listAnnouncements, listRooms } from './list-rooms.js';
import { BoardError } from '../errors.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * A minimal in-memory DataAccess exposing the seq-ordered event stream the reads consume.
 * `append` assigns a monotonic seq and stamps createdAt; `eventsSince(cursor)` returns
 * events with seq > cursor, seq-ordered. The other port methods are present (interface
 * conformance) but unused by these reads.
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
): Promise<void> {
  await da.append([
    {
      type: 'announcement.posted',
      actor,
      payload: { projectId, roomId, subject, body: `${subject} body` },
    },
  ]);
}

/** Seed a reply (activates the room) directly through the port — the reply TOOL is Story 4.3. */
async function reply(
  da: DataAccess,
  actor: string,
  roomId: string,
): Promise<void> {
  await da.append([
    { type: 'room.replied', actor, payload: { roomId, body: 'a reply' } },
  ]);
}

describe('listAnnouncements / listRooms — proto vs activated split (AC #1)', () => {
  it('a proto-only board → listAnnouncements returns all (active=false), listRooms is empty', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'calling-interface');
    await post(
      da,
      'ada',
      'calling-interface',
      'need-a-reviewer',
      'Need a reviewer',
    );
    await post(da, 'ada', 'calling-interface', 'wire-mapping', 'Wire mapping');

    const announcements = await listAnnouncements(da, 'calling-interface');
    expect(announcements.map((r) => r.roomId)).toEqual([
      'need-a-reviewer',
      'wire-mapping',
    ]);
    // Every listed announcement is a proto-room.
    expect(announcements.every((r) => r.active === false)).toBe(true);

    // No room has a reply yet → listRooms is empty (not an error).
    await expect(listRooms(da, 'calling-interface')).resolves.toEqual([]);
  });

  it('a seeded room.replied MOVES the room from listAnnouncements to listRooms', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'calling-interface');
    await post(
      da,
      'ada',
      'calling-interface',
      'need-a-reviewer',
      'Need a reviewer',
    );
    await post(da, 'ada', 'calling-interface', 'wire-mapping', 'Wire mapping');
    // Activate ONE of the two rooms by appending a reply (Story 4.3's event, seeded here).
    await reply(da, 'bob', 'need-a-reviewer');

    // The activated room is gone from announcements (still-proto only)...
    const announcements = await listAnnouncements(da, 'calling-interface');
    expect(announcements.map((r) => r.roomId)).toEqual(['wire-mapping']);

    // ...and now appears in rooms (activated only), active=true.
    const rooms = await listRooms(da, 'calling-interface');
    expect(rooms.map((r) => r.roomId)).toEqual(['need-a-reviewer']);
    expect(rooms[0]?.active).toBe(true);
  });

  it('lists are ordered by seq (announcement order), never createdAt', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'board');
    // Post three proto-rooms; their seq order is the post order.
    await post(da, 'ada', 'board', 'alpha', 'Alpha');
    await post(da, 'ada', 'board', 'beta', 'Beta');
    await post(da, 'ada', 'board', 'gamma', 'Gamma');
    // Activate all three (so they land in listRooms) — reply order is gamma, alpha, beta,
    // which must NOT change the listRooms order (it stays announcement/seq order).
    await reply(da, 'bob', 'gamma');
    await reply(da, 'bob', 'alpha');
    await reply(da, 'bob', 'beta');

    const rooms = await listRooms(da, 'board');
    // Ordered by the announcement seq, NOT by the reply order.
    expect(rooms.map((r) => r.roomId)).toEqual(['alpha', 'beta', 'gamma']);
    expect(rooms.map((r) => r.seq)).toEqual(
      [...rooms.map((r) => r.seq)].sort((a, b) => a - b),
    );
  });

  it('seq-orders both lists when announcements and replies are INTERLEAVED in the ledger', async () => {
    // QA gap (ordering under interleaving): the prior ordering test appends ALL replies
    // AFTER all posts, so a naive "rooms come out in append order" impl would still pass
    // because activation never reorders. Here posts and the activating replies are woven
    // together (post beta, reply beta, post alpha, post gamma, reply gamma, post delta) so
    // a room's announcement seq and its reply seq are NOT contiguous and the active subset
    // is not a suffix of the ledger. Each list must still be strictly announcement(seq)-
    // ordered — not insertion-, activation-, nor roomId-ordered — and a room must appear in
    // EXACTLY ONE list (proto XOR active), never both.
    const da = memoryDataAccess();
    await announce(da, 'ada', 'board');
    await post(da, 'ada', 'board', 'beta', 'Beta'); // seq of beta < alpha < gamma < delta
    await reply(da, 'bob', 'beta'); // beta activated BEFORE alpha/gamma/delta are posted
    await post(da, 'ada', 'board', 'alpha', 'Alpha');
    await post(da, 'ada', 'board', 'gamma', 'Gamma');
    await reply(da, 'cleo', 'gamma'); // gamma activated; alpha + delta stay proto
    await post(da, 'ada', 'board', 'delta', 'Delta');

    // Announcements (proto) — alpha + delta, in announcement(seq) order (alpha posted first).
    const announcements = await listAnnouncements(da, 'board');
    expect(announcements.map((r) => r.roomId)).toEqual(['alpha', 'delta']);
    expect(announcements.every((r) => r.active === false)).toBe(true);

    // Rooms (active) — beta + gamma, in announcement(seq) order (beta posted first), NOT in
    // activation order (beta then gamma here coincide, but the seq sort is what guarantees it)
    // and NOT roomId-alphabetical (that would be beta, gamma too — so prove via the seq).
    const rooms = await listRooms(da, 'board');
    expect(rooms.map((r) => r.roomId)).toEqual(['beta', 'gamma']);
    expect(rooms.every((r) => r.active === true)).toBe(true);
    // Strictly ascending seq (the real ordering guarantee — independent of every other order).
    expect(rooms.map((r) => r.seq)).toEqual(
      [...rooms.map((r) => r.seq)].sort((a, b) => a - b),
    );

    // A room is in EXACTLY ONE list — the two sets are disjoint and partition the board.
    const annIds = new Set(announcements.map((r) => r.roomId));
    const roomIds = new Set(rooms.map((r) => r.roomId));
    for (const id of roomIds) expect(annIds.has(id)).toBe(false);
    expect(annIds.size + roomIds.size).toBe(4); // all four rooms accounted for, none twice
  });

  it('a room with MULTIPLE replies appears in listRooms exactly ONCE (idempotent activation)', async () => {
    // QA gap (multiple replies → no duplication): projection.test.ts proves the active flag
    // is idempotent; this proves the LIST does not emit the room once per reply. foldRooms
    // keys by roomId (a Map), so three replies fold to one record — listRooms returns length 1.
    const da = memoryDataAccess();
    await announce(da, 'ada', 'board');
    await post(da, 'ada', 'board', 'busy-room', 'Busy room');
    await post(da, 'ada', 'board', 'quiet-room', 'Quiet room'); // stays proto (control)
    await reply(da, 'bob', 'busy-room');
    await reply(da, 'cleo', 'busy-room');
    await reply(da, 'ada', 'busy-room');

    const rooms = await listRooms(da, 'board');
    // Exactly one entry for the multiply-replied room — not three.
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.roomId).toBe('busy-room');
    // And the still-proto room is untouched (one announcement remains).
    const announcements = await listAnnouncements(da, 'board');
    expect(announcements.map((r) => r.roomId)).toEqual(['quiet-room']);
  });
});

describe('listAnnouncements / listRooms — cross-board isolation (AC #1)', () => {
  it("rooms of board A are absent from board B's lists", async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'board-a');
    await announce(da, 'bob', 'board-b');
    // Board A: one proto + one activated. Board B: one proto.
    await post(da, 'ada', 'board-a', 'a-proto', 'A proto');
    await post(da, 'ada', 'board-a', 'a-active', 'A active');
    await reply(da, 'cleo', 'a-active');
    await post(da, 'bob', 'board-b', 'b-proto', 'B proto');

    // Board A sees only its own rooms.
    expect(
      (await listAnnouncements(da, 'board-a')).map((r) => r.roomId),
    ).toEqual(['a-proto']);
    expect((await listRooms(da, 'board-a')).map((r) => r.roomId)).toEqual([
      'a-active',
    ]);
    // Board B sees only its own proto-room; A's rooms never leak in.
    expect(
      (await listAnnouncements(da, 'board-b')).map((r) => r.roomId),
    ).toEqual(['b-proto']);
    expect(await listRooms(da, 'board-b')).toEqual([]);
  });

  it('a board with no announcements yet returns empty lists (not an error)', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'empty-board');
    await expect(listAnnouncements(da, 'empty-board')).resolves.toEqual([]);
    await expect(listRooms(da, 'empty-board')).resolves.toEqual([]);
  });
});

describe('listAnnouncements / listRooms — unknown board → BOARD_NOT_FOUND (AC #3)', () => {
  it('listAnnouncements throws BOARD_NOT_FOUND for a board that was never announced', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'real-board');
    await expect(listAnnouncements(da, 'no-such-board')).rejects.toMatchObject({
      code: 'BOARD_NOT_FOUND',
    });
    await expect(listAnnouncements(da, 'no-such-board')).rejects.toBeInstanceOf(
      BoardError,
    );
  });

  it('listRooms throws BOARD_NOT_FOUND for a board that was never announced', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'real-board');
    await expect(listRooms(da, 'no-such-board')).rejects.toMatchObject({
      code: 'BOARD_NOT_FOUND',
    });
    await expect(listRooms(da, 'no-such-board')).rejects.toBeInstanceOf(
      BoardError,
    );
  });

  it('an empty ledger → BOARD_NOT_FOUND (no board exists at all)', async () => {
    const da = memoryDataAccess();
    await expect(listAnnouncements(da, 'anything')).rejects.toMatchObject({
      code: 'BOARD_NOT_FOUND',
    });
    await expect(listRooms(da, 'anything')).rejects.toMatchObject({
      code: 'BOARD_NOT_FOUND',
    });
  });
});
