// `react` / `unreact` board-operation tests (Story 5.2, Task 3 / AC #1, #2, #3, #4).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included — from
// importing @agentbbs/data-access), so these drive `react`/`unreact` against an IN-MEMORY
// DataAccess fake (mirrors add-participant.test.ts). Both ops use a PLAIN `append` (reactions
// are NOT uniqueness-constrained; the projection's latest-wins dedups a benign race), so the
// fake's `appendGuarded` throws if touched.
//
// What is pinned here (core's logic; the REAL ledger is the mcp-server integration test's job):
//   - react happy path: a PARTICIPANT reacts a message → message.reacted({ messageSeq },
//     actor = them) appended; live reactors now include them;
//   - re-react when already live → idempotent no-op (NO redundant message.reacted);
//   - unreact happy path: a live reactor unreacts → message.unreacted appended; no longer live;
//   - unreact when not live → idempotent no-op (NO redundant message.unreacted);
//   - cannot-retract-another: A's unreact leaves B's live 👍 intact (only A's own event);
//   - MESSAGE_NOT_FOUND: a non-message seq (missing / wrong type) → nothing appended (AC #3);
//   - NOT_A_MEMBER: a non-participant of the message's room → nothing appended (AC #4);
//   - the announcement (message #1) is itself react-able (by a participant of its room).

import { describe, expect, it } from 'vitest';

import { BoardError } from '../errors.js';
import { react, unreact } from './react.js';
import { liveReactors } from './reactions.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * A minimal in-memory DataAccess modeling the bits `react`/`unreact` exercise, seeded with a
 * starting `seq`-ordered stream. `append` stamps a monotonic `seq` + `createdAt`;
 * `eventsSince`/`eventsByType` read the store `seq`-ordered. `appendGuarded` throws — the
 * reaction ops MUST use a PLAIN `append` (reactions are not uniqueness-constrained).
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
      throw new Error('react/unreact must use plain append, not appendGuarded');
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
/** An announcement.posted event (opens a proto-room; message #1 of its history). */
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
/** A room.replied event (its actor becomes a participant; a message). */
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
 * Seed: ada announces `calling-interface` (auto-joins) + posts a proto-room `need-a-reviewer`
 * (message #1 = seq 7), then bob REPLIES (message #2 = seq 8, bob is now a participant) and cleo
 * REPLIES (message #3 = seq 9, cleo a participant). dave is registered but a participant of
 * nothing. So after the seed: `need-a-reviewer` is ACTIVE; its PARTICIPANTS are {bob, cleo} (ada
 * announced but never replied → NOT a participant). The reply-able messages are seq 7 (the
 * announcement), seq 8 (bob's reply), seq 9 (cleo's reply).
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
    replied(8, 'bob', 'need-a-reviewer', 'I can take a look'),
    joined(9, 'bob', 'calling-interface'),
    replied(10, 'cleo', 'need-a-reviewer', 'me too'),
    joined(11, 'cleo', 'calling-interface'),
  ];
}

// The reply-able message seqs in the seeded ledger.
const ANNOUNCEMENT_SEQ = 7;
const BOB_REPLY_SEQ = 8;
const CLEO_REPLY_SEQ = 10;

describe('react — a participant places a 👍 (AC #1)', () => {
  it('appends message.reacted({ messageSeq }, actor=them); live reactors now include them', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    // bob (a participant) reacts cleo's reply (seq 10).
    const result = await react(da, 'bob', CLEO_REPLY_SEQ);

    expect(result.messageSeq).toBe(CLEO_REPLY_SEQ);
    expect(result.reactions).toEqual(['bob']);

    // Exactly one message.reacted, actor=bob, payload.messageSeq = the target.
    const reactedEvents = await da.eventsByType('message.reacted');
    expect(reactedEvents).toHaveLength(1);
    expect(reactedEvents[0]?.actor).toBe('bob');
    expect(reactedEvents[0]?.payload).toEqual({ messageSeq: CLEO_REPLY_SEQ });

    // One new event total.
    expect(await da.maxSeq()).toBe(before + 1);

    // The projection agrees bob is a live reactor of that message.
    const events = await da.eventsSince(0);
    expect(liveReactors(events, CLEO_REPLY_SEQ)).toEqual(['bob']);
  });

  it('a participant can react the ANNOUNCEMENT (message #1) too', async () => {
    const da = memoryDataAccess(ledger());
    // bob (a participant of the room) reacts the seeding announcement (seq 7).
    const result = await react(da, 'bob', ANNOUNCEMENT_SEQ);
    expect(result.reactions).toEqual(['bob']);

    const reactedEvents = await da.eventsByType('message.reacted');
    expect(reactedEvents).toHaveLength(1);
    expect(reactedEvents[0]?.payload).toEqual({ messageSeq: ANNOUNCEMENT_SEQ });
  });

  it('a participant can react their OWN message', async () => {
    const da = memoryDataAccess(ledger());
    // bob reacts his own reply (seq 8) — allowed; he is a participant.
    const result = await react(da, 'bob', BOB_REPLY_SEQ);
    expect(result.reactions).toEqual(['bob']);
  });
});

describe('react — idempotent re-react (AC #1)', () => {
  it('re-reacting when already live is a no-op (NO redundant message.reacted)', async () => {
    const da = memoryDataAccess(ledger());

    await react(da, 'bob', CLEO_REPLY_SEQ); // first react appends
    const afterFirst = await da.maxSeq();

    const result = await react(da, 'bob', CLEO_REPLY_SEQ); // re-react: no-op
    expect(result.reactions).toEqual(['bob']);
    expect(await da.maxSeq()).toBe(afterFirst);

    // Still exactly one message.reacted (the no-op appended nothing).
    expect(await da.eventsByType('message.reacted')).toHaveLength(1);
  });
});

describe('unreact — retract a live 👍 (AC #2)', () => {
  it('appends message.unreacted({ messageSeq }, actor=them); the 👍 is no longer live', async () => {
    const da = memoryDataAccess(ledger());
    await react(da, 'bob', CLEO_REPLY_SEQ);
    const afterReact = await da.maxSeq();

    const result = await unreact(da, 'bob', CLEO_REPLY_SEQ);
    expect(result.messageSeq).toBe(CLEO_REPLY_SEQ);
    expect(result.reactions).toEqual([]);
    expect(await da.maxSeq()).toBe(afterReact + 1);

    // The message.unreacted is bob's, on the target message.
    const unreactedEvents = await da.eventsByType('message.unreacted');
    expect(unreactedEvents).toHaveLength(1);
    expect(unreactedEvents[0]?.actor).toBe('bob');
    expect(unreactedEvents[0]?.payload).toEqual({ messageSeq: CLEO_REPLY_SEQ });

    // No longer live.
    const events = await da.eventsSince(0);
    expect(liveReactors(events, CLEO_REPLY_SEQ)).toEqual([]);
  });

  it('re-reacting after an unreact makes the 👍 live again (latest wins)', async () => {
    const da = memoryDataAccess(ledger());
    await react(da, 'bob', CLEO_REPLY_SEQ);
    await unreact(da, 'bob', CLEO_REPLY_SEQ);
    const result = await react(da, 'bob', CLEO_REPLY_SEQ);
    expect(result.reactions).toEqual(['bob']);

    // The ledger holds both the original react, the unreact, and the re-react (append-only).
    expect(await da.eventsByType('message.reacted')).toHaveLength(2);
    expect(await da.eventsByType('message.unreacted')).toHaveLength(1);
  });
});

describe('unreact — idempotent no-op when not live (AC #2)', () => {
  it('unreacting when holding NO live 👍 is a no-op (NO redundant message.unreacted)', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    // bob never reacted cleo's reply → unreact is a no-op.
    const result = await unreact(da, 'bob', CLEO_REPLY_SEQ);
    expect(result.reactions).toEqual([]);
    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('message.unreacted')).toHaveLength(0);
  });

  it('unreacting after a react+unreact (already retracted) is a no-op', async () => {
    const da = memoryDataAccess(ledger());
    await react(da, 'bob', CLEO_REPLY_SEQ);
    await unreact(da, 'bob', CLEO_REPLY_SEQ);
    const afterRetract = await da.maxSeq();

    // A second unreact: bob already holds no live 👍 → no-op.
    const result = await unreact(da, 'bob', CLEO_REPLY_SEQ);
    expect(result.reactions).toEqual([]);
    expect(await da.maxSeq()).toBe(afterRetract);
    expect(await da.eventsByType('message.unreacted')).toHaveLength(1);
  });
});

describe('react/unreact — cannot retract another identity’s 👍 (AC #2)', () => {
  it("bob's unreact appends only bob's event and leaves cleo's live 👍 intact", async () => {
    const da = memoryDataAccess(ledger());
    // Both bob and cleo react cleo's reply (seq 10).
    await react(da, 'bob', CLEO_REPLY_SEQ);
    await react(da, 'cleo', CLEO_REPLY_SEQ);
    let events = await da.eventsSince(0);
    expect(liveReactors(events, CLEO_REPLY_SEQ)).toEqual(['bob', 'cleo']);

    // bob unreacts — only HIS entry flips; cleo stays live.
    const result = await unreact(da, 'bob', CLEO_REPLY_SEQ);
    expect(result.reactions).toEqual(['cleo']);

    events = await da.eventsSince(0);
    expect(liveReactors(events, CLEO_REPLY_SEQ)).toEqual(['cleo']);

    // bob's unreact is the only unreacted event; cleo's react is untouched.
    const unreactedEvents = await da.eventsByType('message.unreacted');
    expect(unreactedEvents).toHaveLength(1);
    expect(unreactedEvents[0]?.actor).toBe('bob');
  });
});

describe('react/unreact — MESSAGE_NOT_FOUND for a non-message seq (AC #3)', () => {
  it('react throws MESSAGE_NOT_FOUND and appends NOTHING for a seq with no event', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    const err = await react(da, 'bob', 999).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('MESSAGE_NOT_FOUND');

    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('message.reacted')).toHaveLength(0);
  });

  it('react throws MESSAGE_NOT_FOUND for a seq whose event is NOT a message (e.g. board.joined)', async () => {
    const da = memoryDataAccess(ledger());
    // seq 6 is ada's board.joined — a real event, but not a message.
    const err = await react(da, 'bob', 6).catch((e: unknown) => e);
    expect((err as BoardError).code).toBe('MESSAGE_NOT_FOUND');
    expect(await da.eventsByType('message.reacted')).toHaveLength(0);
  });

  it('unreact throws MESSAGE_NOT_FOUND and appends NOTHING for a non-message seq', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    const err = await unreact(da, 'bob', 999).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('MESSAGE_NOT_FOUND');

    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('message.unreacted')).toHaveLength(0);
  });
});

describe('react/unreact — NOT_A_MEMBER for a non-participant (AC #4)', () => {
  it('react throws NOT_A_MEMBER and appends NOTHING when the actor does not participate in the message’s room', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    // dave is registered but a participant of nothing → cannot react.
    const err = await react(da, 'dave', CLEO_REPLY_SEQ).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('NOT_A_MEMBER');

    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('message.reacted')).toHaveLength(0);
  });

  it('the announcer who NEVER replied is NOT a participant → react NOT_A_MEMBER (reacting requires participation, does not grant it)', async () => {
    const da = memoryDataAccess(ledger());
    // ada announced the room (and message #1) but never replied → NOT a participant.
    const err = await react(da, 'ada', ANNOUNCEMENT_SEQ).catch(
      (e: unknown) => e,
    );
    expect((err as BoardError).code).toBe('NOT_A_MEMBER');
    expect(await da.eventsByType('message.reacted')).toHaveLength(0);
  });

  it('unreact throws NOT_A_MEMBER for a non-participant (gate applies to unreact too)', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    const err = await unreact(da, 'dave', CLEO_REPLY_SEQ).catch(
      (e: unknown) => e,
    );
    expect((err as BoardError).code).toBe('NOT_A_MEMBER');
    expect(await da.maxSeq()).toBe(before);
  });

  it('checks the message BEFORE participation (a non-message seq for a non-participant is MESSAGE_NOT_FOUND)', async () => {
    const da = memoryDataAccess(ledger());
    // dave (non-participant) reacts a non-message seq → MESSAGE_NOT_FOUND wins (resolved first).
    const err = await react(da, 'dave', 999).catch((e: unknown) => e);
    expect((err as BoardError).code).toBe('MESSAGE_NOT_FOUND');
  });
});

describe('react/unreact — uses plain append (not appendGuarded)', () => {
  it('react does not call appendGuarded (reactions are not uniqueness-constrained)', async () => {
    // The fake throws if appendGuarded is touched; a successful react proves plain append.
    const da = memoryDataAccess(ledger());
    await expect(react(da, 'bob', CLEO_REPLY_SEQ)).resolves.toBeDefined();
  });
});
