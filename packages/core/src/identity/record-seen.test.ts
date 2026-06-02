// `recordSeen` presence-primitive tests (Story 2.5, Task 2 / AC #1).
//
// core depends ONLY on the DataAccess port (and the lint forbids core — tests
// included — from importing @agentbbs/data-access), so these drive `recordSeen`
// against an IN-MEMORY DataAccess fake. The fake models the contract this op
// relies on:
//   - append stamps createdAt at append (core reads lastSeen back from it, never
//     fabricates it) and assigns a monotonic seq;
//   - eventsByActor returns that actor's events, seq-ordered, which the projection
//     folds to the updated identity.
//
// The append-only heart of AC #1 is pinned HERE at the core layer (the prior
// identity.registered row is retained; the presence ping is an APPEND of exactly
// one identity.seen) and again over the real ledger in the integration test
// (data-access/record-seen.integration.test.ts).

import { describe, expect, it } from 'vitest';

import { foldIdentities } from './projection.js';
import { recordSeen } from './record-seen.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * A minimal in-memory DataAccess modeling the bits `recordSeen` exercises. seq is
 * a monotonic counter; createdAt is stamped by the fake at append (so a test can
 * assert core reads the FAKE-assigned value into lastSeen, never a fabricated one).
 * The `clock` advances per append by default so successive events get distinct,
 * increasing createdAt values (the realistic case: lastSeen advances).
 */
function memoryDataAccess(opts?: { clock?: () => string }): DataAccess {
  let seq = 0;
  const store: Event[] = [];
  const cursors = new Map<string, number>();
  // Default clock: a fresh monotonically-increasing instant per append call.
  let tick = 0;
  const defaultClock = (): string => {
    tick += 1;
    return new Date(Date.UTC(2026, 4, 31, 0, 0, tick)).toISOString();
  };
  const clock = opts?.clock ?? defaultClock;

  const appendAll = (events: NewEvent[]): number[] => {
    const createdAt = clock();
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
      Promise.resolve(store.filter((e) => e.seq > cursor)),
    eventsByType: (type) =>
      Promise.resolve(store.filter((e) => e.type === type)),
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

/** Seed a prior identity.registered for `handle` so recordSeen has a record to advance. */
async function seedRegistration(
  da: DataAccess,
  handle: string,
  focus: string,
): Promise<void> {
  await da.append([
    {
      type: 'identity.registered',
      actor: handle,
      payload: { handle, currentFocus: focus },
    },
  ]);
}

describe('recordSeen — success (AC #1)', () => {
  it('appends exactly one identity.seen and returns the identity with advanced lastSeen (focus + createdAt unchanged)', async () => {
    const da = memoryDataAccess();
    await seedRegistration(da, 'ada', 'my focus');
    const registeredAt = (await da.eventsByActor('ada'))[0]?.createdAt;

    const identity = await recordSeen(da, 'ada');

    // The returned identity: handle + currentFocus + createdAt are pinned to the
    // registration; lastSeen advanced to the identity.seen event's createdAt.
    expect(identity.handle).toBe('ada');
    expect(identity.currentFocus).toBe('my focus');
    expect(identity.createdAt).toBe(registeredAt);
    const seenEvent = (await da.eventsByType('identity.seen'))[0];
    expect(identity.lastSeen).toBe(seenEvent?.createdAt);
    expect(identity.lastSeen).not.toBe(identity.createdAt); // advanced

    // Exactly ONE identity.seen appended, with actor + camelCase payload { handle }.
    const seens = await da.eventsByType('identity.seen');
    expect(seens).toHaveLength(1);
    expect(seens[0]?.actor).toBe('ada');
    expect(seens[0]?.payload).toEqual({ handle: 'ada' });
  });

  it('is APPEND-ONLY: the prior identity.registered row is retained alongside the presence ping', async () => {
    const da = memoryDataAccess();
    await seedRegistration(da, 'ada', 'focus');

    await recordSeen(da, 'ada');

    // The original registration event still exists, unchanged — nothing overwritten.
    const registrations = await da.eventsByType('identity.registered');
    expect(registrations).toHaveLength(1);
    expect(
      (registrations[0]?.payload as { currentFocus: string }).currentFocus,
    ).toBe('focus');
    // The ledger holds BOTH events for ada, in seq order.
    const all = await da.eventsByActor('ada');
    expect(all.map((e) => e.type)).toEqual([
      'identity.registered',
      'identity.seen',
    ]);
    // Folding the full stream keeps the focus and advances lastSeen (latest by seq).
    const folded = foldIdentities(all).get('ada');
    expect(folded?.currentFocus).toBe('focus');
    expect(folded?.lastSeen).toBe(all[all.length - 1]?.createdAt);
  });

  it('uses the createdAt the data-access layer assigned for lastSeen, not a value core invents', async () => {
    const sentinel = '2000-01-01T00:00:00.000Z';
    const da = memoryDataAccess({ clock: () => sentinel });
    await seedRegistration(da, 'bob', 'x');

    const identity = await recordSeen(da, 'bob');
    // With a fixed clock, both events share the sentinel — lastSeen is read back
    // from the ledger (the seen event's createdAt), never fabricated by core.
    expect(identity.lastSeen).toBe(sentinel);
    expect(identity.currentFocus).toBe('x');
  });

  it('advances lastSeen across multiple sequential pings and appends exactly one identity.seen each', async () => {
    const da = memoryDataAccess();
    await seedRegistration(da, 'ada', 'focus');

    await recordSeen(da, 'ada');
    await recordSeen(da, 'ada');
    const last = await recordSeen(da, 'ada');

    // currentFocus never changes via a ping; lastSeen reflects the most recent seen.
    expect(last.currentFocus).toBe('focus');
    const seens = await da.eventsByType('identity.seen');
    expect(seens).toHaveLength(3);
    expect(last.lastSeen).toBe(seens[seens.length - 1]?.createdAt);
    // The registration is untouched across all pings.
    expect(await da.eventsByType('identity.registered')).toHaveLength(1);
  });

  it('append-only retention across N pings: total ledger grows by EXACTLY one per ping, every prior row survives, derived focus stays put (QA)', async () => {
    // The core append-only guarantee of AC #1, pinned at the core layer: after N
    // sequential presence pings, the ledger holds the original identity.registered
    // row AND all N identity.seen rows — the count grows by exactly 1 per ping
    // (nothing is overwritten or deleted), the derived currentFocus is unchanged,
    // and lastSeen is monotonic (never regresses).
    const da = memoryDataAccess();
    await seedRegistration(da, 'ada', 'focus');

    const sizeAfter = async (): Promise<number> =>
      (await da.eventsSince(0)).length;
    expect(await sizeAfter()).toBe(1); // just the registration

    const registeredAt = (await da.eventsByActor('ada'))[0]
      ?.createdAt as string;
    const N = 5;
    let prevSize = 1;
    let prevLastSeen = registeredAt;
    for (let i = 1; i <= N; i += 1) {
      const before = prevSize;
      const id = await recordSeen(da, 'ada');
      const after = await sizeAfter();
      // Exactly one row added by this ping — append-only, no clobber.
      expect(after).toBe(before + 1);
      // The original registration (with its focus) is still present and unchanged.
      const registrations = await da.eventsByType('identity.registered');
      expect(registrations).toHaveLength(1);
      expect(
        (registrations[0]?.payload as { currentFocus: string }).currentFocus,
      ).toBe('focus');
      // Derived focus stays put; lastSeen is monotonic (>= previous, ISO sorts
      // chronologically) and never regresses below the registration time.
      expect(id.currentFocus).toBe('focus');
      expect(id.lastSeen >= prevLastSeen).toBe(true);
      expect(id.lastSeen >= registeredAt).toBe(true);
      prevSize = after;
      prevLastSeen = id.lastSeen;
    }

    // Final ledger: 1 registration + N seen = N + 1 rows total.
    expect(await sizeAfter()).toBe(N + 1);
    expect(await da.eventsByType('identity.seen')).toHaveLength(N);
    // Re-folding the whole stream yields the unchanged focus + the latest-by-seq lastSeen.
    const all = await da.eventsByActor('ada');
    const folded = foldIdentities(all).get('ada');
    expect(folded?.currentFocus).toBe('focus');
    expect(folded?.lastSeen).toBe(all[all.length - 1]?.createdAt);
  });

  it('records presence for one handle without appending for or affecting another', async () => {
    const da = memoryDataAccess();
    await seedRegistration(da, 'ada', 'ada-focus');
    await seedRegistration(da, 'bob', 'bob-focus');
    const bobRegisteredAt = (await da.eventsByActor('bob'))[0]?.createdAt;

    await recordSeen(da, 'ada');

    // Only ada got an identity.seen; bob's stream is just its registration.
    expect(await da.eventsByActor('ada')).toHaveLength(2);
    const bobEvents = await da.eventsByActor('bob');
    expect(bobEvents).toHaveLength(1);
    // bob's derived lastSeen is still its registration time (untouched by ada's ping).
    expect(foldIdentities(bobEvents).get('bob')?.lastSeen).toBe(
      bobRegisteredAt,
    );
  });

  it('passes the acting handle through verbatim as actor and payload.handle', async () => {
    // recordSeen must not transform the handle — the caller supplies the canonical
    // lowercased form (the projection keys on actor, which must equal payload.handle).
    const da = memoryDataAccess();
    await seedRegistration(da, 'persona@project', 'focus');

    const id = await recordSeen(da, 'persona@project');
    expect(id.handle).toBe('persona@project');
    const seen = (await da.eventsByType('identity.seen'))[0];
    expect(seen?.actor).toBe('persona@project');
    expect(seen?.payload).toEqual({ handle: 'persona@project' });
  });
});

describe('recordSeen — no phantom identity / guard-before-append (QA, AC #1, #3)', () => {
  it('FAILS LOUD (throws) for an unregistered handle and mints NO phantom identity', async () => {
    // Story 3.0 (AC #3): recordSeen now GUARDS existence BEFORE appending. For a
    // handle with no prior identity.registered the pre-append guard fires, so the op
    // throws a clear "not registered" error rather than fabricate an Identity. The
    // directory still has NO entry for the unregistered handle (no phantom minted).
    const da = memoryDataAccess();

    await expect(recordSeen(da, 'ghost')).rejects.toThrow(/not registered/u);

    expect(foldIdentities(await da.eventsByActor('ghost')).get('ghost')).toBe(
      undefined,
    );
  });

  it('writes NO orphan identity.seen on the unregistered path — the ledger is UNCHANGED after the throw (AC #3/#4)', async () => {
    // Story 3.0 INVERTS the old "still APPENDS one orphan before failing" contract:
    // guard-before-append means the throw happens BEFORE any append, so NOTHING is
    // written for an unregistered handle. No orphan identity.seen, no rows at all.
    const da = memoryDataAccess();

    await recordSeen(da, 'ghost').catch(() => undefined);

    // ZERO identity.seen written (was 1 under the old append-then-throw contract).
    expect(await da.eventsByType('identity.seen')).toHaveLength(0);
    // The whole ledger is empty — the unregistered path appends nothing.
    expect(await da.eventsSince(0)).toHaveLength(0);
    expect(await da.eventsByType('identity.registered')).toHaveLength(0);
  });

  it('STILL FAILS LOUD on a genuinely broken read/append seam (append succeeds but read-back misses) — the defensive branch is retained (AC #3/#4)', async () => {
    // The retained broken-seam guard: if a prior registration IS confirmed (so the
    // pre-append guard passes and the append runs) but the post-append read-back
    // still yields no identity, the seam is genuinely broken — recordSeen throws
    // rather than fabricate. Modeled with a DataAccess whose eventsByActor returns
    // the registration on the FIRST (pre-append) read but nothing on the SECOND
    // (post-append) read, and whose append is a no-op.
    let reads = 0;
    const registered: Event = {
      seq: 1,
      type: 'identity.registered',
      actor: 'ada',
      createdAt: '2026-05-31T00:00:00.000Z',
      payload: { handle: 'ada', currentFocus: 'focus' },
    };
    const brokenSeam: DataAccess = {
      append: () => Promise.resolve([2]), // append "succeeds" but persists nothing
      appendGuarded: () => Promise.resolve([2]),
      eventsSince: () => Promise.resolve([]),
      eventsByType: () => Promise.resolve([]),
      eventsByActor: () => {
        reads += 1;
        // First read (pre-append guard) sees the registration → guard passes.
        // Second read (post-append read-back) sees nothing → broken seam.
        return Promise.resolve(reads === 1 ? [registered] : []);
      },
      maxSeq: () => Promise.resolve(2),
      getCursor: () => Promise.resolve(0),
      setCursor: () => Promise.resolve(),
    };

    await expect(recordSeen(brokenSeam, 'ada')).rejects.toThrow(
      /not found in its own event stream after a successful append/u,
    );
    expect(reads).toBe(2); // proves the append path ran (both reads happened)
  });
});
