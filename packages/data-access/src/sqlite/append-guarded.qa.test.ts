// QA-added coverage (Story 2.2, Task 1 — the atomicity crux) — REAL-RUNTIME, a
// genuine SQLite file in an OS temp dir, exercised through the real
// `createAppendGuarded`.
//
// Complements the dev's append-guarded.test.ts. That file pins the single-guard
// path thoroughly (pass/trip, rollback, scoping, the carried guard). This file
// closes the MULTI-guard + ordering surface the data-described primitive promises
// but the dev suite does not assert — the same `appendGuarded` is Epic 3's
// PROJECT_EXISTS / room-id uniqueness primitive (it takes an ARRAY of guards), so
// the multi-guard contract is regressable now:
//   - guards PASS + MULTIPLE events → all insert, seqs monotonic in INPUT order
//     (the brief's "guard passes and returns monotonic seqs in input order", with
//     a NON-EMPTY guard set, not just the no-guards batch the dev test covers);
//   - of several guards, the LAST one trips → conflict carries THAT guard, and the
//     whole batch rolls back (every guard is checked; the right one is reported);
//   - guards are ALL checked before ANY insert (a trip on guard[1] inserts none of
//     a multi-event batch);
//   - empty `guards` makes appendGuarded behave EXACTLY like append even for a
//     value that WOULD collide under a guard — proving it is the GUARDS that gate,
//     not the events (the documented empty-array semantics).
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAppendGuarded } from './append-guarded.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';
import { UniquenessConflictError } from '../errors.js';

import type { NewEvent, UniquenessGuard } from '@agentbbs/core';
import type { Database as DatabaseInstance } from 'better-sqlite3';

let dir: string;
let dbPath: string;
let db: DatabaseInstance | undefined;

function freshDb(): DatabaseInstance {
  const opened = openDatabase({ dbPath });
  migrate(opened);
  return opened;
}

/** A registration event for `handle` (camelCase payload, as core supplies). */
function registered(handle: string, currentFocus = 'focus'): NewEvent {
  return {
    type: 'identity.registered',
    actor: handle,
    payload: { handle, currentFocus },
  };
}

/** The handle-uniqueness guard core passes for `register`. */
function handleGuard(handle: string): UniquenessGuard {
  return { type: 'identity.registered', field: 'handle', value: handle };
}

function rowCount(database: DatabaseInstance): number {
  return (
    database.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }
  ).n;
}

/** Actors in seq order — proves insertion order is preserved by the batch. */
function actorsInSeqOrder(database: DatabaseInstance): string[] {
  return (
    database.prepare('SELECT actor FROM events ORDER BY seq ASC').all() as {
      actor: string;
    }[]
  ).map((r) => r.actor);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-append-guarded-qa-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
});

afterEach(() => {
  try {
    db?.close();
  } catch {
    /* already closed */
  }
  db = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('appendGuarded — multiple guards all pass', () => {
  it('inserts a MULTI-event batch and returns monotonic seqs in INPUT order (with a non-empty guard set)', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);

    // Three fresh handles, three matching guards — all unclaimed → all insert.
    const seqs = await appendGuarded(
      [registered('ada'), registered('bob'), registered('cleo')],
      [handleGuard('ada'), handleGuard('bob'), handleGuard('cleo')],
    );

    expect(seqs).toHaveLength(3);
    expect(new Set(seqs).size).toBe(3);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    }
    // Input order is preserved on disk (seq follows the input array order).
    expect(actorsInSeqOrder(db)).toEqual(['ada', 'bob', 'cleo']);
    expect(rowCount(db)).toBe(3);
  });
});

describe('appendGuarded — multiple guards, one trips', () => {
  it('the LAST guard trips → the conflict carries THAT guard and the WHOLE batch rolls back', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);

    // Seed "taken" so a guard on it will trip.
    await appendGuarded([registered('taken')], [handleGuard('taken')]);
    expect(rowCount(db)).toBe(1);

    // Two fresh events, but the SECOND guard is on the already-claimed value.
    const err = await appendGuarded(
      [registered('fresh-1'), registered('fresh-2')],
      [handleGuard('fresh-1'), handleGuard('taken')],
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UniquenessConflictError);
    // The reported guard is the one that actually tripped (the 'taken' one), so a
    // multi-guard caller can tell which precondition failed.
    expect((err as UniquenessConflictError).guard).toEqual({
      type: 'identity.registered',
      field: 'handle',
      value: 'taken',
    });
    // Atomic: neither fresh event persisted — still just the seeded "taken" row.
    expect(rowCount(db)).toBe(1);
    expect(actorsInSeqOrder(db)).toEqual(['taken']);
  });

  it('a trip on the FIRST guard inserts NONE of a multi-event batch (all guards gate before any insert)', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);
    await appendGuarded(
      [registered('first-taken')],
      [handleGuard('first-taken')],
    );

    await expect(
      appendGuarded(
        [registered('x'), registered('y'), registered('z')],
        [handleGuard('first-taken'), handleGuard('y')],
      ),
    ).rejects.toBeInstanceOf(UniquenessConflictError);

    // Exactly the one seeded row — the three-event batch rolled back entirely.
    expect(rowCount(db)).toBe(1);
  });
});

describe('appendGuarded — empty guards behaves exactly like append', () => {
  it('with NO guards, inserts a value that WOULD collide under a guard (the GUARDS gate, not the events)', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);

    // Claim "dup" WITH a guard.
    await appendGuarded([registered('dup')], [handleGuard('dup')]);
    expect(rowCount(db)).toBe(1);

    // Append "dup" AGAIN but with an EMPTY guard array: no precondition is asserted,
    // so it inserts a second identity.registered for the same handle. (A real
    // register always passes the guard; this proves the empty-array semantics — it
    // is the guards, not the event content, that make an append conditional.)
    const seqs = await appendGuarded([registered('dup', 'again')], []);
    expect(seqs).toHaveLength(1);
    expect(rowCount(db)).toBe(2);

    // Both rows are present (no uniqueness was enforced this time).
    const dupCount = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM events WHERE type='identity.registered' AND json_extract(payload,'$.handle')=?",
        )
        .get('dup') as { n: number }
    ).n;
    expect(dupCount).toBe(2);
  });
});
