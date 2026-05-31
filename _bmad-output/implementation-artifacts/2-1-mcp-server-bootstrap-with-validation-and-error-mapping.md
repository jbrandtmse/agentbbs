---
baseline_commit: 79411436913027edfd4212bd4205fcd6c30610b1
---

# Story 2.1: MCP server bootstrap with validation and error mapping

Status: done

## Story

As an agent,
I want a running stdio MCP server that validates my tool calls and returns structured errors,
so that I have a stable, well-behaved surface to interact with the board.

## Acceptance Criteria

1. **Given** the `mcp-server` package,
   **When** the server starts,
   **Then** it connects over stdio using `@modelcontextprotocol/sdk` v1.x and registers the V1 tool surface as thin handlers that delegate to `core` (no board logic in the handler),
   **And** each tool declares its inputs as a Zod v4 schema and rejects invalid input before reaching `core`.

2. **Given** `core` throws a `BoardError(code, message)`,
   **When** the handler catches it,
   **Then** it maps to the structured MCP error result `{ code, message }` using `error-map.ts`,
   **And** the error code is one of the documented closed set (`BOARD_ERROR_CODES`).

3. **(Integration AC)** **Given** the bootstrap's tool-registration helper + `error-map.ts` are exercised by a representative tool registered through the same production path the identity tools will use,
   **When** a real MCP client connected over the SDK's in-memory transport pair calls that tool,
   **Then** (a) a valid call returns a success result, (b) an input that violates the Zod schema is rejected **before** the core delegate runs (the delegate is never invoked), and (c) a delegate that throws a `BoardError` produces an MCP error result (`isError: true`) whose payload carries the exact `{ code, message }` with `code ∈ BOARD_ERROR_CODES`.

## Integration ACs

This story **introduces a service** (the MCP server bootstrap + the reusable tool-registration/error-mapping pattern). Its consumers are the identity-tool stories later in this epic. AC #3 above is the binding Integration AC, exercised against a real MCP client over the SDK's `InMemoryTransport` linked pair (a real-runtime exercise of the actual SDK, not a mock).

## Consumed-by

- **Story 2.2 (register)** — registers the `register` tool via this bootstrap's helper + `error-map.ts`; first consumer of the `HANDLE_TAKEN` mapping.
- **Story 2.3 (login)** — registers `login`; consumer of the `LOGIN_UNKNOWN` mapping.
- **Story 2.4 (update focus)** — registers the focus-update tool.
- **Story 2.5 (last-seen)** — appends `identity.seen` on activity through the same surface.

## Tasks / Subtasks

- [x] Task 1: Install + pin the MCP SDK and Zod in `mcp-server` (AC: #1)
  - [x] Add `@modelcontextprotocol/sdk` (catalog: `1.29.0`) and `zod` (catalog: `^4.4.3`) to `packages/mcp-server/package.json` `dependencies` using `catalog:` references (the catalog entries already exist in `pnpm-workspace.yaml`). Run `pnpm install`.
  - [x] **Research-first verification (do this BEFORE coding):** open `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` and confirm the exact, installed `registerTool` signature and the `inputSchema` accepted types. The verified 1.29.0 contract (see Dev Notes → "Verified SDK 1.29.0 API") is `registerTool(name, config, cb)` with `inputSchema?: ZodRawShapeCompat | AnySchema`. If the installed `.d.ts` differs from the Dev Notes, the installed types win — adapt and note the delta in the Dev Agent Record.
- [x] Task 2: `error-map.ts` — `BoardError` → structured MCP error result (AC: #2)
  - [x] Implement a mapper that, given a caught error, returns a `CallToolResult` with `isError: true` carrying `{ code, message }` when the error is a `BoardError` (import `BoardError` + `BOARD_ERROR_CODES` from `@agentbbs/core`).
  - [x] For a non-`BoardError` (unexpected) throw, return a generic `isError: true` result that does NOT leak internals (e.g. an `INTERNAL_ERROR`-style result), and let it be distinguishable from a domain error. Do not invent a new `BOARD_ERROR_CODES` member for this — the closed set is owned by `core`; use a separate non-board sentinel for unexpected failures and document it.
  - [x] Unit-test the mapper directly: a `BoardError('HANDLE_TAKEN', …)` maps to the documented shape; a plain `Error` maps to the generic shape; the board `code` round-trips exactly.
- [x] Task 3: Tool-registration helper — the reusable "validate → call core → map error" pattern (AC: #1, #2)
  - [x] Implement a helper (e.g. `registerCoreTool(server, name, { description, inputSchema }, delegate)`) that registers a tool whose handler: lets the SDK validate input against the Zod schema (invalid input is rejected by the SDK before the handler body runs — confirm this is the 1.29.0 behavior during Task 1), calls the `core` delegate with the typed args, returns the success result on success, and routes any thrown error through `error-map.ts`.
  - [x] Keep the handler THIN: no board logic, no SQL, no projection — it only validates, delegates, and maps. (Architecture: "no board logic in the MCP layer".)
- [x] Task 4: Server factory + stdio entrypoint (AC: #1)
  - [x] Implement `createBoardServer(deps: { dataAccess: DataAccess })` returning a configured `McpServer` (name `@agentbbs/mcp-server` or `agentbbs`, version from package). Tools are registered through Task 3's helper; later stories add the identity tools here.
  - [x] Implement `main()` (the stdio entrypoint): obtain the `DataAccess` port via `createDataAccess()` from `@agentbbs/data-access`, build the server with `createBoardServer`, and `await server.connect(new StdioServerTransport())`. Add a `bin`/start script so the server can be launched.
  - [x] Export the factory + helper + error-map from `src/index.ts` (the package barrel) so later stories and tests import them from `@agentbbs/mcp-server`, never deep paths.
- [x] Task 5: Integration test over a real in-memory transport (AC: #3)
  - [x] Write a discoverable `*.test.ts` that uses the SDK's `InMemoryTransport.createLinkedPair()` to connect a real `Client` to a `createBoardServer`-built server on which a representative tool is registered through the production `registerCoreTool` helper (the test supplies a tiny fake `DataAccess` and a delegate it controls).
  - [x] Assert the three AC #3 outcomes: valid call → success; schema-invalid input → delegate never called + SDK rejects; delegate throws `BoardError` → `isError: true` result carrying the exact `{ code, message }`.
- [x] Task 6: Full-gate verification
  - [x] `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run format` all green; new tests discovered and passing; no regression to the existing baseline.

## Dev Notes

### What this story IS and ISN'T

- **IS:** the server bootstrap, the reusable `validate → delegate → map-error` registration pattern, `error-map.ts`, the stdio entrypoint, and an integration test proving the pattern end-to-end over a real transport.
- **ISN'T:** the `register`/`login`/focus/seen board logic — those land in Stories 2.2–2.5, which each register their tool through this story's helper. Do NOT implement identity projections here. The representative tool in Task 5 lives in the test (or as a clearly-marked diagnostic), not as a permanent fake board tool.

### Architecture compliance (mandatory)

- **Thin MCP layer:** handlers validate input, call `core`, return — no board logic, no SQL. [Source: architecture.md#MCP Tool Surface Contract; #Structure Patterns]
- **Wire casing is `snake_case` at the MCP boundary**, `camelCase` inside TS, with a thin mapping layer the only place they meet. Tool param names + any JSON error payload fields are `snake_case`. [Source: architecture.md#Naming Patterns]
- **Uniform error shape `{ "code": "SCREAMING_SNAKE", "message": "…" }`**; codes are the closed `BOARD_ERROR_CODES` set owned by `core`; errors are raised as typed `BoardError`s in core and mapped at the boundary (not returned in-band by core). [Source: architecture.md#Format Patterns; packages/core/src/errors.ts]
- **Barrel-only imports:** consume `@agentbbs/core` and `@agentbbs/data-access` via their package barrels, never deep paths; export this package's surface from `src/index.ts`. [Source: architecture.md#Structure Patterns]
- **Ordering is always `seq`** (not relevant to bootstrap, but inherited by any read path later). [Source: architecture.md#Format Patterns]

### Verified SDK 1.29.0 API (confirmed against the published `dist/esm/server/mcp.d.ts` at story creation)

> **Research-first note:** these facts were verified against the actual v1.29.0 type declarations. A Perplexity pass returned several WRONG claims for this version (tool-name-in-config-object, manual `zodToJsonSchema` required, `transport.listen(server)`); the `.d.ts` is authoritative and is reproduced here. Re-verify against the installed `.d.ts` in Task 1.

- **Imports (subpath exports):**
  - `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';`
  - `import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';`
  - For the test: `import { Client } from '@modelcontextprotocol/sdk/client/index.js';` and `import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';` (confirm these exact subpaths against the installed package's `exports` map in Task 1).
- **Construction:** `new McpServer({ name, version })`.
- **Tool registration (modern):**
  ```ts
  registerTool(
    name: string,
    config: { title?; description?; inputSchema?: ZodRawShapeCompat | AnySchema; outputSchema?; annotations?; _meta? },
    cb: ToolCallback<InputArgs>
  ): RegisteredTool
  ```
  - **`name` is a separate first string argument** (not inside `config`).
  - **`inputSchema` accepts a `ZodRawShapeCompat` (a plain object whose values are Zod validators, e.g. `{ handle: z.string(), current_focus: z.string() }`) OR an `AnySchema` (Standard Schema).** Both are valid. Because **Zod 4** implements Standard Schema, you can pass either a raw shape OR a Zod 4 `z.object({...})` — **no manual JSON-Schema conversion is needed** for 1.29.0.
  - **The callback receives already-parsed, typed args** — the SDK validates against the schema and **rejects invalid input before the handler runs**. This is what satisfies AC #1's "rejects invalid input before reaching `core`" and AC #3(b). (Confirm the reject-before-handler behavior empirically in Task 5.)
- **Connect:** `await server.connect(transport)` (Promise). NOT `transport.listen(server)`.
- **Tool result / error:** the handler returns a `CallToolResult` — `{ content: ContentBlock[], isError?: boolean }`. For a domain error, return `{ isError: true, content: [...] }` carrying the structured `{ code, message }` (e.g. as a `text` block of `JSON.stringify({ code, message })`, or a structured content block — pick one and keep it uniform; document the chosen representation as part of the public error contract). The SDK also converts a thrown handler error into an `isError` result, but for the closed-code contract route domain errors through `error-map.ts` explicitly rather than relying on throw-to-isError.

### Wiring the DataAccess port

- `@agentbbs/data-access` exposes `createDataAccess(options?)` → a `DataAccessHandle` implementing the `core` `DataAccess` port (opens the DB via `openDatabase` with WAL + busy_timeout + bounded retry; discovers the DB path via `resolveDbPath`). The stdio `main()` calls `createDataAccess()` and injects the handle into `createBoardServer`. [Source: packages/data-access/src/index.ts; data-access.ts]
- For tests, inject a tiny fake `DataAccess` (implement only the methods the representative tool touches) — do NOT open a real SQLite file in the bootstrap integration test unless a story-specific reason requires it.

### File structure (proposed; `kebab-case.ts`, no default exports)

- `packages/mcp-server/src/server.ts` — `createBoardServer(deps)`.
- `packages/mcp-server/src/error-map.ts` — `BoardError` → `CallToolResult` mapper.
- `packages/mcp-server/src/register-tool.ts` — `registerCoreTool` helper (the validate→delegate→map pattern).
- `packages/mcp-server/src/main.ts` (or `bin.ts`) — stdio entrypoint (`createDataAccess` → `createBoardServer` → `connect`).
- `packages/mcp-server/src/index.ts` — barrel re-exporting the factory + helper + error-map (+ types).
- Tests co-located as `*.test.ts` beside source (one root Vitest config discovers them).

### Testing standards

- Vitest, `*.test.ts` co-located, discovered by the root config (Rule 8 — must run in the default `pnpm test`).
- AC #3's integration test is the **real-runtime evidence** (Rule 3) for this user-facing surface: a real `Client`↔`McpServer` pair over `InMemoryTransport`, not a hand-rolled mock of the SDK. Unit-test `error-map.ts` directly in addition.

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#MCP Tool Surface Contract (API & Communication)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Identity & Trust (V1)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns / Format Patterns / Structure Patterns]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2 / Story 2.1]
- [Source: packages/core/src/errors.ts] — `BoardError`, `BOARD_ERROR_CODES`, `BoardErrorCode`.
- [Source: packages/core/src/ports.ts] — `DataAccess` port (async).
- [Source: packages/data-access/src/index.ts] — `createDataAccess`, `resolveDbPath`, `openDatabase`.
- [Source: _bmad/custom/skill-rules.md] — Rules 1, 3, 8.
- SDK API verified against `@modelcontextprotocol/sdk@1.29.0` `dist/esm/server/mcp.d.ts` (re-verify the installed copy in Task 1).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]` (via `/epic-cycle` → `bmad-dev-story`).

### Debug Log References

Full-gate run (final): `pnpm run lint` ✓ (exit 0), `pnpm run typecheck` ✓ (exit 0), `pnpm test` ✓ (18 files, **116 tests pass** — baseline 99 + 17 new, no regressions), `pnpm run build` ✓ (7 packages), `pnpm run format` ✓ ("All matched files use Prettier code style"). Real-binary smoke: `echo "" | node packages/mcp-server/dist/main.js` → exit 0 (opens `.agentbbs/agentbbs.db` with WAL, connects stdio, exits clean on stdin close).

### Completion Notes List

**Task 1 — research-first SDK verification (installed types confirmed):**
- Installed exactly: `@modelcontextprotocol/sdk@1.29.0`, `zod@4.4.3` (match the catalog pins). `pnpm install` ran with no `allowBuilds` prompt (existing approvals covered the tree).
- The installed `dist/esm/server/mcp.d.ts` `registerTool` signature MATCHES the story's Dev Notes exactly: `registerTool<OutputArgs, InputArgs>(name: string, config: { title?; description?; inputSchema?: InputArgs; outputSchema?; annotations?; _meta? }, cb: ToolCallback<InputArgs>)` where `InputArgs extends undefined | ZodRawShapeCompat | AnySchema`. `name` is a separate first arg; `inputSchema` accepts a raw shape (`Record<string, AnySchema>`, Zod-4 validators OK) OR a Standard-Schema object — no manual JSON-Schema conversion. No delta to record.
- All four import subpaths resolve via the package `exports` map (`.` + `./*` wildcard): `server/mcp.js`, `server/stdio.js`, `client/index.js`, `inMemory.js` all verified present.
- **Empirically confirmed the validate-before-handler behavior** (the basis of AC #1 / AC #3(b)) by reading `dist/esm/server/mcp.js`: the `CallToolRequest` handler calls `validateToolInput(...)` (line 125) which **throws `McpError(InvalidParams)` before** `executeToolHandler(...)` (line 126) runs — so an invalid call never reaches the delegate. The AC #3 integration test proves this end-to-end (delegate spy `not.toHaveBeenCalled()`).

**Task 2 — `error-map.ts`:** `mapErrorToResult(error)` returns a `CallToolResult { isError:true }` carrying `{ code, message }`. A `BoardError` round-trips its closed `code` exactly; any other throw maps to a generic `INTERNAL_ERROR` sentinel with a fixed internals-free message (verified the raw cause never appears in the serialized result). `INTERNAL_ERROR` is deliberately NOT added to `BOARD_ERROR_CODES` (the closed set stays core-owned); a client distinguishes domain vs internal purely by `code`.

**Task 3 — `registerCoreTool`:** the one production "validate → delegate → map-error" path. The handler is thin (no board logic/SQL); it calls the injected delegate and routes any thrown/rejected error through `mapErrorToResult`. **Design decision (per Dev Notes): domain errors are mapped EXPLICITLY (catch + return) rather than relying on the SDK's throw-to-isError** — the SDK's catch-all (`createToolError`) keeps only `error.message` and would DROP the `code`, breaking the closed-code contract. Generic/internal types via the SDK's own `ToolCallback` / `ShapeOutput` / `ZodRawShapeCompat`, so the delegate's args type is exactly what the SDK infers (no re-derivation drift; the typecheck caught and forced this — see Issues).

**Task 4 — factory + entrypoint:** `createBoardServer({ dataAccess })` returns a configured `McpServer` (`name: 'agentbbs'`, `version: '0.0.0'`). No board tools registered in 2.1 (bootstrap only; identity tools land 2.2–2.5, each calling `registerCoreTool` inside the factory). `main.ts` is the stdio bin (shebang preserved into `dist/main.js`): `createDataAccess()` → `createBoardServer` → `connect(new StdioServerTransport())`; diagnostics to stderr only (stdout reserved for JSON-RPC). Added `bin: agentbbs-mcp-server` + `start` script. Barrel re-exports the factory/helper/error-map; `main.ts` is intentionally NOT re-exported (it self-runs).

**Task 5 — AC #3 integration test (real-runtime evidence, Rule 3):** `server.test.ts` connects a real `Client` to a `createBoardServer`-built server over `InMemoryTransport.createLinkedPair()`, with a representative tool registered through the production `registerCoreTool` (fake `DataAccess`, test-controlled delegate). Proves: (a) valid call → success with parsed/typed args; (b) schema-invalid input → **delegate never called** + `isError` validation result (two cases: missing required field, wrong type); (c) delegate throws `BoardError` → `isError` result with exact `{ code, message }`, `code ∈ BOARD_ERROR_CODES`, round-tripping through both the JSON text block and `structuredContent`.

**Error wire-representation decision (the public error contract):** the `{ code, message }` payload is carried in BOTH `structuredContent` (machine-readable) AND a single `text` content block holding `JSON.stringify({ code, message })` (human/LLM-readable, and recoverable by clients that ignore structured content). Both hold the identical payload. `code`/`message` are already lowercase single-word field names, so the snake_case wire boundary is a no-op for the field NAMES (no camel↔snake transform); the `code` VALUE is SCREAMING_SNAKE. `readErrorPayload()` prefers `structuredContent`, falling back to parsing the text block.

**Casing note (AC compliance):** the representative tool in the test uses `snake_case` MCP param names (`handle`, `current_focus`) to exercise the wire-boundary convention; `current_focus` specifically proves multi-field + snake_case at the boundary.

**Rule 5 (NFR tripwire):** no NFR found unmeasurable/contradictory; no planning-artifact amendment required.
**Rule 6 (ADRs):** no `docs/adr/` registry exists in this project — N/A (no ADR commitments to match).

### Issues Encountered

- **Type friction between my generic and the SDK's inference (caught by `pnpm run typecheck`, fixed before completion):** my first `registerCoreTool` typed the delegate args as `z.infer<z.ZodObject<Shape>>`, which TS could not prove identical to the SDK's `ToolCallback<Shape>` expectation (`ShapeOutput<Shape>`) — `tsc` errored at the `registerTool` call. Fixed by adopting the SDK's own `ShapeOutput<Shape>` for the delegate args and `ToolCallback<Shape>` for the wrapper (imported type-only from `@modelcontextprotocol/sdk/server/zod-compat.js` + `.../server/mcp.js`, both resolvable via the `exports` map; not banned by the `@agentbbs/*/*`-only deep-import lint rule). Also annotated the integration test's handler-invocation helper return as `CallToolResult`. Typecheck then clean.
- **Prettier `--check` (`pnpm run format`) flagged the 6 new files** (line-wrapping only). Resolved with `pnpm run format:write`; re-ran `--check` → clean, then re-ran lint/typecheck/test to confirm the reformat introduced no regressions (all green).

### File List

**Added (production source):**
- `packages/mcp-server/src/error-map.ts` — `BoardError` → `CallToolResult` mapper + `INTERNAL_ERROR` sentinel + `readErrorPayload`.
- `packages/mcp-server/src/register-tool.ts` — `registerCoreTool` (validate → delegate → map) + delegate/config types.
- `packages/mcp-server/src/server.ts` — `createBoardServer(deps)` factory + `SERVER_NAME`/`SERVER_VERSION`.
- `packages/mcp-server/src/main.ts` — stdio entrypoint (`createDataAccess` → `createBoardServer` → `connect`); the `agentbbs-mcp-server` bin.

**Added (tests):**
- `packages/mcp-server/src/error-map.test.ts` — unit tests for the mapper (7 tests).
- `packages/mcp-server/src/register-tool.test.ts` — unit tests for the helper (5 tests).
- `packages/mcp-server/src/server.test.ts` — AC #3 integration test over `InMemoryTransport` (5 tests).

**Modified:**
- `packages/mcp-server/src/index.ts` — barrel re-exporting the factory + helper + error-map (+ types).
- `packages/mcp-server/package.json` — added `@modelcontextprotocol/sdk` + `zod` deps (`catalog:`), `bin`, `start` script.
- `pnpm-lock.yaml` — lockfile updated by `pnpm install` (SDK + Zod and their transitive deps).
- `_bmad-output/implementation-artifacts/2-1-...md` (this story) — frontmatter `baseline_commit`, task checkboxes, Dev Agent Record, File List, Change Log, Status.

## Review Findings

Code review (2026-05-31, `/epic-cycle` → `bmad-code-review`, three parallel layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor). Re-ran the full gate to confirm green: `lint` ✓, `typecheck` ✓, `pnpm test` ✓ (**20 files / 133 tests pass** — dev+QA union, no regressions vs the 116 baseline), `build` ✓ (7 packages), `format` ✓.

**Outcome: APPROVED — clean review.** All three ACs satisfied; the binding Integration AC (#3) is exercised against the REAL SDK runtime, not a mock. No `decision-needed`, no `patch`, no `defer`. Two LOW observations were raised and **dismissed** (rationale below); nothing added to `deferred-work.md`.

### AC verification (auditable)

- **AC #1 — stdio server + thin Zod-validated handlers delegating to core:** SATISFIED. `main.ts` connects `createBoardServer` over `StdioServerTransport`; `registerCoreTool` is the single thin `validate → delegate → map` path; the SDK validates `inputSchema` and rejects invalid input before the handler body (verified empirically — see AC #3(b)). Handlers contain NO board logic/SQL/projection. `server.ts` registers ZERO board tools (bootstrap only; identity tools deferred to 2.2–2.5). Confirmed.
- **AC #2 — BoardError → `{ code, message }` via `error-map.ts`, code ∈ closed set:** SATISFIED. `mapErrorToResult` maps a `BoardError` to an `isError` `CallToolResult` carrying the EXACT `{ code, message }`; the closed `code` round-trips with no remap (unit-tested across every `BOARD_ERROR_CODES` member). Domain errors are mapped EXPLICITLY (catch + return), NOT via the SDK's throw-to-isError (which would drop the `code`) — the design decision is documented in `error-map.ts` and `register-tool.ts`. Non-`BoardError` throws map to the `INTERNAL_ERROR` sentinel with a fixed internals-free message; `INTERNAL_ERROR` is deliberately NOT a member of `BOARD_ERROR_CODES` (closed set stays core-owned). Leak tests assert raw causes (`ECONNREFUSED`, `secret-host`, `do-not-leak`, `low-level cause`) never appear in the serialized result. Confirmed.
- **AC #3 — Integration AC over a real in-memory transport:** SATISFIED, real-runtime (skill-rules Rule 1 + Rule 3). `server.test.ts` connects a real `Client` to a `createBoardServer`-built `McpServer` over `InMemoryTransport.createLinkedPair()`, registering a representative tool through the SAME production `registerCoreTool` helper the identity tools will use. Proves (a) valid call → success with parsed/typed args; (b) schema-invalid input (missing-required AND wrong-type) → `delegateSpy` `not.toHaveBeenCalled()` (rejected BEFORE the delegate runs); (c) `BoardError` throw → `isError` result carrying the exact `{ code, message }`, `code ∈ BOARD_ERROR_CODES`, round-tripping through both the JSON text block and `structuredContent`. QA's `server.bootstrap.test.ts` adds the discovery surface (`tools/list`) and asserts snake_case param names (`current_focus`/`handle`) are observable on the wire JSON-Schema with NO `currentFocus` camelCase leak. Genuinely the real SDK, not a hand-rolled mock. Confirmed.

### Project-rule compliance spot-checks

- **Thin MCP layer / no board logic in handlers:** PASS (handler body = `try { delegate } catch { mapErrorToResult }`; no SQL/projection anywhere in `mcp-server/src`).
- **snake_case on the wire, no camelCase leak:** PASS (tool param names snake_case; payload fields `code`/`message` are single lowercase words so the boundary is a no-op; discovery-surface assertion pins it).
- **Barrel-only imports for workspace packages:** PASS. `@agentbbs/core` and `@agentbbs/data-access` are consumed via their barrels only. The SDK type-only deep imports (`@modelcontextprotocol/sdk/server/zod-compat.js`, `.../shared/protocol.js`, etc.) target the SDK's OWN published `exports` map and are NOT matched by the `@agentbbs/*/*` deep-path lint rule — acceptable, and lint is green.
- **Toolchain pins:** PASS (Node 24.16.0 / pnpm 11.3.0 / `@modelcontextprotocol/sdk@1.29.0` match the committed pins).
- **Rule 5 (NFR tripwire):** N/A — no NFR work in this story; none found unmeasurable/contradictory.
- **Rule 6 (ADR):** N/A — no `docs/adr/` registry in this project.

### Dismissed observations (LOW, no action)

- **[Review][Dismiss] `readErrorPayload` returns a recovered `code` string cast to the closed union without membership re-validation** [`error-map.ts:104-106,126`] (Blind + Edge). Both recovery branches cast `code: string` to `ErrorPayload['code']` (`BoardErrorCode | 'INTERNAL_ERROR'`) without checking `BOARD_ERROR_CODES` membership. **Dismissed — by design.** `readErrorPayload` is a best-effort *reader/recovery* helper, not the forward contract; the closed-code guarantee is enforced on the WRITE side by `mapErrorToResult`, which only ever emits closed codes or the `INTERNAL_ERROR` sentinel. Re-validating on read would make the reader REJECT forward-compatible codes added by a newer server (additive evolution is explicitly allowed by the error contract) and would also have to special-case `INTERNAL_ERROR` — net worse. No runtime fault (no crash, no leak); purely a read-side type-narrowing nuance. Existing tests cover the real recovery paths (text-block fallback, malformed/non-JSON/non-error → `undefined`).
- **[Review][Dismiss] `mapErrorToResult` relies on `instanceof BoardError` (dual-package hazard)** [`error-map.ts:78`] (Blind). If two copies of `@agentbbs/core` were ever loaded, `instanceof` could misclassify a real `BoardError` as `INTERNAL_ERROR`, dropping its `code`. **Dismissed — not reachable here:** the monorepo resolves `@agentbbs/core` once via `workspace:*` (single instance), and `errors.ts` additionally guards with `Object.setPrototypeOf(this, BoardError.prototype)`. No realistic path to a second core instance in this surface.

## Change Log

- 2026-05-31 — Story 2.1 implemented (MCP server bootstrap): `error-map.ts`, `registerCoreTool`, `createBoardServer`, stdio `main()`, barrel; AC #3 integration test over a real in-memory `Client`↔`McpServer`. SDK `@modelcontextprotocol/sdk@1.29.0` + `zod@4.4.3` installed via catalog. Full gate green; 116 tests pass (baseline 99 + 17 new, no regressions). Status → review. (Claude Opus 4.8)
- 2026-05-31 — Code review (`bmad-code-review`, 3 parallel layers): **APPROVED, clean review.** Full gate re-run green (20 files / 133 tests). All 3 ACs verified incl. the real-runtime Integration AC #3; thin-layer / explicit-error-mapping / snake_case / barrel-import checks pass. 0 patch / 0 defer; 2 LOW observations dismissed with rationale. Status → done. (Claude Opus 4.8)
