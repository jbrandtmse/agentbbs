// `updateFocus` board-operation tests (Story 2.4, Task 3 & Task 5 / AC #1).
//
// core depends ONLY on the DataAccess port (and the lint forbids core — tests
// included — from importing @agentbbs/data-access), so these drive `updateFocus`
// against an IN-MEMORY DataAccess fake. The fake models the contract this op
// relies on:
//   - append stamps createdAt at append (core reads lastSeen back from it, never
//     fabricates it) and assigns a monotonic seq;
//   - eventsByActor returns that actor's events, seq-ordered, which the projection
//     folds to the updated identity.
//
// The append-only heart of AC #1 is pinned HERE at the core layer (the prior
// identity.registered row is retained; the focus update is an APPEND) and again
// over the real ledger in the integration test.

import { describe, expect, it } from 'vitest';

import { foldIdentities } from './projection.js';
import { updateFocus } from './update-focus.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * A minimal in-memory DataAccess modeling the bits `updateFocus` exercises. seq is
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

/** Seed a prior identity.registered for `handle` so updateFocus has a record to update. */
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

describe('updateFocus — success (AC #1)', () => {
  it('appends exactly one identity.focus_updated and returns the identity with the new focus + advanced lastSeen', async () => {
    const da = memoryDataAccess();
    await seedRegistration(da, 'ada', 'old focus');
    const registeredAt = (await da.eventsByActor('ada'))[0]?.createdAt;

    const identity = await updateFocus(da, 'ada', 'new focus');

    // The returned identity shows the NEW focus; createdAt stays at registration;
    // lastSeen advanced to the focus_updated event's createdAt.
    expect(identity.handle).toBe('ada');
    expect(identity.currentFocus).toBe('new focus');
    expect(identity.createdAt).toBe(registeredAt);
    const updateEvent = (await da.eventsByType('identity.focus_updated'))[0];
    expect(identity.lastSeen).toBe(updateEvent?.createdAt);
    expect(identity.lastSeen).not.toBe(identity.createdAt); // advanced

    // Exactly ONE identity.focus_updated appended, with actor + camelCase payload.
    const updates = await da.eventsByType('identity.focus_updated');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.actor).toBe('ada');
    expect(updates[0]?.payload).toEqual({
      handle: 'ada',
      currentFocus: 'new focus',
    });
  });

  it('is APPEND-ONLY: the prior identity.registered row (old focus) is retained alongside the update', async () => {
    const da = memoryDataAccess();
    await seedRegistration(da, 'ada', 'old focus');

    await updateFocus(da, 'ada', 'new focus');

    // The original registration event still exists, still carrying the OLD focus —
    // nothing was overwritten or deleted; the directory's current_focus is DERIVED.
    const registrations = await da.eventsByType('identity.registered');
    expect(registrations).toHaveLength(1);
    expect(
      (registrations[0]?.payload as { currentFocus: string }).currentFocus,
    ).toBe('old focus');
    // The ledger holds BOTH events for ada.
    const all = await da.eventsByActor('ada');
    expect(all.map((e) => e.type)).toEqual([
      'identity.registered',
      'identity.focus_updated',
    ]);
    // Folding the full stream yields the NEW focus (latest by seq).
    expect(foldIdentities(all).get('ada')?.currentFocus).toBe('new focus');
  });

  it('uses the createdAt the data-access layer assigned for lastSeen, not a value core invents', async () => {
    const sentinel = '2000-01-01T00:00:00.000Z';
    const da = memoryDataAccess({ clock: () => sentinel });
    await seedRegistration(da, 'bob', 'x');

    const identity = await updateFocus(da, 'bob', 'y');
    // With a fixed clock, both events share the sentinel — lastSeen is read back
    // from the ledger (the update event's createdAt), never fabricated by core.
    expect(identity.lastSeen).toBe(sentinel);
    expect(identity.currentFocus).toBe('y');
  });

  it('keeps the LATEST focus across multiple sequential updates and appends one event each', async () => {
    const da = memoryDataAccess();
    await seedRegistration(da, 'ada', 'focus-0');

    await updateFocus(da, 'ada', 'focus-1');
    await updateFocus(da, 'ada', 'focus-2');
    const last = await updateFocus(da, 'ada', 'focus-3');

    expect(last.currentFocus).toBe('focus-3');
    // Three focus updates appended (one per call); the registration is untouched.
    expect(await da.eventsByType('identity.focus_updated')).toHaveLength(3);
    expect(await da.eventsByType('identity.registered')).toHaveLength(1);
    // lastSeen reflects the most recent update.
    const updates = await da.eventsByType('identity.focus_updated');
    expect(last.lastSeen).toBe(updates[updates.length - 1]?.createdAt);
  });

  it('append-only retention across N updates: total ledger grows by EXACTLY one per update, every prior row survives, derived focus is latest-by-seq (QA)', async () => {
    // The core append-only guarantee of AC #1, pinned at the core layer: after N
    // sequential focus updates, the ledger holds the original identity.registered
    // row AND all N identity.focus_updated rows — the count grows by exactly 1 per
    // update (nothing is overwritten or deleted), and the derived current_focus is
    // the latest value by seq.
    const da = memoryDataAccess();
    await seedRegistration(da, 'ada', 'focus-0');

    // 1 row in the ledger so far (the registration).
    const sizeAfter = async (): Promise<number> =>
      (await da.eventsSince(0)).length;
    expect(await sizeAfter()).toBe(1);

    const N = 5;
    let prevSize = 1;
    for (let i = 1; i <= N; i += 1) {
      const before = prevSize;
      const id = await updateFocus(da, 'ada', `focus-${i}`);
      const after = await sizeAfter();
      // Exactly one row added by this update — append-only, no clobber.
      expect(after).toBe(before + 1);
      // The original registration (with the very FIRST focus) is still present
      // and unchanged after every single update.
      const registrations = await da.eventsByType('identity.registered');
      expect(registrations).toHaveLength(1);
      expect(
        (registrations[0]?.payload as { currentFocus: string }).currentFocus,
      ).toBe('focus-0');
      // The derived focus is the latest value folded this iteration.
      expect(id.currentFocus).toBe(`focus-${i}`);
      prevSize = after;
    }

    // Final ledger: 1 registration + N focus updates = N + 1 rows total.
    expect(await sizeAfter()).toBe(N + 1);
    expect(await da.eventsByType('identity.focus_updated')).toHaveLength(N);
    // Re-folding the whole stream from scratch yields the latest-by-seq focus.
    const all = await da.eventsByActor('ada');
    expect(foldIdentities(all).get('ada')?.currentFocus).toBe(`focus-${N}`);
  });
});

describe('updateFocus — no phantom identity / guard-before-append (QA, AC #3, #4)', () => {
  // Story 3.0 fixes the orphan-append wart as a CLASS, so updateFocus gets the SAME
  // symmetric coverage as recordSeen (this case did not exist before this story).
  it('FAILS LOUD (throws) for an unregistered handle and mints NO phantom identity', async () => {
    // Guard-before-append: a focus update for a handle with no prior
    // identity.registered throws a clear "not registered" error rather than
    // fabricate an Identity; the directory mints no phantom for it.
    const da = memoryDataAccess();

    await expect(updateFocus(da, 'ghost', 'a focus')).rejects.toThrow(
      /not registered/u,
    );

    expect(foldIdentities(await da.eventsByActor('ghost')).get('ghost')).toBe(
      undefined,
    );
  });

  it('writes NO orphan identity.focus_updated on the unregistered path — the ledger is UNCHANGED after the throw (AC #3/#4)', async () => {
    // The class-level invariant mirrored for focus: guard-before-append means the
    // throw precedes any append, so NOTHING is written for an unregistered handle —
    // no orphan identity.focus_updated, no rows at all.
    const da = memoryDataAccess();

    await updateFocus(da, 'ghost', 'a focus').catch(() => undefined);

    expect(await da.eventsByType('identity.focus_updated')).toHaveLength(0);
    expect(await da.eventsSince(0)).toHaveLength(0);
    expect(await da.eventsByType('identity.registered')).toHaveLength(0);
  });

  it('STILL FAILS LOUD on a genuinely broken read/append seam (append succeeds but read-back misses) — the defensive branch is retained (AC #3/#4)', async () => {
    // The retained broken-seam guard, mirrored for updateFocus: a confirmed prior
    // registration (pre-append guard passes, append runs) but a post-append
    // read-back that still misses ⇒ throw rather than fabricate. Modeled with a
    // DataAccess that returns the registration on the first (pre-append) read and
    // nothing on the second (post-append) read; append is a no-op.
    let reads = 0;
    const registered: Event = {
      seq: 1,
      type: 'identity.registered',
      actor: 'ada',
      createdAt: '2026-05-31T00:00:00.000Z',
      payload: { handle: 'ada', currentFocus: 'focus' },
    };
    const brokenSeam: DataAccess = {
      append: () => Promise.resolve([2]),
      appendGuarded: () => Promise.resolve([2]),
      eventsSince: () => Promise.resolve([]),
      eventsByType: () => Promise.resolve([]),
      eventsByActor: () => {
        reads += 1;
        return Promise.resolve(reads === 1 ? [registered] : []);
      },
      maxSeq: () => Promise.resolve(2),
      getCursor: () => Promise.resolve(0),
      setCursor: () => Promise.resolve(),
    };

    await expect(updateFocus(brokenSeam, 'ada', 'new focus')).rejects.toThrow(
      /not found in its own event stream after a successful append/u,
    );
    expect(reads).toBe(2);
  });
});
