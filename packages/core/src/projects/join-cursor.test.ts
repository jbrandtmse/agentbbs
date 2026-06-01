// Per-(identity, board) join-cursor projection unit tests (Story 6.1, Task 2).
//
// Pins the per-board announcement FLOOR — `boardJoinSeq` derives the `seq` of a handle's
// EARLIEST `board.joined` for a sub-board, or `undefined` if they never joined. The analogue of
// Story 4.6's per-room `roomJoinSeq`, for announcements. No I/O — pure folds over hand-built,
// `seq`-ordered Event streams.
//
// Coverage:
//   - a member's floor is their `board.joined` `seq`;
//   - the ANNOUNCER (who `board.joined` via announceProject, atomically with project.announced)
//     has a floor (their auto-join `seq`);
//   - a non-member (registered, never joined) → `undefined`;
//   - a non-existent handle → `undefined`; an unknown board → `undefined`; empty stream → `undefined`;
//   - re-joined (two `board.joined` for the same board+actor) → the EARLIEST `seq`;
//   - cross-board isolation: a join in board A sets NO floor in board B;
//   - order-independence: an out-of-order input still yields the MIN `seq`;
//   - the join `seq` is the actor's OWN join, not another member's join of the same board.

import { describe, expect, it } from 'vitest';

import { boardJoinSeq } from './join-cursor.js';

import type { Event } from '../events/event.js';

/** Build an identity.registered Event. */
function reg(seq: number, handle: string): Event {
  return {
    seq,
    type: 'identity.registered',
    actor: handle,
    createdAt: `2026-05-31T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload: { handle, currentFocus: 'x' },
  };
}

/** Build a project.announced Event (mints a board; the announcer joins via a separate board.joined). */
function announced(seq: number, actor: string, projectId: string): Event {
  return {
    seq,
    type: 'project.announced',
    actor,
    createdAt: `2026-05-31T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload: { projectId, title: projectId, description: 'd' },
  };
}

/** Build a board.joined Event (its actor becomes a member of `projectId`). */
function joined(seq: number, actor: string, projectId: string): Event {
  return {
    seq,
    type: 'board.joined',
    actor,
    createdAt: `2026-05-31T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload: { projectId },
  };
}

/**
 * ada announces `calling-interface` (auto-joins at seq 5); bob registers + joins (seq 6);
 * cleo only registers (never joins). Mirrors the membership.test.ts ledger shape.
 */
function ledger(): Event[] {
  return [
    reg(1, 'ada'),
    reg(2, 'bob'),
    reg(3, 'cleo'),
    announced(4, 'ada', 'calling-interface'),
    joined(5, 'ada', 'calling-interface'), // announcer auto-join (announceProject appends this)
    joined(6, 'bob', 'calling-interface'), // a non-announcer joins
  ];
}

describe('boardJoinSeq — a member’s floor is their board.joined seq', () => {
  it('returns a joined non-announcer’s board.joined seq', () => {
    expect(boardJoinSeq(ledger(), 'calling-interface', 'bob')).toBe(6);
  });

  it('returns the ANNOUNCER’s auto-join seq (announcer is a member via announceProject)', () => {
    // ada never explicitly join_board'd, but announceProject appended her board.joined (seq 5).
    expect(boardJoinSeq(ledger(), 'calling-interface', 'ada')).toBe(5);
  });
});

describe('boardJoinSeq — non-members → undefined', () => {
  it('returns undefined for a registered handle that never joined the board', () => {
    expect(boardJoinSeq(ledger(), 'calling-interface', 'cleo')).toBeUndefined();
  });

  it('returns undefined for a handle that does not exist at all', () => {
    expect(
      boardJoinSeq(ledger(), 'calling-interface', 'nobody'),
    ).toBeUndefined();
  });

  it('returns undefined for an unknown board', () => {
    expect(boardJoinSeq(ledger(), 'no-such-board', 'ada')).toBeUndefined();
  });

  it('returns undefined for an empty stream', () => {
    expect(boardJoinSeq([], 'calling-interface', 'ada')).toBeUndefined();
  });
});

describe('boardJoinSeq — EARLIEST wins', () => {
  it('returns the EARLIEST seq when the handle joined the same board more than once', () => {
    const events: Event[] = [
      reg(1, 'ada'),
      announced(2, 'ada', 'board-a'),
      joined(3, 'ada', 'board-a'), // first join (announcer auto-join)
      joined(7, 'ada', 'board-a'), // a later (idempotent) re-join — must NOT win
    ];
    expect(boardJoinSeq(events, 'board-a', 'ada')).toBe(3);
  });

  it('takes the MIN seq even when the input is not seq-ordered (order-independence)', () => {
    const events: Event[] = [
      joined(9, 'ada', 'board-a'),
      joined(4, 'ada', 'board-a'), // earliest, appears later in the array
      reg(1, 'ada'),
    ];
    expect(boardJoinSeq(events, 'board-a', 'ada')).toBe(4);
  });
});

describe('boardJoinSeq — cross-board + cross-actor isolation', () => {
  it('a join in board A does NOT set a floor in board B', () => {
    const events: Event[] = [
      reg(1, 'ada'),
      announced(2, 'ada', 'board-a'),
      joined(3, 'ada', 'board-a'),
      announced(4, 'ada', 'board-b'),
      joined(5, 'ada', 'board-b'),
    ];
    expect(boardJoinSeq(events, 'board-a', 'ada')).toBe(3);
    expect(boardJoinSeq(events, 'board-b', 'ada')).toBe(5);
  });

  it('returns the actor’s OWN join seq, not another member’s join of the same board', () => {
    // bob (seq 6) and ada (seq 5) are both members of calling-interface; bob's floor is 6, not 5.
    expect(boardJoinSeq(ledger(), 'calling-interface', 'bob')).toBe(6);
    expect(boardJoinSeq(ledger(), 'calling-interface', 'ada')).toBe(5);
  });
});
