// `register` board-operation tests (Story 2.2, Task 3 / AC #1, #2).
//
// core depends ONLY on the DataAccess port (and the lint forbids core — tests
// included — from importing @agentbbs/data-access), so these drive `register`
// against an IN-MEMORY DataAccess fake. The fake faithfully models the contract
// the real adapter guarantees and this op relies on:
//   - appendGuarded assigns createdAt at append (core must read it back, not
//     fabricate it) and enforces the uniqueness guard, rejecting a violation with
//     a value carrying the stable `code: 'UNIQUENESS_CONFLICT'` discriminant;
//   - eventsByActor returns that actor's events, seq-ordered.
// The REAL atomic cross-process guarantee is proven elsewhere (the data-access
// appendGuarded unit tests, the mcp-server integration test, and the cross-process
// race) — here we pin core's logic: success shape, HANDLE_TAKEN mapping, canonical
// case-folding, and createdAt/lastSeen read-back.

import { describe, expect, it } from 'vitest';

import { BoardError } from '../errors.js';
import { register } from './register.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess, UniquenessGuard } from '../ports.js';

/** A uniqueness-conflict-shaped rejection, matching the adapter's discriminant. */
class FakeUniquenessConflict extends Error {
  readonly code = 'UNIQUENESS_CONFLICT' as const;
}

/**
 * A minimal in-memory DataAccess modeling the bits `register` exercises. seq is a
 * monotonic counter; createdAt is stamped by the fake at append (so the test can
 * assert core reads the FAKE-assigned value back, never a core-fabricated one).
 * appendGuarded enforces guards against the in-memory store exactly like the real
 * adapter (atomic check-then-insert is irrelevant single-threaded, but the
 * reject-on-violation contract is what core depends on).
 */
function memoryDataAccess(opts?: { createdAt?: () => string }): DataAccess {
  let seq = 0;
  const store: Event[] = [];
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
          return Promise.reject(
            new FakeUniquenessConflict('handle already registered'),
          );
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
  };
}

describe('register — success (AC #1)', () => {
  it('appends identity.registered and returns the identity with createdAt READ BACK and lastSeen === createdAt', async () => {
    const fixedTime = '2026-05-31T08:00:00.000Z';
    const da = memoryDataAccess({ createdAt: () => fixedTime });

    const identity = await register(da, {
      handle: 'ada',
      currentFocus: 'shipping 2.2',
    });

    expect(identity).toEqual({
      handle: 'ada',
      currentFocus: 'shipping 2.2',
      createdAt: fixedTime,
      lastSeen: fixedTime, // === createdAt at registration
    });

    // Exactly one identity.registered event was appended for this handle.
    const events = await da.eventsByType('identity.registered');
    expect(events).toHaveLength(1);
    expect(events[0]?.actor).toBe('ada');
    expect(events[0]?.payload).toEqual({
      handle: 'ada',
      currentFocus: 'shipping 2.2',
    });
  });

  it('uses the createdAt the data-access layer assigned, not a value core invents', async () => {
    // Distinct sentinel the test controls: if core fabricated a timestamp this
    // would not match.
    const sentinel = '2000-01-01T00:00:00.000Z';
    const da = memoryDataAccess({ createdAt: () => sentinel });
    const identity = await register(da, { handle: 'bob', currentFocus: 'x' });
    expect(identity.createdAt).toBe(sentinel);
    expect(identity.lastSeen).toBe(sentinel);
  });
});

describe('register — uniqueness conflict (AC #2)', () => {
  it('throws BoardError(HANDLE_TAKEN) when the handle is already registered, and appends nothing new', async () => {
    const da = memoryDataAccess();
    await register(da, { handle: 'ada', currentFocus: 'first' });

    await expect(
      register(da, { handle: 'ada', currentFocus: 'second' }),
    ).rejects.toBeInstanceOf(BoardError);

    const err = await register(da, {
      handle: 'ada',
      currentFocus: 'third',
    }).catch((e: unknown) => e);
    expect((err as BoardError).code).toBe('HANDLE_TAKEN');

    // No duplicate event was appended despite the two rejected attempts.
    const events = await da.eventsByType('identity.registered');
    expect(events).toHaveLength(1);
  });

  it('case-folds: registering the canonical "ada" then again collides (HANDLE_TAKEN)', async () => {
    // The MCP boundary rejects non-lowercase handles before core (AC #3 decision:
    // schema accepts only already-canonical handles). So at the core layer the
    // collision is between two identical canonical handles. register also
    // defensively lowercases, so even a stray uppercase that reached core would
    // collapse to the same canonical key.
    const da = memoryDataAccess();
    await register(da, { handle: 'ada', currentFocus: 'first' });
    await expect(
      register(da, { handle: 'Ada', currentFocus: 'second' }),
    ).rejects.toMatchObject({ code: 'HANDLE_TAKEN' });
    // Still exactly one registration.
    expect(await da.eventsByType('identity.registered')).toHaveLength(1);
  });

  it('canonicalizes the stored actor/payload handle to lowercase', async () => {
    const da = memoryDataAccess();
    const identity = await register(da, {
      handle: 'MixedCase',
      currentFocus: 'x',
    });
    expect(identity.handle).toBe('mixedcase');
    const events = await da.eventsByType('identity.registered');
    expect(events[0]?.actor).toBe('mixedcase');
    expect((events[0]?.payload as { handle: string }).handle).toBe('mixedcase');
  });
});

describe('register — non-conflict errors propagate', () => {
  it('lets a non-uniqueness rejection from the port propagate unchanged (not mapped to HANDLE_TAKEN)', async () => {
    const da = memoryDataAccess();
    const boom = new Error('store busy or some infra fault');
    da.appendGuarded = () => Promise.reject(boom);

    const err = await register(da, {
      handle: 'ada',
      currentFocus: 'x',
    }).catch((e: unknown) => e);
    // Propagated as-is — NOT a BoardError, NOT swallowed.
    expect(err).toBe(boom);
    expect(err).not.toBeInstanceOf(BoardError);
  });
});
