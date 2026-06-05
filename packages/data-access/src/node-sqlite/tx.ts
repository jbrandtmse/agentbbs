// node:sqlite immediate-transaction helper (Story 10.2, AC3).
//
// better-sqlite3 ships `db.transaction(fn).immediate(...)` (BEGIN IMMEDIATE → fn → COMMIT,
// ROLLBACK on throw). node:sqlite has NO such wrapper, so this replicates exactly that
// semantics with explicit `exec('BEGIN IMMEDIATE')` / `COMMIT` / `ROLLBACK`. BEGIN IMMEDIATE
// takes the write lock at BEGIN, so cross-process contention surfaces as SQLITE_BUSY THERE
// (handled by the caller's runWithRetry) rather than mid-body — the SAME concurrency story
// the better-sqlite3 `.immediate` path relies on (Story 1.7 proved BEGIN IMMEDIATE serializes
// writers across OS processes; that is a SQLite property, driver-independent).
//
// On any throw inside `fn` the transaction is rolled back and the original error rethrown
// (so an appendGuarded UniquenessConflictError / a constraint failure surfaces unchanged and
// nothing persists — atomic all-or-nothing). A best-effort ROLLBACK guards against leaving
// the connection in an open transaction if `fn` throws.

import type { DatabaseSync } from 'node:sqlite';

/**
 * Run `fn` inside a single BEGIN IMMEDIATE … COMMIT transaction, rolling back on throw.
 * Returns `fn`'s return value. Mirrors better-sqlite3's `db.transaction(fn).immediate()`.
 *
 * @param db An open node:sqlite connection.
 * @param fn The transaction body — all its reads + writes commit atomically or not at all.
 */
export function immediateTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  let result: T;
  try {
    result = fn();
  } catch (err) {
    // Best-effort rollback; if ROLLBACK itself throws (e.g. the txn already aborted), keep
    // the ORIGINAL error as the surfaced cause — it is the meaningful one.
    try {
      db.exec('ROLLBACK');
    } catch {
      /* the original error below is the one that matters */
    }
    throw err;
  }
  db.exec('COMMIT');
  return result;
}
