// Identity directory projection tests (Story 2.2, Task 2 / AC #1).
//
// The fold is pure, so these are plain in-memory unit tests over hand-built
// `seq`-ordered Event arrays (no DataAccess needed). They pin:
//   - one identity.registered → one record with handle/currentFocus/createdAt and
//     lastSeen === createdAt at registration;
//   - multiple registrations fold independently and keep registration order;
//   - lastSeen is DERIVED (taken from the identity's latest-seq event's createdAt),
//     never invented — proven by appending a later identity event for the same
//     handle and watching lastSeen advance while createdAt stays put;
//   - non-identity events (and events for other actors) don't pollute a record;
//   - findIdentity resolves one handle (and returns undefined when absent).

import { describe, expect, it } from 'vitest';

import { findIdentity, foldIdentities } from './projection.js';

import type { Event } from '../events/event.js';

/** Build an identity.registered Event at a given seq/createdAt. */
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

/** Build an identity.seen Event (used to prove lastSeen derivation is additive). */
function seen(seq: number, handle: string, createdAt: string): Event {
  return {
    seq,
    type: 'identity.seen',
    actor: handle,
    createdAt,
    payload: { handle },
  };
}

/** Build an identity.focus_updated Event at a given seq/createdAt (Story 2.4). */
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

describe('foldIdentities — registration (AC #1)', () => {
  it('folds one identity.registered into one record (handle, currentFocus, createdAt, lastSeen)', () => {
    const dir = foldIdentities([
      reg(1, 'ada', 'shipping 2.2', '2026-05-31T00:00:00.000Z'),
    ]);

    expect(dir.size).toBe(1);
    expect(dir.get('ada')).toEqual({
      handle: 'ada',
      currentFocus: 'shipping 2.2',
      createdAt: '2026-05-31T00:00:00.000Z',
      // lastSeen === createdAt at registration (this story's contract).
      lastSeen: '2026-05-31T00:00:00.000Z',
    });
  });

  it('folds multiple registrations independently, preserving registration order', () => {
    const dir = foldIdentities([
      reg(1, 'ada', 'a', '2026-05-31T00:00:01.000Z'),
      reg(2, 'bob', 'b', '2026-05-31T00:00:02.000Z'),
      reg(3, 'cleo', 'c', '2026-05-31T00:00:03.000Z'),
    ]);

    expect([...dir.keys()]).toEqual(['ada', 'bob', 'cleo']);
    expect(dir.get('bob')?.currentFocus).toBe('b');
    expect(dir.get('cleo')?.createdAt).toBe('2026-05-31T00:00:03.000Z');
    // Each record's lastSeen equals its own createdAt (only its registration so far).
    for (const id of dir.values()) {
      expect(id.lastSeen).toBe(id.createdAt);
    }
  });

  it('keeps the EARLIEST registration as canonical createdAt (defensive against a duplicate)', () => {
    // appendGuarded forbids a duplicate identity.registered in practice; the fold
    // is defensive — the first registration's createdAt wins, not a later one.
    const dir = foldIdentities([
      reg(1, 'ada', 'first', '2026-05-31T00:00:01.000Z'),
      reg(5, 'ada', 'second', '2026-05-31T00:00:09.000Z'),
    ]);
    expect(dir.size).toBe(1);
    expect(dir.get('ada')?.createdAt).toBe('2026-05-31T00:00:01.000Z');
    expect(dir.get('ada')?.currentFocus).toBe('first');
  });
});

describe('foldIdentities — identity.focus_updated (Story 2.4, AC #1)', () => {
  it('overwrites currentFocus with the focus_updated value and advances lastSeen', () => {
    const dir = foldIdentities([
      reg(1, 'ada', 'old focus', '2026-05-31T00:00:01.000Z'),
      focus(2, 'ada', 'new focus', '2026-05-31T00:05:00.000Z'),
    ]);

    const ada = dir.get('ada');
    // currentFocus is the latest (focus_updated) value, NOT the registration value.
    expect(ada?.currentFocus).toBe('new focus');
    // createdAt stays pinned to the registration; lastSeen advanced to the update.
    expect(ada?.createdAt).toBe('2026-05-31T00:00:01.000Z');
    expect(ada?.lastSeen).toBe('2026-05-31T00:05:00.000Z');
  });

  it('keeps the LATEST focus across multiple sequential updates (folded in seq order)', () => {
    const dir = foldIdentities([
      reg(1, 'ada', 'focus-0', '2026-05-31T00:00:01.000Z'),
      focus(2, 'ada', 'focus-1', '2026-05-31T00:01:00.000Z'),
      focus(3, 'ada', 'focus-2', '2026-05-31T00:02:00.000Z'),
      focus(4, 'ada', 'focus-3', '2026-05-31T00:03:00.000Z'),
    ]);

    const ada = dir.get('ada');
    expect(ada?.currentFocus).toBe('focus-3');
    expect(ada?.lastSeen).toBe('2026-05-31T00:03:00.000Z');
    expect(ada?.createdAt).toBe('2026-05-31T00:00:01.000Z');
  });

  it('folds focus updates strictly by seq, NOT by createdAt — when two focus_updated share a createdAt, the higher seq wins (QA)', () => {
    // The append invariant forbids createdAt as an ordering key; the fold trusts
    // the caller's seq order. If two focus_updated events collide on createdAt (a
    // realistic ms-granularity clock collision when two updates land in the same
    // millisecond), the LATER one by seq must win currentFocus. Here the events are
    // seq-ordered (1,2,3) — as every DataAccess read guarantees — but the focus
    // updates share one timestamp, so only seq can break the tie. If the reducer
    // ever compared createdAt instead of trusting seq order, this would be
    // ambiguous/wrong; trusting seq order makes seq=3 ('later-by-seq') win.
    const sharedTs = '2026-05-31T00:05:00.000Z';
    const dir = foldIdentities([
      reg(1, 'ada', 'focus-0', '2026-05-31T00:00:01.000Z'),
      focus(2, 'ada', 'earlier-by-seq', sharedTs),
      focus(3, 'ada', 'later-by-seq', sharedTs),
    ]);

    const ada = dir.get('ada');
    // seq=3 is the last folded event for ada → its focus wins, even though seq=2
    // carries the IDENTICAL createdAt (no timestamp comparison decides this).
    expect(ada?.currentFocus).toBe('later-by-seq');
    // lastSeen is that shared timestamp (the latest-by-seq event's createdAt).
    expect(ada?.lastSeen).toBe(sharedTs);
  });

  it('does NOT create a phantom identity for a focus_updated with no prior registration', () => {
    // Only identity.registered mints a directory entry; a focus update for a handle
    // with no registration is ignored by the fold (defensive — unreachable in V1,
    // since update_focus requires an established/registered session). Stance:
    // ignore, do not mint.
    const dir = foldIdentities([
      focus(1, 'ghost', 'whatever', '2026-05-31T00:00:01.000Z'),
    ]);
    expect(dir.size).toBe(0);
    expect(dir.get('ghost')).toBeUndefined();
  });

  it('folds a focus update for one handle without polluting another identity', () => {
    const dir = foldIdentities([
      reg(1, 'ada', 'ada-focus', '2026-05-31T00:00:01.000Z'),
      reg(2, 'bob', 'bob-focus', '2026-05-31T00:00:02.000Z'),
      focus(3, 'ada', 'ada-new', '2026-05-31T00:03:00.000Z'),
    ]);

    expect(dir.get('ada')?.currentFocus).toBe('ada-new');
    expect(dir.get('ada')?.lastSeen).toBe('2026-05-31T00:03:00.000Z');
    // bob is untouched by ada's focus update.
    expect(dir.get('bob')?.currentFocus).toBe('bob-focus');
    expect(dir.get('bob')?.lastSeen).toBe('2026-05-31T00:00:02.000Z');
  });

  it('findIdentity reflects the folded focus update for a single handle', () => {
    const events = [
      reg(1, 'ada', 'old', '2026-05-31T00:00:01.000Z'),
      focus(2, 'ada', 'fresh', '2026-05-31T00:09:00.000Z'),
    ];
    const ada = findIdentity(events, 'ada');
    expect(ada?.currentFocus).toBe('fresh');
    expect(ada?.lastSeen).toBe('2026-05-31T00:09:00.000Z');
  });
});

describe('foldIdentities — lastSeen is derived from the stream, never stored', () => {
  it('this story (2.2): lastSeen === createdAt; identity.seen is NOT yet a directory event (Story 2.5 wires that)', () => {
    // SCOPE PIN: in Story 2.2 only identity.registered is an identity-directory
    // event. A later identity.seen for the same handle does NOT yet advance
    // lastSeen — that folding lands in Story 2.5, which adds 'identity.seen' to
    // IDENTITY_EVENT_TYPES + a reducer branch. Here lastSeen stays at createdAt.
    // (This test guards the boundary: if 2.5's change accidentally lands early or
    // 2.2's scope creeps, it flips and is reviewed deliberately.)
    const dir = foldIdentities([
      reg(1, 'ada', 'focus', '2026-05-31T00:00:01.000Z'),
      seen(4, 'ada', '2026-05-31T00:05:00.000Z'),
    ]);

    const ada = dir.get('ada');
    expect(ada?.createdAt).toBe('2026-05-31T00:00:01.000Z');
    expect(ada?.lastSeen).toBe('2026-05-31T00:00:01.000Z');
  });

  it('lastSeen tracks the latest-seq folded identity event (spec: max createdAt across the identity events), not a stored constant', () => {
    // Proves lastSeen is COMPUTED from the folded stream, not fabricated. Per the
    // story's definition ("lastSeen = the max created_at across that identity's
    // events"), a second folded identity event for the same handle advances
    // lastSeen to that later event's createdAt, while createdAt stays pinned to
    // the FIRST registration. (We use a duplicate identity.registered as the only
    // identity-event type available in 2.2 — appendGuarded makes it unreachable in
    // a real ledger, so this is the defensive vehicle for exercising the generic
    // seq-ordered derivation seam that Story 2.5 builds presence on; it does NOT
    // depend on 2.5's not-yet-wired identity.seen folding.)
    const dir = foldIdentities([
      reg(1, 'ada', 'first-focus', '2026-05-31T00:00:01.000Z'),
      reg(7, 'ada', 'second-focus', '2026-05-31T00:09:00.000Z'),
    ]);
    const ada = dir.get('ada');
    // createdAt + currentFocus are pinned to the FIRST registration (first wins).
    expect(ada?.createdAt).toBe('2026-05-31T00:00:01.000Z');
    expect(ada?.currentFocus).toBe('first-focus');
    // lastSeen advanced to the latest folded event's createdAt — derived, not stored.
    expect(ada?.lastSeen).toBe('2026-05-31T00:09:00.000Z');
  });
});

describe('foldIdentities — non-identity noise is ignored', () => {
  it('ignores events that are not in the identity-event set', () => {
    const dir = foldIdentities([
      reg(1, 'ada', 'focus', '2026-05-31T00:00:01.000Z'),
      {
        seq: 2,
        type: 'project.announced',
        actor: 'ada',
        createdAt: '2026-05-31T00:02:00.000Z',
        payload: { projectId: 'p', title: 'P', description: 'd' },
      },
    ]);
    // project.announced is NOT an identity event: it neither creates a record nor
    // advances lastSeen (lastSeen stays at the registration createdAt).
    expect(dir.size).toBe(1);
    expect(dir.get('ada')?.lastSeen).toBe('2026-05-31T00:00:01.000Z');
  });

  it('returns an empty directory for a stream with no identity.registered', () => {
    expect(foldIdentities([]).size).toBe(0);
    expect(
      foldIdentities([seen(1, 'ghost', '2026-05-31T00:00:00.000Z')]).size,
    ).toBe(0);
  });
});

describe('findIdentity', () => {
  it('resolves a single registered handle', () => {
    const events = [reg(1, 'ada', 'focus', '2026-05-31T00:00:01.000Z')];
    expect(findIdentity(events, 'ada')?.handle).toBe('ada');
  });

  it('returns undefined for an unregistered handle', () => {
    const events = [reg(1, 'ada', 'focus', '2026-05-31T00:00:01.000Z')];
    expect(findIdentity(events, 'nobody')).toBeUndefined();
  });
});
