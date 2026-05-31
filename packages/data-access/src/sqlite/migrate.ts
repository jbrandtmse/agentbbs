// Forward-only, idempotent schema migration (Story 1.5, AC1).
//
// Applies the baseline `events` schema (`./schema.ts`) against a connection. The
// schema uses `CREATE TABLE/INDEX IF NOT EXISTS`, so running `migrate` against an
// already-migrated database is a pure no-op: it neither errors nor duplicates the
// table or indexes.
//
// DECISION — no version table for V1. A single forward-only "apply baseline schema
// (IF NOT EXISTS)" step is sufficient: the V1 schema is one immutable append-only
// table with two indexes, there are no destructive alterations, and idempotency is
// guaranteed by `IF NOT EXISTS` rather than by tracking an applied-migrations
// version. If future epics need additive schema changes, this stays forward-only —
// add new `IF NOT EXISTS` statements (or, if a version table is introduced then,
// keep it forward-only: never down-migrate). Forward-only is the contract.
//
// Runs inside a single transaction so the baseline lands atomically. DDL in SQLite
// is transactional, so a fresh DB either gets the full schema or none of it. We use
// the Story 1.4 bounded-retry wrapper so a transient `SQLITE_BUSY` at migration
// time surfaces as a typed `StoreBusyError` rather than a raw driver error.

import { runWithRetry } from './connection.js';
import { SCHEMA_SQL } from './schema.js';

import type { Database as DatabaseInstance } from 'better-sqlite3';

/**
 * Apply the baseline `events` schema to `db`. Forward-only and idempotent: safe to
 * call on a fresh database (creates the table + indexes) and on an already-migrated
 * one (no-op — `IF NOT EXISTS` throughout). The whole baseline is applied in one
 * transaction so a fresh DB never ends up half-migrated.
 *
 * @param db An open, writable better-sqlite3 connection (from `openDatabase`).
 */
export function migrate(db: DatabaseInstance): void {
  runWithRetry(() => {
    const applyBaseline = db.transaction(() => {
      db.exec(SCHEMA_SQL);
    });
    // IMMEDIATE: take the write lock up front so contention surfaces as SQLITE_BUSY
    // at BEGIN (handled by runWithRetry) rather than mid-DDL.
    applyBaseline.immediate();
  });
}
