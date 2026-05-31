---
baseline_commit: d8413b901e2e60f60aa5b53766f28a766c9058c0
---

# Story 2.4: Update current-focus

Status: review

## Story

As an agent,
I want to update my current-focus,
so that discovery reflects what I am working on now.

## Acceptance Criteria

1. **Given** my established identity,
   **When** I update my current-focus,
   **Then** an `identity.focus_updated` event is appended and the directory-derived current-focus reflects the new value,
   **And** prior focus values remain in the ledger (append-only; nothing overwritten).

2. **Given** no established identity for the session (the agent has neither `register`ed nor `login`ed on this connection),
   **When** I call `update_focus`,
   **Then** the call is rejected with `NO_IDENTITY` (a new additive `BoardError` code — see Dev Notes), and no event is appended.

3. **(Integration AC)** **Given** the `update_focus` tool on the bootstrap server,
   **When** a real MCP client over `InMemoryTransport` registers `H` (establishing the session), then calls `update_focus` with a new focus,
   **Then** an `identity.focus_updated` event is appended for `H`, the returned/derived identity's `current_focus` is the new value and `last_seen` has advanced to the new event's time, and the original `identity.registered` event (with the old focus) still exists in the ledger; AND calling `update_focus` on a fresh connection with no session returns a `NO_IDENTITY` `isError` result with no event appended.

## Consumes

- **Story 2.1 (MCP bootstrap)** — `update_focus` tool registered via `registerCoreTool` + `error-map.ts`.
- **Story 2.2 (identity projection)** — extends the directory fold with the `identity.focus_updated` branch the 2.2 projection was pre-wired for.
- **Story 2.3 (session holder)** — `update_focus`'s actor IS the session identity; first consumer of the session holder.

## Consumed-by

- **Story 2.5 (last-seen)** — shares the directory projection (adds the `identity.seen` branch next to this story's `identity.focus_updated` branch) and the same session-actor pattern.

## Tasks / Subtasks

- [x] Task 1: Extend the identity projection to fold `identity.focus_updated` (AC: #1)
  - [x] In `packages/core/src/identity/projection.ts`: add `'identity.focus_updated'` to `IDENTITY_EVENT_TYPES`, and add the reducer `switch` branch (the 2.2 dev left a comment marking exactly where): on `identity.focus_updated`, overwrite the existing identity's `currentFocus` with `event.payload.currentFocus`. Because the fold processes events in `seq` order and `lastSeen` is the latest event's `createdAt`, both `currentFocus` (latest value) and `lastSeen` (advanced) update correctly with no extra code. Keep the fold additive and order-correct.
  - [x] An `identity.focus_updated` for a handle with no prior `identity.registered` must NOT create a phantom identity (only `identity.registered` mints a directory entry; a focus update for an unknown handle is ignored by the fold, or — given registration is required to reach this path — simply cannot occur). Document the chosen stance. **Stance: IGNORE (mint no phantom)** — the reducer branch no-ops when the record is absent; documented in `projection.ts` and pinned by a unit test.
- [x] Task 2: Add the `NO_IDENTITY` error code (additive) (AC: #2)
  - [x] Append `'NO_IDENTITY'` to `BOARD_ERROR_CODES` in `packages/core/src/errors.ts` (additive — the union derives from the tuple; this does not break the existing `toContain` test, but ADD `NO_IDENTITY` to the expected-codes list in `errors.test.ts` so the closed set stays fully asserted). Document it: "the action requires an established identity (register or login first); none is set for this session." This code is reusable by every session-required tool in Epics 3–6.
- [x] Task 3: `updateFocus` board operation in `core` (AC: #1)
  - [x] Implement `updateFocus(dataAccess, handle, currentFocus): Promise<Identity>`: append one `identity.focus_updated` event (`actor: handle`, `payload: { handle, currentFocus }`) via plain `append` (no uniqueness guard needed — focus updates are not unique-constrained), then return the updated identity by reading it back through the projection (`findIdentity(await dataAccess.eventsByActor(handle), handle)`). The returned `current_focus` is the new value; `last_seen` is the new event's `created_at`.
  - [x] Export `updateFocus` from the core barrel.
- [x] Task 4: `update_focus` MCP tool + session-actor wiring (AC: #1, #2)
  - [x] Register the `update_focus` tool on `createBoardServer` via `registerCoreTool`. Zod input schema (snake_case wire): `current_focus` (required string; apply a sane max length consistent with `register`'s focus handling). The handle is NOT a tool param — it comes from the session holder.
  - [x] The delegate closes over the session holder + `dataAccess`: read `session.handle`; if `null`, `throw new BoardError('NO_IDENTITY', …)` (routed to the `{code,message}` isError result by `error-map.ts`); otherwise delegate to `core.updateFocus(dataAccess, session.handle, current_focus)` and return the updated identity as the snake_case success result (`handle`, `current_focus`, `created_at`, `last_seen`).
  - [x] Keep the handler THIN — the session-precondition check + boundary mapping is not board logic; the focus mutation lives in `core`.
- [x] Task 5: Tests (AC: #1, #2, #3)
  - [x] Unit: projection folds `identity.focus_updated` → `currentFocus` reflects the latest by `seq`, `lastSeen` advances, multiple sequential updates keep the latest, and the `identity.registered` event is retained (append-only). `core.updateFocus` returns the updated identity; appends exactly one event.
  - [x] Unit/integration: `update_focus` with no session → `BoardError('NO_IDENTITY')` / `NO_IDENTITY` isError; assert NO event appended (dataAccess spy / ledger size unchanged). (Covered over the real transport in the integration test: ledger size unchanged + session stays null.)
  - [x] Integration (real-runtime, Rule 3): over `InMemoryTransport` + real `createDataAccess`, register `H` → `update_focus` "new focus" → ledger holds `identity.registered` (old focus) AND `identity.focus_updated` (new focus); the derived identity shows the new `current_focus` and advanced `last_seen`; the prior focus value is still present in the ledger (append-only). Also the no-session → `NO_IDENTITY` path over the real transport.
  - [x] Rule 8: tests `*.test.ts`, default-discovered.
- [x] Task 6: Full-gate verification — `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run format` all green; no regression to the existing baseline (207 tests before this story; now 221).

## Dev Notes

### Design decisions (lead)

- **`NO_IDENTITY` (new additive error code).** `update_focus` is the first tool that requires an established session, so this story introduces the reusable "no established identity" error. AR14 declares the error set additively extensible ("…"); appending a code is non-breaking (the `BoardErrorCode` union derives from the runtime tuple). Every session-required tool in Epics 3–6 (announce_project, join_board, post, reply, react, check, …) will reuse it. If you prefer a different name than `NO_IDENTITY`, that is a project-wide contract choice — if you change it, STOP and surface it; otherwise implement `NO_IDENTITY`.
- **Actor from session, not a param.** Per Story 2.3's session model and 2.4's "my established identity," `update_focus` takes only `current_focus`; the actor is the session handle. The session-precondition check lives in the tool delegate (server/session concern), the focus mutation in `core`.
- **`last_seen` advances on focus update.** Because the projection derives `last_seen` from the latest event's `createdAt` and `identity.focus_updated` is now an identity event, a focus update naturally advances `last_seen`. This is correct and anticipates Story 2.5 (which adds the explicit `identity.seen` activity ping). Do not store `last_seen`.

### Architecture compliance (mandatory)

- **Append-only:** a focus update APPENDS `identity.focus_updated`; it never mutates or deletes the prior `identity.registered`/`identity.focus_updated` rows. The directory's `current_focus` is the DERIVED latest value. [Source: architecture.md#Data Architecture; epics.md FR3; AR9]
- **Closed event vocabulary:** use the existing `identity.focus_updated` type (already in `EVENT_TYPES` + payloads); do not invent a type. [AR9; packages/core/src/events/types.ts, payloads.ts]
- **Wire snake_case** (`current_focus`, `handle`, `created_at`, `last_seen`); camelCase in TS; mapping only at the seam. **Ordering always `seq`** (the fold relies on `seq` order). [architecture.md#Naming/Format Patterns]
- **Error `{code,message}`; `NO_IDENTITY` raised as `BoardError`, mapped at the boundary.** **Thin handler; module boundaries** (session state in server, mutation in core, better-sqlite3 in data-access). [architecture.md#Structure Patterns]

### Existing surfaces to build on (verified)

- `projection.ts` is pre-wired for this: `IDENTITY_EVENT_TYPES` set + a reducer `switch` with a comment marking where the `identity.focus_updated` branch goes (overwrite `currentFocus`). `Identity = { handle, currentFocus, createdAt, lastSeen }`; `findIdentity(events, handle)`. [packages/core/src/identity/projection.ts]
- `IdentityFocusUpdatedPayload = { handle, currentFocus }` (camelCase); wire stores `{ handle, current_focus }`. [packages/core/src/events/payloads.ts; packages/data-access/src/mapping.ts]
- `DataAccess.append` (plain append; no guard needed), `eventsByActor`. [packages/core/src/ports.ts]
- `BOARD_ERROR_CODES` + `BoardError` (append `NO_IDENTITY`); `errors.test.ts` uses `toContain` (won't break) — add `NO_IDENTITY` to its expected list. [packages/core/src/errors.ts, errors.test.ts]
- Story 2.3 session holder (`session.ts`) threaded into `createBoardServer` tool closures; `tools/identity-shared.ts` (canonical validator + `identityToWire`); `tools/login.ts`/`register.ts` are the tool pattern to mirror. [packages/mcp-server/src/*]

### File structure (proposed)

- `packages/core/src/identity/projection.ts` — add focus_updated fold (UPDATE).
- `packages/core/src/errors.ts` + `errors.test.ts` — add `NO_IDENTITY` (UPDATE).
- `packages/core/src/identity/update-focus.ts` — `updateFocus` op (NEW); export from barrel (UPDATE `index.ts`).
- `packages/mcp-server/src/tools/update-focus.ts` — the `update_focus` tool (NEW), wired in `server.ts` (UPDATE).
- Tests co-located `*.test.ts`.

### Testing standards

- Vitest, co-located, default-discovered (Rule 8). Integration AC #3 is the Rule 3 real-runtime evidence (real `Client`↔`McpServer` + real ledger). Prove append-only retention (old focus row still present) and `last_seen` advancement explicitly.

### References

- [Source: epics.md#Epic 2 / Story 2.4; FR3; FR8; AR9; AR14]
- [Source: architecture.md#Data Architecture; #Identity & Trust; #Naming/Format/Structure Patterns]
- [Source: packages/core/src/identity/projection.ts, errors.ts, events/payloads.ts, ports.ts]
- [Source: packages/mcp-server/src/session.ts, tools/identity-shared.ts, tools/login.ts, server.ts]
- [Source: _bmad/custom/skill-rules.md] — Rules 1, 2, 3, 8.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`

### Debug Log References

- **Build-ordering gotcha (resolved):** the mcp-server integration test initially failed with `INTERNAL_ERROR`. Root cause: cross-package imports resolve `@agentbbs/core` via its package `exports` to the BUILT `dist/`, not TS source (no `src` alias in `vitest.config.ts`). The freshly-added `core` exports (`updateFocus`, `NO_IDENTITY`) were not yet in `core/dist`, so the tool's delegate called `updateFocus === undefined` → `TypeError` → mapped to `INTERNAL_ERROR`. Fix: `pnpm run build` (refresh `core/dist`) before the cross-package tests run. Core-internal unit tests were unaffected (intra-package vitest uses source). Reproduced + diagnosed with a throwaway probe test, then removed.

### Completion Notes List

- **AC #1 (append-only focus update):** `core.updateFocus` appends ONE `identity.focus_updated` via plain `append` (no guard) and reads the identity back through the projection. The projection fold gained `identity.focus_updated` in `IDENTITY_EVENT_TYPES` + a reducer branch that overwrites `currentFocus`; `lastSeen` advances automatically (latest event's `createdAt`, `seq`-ordered). Append-only retention is proven at BOTH the core layer (unit) and over the real ledger (integration): the prior `identity.registered` row with the OLD focus remains; derived `current_focus` is the NEW value; `last_seen` advanced.
- **AC #2 (NO_IDENTITY):** added `'NO_IDENTITY'` to `BOARD_ERROR_CODES` (additive; union derives from the tuple) + the expected-codes list in `errors.test.ts`. The `update_focus` delegate reads `session.handle`; if `null` it throws `BoardError('NO_IDENTITY', …)`, mapped to the `{code,message}` isError result by `error-map.ts`. No event is appended on that path (asserted: ledger size unchanged, session stays null).
- **AC #3 (Integration, real-runtime Rule 3):** `update-focus.integration.test.ts` drives a real `Client`↔`McpServer` over `InMemoryTransport` + real `createDataAccess` (SQLite under os.tmpdir). Proves register→update_focus appends focus_updated, the ledger holds BOTH events (old-focus registration retained), derived `current_focus` = new + `last_seen` advanced to the update event's time; sequential updates keep appending (latest wins); and no-session → `NO_IDENTITY` with nothing appended.
- **Decisions:** (1) phantom-identity stance = IGNORE/no-mint (documented + tested). (2) `current_focus` schema uses a NEW shared `focusSchema` (`z.string().min(1).max(280)`) added to `tools/identity-shared.ts` — a sane bounded cap (register today accepts any non-empty focus; `update_focus` is the first consumer of the canonical bounded validator; register left unchanged, additive only). (3) `last_seen`-advanced assertion is written to be robust against ms-granularity clock collisions (asserts derivation from the focus_updated event + monotonic non-regression).
- **Surface change pinned deliberately:** `server.bootstrap.test.ts`'s exact advertised-tool-list assertion was updated to include `update_focus` (the QA test is designed to flip on review when the factory's tool set changes).
- **Full gate (all green):** `lint` exit 0 · `typecheck` exit 0 · `test` 221 passed / 35 files (was 207/33 — +14 tests, +2 files, 0 regressions) · `build` all 8 projects Done · `format` clean. New test files were prettier-formatted via `format:write` (whitespace only).
- **NFR tripwire (Rule 5):** none hit — no planning-artifact amendment needed.
- **Not committed:** per the stage directive, all changes left UNCOMMITTED for the lead to commit after the per-story smoke gate.

### File List

- packages/core/src/identity/projection.ts (modified — fold `identity.focus_updated`: added to `IDENTITY_EVENT_TYPES` + reducer branch)
- packages/core/src/identity/projection.test.ts (modified — `identity.focus_updated` fold tests + `focus` event factory)
- packages/core/src/errors.ts (modified — added `NO_IDENTITY` code)
- packages/core/src/errors.test.ts (modified — added `NO_IDENTITY` to expected-codes list)
- packages/core/src/identity/update-focus.ts (new — `updateFocus` board operation)
- packages/core/src/identity/update-focus.test.ts (new — `updateFocus` unit tests, incl. append-only retention)
- packages/core/src/index.ts (modified — export `updateFocus` from the barrel)
- packages/mcp-server/src/tools/identity-shared.ts (modified — added `FOCUS_MAX_LENGTH` + shared `focusSchema`)
- packages/mcp-server/src/tools/update-focus.ts (new — `update_focus` MCP tool + session-actor wiring)
- packages/mcp-server/src/tools/update-focus.integration.test.ts (new — AC #3 real-runtime integration test)
- packages/mcp-server/src/server.ts (modified — register `update_focus` in `createBoardServer` + doc comments)
- packages/mcp-server/src/server.bootstrap.test.ts (modified — advertised-tool-list assertion now includes `update_focus`)
- _bmad-output/implementation-artifacts/2-4-update-current-focus.md (modified — status/tasks/Dev Agent Record bookkeeping)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — story 2-4 status transitions)

### Change Log

- 2026-05-31 — Story 2.4 implemented: `update_focus` tool (session-actor), `core.updateFocus` (append-only), projection folds `identity.focus_updated`, additive `NO_IDENTITY` error code. Full gate green (221 tests). Status → review.

## Review Findings (code review, 2026-05-31)

**Verdict: APPROVE.** All 3 ACs satisfied; every critical check passed. Zero HIGH / MED / LOW findings against Story 2.4's own code. Gate re-run by the reviewer (build-first): `build` all 7 build-scripted projects Done · `test` 234 passed / 36 files · `lint` exit 0 · `typecheck` exit 0 (test files ARE checked via `tsconfig.typecheck.json`) · `format` clean. Count matches the dev's reported suite (the dev's "221" line predates the two QA hardening test files added afterward; the live suite is 234/36).

### AC verification

- **AC #1 (append-only focus update + derived current-focus) — PASS.** `core.updateFocus` (`update-focus.ts:52`) uses plain `dataAccess.append` (an APPEND, never a mutation; no `appendGuarded` since focus is not unique-constrained). The projection branch (`projection.ts:114-122`) overwrites only the in-memory derived `currentFocus`; the stored `identity.registered` row is never touched. Append-only retention proven at BOTH the core layer (`update-focus.test.ts:108-129`, `160-200`) and over the real SQLite ledger (`update-focus.integration.test.ts:96-152`, `264-307`): the original registration row with the OLD focus survives every update, the ledger grows by exactly one row per update, and the derived `current_focus` is latest-by-`seq`. The append-invariant ESLint guard (`eslint.config.js` §4, scoped to `core`) finds no `UPDATE/DELETE/ORDER BY created_at`.
- **NFR10 (seq-ordered fold, never `created_at`) — PASS.** The QA test `projection.test.ts:137-159` pins it directly: two `identity.focus_updated` events sharing one `createdAt` — the higher-`seq` one wins `currentFocus`. The fold trusts the caller's `seq` order and never compares timestamps as an ordering key.
- **AC #2 (`NO_IDENTITY`) — PASS.** Appended to `BOARD_ERROR_CODES` (`errors.ts:34`), additive; `BoardErrorCode` still derives from the tuple (`errors.ts:41`); `errors.test.ts:49` asserts membership and the union-derivation (`:60-67`). The tool throws `BoardError('NO_IDENTITY')` when `session.handle === null` (`update-focus.ts:80-85`) and appends nothing. The guard is genuinely session-driven (works after register OR login): both `register.ts:98` and `login.ts:89` set `session.handle`; the QA login-then-update_focus test (`update-focus.integration.test.ts:154-197`) proves the login path establishes the actor.
- **AC #3 (Integration, real-runtime / Rule 3) — PASS.** `update-focus.integration.test.ts` drives a real `Client`↔`McpServer` over `InMemoryTransport` + real `createDataAccess` (SQLite under `os.tmpdir`); nothing mocked. Proves register→update_focus appends `focus_updated`, both events present in the ledger (old-focus registration retained), derived `current_focus` = new and `last_seen` advanced to the update event's time, AND no-session→`NO_IDENTITY` `isError` with nothing appended. Genuine Rule-3 evidence.

### Other critical checks

- **Module boundary / thin handler — PASS.** Session precondition + boundary mapping in the tool; focus mutation in `core`; `core` imports only the `DataAccess` port (lint boundary rules green). The `vi.mock('@agentbbs/core', importOriginal)` in `update-focus.core-boundary.integration.test.ts` preserves every real export and lives in a test file only — no production leakage. That spy test makes the strong claim directly: `core.updateFocus` is NEVER called on the no-session or the three invalid-input paths, with a meaningful happy-path control (called exactly once with `(dataAccess, 'ada', 'new')`).
- **Validation — PASS.** Empty / missing / too-long `current_focus` rejected before core, shown both via ledger-size proxy (`integration:379-459`) and directly via the spy (`core-boundary:114-164`), with an inclusive at-280 control proving the bound is not off-by-one.
- **Closed vocabulary — PASS.** `identity.focus_updated` was already in `EVENT_TYPES` (Story 1.3) with `IdentityFocusUpdatedPayload = { handle, currentFocus }`; the story consumed it, did not invent a type.
- **Surface pin — PASS.** `server.bootstrap.test.ts:210-216` pins the exact advertised tool set `[alpha, beta, login, register, update_focus]`; the QA surface-flip assertion is real and correctly updated. No other test (incl. `server.test.ts`) carried a stale tool-count assertion.
- **Wire contract — PASS.** snake_case success shape `{ handle, current_focus, created_at, last_seen }` asserted exactly with no camelCase leakage (`integration:309-343`); core never sees snake_case.
- **Rule 6 (ADR) — N/A.** No ADR registry (`docs/adr/` absent).

### Deferred / process notes

- **Monorepo build-ordering papercut (LOW, process) — LOGGED to `deferred-work.md`.** Cross-package tests resolve `@agentbbs/core` via its built `dist/` (no `src` alias), so newly-added core exports require a `core` build before the mcp-server suite sees them; otherwise the delegate hits `undefined` → `INTERNAL_ERROR`. Surfaced in 2.4's Debug Log and is the same class seen across Epic 2. Recorded as a LOW/MED process item with a suggested fix (vitest `src` alias or a `pretest` build step) for the Epic 2 retrospective. NOT fixed in this story per the review directive.
- **Pre-existing flake re-observed (no new entry).** On the reviewer's FIRST full-suite run, `packages/core/src/boundary-enforcement.test.ts > rejects a better-sqlite3 import from core` timed out at 5000ms (cold ESLint + typescript-eslint start under parallel load); it passed 19/19 in isolation (~2.8s) and the warm full-suite re-run was 234/234 green. This is already tracked in `deferred-work.md` (logged during the Story 2.2 review) with a suggested fix (explicit generous per-test timeout or hoist the ESLint instance into `beforeAll`); no new entry added.

### Files modified by review

- `_bmad-output/implementation-artifacts/2-4-update-current-focus.md` — added this Review Findings section.
- `_bmad-output/implementation-artifacts/deferred-work.md` — logged the monorepo build-ordering papercut (LOW process item).
