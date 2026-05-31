---
baseline_commit: 7d14dafe81b18487155202c97e853f7bc654498f
---

# Story 2.3: Re-establish identity with login

Status: done

## Story

As an agent,
I want to `login` to an existing handle,
so that I resume my durable identity in a new session without re-registering.

## Acceptance Criteria

1. **Given** a previously registered handle,
   **When** I call `login` with it,
   **Then** the session is established as that identity (claim-based — no secret token is required or checked), and the identity is returned (`handle`, `current_focus`, `created_at`, `last_seen`).

2. **Given** a handle that was never registered,
   **When** I call `login`,
   **Then** the call is rejected with `LOGIN_UNKNOWN`.

3. **(Integration AC)** **Given** the `login` tool on the bootstrap server,
   **When** a real MCP client over `InMemoryTransport` registers handle `H` and then calls `login` with `H` (and with its canonical-case variants),
   **Then** `login` returns `H`'s identity and the server's session identity is now `H`; and `login` with a never-registered handle returns a `LOGIN_UNKNOWN` `isError` result. (The session-identity holder introduced here is first *consumed* by Story 2.4's `update_focus` — see Consumed-by — so its full observable effect lands there; this story proves the login semantics + that the session is set.)

## Consumes

- **Story 2.1 (MCP bootstrap)** — `login` tool registered via `registerCoreTool` + `error-map.ts`; first consumer of the `LOGIN_UNKNOWN` mapping.
- **Story 2.2 (identity projection)** — `login` resolves the handle against `findIdentity`/`foldIdentities` (the directory the ledger derives).

## Consumed-by

- **Story 2.4 (update focus)** — `update_focus` acts as the **session identity** this story establishes (its actor is the logged-in/registered handle). First consumer of the session holder.
- **Story 2.5 (last-seen)** — `identity.seen` is appended for the session identity on activity.

## Tasks / Subtasks

- [x] Task 1: `login` board operation in `core` (AC: #1, #2)
  - [x] Implement `login(dataAccess, handle): Promise<Identity>`: canonicalize the handle (lowercase; the boundary Zod validates charset), resolve it via the identity directory — `findIdentity(await dataAccess.eventsByActor(canonicalHandle), canonicalHandle)` (the directory for one handle is derived from that actor's identity events; `eventsByActor` is the indexed read). If found, return the `Identity`. If not found, throw `new BoardError('LOGIN_UNKNOWN', …)`.
  - [x] No event is appended on login (login is a read/resolve, not a ledger write) — claim-based, no token. Confirm `login` performs zero appends.
  - [x] Export `login` from the core barrel (place beside `register` in `identity/`).
- [x] Task 2: Per-connection session identity holder in `mcp-server` (AC: #1) — **the new mechanism (consumed by 2.4/2.5)**
  - [x] Introduce a small per-server session-state holder created inside `createBoardServer` (one MCP server process == one agent == one session, per architecture "one server process per agent"). Shape: a mutable holder of the current identity handle, e.g. `{ handle: string | null }` (start `null`). Keep it OUT of `core` — it is connection/session state owned by the server layer, not board state in the ledger.
  - [x] On a successful `login`, set the session handle to the resolved identity's handle. On a successful `register` (Story 2.2 tool), ALSO set the session handle (a freshly-registered agent is "established" too — FR2/FR37 "register-or-login"). Wire this into the existing `register` tool with a minimal edit; do not change its result shape.
  - [x] Expose the session holder to the tool closures (each tool already closes over `deps`; thread the session holder the same way) so Stories 2.4/2.5 can read it as the actor. Do NOT add a user-facing "who am I" tool in this story (not in scope).
- [x] Task 3: `login` MCP tool (AC: #1, #2)
  - [x] Register the `login` tool on `createBoardServer` via `registerCoreTool`. Zod input schema (snake_case wire): `handle` (required string, same canonical charset `^[a-z0-9._@-]+$` + length bound as `register`, so invalid input is rejected before core).
  - [x] The handler delegates to `core.login`, on success sets the session handle (Task 2) and returns the identity as the success result (snake_case wire: `handle`, `current_focus`, `created_at`, `last_seen`); a `BoardError('LOGIN_UNKNOWN')` is routed through `error-map.ts` by the helper.
  - [x] Keep the handler THIN — resolve via core, set session, map at the boundary; no board logic.
- [x] Task 4: Tests (AC: #1, #2, #3)
  - [x] Unit: `core.login` — known handle returns the identity (and appends nothing — assert ledger size unchanged); unknown handle → `BoardError('LOGIN_UNKNOWN')`; canonicalization (a handle reaching core resolves case-insensitively against the stored canonical form). [packages/core/src/identity/login.test.ts]
  - [x] Integration (real-runtime, Rule 3): over `InMemoryTransport`, a real `Client` registers `H`, then `login H` → success shape; `login` of an unregistered handle → `LOGIN_UNKNOWN` `isError`; assert the session holder reflects `H` after login (observed via the construction seam — a `sessionIdentity` holder passed into `createBoardServer`, NOT a new public tool). Invalid charset handle → rejected before core (dataAccess spy never called). [packages/mcp-server/src/tools/login.integration.test.ts + login.qa.test.ts]
  - [x] Rule 8: tests `*.test.ts`, discovered by default `pnpm test`.
- [x] Task 5: Full-gate verification — `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run format` all green; no regression to the existing baseline (180 tests before this story; grew to 203).

## Dev Notes

### Design decision — session identity (architecture-aligned, decided by the lead)

FR2: "`login` re-establishes an existing identity **for a session**." The stdio MCP server is **one process per agent** (architecture.md#Infrastructure), so the session is a per-process/per-connection notion. This story introduces a **session-identity holder in the `mcp-server` layer** (not `core`): a mutable "current handle" set by `login` (and by `register`), read by the identity-scoped tools that follow (`update_focus` 2.4, `identity.seen` 2.5) as the acting handle. This is connection/session state — it is NOT board logic and NOT ledger state, so it does not violate the thin-handler rule or the module boundary (board state stays in the ledger; `core` stays storage- and session-agnostic). Do NOT push session state into `core`.

If you find a concrete reason this session model can't work (e.g. the SDK gives no stable per-connection hook within `createBoardServer`), STOP and surface it — the alternative (every tool takes an explicit `actor` param, no session) is a different agent-facing contract and a project-wide decision, not a local one.

### Architecture compliance (mandatory)

- **Claim-based auth:** the handle IS the credential; `login` checks existence only, no secret token, appends nothing. `login` to an unknown handle is a structured error (`LOGIN_UNKNOWN`). [Source: architecture.md#Identity & Trust (V1); epics.md FR2]
- **`LOGIN_UNKNOWN` ∈ `BOARD_ERROR_CODES`** (already declared). Errors raised as `BoardError` in core, mapped at the boundary. [packages/core/src/errors.ts]
- **Wire snake_case** at the MCP boundary (`handle`, `current_focus`, `created_at`, `last_seen`); camelCase in TS; mapping only at the seam. **Ordering always `seq`.** [architecture.md#Naming/Format Patterns]
- **Thin handler; module boundaries:** board resolution in `core`; session state in the server layer; better-sqlite3 stays in data-access. [architecture.md#Structure Patterns; lint guards]

### Existing surfaces to build on (verified)

- `core`: `findIdentity(events, handle): Identity | undefined`, `foldIdentities(events): Map<string, Identity>`, `Identity = { handle, currentFocus, createdAt, lastSeen }`. [packages/core/src/identity/projection.ts]
- `core`: `register`, `RegisterInput`; `BoardError` + `BOARD_ERROR_CODES` (incl. `LOGIN_UNKNOWN`). [packages/core/src/index.ts, errors.ts]
- `DataAccess.eventsByActor(handle)` — indexed read of one actor's events (use it to resolve a single identity efficiently). [packages/core/src/ports.ts]
- Story 2.1 bootstrap: `createBoardServer({ dataAccess })`, `registerCoreTool`, `error-map.ts`. Story 2.2 `register` tool: `packages/mcp-server/src/tools/register.ts` (the pattern to mirror for `login.ts`, and the place to add the session-set on register).

### File structure (proposed)

- `packages/core/src/identity/login.ts` — `login` op (NEW); export from `core` barrel (UPDATE `index.ts`).
- `packages/mcp-server/src/session.ts` — the session-identity holder (NEW), or a small inline factory in `server.ts`.
- `packages/mcp-server/src/tools/login.ts` — the `login` tool (NEW), wired in `server.ts`.
- `packages/mcp-server/src/tools/register.ts` — minimal edit to set the session on successful register (UPDATE).
- `packages/mcp-server/src/server.ts` — create the session holder; register the `login` tool; pass the holder to tools (UPDATE).
- Tests co-located `*.test.ts`.

### Testing standards

- Vitest, co-located, default-discovered (Rule 8). Integration AC #3 is the Rule 3 real-runtime evidence (real `Client`↔`McpServer`). Make the session holder observable to the integration test via the construction seam (e.g. `createBoardServer` returns or accepts the holder for the test) rather than adding a public tool.

### References

- [Source: epics.md#Epic 2 / Story 2.3; FR2; FR37]
- [Source: architecture.md#Identity & Trust (V1); #Infrastructure (one process per agent); #Naming/Format/Structure Patterns]
- [Source: packages/core/src/identity/projection.ts, register.ts, errors.ts, ports.ts]
- [Source: packages/mcp-server/src/server.ts, tools/register.ts, register-tool.ts, error-map.ts]
- [Source: _bmad/custom/skill-rules.md] — Rules 1, 2, 3, 8.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`

### Debug Log References

- Full gate (in order) all green: `pnpm run lint` (clean), `pnpm run typecheck` (clean), `pnpm test` (203 passed / 32 files — baseline 180 → 203, +23), `pnpm run build` (7 packages), `pnpm run format` (`--check` clean after one `format:write` reflow of `login.integration.test.ts`).
- Workspace typecheck resolves cross-package types from each package's built `dist/index.d.ts` (the `exports` map), so `core` was rebuilt after adding `login` to its barrel before `mcp-server` typecheck could see it — expected for this monorepo, not a code issue.

### Completion Notes List

- **Task 1 — `core.login`** (`packages/core/src/identity/login.ts`): `login(dataAccess, handle)` canonicalizes (lowercase) then resolves via `findIdentity(await dataAccess.eventsByActor(canonical), canonical)`; found → returns `Identity`, miss → `throw new BoardError('LOGIN_UNKNOWN', …)`. Read-only: performs ZERO appends (asserted in unit tests by spying `append`/`appendGuarded`). Exported from the core barrel beside `register`.
- **Task 2 — session holder** (`packages/mcp-server/src/session.ts`): `SessionIdentity = { handle: string | null }` + `createSessionIdentity()`. Created inside `createBoardServer` (one server == one agent == one session) and threaded to every tool closure. Lives in the mcp-server layer, NOT `core` (it is connection/session state, not board/ledger state). `register` (2.2) now ALSO sets it on success (minimal edit; result shape unchanged) — a freshly-registered agent is "established" too (FR2/FR37). No public "who am I" tool added.
- **Task 3 — `login` MCP tool** (`packages/mcp-server/src/tools/login.ts`): thin handler via `registerCoreTool`; Zod `handle` shares the canonical charset/length validator with `register` (extracted to `tools/identity-shared.ts`); delegates to `core.login`, sets the session handle on success, returns snake_case `{handle, current_focus, created_at, last_seen}`; `LOGIN_UNKNOWN` routed by `error-map.ts`.
- **DECISION — construction seam for session observability:** `createBoardServer` accepts an OPTIONAL `sessionIdentity` holder in `BoardServerDeps` (defaults to a fresh one when omitted, as in `main()`). This keeps the `McpServer` return type stable (so `main.ts` and all existing tests are untouched) while letting the AC #3 integration test pass in a holder it retains and assert the tools set its `handle` — satisfying "observable via the construction seam, NOT a new public tool". The story flagged that if the SDK gave no stable per-connection hook this would need escalation; it does not — the holder is plain per-server state threaded to the closures, so no project-wide actor-param contract change was needed.
- **DRY refactor:** `register`'s duplicated handle pattern/length + identity→wire mapping were moved into `tools/identity-shared.ts` and reused by both `register` and `login` (one source of truth for the handle contract and wire shape).
- **Test-surface update:** `server.bootstrap.test.ts`'s exact-tool-list assertion (`['alpha','beta','register']`) was updated to include `login`, now a built-in alongside `register`.
- **AC coverage:** AC #1 (known handle → identity, session established) — `core.login` unit tests + `login.integration.test.ts`. AC #2 (unknown → `LOGIN_UNKNOWN`) — unit + integration. AC #3 (real `Client`↔`McpServer` over `InMemoryTransport`: register `H` then `login H` → identity + session == `H`; unknown → `LOGIN_UNKNOWN` isError; invalid charset rejected before core with the dataAccess spy never reached) — `login.integration.test.ts` + `login.qa.test.ts` (Rule 3 real-runtime evidence).

### File List

**Created**
- `packages/core/src/identity/login.ts`
- `packages/core/src/identity/login.test.ts`
- `packages/mcp-server/src/session.ts`
- `packages/mcp-server/src/session.test.ts`
- `packages/mcp-server/src/tools/login.ts`
- `packages/mcp-server/src/tools/login.integration.test.ts`
- `packages/mcp-server/src/tools/login.qa.test.ts`
- `packages/mcp-server/src/tools/identity-shared.ts`

**Modified**
- `packages/core/src/index.ts` — export `login` from the barrel.
- `packages/mcp-server/src/server.ts` — create/accept the session holder; register the `login` tool; thread the holder to `register` + `login`.
- `packages/mcp-server/src/index.ts` — export `createSessionIdentity` + `SessionIdentity`.
- `packages/mcp-server/src/tools/register.ts` — accept the session holder + set it on success; use shared `handleSchema`/`identityToWire`.
- `packages/mcp-server/src/server.bootstrap.test.ts` — include `login` in the exact-tool-list assertion.

## Review Findings

Code review (2026-05-31, `bmad-code-review` under `/epic-cycle`, Opus 4.8 1M). Three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) applied against the working-tree diff vs baseline `7d14daf`. Gate re-run by the reviewer: `pnpm run build` (7 pkgs) · `typecheck` clean · `lint` clean · `pnpm test` **207 passed / 33 files** · `format --check` clean.

**✅ Clean review — all layers passed. 0 decision-needed, 0 patch, 0 defer, 0 dismissed-as-noise.**

Critical checks (all verified against the actual code, not just the story prose):

- **`core.login` appends nothing on BOTH hit and miss.** `packages/core/src/identity/login.ts` performs only `eventsByActor` (read) + `findIdentity` (pure fold); no `append`/`appendGuarded` on either path. `login.test.ts` spies both write methods = 0 calls on the hit path AND the unknown-handle reject path. login is claim-based, no token — confirmed.
- **Session-holder ordering (the no-clobber guarantee).** The `login` handler resolves via `core.login` (`login.ts:86`, `await login(...)`) BEFORE mutating the holder (`:89`, `session.handle = ...`); a thrown `BoardError('LOGIN_UNKNOWN')` short-circuits before the assignment. `register` likewise sets the holder only after `core.register` succeeds (`register.ts`, after the `await`). The QA test `login.session.qa.test.ts` test 1 (established-as-`ada` → unknown `ghost` login → session **still `ada`**) is real and the impl honors it.
- **Module boundary.** Session state lives in `packages/mcp-server/src/session.ts`; `core.login` returns an `Identity` only and is session-agnostic. Lint boundary rules (`no-restricted-imports`: `core` may not import `data-access`/`better-sqlite3`/clients; barrel-only) pass — meaningful proof the boundary held.
- **Independent sessions per server.** `createBoardServer` defaults a fresh holder per server (`server.ts`, `deps.sessionIdentity ?? createSessionIdentity()`); `main()` injects none (production path). `login.session.qa.test.ts` test 3 + `session.test.ts` test 3 prove no module-global leak across two server instances.
- **Integration AC #3 present & real (Rules 1/2).** Real `Client` ↔ `createBoardServer` `McpServer` over `InMemoryTransport`, backed by the real `createDataAccess` (better-sqlite3, OS temp DB) — nothing mocked. Story declares the holder's first consumer (Story 2.4 `update_focus`) in both Consumed-by and AC #3 prose — not silent.
- **`LOGIN_UNKNOWN` contract.** ∈ `BOARD_ERROR_CODES` (`errors.ts:20`); routed through `error-map.ts` → `{ code, message }` `isError: true` with the code carried through exactly; non-`BoardError` → `INTERNAL_ERROR` (no leak). `login.session.qa.test.ts` test 4 asserts the `message` is present + non-empty.
- **Zod-before-core.** `login.qa.test.ts` injects a spying `DataAccess` and proves 6 invalid handles (out-of-charset, uppercase-only, embedded space, leading slash, unicode, empty) + a missing handle are rejected at the SDK boundary with ZERO `DataAccess` calls; the CONTROL case (valid `ada`) fires `eventsByActor` exactly once — proving the "never called" assertions are meaningful.
- **Wire snake_case + thin handler.** `identityToWire` maps camelCase → `{ handle, current_focus, created_at, last_seen }` only at the boundary; handler is resolve → set-session → map, no board logic.
- **DRY `identity-shared.ts`.** `HANDLE_PATTERN`/`HANDLE_MAX_LENGTH`/`handleSchema`/`identityToWire`/`IdentityWire` are a byte-faithful extraction of what `register` had inline; both tools now import them (one source of truth). `register`'s result shape (`successResult` → `structuredContent: {...wire}` + JSON text block) is unchanged and identical to `login`'s; `register.integration.test.ts` + `register.qa.test.ts` still pass. No boundary violation, no duplicated logic.
- **Rule 6 (ADR):** N/A — `docs/adr/` absent; no ADR constraints.

Non-blocking observations (not findings, no action):

- The Dev Agent Record / Change Log below records "203 tests / 32 files" — a dev-stage snapshot taken before QA added `login.session.qa.test.ts` (+4 tests, +1 file → **207 / 33**). The authoritative QA test-summary (`tests/test-summary.md`) and this review record the current 207/33. No discrepancy in substance; the Status line is updated to `done` below.
- `register.ts` line-13 comment still references `HANDLE_PATTERN` by name though the symbol moved to `identity-shared.ts`. Cosmetic comment only; the schema is correctly imported. Not worth a churn before the lead's smoke.

## Change Log

| Date       | Version | Description                                                                                      | Author |
| ---------- | ------- | ------------------------------------------------------------------------------------------------ | ------ |
| 2026-05-31 | 0.1.0   | Story 2.3 implemented: `core.login` (claim-based, no append), per-connection session holder set by `login`+`register`, `login` MCP tool; full gate green (203 tests). | Dev (Amelia) |
| 2026-05-31 | 0.1.1   | Code review (`bmad-code-review`): clean — 0 findings across all 3 layers; gate re-run green (207 tests / 33 files). Status → done. | Review (Opus 4.8) |
