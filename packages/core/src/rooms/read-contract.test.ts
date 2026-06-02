// `readContract` board-read tests (Story 5.3, Task 2 / AC #1, #2, #3, #4).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included — from
// importing @agentbbs/data-access), so these drive `readContract` against an IN-MEMORY DataAccess
// fake (the same fake shape `read-room.test.ts` uses). `readContract` is a thin read over
// `findRoom` (existence → ROOM_NOT_FOUND) + `currentContract` (the highest-`seq` live-👍'd
// message, or null), so these pin the WIRING that the pure `currentContract` test (contract.test.ts)
// cannot — specifically the EXISTENCE-vs-EMPTINESS distinction the tool relies on:
//   - an UNKNOWN room → ROOM_NOT_FOUND (the existence check; AC #4), NOT null;
//   - a KNOWN room with no live 👍 → null ("no contract yet"; AC #3) — DISTINCT from the above;
//   - the contract progression 👍M1 → 👍M2 → retract M2 → retract M1 (M1 → M2 → M1 → null; AC #1/#2)
//     observed at the op layer over a real append sequence.
// The exhaustive contract branches live in contract.test.ts; here we prove the op wiring.

import { describe, expect, it } from 'vitest';

import { readContract } from './read-contract.js';
import { BoardError } from '../errors.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * A minimal in-memory DataAccess exposing the seq-ordered event stream `readContract` consumes.
 * `append` assigns a monotonic seq + stamps createdAt; `eventsSince(cursor)` returns events with
 * seq > cursor, seq-ordered. Other port methods conform to the interface but are unused here.
 */
function memoryDataAccess(): DataAccess {
  let seq = 0;
  const store: Event[] = [];
  const cursors = new Map<string, number>();

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
    getCursor: (handle) => Promise.resolve(cursors.get(handle) ?? 0),
    setCursor: (handle, value) => {
      cursors.set(handle, value);
      return Promise.resolve();
    },
  };
}

/** Post an announcement (open a proto-room) the way `postAnnouncement` does; returns its seq. */
async function post(
  da: DataAccess,
  actor: string,
  projectId: string,
  roomId: string,
  subject: string,
  body: string,
): Promise<number> {
  const [seq] = await da.append([
    {
      type: 'announcement.posted',
      actor,
      payload: { projectId, roomId, subject, body },
    },
  ]);
  return seq!;
}

/** Seed a reply (a message) directly through the port; returns its seq (the message's id). */
async function reply(
  da: DataAccess,
  actor: string,
  roomId: string,
  body: string,
): Promise<number> {
  const [seq] = await da.append([
    { type: 'room.replied', actor, payload: { roomId, body } },
  ]);
  return seq!;
}

/** Place a 👍 (message.reacted) on the message at messageSeq, by actor. */
async function react(
  da: DataAccess,
  actor: string,
  messageSeq: number,
): Promise<void> {
  await da.append([
    { type: 'message.reacted', actor, payload: { messageSeq } },
  ]);
}

/** Retract a 👍 (message.unreacted) from the message at messageSeq, by actor. */
async function unreact(
  da: DataAccess,
  actor: string,
  messageSeq: number,
): Promise<void> {
  await da.append([
    { type: 'message.unreacted', actor, payload: { messageSeq } },
  ]);
}

describe('readContract — existence vs emptiness (AC #3, #4)', () => {
  it('an UNKNOWN room → ROOM_NOT_FOUND (the existence check), NOT null', async () => {
    const da = memoryDataAccess();
    await post(da, 'ada', 'p', 'known-room', 'S', 'seed'); // some room exists, but not the one asked
    await expect(readContract(da, 'no-such-room')).rejects.toBeInstanceOf(
      BoardError,
    );
    await expect(readContract(da, 'no-such-room')).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND',
    });
  });

  it('a KNOWN room with no live 👍 → null ("no contract yet"), DISTINCT from ROOM_NOT_FOUND', async () => {
    const da = memoryDataAccess();
    await post(da, 'ada', 'p', 'need-a-reviewer', 'S', 'seed');
    await reply(da, 'bob', 'need-a-reviewer', 'on it');
    // The room exists and has messages, but nothing is 👍'd → null (not an error).
    await expect(readContract(da, 'need-a-reviewer')).resolves.toBeNull();
  });
});

describe('readContract — the contract progression at the op layer (AC #1, #2)', () => {
  it('👍 M1 → M1; 👍 M2 → M2 (higher seq wins); retract M2 → reverts to M1; retract M1 → null', async () => {
    const da = memoryDataAccess();
    const m1 = await post(da, 'ada', 'p', 'r', 'S', 'announce body'); // message #1 (announcement)
    const m2 = await reply(da, 'bob', 'r', 'reply body'); // message #2 (reply)
    expect(m2).toBeGreaterThan(m1);

    // No 👍 yet → null.
    expect(await readContract(da, 'r')).toBeNull();

    // 👍 M1 → contract is M1 (the announcement can be the contract).
    await react(da, 'cleo', m1);
    expect(await readContract(da, 'r')).toMatchObject({
      seq: m1,
      kind: 'announcement',
      body: 'announce body',
      reactions: ['cleo'],
    });

    // 👍 M2 → contract moves to M2 (highest-seq live-👍'd wins) even though M1 still holds a 👍.
    await react(da, 'dan', m2);
    expect(await readContract(da, 'r')).toMatchObject({
      seq: m2,
      kind: 'reply',
      body: 'reply body',
    });

    // Retract M2's only 👍 → reverts to M1 (still live-👍'd by cleo) — NO special revert logic.
    await unreact(da, 'dan', m2);
    expect(await readContract(da, 'r')).toMatchObject({ seq: m1 });

    // Retract M1's only 👍 → no message holds a live 👍 → null.
    await unreact(da, 'cleo', m1);
    expect(await readContract(da, 'r')).toBeNull();
  });

  it('a PROTO-room whose only message (the announcement) is 👍’d → that announcement is the contract', async () => {
    const da = memoryDataAccess();
    const m1 = await post(da, 'ada', 'p', 'proto', 'S', 'proto seed'); // no reply — proto-room
    await react(da, 'bob', m1);
    expect(await readContract(da, 'proto')).toMatchObject({
      seq: m1,
      kind: 'announcement',
      body: 'proto seed',
      reactions: ['bob'],
    });
  });
});
