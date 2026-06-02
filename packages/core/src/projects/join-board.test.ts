// `joinBoard` board-operation tests (Story 3.3, Task 2 / AC #1, #2, #3, #4).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included —
// from importing @agentbbs/data-access), so these drive `joinBoard` against an
// IN-MEMORY DataAccess fake that records appends. The fake models the contract the
// real adapter guarantees and this op relies on:
//   - `append` appends events and assigns monotonic seqs;
//   - `eventsSince(0)` returns the full stream, seq-ordered.
// The REAL cross-process / real-runtime guarantee is proven by the mcp-server
// integration test (AC #6); here we pin core's logic:
//   - join an existing board → member appears + exactly one board.joined (AC #1);
//   - unknown board → BoardError('BOARD_NOT_FOUND') + NOTHING appended (AC #2);
//   - multi-board membership: join X then Y → member of both (AC #3);
//   - idempotent re-join: already a member → NO second board.joined, success (AC #4).

import { describe, expect, it } from 'vitest';

import { BoardError } from '../errors.js';
import { announceProject } from './announce-project.js';
import { joinBoard } from './join-board.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess, UniquenessGuard } from '../ports.js';

/**
 * A minimal in-memory DataAccess for `joinBoard` + the `announceProject` setup it
 * builds on. seq is a monotonic counter; createdAt is stamped at append. appendGuarded
 * enforces guards against the at-rest (snake_case) store (so announceProject's dual
 * guard behaves), and `append` is a plain append. Reads are seq-ordered.
 */
function memoryDataAccess(): DataAccess {
  let seq = 0;
  const store: Event[] = [];
  const cursors = new Map<string, number>();

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

describe('joinBoard — join an existing board (AC #1)', () => {
  it('appends one board.joined and returns the project with the actor as a member', async () => {
    const da = memoryDataAccess();
    await announceProject(da, 'ada', {
      title: 'Calling Interface',
      description: 'a coordination board',
    });
    // Baseline: only ada's announce-join exists.
    expect(await da.eventsByType('board.joined')).toHaveLength(1);

    const project = await joinBoard(da, 'bob', 'calling-interface');

    expect(project).toMatchObject({
      projectId: 'calling-interface',
      announcer: 'ada',
    });
    // bob is now a member, after the announcer.
    expect(project.members).toEqual(['ada', 'bob']);

    // Exactly one ADDITIONAL board.joined (bob's), for the right project + actor.
    const joins = await da.eventsByType('board.joined');
    expect(joins).toHaveLength(2);
    expect(joins[1]?.actor).toBe('bob');
    expect(joins[1]?.payload).toEqual({ projectId: 'calling-interface' });
  });
});

describe('joinBoard — unknown board (AC #2)', () => {
  it('throws BoardError(BOARD_NOT_FOUND) and appends NOTHING', async () => {
    const da = memoryDataAccess();
    await announceProject(da, 'ada', { title: 'Real', description: 'exists' });
    const before = (await da.eventsSince(0)).length;

    const err = await joinBoard(da, 'bob', 'ghost-board').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('BOARD_NOT_FOUND');

    // No event appended on the rejected path.
    expect(await da.eventsSince(0)).toHaveLength(before);
  });
});

describe('joinBoard — multi-board membership (AC #3)', () => {
  it('a member of one board joining another is a member of BOTH', async () => {
    const da = memoryDataAccess();
    await announceProject(da, 'ada', { title: 'Board X', description: 'x' });
    await announceProject(da, 'ada', { title: 'Board Y', description: 'y' });

    const x = await joinBoard(da, 'bob', 'board-x');
    const y = await joinBoard(da, 'bob', 'board-y');

    expect(x.members).toContain('bob');
    expect(y.members).toContain('bob');

    // Two distinct bob joins (one per board), both present.
    const bobJoins = (await da.eventsByType('board.joined')).filter(
      (e) => e.actor === 'bob',
    );
    expect(bobJoins.map((e) => e.payload)).toEqual([
      { projectId: 'board-x' },
      { projectId: 'board-y' },
    ]);
  });
});

describe('joinBoard — idempotent re-join (AC #4)', () => {
  it('re-joining the SAME board succeeds but appends NO second board.joined', async () => {
    const da = memoryDataAccess();
    await announceProject(da, 'ada', { title: 'Board X', description: 'x' });
    await joinBoard(da, 'bob', 'board-x');

    const joinsAfterFirst = (await da.eventsByType('board.joined')).filter(
      (e) => e.actor === 'bob',
    ).length;
    expect(joinsAfterFirst).toBe(1);

    // Re-join: succeeds, returns the project with bob a (single) member …
    const again = await joinBoard(da, 'bob', 'board-x');
    expect(again.members).toEqual(['ada', 'bob']);

    // … but NO additional board.joined was appended (idempotent no-op).
    const joinsAfterSecond = (await da.eventsByType('board.joined')).filter(
      (e) => e.actor === 'bob',
    ).length;
    expect(joinsAfterSecond).toBe(1);
  });

  it('the announcer re-joining their own board is also a no-op', async () => {
    const da = memoryDataAccess();
    await announceProject(da, 'ada', { title: 'Board X', description: 'x' });
    const beforeJoins = (await da.eventsByType('board.joined')).length;

    const project = await joinBoard(da, 'ada', 'board-x');
    expect(project.members).toEqual(['ada']);

    // No new board.joined — ada was already the first member via the announce.
    expect(await da.eventsByType('board.joined')).toHaveLength(beforeJoins);
  });
});
