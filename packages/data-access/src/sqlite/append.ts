// Transactional append — the WRITE half of the DataAccess seam (Story 1.5, AC2).
//
// Implements `DataAccess.append(events: NewEvent[]): Promise<number[]>` (the shape
// from `@agentbbs/core` ports.ts) on top of the Story 1.4 connection + bounded
// retry. ALL inserts of one call run inside ONE better-sqlite3 transaction, so a
// multi-event append is atomic (all-or-nothing) and the returned `seq` values are
// the AUTOINCREMENT keys assigned in input order.
//
// THE APPEND INVARIANT: this module issues ONLY `INSERT` against `events`. No
// `UPDATE`/`DELETE`, no derived state, and ordering is never by `created_at`
// (the lint guard + code review enforce this).
//
// Concurrency (AR4/NFR10): SQLite serializes writers, so `seq` is a correct
// monotonic total order with NO extra coordination. We add none. The transaction
// holds no I/O (timestamps are computed before the transaction body; no awaits
// inside) so the write lock is held only for the inserts.
//
// Researched (2026-05-30, better-sqlite3 + SQLite docs):
//   - `db.transaction(fn)` wraps `fn` in BEGIN/COMMIT, ROLLBACK on throw, runs
//     synchronously, and returns `fn`'s return value. We use `.immediate` so the
//     write lock is taken at BEGIN and contention surfaces as SQLITE_BUSY there
//     (handled by `runWithRetry`) rather than mid-batch.
//   - `info.lastInsertRowid` is a `number` by default (safe-integers OFF, which is
//     the default we rely on) but is typed `number | bigint`; we coerce defensively
//     with a `Number.MAX_SAFE_INTEGER` guard (see `toSeq`).
//   - `INTEGER PRIMARY KEY AUTOINCREMENT` => each assigned `seq` is strictly greater
//     than any previously used value and never reused; `lastInsertRowid` IS that
//     assigned value for the row just inserted on this connection.

import { runWithRetry } from './connection.js';
import { newEventToRow } from '../mapping.js';

import type { NewEvent } from '@agentbbs/core';
import type { Database as DatabaseInstance } from 'better-sqlite3';

/**
 * Coerce a better-sqlite3 `lastInsertRowid` (`number | bigint`) to a `number` seq.
 *
 * With safe-integers OFF (our default) it is already a `number`; the `bigint` branch
 * is a defensive guard for the safe-integers-on case. SQLite ROWIDs are 64-bit, but
 * JS `number` is exact only up to `Number.MAX_SAFE_INTEGER` (~9.0e15). A board
 * ledger will never approach that, but rather than silently lose precision we throw
 * if a value ever exceeds the safe range — a loud failure beats a corrupted `seq`.
 */
function toSeq(rowid: number | bigint): number {
  if (typeof rowid === 'bigint') {
    if (rowid > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `Assigned seq ${rowid} exceeds Number.MAX_SAFE_INTEGER and cannot be ` +
          `represented exactly as a JS number.`,
      );
    }
    return Number(rowid);
  }
  if (rowid > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Assigned seq ${rowid} exceeds Number.MAX_SAFE_INTEGER and cannot be ` +
        `represented exactly as a JS number.`,
    );
  }
  return rowid;
}

/**
 * Build the `DataAccess.append` implementation bound to an open connection.
 *
 * Story 1.5 delivers only the WRITE half of the seam; Story 1.6 composes this with
 * the read methods into the full `DataAccess`. Returning a bound function (rather
 * than a class) keeps that composition trivial.
 *
 * @param db An open, writable better-sqlite3 connection. The caller is responsible
 *   for having run {@link migrate} so the `events` table exists.
 */
export function createAppend(
  db: DatabaseInstance,
): (events: NewEvent[]) => Promise<number[]> {
  // Prepared once per connection; reused across calls (better-sqlite3 caches the
  // compiled statement). INSERT-only — THE APPEND INVARIANT.
  const insert = db.prepare(
    'INSERT INTO events (type, actor, created_at, payload) VALUES (?, ?, ?, ?)',
  );

  // One transaction over the whole batch: atomic multi-event append. Returns the
  // assigned seq for each input event, in input order.
  const appendBatch = db.transaction((events: NewEvent[]): number[] => {
    const createdAt = new Date().toISOString();
    const seqs: number[] = [];
    for (const event of events) {
      const row = newEventToRow(event, createdAt);
      const info = insert.run(row.type, row.actor, row.created_at, row.payload);
      seqs.push(toSeq(info.lastInsertRowid));
    }
    return seqs;
  });

  /**
   * Append one or more events in a single transaction; resolve with the assigned
   * monotonic `seq`(s) in input order. An empty input resolves to `[]` without
   * opening a transaction. The synchronous better-sqlite3 work is wrapped in an
   * already-resolved Promise to conform to the async `DataAccess` seam.
   */
  return function append(events: NewEvent[]): Promise<number[]> {
    if (events.length === 0) return Promise.resolve([]);
    // The work is synchronous (better-sqlite3), but the seam is async: surface a
    // rollback (constraint failure) or StoreBusyError as a REJECTED promise, never
    // a synchronous throw, so `append(...).catch(...)` is reliable for callers.
    try {
      // IMMEDIATE: acquire the write lock at BEGIN so contention surfaces as
      // SQLITE_BUSY there; runWithRetry converts sustained busy into StoreBusyError.
      // On any insert failure the transaction rolls back atomically (all-or-nothing).
      const seqs = runWithRetry(() => appendBatch.immediate(events));
      return Promise.resolve(seqs);
    } catch (err) {
      return Promise.reject(err);
    }
  };
}
