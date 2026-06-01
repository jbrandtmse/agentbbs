// The per-identity `check`-cursor store (Story 6.1) — the ONE mutable bookkeeping
// table behind the DataAccess seam.
//
// Implements the `getCursor`/`setCursor` methods the `@agentbbs/core` `DataAccess`
// port declares (Story 6.1). The cursor is each identity's `check` high-water-mark —
// the max `seq` their last dial-in RETURNED. It lives in the SEPARATE `cursors` table
// (schema.ts), NOT the append-only `events` ledger.
//
// THE APPEND INVARIANT — NOT violated here: the invariant forbids `UPDATE`/`DELETE`
// against `events`. This module's `INSERT … ON CONFLICT(handle) DO UPDATE SET seq …`
// targets the `cursors` table (the architecture-sanctioned "per-identity stored
// position … legitimate bookkeeping", line 253) — a different table. The append-
// invariant lint guard (`eslint.config.js` §5) matches the literal `UPDATE events` /
// `DELETE FROM events`; `DO UPDATE SET seq = excluded.seq` has no `events` token after
// `UPDATE`, so it is not flagged (verified against the guard's regex).
//
// Researched (better-sqlite3 + SQLite UPSERT docs):
//   - `INSERT … ON CONFLICT(<pk>) DO UPDATE SET col = excluded.col` is SQLite's UPSERT:
//     on a primary-key collision it updates the existing row to the would-be-inserted
//     value (`excluded` is the rejected insert row), leaving a single row per handle.
//   - `.get(...)` on the SELECT returns the row object or `undefined` (no row) — we map
//     a miss to `0` (the documented unset sentinel on `DataAccess.getCursor`).
//   - With safe-integers OFF (our default) the INTEGER `seq` comes back as a `number`.
//
// The write wraps `runWithRetry` (the same bounded-busy backstop append uses) so a
// transient `SQLITE_BUSY` surfaces as a typed `StoreBusyError`, never a raw driver
// error; the read is a pure SELECT and needs no transaction (project-context.md#SQLite
// concurrency: "reads need none").

import { runWithRetry } from './connection.js';

import type { Database as DatabaseInstance } from 'better-sqlite3';

/**
 * Coerce a SQLite cursor `seq` value (`number | bigint`) to a `number`. With
 * safe-integers off (our default) it is already a `number`; the `bigint` branch is a
 * defensive guard mirroring `append.ts`'s `toSeq` / `queries.ts`'s `maxSeqValue` — a
 * value above `Number.MAX_SAFE_INTEGER` throws rather than silently losing precision.
 */
function toCursorSeq(value: number | bigint): number {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `cursor seq ${value} exceeds Number.MAX_SAFE_INTEGER and cannot be ` +
          `represented exactly as a JS number.`,
      );
    }
    return Number(value);
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `cursor seq ${value} exceeds Number.MAX_SAFE_INTEGER and cannot be ` +
        `represented exactly as a JS number.`,
    );
  }
  return value;
}

/** The cursor methods of the `DataAccess` port, bound to one open connection. */
export interface CursorQueries {
  getCursor(handle: string): Promise<number>;
  setCursor(handle: string, seq: number): Promise<void>;
}

/**
 * Build the `DataAccess` cursor methods (`getCursor`/`setCursor`) bound to an open
 * connection. Returns already-async methods (the synchronous better-sqlite3 work is
 * wrapped in resolved Promises) so it composes trivially into the full `DataAccess`
 * (../data-access.ts), alongside the append + read halves.
 *
 * Statements are prepared ONCE per connection and reused across calls.
 *
 * @param db An open better-sqlite3 connection. The caller must have run `migrate` so
 *   the `cursors` table exists.
 */
export function createCursorQueries(db: DatabaseInstance): CursorQueries {
  // Read one identity's stored cursor; `undefined` (no row) → the unset sentinel 0.
  const getStmt = db.prepare('SELECT seq FROM cursors WHERE handle = ?');
  // UPSERT the cursor: insert, or overwrite the existing row on a handle collision.
  // `DO UPDATE SET seq = excluded.seq` targets `cursors`, NOT `events` — the append
  // invariant (which governs `events` only) is preserved.
  const setStmt = db.prepare(
    'INSERT INTO cursors (handle, seq) VALUES (?, ?) ' +
      'ON CONFLICT(handle) DO UPDATE SET seq = excluded.seq',
  );

  return {
    getCursor(handle: string): Promise<number> {
      const row = getStmt.get(handle) as { seq: number | bigint } | undefined;
      // No stored cursor yet → 0 (the documented unset sentinel).
      return Promise.resolve(row === undefined ? 0 : toCursorSeq(row.seq));
    },

    setCursor(handle: string, seq: number): Promise<void> {
      try {
        // IMMEDIATE write via the prepared UPSERT; runWithRetry converts sustained
        // busy into a typed StoreBusyError (never a raw driver error past the seam).
        runWithRetry(() => setStmt.run(handle, seq));
        return Promise.resolve();
      } catch (err) {
        // Surface a rollback / StoreBusyError as a REJECTED promise (async seam), so
        // `setCursor(...).catch(...)` is reliable — never a synchronous throw.
        return Promise.reject(err);
      }
    },
  };
}
