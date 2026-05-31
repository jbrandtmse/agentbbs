---
story_id: "1.3"
story_key: "1-3-event-vocabulary-dataaccess-port-and-error-model"
epic: 1
baseline_commit: "efe716414546b3b06ec8dc9412434224604129dc"
---

# Story 1.3: Event vocabulary, DataAccess port, and error model

Status: done

## Story

As a developer,
I want the closed event vocabulary, the `DataAccess` interface, and the `BoardError` + error-code set defined in `core`,
so that every later module codes against stable contracts and no SQL detail can leak past the seam.

## Acceptance Criteria

**AC1 — Closed event vocabulary + payloads**
**Given** `core`,
**When** I inspect `core/events/types.ts`,
**Then** it defines the closed, `noun.past_tense` event-type set exactly: `identity.registered`, `identity.focus_updated`, `identity.seen`, `project.announced`, `board.joined`, `announcement.posted`, `room.replied`, `room.participant_added`, `message.reacted`, `message.unreacted`,
**And** `core/events/payloads.ts` defines a `camelCase` internal payload type per event.

**AC2 — DataAccess port (the NFR2 seam)**
**Given** the NFR2 seam,
**When** I inspect `core/ports.ts`,
**Then** it declares the `DataAccess` interface with a transactional `append(events) → seq` and read-query methods returning events/projections, with no `better-sqlite3` or SQL type referenced,
**And** `core` depends only on this interface.

**AC3 — Error model**
**Given** the uniform error model,
**When** I inspect `core/errors.ts`,
**Then** `BoardError(code, message)` exists and the closed code set includes at least `HANDLE_TAKEN`, `LOGIN_UNKNOWN`, `PROJECT_EXISTS`, `NOT_A_MEMBER`, and `ROOM_NOT_FOUND`, and `BODY_TOO_LARGE`.

## Integration ACs

This story introduces `core`'s **type/interface contracts** (event vocabulary, the `DataAccess` port, the error model) — consumed by later modules. Per skill-rules Rule 1, there is **no runtime consumer in this story**; the explicit declaration:

- **No consumers in this story.** First consumers: **Story 1.4** + **Story 1.6** (the `data-access` package *implements* `DataAccess` and the read queries), and **Epic 2** (`mcp-server` maps `BoardError`s and calls `core` against these types). The contracts are verified here by type-level + unit tests (the vocabulary set is exactly the 10 types; `BoardError` carries a closed code; payloads exist per event); the producer↔consumer wire-up is exercised when `data-access` implements the port in 1.4/1.6.

## Consumed-by

- Story 1.4 — SQLite connection (begins implementing the `DataAccess` interface; consumes `core/ports.ts`).
- Story 1.6 — Read-query path + mapping (implements the read methods; consumes event/payload types).
- Story 1.5 — Append-only events table (the append path materializes the event row shape these types describe).
- Epic 2 (mcp-server) — maps `BoardError` → MCP error result; calls core typed against these contracts.

## Tasks / Subtasks

- [x] **Task 1: Event vocabulary** (AC: 1)
  - [x] `packages/core/src/events/types.ts`: define the closed event-type set as a union/`const` of exactly the 10 `noun.past_tense` strings (no more, no fewer): `identity.registered`, `identity.focus_updated`, `identity.seen`, `project.announced`, `board.joined`, `announcement.posted`, `room.replied`, `room.participant_added`, `message.reacted`, `message.unreacted`. Export an `EventType` union type. Document that adding a type is additive but renaming is a breaking export-format change (must be versioned).
  - [x] `packages/core/src/events/payloads.ts`: define a `camelCase` internal payload TypeScript type per event type (fields the event carries — derive minimally from the FRs each event serves; e.g. `identity.registered` → `{ handle, currentFocus }`, `project.announced` → `{ projectId, title, description }`, `room.replied` → `{ roomId, body }`, `message.reacted` → `{ messageSeq }`, etc.). Provide a discriminated mapping from `EventType` → payload type (e.g. an `EventPayloadMap`). Keep payloads internal camelCase — the snake_case wire mapping is Story 1.6's `data-access/mapping.ts`, NOT here.
  - [x] Define the internal `Event` shape (the folded/read form): `seq: number`, `type: EventType`, `actor: string`, `createdAt: string` (ISO-8601 UTC), `payload` (typed by `type`); and a `NewEvent` shape for the append input (no `seq`; `createdAt` assignment policy documented — assigned at append time). All camelCase. Re-export from `core/src/index.ts` barrel.
- [x] **Task 2: DataAccess port** (AC: 2)
  - [x] `packages/core/src/ports.ts`: declare the `DataAccess` interface — the single NFR2 swap seam. It MUST reference no `better-sqlite3` type and no SQL. Methods:
    - `append(events: NewEvent[]): Promise<number[]>` — transactional; returns the assigned monotonic `seq`(s) in order. (Single-call append of one or more events in one transaction — NFR10.)
    - read queries returning `Event[]`/projections, e.g. `eventsSince(cursor: number): Promise<Event[]>`, `eventsByType(type: EventType): Promise<Event[]>`, `eventsByActor(actor: string): Promise<Event[]>`, and `maxSeq(): Promise<number>`. Declare a minimal, sufficient set now; it is additive — later projection stories add methods. Results are ordered by `seq` (document this contract on the interface).
  - [x] **DECISION — async interface (honor NFR2):** the interface methods return `Promise`s. Rationale: "the V2 HTTP-daemon implementation slots in behind the *identical* interface" (architecture.md#The Data-Access Seam) — an HTTP backend is inherently async, so a sync interface could not survive the swap without changing the contract. The V1 better-sqlite3 impl is synchronous *internally* and conforms by returning resolved Promises. If you believe the architecture intends a synchronous seam, this is a Rule-5/clarification trigger — surface it; do not silently pick the other option.
  - [x] `core` depends ONLY on this interface for data access — no import of `data-access` or `better-sqlite3` (the Story 1.2 import-boundary lint enforces this; keep it clean).
- [x] **Task 3: Error model** (AC: 3)
  - [x] `packages/core/src/errors.ts`: define `BoardError` (extends `Error`) carrying `code` (SCREAMING_SNAKE) + `message`. Define the closed `BoardErrorCode` set including at least `HANDLE_TAKEN`, `LOGIN_UNKNOWN`, `PROJECT_EXISTS`, `NOT_A_MEMBER`, `ROOM_NOT_FOUND`, `BODY_TOO_LARGE` (as a union/`const`; closed but additively extensible). `instanceof BoardError` must work (set prototype correctly for ES targets). Re-export from the barrel.
- [x] **Task 4: Barrel + tests** (AC: 1, 2, 3)
  - [x] Export the public contracts from `packages/core/src/index.ts` (types, `DataAccess` type, `BoardError`, `BoardErrorCode`). No default exports (lint).
  - [x] Co-located `*.test.ts` (Vitest, discoverable per Story 1.2): assert the event-type set is EXACTLY the 10 values (count + membership, guarding against accidental additions/typos), that an `EventPayloadMap` entry exists for each type, that `BoardError` is throwable/catchable with `instanceof` and exposes `code`+`message`, and that the closed code set contains the required codes. (Type-only constructs that can't be runtime-tested may use `expectTypeOf`/`assertType` or compile-time `// @ts-expect-error` fixtures.)
  - [x] Run `pnpm -r build`, `pnpm run lint`, `pnpm test` — all exit 0.

## Dev Notes

### Scope boundary (read first)
This story defines **contracts only in `core`**: the event-type vocabulary + payload types, the `DataAccess` interface, and the `BoardError` + code set. **Out of scope:** any `data-access`/SQLite implementation (Story 1.4/1.5/1.6), the snake_case⇄camelCase wire mapping (Story 1.6's `data-access/mapping.ts`), domain logic / projections (Epics 2+), and the Zod input schemas (Epic 2, mcp-server). Do NOT implement `DataAccess` here — only declare it.

### Authoritative facts [Source: project-context.md; architecture.md]
- **Event vocabulary (closed, fixed):** exactly the 10 `noun.past_tense` types listed in AC1. Adding is additive; renaming is a breaking export-format change. No ad-hoc types. [Source: architecture.md#Naming Patterns / Ledger event vocabulary; project-context.md#Event vocabulary]
- **DataAccess seam (NFR2):** single repository interface — `append(events)→seq` (transactional) + read queries returning events/projections; no SQL/SQLite type leaks past it; `core` depends on the interface, never on better-sqlite3; the V2 HTTP daemon slots in behind the identical interface. [Source: architecture.md#The Data-Access Seam; project-context.md#Module boundaries]
- **Order by `seq`, never `created_at`** — `createdAt` is ISO-8601 UTC TEXT, display-only. Read queries return `seq`-ordered. [Source: project-context.md#THE APPEND INVARIANT]
- **Wire/internal split:** camelCase inside TypeScript (this story); snake_case only at serialization boundaries via the mapping layer (NOT this story). Core never sees snake_case. [Source: architecture.md#Wire casing]
- **Error shape:** core throws `BoardError(code, message)`; uniform `{ code: SCREAMING_SNAKE, message }`; closed, versioned code set. [Source: architecture.md#Format Patterns / Error shape; project-context.md#Wire / serialization contract]

### Event → payload guidance (derive minimally; later epics may extend additively)
The payloads only need the fields each event must carry to reconstruct derived state. A reasonable starting shape (confirm field names as camelCase, finalize in implementation):
- `identity.registered` `{ handle, currentFocus }` · `identity.focus_updated` `{ handle, currentFocus }` · `identity.seen` `{ handle }`
- `project.announced` `{ projectId, title, description }` · `board.joined` `{ projectId }`
- `announcement.posted` `{ roomId, subject, body }` · `room.replied` `{ roomId, body }` · `room.participant_added` `{ roomId, handle }`
- `message.reacted` `{ messageSeq }` · `message.unreacted` `{ messageSeq }`
(`actor` is the top-level event field — the acting handle — not duplicated in payload unless a second handle is involved, e.g. `room.participant_added.handle` is the *added* identity. Identifier formats: handle lowercased `[a-z0-9._@-]`; room/project ids are slugs — Epic 2+/AR10.)

### Testing standards [Source: project-context.md#Testing]
Vitest, co-located `*.test.ts` (the root `vitest.config.ts` from Story 1.2 discovers them). The "exactly 10 event types" test is the load-bearing guard against vocabulary drift. This is non-user-facing core contract code — Rule 3's real-runtime requirement does not apply, but unit/type tests ARE expected and feasible here.

### Research-First [Source: .claude/rules/research-first.md]
TypeScript discriminated-union + mapped-type patterns for the `EventType → payload` map, and correct `Error` subclassing for the current TS/Node target (ES2023+/NodeNext), are worth a quick verification if uncertain (e.g. `Object.setPrototypeOf` necessity, `expectTypeOf` from Vitest). Don't rely on stale memory for the type-level idioms.

### Project Structure Notes
- Files land under `packages/core/src/`: `events/types.ts`, `events/payloads.ts`, `ports.ts`, `errors.ts`, plus barrel re-exports in `index.ts`. These exact paths are named in architecture.md#Complete Project Directory Structure.
- Replace the Story 1.1 placeholder export in `core/src/index.ts` (the `CORE_PACKAGE` marker) with the real contract re-exports.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3: Event vocabulary, DataAccess port, and error model]
- [Source: _bmad-output/planning-artifacts/architecture.md#The Data-Access Seam / Naming Patterns / Format Patterns / Complete Project Directory Structure]
- [Source: _bmad-output/project-context.md#Event vocabulary / Module boundaries / Wire / serialization contract / THE APPEND INVARIANT]
- [Source: .claude/rules/research-first.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — bmad-dev-story under /epic-cycle.

### Debug Log References

- `pnpm -r build` → exit 0 (all 7 buildable workspace projects: Done).
- `pnpm run lint` → exit 0 (`eslint .`, no findings — boundary/naming/append-invariant rules clean).
- `pnpm test` → exit 0 — **6 test files, 38 tests passed** (5 new core contract tests + the existing Story 1.2 boundary-enforcement test; no regressions).
- Type-level assertions verified independently: `tsc --noEmit` over the five test files (which the production `tsc -b` excludes) → exit 0. This catch surfaced and fixed one misplaced `@ts-expect-error` in `event.test.ts` (the excess-property error fires on the `seq: 1` property line, not the `const` declaration line); the directive was relocated. Re-check → exit 0, confirming every `@ts-expect-error` (in `types.test.ts`, `errors.test.ts`, `event.test.ts`) is a genuine, non-redundant compile-time guard.

### Completion Notes List

- **AC1 — Event vocabulary + payloads:** `events/types.ts` declares `EVENT_TYPES` (`as const` tuple, the single runtime source of truth) with exactly the 10 `noun.past_tense` strings; `EventType` is *derived* (`(typeof EVENT_TYPES)[number]`) so the union and runtime list cannot drift. `events/payloads.ts` defines one camelCase payload interface per type plus `EventPayloadMap extends Record<EventType, object>` — the `extends Record<…>` constraint makes the map TOTAL at compile time (a new event type without a payload fails to build). `events/event.ts` adds the folded `Event` and append-input `NewEvent` as discriminated unions over `type` (narrowing `type` narrows `payload`); `NewEvent` omits `seq`/`createdAt` (assigned at append time). The load-bearing "exactly 10" test asserts count + exact membership/order against an independent oracle literal.
- **AC2 — DataAccess port:** `ports.ts` declares `DataAccess` with `append(NewEvent[]) → Promise<number[]>` (transactional, NFR10) plus `eventsSince`/`eventsByType`/`eventsByActor`/`maxSeq`, all Promise-returning. No `better-sqlite3` or SQL type referenced; core imports only its own event types. The `seq`-ordering contract is documented on each read method.
- **AC3 — Error model:** `errors.ts` defines `BoardError extends Error` with a readonly typed `code` + `message`, and `BOARD_ERROR_CODES` (`as const`) from which `BoardErrorCode` is derived. Contains all six required codes. `instanceof` proven reliable in tests (both `BoardError` and `Error`); `Object.setPrototypeOf` kept as a defensive cross-target guard.
- **Barrel:** `index.ts` re-exports all contracts; `verbatimModuleSyntax: true` honored via `export type` for type-only re-exports. The Story 1.1 `CORE_PACKAGE` placeholder is removed. No default exports.

### Decisions

- **DataAccess interface is async (Promise-returning)** — implemented as the story recommended. Verified the architecture's Data-Access Seam mandates the V2 HTTP daemon slot in behind the *identical* interface; an HTTP backend is inherently async, so a sync seam could not survive the swap. No architectural mandate for a synchronous seam was found → no clarification trigger. A test proves a synchronous V1-style impl conforms by returning already-resolved Promises.
- **Tuple-derived unions** (`EVENT_TYPES`→`EventType`, `BOARD_ERROR_CODES`→`BoardErrorCode`) chosen over hand-written unions so the runtime guard set and the static type are provably identical — directly supports the "exactly 10" drift guard.
- **Research-First:** confirmed via Perplexity that under `target: ES2023` native `class extends Error` wires the prototype chain correctly (`Object.setPrototypeOf` not strictly required); kept the call as a harmless defensive guard per the story's "set prototype correctly for ES targets" instruction.

### Issues Encountered

- One misplaced `@ts-expect-error` directive in `event.test.ts` (caught by the explicit `tsc --noEmit` type-check of test files, which the production build excludes). Relocated above the offending property; re-verified clean. No other issues; no NFR tripwire (Rule 5) and no ADRs to consult (Rule 6 — `docs/adr/` absent, confirmed).

### File List

**Added (source):**
- `packages/core/src/events/types.ts`
- `packages/core/src/events/payloads.ts`
- `packages/core/src/events/event.ts`
- `packages/core/src/ports.ts`
- `packages/core/src/errors.ts`

**Modified (source):**
- `packages/core/src/index.ts` (replaced the `CORE_PACKAGE` placeholder with the real contract re-exports)

**Added (tests):**
- `packages/core/src/events/types.test.ts`
- `packages/core/src/events/payloads.test.ts`
- `packages/core/src/events/event.test.ts`
- `packages/core/src/ports.test.ts`
- `packages/core/src/errors.test.ts`

**Modified (tracking):**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story → in-progress → review)
- `_bmad-output/implementation-artifacts/1-3-event-vocabulary-dataaccess-port-and-error-model.md` (frontmatter `baseline_commit`, task checkboxes, Dev Agent Record, Status)

## QA Results (bmad-qa-generate-e2e-tests · 2026-05-30)

**Verdict:** Contracts verified; one real coverage gap found and closed. Full summary: `_bmad-output/implementation-artifacts/tests/test-summary.md` (Story 1.3 section).

**Rule 3:** Exempt — non-user-facing core contract code; unit + type tests are the correct surface (exemption noted).

**Critical finding (type assertions were vacuous):** The dev's `expectTypeOf` / `@ts-expect-error` assertions were **runtime no-ops** in the default gate. `tsconfig.base.json` excludes `**/*.test.ts` from `tsc -b`, and `pnpm test` (Vitest/esbuild) does not type-check and had no `typecheck` runner. Proof: flipping a `toEqualTypeOf<BoardErrorCode>()` to `<number>()` still gave 38 passed / exit 0. The dev's one-off manual `tsc --noEmit` was never wired into the suite/CI, so it provided no ongoing protection. This left load-bearing guarantee **(4) EventPayloadMap totality** (a compile-time-only property — no runtime registry exists) entirely unguarded in the gate.

**Fix (minimal):** Added a real typecheck gate so all type assertions become load-bearing — no fabricated runtime equivalents for compile-time properties:
- `tsconfig.typecheck.json` (new, root) — `noEmit` pass over all `*/src` source **and** `*.test.ts` files (overrides the base test-exclude; `types: ["node"]`).
- `typecheck` script in root `package.json` → `tsc --noEmit -p tsconfig.typecheck.json`.
- CI step "Typecheck (workspace + tests)" in `.github/workflows/ci.yml` (hard gate, between test and lint).

Validated the gate catches regressions (each reverted): false `expectTypeOf` → TS2344; unused `@ts-expect-error` → TS2578; 11th event type without payload → TS2741 (proves guarantee 4 now enforced).

**Load-bearing guarantees:** (1) exactly-10 vocabulary, (2) `BoardError` instanceof + code/message, (3) required error-code set — all have **genuine runtime** coverage (solid). (4) payload-map totality — compile-time-only, now enforced by the typecheck gate + a secondary runtime witness.

**No new test files added** — the dev's runtime assertions for (1)–(3) are sound and (4) is inherently type-level; the gap was missing *enforcement* of the type layer, now closed. Adding redundant runtime tests would be gold-plating.

**Gates (clean tree, all exit 0):** `pnpm test` (6 files / 38 tests), `pnpm run typecheck` (NEW), `pnpm run lint`, `pnpm -r build`, `pnpm run format`. Rule 8: all 6 `*.test.ts` discovered by default `pnpm test`; no second runner.

## Code Review Results (bmad-code-review · 2026-05-30)

**Verdict:** ✅ Clean review — APPROVED. Zero findings survive triage (0 decision-needed, 0 patch, 0 defer; 5 dismissed as by-design/false-positive). Story → `done`.

**Gates re-run independently by the reviewer (not trusting the report) — all exit 0:**
- `pnpm run typecheck` → exit 0
- `pnpm test` → exit 0 (6 files / 38 tests)
- `pnpm run lint` → exit 0
- `pnpm -r build` → exit 0 (7 buildable projects)

**Typecheck gate proven load-bearing (the critical QA fix):** Injected an 11th `EVENT_TYPES` member with no payload → `pnpm run typecheck` FAILED with `TS2741` (EventPayloadMap totality / runtime-witness). Reverted; gate green again. `--listFilesOnly` confirms all 6 `*.test.ts` files (5 new + the Story 1.2 boundary test) are genuinely type-checked, so every `expectTypeOf` / `@ts-expect-error` is now enforced (previously vacuous in the default suite — QA's gap, now closed). Rule 8 satisfied: all 6 tests run in default `pnpm test` and the typecheck step is wired into CI between Test and Lint.

**Acceptance audit:**
- **AC1 (vocabulary + payloads):** PASS. `EVENT_TYPES` is exactly the 10 `noun.past_tense` strings; the "exactly 10" test asserts BOTH count (`toHaveLength(10)`) AND exact membership+order against an independent oracle literal (`toEqual(EXPECTED_EVENT_TYPES)`) — genuine drift guard, plus duplicate + shape checks. `EventType` is tuple-derived. `EventPayloadMap extends Record<EventType, object>` makes the map total at compile time; one camelCase payload per type; `Event`/`NewEvent` are discriminated unions (`NewEvent` omits `seq`/`createdAt`).
- **AC2 (DataAccess port / NFR2 seam):** PASS. `append(NewEvent[]) → Promise<number[]>` transactional + ordered-return, plus `eventsSince`/`eventsByType`/`eventsByActor`/`maxSeq`, all Promise-returning and documented `seq`-ascending. No `better-sqlite3`/SQL type referenced (grep confirms only documentary comments). Async decision is sound for NFR2: the V2 HTTP daemon must slot in behind the identical interface and is inherently async; a sync seam could not survive the swap — no Rule-5 trigger. A conformer test proves a synchronous V1-style impl satisfies the interface via resolved Promises.
- **AC3 (error model):** PASS. `BoardError(code, message) extends Error` with working `instanceof` (both `BoardError` and `Error`), readonly typed `code`, and `BOARD_ERROR_CODES` containing all six required codes (HANDLE_TAKEN, LOGIN_UNKNOWN, PROJECT_EXISTS, NOT_A_MEMBER, ROOM_NOT_FOUND, BODY_TOO_LARGE). Tuple-derived closed union.

**Wire/scope discipline:** PASS. Payloads are camelCase throughout; NO snake_case mapping (correctly deferred to 1.6). No data-access/SQLite impl, no Zod, no domain logic — scope held.

**Rule checks:** Rule 1 (Integration ACs) — explicit "No consumers in this story" with named future consumers (1.4/1.6, Epic 2): satisfied. Rule 3 — non-user-facing core contract code; real-runtime requirement N/A, exemption noted; unit+type coverage present. Rule 5 — no NFR worked around with comments/deferral. Rule 6 — `docs/adr/` absent (confirmed); N/A. Rule 8 — satisfied (above).

**Dismissed (by-design / false-positive, 5):** (1) no explicit `Error.captureStackTrace` — V8 native `extends Error` captures it; (2) `event.ts` re-export of `EventPayloadMap`/`PayloadOf` — intentional convenience, lint-clean; (3) `as Event` cast in the `ports.test.ts` conformer — standard test-stub pattern; (4) `@ts-expect-error` + tautological runtime line — the directive is the load-bearing assertion (now enforced), the `expect` only consumes the var to satisfy lint; (5) `eventsByActor` handle-normalization not documented — correctly an Epic 2 boundary concern (AR10), interface stays format-agnostic.

## Change Log

| Date       | Change                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| 2026-05-30 | Implemented core contracts: closed event vocabulary + payloads, `Event`/`NewEvent` shapes, the async `DataAccess` port (NFR2 seam), and the `BoardError` + closed code model. Barrel re-exports; 5 new co-located Vitest test files (38 tests). Build/lint/test all exit 0. Status → review. |
| 2026-05-30 | Code review (bmad-code-review): clean — 0 findings (5 dismissed). All gates re-run independently (typecheck/test/lint/build exit 0); typecheck gate proven load-bearing via deliberate 11th-type break → TS2741 then reverted. AC1–AC3 + Rules 1/3/5/6/8 verified. Status → done. |
