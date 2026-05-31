// The composed DataAccess implementation (Story 1.6, AC1/AC2) — the package's
// public construction entry point.
//
// Composes the Story 1.5 WRITE half (`createAppend`) with the Story 1.6 READ half
// (`createReadQueries`) over a single Story 1.4 connection into ONE object that
// implements the `@agentbbs/core` `DataAccess` port. `core` depends only on that
// port (AC2); better-sqlite3 stays entirely inside this package (it is imported
// only by ./sqlite/connection.ts, lint-enforced).
//
// The returned object is checked `satisfies DataAccess` so a drift between the
// port and this implementation is a COMPILE error (the typecheck gate proves AC1's
// "implements the port" claim — no runtime assertion needed).

import { createAppend } from './sqlite/append.js';
import { openDatabase } from './sqlite/connection.js';
import { migrate } from './sqlite/migrate.js';
import { createReadQueries } from './sqlite/queries.js';

import type { OpenDatabaseOptions } from './sqlite/connection.js';
import type { DataAccess } from '@agentbbs/core';
import type { Database as DatabaseInstance } from 'better-sqlite3';

/** A {@link DataAccess} plus the lifecycle handle to close its connection. */
export interface DataAccessHandle extends DataAccess {
  /**
   * Close the underlying SQLite connection. Idempotent at the better-sqlite3
   * level only in that a double-close throws; call once when the owner shuts down.
   */
  close(): void;
}

/**
 * Open the ledger and return a fully-composed {@link DataAccess}.
 *
 * Wires the connection lifecycle so a caller gets a ready-to-use port: resolves
 * the DB path (AGENTBBS_DB override / project-root walk-up, or an explicit
 * `dbPath`), opens it in WAL + busy_timeout, runs the forward-only idempotent
 * migration, then binds the append + read methods to that connection.
 *
 * @param options Connection options (explicit `dbPath`, `readonly`). Omit to use
 *   path discovery. Read-only callers still get the read methods; `append` will
 *   reject from the driver if used against a read-only connection.
 */
export function createDataAccess(
  options: OpenDatabaseOptions = {},
): DataAccessHandle {
  const db: DatabaseInstance = openDatabase(options);
  if (!options.readonly) {
    migrate(db);
  }
  return fromConnection(db);
}

/**
 * Compose a {@link DataAccessHandle} over an ALREADY-open, ALREADY-migrated
 * connection. Useful for tests and for callers that own the connection lifecycle
 * themselves. Does not migrate or close on its own beyond the returned `close`.
 *
 * @param db An open better-sqlite3 connection whose `events` table exists.
 */
export function fromConnection(db: DatabaseInstance): DataAccessHandle {
  const append = createAppend(db);
  const reads = createReadQueries(db);

  const dataAccess = {
    append,
    eventsSince: reads.eventsSince,
    eventsByType: reads.eventsByType,
    eventsByActor: reads.eventsByActor,
    maxSeq: reads.maxSeq,
    close(): void {
      db.close();
    },
    // `satisfies` proves the composed object implements the core port exactly —
    // the compile-time evidence for AC1 ("first full implementation of the port").
  } satisfies DataAccess & { close(): void };

  return dataAccess;
}
