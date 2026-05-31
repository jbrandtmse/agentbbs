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
// THE APPEND INVARIANT: this file contains ONLY `CREATE TABLE`/`CREATE INDEX`
// (idempotent via `IF NOT EXISTS`). No `UPDATE`/`DELETE`, no derived-state columns.
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
`;

/** The ledger table name — single source of truth for the append/read modules. */
export const EVENTS_TABLE = 'events';
