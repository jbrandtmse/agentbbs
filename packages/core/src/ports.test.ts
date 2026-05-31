// DataAccess port contract (Story 1.3, AC2).
//
// The port has no runtime surface in this story (it is an interface — no
// implementation until Story 1.4). These are type-level assertions plus a
// minimal in-memory conformer proving the SHAPE is implementable and that the
// V1-synchronous-impl-conforms-by-resolving-Promises claim holds.

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { DataAccess } from './ports.js';
import type { Event, NewEvent } from './events/event.js';

describe('DataAccess port (AC2)', () => {
  it('all methods are async (Promise-returning) — the NFR2 seam decision', () => {
    expectTypeOf<DataAccess['append']>().returns.toEqualTypeOf<
      Promise<number[]>
    >();
    expectTypeOf<DataAccess['eventsSince']>().returns.toEqualTypeOf<
      Promise<Event[]>
    >();
    expectTypeOf<DataAccess['eventsByType']>().returns.toEqualTypeOf<
      Promise<Event[]>
    >();
    expectTypeOf<DataAccess['eventsByActor']>().returns.toEqualTypeOf<
      Promise<Event[]>
    >();
    expectTypeOf<DataAccess['maxSeq']>().returns.toEqualTypeOf<
      Promise<number>
    >();
  });

  it('append takes NewEvent[] and returns the assigned seq[]', () => {
    expectTypeOf<DataAccess['append']>().parameters.toEqualTypeOf<
      [NewEvent[]]
    >();
  });

  it('a synchronous V1-style impl conforms by returning resolved Promises', async () => {
    // Proves the interface is satisfiable by a synchronous backend (better-sqlite3
    // in V1) AND by an async one (V2 HTTP) — the identical-interface swap claim.
    let seq = 0;
    const store: Event[] = [];
    const da: DataAccess = {
      append(events: NewEvent[]): Promise<number[]> {
        const assigned = events.map((e) => {
          seq += 1;
          store.push({
            ...e,
            seq,
            createdAt: '2026-05-30T00:00:00.000Z',
          } as Event);
          return seq;
        });
        return Promise.resolve(assigned);
      },
      eventsSince: (cursor) =>
        Promise.resolve(store.filter((e) => e.seq > cursor)),
      eventsByType: (type) =>
        Promise.resolve(store.filter((e) => e.type === type)),
      eventsByActor: (actor) =>
        Promise.resolve(store.filter((e) => e.actor === actor)),
      maxSeq: () => Promise.resolve(seq),
    };

    const seqs = await da.append([
      { type: 'identity.seen', actor: 'alice', payload: { handle: 'alice' } },
      { type: 'identity.seen', actor: 'bob', payload: { handle: 'bob' } },
    ]);
    expect(seqs).toEqual([1, 2]);
    expect(await da.maxSeq()).toBe(2);
    expect(await da.eventsSince(1)).toHaveLength(1);
    expect(await da.eventsByActor('alice')).toHaveLength(1);
  });
});
