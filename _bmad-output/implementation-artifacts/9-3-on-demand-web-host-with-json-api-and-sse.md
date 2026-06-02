---
baseline_commit: 11b9fb7c978f8e8182602a901a2288161fa5765e
---

# Story 9.3: On-demand web host with JSON API and SSE

Status: done

<!-- Created by the /epic-cycle Lead Creates Story Files gate (lead-side /bmad-create-story). -->
<!-- Baseline: AGENTBBS-1-epic9 @ 11b9fb7 (Story 9.2). Service-introducing story — Integration AC mandatory. -->

## Story

As an operator,
I want to launch the web control room on demand,
so that I can browse and participate without an always-on server (NFR4).

## Acceptance Criteria

**AC1 — `agentbbs ui` launches the on-demand host.**
**Given** the `agentbbs ui` command,
**When** I run it,
**Then** a **local Node HTTP server** starts, serves the **Vite/React build** (the `apps/web` client), and exposes a **thin local JSON API mirroring core operations** (the UI never speaks MCP or SQL — it calls this JSON API; the host calls `@agentbbs/core` over the `@agentbbs/data-access` SQLite seam) plus an **SSE** channel,
**And** the server is **on-demand** — it is NOT required to be always-on for agents to use the board (agents keep their own stdio MCP processes; the host is a separate, operator-launched process over the same shared SQLite file).

**AC2 — SSE live deltas via MAX(seq) polling.**
**Given** the host is running,
**When** new events are appended (by ANY client — an agent's MCP process, or the operator),
**Then** the host detects them by polling `MAX(seq)` (`dataAccess.maxSeq()`) on a short interval and **pushes the deltas over SSE** to connected clients (the deltas are the events with `seq > lastSentSeq`, via `eventsSince`).

**AC3 — Integration AC (real consumer reads the service + observes an SSE effect).**
**Given** the running host bound to a real SQLite ledger,
**When** an HTTP client (a test acting as the `apps/web` client) GETs a JSON API endpoint (e.g. the board directory / projects),
**Then** it receives the board state derived from the real ledger (NOT mocked), proving the UI→JSON-API→core→data-access path is wired end-to-end,
**And when** an event is appended to that same ledger out-of-band (via a core write op, simulating another client),
**Then** a client connected to the SSE channel receives a delta carrying that new event's `seq` — proving the MAX(seq)-poll→SSE push path is wired. This is the Rule 1 producer→consumer integration over the real stack.

## Tasks / Subtasks

- [x] **Task 1 — `apps/web` Vite + React client scaffold** (AC: #1)
  - [x] Create `apps/web/` as a Vite + React app (Vite ^8.0.14, `@vitejs/plugin-react` ^6.0.2, react/react-dom ^19.2.6 — all catalog-pinned). `package.json` name `@agentbbs/web` (private), depends on `@agentbbs/ui-shared` (`workspace:*`). Add `apps/web` to the build graph (`pnpm -r build` already globs `apps/*` per pnpm-workspace.yaml; ensure the build script produces a static `dist/`). Vite config + `index.html` + a minimal `src/main.tsx` mounting a shell that imports `@agentbbs/ui-shared` (proving the build-once-mount-twice consumption — this is the first CROSS-package consumer of ui-shared).
  - [x] The client shell (minimal for 9.3): on load, fetch a JSON API endpoint (e.g. `/api/projects` or `/api/directory`) and render SOMETHING from the real data (a list is fine — the rich tree is Story 9.4); open an `EventSource` to the SSE endpoint and log/fold deltas (the rich live-update UI is Story 9.9). 9.3 proves the PIPE end-to-end, not the final UI.
  - [x] Import `@agentbbs/ui-shared` `tokens.css` into the client so the shell is themed (proves the token core mounts in the real web surface).

- [x] **Task 2 — The HTTP host (JSON API + SSE + static serving)** (AC: #1, #2)
  - [x] Implement the host in `packages/cli` (RECOMMENDED home — see Dev Notes → Host package home; cli already owns the `agentbbs` bin and depends on `@agentbbs/core` + `@agentbbs/data-access`, exactly what the host needs; `apps/web` stays a pure client whose built static assets the host serves). If the dev finds a hard blocker with this home, choose the smallest clean alternative and document the rationale in the Dev Agent Record (do NOT create a cli→apps/web workspace dependency).
  - [x] Use the Node built-in `node:http` server (no new HTTP-framework dep unless strongly justified — keep the dep surface minimal; Research-First if a framework is proposed). Open the shared SQLite via `createDataAccess` + `resolveDbPath` (honoring `AGENTBBS_DB`, same discovery the MCP server uses).
  - [x] **JSON API — thin, read-first, mirrors core READ ops** (the UI never speaks MCP/SQL). Expose GET endpoints backed by core projections over the data-access handle: at minimum the board directory / projects (`boardDirectory`/`listProjects`), and design the route shape so room reads (`readRoom`/`readContract`/`listAnnouncements`/`listRooms`) and the operator `check` slot in cleanly. WRITE endpoints (reply/react/add_participant/join) are NOT required by 9.3 — they land with Stories 9.6/9.7; leave a clear, documented extension seam (do not build them now, but do not architect them out). The API mirrors core op SHAPES (snake_case wire ↔ core camelCase) consistent with the MCP tool contract envelopes.
  - [x] **SSE channel:** an endpoint (e.g. `/api/events`) that holds the connection open, and a poller that calls `dataAccess.maxSeq()` on a short interval; when `maxSeq` advances past the last-sent seq, read `eventsSince(lastSent)` and write each as an SSE `data:` frame to every connected client; track per-connection (or a shared) `lastSentSeq`. Clean up the poller/interval on connection close and on host shutdown (no leaked intervals/sockets).
  - [x] **Static serving:** serve the built `apps/web` client (resolve its `dist/` path at runtime — a path resolution, NOT a workspace import; document how the path is found, e.g. relative to the monorepo root or an env override). SPA fallback to `index.html` for client routes.
  - [x] **On-demand (NFR4):** the host starts ONLY when `agentbbs ui` runs and stops when it is killed; nothing about agents' MCP usage requires it. Pick an ephemeral or configurable port; print the URL on start. Document that this is not a daemon.

- [x] **Task 3 — `agentbbs ui` CLI subcommand** (AC: #1)
  - [x] Wire an `agentbbs ui` subcommand into `packages/cli` (the `agentbbs` bin). It parses optional args (e.g. `--port`, `--db`/`AGENTBBS_DB`), starts the host, prints the local URL, and runs until interrupted (Ctrl-C → graceful shutdown). Keep arg parsing minimal (no heavy CLI framework unless justified). The existing `cli` `index.ts` is a bare marker today — establish a small subcommand dispatch (so `export`/`import` from FR32–34 can slot in later, but do NOT build those here).
  - [x] The root `package.json` `"ui"` script is currently a placeholder echo. Update it to invoke the real host (e.g. build apps/web then `agentbbs ui`, or a dev variant) and document the dev vs built flow.

- [x] **Task 4 — Tests (incl. the Integration AC over the real stack)** (AC: #1, #2, #3)
  - [x] **Integration test (AC3, Rule 1 + Rule 3 — real runtime, nothing mocked):** start the real host bound to a real `createDataAccess` SQLite temp ledger; (a) seed some board state via core write ops, GET the JSON API endpoint over real HTTP (e.g. `fetch`/`http` against the bound port), assert the response carries the seeded board state; (b) open an SSE connection (an `EventSource`-equivalent or raw HTTP stream read), append a NEW event via a core write op out-of-band, and assert the SSE client receives a delta frame carrying that event's `seq` within a bounded time. Tear down the host + DB cleanly. This is the load-bearing integration proof.
  - [x] Unit/contract tests for the JSON API route handlers (shape mirrors core ops; snake_case wire), the SSE framing (correct `text/event-stream` headers, `data:` frames, delta-not-full-resend), and the maxSeq poller (advances only on new seq; no resend of already-sent events; interval cleaned up on close).
  - [x] **NFR4 on-demand assertion:** a test/structural check that the host is not auto-started by importing core/data-access or by an agent path — it starts only via the `ui` entry. (A structural test that nothing in `packages/core`/`packages/data-access`/`packages/mcp-server` imports or starts the host.)
  - [x] Tests must be discoverable by default `pnpm test` (Rule 8). The host test is node-env (real HTTP + SQLite). Ensure `apps/web/src/**/*.test.{ts,tsx}` (already in the vitest include) and the cli host tests run; DOM-env client tests use the `ui-shared-dom` project pattern if needed.

- [x] **Task 5 — Gate**
  - [x] Honest gate: `pnpm run lint` (0) / `pnpm run build` (all packages + apps/web) / `pnpm run typecheck` (0) / `pnpm test` (green, count up, no `.only`/`.skip`/`.todo`) / `pnpm run format` (`--check` clean). Record exact counts. Confirm `apps/web` is in the build + typecheck graph (`tsconfig.typecheck.json` already includes `apps/*/src/**/*.{ts,tsx}`).

## Dev Notes

### What this story is (and is NOT)

- **IS:** the `apps/web` Vite/React client scaffold (first cross-package consumer of `ui-shared`), the on-demand Node HTTP host (thin read JSON API + SSE-over-maxSeq-poll + static serving of the web build), the `agentbbs ui` CLI subcommand, and the real-stack integration proof.
- **IS NOT:** the rich navigation tree (9.4), the room thread (9.5), the 👍/agreed UI (9.6), the join-gate composer + WRITE endpoints (9.7), tabs (9.8), the full optimistic/reconciliation live-update UI (9.9), calm states/a11y (9.10). 9.3 builds the PIPE and proves it end-to-end with a minimal shell; the features ride on it.
- The JSON API + SSE are the seam every later UI story consumes. Design the route/endpoint shape to be extended, but implement only the read endpoints + SSE needed to prove AC3 now.

### Host package home (the key design decision — RECOMMENDED + rationale)

RECOMMENDED: the HTTP host lives in **`packages/cli`** (it already owns the `agentbbs` bin and depends on `@agentbbs/core` + `@agentbbs/data-access` — precisely the host's needs), and serves **`apps/web`'s built static assets by runtime path resolution** (NOT a workspace import). `apps/web` stays a pure client (Vite/React build, depends on `@agentbbs/ui-shared`). This keeps the NFR2 module boundary clean: the host (a thin client over core, like mcp-server) and the web client are separate; neither imports the other as a package. Document the apps/web `dist/` path-resolution approach (monorepo-relative or `AGENTBBS_WEB_DIST` override) so the built host can find the client assets.
- This mirrors the established "thin client over core" pattern (mcp-server is the stdio thin client; the host is the HTTP thin client). The UI "never speaks MCP or SQL" [architecture #Frontend] — it speaks the host's JSON API; the host speaks core.
- If a hard blocker appears, the only acceptable alternative is the host as a self-contained server entry inside `apps/web` with its own bin — but prefer the cli home for boundary cleanliness. Whatever you pick, NO cli→apps/web (or apps/web→cli) workspace dependency.

### Architecture facts (verify against repo — Rule 4)

- `@agentbbs/core` barrel exposes the read surface the JSON API mirrors: `boardDirectory`/`DirectoryMember`, `listProjects`, `listAnnouncements`/`listRooms`, `readRoom`/`RoomHistory`, `roomMessages`, `readContract`, `check`/`CheckResult`, plus the write ops for later (`reply`/`react`/`unreact`/`addParticipant`/`joinBoard`). VERIFIED in `packages/core/src/index.ts`.
- `@agentbbs/data-access` exposes `createDataAccess`/`fromConnection`/`DataAccessHandle`, `resolveDbPath`/`ResolveDbPathOptions` (AGENTBBS_DB discovery), `openDatabase`. The `DataAccess` port has `maxSeq(): Promise<number>` and `eventsSince(cursor): Promise<Event[]>` — these BACK the SSE poller (poll maxSeq; on advance, eventsSince(lastSent)). VERIFIED in `packages/core/src/ports.ts` + `packages/data-access/src/index.ts`.
- The MCP server (`packages/mcp-server`) is the model for a thin client over core: how it opens data-access, maps snake_case wire ↔ core, and the structuredContent envelopes (`{ projects }`, `{ members }`, `{ rooms }`, `{ announcements }`, `{ room }`, `{ room, messages }`, `{ room_id, contract }`, `{ announcements, messages, cursor }`). Mirror these SHAPES in the JSON API so the two surfaces agree. [Source: docs/mcp-tool-contract.md].
- `pnpm-workspace.yaml` globs `apps/*` as workspace packages and catalog-pins vite/@vitejs/plugin-react/react/react-dom. `tsconfig.typecheck.json` includes `apps/*/src/**/*.{ts,tsx}`. `vitest.config.ts` includes `apps/*/src/**/*.test.{ts,tsx}`. VERIFIED.

### Research-First triggers (research-first.md / Rule 3) — verify against installed types

- **Vite ^8.0.14 + @vitejs/plugin-react ^6.0.2** — the v8 config shape, the build output layout, and the dev-server-vs-static-build model (does `agentbbs ui` serve a pre-built `dist/`, or proxy a Vite dev server in dev?). Recommend: production path serves the built `dist/`; a dev convenience MAY run Vite separately. Verify Vite 8 config API against the installed package.
- **node:http SSE** — correct `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` headers; flushing `data:`/`id:` frames; heartbeat/keep-alive; handling client disconnect (`req.on('close')`). Standard but confirm the Node 24 specifics.
- **EventSource in tests** — Node 24 may expose a global `EventSource`; confirm, else read the SSE stream via a raw `http` request and parse frames. Verify before writing the AC3 test.

### Module boundary + NFR posture (do not violate)

- NFR2: the host is a THIN client — it imports `@agentbbs/core` + `@agentbbs/data-access` only; NO board logic in the host. The web client imports `@agentbbs/ui-shared` only; it does NOT import core/data-access (it speaks the JSON API).
- NFR4 (daemonless V1): the host is on-demand — prove nothing auto-starts it (Task 4 structural check). It is NOT required for agents.
- NFR5 (pull-only) nuance: SSE here is the OPERATOR's chosen live view of the host (the operator opened the control room) — it does NOT push to AGENTS (agents stay pull-only via `check`). The SSE is the host→operator-browser channel only. Keep that framing in any doc/comment (an SSE to the operator's own open browser is not an agent push).

### Smoke (lead-side gate — informational)

Real-runtime smoke: the lead builds `apps/web`, runs `agentbbs ui` against a real temp SQLite ledger seeded with some board state, then (a) drives the served URL in real Chrome (chrome-devtools-mcp) — confirms the page loads, the JSON API returns board data, the shell renders themed content, the SSE connection opens; and (b) appends an event out-of-band (a core write against the same DB) and observes the SSE delta arrive in the browser (e.g. via a logged delta / DOM update / network EventSource frame). This is the api/browser smoke for the host.

### References

- [Source: epics.md#Epic 9 / Story 9.3] — ACs.
- [Source: architecture.md#Frontend Architecture (web surface runtime: on-demand Node HTTP, thin JSON API, SSE; UI does not speak MCP); #Process model (daemonless V1, NFR4); #Selected Toolchain (Vite 8/React 19)].
- [Source: docs/mcp-tool-contract.md] — the core op envelope shapes to mirror in the JSON API.
- [Source: packages/core/src/index.ts, packages/core/src/ports.ts, packages/data-access/src/index.ts] — read surface + maxSeq/eventsSince + createDataAccess/resolveDbPath.
- [Source: pnpm-workspace.yaml, vitest.config.ts, tsconfig.typecheck.json] — apps/* in the build/test/typecheck graph + catalog pins.

## Review Findings

**Code review (2026-06-01, `/epic-cycle` code-review stage) — APPROVED. CLEAN REVIEW: 0 HIGH / 0 MED / 0 decision-needed / 0 patch / 0 defer; 3 LOW dismissed (below). Status review→done.**

All three ACs met with real-runtime evidence, all CRITICAL-focus items independently confirmed, all gates re-run green on this machine (lint 0 / build all 7 + apps/web Vite dist / typecheck 0 / **test 855 passed, 123 files, 0 failed, no `.only`/`.skip`/`.todo`** / format `--check` clean). Suite 798→855 (+57) as stated.

**ACs:**
- **AC1 (on-demand host: node:http + JSON API + static + on-demand) — MET.** `agentbbs ui` → `uiCommand` → `runUi` → `startHost`; `node:http` only (no HTTP-framework dep); JSON API is thin read-first (validate slug → core read op → snake_case wire); static serving via runtime path resolution (`resolveWebDist`: `AGENTBBS_WEB_DIST` override else pnpm-workspace.yaml walk-up to `apps/web/dist`) — NOT a workspace import; nothing auto-starts (`createHost`/`startHost` are pure factories, only `ui.ts` calls `startHost`).
- **AC2 (SSE deltas via maxSeq poll) — MET.** Single shared poller polls `dataAccess.maxSeq()`, on advance reads `eventsSince(lastSent)`, writes `id:`/`data:` frames; seeds high-water-mark to live `maxSeq` on start (no back-history flood); advances per delivered seq (delta-not-resend); interval `unref`'d, cleared on last-disconnect + `close()`.
- **AC3 (real integration) — MET, genuinely real (Rule 1 + Rule 3).** `host.integration.test.ts` binds `startHost` to a REAL `createDataAccess` better-sqlite3 temp ledger, seeds via real core writes, GETs `/api/directory` over real `fetch`, asserts real ledger-derived state; then opens the SSE channel as a raw `text/event-stream` HTTP stream (Node 24 has no global `EventSource` — confirmed), appends an out-of-band core write, and asserts the delta frame carries that event's `seq`. Nothing mocked.

**CRITICAL-focus confirmations:**
- **MODULE BOUNDARY (NFR2) — CONFIRMED.** Host imports `@agentbbs/core` + `@agentbbs/data-access` only (no board logic); web client imports `@agentbbs/ui-shared` only (+ the published `tokens.css` subpath) — never core/data-access/SQL; no cli↔apps/web workspace dep (static assets served by path resolution). Structural guard (`on-demand.nfr.test.ts`) enforces it; reviewer independently planted a forbidden `@agentbbs/ui-shared` token in `host/index.ts` and confirmed the NFR2 boundary test goes RED, then reverted. ESLint edits are minimal + justified, NOT a boundary weakening: (1) a minimatch negation glob exempting the two PUBLISHED ui-shared CSS subpaths from the barrel-only deep-import ban (they are declared public `exports` entry points, not internal TS deep paths); (2) `main.tsx` ignored by the `.tsx` PascalCase rule (conventional Vite app-entry filename, mirrors the existing `.config.js` exemption).
- **SSE CORRECTNESS — CONFIRMED.** Robustness suite covers multi-client broadcast, no-back-history-flood for a late client, exactly-once (no resend on later ticks), rapid-append ordering (seq ASC), one-disconnect-keeps-others-alive, and `close()` ends all + clears the poller. Mutation non-vacuity (Rule 7) reproduced by reviewer: defeating the seed (`lastSentSeq = max` → `= 0`) turns BOTH `sse.test.ts`'s "pre-existing NOT resent" AND the robustness "no-flood" tests RED; reverted byte-identically and re-confirmed 9/9 green. (Production source is all NEW over baseline 11b9fb7, so "byte-identical revert" = the untracked file restored to its reviewed content + tests green.)
- **NFR4 ON-DEMAND — CONFIRMED + guard non-vacuous.** No source in core/data-access/mcp-server imports the cli host or `@agentbbs/cli`; `on-demand.nfr.nonvacuous.test.ts` proves the collector finds real files (non-empty, named host modules present) and the guard regexes fire on planted offending lines — so the no-match assertions are not vacuous.
- **NFR5 framing — CONFIRMED.** `sse.ts` / `api-client.ts` / `App.tsx` headers correctly frame SSE as the host→operator-browser live view (the operator's own chosen view), explicitly NOT an agent push; agents stay pull-only via `check`; no agent path touches the host code.
- **JSON API — CONFIRMED.** `BoardError` → HTTP status mapping over the closed code set (404 for `*_NOT_FOUND`/`LOGIN_UNKNOWN`, 401 `NO_IDENTITY`, 403 `NOT_A_MEMBER`, 413 `BODY_TOO_LARGE`, 409 `HANDLE_TAKEN`/`PROJECT_EXISTS`, 400 default; malformed-slug → 400); wire shapes mirror `docs/mcp-tool-contract.md` §3. Drift guard (`wire.contract-drift.test.ts`) pins the host mapper field sets to the doc (boundary-safe — reads the doc, does not import mcp-server); mutation non-vacuity (Rule 10) reproduced by reviewer: renaming `project_id`→`projectId` in `wire.ts` turns it RED, then reverted. Write endpoints NOT built — only a documented `{ method:'POST', pattern, handler }` extension seam comment (the 9.6/9.7 slot); confirmed zero POST/PUT/DELETE routes.

**LOW (dismissed — noise / out-of-AC-scope, no deferred-work entry):**
- 405 responses on the SSE path / static path carry `code: 'NOT_FOUND'` (server.ts) — cosmetically a 405 returning a NOT_FOUND code is slightly inconsistent, but the behavior (reject non-GET) is correct, it touches no closed-code-set guarantee, and no AC concerns method-not-allowed shaping in 9.3. Dismissed as cosmetic.
- `parseUiArgs` accepts `--db=` (empty → `dbPath: ''`, bypassing `resolveDbPath`) and `--port=` (empty → port 0). Operator-typo-only edge, not AC-relevant; the surface is two flags. Dismissed.
- `on-demand.nfr.nonvacuous.test.ts` re-declares the guard's regexes (local consts in the guard, not exported) rather than importing them. Inherent to the structural-guard pattern; the nonvacuous test still proves the pattern-shape fires on planted lines. Dismissed.

Adversarial pass (reviewer, three lenses): correctness — 0; edge cases — 0 unhandled (the robustness + drift + nonvacuity QA tests close the gaps the dev's happy-path tests left); acceptance — 0 AC violations. Rule 1 satisfied (real producer→consumer integration), Rule 3 satisfied (real HTTP/SSE + DOM render of the shell), Rule 4 re-verified (core barrel symbols + signatures `boardDirectory`/`readContract`/`readRoom`/`listProjects`/`listRooms`/`listAnnouncements` confirmed; `readContract` returns `RoomMessage | null` as the handler assumes), Rule 5 honest (NFR2/4/5 implementable as worded, no amendment), Rule 6 N/A (no `docs/adr`), Rule 7 + Rule 10 mutation-verified non-vacuous, Rule 8 satisfied (all 9 host tests + apps/web tests default-suite-discoverable; `App.test.tsx` runs once under happy-dom, `api-client.test.ts` under node). No new deferred items. Left UNCOMMITTED (incl. no dist) for the lead's post-CR smoke gate.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, `/epic-cycle` dev stage).

### Debug Log References

- Honest gate (final, exact counts): `pnpm run lint` → 0 errors; `pnpm run build` → all 7 buildable workspace projects + `apps/web` (Vite emits `dist/`); `pnpm run typecheck` → 0; `pnpm test` → **841 passed / 120 files** (baseline 709 → +132; no `.only`/`.skip`/`.todo`); `pnpm run format --check` → clean.
- Mutation test (Rule 7) of the load-bearing SSE delta semantic: temporarily seeded the poller high-water-mark to `0` instead of the live `maxSeq` (so a pre-existing event WOULD be re-sent) → `sse.test.ts`'s "pre-existing event NOT resent" assertion went RED (1 failed). Reverted byte-identically (`git diff` empty) → 4 passed. The delta-not-full-resend test discriminates; it is not vacuous.
- Real-runtime manual smoke (built host): `startHost` over a real `:memory:` ledger seeded via core writes → `GET /api/directory` returns the real project; `GET /` serves the built `apps/web/dist/index.html` (status 200, `text/html`) referencing the hashed asset bundle. The full UI→JSON-API→core→data-access + static-serving pipe works against the built artifacts.

### Completion Notes List

- **Host package home = `packages/cli`** (the recommended home; no blocker). The host (HTTP thin client over core, the analogue of the stdio mcp-server) lives at `packages/cli/src/host/*` and serves `apps/web`'s built static assets by **runtime path resolution** (`resolveWebDist`: `AGENTBBS_WEB_DIST` override, else monorepo-root walk-up to `<root>/apps/web/dist`). **No cli↔apps/web workspace dependency** — `apps/web` is a pure client. NFR2 boundary clean (structurally tested).
- **`node:http` only** — no HTTP-framework dependency added (routing is a small table; SSE is a held-open response; static serving is a contained file read). Research-First confirmed Vite 8 / `@vitejs/plugin-react` 6 config shape is the standard `defineConfig({ plugins: [react()] })` (default `build.outDir: dist`), and that **Node 24.16 has NO global `EventSource`** (verified — the AC3 SSE test reads the raw `text/event-stream` stream and parses frames; `fetch`/`Response`/`ReadableStream` ARE globals and are used).
- **JSON API is read-first**: `/api/directory` + `/api/projects` (alias), `/api/projects/:id/members`, `/api/projects/:id/announcements`, `/api/projects/:id/rooms`, `/api/rooms/:id`, `/api/rooms/:id/contract` — each THIN (validate slug → core read op → snake_case wire mirroring the MCP tool-contract envelopes). The `ROUTES` table is the documented **extension seam** for the Stories 9.6/9.7 WRITE endpoints (a `{ method:'POST', pattern, handler }` entry); **no write endpoints built**. BoardError → HTTP status + `{ code, message }` (the closed contract on a new transport).
- **SSE = host→operator-browser live view (NFR5)** — explicitly framed in `sse.ts` / `api-client.ts` comments: this is the operator's OWN chosen live view, NOT an agent push (agents stay pull-only via `check`; no agent path imports the host — structurally tested). One shared poller per host: polls `maxSeq()`, on advance reads `eventsSince(lastSent)`, writes `data:` frames (delta-not-full-resend; seeds to "now" on start so connecting does not flood back-history); interval + sockets cleaned up on last-disconnect and on `close()`.
- **`agentbbs ui` subcommand**: `packages/cli/src/index.ts` now has a subcommand dispatch table (the Epic 11 export/import seam) + the `ui` entry; `ui.ts` parses `--port`/`--db` (else `AGENTBBS_DB`/project-root discovery via `resolveDbPath`), starts the host, prints the URL + the "on-demand, not a daemon" notice, and wires SIGINT/SIGTERM → graceful shutdown. Root `package.json` `ui` script now builds apps/web + cli then runs the host; added `ui:dev` (Vite dev server) and documented the built-vs-dev flow in the script + comments.
- **apps/web is now a real Vite+React SPA** (replacing the Story-1.1 `tsc` marker; the `WEB_APP` marker + placeholder `index.ts` removed, none referenced elsewhere). It is the **first cross-package consumer of `@agentbbs/ui-shared`** (mounts `TokenProbe`) and imports `@agentbbs/ui-shared/tokens.css` (the published asset subpath). The shell fetches `/api/directory` + renders the project list, opens an `EventSource` to `/api/events` + folds deltas — proving the pipe (the rich tree/thread/live-UI ride on it in 9.4/9.5/9.9). The client speaks ONLY the JSON API + SSE — never core/data-access/SQL (structurally tested).
- **Build-graph wiring**: `apps/web` build is `vite build` (emits static `dist/`); it participates in `pnpm -r build`. The aggregate `tsconfig.typecheck.json` already globs `apps/*/src/**/*.{ts,tsx}` (apps/web is typechecked); added `apps/web/src/vite-env.d.ts` (`/// <reference types="vite/client" />`) so the CSS side-effect import resolves. Vitest: the node project EXCLUDES `apps/web/src/**/*.test.tsx` and the `ui-shared-dom` (happy-dom) project INCLUDES it — so `App.test.tsx` runs under DOM exactly once (Rule 8 discoverable). Pure-node `api-client.test.ts` runs in the node project.
- **ESLint config (2 minimal, surfaced edits)**: (1) the barrel-only deep-import ban (`@agentbbs/*/*`) now NEGATES the two PUBLISHED ui-shared asset subpaths (`tokens.css`/`markdown.css`) — they are intended public entry points (Story 9.1), not internal TS deep paths; apps/web is their first runtime consumer. (2) The `.tsx` PascalCase filename rule now ignores `main.tsx` (the conventional Vite app-entry filename — it mounts the root, it is not a component module; mirrors the existing `.config.js` exemption). Both are non-weakening, narrowly scoped.

**NFR tripwire (Rule 5):** none. NFR2/NFR4/NFR5 were all implementable as worded; no planning artifact needed amending.

### File List

**Added (apps/web — real Vite+React SPA):**
- `apps/web/index.html`
- `apps/web/vite.config.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/api-client.ts`
- `apps/web/src/vite-env.d.ts`
- `apps/web/src/api-client.test.ts`
- `apps/web/src/App.test.tsx`

**Added (cli host + ui):**
- `packages/cli/src/host/wire.ts`
- `packages/cli/src/host/json-api.ts`
- `packages/cli/src/host/sse.ts`
- `packages/cli/src/host/static-assets.ts`
- `packages/cli/src/host/server.ts`
- `packages/cli/src/host/index.ts`
- `packages/cli/src/ui.ts`
- `packages/cli/src/host/host.integration.test.ts`
- `packages/cli/src/host/json-api.test.ts`
- `packages/cli/src/host/sse.test.ts`
- `packages/cli/src/host/static-assets.test.ts`
- `packages/cli/src/host/wire.test.ts`
- `packages/cli/src/host/on-demand.nfr.test.ts`
- `packages/cli/src/ui.test.ts`

**Modified:**
- `apps/web/package.json` (Vite app: react/react-dom/@vitejs/plugin-react/vite deps; `vite build` script; dropped the library `exports`)
- `apps/web/tsconfig.json` (React noEmit typecheck config — jsx/DOM lib; no longer a `tsc -b` target)
- `packages/cli/src/index.ts` (subcommand dispatch + `ui` entry + bin guard)
- `package.json` (`ui` script → build apps/web + cli then run host; added `ui:dev`)
- `eslint.config.js` (allow published ui-shared CSS subpaths; ignore `main.tsx` in PascalCase rule)
- `vitest.config.ts` (route `apps/web/src/**/*.test.tsx` into the happy-dom project; exclude from node)
- `pnpm-lock.yaml` (apps/web deps materialized)

**Removed:**
- `apps/web/src/index.ts` (the Story-1.1 `WEB_APP` placeholder marker — superseded by the real app)

### Change Log

- 2026-06-01 — Story 9.3 implemented: on-demand web host (`agentbbs ui`) in `packages/cli` — thin read-first JSON API mirroring core read ops + SSE-over-MAX(seq)-poll (host→operator-browser live view, NFR5) + static serving of the built `apps/web` client by runtime path resolution (no workspace import); the `apps/web` Vite+React client scaffold (first cross-package consumer of `@agentbbs/ui-shared`); the `agentbbs ui` CLI subcommand + dispatch seam; AC3 real-stack integration proof (HTTP + SQLite + SSE delta on out-of-band core write) + unit/contract/NFR4-structural tests. Gate green: lint 0, build all + apps/web, typecheck 0, 841 tests passed (+132), format clean. SSE delta semantic mutation-tested non-vacuous.
