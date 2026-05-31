// Read queries — the READ half of the DataAccess seam (Story 1.6, AC1).
//
// Implements the read methods declared on the `@agentbbs/core` `DataAccess` port:
// `eventsSince`, `eventsByType`, `eventsByActor`, `maxSeq`. Story 1.5 delivered the
// WRITE half (`append`); Story 1.6 composes both into the full `DataAccess`
// (see ../index.ts `createDataAccess`).
//
// THE APPEND INVARIANT (load-bearing, lint-enforced):
//   - EVERY row-returning query orders by `seq` ASC — the authoritative total order.
//     NEVER `created_at` (display-only). The append-invariant lint guard rejects
//     `ORDER BY created_at`; we only ever order by `seq`.
//   - Reads are pure SELECTs; no transaction is needed (project-context.md#SQLite
//     concurrency: "reads need none"). No UPDATE/DELETE ever touches the ledger.
//
// CASING BOUNDARY: this module does NO casing conversion. It SELECTs the raw
// snake_case rows and hands each through `rowToEvent` (../mapping.ts) — the single
// place the two casings meet. `core` only ever receives camelCase `Event`s.
//
// Researched (2026-05-30, better-sqlite3 + SQLite docs):
//   - Prepared `.all(...)` returns an array of plain objects keyed by column name
//     (empty array, never null, for zero rows); `.get(...)` returns the first row
//     object or `undefined`. With safe-integers OFF (our default) INTEGER columns
//     come back as `number`, TEXT as `string`, SQL NULL as `null`.
//   - `SELECT MAX(seq) ...` on an EMPTY table still returns exactly one row,
//     `{ max_seq: null }` (aggregate without GROUP BY always yields a row). We map
//     `null` -> 0 (the empty-ledger sentinel documented on `DataAccess.maxSeq`).
//   - MAX(seq) over INTEGER is a `number` with safe-integers off, but we coerce via
//     `toSeq` (the same defensive bigint guard append.ts uses) so a future
//     safe-integers-on switch can't silently leak a `bigint` past the seam.
//
// Room-scoped reads (DECISION — deferred): the epics list a "by room" read, but
// `roomId` lives INSIDE the payload (snake_case `room_id`), not as a column. A
// room-scoped read via `json_extract(payload, '$.room_id')` belongs with its first
// real consumer — the Epic 4 room projection (read_room) — which can add it
// additively to the port plus a matching access-path index then. Adding it
// speculatively now would ship an untested, unconsumed query and an index nothing
// reads. This story keeps the read set minimal-but-sufficient: exactly the four
// `seq`-ordered primitives the port declares today.

import { rowToEvent } from '../mapping.js';

import type { StoredEventRow } from '../mapping.js';
import type { Event, EventType } from '@agentbbs/core';
import type { Database as DatabaseInstance } from 'better-sqlite3';

/** The columns every read selects, in a fixed order — the full on-disk row. */
const SELECT_COLUMNS = 'seq, type, actor, created_at, payload';

/**
 * Coerce a SQLite `MAX(seq)` aggregate (`number | bigint | null`) to a `number`
 * seq, mapping `null` (empty ledger) to `0`. Mirrors append.ts's `toSeq` bigint
 * guard: with safe-integers off the value is already a `number`, but if a future
 * switch turns it into a `bigint` we coerce — and throw rather than silently lose
 * precision above `Number.MAX_SAFE_INTEGER` (a loud failure beats a corrupt seq).
 */
function maxSeqValue(value: number | bigint | null): number {
  if (value === null) return 0;
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `maxSeq ${value} exceeds Number.MAX_SAFE_INTEGER and cannot be ` +
          `represented exactly as a JS number.`,
      );
    }
    return Number(value);
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `maxSeq ${value} exceeds Number.MAX_SAFE_INTEGER and cannot be ` +
        `represented exactly as a JS number.`,
    );
  }
  return value;
}

/** The read methods of the `DataAccess` port, bound to one open connection. */
export interface ReadQueries {
  eventsSince(cursor: number): Promise<Event[]>;
  eventsByType(type: EventType): Promise<Event[]>;
  eventsByActor(actor: string): Promise<Event[]>;
  maxSeq(): Promise<number>;
}

/**
 * Build the `DataAccess` READ methods bound to an open connection. Returns an
 * object of already-async methods (the synchronous better-sqlite3 work is wrapped
 * in resolved Promises) so it composes trivially with the Story 1.5 `append` into
 * the full `DataAccess` (../index.ts).
 *
 * Statements are prepared ONCE per connection here and reused across calls
 * (better-sqlite3 also caches compiled SQL). All ordering is by `seq` ASC.
 *
 * @param db An open better-sqlite3 connection. The caller must have run `migrate`
 *   so the `events` table + its `type`/`actor` indexes exist.
 */
export function createReadQueries(db: DatabaseInstance): ReadQueries {
  // seq > :cursor — the pull-only `check` delta basis. ORDER BY seq ASC.
  const sinceStmt = db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM events WHERE seq > ? ORDER BY seq ASC`,
  );
  // Backed by idx_events_type (Story 1.5 schema). ORDER BY seq ASC.
  const byTypeStmt = db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM events WHERE type = ? ORDER BY seq ASC`,
  );
  // Backed by idx_events_actor (Story 1.5 schema). ORDER BY seq ASC.
  const byActorStmt = db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM events WHERE actor = ? ORDER BY seq ASC`,
  );
  // Aggregate: always returns one row ({ max_seq: null } on an empty ledger).
  const maxSeqStmt = db.prepare('SELECT MAX(seq) AS max_seq FROM events');

  /** Map a batch of raw rows to internal camelCase Events (the single boundary). */
  function toEvents(rows: StoredEventRow[]): Event[] {
    return rows.map((row) => rowToEvent(row));
  }

  return {
    eventsSince(cursor: number): Promise<Event[]> {
      const rows = sinceStmt.all(cursor) as StoredEventRow[];
      return Promise.resolve(toEvents(rows));
    },

    eventsByType(type: EventType): Promise<Event[]> {
      const rows = byTypeStmt.all(type) as StoredEventRow[];
      return Promise.resolve(toEvents(rows));
    },

    eventsByActor(actor: string): Promise<Event[]> {
      const rows = byActorStmt.all(actor) as StoredEventRow[];
      return Promise.resolve(toEvents(rows));
    },

    maxSeq(): Promise<number> {
      const row = maxSeqStmt.get() as { max_seq: number | bigint | null };
      return Promise.resolve(maxSeqValue(row.max_seq));
    },
  };
}
