// `addParticipant` board-operation tests (Story 4.5, Task 2 / AC #1–#5).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included — from
// importing @agentbbs/data-access), so these drive `addParticipant` against an IN-MEMORY
// DataAccess fake. `addParticipant` uses a PLAIN `append` (NOT `appendGuarded` —
// participation is not uniqueness-constrained; the participants/members projections de-dup a
// benign race), so the fake only needs `append` / `eventsSince` / `eventsByType` / `maxSeq`.
//
// What is pinned here (core's logic; the REAL ledger is the mcp-server integration test's job):
//   - happy path: a PARTICIPANT pulls in a registered NON-member → room.participant_added
//     (actor = adder, payload.handle = target) AND board.joined (actor = the TARGET) appended
//     in ONE call; the target is now a participant + a member;
//   - target already a member of the room's board → room.participant_added but NO board.joined;
//   - unknown target handle → HANDLE_NOT_FOUND, NOTHING appended;
//   - unknown room → ROOM_NOT_FOUND, NOTHING appended;
//   - actor is NOT a participant → NOT_A_MEMBER, NOTHING appended;
//   - target ALREADY a participant → idempotent no-op (NO room.participant_added / board.joined);
//   - target handle is canonicalized (lowercased) before the existence check + the append.

import { describe, expect, it } from 'vitest';

import { BoardError } from '../errors.js';
import { addParticipant } from './add-participant.js';
import { roomParticipants } from './participants.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * A minimal in-memory DataAccess modeling the bits `addParticipant` exercises, seeded with a
 * starting `seq`-ordered stream. `append` stamps a monotonic `seq` + `createdAt` on each
 * event; `eventsSince`/`eventsByType` read the store `seq`-ordered. `appendGuarded` throws if
 * touched — `addParticipant` must use a PLAIN `append` (participation is not uniqueness-
 * constrained).
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
      throw new Error(
        'addParticipant must use plain append, not appendGuarded',
      );
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
/** A room.replied event (its actor becomes a participant + activates the room). */
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

/**
 * Seed: ada announces `calling-interface` (auto-joins) + posts a proto-room `need-a-reviewer`,
 * then bob (a registered non-member) REPLIES (activating the room; bob auto-joins the board).
 * cleo and dave are registered but members of nothing and participants of nothing.
 * So after the seed: `need-a-reviewer` is ACTIVE; its PARTICIPANTS are {bob} (the replier; ada
 * announced but never replied, so she is NOT a participant); the board members are {ada, bob}.
 */
function ledger(): Event[] {
  return [
    reg(1, 'ada'),
    reg(2, 'bob'),
    reg(3, 'cleo'),
    reg(4, 'dave'),
    announced(5, 'ada', 'calling-interface'),
    joined(6, 'ada', 'calling-interface'),
    posted(
      7,
      'ada',
      'calling-interface',
      'need-a-reviewer',
      'Need a reviewer',
      'looking for a second pair of eyes',
    ),
    replied(8, 'bob', 'need-a-reviewer', 'I can take a look'), // bob participates + auto-joins
    joined(9, 'bob', 'calling-interface'),
  ];
}

describe('addParticipant — a participant pulls in a registered non-member (AC #1)', () => {
  it('appends room.participant_added (actor=adder, handle=target) AND board.joined (actor=target) in ONE call; the target becomes a participant + member', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    // bob (a participant) pulls in cleo (registered, non-member, non-participant).
    const result = await addParticipant(da, 'bob', {
      roomId: 'need-a-reviewer',
      handle: 'cleo',
    });

    // The returned room is the (active) room; participants now include cleo.
    expect(result.room.roomId).toBe('need-a-reviewer');
    expect(result.room.active).toBe(true);
    expect(result.participants).toEqual(['bob', 'cleo']);

    // room.participant_added: actor is the ADDER (bob), payload.handle is the TARGET (cleo).
    const added = await da.eventsByType('room.participant_added');
    expect(added).toHaveLength(1);
    expect(added[0]?.actor).toBe('bob');
    expect(added[0]?.payload).toEqual({
      roomId: 'need-a-reviewer',
      handle: 'cleo',
    });

    // board.joined for the TARGET (cleo) — the pulled-in peer joins the board; the ACTOR of
    // the join is cleo, NOT the adder bob.
    const cleoJoins = (await da.eventsByType('board.joined')).filter(
      (e) => e.actor === 'cleo',
    );
    expect(cleoJoins).toHaveLength(1);
    expect(cleoJoins[0]?.payload).toEqual({ projectId: 'calling-interface' });

    // Two new events total (participant_added + the target's board.joined), appended in one tx.
    expect(await da.maxSeq()).toBe(before + 2);
  });
});

describe('addParticipant — target already a board member (AC #1)', () => {
  it('appends room.participant_added but NO board.joined when the target is already a member', async () => {
    // Seed + cleo joins the board WITHOUT being a room participant (member, not participant).
    const seed = ledger();
    seed.push(joined(10, 'cleo', 'calling-interface'));
    const da = memoryDataAccess(seed);
    const before = await da.maxSeq();
    const cleoJoinsBefore = (await da.eventsByType('board.joined')).filter(
      (e) => e.actor === 'cleo',
    ).length;
    expect(cleoJoinsBefore).toBe(1);

    const result = await addParticipant(da, 'bob', {
      roomId: 'need-a-reviewer',
      handle: 'cleo',
    });
    expect(result.participants).toEqual(['bob', 'cleo']);

    // The participant_added is appended (cleo was a member but NOT yet a participant)...
    const added = await da.eventsByType('room.participant_added');
    expect(added).toHaveLength(1);
    expect(added[0]?.payload).toEqual({
      roomId: 'need-a-reviewer',
      handle: 'cleo',
    });
    // ...but NO second board.joined for cleo (already a member): the count stays 1.
    const cleoJoinsAfter = (await da.eventsByType('board.joined')).filter(
      (e) => e.actor === 'cleo',
    ).length;
    expect(cleoJoinsAfter).toBe(1);

    // Exactly ONE new event (the participant_added only).
    expect(await da.maxSeq()).toBe(before + 1);
  });
});

describe('addParticipant — unknown target handle (AC #2)', () => {
  it('throws HANDLE_NOT_FOUND and appends NOTHING for a handle that was never registered', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    const err = await addParticipant(da, 'bob', {
      roomId: 'need-a-reviewer',
      handle: 'ghost',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('HANDLE_NOT_FOUND');

    // Nothing appended on the not-found path.
    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('room.participant_added')).toHaveLength(0);
  });
});

describe('addParticipant — unknown room (AC #3)', () => {
  it('throws ROOM_NOT_FOUND and appends NOTHING for a room that was never announced', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    const err = await addParticipant(da, 'bob', {
      roomId: 'no-such-room',
      handle: 'cleo',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('ROOM_NOT_FOUND');

    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('room.participant_added')).toHaveLength(0);
  });

  it('checks the room BEFORE the target handle (an unknown room with an unknown handle is ROOM_NOT_FOUND)', async () => {
    const da = memoryDataAccess(ledger());
    const err = await addParticipant(da, 'bob', {
      roomId: 'no-such-room',
      handle: 'ghost',
    }).catch((e: unknown) => e);
    expect((err as BoardError).code).toBe('ROOM_NOT_FOUND');
  });
});

describe('addParticipant — actor is not a participant (AC #4)', () => {
  it('throws NOT_A_MEMBER when the actor has neither replied nor been added to the room', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    // ada ANNOUNCED the room but never replied → she is NOT a participant → cannot add.
    const err = await addParticipant(da, 'ada', {
      roomId: 'need-a-reviewer',
      handle: 'cleo',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('NOT_A_MEMBER');

    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('room.participant_added')).toHaveLength(0);
  });

  it('a registered bystander (cleo, never engaged the room) → NOT_A_MEMBER', async () => {
    const da = memoryDataAccess(ledger());
    const err = await addParticipant(da, 'cleo', {
      roomId: 'need-a-reviewer',
      handle: 'dave',
    }).catch((e: unknown) => e);
    expect((err as BoardError).code).toBe('NOT_A_MEMBER');
  });

  it('a peer who was ADDED (not replied) can then add others (participation = pulled-in too)', async () => {
    const da = memoryDataAccess(ledger());
    // bob pulls in cleo; cleo (now a participant via the add) pulls in dave.
    await addParticipant(da, 'bob', {
      roomId: 'need-a-reviewer',
      handle: 'cleo',
    });
    const result = await addParticipant(da, 'cleo', {
      roomId: 'need-a-reviewer',
      handle: 'dave',
    });
    expect(result.participants).toEqual(['bob', 'cleo', 'dave']);
  });
});

describe('addParticipant — idempotent re-add (AC #5)', () => {
  it('is a no-op when the target is ALREADY a participant (NO redundant participant_added / board.joined)', async () => {
    const da = memoryDataAccess(ledger());

    // First add: bob pulls in cleo (appends participant_added + cleo's board.joined).
    await addParticipant(da, 'bob', {
      roomId: 'need-a-reviewer',
      handle: 'cleo',
    });
    const afterFirst = await da.maxSeq();

    // Re-add cleo: she is already a participant → no-op (NOTHING appended).
    const result = await addParticipant(da, 'bob', {
      roomId: 'need-a-reviewer',
      handle: 'cleo',
    });
    expect(result.participants).toEqual(['bob', 'cleo']);
    expect(await da.maxSeq()).toBe(afterFirst);

    // Still exactly one participant_added + one cleo board.joined.
    expect(await da.eventsByType('room.participant_added')).toHaveLength(1);
    expect(
      (await da.eventsByType('board.joined')).filter((e) => e.actor === 'cleo'),
    ).toHaveLength(1);
  });

  it('re-adding an EXISTING participant (one who replied) is a no-op', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();
    // bob is already a participant (he replied). Adding him again is a no-op.
    const result = await addParticipant(da, 'bob', {
      roomId: 'need-a-reviewer',
      handle: 'bob',
    });
    expect(result.participants).toEqual(['bob']);
    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('room.participant_added')).toHaveLength(0);
  });
});

describe('addParticipant — canonicalizes the target handle', () => {
  it('lowercases the target handle before the existence check and the append', async () => {
    const da = memoryDataAccess(ledger());

    // The wire would already canonicalize, but core defensively lowercases: "Cleo" resolves
    // to the registered "cleo" and the appended handle is the canonical lowercased form.
    const result = await addParticipant(da, 'bob', {
      roomId: 'need-a-reviewer',
      handle: 'Cleo',
    });
    expect(result.participants).toEqual(['bob', 'cleo']);

    const added = await da.eventsByType('room.participant_added');
    expect(added[0]?.payload).toEqual({
      roomId: 'need-a-reviewer',
      handle: 'cleo',
    });
    // And the projection agrees the canonical handle is a participant.
    const events = await da.eventsSince(0);
    expect(roomParticipants(events, 'need-a-reviewer')).toEqual([
      'bob',
      'cleo',
    ]);
  });
});
