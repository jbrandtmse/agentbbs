// `listProjects` board-read tests (Story 3.2, Task 1 / AC #1, #3).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included —
// from importing @agentbbs/data-access), so these drive `listProjects` against an
// IN-MEMORY DataAccess fake. The fake models the one contract this read relies on:
//   - eventsSince(0) returns ALL events, seq-ordered ascending.
// `listProjects` is a thin read over `foldProjects`, so the tests pin: empty ledger
// → []; multiple announces → a seq-ordered array of the folded records; membership
// accreted via board.joined shows in the entry; a board.joined for an unknown
// project mints no phantom directory entry. The fold itself is exhaustively tested in
// projection.test.ts; here we prove the read+sort wiring.

import { describe, expect, it } from 'vitest';

import { listProjects } from './list-projects.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * A minimal in-memory DataAccess exposing the seq-ordered event stream `listProjects`
 * reads. `append` assigns a monotonic seq and stamps createdAt; `eventsSince(cursor)`
 * returns events with seq > cursor, seq-ordered. The other port methods are present
 * (interface conformance) but unused by this read.
 */
function memoryDataAccess(): DataAccess {
  let seq = 0;
  const store: Event[] = [];

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
  };
}

/** Announce a project the way `announceProject` does: project.announced + board.joined. */
async function announce(
  da: DataAccess,
  actor: string,
  projectId: string,
  title: string,
  description: string,
): Promise<void> {
  await da.append([
    {
      type: 'project.announced',
      actor,
      payload: { projectId, title, description },
    },
    { type: 'board.joined', actor, payload: { projectId } },
  ]);
}

describe('listProjects — empty (AC #3)', () => {
  it('returns [] for an empty ledger (not an error)', async () => {
    const da = memoryDataAccess();
    await expect(listProjects(da)).resolves.toEqual([]);
  });
});

describe('listProjects — directory ordered by seq (AC #1)', () => {
  it('returns one entry per announced project, ordered by announcement seq, with the full record shape', async () => {
    const da = memoryDataAccess();
    await announce(
      da,
      'ada',
      'calling-interface',
      'Calling Interface',
      'first board',
    );
    await announce(da, 'bob', 'release-train', 'Release Train', 'second board');
    await announce(da, 'cleo', 'design-system', 'Design System', 'third board');

    const projects = await listProjects(da);

    // Ordered by announcement seq (the order they were announced), never createdAt.
    expect(projects.map((p) => p.projectId)).toEqual([
      'calling-interface',
      'release-train',
      'design-system',
    ]);
    // seq is strictly ascending across the directory.
    expect(projects.map((p) => p.seq)).toEqual(
      [...projects.map((p) => p.seq)].sort((a, b) => a - b),
    );
    // Full record shape for the first entry — announcer is the first member.
    expect(projects[0]).toMatchObject({
      projectId: 'calling-interface',
      title: 'Calling Interface',
      description: 'first board',
      announcer: 'ada',
      members: ['ada'],
    });
  });

  it('reflects accreted membership (a later board.joined shows in the entry)', async () => {
    const da = memoryDataAccess();
    await announce(
      da,
      'ada',
      'calling-interface',
      'Calling Interface',
      'board',
    );
    // A second identity joins the existing board (Story 3.3 shape).
    await da.append([
      {
        type: 'board.joined',
        actor: 'bob',
        payload: { projectId: 'calling-interface' },
      },
    ]);

    const [project] = await listProjects(da);
    expect(project?.members).toEqual(['ada', 'bob']);
  });

  it('mints no phantom entry for a board.joined whose project was never announced', async () => {
    const da = memoryDataAccess();
    await announce(da, 'ada', 'real-board', 'Real Board', 'announced');
    // A join for a project that does not exist — must NOT create a directory entry.
    await da.append([
      {
        type: 'board.joined',
        actor: 'bob',
        payload: { projectId: 'ghost-board' },
      },
    ]);

    const projects = await listProjects(da);
    expect(projects.map((p) => p.projectId)).toEqual(['real-board']);
  });
});
