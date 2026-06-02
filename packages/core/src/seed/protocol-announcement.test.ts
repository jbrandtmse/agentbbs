// `seedProtocolAnnouncement` unit tests (Story 7.2, Task 1 / AC #1, #2).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included — from
// importing @agentbbs/data-access), so these drive the seed against an IN-MEMORY DataAccess
// fake that models the contract the seed relies on: a `seq`-ordered event store, `append`
// (plain) + `appendGuarded` (enforcing the room_id uniqueness guard against the AT-REST
// snake_case payload, exactly as the real adapter does), and `eventsSince(0)` replay. The
// REAL-ledger proof is protocol-seed.integration.test.ts (the Integration AC #5 over a real
// MCP Client↔server↔SQLite).
//
// Coverage:
//   - first run creates EXACTLY one protocol announcement (+ the reserved system identity +
//     the reserved `main` project + the system's membership of main) — AC #1;
//   - the announcement is roomId `how-this-board-works` on project `main`, subject + body set,
//     body states the four moves + points to docs/negotiation-protocol.md;
//   - second run appends NOTHING (idempotent — AC #2);
//   - a concurrent bootstrap that already posted the protocol announcement → the guard trips,
//     the seed swallows it and appends nothing (idempotent under a race);
//   - a partial prior state (agentbbs already registered) does NOT double-register.

import { describe, expect, it } from 'vitest';

import {
  MAIN_BOARD_PROJECT_ID,
  PROTOCOL_ROOM_ID,
  PROTOCOL_SUBJECT,
  readProtocolAnnouncement,
  seedProtocolAnnouncement,
  SYSTEM_HANDLE,
} from './protocol-announcement.js';
import { findProject } from '../projects/projection.js';
import { findRoom } from '../rooms/projection.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess, UniquenessGuard } from '../ports.js';

/**
 * A minimal in-memory DataAccess modeling the bits the seed exercises: a `seq`-ordered event
 * store, `append` + `appendGuarded` (the guard checks the AT-REST snake_case payload, mirroring
 * the real adapter so the seed's `room_id` guard behaves), and `eventsSince(0)` replay. Reads
 * are `seq`-ordered.
 */
function memoryDataAccess(seed: Event[] = []): DataAccess {
  let seq = seed.reduce((m, e) => Math.max(m, e.seq), 0);
  const store: Event[] = [...seed];
  const cursors = new Map<string, number>();

  // Project a NewEvent to its at-rest (snake_case) payload — only the fields the seed's guard
  // inspects need be faithful; announcement.posted carries `room_id` (the guard field).
  const atRest = (e: NewEvent): Record<string, unknown> => {
    if (e.type === 'announcement.posted') {
      return {
        project_id: e.payload.projectId,
        room_id: e.payload.roomId,
        subject: e.payload.subject,
        body: e.payload.body,
      };
    }
    return { ...(e.payload as unknown as Record<string, unknown>) };
  };

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
    appendGuarded: (events: NewEvent[], guards: UniquenessGuard[]) => {
      for (const guard of guards) {
        const collides = store.some(
          (e) =>
            e.type === guard.type &&
            atRest(e as unknown as NewEvent)[guard.field] === guard.value,
        );
        if (collides) {
          return Promise.reject(
            Object.assign(new Error('already exists'), {
              code: 'UNIQUENESS_CONFLICT',
            }),
          );
        }
      }
      return Promise.resolve(appendAll(events));
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
    getCursor: (handle) => Promise.resolve(cursors.get(handle) ?? 0),
    setCursor: (handle, value) => {
      cursors.set(handle, value);
      return Promise.resolve();
    },
  };
}

describe('seedProtocolAnnouncement — first run (AC #1)', () => {
  it('creates exactly one protocol announcement + the reserved system identity, main project, and its membership', async () => {
    const da = memoryDataAccess();
    expect(await da.maxSeq()).toBe(0);

    await seedProtocolAnnouncement(da);

    // Exactly one announcement.posted, and it is the protocol announcement.
    const announcements = await da.eventsByType('announcement.posted');
    expect(announcements).toHaveLength(1);
    expect(announcements[0]?.actor).toBe(SYSTEM_HANDLE);

    // The reserved system identity was registered exactly once.
    const regs = await da.eventsByType('identity.registered');
    expect(regs.map((e) => e.actor)).toEqual([SYSTEM_HANDLE]);

    // The reserved `main` project was announced, with agentbbs as a member.
    const events = await da.eventsSince(0);
    const main = findProject(events, MAIN_BOARD_PROJECT_ID);
    expect(main).toBeDefined();
    expect(main?.announcer).toBe(SYSTEM_HANDLE);
    expect(main?.members).toContain(SYSTEM_HANDLE);
  });

  it('the announcement is roomId how-this-board-works on project main, with the protocol body', async () => {
    const da = memoryDataAccess();
    await seedProtocolAnnouncement(da);

    const room = findRoom(await da.eventsSince(0), PROTOCOL_ROOM_ID);
    expect(room).toBeDefined();
    expect(room?.roomId).toBe(PROTOCOL_ROOM_ID);
    expect(room?.projectId).toBe(MAIN_BOARD_PROJECT_ID);
    expect(room?.subject).toBe(PROTOCOL_SUBJECT);
    expect(room?.postedBy).toBe(SYSTEM_HANDLE);
    // A proto-room (no reply yet).
    expect(room?.active).toBe(false);

    // The body states the four moves + points to the canonical protocol doc.
    const body = room?.body ?? '';
    expect(body).toMatch(/Propose/);
    expect(body).toMatch(/Counter/);
    expect(body).toMatch(/Ratify/);
    expect(body).toMatch(/Frozen/);
    expect(body).toContain('docs/negotiation-protocol.md');
  });
});

describe('seedProtocolAnnouncement — idempotent re-run (AC #2)', () => {
  it('a second run appends NOTHING (no duplicate announcement / identity / project)', async () => {
    const da = memoryDataAccess();

    await seedProtocolAnnouncement(da);
    const seqAfterFirst = await da.maxSeq();
    const eventsAfterFirst = (await da.eventsSince(0)).length;

    await seedProtocolAnnouncement(da);

    // The ledger is byte-for-byte unchanged: no new events of any kind.
    expect(await da.maxSeq()).toBe(seqAfterFirst);
    expect(await da.eventsSince(0)).toHaveLength(eventsAfterFirst);
    // Still exactly one protocol announcement, one system registration, one main project.
    expect(await da.eventsByType('announcement.posted')).toHaveLength(1);
    expect(await da.eventsByType('identity.registered')).toHaveLength(1);
    expect(await da.eventsByType('project.announced')).toHaveLength(1);
  });

  it('runs many times in a row and still yields exactly one protocol announcement', async () => {
    const da = memoryDataAccess();
    for (let i = 0; i < 5; i += 1) {
      await seedProtocolAnnouncement(da);
    }
    expect(await da.eventsByType('announcement.posted')).toHaveLength(1);
  });
});

describe('seedProtocolAnnouncement — robustness', () => {
  it('a concurrent bootstrap race (existence check misses, guard trips) → seed swallows it and appends nothing', async () => {
    // Simulate the LOSER of a bootstrap race: process B read the stream and saw NO protocol
    // announcement (its existence check misses), but before B's guarded append runs, process A
    // committed the announcement — so B's `room_id` guard now trips. The seed must SWALLOW that
    // conflict (idempotent) and resolve, NOT throw. This race fake returns an empty stream from
    // `eventsSince` (the stale read B saw) but always REJECTS a guarded announcement.posted on the
    // reserved room_id with UNIQUENESS_CONFLICT (A already posted it).
    let appendCalls = 0;
    const raceFake: DataAccess = {
      append: () => Promise.resolve([]),
      appendGuarded: () => {
        appendCalls += 1;
        return Promise.reject(
          Object.assign(new Error('already exists'), {
            code: 'UNIQUENESS_CONFLICT',
          }),
        );
      },
      eventsSince: () => Promise.resolve([]), // B's stale read: no announcement visible yet
      eventsByType: () => Promise.resolve([]),
      eventsByActor: () => Promise.resolve([]),
      maxSeq: () => Promise.resolve(0),
      getCursor: () => Promise.resolve(0),
      setCursor: () => Promise.resolve(),
    };

    // Must NOT throw — the conflict is the desired end state (the announcement exists).
    await expect(seedProtocolAnnouncement(raceFake)).resolves.toBeUndefined();
    // It DID attempt the guarded append (proving it went down the race path, not the no-op path).
    expect(appendCalls).toBe(1);
  });

  it('re-throws a NON-uniqueness store fault (fails loudly rather than leaving the board unseeded)', async () => {
    // A store fault that is NOT a uniqueness conflict must propagate — the seed must not silently
    // swallow a genuine failure (which would leave the board without its protocol announcement).
    const faultFake: DataAccess = {
      append: () => Promise.resolve([]),
      appendGuarded: () => Promise.reject(new Error('disk on fire')),
      eventsSince: () => Promise.resolve([]),
      eventsByType: () => Promise.resolve([]),
      eventsByActor: () => Promise.resolve([]),
      maxSeq: () => Promise.resolve(0),
      getCursor: () => Promise.resolve(0),
      setCursor: () => Promise.resolve(),
    };

    await expect(seedProtocolAnnouncement(faultFake)).rejects.toThrow(
      'disk on fire',
    );
  });

  it('readProtocolAnnouncement resolves the protocol room when seeded, undefined when not', async () => {
    const da = memoryDataAccess();

    // Unseeded → undefined (robust; the join_board tool then omits the additive field).
    expect(await readProtocolAnnouncement(da)).toBeUndefined();

    await seedProtocolAnnouncement(da);

    // Seeded → the protocol proto-room on the reserved main project.
    const room = await readProtocolAnnouncement(da);
    expect(room).toBeDefined();
    expect(room?.roomId).toBe(PROTOCOL_ROOM_ID);
    expect(room?.projectId).toBe(MAIN_BOARD_PROJECT_ID);
    expect(room?.subject).toBe(PROTOCOL_SUBJECT);
  });

  it('readProtocolAnnouncement is a pure read — it appends nothing', async () => {
    const da = memoryDataAccess();
    await seedProtocolAnnouncement(da);
    const before = await da.maxSeq();

    await readProtocolAnnouncement(da);
    await readProtocolAnnouncement(da);

    expect(await da.maxSeq()).toBe(before); // no events appended by the read
  });

  it('does NOT double-register the system identity when agentbbs is already registered', async () => {
    // A partial prior state: agentbbs is already a registered identity (e.g. it announced an
    // ordinary board before), but the protocol announcement does not exist yet.
    const da = memoryDataAccess([
      {
        seq: 1,
        type: 'identity.registered',
        actor: SYSTEM_HANDLE,
        createdAt: '2026-05-31T00:00:01.000Z',
        payload: { handle: SYSTEM_HANDLE, currentFocus: 'pre-existing' },
      } as unknown as Event,
    ]);

    await seedProtocolAnnouncement(da);

    // Still exactly one identity.registered for agentbbs (the seed did NOT append a second).
    const regs = (await da.eventsByType('identity.registered')).filter(
      (e) => e.actor === SYSTEM_HANDLE,
    );
    expect(regs).toHaveLength(1);
    // …and the protocol announcement was still created.
    expect(await da.eventsByType('announcement.posted')).toHaveLength(1);
  });
});
