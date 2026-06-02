// The single append-only `events` ledger schema (Story 1.5, AC1) — AR3/NFR1.
//
// DECISION — schema as a TS string constant, NOT a separate `schema.sql` file.
// The story Task 1 names `schema.sql`, but `tsc -b` (rootDir=src, outDir=dist)
// does NOT copy non-TS assets into `dist`, so a runtime `readFileSync('schema.sql')`
// would `ENOENT` against the published build. The idiomatic, dist-safe choice for a
// SMALL single-table DDL is to inline it as an exported string constant: no
// asset-copy build step, no `import.meta.url` path gymnastics, and the DDL ships as
// plain JS. (Researched 2026-05-30 against the better-sqlite3 + tsc constraints.)
// If the schema ever grows into many migration files, revisit with a copy step.
//
// THE APPEND INVARIANT: the `events` ledger contains ONLY `CREATE TABLE`/`CREATE INDEX`
// (idempotent via `IF NOT EXISTS`). No `UPDATE`/`DELETE` on `events`, no derived-state
// columns. The append invariant governs the `events` table ONLY.
//
// THE ONE MUTABLE EXCEPTION — the `cursors` table (Story 6.1): the architecture sanctions
// a SEPARATE "per-identity stored position … legitimate bookkeeping, not understanding
// content" (architecture.md line 253). It is NOT the events ledger — it is a small
// UPSERT-able key/value table holding each identity's `check` high-water-mark — so an
// `INSERT … ON CONFLICT … DO UPDATE` against `cursors` does NOT violate the append
// invariant (which forbids mutating `events`, not a bookkeeping table). It is TRANSIENT
// per-identity bookkeeping, NOT institutional memory: it is deliberately NOT part of the
// FR32 NDJSON export — on import, cursors reset to `0` and each identity re-catches-up via
// the per-scope join floors (`boardJoinSeq`/`roomJoinSeq`). The board's TRUTH stays
// entirely in the append-only `events` ledger; this table is a derived-position cache.
//
// Column casing: ALL columns are `snake_case` — the wire/at-rest casing. `payload`
// is JSON TEXT, also `snake_case`-keyed (the camelCase→snake_case conversion lives
// in `../mapping.ts`; core never sees snake_case).

/**
 * `seq` is `INTEGER PRIMARY KEY AUTOINCREMENT` — NOT a bare rowid alias.
 *
 * Rationale (NFR10): AUTOINCREMENT makes each assigned `seq` strictly greater than
 * any value EVER used for this table and never reused, even across deletes. We
 * never delete from `events` (THE APPEND INVARIANT), so the "never reuse deleted
 * rowids" guarantee is belt-and-suspenders — but it is exactly the strictly-
 * increasing, never-reused total-order guarantee NFR10 requires, made explicit at
 * the schema level rather than relying on the (weaker) plain-rowid behaviour.
 *
 * Columns (all `snake_case`, the at-rest/wire casing):
 *   - `seq`        INTEGER PK AUTOINCREMENT — authoritative monotonic total order.
 *   - `type`       TEXT NOT NULL            — closed event vocabulary (`noun.past_tense`).
 *   - `actor`      TEXT NOT NULL            — acting handle (lowercased canonical form).
 *   - `created_at` TEXT NOT NULL            — ISO-8601 UTC, DISPLAY-ONLY (never order by it).
 *   - `payload`    TEXT NOT NULL            — JSON with `snake_case` keys.
 *
 * Baseline indexes `idx_events_type` / `idx_events_actor` back the Story 1.6
 * `eventsByType` / `eventsByActor` read paths. All statements use `IF NOT EXISTS`
 * so applying the schema against an already-migrated DB is a no-op.
 *
 * `cursors` (Story 6.1) — the per-identity `check` cursor (the architecture-sanctioned
 * mutable bookkeeping table, line 253). `handle` is the PRIMARY KEY (one row per identity);
 * `seq` is that identity's high-water-mark — the max `seq` their last `check` RETURNED.
 * UPSERT-able (the `setCursor` adapter does `INSERT … ON CONFLICT(handle) DO UPDATE`).
 * SEPARATE from `events` — the append invariant governs `events` only — and deliberately
 * OUTSIDE the FR32 export (transient position, not institutional memory; see the file header).
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  actor      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);

CREATE INDEX IF NOT EXISTS idx_events_actor ON events (actor);

CREATE TABLE IF NOT EXISTS cursors (
  handle TEXT PRIMARY KEY,
  seq    INTEGER NOT NULL
);
`;

/** The ledger table name — single source of truth for the append/read modules. */
export const EVENTS_TABLE = 'events';

/**
 * The per-identity `check`-cursor table name (Story 6.1). The architecture-sanctioned
 * mutable bookkeeping table (line 253) — SEPARATE from the append-only `events` ledger.
 */
export const CURSORS_TABLE = 'cursors';
