// Projects-projection unit tests (Story 3.1, Task 3 / AC #1).
//
// Pins the pure fold: a `project.announced` mints a record, the announcer's
// `board.joined` makes them the first member, membership accretes in join order
// (foundation for Story 3.3), unknown-project joins mint no phantom, and ordering
// is by `seq`. Pure functions under test — no DataAccess needed; we synthesize
// folded `Event`s directly.

import { describe, expect, it } from 'vitest';

import { findProject, foldProjects } from './projection.js';

import type { Event } from '../events/event.js';

/** Build a folded `project.announced` event (camelCase payload, as core sees it). */
function announced(
  seq: number,
  actor: string,
  projectId: string,
  title: string,
  description = 'desc',
): Event {
  return {
    seq,
    type: 'project.announced',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId, title, description },
  };
}

/** Build a folded `board.joined` event. */
function joined(seq: number, actor: string, projectId: string): Event {
  return {
    seq,
    type: 'board.joined',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId },
  };
}

describe('foldProjects — record + first member (AC #1)', () => {
  it('mints a project record from project.announced with the announcer as first member', () => {
    const events: Event[] = [
      announced(1, 'ada', 'calling-interface', 'Calling Interface', 'a board'),
      joined(2, 'ada', 'calling-interface'),
    ];

    const dir = foldProjects(events);
    expect(dir.size).toBe(1);
    expect(dir.get('calling-interface')).toEqual({
      projectId: 'calling-interface',
      title: 'Calling Interface',
      description: 'a board',
      announcer: 'ada',
      members: ['ada'],
      seq: 1,
    });
  });

  it('accretes additional members in join order, de-duplicated (foundation for 3.3)', () => {
    const events: Event[] = [
      announced(1, 'ada', 'p', 'P'),
      joined(2, 'ada', 'p'),
      joined(3, 'bob', 'p'),
      joined(4, 'ada', 'p'), // idempotent re-join — stays one 'ada'
      joined(5, 'cleo', 'p'),
    ];
    expect(foldProjects(events).get('p')?.members).toEqual([
      'ada',
      'bob',
      'cleo',
    ]);
  });

  it('ignores a board.joined for an unknown project (mints no phantom)', () => {
    const events: Event[] = [joined(1, 'ghost', 'no-such-project')];
    expect(foldProjects(events).size).toBe(0);
  });

  it('keeps the first announcement for a projectId and carries its seq for ordering', () => {
    const events: Event[] = [
      announced(3, 'ada', 'alpha', 'Alpha'),
      announced(5, 'bob', 'beta', 'Beta'),
    ];
    const dir = foldProjects(events);
    // Map preserves announcement (== seq) order.
    expect([...dir.keys()]).toEqual(['alpha', 'beta']);
    expect(dir.get('alpha')?.seq).toBe(3);
    expect(dir.get('beta')?.seq).toBe(5);
  });
});

describe('findProject', () => {
  it('resolves a single project by id, or undefined when absent', () => {
    const events: Event[] = [
      announced(1, 'ada', 'p', 'P'),
      joined(2, 'ada', 'p'),
    ];
    expect(findProject(events, 'p')?.title).toBe('P');
    expect(findProject(events, 'missing')).toBeUndefined();
  });
});
