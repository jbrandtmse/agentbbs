// The node:sqlite-backed composed DataAccess (Story 10.2, AC3) — the VS Code extension
// host's persistence driver, a SIBLING of the better-sqlite3 `createDataAccess`.
//
// It implements the IDENTICAL `@agentbbs/core` `DataAccess` port over the SAME schema
// (`../sqlite/schema.ts` SCHEMA_SQL), the SAME wire mapping (`../mapping.ts`), and the SAME
// typed errors (`../errors.ts`) as the better-sqlite3 path — only the driver differs. The
// `append`/`appendGuarded` writes run inside ONE `BEGIN IMMEDIATE` transaction (FR1 atomic
// check-then-insert), all reads are `seq`-ASC, and `getCursor`/`setCursor` UPSERT the
// SEPARATE `cursors` table. The better-sqlite3 source (`../sqlite/*`, `../data-access.ts`)
// is UNCHANGED (verified via `git diff` — the agent backend is not destabilized).
//
// THE APPEND INVARIANT holds here exactly as in the better-sqlite3 path: only INSERT (+ the
// guard-probe SELECT) touches `events`; the only UPDATE is the `cursors` UPSERT (a separate
// bookkeeping table). Same json_extract guard, same monotonic AUTOINCREMENT `seq`.

import { migrateNodeSqlite } from './migrate.js';
import {
  openNodeSqliteDatabase,
  runWithRetry,
} from './connection.js';
import { immediateTransaction } from './tx.js';
import { UniquenessConflictError } from '../errors.js';
import { newEventToRow, rowToEvent } from '../mapping.js';

import type { OpenDatabaseOptions } from './connection.js';
import type { StoredEventRow } from '../mapping.js';
import type { DataAccessHandle } from '../data-access.js';
import type {
  DataAccess,
  Event,
  EventType,
  NewEvent,
  UniquenessGuard,
} from '@agentbbs/core';
import type { DatabaseSync } from 'node:sqlite';

/** The columns every read selects, in a fixed order — the full on-disk row. */
const SELECT_COLUMNS = 'seq, type, actor, created_at, payload';

/**
 * Coerce a node:sqlite integer value (`number | bigint` — `number` with the default
 * readBigInts:false, matching better-sqlite3 safe-integers-OFF) to a `number` seq, throwing
 * above Number.MAX_SAFE_INTEGER rather than silently losing precision. Identical guard to the
 * better-sqlite3 path's `toSeq`/`maxSeqValue`/`toCursorSeq` (a loud throw beats a corrupt seq).
 */
function toSeq(value: number | bigint): number {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `seq ${value} exceeds Number.MAX_SAFE_INTEGER and cannot be represented exactly as a JS number.`,
      );
    }
    return Number(value);
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `seq ${value} exceeds Number.MAX_SAFE_INTEGER and cannot be represented exactly as a JS number.`,
    );
  }
  return value;
}

/**
 * Compose a {@link DataAccessHandle} over an already-open, already-migrated node:sqlite
 * connection. The node:sqlite analogue of `../data-access.ts#fromConnection`. Statements are
 * prepared ONCE per connection and reused; the synchronous node:sqlite work is wrapped in
 * resolved/rejected Promises to conform to the async `DataAccess` seam.
 *
 * @param db An open node:sqlite connection whose `events`/`cursors` tables exist.
 */
export function fromNodeSqliteConnection(db: DatabaseSync): DataAccessHandle {
  // Prepared once per connection; reused across calls. INSERT-only write + existence-probe
  // SELECT — THE APPEND INVARIANT (no UPDATE/DELETE on events).
  const insert = db.prepare(
    'INSERT INTO events (type, actor, created_at, payload) VALUES (?, ?, ?, ?)',
  );
  const guardProbe = db.prepare(
    'SELECT 1 FROM events WHERE type = ? AND json_extract(payload, ?) = ? LIMIT 1',
  );
  const sinceStmt = db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM events WHERE seq > ? ORDER BY seq ASC`,
  );
  const byTypeStmt = db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM events WHERE type = ? ORDER BY seq ASC`,
  );
  const byActorStmt = db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM events WHERE actor = ? ORDER BY seq ASC`,
  );
  const maxSeqStmt = db.prepare('SELECT MAX(seq) AS max_seq FROM events');
  const getCursorStmt = db.prepare('SELECT seq FROM cursors WHERE handle = ?');
  const setCursorStmt = db.prepare(
    'INSERT INTO cursors (handle, seq) VALUES (?, ?) ' +
      'ON CONFLICT(handle) DO UPDATE SET seq = excluded.seq',
  );

  /** Map raw snake_case rows to internal camelCase Events (the single boundary). */
  function toEvents(rows: unknown[]): Event[] {
    return (rows as StoredEventRow[]).map((row) => rowToEvent(row));
  }

  /** Insert one batch inside the current transaction; return assigned seqs in input order. */
  function insertBatch(events: NewEvent[]): number[] {
    const createdAt = new Date().toISOString();
    const seqs: number[] = [];
    for (const event of events) {
      const row = newEventToRow(event, createdAt);
      const info = insert.run(row.type, row.actor, row.created_at, row.payload);
      seqs.push(toSeq(info.lastInsertRowid));
    }
    return seqs;
  }

  const dataAccess = {
    append(events: NewEvent[]): Promise<number[]> {
      if (events.length === 0) return Promise.resolve([]);
      try {
        const seqs = runWithRetry(() =>
          immediateTransaction(db, () => insertBatch(events)),
        );
        return Promise.resolve(seqs);
      } catch (err) {
        return Promise.reject(err);
      }
    },

    appendGuarded(
      events: NewEvent[],
      guards: UniquenessGuard[],
    ): Promise<number[]> {
      if (events.length === 0) return Promise.resolve([]);
      try {
        const seqs = runWithRetry(() =>
          immediateTransaction(db, () => {
            // Assert every uniqueness precondition FIRST, while holding the write lock.
            for (const guard of guards) {
              const path = `$.${guard.field}`;
              const hit = guardProbe.get(guard.type, path, guard.value);
              if (hit !== undefined) {
                // Throwing here rolls the immediate transaction back: no row inserted, the
                // typed conflict surfaces to core (which maps it to the right BoardError).
                throw new UniquenessConflictError(
                  `Uniqueness guard violated: an event of type "${guard.type}" already ` +
                    `has payload field "${guard.field}" = ${JSON.stringify(guard.value)}.`,
                  {
                    type: guard.type,
                    field: guard.field,
                    value: guard.value,
                  },
                );
              }
            }
            return insertBatch(events);
          }),
        );
        return Promise.resolve(seqs);
      } catch (err) {
        return Promise.reject(err);
      }
    },

    eventsSince(cursor: number): Promise<Event[]> {
      return Promise.resolve(toEvents(sinceStmt.all(cursor)));
    },

    eventsByType(type: EventType): Promise<Event[]> {
      return Promise.resolve(toEvents(byTypeStmt.all(type)));
    },

    eventsByActor(actor: string): Promise<Event[]> {
      return Promise.resolve(toEvents(byActorStmt.all(actor)));
    },

    maxSeq(): Promise<number> {
      const row = maxSeqStmt.get() as { max_seq: number | bigint | null };
      return Promise.resolve(row.max_seq === null ? 0 : toSeq(row.max_seq));
    },

    getCursor(handle: string): Promise<number> {
      const row = getCursorStmt.get(handle) as
        | { seq: number | bigint }
        | undefined;
      return Promise.resolve(row === undefined ? 0 : toSeq(row.seq));
    },

    setCursor(handle: string, seq: number): Promise<void> {
      try {
        runWithRetry(() => setCursorStmt.run(handle, seq));
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },

    close(): void {
      db.close();
    },
  } satisfies DataAccess & { close(): void };

  return dataAccess;
}

/**
 * Open the ledger via node:sqlite and return a fully-composed {@link DataAccessHandle} — the
 * node:sqlite analogue of `../data-access.ts#createDataAccess`. Resolves the DB path
 * (AGENTBBS_DB / project-root walk-up, or an explicit `dbPath`), opens it in WAL +
 * busy_timeout, runs the forward-only idempotent migration, then binds the methods.
 *
 * @param options Connection options (explicit `dbPath`, `readonly`). Omit to use discovery.
 */
export function createDataAccessNodeSqlite(
  options: OpenDatabaseOptions = {},
): DataAccessHandle {
  const db = openNodeSqliteDatabase(options);
  if (!options.readonly) {
    migrateNodeSqlite(db);
  }
  return fromNodeSqliteConnection(db);
}
