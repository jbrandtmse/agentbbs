---
story_id: "1.5"
story_key: "1-5-append-only-events-table-with-authoritative-sequence"
epic: 1
baseline_commit: "dbba771abe055be6b5b20475dceed9eeffe59ece"
---

# Story 1.5: Append-only events table with authoritative sequence

Status: done

## Story

As a developer,
I want the single `events` table created by a forward-only migration and a transactional append that returns the assigned `seq`,
so that every mutation is one immutable, totally-ordered row (NFR1/NFR10).

## Acceptance Criteria

**AC1 — Schema + forward-only idempotent migration**
**Given** a fresh database,
**When** migration runs,
**Then** it creates `events(seq INTEGER PRIMARY KEY AUTOINCREMENT, type, actor, created_at, payload)` with `snake_case` columns and the baseline indexes (`idx_events_type`, `idx_events_actor`),
**And** migration is forward-only and idempotent (re-running does not error or duplicate schema).

**AC2 — Transactional append returns monotonic seq; append-only**
**Given** the append path,
**When** one or more events are appended in a single call,
**Then** they are written in one transaction and the assigned monotonic `seq`(s) are returned,
**And** `created_at` is stored as an ISO-8601 UTC `TEXT` for display only,
**And** there is no code path that issues `UPDATE` or `DELETE` against `events`.

## Integration ACs

This story implements the **write half of the `DataAccess` seam** (`append`) on top of the Story 1.4 connection. Per skill-rules Rule 1:

- **No external consumer ships in this story**, but the deliverable is exercised directly by real-runtime tests: append N events on a real SQLite DB, assert exactly N rows with unique strictly-monotonic `seq` returned in order, assert `created_at` is ISO-8601 UTC TEXT, assert payload round-trips, and assert the migration is idempotent (run twice → no error, no duplicate schema). **First consumers:** Story 1.6 (read queries fold over these rows; `mapping.ts` read-direction), Story 1.7 (the N×M multi-process concurrency proof appends through this path), Epic 2 (core `register`/etc. append via this method).

## Consumed-by

- Story 1.6 — Read-query path + mapping (reads/folds the rows this writes; completes `mapping.ts`).
- Story 1.7 — Multi-process concurrency verification (N×M appends through this exact path).
- Epic 2+ — every state change appends through `core → DataAccess.append`.

## Tasks / Subtasks

- [x] **Task 1: Schema + migration** (AC: 1)
  - [x] Schema defines `events(seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL)` — all `snake_case` columns; `payload` is JSON TEXT. Baseline indexes `idx_events_type` / `idx_events_actor`. `CREATE TABLE/INDEX IF NOT EXISTS` so re-running is a no-op. (Lives in `sqlite/schema.ts` as an exported `SCHEMA_SQL` constant rather than `schema.sql` — see Completion Notes for the documented rationale.)
  - [x] `packages/data-access/src/sqlite/migrate.ts`: forward-only, idempotent migration runner applying the baseline schema in one transaction. No version table for V1 (documented). Re-running on a migrated DB is a no-op (no error, no dup, no data loss).
  - [x] Documented: `seq` is `INTEGER PRIMARY KEY AUTOINCREMENT` (not a bare rowid alias) — strictly-increasing, never-reused total order (NFR10); belt-and-suspenders since we never delete.
- [x] **Task 2: Transactional append** (AC: 2)
  - [x] `packages/data-access/src/sqlite/append.ts`: `createAppend(db)` returns `append(events: NewEvent[]): Promise<number[]>`. ALL inserts of one call run in ONE `db.transaction(...)` (`.immediate`); returns the assigned `seq`(s) in input order via `lastInsertRowid`. Wrapped in the Story 1.4 bounded-retry helper; no I/O held across the transaction.
  - [x] `created_at`: assigned at append time as `new Date().toISOString()` (ISO-8601 UTC TEXT) — display-only; ordering is always by `seq`.
  - [x] APPEND-ONLY: only `INSERT` against `events`; no `UPDATE`/`DELETE` (lint guard green; grep-verified).
- [x] **Task 3: Wire mapping (write direction) — in mapping.ts, not inline** (AC: 1, 2)
  - [x] `packages/data-access/src/mapping.ts`: WRITE direction (`newEventToRow` / `payloadToWire`) — exhaustive per-type camelCase→snake_case conversion. No casing conversion inline in `append.ts`; `core` never sees snake_case.
- [x] **Task 4: DataAccess wiring (partial) + barrel** (AC: 2)
  - [x] `createAppend` is the `DataAccess.append` implementation, shaped so Story 1.6 composes the full `DataAccess` cleanly. Public surface exported via the `index.ts` barrel (no deep-path imports).
- [x] **Task 5: Tests + gates** (AC: 1, 2)
  - [x] Co-located real-runtime `*.test.ts` (Vitest, discoverable, typecheck-clean), temp DB in OS temp dir:
    - migration creates the exact schema (columns + both indexes) and is idempotent (no error/dup/data-loss) — asserted via `PRAGMA table_info`/`sqlite_master`/`sqlite_sequence`.
    - append of N events → exactly N rows, unique strictly-monotonic `seq`s in input order; multi-event append atomic (forced mid-batch failure → zero rows).
    - `created_at` is valid ISO-8601 UTC; payload round-trips snake_case on disk, camelCase from core types.
  - [x] `pnpm -r build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test` — all exit 0 (73 tests pass).

## Dev Notes

### Scope boundary (read first)
This story delivers the `events` schema + forward-only idempotent migration + the transactional append (write half of the seam) + the WRITE-direction wire mapping. **Out of scope:** read queries (Story 1.6 — `queries.ts` + the READ direction of `mapping.ts`), the multi-process N×M concurrency proof (Story 1.7), and any `core` domain logic / projections (Epics 2+). Do NOT add `UPDATE`/`DELETE`. Do NOT order anything by `created_at`.

### Authoritative facts [Source: project-context.md; architecture.md]
- **Single append-only `events` table (AR3/NFR1):** `events(seq, type, actor, created_at, payload)`; `seq INTEGER PRIMARY KEY AUTOINCREMENT` is the authoritative total order (NFR10). Baseline indexes `idx_events_type`, `idx_events_actor`. Forward-only `migrate.ts`. [Source: architecture.md#Data Architecture; epics.md#Epic 1 AR3]
- **Append (AR4/NFR10):** each call wraps its append(s) in ONE transaction; SQLite serializes writers so `seq` is a monotonic total order with no extra coordination; `seq` assigned at append. [Source: project-context.md#SQLite concurrency / THE APPEND INVARIANT]
- **THE APPEND INVARIANT:** no `UPDATE`/`DELETE` against `events`; never persist derived state; order by `seq`, never `created_at` (`created_at` = ISO-8601 UTC TEXT, display-only). [Source: project-context.md#THE APPEND INVARIANT]
- **Wire/internal split:** event `payload` fields are `snake_case` on the wire/at rest; `camelCase` inside TS; conversion lives ONLY in `data-access/mapping.ts`. [Source: architecture.md#Wire casing; project-context.md#Wire / serialization contract]

### Build on Story 1.4 [committed dbba771]
- `connection.ts` opens the DB (WAL + busy_timeout=5000 + bounded retry helper + `StoreBusyError`); `path.ts` discovers the path. REUSE the connection + the retry wrapper — do NOT re-open with different pragmas or add new coordination. `core` (`@agentbbs/core`, ccdb670) provides `NewEvent`/`Event`/`EventType`/`EventPayloadMap` and the async `DataAccess` interface `append` shape — implement against it.

### Research-First [Source: .claude/rules/research-first.md]
Verify: better-sqlite3 transaction API (`db.transaction()` semantics, return of `lastInsertRowid` / `info.lastInsertRowid` type — it can be `bigint`; coerce to `number` carefully and document the safe range), `INTEGER PRIMARY KEY AUTOINCREMENT` exact semantics vs plain rowid, and `IF NOT EXISTS` idempotency. Don't rely on stale memory.

### Testing standards [Source: project-context.md#Testing]
Vitest, co-located, real-runtime (genuine SQLite file), temp dirs only — never the repo's `.agentbbs/`. Discoverable (Rule 8) + typecheck-clean (Story 1.3 gate). This is the substrate Story 1.7's correctness proof builds on — get the monotonic-seq + atomic-multi-append behavior demonstrably right here.

### Project Structure Notes
- Files: `packages/data-access/src/sqlite/{schema.sql,migrate.ts,append.ts}`, `packages/data-access/src/mapping.ts` (write direction), barrel updates. Paths per architecture.md#Complete Project Directory Structure.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5: Append-only events table with authoritative sequence]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture (the Ledger) / Complete Project Directory Structure]
- [Source: _bmad-output/project-context.md#THE APPEND INVARIANT / SQLite concurrency / Wire / serialization contract]
- [Source: .claude/rules/research-first.md]

## QA Results

**Stage:** qa-generate-e2e-tests · **Date:** 2026-05-30 · **Agent:** claude-opus-4-8[1m] (AgentBBS epic-cycle QA stage).

**Verdict:** AC surface has genuine real-runtime coverage (Rule 3 satisfied — real SQLite files in OS temp dirs, exercised through the real connection/migrate/append/mapping modules). All four gates exit 0. Added 4 targeted tests closing genuine, non-redundant gaps; no defects found in the deliverable.

**Gates (all exit 0):** `pnpm -r build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test` — suite now **77 tests / 13 files** (was 73/12).

**Coverage assessment of the dev suite (already present, genuine):** exact schema columns/types/NOT-NULL + both indexes + AUTOINCREMENT/`sqlite_sequence` (migrate.test.ts); migration idempotency incl. no-data-loss (migrate.test.ts); N-row append with unique strictly-monotonic seq in input order, cross-call continuation, empty-batch no-op, atomic mid-batch rollback → zero rows (append.test.ts); `created_at` ISO-8601 UTC + snake_case-on-disk/camelCase-from-core payload round-trips incl. multi-word keys (append.test.ts); exhaustive camelCase→snake_case mapping with no camelCase leak (mapping.test.ts). Append-only is lint-enforced (`UPDATE events`/`DELETE FROM events`/`ORDER BY created_at` banned in eslint.config.js) — a separate asserting test was deemed optional and not added.

**QA tests added (`packages/data-access/src/sqlite/append.qa.test.ts`, 4 tests, real-runtime, OS temp dirs, `.qa.test.ts` convention matching the discoverable `**/*.test.{ts,tsx}` glob — Rule 8 confirmed):**
1. Sequence integrity across rollback (NFR10): after a rejected mid-flight batch, a subsequent append continues strictly above the last *committed* seq; the persisted ledger stays strictly increasing with no reused seq.
2. AUTOINCREMENT high-water mark (`sqlite_sequence`) only advances across a rollback — never decreases/reuses; the next successful seq is strictly above it. (Substrate for Story 1.7's N×M proof.)
3. THE APPEND INVARIANT — total order is `seq`, never `created_at`: with timestamps deliberately reversed vs. insertion order, `ORDER BY seq` reflects insertion order while `ORDER BY created_at` is the opposite, proving the seq-ordering choice is load-bearing.
4. AC1 column ordinal order: PRAGMA `cid` order is exactly `seq, type, actor, created_at, payload` (the dev suite only pinned the name set).

**Constraints honored:** no second runner introduced; no `git commit`/`push`; temp DBs only under `os.tmpdir()` (never the repo `.agentbbs/`); typecheck-clean; no `UPDATE`/`DELETE` and no `ORDER BY created_at` introduced.

## Review Findings

**Stage:** code-review · **Date:** 2026-05-30 · **Agent:** claude-opus-4-8[1m] (AgentBBS epic-cycle Code Review stage). Three review layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) conducted in a single reviewer; all four gates re-run independently (exit 0); whole-package append-invariant grep performed; better-sqlite3 `Transaction.immediate(...args)` + `RunResult.lastInsertRowid: number | bigint` confirmed against installed `@types/better-sqlite3@7.6.13`.

**Verdict: APPROVED — done.** Zero HIGH/MED/patch findings. AC1 and AC2 fully met; THE APPEND INVARIANT holds (production data-access source issues ONLY `INSERT` against `events` — no `UPDATE`/`DELETE`, no derived-state columns, no `ORDER BY created_at`); the Story 1.2 lint guard is correctly scoped to `data-access` and green. Scope discipline honored (write half only; no read queries / N×M proof / core logic). Wire casing conversion is confined to `mapping.ts` (exhaustive 10-type switch + `assertNever`); `append.ts` does zero inline casing; payload is snake_case on disk (test-verified). The `schema.sql`→`SCHEMA_SQL` deviation is correct and properly documented (tsc -b does not copy `.sql` assets into `dist`; the architecture filename is descriptive, not a prescribed runtime file read — no functional deviation). bigint→number `seq` coercion is guarded against `> MAX_SAFE_INTEGER` and documented. Rules 1/3/5/6/8 satisfied (real-runtime SQLite tests; `append.qa.test.ts` confirmed discoverable by the default `*.test.{ts,tsx}` glob — `vitest list` reports its 4 tests; no `docs/adr/`).

### Findings

- [x] [Review][Defer] Append-invariant lint guard is disabled in `*.test.ts` files [eslint.config.js:section 6] — deferred, pre-existing (Story 1.2 design). The `no-restricted-syntax` append-invariant guard is turned `off` for test files (so the boundary-enforcement fixture can embed forbidden SQL as string literals). Consequence: an `UPDATE events` / `DELETE FROM events` / `ORDER BY created_at` introduced in a future *test helper* would not be lint-caught (only review-caught). Not caused by this story; the QA test's legitimate `ORDER BY created_at ASC` (asserting the seq-vs-created_at order genuinely differs) relies on this exemption and is correct. Logged to deferred-work.md.

**Dismissed as noise (not defects — verified intentional/correct):** (1) `toSeq` plain-`number` branch comparing `> Number.MAX_SAFE_INTEGER` is best-effort for an already-lossy value — correct in intent (refuses unsafe seqs); the real guard is the `bigint` branch. (2) `created_at` computed once per batch (shared across a multi-event append) — acceptable: ordering is by `seq`, `created_at` is display-only. (3) Reused prepared `insert` statement across calls/transactions — supported by better-sqlite3 (statement cache). (4) `appendBatch.immediate(events)` forwarding the batch arg — verified correct against the `Transaction.immediate(...params)` type. (5) `runWithRetry` wrapping the IMMEDIATE transaction — safe: a busy error at BEGIN rolls back fully (zero inserts) so retry cannot double-insert.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — bmad-dev-story, AgentBBS epic-cycle Dev stage.

### Debug Log References

- Gates (all exit 0): `pnpm -r build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (73 tests pass across 12 files).
- One test-driven fix during GREEN: the atomic-rollback test initially failed because a constraint failure propagated as a SYNCHRONOUS throw out of `append` (the synchronous `runWithRetry` threw before `Promise.resolve`). Hardened `append` to catch and return `Promise.reject(err)` so the async `DataAccess` seam always surfaces failures as a rejected promise — `append(...).catch(...)` is now reliable. Re-ran all four gates: green.

### Completion Notes List

- **Schema location (deviation from Task 1 filename, documented):** the story names `sqlite/schema.sql`, but `tsc -b` (rootDir=src→outDir=dist) does NOT copy non-TS assets, so a runtime `readFileSync('schema.sql')` would `ENOENT` against the built package. Per Research-First (verified the tsc asset-copy constraint), the idiomatic dist-safe choice for a small single-table DDL is an exported `SCHEMA_SQL` string constant in `sqlite/schema.ts` — no asset-copy build step, no `import.meta.url` path resolution. Scope/intent (schema + idempotent migration) is fully met. Revisit with a copy step only if the schema grows into many migration files.
- **`seq` = `INTEGER PRIMARY KEY AUTOINCREMENT`** (not a bare rowid alias): AUTOINCREMENT guarantees each `seq` is strictly greater than any value ever used and never reused — exactly NFR10's monotonic, never-reused total order. Belt-and-suspenders vs. delete-reuse since the ledger is append-only.
- **No version table for V1 migration:** a single forward-only "apply baseline schema (IF NOT EXISTS)" is sufficient and idempotent for one immutable table + two indexes; documented as forward-only-forever in `migrate.ts`.
- **better-sqlite3 research (verified against official docs):** `db.transaction(fn)` wraps BEGIN/COMMIT, ROLLBACK on throw, runs synchronously, returns `fn`'s value. Used `.immediate` so the write lock is taken at BEGIN and contention surfaces as `SQLITE_BUSY` there (handled by the Story 1.4 `runWithRetry`) rather than mid-batch. `info.lastInsertRowid` is `number` by default (safe-integers OFF) but typed `number | bigint`; `toSeq` coerces defensively and throws above `Number.MAX_SAFE_INTEGER` rather than silently losing precision (range documented).
- **Wire mapping:** explicit exhaustive per-type `switch` (closed 10-type vocabulary) with an `assertNever` guard — a new `EventType` without a branch fails to compile. Only `currentFocus`/`projectId`/`roomId`/`messageSeq` actually change casing; the rest are single-word. `core` never sees snake_case; `append.ts` does zero inline casing.
- **Scope honored:** schema + forward-only idempotent migration + transactional append (write half) + WRITE-direction mapping only. No read queries (Story 1.6), no N×M concurrency proof (Story 1.7), no core domain logic. No `UPDATE`/`DELETE`; nothing orders by `created_at`.
- **NFR tripwire (Rule 5):** none triggered — NFR1/NFR10 are implementable as worded.
- **ADR registry (Rule 6):** `docs/adr/` does not exist — no ADRs to consult; verified.

### File List

- packages/data-access/src/sqlite/schema.ts (new)
- packages/data-access/src/sqlite/migrate.ts (new)
- packages/data-access/src/sqlite/append.ts (new)
- packages/data-access/src/mapping.ts (new)
- packages/data-access/src/index.ts (modified — barrel exports for the write-path surface)
- packages/data-access/src/sqlite/migrate.test.ts (new)
- packages/data-access/src/sqlite/append.test.ts (new)
- packages/data-access/src/mapping.test.ts (new)
- _bmad-output/implementation-artifacts/1-5-append-only-events-table-with-authoritative-sequence.md (modified — frontmatter baseline_commit, task checkboxes, Dev Agent Record, Status)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — story status → in-progress → review)

### Change Log

- 2026-05-30 — Story 1.5 implemented: append-only `events` schema + forward-only idempotent migration + transactional `append` (write half of the DataAccess seam) + WRITE-direction wire mapping. All four gates green; 73 tests pass.
