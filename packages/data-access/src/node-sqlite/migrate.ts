// Forward-only, idempotent schema migration for node:sqlite (Story 10.2, AC3).
//
// The node:sqlite analogue of `../sqlite/migrate.ts`. Applies the SAME baseline schema
// (`../sqlite/schema.ts` SCHEMA_SQL — `CREATE TABLE/INDEX IF NOT EXISTS`, so re-running is a
// pure no-op) inside ONE BEGIN IMMEDIATE transaction, wrapped in the bounded busy-retry so a
// transient SQLITE_BUSY at migration time surfaces as a typed StoreBusyError. Identical
// forward-only contract; only the driver (node:sqlite vs better-sqlite3) differs.

import { runWithRetry } from './connection.js';
import { immediateTransaction } from './tx.js';
import { SCHEMA_SQL } from '../sqlite/schema.js';

import type { DatabaseSync } from 'node:sqlite';

/**
 * Apply the baseline `events`/`cursors` schema to a node:sqlite `db`. Forward-only and
 * idempotent (IF NOT EXISTS throughout); the whole baseline lands in one transaction so a
 * fresh DB never ends up half-migrated.
 *
 * @param db An open, writable node:sqlite connection (from `openNodeSqliteDatabase`).
 */
export function migrateNodeSqlite(db: DatabaseSync): void {
  runWithRetry(() => {
    immediateTransaction(db, () => {
      db.exec(SCHEMA_SQL);
    });
  });
}
