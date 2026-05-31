// `announceProject` board-operation tests (Story 3.1, Task 2 / AC #1, #2).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included —
// from importing @agentbbs/data-access), so these drive `announceProject` against an
// IN-MEMORY DataAccess fake. The fake models the contract the real adapter
// guarantees and this op relies on:
//   - appendGuarded appends ALL events atomically and enforces EVERY guard against
//     the AT-REST (snake_case) payload, rejecting a violation with the stable
//     `code: 'UNIQUENESS_CONFLICT'` discriminant — and on rejection appends NOTHING;
//   - eventsByActor returns that actor's events, seq-ordered.
// The REAL atomic cross-process guarantee is proven elsewhere (the data-access
// appendGuarded unit tests + the mcp-server integration test); here we pin core's
// logic: two-event happy path, the returned Project, PROJECT_EXISTS on a duplicate
// title AND on a distinct-title→same-slug collision, and "nothing appended" on
// conflict.

import { describe, expect, it } from 'vitest';

import { BoardError } from '../errors.js';
import { announceProject } from './announce-project.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess, UniquenessGuard } from '../ports.js';

/** A uniqueness-conflict-shaped rejection, matching the adapter's discriminant. */
class FakeUniquenessConflict extends Error {
  readonly code = 'UNIQUENESS_CONFLICT' as const;
}

/**
 * A minimal in-memory DataAccess modeling the bits `announceProject` exercises. seq
 * is a monotonic counter; createdAt is stamped by the fake at append. appendGuarded
 * enforces guards against the in-memory store using the AT-REST (snake_case) payload
 * keys — faithfully reproducing the data-access boundary, so a guard on
 * `field: 'project_id'` must match the stored `project_id` key. CRUCIALLY it checks
 * ALL guards BEFORE appending ANY event, so a conflict appends nothing (AC #2).
 */
function memoryDataAccess(): DataAccess {
  let seq = 0;
  const store: Event[] = [];

  /** Project the camelCase payload to the at-rest snake_case shape the guards see. */
  const atRest = (e: NewEvent): Record<string, unknown> => {
    if (e.type === 'project.announced') {
      return {
        project_id: e.payload.projectId,
        title: e.payload.title,
        description: e.payload.description,
      };
    }
    if (e.type === 'board.joined') {
      return { project_id: e.payload.projectId };
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
      // Check EVERY guard against the at-rest store BEFORE appending anything.
      for (const guard of guards) {
        const collides = store.some(
          (e) =>
            e.type === guard.type &&
            atRest(e as unknown as NewEvent)[guard.field] === guard.value,
        );
        if (collides) {
          return Promise.reject(new FakeUniquenessConflict('already exists'));
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

describe('announceProject — success (AC #1)', () => {
  it('appends project.announced + board.joined atomically and returns the project with the announcer as first member', async () => {
    const da = memoryDataAccess();

    const project = await announceProject(da, 'ada', {
      title: 'Calling Interface',
      description: 'a coordination board',
    });

    expect(project).toMatchObject({
      projectId: 'calling-interface',
      title: 'Calling Interface',
      description: 'a coordination board',
      announcer: 'ada',
      members: ['ada'],
    });
    expect(project.seq).toBeGreaterThan(0);

    // Exactly one project.announced (correct payload) and one board.joined.
    const announced = await da.eventsByType('project.announced');
    expect(announced).toHaveLength(1);
    expect(announced[0]?.actor).toBe('ada');
    expect(announced[0]?.payload).toEqual({
      projectId: 'calling-interface',
      title: 'Calling Interface',
      description: 'a coordination board',
    });

    const joins = await da.eventsByType('board.joined');
    expect(joins).toHaveLength(1);
    expect(joins[0]?.actor).toBe('ada');
    expect(joins[0]?.payload).toEqual({ projectId: 'calling-interface' });
    // board.joined was appended AFTER project.announced (same transaction).
    expect(joins[0]!.seq).toBeGreaterThan(announced[0]!.seq);
  });
});

describe('announceProject — uniqueness conflict (AC #2)', () => {
  it('throws BoardError(PROJECT_EXISTS) on a duplicate title and appends NOTHING', async () => {
    const da = memoryDataAccess();
    await announceProject(da, 'ada', { title: 'Shared', description: 'first' });

    const err = await announceProject(da, 'bob', {
      title: 'Shared',
      description: 'second',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('PROJECT_EXISTS');

    // Nothing extra appended despite the rejected attempt — still 1 + 1.
    expect(await da.eventsByType('project.announced')).toHaveLength(1);
    expect(await da.eventsByType('board.joined')).toHaveLength(1);
  });

  it('rejects a DISTINCT title that slugs to the SAME id (dual guard) with PROJECT_EXISTS', async () => {
    const da = memoryDataAccess();
    // Both slug to "hello-world" but the titles differ — the title guard would NOT
    // catch this; the project_id guard does.
    await announceProject(da, 'ada', {
      title: 'Hello World',
      description: 'first',
    });

    const err = await announceProject(da, 'bob', {
      title: 'hello, world!',
      description: 'second',
    }).catch((e: unknown) => e);
    expect((err as BoardError).code).toBe('PROJECT_EXISTS');

    expect(await da.eventsByType('project.announced')).toHaveLength(1);
    expect(await da.eventsByType('board.joined')).toHaveLength(1);
  });

  it('lets a non-uniqueness rejection from the port propagate unchanged (not mapped to PROJECT_EXISTS)', async () => {
    const da = memoryDataAccess();
    const boom = new Error('store busy or some infra fault');
    da.appendGuarded = () => Promise.reject(boom);

    const err = await announceProject(da, 'ada', {
      title: 'X',
      description: 'y',
    }).catch((e: unknown) => e);
    expect(err).toBe(boom);
    expect(err).not.toBeInstanceOf(BoardError);
  });
});
