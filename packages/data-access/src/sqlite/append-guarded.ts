// Uniqueness-guarded transactional append — the ATOMIC check-then-insert that
// uniqueness constraints (FR1) require (Story 2.2, Task 1).
//
// Implements `DataAccess.appendGuarded(events, guards)` (the shape from
// `@agentbbs/core` ports.ts) as a SIBLING of `createAppend` (Story 1.5). It runs
// the uniqueness existence check(s) AND the insert(s) inside ONE better-sqlite3
// `.immediate` transaction (BEGIN IMMEDIATE → the write lock is taken at BEGIN).
// Story 1.7 proved (real 6×100 multi-process race, busyErrors=0) that BEGIN
// IMMEDIATE serializes writers across OS PROCESSES; because the guard SELECT and
// the INSERT share that single immediate transaction, no other process can commit
// between them — so the check-then-insert is atomic across processes. Two
// concurrent guarded appends for the same value therefore cannot both succeed:
// the first commits, the second sees the now-present row and rolls back.
//
// THE APPEND INVARIANT: this module issues only `SELECT` (the guard existence
// probe) and `INSERT` against `events`. No UPDATE/DELETE, no derived state, and
// no ordering by `created_at`.
//
// Why a data-described guard (not a DB-level partial UNIQUE INDEX): the predicate
// lives in `core` and is passed as DATA (`{ type, field, value }`), so the
// generic ledger schema stays free of board vocabulary (`identity.registered`,
// `$.handle`) — the module boundary the project lints. It is also portable to the
// V2 HTTP backend and generalizes to Epic 3's project/room-id uniqueness with the
// SAME primitive. [Story 2.2 Dev Notes#The atomicity crux]
//
// Researched/verified (2026-05-31, better-sqlite3 + SQLite json1 against the
// repo's installed driver): `json_extract(payload, ?)` accepts the JSON path
// (`'$.handle'`) as a BOUND parameter; a guard that throws inside `.immediate`
// rolls the transaction back leaving the row count unchanged; a passing guard
// inserts and `lastInsertRowid` is the assigned seq. Mirrors append.ts exactly so
// the two write paths share one concurrency story.

import { runWithRetry } from './connection.js';
import { UniquenessConflictError } from '../errors.js';
import { newEventToRow } from '../mapping.js';

import type { NewEvent, UniquenessGuard } from '@agentbbs/core';
import type { Database as DatabaseInstance } from 'better-sqlite3';

/**
 * Coerce a better-sqlite3 `lastInsertRowid` (`number | bigint`) to a `number`
 * seq. Identical guard to append.ts's `toSeq`: with safe-integers OFF (our
 * default) it is already a `number`; the `bigint` branch and the
 * `Number.MAX_SAFE_INTEGER` check are defensive so a future safe-integers-on
 * switch can never silently truncate a `seq` (a loud throw beats a corrupt seq).
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
 * Build the `DataAccess.appendGuarded` implementation bound to an open
 * connection. Returns a bound function (not a class) so it composes trivially
 * into the full `DataAccess` alongside the Story 1.5 `append` + Story 1.6 reads.
 *
 * @param db An open, writable better-sqlite3 connection whose `events` table
 *   exists (the caller is responsible for having run `migrate`).
 */
export function createAppendGuarded(
  db: DatabaseInstance,
): (events: NewEvent[], guards: UniquenessGuard[]) => Promise<number[]> {
  // Prepared once per connection; reused across calls. INSERT-only write +
  // existence-probe SELECT — THE APPEND INVARIANT (no UPDATE/DELETE).
  const insert = db.prepare(
    'INSERT INTO events (type, actor, created_at, payload) VALUES (?, ?, ?, ?)',
  );
  // Existence probe for one guard. The JSON path is a BOUND parameter ('$.' +
  // field); payload is stored snake_case-keyed, so the caller passes the at-rest
  // field name. LIMIT 1 — we only need to know whether ANY row collides.
  const guardProbe = db.prepare(
    'SELECT 1 FROM events WHERE type = ? AND json_extract(payload, ?) = ? LIMIT 1',
  );

  // One transaction over the whole operation: every guard is checked, then every
  // event inserted — atomic (all-or-nothing). A tripped guard throws, rolling the
  // transaction back so NOTHING is inserted. Returns the assigned seq per event,
  // in input order. NO awaits / I/O inside (timestamp computed up front) so the
  // write lock is held only for the checks + inserts.
  const appendGuardedBatch = db.transaction(
    (events: NewEvent[], guards: UniquenessGuard[]): number[] => {
      // Assert every uniqueness precondition FIRST, while holding the write lock.
      for (const guard of guards) {
        const path = `$.${guard.field}`;
        const hit = guardProbe.get(guard.type, path, guard.value);
        if (hit !== undefined) {
          // Throwing here rolls the immediate transaction back: no row is
          // inserted, and the typed conflict surfaces to core (which maps it to
          // the right BoardError). Carry the guard so a multi-guard caller can
          // tell which predicate failed.
          throw new UniquenessConflictError(
            `Uniqueness guard violated: an event of type "${guard.type}" already ` +
              `has payload field "${guard.field}" = ${JSON.stringify(guard.value)}.`,
            { type: guard.type, field: guard.field, value: guard.value },
          );
        }
      }

      const createdAt = new Date().toISOString();
      const seqs: number[] = [];
      for (const event of events) {
        const row = newEventToRow(event, createdAt);
        const info = insert.run(
          row.type,
          row.actor,
          row.created_at,
          row.payload,
        );
        seqs.push(toSeq(info.lastInsertRowid));
      }
      return seqs;
    },
  );

  /**
   * Append `events` conditional on every `guard` holding; resolve with the
   * assigned monotonic `seq`(s) in input order. An empty `events` resolves to
   * `[]` WITHOUT opening a transaction (matching `append`) — note this also skips
   * any guards, but an empty append has nothing to make conditional, so there is
   * nothing to protect. The synchronous better-sqlite3 work is wrapped in a
   * resolved/rejected Promise to conform to the async `DataAccess` seam: a
   * `UniquenessConflictError`, a constraint rollback, or a `StoreBusyError`
   * surface as a REJECTED promise, never a synchronous throw, so
   * `appendGuarded(...).catch(...)` is reliable for callers.
   */
  return function appendGuarded(
    events: NewEvent[],
    guards: UniquenessGuard[],
  ): Promise<number[]> {
    if (events.length === 0) return Promise.resolve([]);
    try {
      // IMMEDIATE: take the write lock at BEGIN so the guard check + insert are
      // atomic against other processes (contention surfaces as SQLITE_BUSY there,
      // resolved by runWithRetry). On a tripped guard or any insert failure the
      // transaction rolls back atomically — nothing persists.
      const seqs = runWithRetry(() =>
        appendGuardedBatch.immediate(events, guards),
      );
      return Promise.resolve(seqs);
    } catch (err) {
      return Promise.reject(err);
    }
  };
}
