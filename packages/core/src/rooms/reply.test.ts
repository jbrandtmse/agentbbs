// `reply` board-operation tests (Story 4.3, Task 2 / AC #1, #2, #3, #4).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included — from
// importing @agentbbs/data-access), so these drive `reply` against an IN-MEMORY DataAccess
// fake. `reply` uses a PLAIN `append` (NOT `appendGuarded` — replies are not uniqueness-
// constrained), so the fake only needs `append` / `eventsSince` / `eventsByType` /
// `maxSeq`. The fake replays the whole `seq`-ordered stream (what `findRoom`/`findProject`
// read) and appends events with monotonic `seq`s.
//
// What is pinned here (core's logic; the REAL ledger + cross-process race are the
// mcp-server integration test's job):
//   - proto-room reply (member already) → ONE room.replied appended, room becomes active,
//     activator = the replier; NO board.joined (already a member);
//   - non-member reply → room.replied AND board.joined appended in ONE call (member after),
//     activator = the replier;
//   - already-member reply → NO second board.joined (only room.replied);
//   - unknown room → ROOM_NOT_FOUND, NOTHING appended;
//   - two sequential replies → two room.replied with sequential seqs, activator = the first
//     (lower seq); a reply to an ALREADY-active room is an ordinary message (no branch).

import { describe, expect, it } from 'vitest';

import { BoardError } from '../errors.js';
import { reply } from './reply.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * A minimal in-memory DataAccess modeling the bits `reply` exercises, seeded with a
 * starting `seq`-ordered stream. `append` stamps a monotonic `seq` + `createdAt` on each
 * event; `eventsSince`/`eventsByType` read the store `seq`-ordered. `appendGuarded` throws
 * if touched — `reply` must use a PLAIN `append` (replies are not uniqueness-constrained).
 */
function memoryDataAccess(seed: Event[] = []): DataAccess {
  let seq = seed.reduce((m, e) => Math.max(m, e.seq), 0);
  const store: Event[] = [...seed];

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
    appendGuarded: () => {
      throw new Error('reply must use plain append, not appendGuarded');
    },
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
  };
}

/** A registered identity event. */
function reg(seq: number, handle: string): Event {
  return {
    seq,
    type: 'identity.registered',
    actor: handle,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { handle, currentFocus: 'x' },
  };
}
/** A project.announced event. */
function announced(seq: number, actor: string, projectId: string): Event {
  return {
    seq,
    type: 'project.announced',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId, title: projectId, description: 'desc' },
  };
}
/** A board.joined event. */
function joined(seq: number, actor: string, projectId: string): Event {
  return {
    seq,
    type: 'board.joined',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId },
  };
}
/** An announcement.posted event (opens a proto-room on a board). */
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

/**
 * Seed: ada announces `calling-interface` (auto-joins) + posts a proto-room
 * `need-a-reviewer` on it; bob joins the board; cleo only registers (member of nothing).
 * So `need-a-reviewer` is a PROTO-room (no reply yet) on a board whose members are {ada,
 * bob}; cleo is a registered non-member.
 */
function ledger(): Event[] {
  return [
    reg(1, 'ada'),
    reg(2, 'bob'),
    reg(3, 'cleo'),
    announced(4, 'ada', 'calling-interface'),
    joined(5, 'ada', 'calling-interface'),
    joined(6, 'bob', 'calling-interface'),
    posted(
      7,
      'ada',
      'calling-interface',
      'need-a-reviewer',
      'Need a reviewer',
      'looking for a second pair of eyes',
    ),
  ];
}

describe('reply — member replies to a proto-room (AC #1)', () => {
  it('appends ONE room.replied, activates the room, sets the activator = replier, and NO board.joined (already a member)', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    const room = await reply(da, 'bob', {
      roomId: 'need-a-reviewer',
      body: 'I can take a look',
    });

    // The returned room is now ACTIVE, activated by bob.
    expect(room).toMatchObject({
      roomId: 'need-a-reviewer',
      projectId: 'calling-interface',
      subject: 'Need a reviewer',
      body: 'looking for a second pair of eyes',
      postedBy: 'ada',
      active: true,
      activatedBy: 'bob',
    });
    expect(room.activatedAtSeq).toBe(before + 1);

    // Exactly one room.replied appended, attributed to bob with the verbatim body.
    const replies = await da.eventsByType('room.replied');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.actor).toBe('bob');
    expect(replies[0]?.payload).toEqual({
      roomId: 'need-a-reviewer',
      body: 'I can take a look',
    });

    // bob was ALREADY a member (joined in the seed) → NO new board.joined for him.
    // The seed has exactly two board.joined (ada, bob); reply adds none.
    const joins = await da.eventsByType('board.joined');
    expect(joins).toHaveLength(2);
    expect(joins.filter((e) => e.actor === 'bob')).toHaveLength(1);

    // Total events grew by exactly one (the room.replied only).
    expect(await da.maxSeq()).toBe(before + 1);
  });
});

describe('reply — non-member auto-joins on reply (AC #1, #2)', () => {
  it('appends room.replied AND board.joined (one call), making the replier a member; activator = replier', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    // cleo is a registered non-member of calling-interface.
    const room = await reply(da, 'cleo', {
      roomId: 'need-a-reviewer',
      body: 'happy to help',
    });

    expect(room.active).toBe(true);
    expect(room.activatedBy).toBe('cleo');

    // room.replied appended for cleo.
    const replies = await da.eventsByType('room.replied');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.actor).toBe('cleo');

    // A board.joined for cleo on the room's projectId was ALSO appended (auto-join).
    const joins = await da.eventsByType('board.joined');
    expect(joins.filter((e) => e.actor === 'cleo')).toHaveLength(1);
    expect(joins.find((e) => e.actor === 'cleo')?.payload).toEqual({
      projectId: 'calling-interface',
    });

    // Two new events total (room.replied + board.joined), appended atomically.
    expect(await da.maxSeq()).toBe(before + 2);
  });
});

describe('reply — already-member reply appends no second board.joined (AC #2)', () => {
  it('a member who replies twice never gets a redundant board.joined (only room.replied each time)', async () => {
    const da = memoryDataAccess(ledger());

    // bob (already a member) replies; then bob replies again.
    await reply(da, 'bob', { roomId: 'need-a-reviewer', body: 'first' });
    await reply(da, 'bob', { roomId: 'need-a-reviewer', body: 'second' });

    // Two room.replied (both bob), still only the seed's two board.joined.
    const replies = await da.eventsByType('room.replied');
    expect(replies).toHaveLength(2);
    expect(replies.every((e) => e.actor === 'bob')).toBe(true);

    const joins = await da.eventsByType('board.joined');
    expect(joins).toHaveLength(2);
    expect(joins.filter((e) => e.actor === 'bob')).toHaveLength(1);
  });
});

describe('reply — unknown room (AC #3)', () => {
  it('throws ROOM_NOT_FOUND and appends NOTHING for a room that was never announced', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    const err = await reply(da, 'bob', {
      roomId: 'no-such-room',
      body: 'into the void',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('ROOM_NOT_FOUND');

    // Nothing appended on the not-found path.
    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('room.replied')).toHaveLength(0);
    expect(await da.eventsByType('board.joined')).toHaveLength(2); // seed unchanged
  });
});

describe('reply — sequential replies + reply to an already-active room (AC #1, #4, #6)', () => {
  it('two replies get sequential seqs and the activator stays the FIRST (lower seq); a reply to an active room is an ordinary message', async () => {
    const da = memoryDataAccess(ledger());

    // First reply (bob, already a member) activates the room.
    const first = await reply(da, 'bob', {
      roomId: 'need-a-reviewer',
      body: 'bob first',
    });
    // Second reply (cleo, a non-member) to the NOW-ACTIVE room is an ordinary message;
    // the op does not branch on proto-vs-active. cleo auto-joins.
    const second = await reply(da, 'cleo', {
      roomId: 'need-a-reviewer',
      body: 'cleo second',
    });

    const replies = await da.eventsByType('room.replied');
    expect(replies).toHaveLength(2);
    // Sequential seqs (bob's reply strictly before cleo's).
    expect(replies[0]?.actor).toBe('bob');
    expect(replies[1]?.actor).toBe('cleo');
    expect(replies[1]!.seq).toBeGreaterThan(replies[0]!.seq);

    // The activator is the FIRST reply (bob) on BOTH returned records — never overwritten.
    expect(first.activatedBy).toBe('bob');
    expect(first.activatedAtSeq).toBe(replies[0]!.seq);
    expect(second.activatedBy).toBe('bob');
    expect(second.activatedAtSeq).toBe(replies[0]!.seq);
    expect(second.active).toBe(true);
  });
});
