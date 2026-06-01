// `login` board-operation tests (Story 2.3, Task 1 / AC #1, #2).
//
// `login` is claim-based and READ-ONLY: it resolves an existing handle against the
// identity directory and returns the record, or throws `LOGIN_UNKNOWN` if the
// handle was never registered. It appends NOTHING (no token, no ledger write).
//
// Like `register`, core depends ONLY on the DataAccess port (the lint forbids core —
// tests included — from importing @agentbbs/data-access), so these drive `login`
// against the same IN-MEMORY DataAccess fake used by the register tests. The fake
// models the contract `login` relies on: `eventsByActor` returns that actor's
// events seq-ordered (the slice `findIdentity` folds), and `append`/`appendGuarded`
// are observable so the test can prove login wrote nothing.

import { describe, expect, it, vi } from 'vitest';

import { BoardError } from '../errors.js';
import { login } from './login.js';
import { register } from './register.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess, UniquenessGuard } from '../ports.js';

/**
 * A minimal in-memory DataAccess (mirrors register.test.ts) modeling the bits the
 * identity ops exercise. seq is a monotonic counter; createdAt is stamped by the
 * fake at append. `eventsByActor` returns the actor's events seq-ordered — the slice
 * `login` folds via `findIdentity`.
 */
function memoryDataAccess(opts?: { createdAt?: () => string }): DataAccess {
  let seq = 0;
  const store: Event[] = [];
  const cursors = new Map<string, number>();
  const clock = opts?.createdAt ?? ((): string => new Date().toISOString());

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
    appendGuarded: (events, guards: UniquenessGuard[]) => {
      for (const guard of guards) {
        const collides = store.some(
          (e) =>
            e.type === guard.type &&
            (e.payload as unknown as Record<string, unknown>)[guard.field] ===
              guard.value,
        );
        if (collides) {
          return Promise.reject(new Error('uniqueness conflict'));
        }
      }
      return Promise.resolve(appendAll(events));
    },
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

describe('login — known handle (AC #1)', () => {
  it('returns the existing identity (handle, currentFocus, createdAt, lastSeen)', async () => {
    const fixedTime = '2026-05-31T08:00:00.000Z';
    const da = memoryDataAccess({ createdAt: () => fixedTime });
    await register(da, { handle: 'ada', currentFocus: 'shipping 2.3' });

    const identity = await login(da, 'ada');

    expect(identity).toEqual({
      handle: 'ada',
      currentFocus: 'shipping 2.3',
      createdAt: fixedTime,
      lastSeen: fixedTime,
    });
  });

  it('appends NOTHING — the ledger size is unchanged across a login (claim-based, no token)', async () => {
    const da = memoryDataAccess();
    await register(da, { handle: 'ada', currentFocus: 'x' });
    const before = (await da.eventsByType('identity.registered')).length;

    // Spy the write paths to prove login performs zero appends.
    const appendSpy = vi.spyOn(da, 'append');
    const appendGuardedSpy = vi.spyOn(da, 'appendGuarded');

    await login(da, 'ada');

    expect(appendSpy).not.toHaveBeenCalled();
    expect(appendGuardedSpy).not.toHaveBeenCalled();
    const after = (await da.eventsByType('identity.registered')).length;
    expect(after).toBe(before);
  });

  it('resolves case-insensitively against the stored canonical handle', async () => {
    // A handle reaching core resolves on its canonical (lowercased) form. The MCP
    // boundary rejects non-lowercase input before core, but core canonicalizes
    // defensively so an uppercase handle that DID reach it still resolves.
    const da = memoryDataAccess();
    await register(da, { handle: 'ada', currentFocus: 'x' });

    const identity = await login(da, 'ADA');
    expect(identity.handle).toBe('ada');
  });
});

describe('login — unknown handle (AC #2)', () => {
  it('throws BoardError(LOGIN_UNKNOWN) for a never-registered handle', async () => {
    const da = memoryDataAccess();

    await expect(login(da, 'ghost')).rejects.toBeInstanceOf(BoardError);

    const err = await login(da, 'ghost').catch((e: unknown) => e);
    expect((err as BoardError).code).toBe('LOGIN_UNKNOWN');
  });

  it('does not append when rejecting an unknown handle', async () => {
    const da = memoryDataAccess();
    const appendSpy = vi.spyOn(da, 'append');
    const appendGuardedSpy = vi.spyOn(da, 'appendGuarded');

    await login(da, 'ghost').catch(() => undefined);

    expect(appendSpy).not.toHaveBeenCalled();
    expect(appendGuardedSpy).not.toHaveBeenCalled();
    expect(await da.eventsByType('identity.registered')).toHaveLength(0);
  });

  it('only resolves the queried actor — another registered handle does not satisfy login', async () => {
    const da = memoryDataAccess();
    await register(da, { handle: 'ada', currentFocus: 'x' });

    await expect(login(da, 'bob')).rejects.toMatchObject({
      code: 'LOGIN_UNKNOWN',
    });
  });
});
