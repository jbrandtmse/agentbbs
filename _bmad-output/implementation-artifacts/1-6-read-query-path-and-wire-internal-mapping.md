---
story_id: "1.6"
story_key: "1-6-read-query-path-and-wire-internal-mapping"
epic: 1
baseline_commit: "8322b0dc51014798f17bc66e9258c6e8e7c03cb1"
---

# Story 1.6: Read-query path and wire/internal mapping

Status: done

## Story

As a developer,
I want `data-access` to implement the `DataAccess` read queries and the single snake_case⇄camelCase mapping boundary,
so that `core` projections can fold events without ever seeing storage or wire casing.

## Acceptance Criteria

**AC1 — Read queries ordered by seq, camelCase, mapping centralized**
**Given** events in the ledger,
**When** `core` calls a `DataAccess` read query (e.g. events since a `seq`, events by type/actor/room),
**Then** results are returned ordered by `seq` (never `created_at`) as internal `camelCase` objects,
**And** the snake_case wire/payload ⇄ camelCase internal conversion happens only in `data-access/mapping.ts`.

**AC2 — core depends only on the port**
**Given** `core`,
**When** I inspect its imports,
**Then** it imports the `DataAccess` interface from `ports.ts` and never imports `data-access` or `better-sqlite3` directly.

## Integration ACs

This story completes the `DataAccess` **read half** + the **read-direction wire mapping**, finishing the first full implementation of the `core/ports.ts` `DataAccess` interface (append from 1.5 + reads here). Per skill-rules Rule 1:

- **Producer↔consumer wire-up exercised here:** real-runtime tests append events (via the Story 1.5 `append`) and then read them back through the read queries, asserting `seq`-ordered camelCase `Event` objects whose payloads round-trip (snake_case on disk → camelCase out). This is the append→read round-trip the whole ledger depends on. **First external consumers:** Story 1.7 (folds the ledger from multiple readers to prove total-order agreement), and Epic 2+ (`core` projections call these read methods).

## Consumed-by

- Story 1.7 — Multi-process concurrency verification (every reader folds the ledger via these queries; total-order agreement).
- Epic 2+ — `core` projections (directory, membership, activation, contract, cursor) read via this `DataAccess`.

## Tasks / Subtasks

- [x] **Task 1: Read queries** (AC: 1)
  - [x] `packages/data-access/src/sqlite/queries.ts`: implement the read methods declared on the `core` `DataAccess` interface (Story 1.3): `eventsSince(cursor)`, `eventsByType(type)`, `eventsByActor(actor)`, `maxSeq()`. ALL row-returning queries `ORDER BY seq` (ascending; never `created_at`). Use prepared statements; lean on the `idx_events_type`/`idx_events_actor` indexes (1.5). `maxSeq()` returns the current highest `seq` (0 or a documented sentinel when empty).
  - [x] If the interface needs room-scoped reads (epics AC lists "by room"): events are typed by `type` with `roomId` inside the payload — implement a room-scoped read via `json_extract(payload, '$.room_id')` (note: payload keys are snake_case on disk). Add it additively to the interface + an access-path index if warranted. If room-scoped reads are better deferred to the consuming projection story (Epic 4), document that decision instead of speculatively adding — keep this story's read set minimal-but-sufficient and `seq`-ordered.
- [x] **Task 2: Mapping (read direction) — complete mapping.ts** (AC: 1)
  - [x] Complete `packages/data-access/src/mapping.ts` with the READ direction (`rowToEvent`/`wireToPayload`): a DB row (snake_case columns + snake_case JSON payload) → internal camelCase `Event` (`seq`, `type`, `actor`, `createdAt`, typed `payload`). Exhaustive over all 10 event types (mirror the 1.5 write-direction switch + `assertNever`). This file remains the ONLY place the two casings meet — no casing conversion in `queries.ts` or `core`.
  - [x] Round-trip property: `rowToEvent(writeRow(newEvent))`'s payload equals the original camelCase payload (modulo the assigned `seq`/`createdAt`).
- [x] **Task 3: Compose the full DataAccess impl** (AC: 1, 2)
  - [x] Compose append (Story 1.5) + the read queries into a single object that implements the `core` `DataAccess` interface, constructed from a connection (Story 1.4). Export it from `packages/data-access/src/index.ts` (barrel) as the package's public surface (e.g. `createDataAccess(opts?)` opening via path discovery + migrate, returning a `DataAccess`). Keep better-sqlite3 entirely inside this package.
  - [x] Confirm the object is assignable to the `core` `DataAccess` type (a compile-time `satisfies`/type-check is the cleanest proof — covered by the typecheck gate).
- [x] **Task 4: AC2 guard — core depends only on the port** (AC: 2)
  - [x] Verify `core` imports the `DataAccess` type from its own `ports.ts` and never imports `@agentbbs/data-access` or `better-sqlite3`. This is enforced by the Story 1.2 import-boundary lint; ADD an explicit assertion to the boundary-enforcement test (or a dedicated test) that a `core`→`data-access` or `core`→`better-sqlite3` import is rejected, so AC2 is provably guarded (not just incidentally true). Keep it discoverable.
- [x] **Task 5: Tests + gates** (AC: 1, 2)
  - [x] Co-located real-runtime `*.test.ts` (Vitest, discoverable, typecheck-clean), temp DB:
    - append a mixed set of events, then `eventsSince`/`eventsByType`/`eventsByActor` return `seq`-ordered camelCase `Event`s with correct payloads; `eventsSince(k)` returns only `seq > k`; `maxSeq()` correct (incl. empty-DB case).
    - mapping round-trip: write→read yields the original camelCase payload; snake_case keys confirmed on disk (raw read) and never surfaced to the reader.
    - the AC2 boundary assertion (core cannot import data-access/better-sqlite3) fires.
  - [x] Run `pnpm -r build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test` — all exit 0.

## Dev Notes

### Scope boundary (read first)
This story delivers the read queries + the read-direction of `mapping.ts` + the composed full `DataAccess` implementation + the AC2 boundary guard. **Out of scope:** the multi-process N×M concurrency proof (Story 1.7 — though this is its prerequisite), and all `core` domain logic / projections (Epics 2+). Do NOT build projections (membership/activation/contract/cursor) here — only the generic read primitives the interface declares.

### Authoritative facts [Source: project-context.md; architecture.md]
- **Read path (AR5/AR8):** `data-access` read queries return events/projections ordered by `seq`, never `created_at`; results are internal camelCase. [Source: architecture.md#The Data-Access Seam / Data Architecture]
- **Single mapping boundary:** snake_case wire/payload ⇄ camelCase internal conversion lives ONLY in `data-access/mapping.ts` (write direction added in 1.5; read direction here). Core never sees snake_case; `queries.ts` does no casing conversion. [Source: project-context.md#Wire / serialization contract; architecture.md#Cross-cutting concerns / Wire⇄internal mapping]
- **Module boundary (AC2):** `core` depends only on `core/ports.ts`; never imports `data-access` or `better-sqlite3` (lint-enforced; assert it). [Source: project-context.md#Module boundaries; architecture.md#Architectural Boundaries]
- **Order by `seq`:** every read orders by `seq`; `created_at` is display-only. [Source: project-context.md#THE APPEND INVARIANT]

### Build on Stories 1.3/1.4/1.5
- 1.3 (`@agentbbs/core`): `DataAccess` interface (append + read method signatures), `Event`/`NewEvent`/`EventType`/`EventPayloadMap`. Implement against these; if a read method signature needs a small additive change, that's allowed (additive) — keep `core` the source of the interface.
- 1.4: `connection.ts` (WAL/busy_timeout/retry), `path.ts`. 1.5: `append.ts`, `migrate.ts`, `schema.ts`, write-direction `mapping.ts`. Compose, don't duplicate. Reads need no transaction (project-context: reads need none).

### Research-First [Source: .claude/rules/research-first.md]
Verify better-sqlite3 prepared-statement `.all()`/`.get()` return shapes + `json_extract` usage (if room-scoped reads land), and that `bigint` doesn't sneak back in via aggregate `MAX(seq)` (coerce/guard as in 1.5). Don't rely on stale memory.

### Testing standards [Source: project-context.md#Testing]
Vitest, co-located, real-runtime (genuine SQLite temp DB), temp dirs only. Discoverable (Rule 8) + typecheck-clean (Story 1.3 gate). The append→read round-trip proven here is what Story 1.7 stresses concurrently — make the read-ordering + mapping demonstrably correct.

### Project Structure Notes
- Files: `packages/data-access/src/sqlite/queries.ts`, complete `packages/data-access/src/mapping.ts`, compose in `packages/data-access/src/index.ts`. The AC2 guard extends `packages/core/src/boundary-enforcement.test.ts` (or a new discoverable test). Paths per architecture.md#Complete Project Directory Structure.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6: Read-query path and wire/internal mapping]
- [Source: _bmad-output/planning-artifacts/architecture.md#The Data-Access Seam / Cross-cutting concerns / Architectural Boundaries]
- [Source: _bmad-output/project-context.md#Wire / serialization contract / Module boundaries / THE APPEND INVARIANT]
- [Source: .claude/rules/research-first.md]

## QA Results

QA stage (qa-generate-e2e-tests, 2026-05-30) — `/epic-cycle`, claude-opus-4-8 (1M).

**AC coverage verdict:** AC1 + AC2 fully covered. The dev suite already exercised the read path, mapping (both directions), the composed `createDataAccess`, the maxSeq empty sentinel, eventsSince boundary (seq>k), filtered reads, and the AC2 lint boundary. Two genuine real-runtime gaps were found and closed (Rule 3 real-runtime, Rule 8 discoverable, temp DBs under os.tmpdir only):

1. **Ordering by `seq` not `created_at`** — every prior test appended in natural order where `seq` and `created_at` agree, so the two orderings were indistinguishable. Added a real-runtime test that inserts rows (raw connection, real schema) with strictly DESCENDING `created_at` while `seq` ascends, then reads through the composed `fromConnection` DataAccess and asserts both `eventsSince` and `eventsByType` return seq-ascending order — proving THE APPEND INVARIANT against the runtime, not just the lint guard.
2. **Real-runtime write→read round-trip for ALL 10 event types** — the existing all-10 round-trip ran over a SIMULATED row (mapping unit test); the real-runtime round-trip covered only a few types. Added a test that appends one event of every closed-vocabulary type through real SQLite and asserts each camelCase payload survives, no snake_case key surfaces, each type is independently retrievable via `eventsByType`, and the multi-word keys are snake_case on disk (`project_id`/`current_focus`/`message_seq` spot-checked via a raw read-only connection).

**Gates (all exit 0, 2026-05-30):** `pnpm -r build` (7/7 Done), `pnpm run typecheck` clean, `pnpm run lint` clean, `pnpm test` **97 passed** (was 95; +2 real-runtime gap tests), `pnpm run format` clean.

**CI format gate — fixed.** The `pnpm run format` (`prettier --check`) gate was RED on entry: three Story 1.5 files (`append.qa.test.ts`, `append.test.ts`, `migrate.test.ts`) were dirty (prettier's `.get() as { n: number }` brace-wrap style). The dev had flagged these as "pre-existing prettier warnings" but CI enforces `--check`, so they were CI-breaking. Ran `pnpm run format:write` (touched exactly those 3 files plus the new `queries.test.ts`); `prettier --check .` now reports "All matched files use Prettier code style!". Before: 3 files dirty, exit 1. After: clean, exit 0.

**Out of scope (unchanged):** no second test runner introduced; room-scoped read still deferred to Epic 4 (documented in `queries.ts`); no `docs/adr/` registry (Rule 6 n/a).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — BMAD `bmad-dev-story` under `/epic-cycle`.

### Debug Log References

Gates (all exit 0, 2026-05-30):
- `pnpm -r build` — all 7 projects Done.
- `pnpm run typecheck` — clean (the `satisfies DataAccess` proof in `data-access.ts` is the compile-time evidence the composed object implements the port).
- `pnpm run lint` — clean.
- `pnpm test` — 14 files, 95 tests passed (was 11 files / 58 before; +37 in the three touched test files: mapping +9 read-direction, queries.test new real-runtime, boundary +4 AC2 assertions). New tests confirmed discoverable (ran in the default suite).
- `prettier --check` on all authored/modified files — clean.

### Completion Notes List

- **Read queries (`sqlite/queries.ts`)** — `eventsSince`/`eventsByType`/`eventsByActor`/`maxSeq`, prepared once per connection, EVERY row-returning query `ORDER BY seq ASC` (never `created_at`). `eventsByType`/`eventsByActor` lean on the 1.5 `idx_events_type`/`idx_events_actor` indexes. No casing conversion here — rows are handed straight to `rowToEvent`. Reads use no transaction (project-context: reads need none).
- **Read-direction mapping (`mapping.ts`)** — added `StoredEventRow`, `wireToPayload` (exhaustive snake→camel mirror of `payloadToWire`, with `assertNever`), and `rowToEvent`. `rowToEvent` re-narrows the bare DB `type` column against `EVENT_TYPES` and throws on an unknown type so a corrupt/foreign row fails loudly at the seam rather than leaking an untyped event into core. This file remains the SINGLE place the two casings meet.
- **Composed DataAccess (`data-access.ts` + barrel)** — `createDataAccess(opts?)` opens via path discovery + WAL + migrate and binds append (1.5) + reads (1.6) into one object checked `satisfies DataAccess` (compile-time AC1 proof). `fromConnection(db)` composes over an already-open connection (tests/lifecycle owners). `close()` added for connection teardown. better-sqlite3 stays entirely inside the package (only `connection.ts` imports it).
- **maxSeq empty-DB sentinel** — `SELECT MAX(seq)` on an empty ledger returns `{ max_seq: null }`; mapped to `0` per the port's documented contract. `maxSeqValue` carries the same defensive `bigint`/`MAX_SAFE_INTEGER` guard as 1.5's `toSeq` so a future safe-integers-on switch can't silently leak a `bigint` or lose precision.
- **AC2 provably guarded** — found a real GAP: the Story 1.2 lint banned `better-sqlite3` from core but did NOT ban the `@agentbbs/data-access` adapter barrel from core (a `core`→`@agentbbs/data-access` import passed lint; verified by probe). Closed it by adding `@agentbbs/data-access` + deep-path to `NO_CLIENT_FROM_CORE` in `eslint.config.js`, then added a dedicated `AC2` describe block to `boundary-enforcement.test.ts` asserting core→data-access (barrel + deep), core→better-sqlite3 are all rejected, and core→`./ports.js` is allowed. Repurposed the now-stale "ALLOWS a barrel import from core" test (it used the now-banned `@agentbbs/data-access`) to assert the legitimate adapter→core-barrel direction instead. No production code in core imports the adapter (grep-confirmed).
- **DECISION — room-scoped read deferred to Epic 4.** The epics list a "by room" read, but `roomId` lives inside the payload (`room_id` on disk), not a column. A `json_extract(payload,'$.room_id')` read + its access-path index belong with their first real consumer (the Epic 4 room projection / `read_room`), which can add them additively to the port then. Shipping it now would mean an untested, unconsumed query and an index nothing reads. This story keeps the read set to exactly the four `seq`-ordered primitives the port declares today. Documented in the `queries.ts` header.
- **Rule 5 (NFR tripwire):** not triggered — no NFR found un-implementable.
- **Rule 6 (ADRs):** `docs/adr/` does not exist (verified) — no ADRs to consult.
- **Out of scope (untouched):** the N×M multi-process concurrency proof (Story 1.7) and all core projections (Epics 2+).

### File List

- packages/data-access/src/sqlite/queries.ts (new)
- packages/data-access/src/sqlite/queries.test.ts (new)
- packages/data-access/src/data-access.ts (new)
- packages/data-access/src/mapping.ts (modified — added READ direction)
- packages/data-access/src/mapping.test.ts (modified — added READ-direction + round-trip tests)
- packages/data-access/src/index.ts (modified — barrel exports for reads/read-mapping/createDataAccess)
- packages/core/src/boundary-enforcement.test.ts (modified — AC2 guard assertions; repurposed allowed-barrel test)
- eslint.config.js (modified — ban @agentbbs/data-access from core, closing the AC2 lint gap)
- _bmad-output/implementation-artifacts/1-6-read-query-path-and-wire-internal-mapping.md (modified — story tracking)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — status: in-progress → review)

### Change Log

- 2026-05-30 — Story 1.6 implemented: read-query path (`queries.ts`), read-direction wire mapping (`mapping.ts`), composed `createDataAccess` (full `@agentbbs/core` `DataAccess` port), and a provable AC2 boundary guard (closed a lint gap that allowed core→data-access barrel imports). All gates (build/typecheck/lint/test) exit 0; 95 tests pass. Room-scoped read deferred to Epic 4 (documented). Status → review.
- 2026-05-30 — Code review (`bmad-code-review` under `/epic-cycle`, claude-opus-4-8 1M): APPROVED. All 5 gates re-run independently and exit 0 (build 7/7, typecheck, lint, format clean, test 97/97). AC1 + AC2 verified; no HIGH/MED findings; one LOW deferred. Status → done.

## Review Findings

Code review (2026-05-30, `bmad-code-review` under `/epic-cycle`). Three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) run inline by the reviewer. **Verdict: APPROVED — no HIGH/MED findings.**

**Gates re-run independently by the reviewer (all exit 0, not trusting the report):**

- `pnpm -r build` — 7/7 Done.
- `pnpm run typecheck` — clean (the `satisfies DataAccess` in `data-access.ts` is the compile-time AC1 proof).
- `pnpm run lint` — clean.
- `pnpm run format` (`prettier --check .`) — "All matched files use Prettier code style!" (the Story 1.5 format-gate red was confirmed fixed; the 3 touched 1.5 test files are pure Prettier brace-wrap reformatting, no logic change).
- `pnpm test` — 14 files, **97 passed** (was 95; +2 QA real-runtime gap tests).
- No `.agentbbs/` repo pollution; no `agentbbs.db` tracked.

**AC verification:**

- **AC1 (reads seq-ordered camelCase; mapping centralized):** PASS. All four read statements in `queries.ts` are `ORDER BY seq ASC` (never `created_at`); the append-invariant lint guard rejects `ORDER BY created_at` and the new real-runtime test inserts rows with strictly DESCENDING `created_at` while `seq` ascends and proves reads come back seq-ascending. `queries.ts` does NO casing conversion — it SELECTs raw snake_case rows and hands each to `rowToEvent`. `mapping.ts` is the single boundary; `wireToPayload`/`rowToEvent` are exhaustive over all 10 event types with an `assertNever` default (compile-fails if a type is added without a branch). The all-10-type real-runtime write→read round-trip confirms producer (1.5 `append`) ↔ consumer (1.6 reads) fidelity, snake_case on disk only, camelCase out.
- **AC2 (core depends only on the port):** PASS. Grep confirms no `core` production source imports `@agentbbs/data-access` or `better-sqlite3` (only doc comments in `ports.ts`). The reviewer probed the lint directly: a bare `@agentbbs/data-access` barrel import from `core/src` is now **rejected** by the new `NO_CLIENT_FROM_CORE` entry in `eslint.config.js` (verified the exact rule fires; previously this passed because `NO_DEEP_CROSS_PACKAGE` only matches deep paths). The boundary-enforcement test asserts barrel + deep-path + `better-sqlite3` rejection AND that `core`→`./ports.js` is still ALLOWED (no over-restriction). 19/19 boundary assertions pass.
- **Composed DataAccess / room-scoped deferral / scope discipline:** PASS. `createDataAccess` opens (path discovery) + migrates (skipped for readonly) + composes append + reads, returned `satisfies DataAccess & { close(): void }`. better-sqlite3 stays inside data-access. Room-scoped read deferred to Epic 4 is documented in the `queries.ts` header and Dev Notes — a sound call (payload-resident `room_id`, no consumer yet, would ship an untested unconsumed query + dead index). No core projections, no N×M proof — correctly out of scope.

**Findings:**

- [x] [Review][Defer] `wireToPayload` does not validate the payload shape of a known-type-but-malformed row [packages/data-access/src/mapping.ts:196] — deferred, LOW. `rowToEvent` hardens the `type` column (`asEventType` throws on unknown types) but the payload is coerced positionally (`String(...)`/`Number(...)`), so a foreign/corrupt row with a *valid* type but malformed JSON payload maps silently rather than failing at the seam. Unreachable on the happy path (payloads written by `payloadToWire` in the same module, round-trip proven). Payload-level validation is a hardening concern out of scope for the read/mapping story. Logged in `deferred-work.md`; resolve with a payload-validation story or the first Epic 2+ projection consumer (Zod parse at the seam).
- Dismissed (noise, not recorded): (a) `maxSeqValue` in `queries.ts` duplicates `toSeq` in `append.ts` — intentional documented mirrors; a shared util would cross the append/read module split for a 6-line guard, not worth it this epic. (b) `eventsSince(negativeCursor)` returns all rows (`seq > -1`) — cursors are always a real `seq ≥ 0` from `maxSeq`/`0`; harmless, no corruption path.
