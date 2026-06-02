// Cursor-store tests (Story 6.1, Task 1) — REAL-RUNTIME: a genuine SQLite file in an
// OS temp dir, migrated via the real schema, exercised through the real
// `createCursorQueries`.
//
// Pins the per-identity `check`-cursor store the `check` op (Story 6.1) relies on:
//   - getCursor of an unset handle → 0 (the documented unset sentinel);
//   - setCursor then getCursor round-trips the stored seq;
//   - setCursor again UPSERTs (overwrites in place — a single row per handle, no
//     duplicate-row growth);
//   - two handles are independent (one identity's cursor does not affect another's).
//
// Also confirms the cursor store is SEPARATE from the append-only `events` ledger (the
// architecture's mutable-bookkeeping exception): UPSERTing a cursor appends NOTHING to
// `events`, so the append invariant is preserved.
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from './connection.js';
import { createCursorQueries } from './cursors.js';
import { migrate } from './migrate.js';

import type { CursorQueries } from './cursors.js';
import type { Database as DatabaseInstance } from 'better-sqlite3';

let dir: string;
let dbPath: string;
let db: DatabaseInstance | undefined;

function freshDb(): DatabaseInstance {
  const opened = openDatabase({ dbPath });
  migrate(opened);
  return opened;
}

/** Count the rows in the cursors table (to prove UPSERT overwrites, not duplicates). */
function cursorRowCount(database: DatabaseInstance): number {
  const row = database.prepare('SELECT COUNT(*) AS n FROM cursors').get() as {
    n: number;
  };
  return row.n;
}

/** Count the rows in the events ledger (to prove the cursor store does not append). */
function eventRowCount(database: DatabaseInstance): number {
  const row = database.prepare('SELECT COUNT(*) AS n FROM events').get() as {
    n: number;
  };
  return row.n;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-cursors-'));
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

describe('createCursorQueries — getCursor', () => {
  it('returns 0 for an unset handle (the unset sentinel)', async () => {
    db = freshDb();
    const cursors: CursorQueries = createCursorQueries(db);

    expect(await cursors.getCursor('ada')).toBe(0);
  });
});

describe('createCursorQueries — setCursor then getCursor round-trip', () => {
  it('stores a cursor and reads it back exactly', async () => {
    db = freshDb();
    const cursors = createCursorQueries(db);

    await cursors.setCursor('ada', 42);

    expect(await cursors.getCursor('ada')).toBe(42);
    // Exactly one row was inserted.
    expect(cursorRowCount(db)).toBe(1);
  });

  it('persists across a fresh connection (the cursor is durable, not in-memory)', async () => {
    db = freshDb();
    const cursors = createCursorQueries(db);
    await cursors.setCursor('ada', 7);
    db.close();

    // Re-open the SAME file: the cursor survives.
    db = openDatabase({ dbPath });
    const reopened = createCursorQueries(db);
    expect(await reopened.getCursor('ada')).toBe(7);
  });
});

describe('createCursorQueries — setCursor UPSERT (overwrite in place)', () => {
  it('overwrites an existing cursor, leaving a single row (no duplicate growth)', async () => {
    db = freshDb();
    const cursors = createCursorQueries(db);

    await cursors.setCursor('ada', 10);
    await cursors.setCursor('ada', 25);
    await cursors.setCursor('ada', 100);

    // The latest value wins…
    expect(await cursors.getCursor('ada')).toBe(100);
    // …and the row was UPDATED in place (UPSERT), not appended — still ONE row.
    expect(cursorRowCount(db)).toBe(1);
  });

  it('can move a cursor backward too (the primitive is an unconditional UPSERT; monotonicity is the caller’s contract)', async () => {
    db = freshDb();
    const cursors = createCursorQueries(db);

    await cursors.setCursor('ada', 50);
    await cursors.setCursor('ada', 30);

    // The store does not enforce monotonicity — `check` does. The UPSERT writes 30.
    expect(await cursors.getCursor('ada')).toBe(30);
    expect(cursorRowCount(db)).toBe(1);
  });
});

describe('createCursorQueries — independence + append-invariant separation', () => {
  it('keeps two handles independent', async () => {
    db = freshDb();
    const cursors = createCursorQueries(db);

    await cursors.setCursor('ada', 11);
    await cursors.setCursor('bob', 22);

    expect(await cursors.getCursor('ada')).toBe(11);
    expect(await cursors.getCursor('bob')).toBe(22);
    // An unrelated handle remains unset.
    expect(await cursors.getCursor('cleo')).toBe(0);
    // Two distinct identities → two rows.
    expect(cursorRowCount(db)).toBe(2);
  });

  it('does NOT append to the events ledger (the cursor store is the separate mutable exception)', async () => {
    db = freshDb();
    const cursors = createCursorQueries(db);

    await cursors.setCursor('ada', 5);
    await cursors.setCursor('ada', 9);
    await cursors.setCursor('bob', 3);

    // The append invariant governs `events` — the cursors UPSERTs leave it untouched.
    expect(eventRowCount(db)).toBe(0);
  });
});
