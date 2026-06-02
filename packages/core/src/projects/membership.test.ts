// Membership write-gate unit tests (Story 3.5, Task 4 / AC #2, #3).
//
// Covers the two primitives `membership.ts` ships:
//   - `isMember(project, actor)` — pure predicate: true for the announcer (auto-joined)
//     and for a joined non-announcer; false for a registered-but-not-joined identity.
//   - `requireMembership(dataAccess, actor, projectId)` — the throwing gate the Epic 4
//     post tools call before appending: member → resolves (no throw); non-member of an
//     EXISTING board → NOT_A_MEMBER; an UNANNOUNCED board → BOARD_NOT_FOUND (distinct).
//
// The gate folds a hand-built, `seq`-ordered Event stream through a tiny fake DataAccess
// (same inputs the real ledger yields) whose mutators all throw — so reaching a
// BoardError (not a mutator error) PROVES the gate appended nothing (pure authorization).

import { describe, expect, it } from 'vitest';

import { BoardError } from '../errors.js';
import { findProject } from './projection.js';
import { isMember, requireMembership } from './membership.js';

import type { Event } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/** Build an identity.registered Event. */
function reg(seq: number, handle: string, focus: string): Event {
  return {
    seq,
    type: 'identity.registered',
    actor: handle,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { handle, currentFocus: focus },
  };
}

/** Build a project.announced Event. */
function announced(seq: number, actor: string, projectId: string): Event {
  return {
    seq,
    type: 'project.announced',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId, title: projectId, description: 'desc' },
  };
}

/** Build a board.joined Event. */
function joined(seq: number, actor: string, projectId: string): Event {
  return {
    seq,
    type: 'board.joined',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId },
  };
}

/**
 * A read-only fake DataAccess: `eventsSince(0)` replays the given `seq`-ordered stream;
 * every mutator throws so a test proving "no append on the gate path" fails loudly if the
 * gate ever writes. Only `eventsSince` is exercised by `requireMembership`.
 */
function fakeDataAccess(events: Event[]): DataAccess {
  const reject = (name: string) => () => {
    throw new Error(
      `requireMembership must not call ${name} (it is a pure gate)`,
    );
  };
  return {
    eventsSince: async () => events,
    append: reject('append'),
    appendGuarded: reject('appendGuarded'),
    eventsByType: reject('eventsByType'),
    eventsByActor: reject('eventsByActor'),
    maxSeq: reject('maxSeq'),
    getCursor: reject('getCursor'),
    setCursor: reject('setCursor'),
  } as unknown as DataAccess;
}

/** ada announces `calling-interface` (auto-joins); bob registers + joins; cleo only registers. */
function ledger(): Event[] {
  return [
    reg(1, 'ada', 'announcing'),
    reg(2, 'bob', 'browsing'),
    reg(3, 'cleo', 'observing'),
    announced(4, 'ada', 'calling-interface'),
    joined(5, 'ada', 'calling-interface'), // announcer auto-join (announceProject appends this)
    joined(6, 'bob', 'calling-interface'), // a non-announcer joins
  ];
}

describe('isMember — pure membership predicate (AC #2)', () => {
  it('is true for the announcer (auto-joined) and a joined non-announcer; false otherwise', () => {
    const project = findProject(ledger(), 'calling-interface')!;
    expect(project.members).toEqual(['ada', 'bob']);

    expect(isMember(project, 'ada')).toBe(true); // announcer
    expect(isMember(project, 'bob')).toBe(true); // joined non-announcer
    expect(isMember(project, 'cleo')).toBe(false); // registered, never joined
    expect(isMember(project, 'nobody')).toBe(false); // not even registered
  });
});

describe('requireMembership — the write-gate (AC #2)', () => {
  it('resolves (no throw) for the announcer (auto-joined member)', async () => {
    await expect(
      requireMembership(fakeDataAccess(ledger()), 'ada', 'calling-interface'),
    ).resolves.toBeUndefined();
  });

  it('resolves (no throw) for a joined non-announcer member', async () => {
    await expect(
      requireMembership(fakeDataAccess(ledger()), 'bob', 'calling-interface'),
    ).resolves.toBeUndefined();
  });

  it('rejects with NOT_A_MEMBER for a registered non-member of an EXISTING board (no append)', async () => {
    // The fake's mutators throw, so reaching NOT_A_MEMBER (not a mutator error) proves
    // the gate appended nothing on the rejection path — it is pure authorization.
    await expect(
      requireMembership(fakeDataAccess(ledger()), 'cleo', 'calling-interface'),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    await expect(
      requireMembership(fakeDataAccess(ledger()), 'cleo', 'calling-interface'),
    ).rejects.toBeInstanceOf(BoardError);
  });
});

describe('requireMembership — unknown board (AC #3)', () => {
  it('rejects with BOARD_NOT_FOUND for a project_id that was never announced (distinct from NOT_A_MEMBER)', async () => {
    // BOARD_NOT_FOUND (board never existed) is DISTINCT from NOT_A_MEMBER (board exists,
    // actor not joined): you cannot be a member of a board that does not exist.
    await expect(
      requireMembership(fakeDataAccess(ledger()), 'ada', 'no-such-board'),
    ).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
    await expect(
      requireMembership(fakeDataAccess(ledger()), 'ada', 'no-such-board'),
    ).rejects.toBeInstanceOf(BoardError);
  });

  it('prefers BOARD_NOT_FOUND over NOT_A_MEMBER when the board is unknown even for a non-member actor', async () => {
    // A non-member acting on an unknown board still gets BOARD_NOT_FOUND (existence is
    // checked first) — the two codes never collapse into one.
    await expect(
      requireMembership(fakeDataAccess(ledger()), 'cleo', 'no-such-board'),
    ).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
  });
});
