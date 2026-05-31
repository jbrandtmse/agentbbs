// Sub-board member-directory unit tests (Story 3.4, Task 4 / AC #1, #2, #3).
//
// `boardDirectory` JOINS the projects-membership fold (Story 3.1) against the identity
// fold (Epic 2). These tests drive it through a tiny fake DataAccess whose
// `eventsSince(0)` returns a hand-built, `seq`-ordered Event stream — the same fold
// inputs the real ledger would yield — and pin:
//   - a 2+ member board reflects each member's folded currentFocus + lastSeen in JOIN
//     order (announcer first), NOT registration order;
//   - a focus update advances that member's lastSeen AND changes currentFocus;
//   - an unknown board → BOARD_NOT_FOUND (and the read appends nothing — it's a read);
//   - an announcer-only board returns just the announcer;
//   - DECISION 1: the returned row carries lastSeen but NO `stale` flag.

import { describe, expect, it } from 'vitest';

import { BoardError } from '../errors.js';
import { boardDirectory } from './board-directory.js';

import type { Event } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/** Build an identity.registered Event. */
function reg(
  seq: number,
  handle: string,
  focus: string,
  createdAt: string,
): Event {
  return {
    seq,
    type: 'identity.registered',
    actor: handle,
    createdAt,
    payload: { handle, currentFocus: focus },
  };
}

/** Build an identity.focus_updated Event (advances lastSeen + currentFocus). */
function focus(
  seq: number,
  handle: string,
  newFocus: string,
  createdAt: string,
): Event {
  return {
    seq,
    type: 'identity.focus_updated',
    actor: handle,
    createdAt,
    payload: { handle, currentFocus: newFocus },
  };
}

/** Build a project.announced Event. */
function announced(
  seq: number,
  actor: string,
  projectId: string,
  title: string,
  createdAt: string,
): Event {
  return {
    seq,
    type: 'project.announced',
    actor,
    createdAt,
    payload: { projectId, title, description: 'desc' },
  };
}

/** Build a board.joined Event. */
function joined(
  seq: number,
  actor: string,
  projectId: string,
  createdAt: string,
): Event {
  return {
    seq,
    type: 'board.joined',
    actor,
    createdAt,
    payload: { projectId },
  };
}

/**
 * A read-only fake DataAccess: `eventsSince(0)` replays the given `seq`-ordered stream;
 * every mutator throws so a test proving "no append on the read path" fails loudly if
 * the read ever writes. Only `eventsSince` is exercised by `boardDirectory`.
 */
function fakeDataAccess(events: Event[]): DataAccess {
  const reject = (name: string) => () => {
    throw new Error(`boardDirectory must not call ${name} (it is a pure read)`);
  };
  return {
    eventsSince: async () => events,
    append: reject('append'),
    appendGuarded: reject('appendGuarded'),
    eventsByType: reject('eventsByType'),
    eventsByActor: reject('eventsByActor'),
    maxSeq: reject('maxSeq'),
  } as unknown as DataAccess;
}

describe('boardDirectory — membership ⋈ identity join (AC #1)', () => {
  it('returns each member with folded currentFocus + lastSeen in JOIN order (announcer first)', async () => {
    // bob registers FIRST (seq 1) but joins SECOND; ada announces (joins first).
    // Join order = [ada, bob]; registration order = [bob, ada]. They DISAGREE, so a
    // bug that iterates the identity fold instead of project.members would be caught.
    const events: Event[] = [
      reg(1, 'bob', 'browsing', '2026-05-31T00:00:01.000Z'),
      reg(2, 'ada', 'announcing', '2026-05-31T00:00:02.000Z'),
      announced(
        3,
        'ada',
        'calling-interface',
        'Calling Interface',
        '2026-05-31T00:00:03.000Z',
      ),
      joined(4, 'ada', 'calling-interface', '2026-05-31T00:00:04.000Z'),
      joined(5, 'bob', 'calling-interface', '2026-05-31T00:00:05.000Z'),
    ];

    const directory = await boardDirectory(
      fakeDataAccess(events),
      'calling-interface',
    );

    expect(directory).toEqual([
      {
        handle: 'ada',
        currentFocus: 'announcing',
        lastSeen: '2026-05-31T00:00:02.000Z',
      },
      {
        handle: 'bob',
        currentFocus: 'browsing',
        lastSeen: '2026-05-31T00:00:01.000Z',
      },
    ]);
    // DECISION 1: rows carry lastSeen but NO `stale` flag (core never fabricates time).
    expect(directory[0]).not.toHaveProperty('stale');
  });

  it('a focus update advances that member lastSeen AND changes currentFocus (AC #2)', async () => {
    const events: Event[] = [
      reg(1, 'ada', 'announcing', '2026-05-31T00:00:01.000Z'),
      announced(
        2,
        'ada',
        'calling-interface',
        'Calling Interface',
        '2026-05-31T00:00:02.000Z',
      ),
      joined(3, 'ada', 'calling-interface', '2026-05-31T00:00:03.000Z'),
      // ada updates her focus later — lastSeen must advance to this createdAt and
      // currentFocus must become the new value (proves the join reads the LATEST fold).
      focus(4, 'ada', 'reviewing pr', '2026-05-31T01:00:00.000Z'),
    ];

    const directory = await boardDirectory(
      fakeDataAccess(events),
      'calling-interface',
    );

    expect(directory).toEqual([
      {
        handle: 'ada',
        currentFocus: 'reviewing pr',
        lastSeen: '2026-05-31T01:00:00.000Z',
      },
    ]);
  });

  it('an announcer-only board returns just the announcer (AC #1)', async () => {
    const events: Event[] = [
      reg(1, 'ada', 'announcing', '2026-05-31T00:00:01.000Z'),
      announced(
        2,
        'ada',
        'solo-board',
        'Solo Board',
        '2026-05-31T00:00:02.000Z',
      ),
      joined(3, 'ada', 'solo-board', '2026-05-31T00:00:03.000Z'),
    ];

    const directory = await boardDirectory(
      fakeDataAccess(events),
      'solo-board',
    );

    expect(directory).toEqual([
      {
        handle: 'ada',
        currentFocus: 'announcing',
        lastSeen: '2026-05-31T00:00:01.000Z',
      },
    ]);
  });
});

describe('boardDirectory — unknown board (AC #3)', () => {
  it('throws BOARD_NOT_FOUND for a project_id that was never announced (no append)', async () => {
    const events: Event[] = [
      reg(1, 'ada', 'announcing', '2026-05-31T00:00:01.000Z'),
      announced(
        2,
        'ada',
        'calling-interface',
        'Calling Interface',
        '2026-05-31T00:00:02.000Z',
      ),
      joined(3, 'ada', 'calling-interface', '2026-05-31T00:00:03.000Z'),
    ];

    // The fake's mutators throw, so reaching BOARD_NOT_FOUND (not a mutator error)
    // proves the read appended nothing on the not-found path.
    await expect(
      boardDirectory(fakeDataAccess(events), 'does-not-exist'),
    ).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
    await expect(
      boardDirectory(fakeDataAccess(events), 'does-not-exist'),
    ).rejects.toBeInstanceOf(BoardError);
  });
});
