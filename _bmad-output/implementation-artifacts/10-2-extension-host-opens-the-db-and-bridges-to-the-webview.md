---
baseline_commit: 5a64408
---

# Story 10.2: Extension host opens the DB and bridges to the webview

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the extension,
I want the extension host to open the shared SQLite ledger via the `data-access` package and expose a `postMessage` bridge to its webview(s) that mirrors core operations,
so that the same shared core powers the editor surface with no second backend and no board logic in the client (NFR2/Rule 13).

## Acceptance Criteria

1. **(AC1 — host opens the shared DB via data-access)** Given the activated extension, when it starts, then the extension host opens the shared SQLite ledger **through the `@agentbbs/data-access` package** (reusing the SAME path discovery the MCP server + web host use — `AGENTBBS_DB` override / project-root walk-up via `resolveDbPath`), and a read against it (e.g. `boardDirectory`/`listProjects`) returns the real seeded ledger state — opened in the **VS Code extension-host (Electron) runtime**, not standalone Node.

2. **(AC2 — postMessage bridge mirroring core operations)** Given the host and a webview, when the webview issues a request over a typed `postMessage` request/response channel, then the host invokes the corresponding **core operation through the data-access handle** and posts the result back; the bridge mirrors the board's core ops (the read surface the tree + room views need — `boardDirectory`/`listProjects`/`listRooms`/`listAnnouncements`/`readRoom`/`readContract` — AND the write-op request/response pattern proven with at least `reply`), AND the host polls `MAX(seq)` on a short interval and pushes new-event deltas to the webview (host→webview only). **No board logic lives in the extension layer** (it composes core ops; it never reimplements a fold/gate), and **the agent-facing pull-only contract is never crossed** (the bridge is a host→its-own-webview push, NOT an agent push; agents keep `check`).

3. **(AC3 — node:sqlite driver proven in the real Electron host, GATING)** Given the no-MSVC-toolchain reality that makes a better-sqlite3 source rebuild brittle here (Story 10.1), when the extension host opens the DB, then it does so via a **node:sqlite-backed `DataAccess` implementation** behind the existing NFR2 seam, AND that path is proven in the **real VS Code 1.122.1 Extension Development Host** (a real-host test confirms `node:sqlite` is exposed there, opens the ledger, and the adapter satisfies the `DataAccess` port). The existing **better-sqlite3 path stays byte-identical** (the MCP server / agent backend is NOT destabilized to serve the client).

## Integration ACs

This story is the first DB-opening CONSUMER of the Story-10.1 driver-load proof, and it introduces TWO consumable surfaces (the node:sqlite `DataAccess` adapter + the postMessage bridge). AC1 + AC2 ARE the integration ACs: AC1 wires the host→data-access→real-ledger read (observable: real seeded state returned in the Electron host); AC2 wires the webview→bridge→core-op→response round-trip (observable: a webview request yields the real core result + a `MAX(seq)` delta lands). The next consumers are **Story 10.3** (native TreeView consumes the bridge's read surface + the delta poll) and **Story 10.4** (WebviewPanels consume the bridge to render rooms). Per Rule 1, the producer→consumer wire-up is real and named, not nominal.

## Tasks / Subtasks

- [x] **Task 1 — GATING probe: node:sqlite in the real VS Code 1.122.1 Electron host (AC3)**
  - [x] Stand up the real-host test harness: add `@vscode/test-electron` (dev) and a test entry that launches an extension host (prefer the INSTALLED VS Code 1.122.1 at `C:\Program Files\Microsoft VS Code\Code.exe` via `@vscode/test-electron`'s ability to use an existing install, else let it download a pinned build) and runs an in-host test. → `host-tests/run-host-tests.cjs` + `probe-node-sqlite.in-host.cjs`; downloads/launches the host (the stock `Code.exe` cannot be driven directly — see Debug Log; pins `AGENTBBS_VSCODE_VERSION=1.122.1`).
  - [x] In that real extension host, PROBE + RECORD: `process.versions.electron`, `process.versions.modules` (the host ABI), and whether `require('node:sqlite')` resolves AND can open `:memory:` + `SELECT sqlite_version()`. → **electron 39.8.8 / ABI 140 / Node 22.22.1 / node:sqlite RESOLVED / sqlite 3.51.2 — GATE PASSED**, did NOT fall back.
  - [x] Record the empirical host ABI/electron/node:sqlite-availability findings in the Dev Agent Record (Rule 3: real-runtime evidence, not web-claimed).
- [x] **Task 2 — node:sqlite-backed DataAccess adapter behind the NFR2 seam (AC3)**
  - [x] Add a node:sqlite implementation of the `@agentbbs/core` `DataAccess` port INSIDE `@agentbbs/data-access`. Satisfies the SAME port + `close()`, SAME schema/migration (`SCHEMA_SQL`/`CURSORS_TABLE`), WAL + busy_timeout, atomic `appendGuarded` in one `BEGIN IMMEDIATE` txn (FR1), seq-ASC. Sibling factory `createDataAccessNodeSqlite(options)` → `DataAccessHandle`.
  - [x] **Preferred factoring (a):** parallel node:sqlite module set (`src/node-sqlite/`) reusing the driver-agnostic `SCHEMA_SQL`/`mapping.ts`/`errors.ts`/`path.ts` + a node:sqlite-specific prepare/run/get/all/transaction layer. better-sqlite3 source BYTE-IDENTICAL (`git diff` empty). node:sqlite connection declares tunables/options LOCALLY so better-sqlite3 is never dragged into the host bundle.
  - [x] node:sqlite API verified against the INSTALLED `@types/node` + the live host probe (Rule 3): `DatabaseSync`/`prepare`/`get`/`all`/`run`/`exec`; transactions via explicit `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`; busy_timeout via `PRAGMA` (portable to the host's Node 22). Deltas recorded in the Dev Agent Record.
  - [x] **Contract parity:** 14 tests mirror the better-sqlite3 contract (append monotonic seq, appendGuarded conflict, eventsSince/byType/byActor ordering, maxSeq, cursors UPSERT) + a genuine forked 8-process cross-process race (Rule 5: exactly 1 winner, 7 HANDLE_TAKEN, 1 event) + Rule-7 mutation-test (non-vacuous).
- [x] **Task 3 — Extension host opens the DB (AC1)**
  - [x] `apps/vscode-extension/src/db.ts#openLedger` opens via `createDataAccessNodeSqlite` + `resolveDbPath` on `activate`; `deactivate` closes it. Thin client (Rule 13): imports `@agentbbs/data-access` + `@agentbbs/core` only, never a driver directly.
  - [x] Proved a real read returns seeded state IN THE HOST — the in-host ledger probe (`open-ledger.in-host.ts`) seeded a project via core `announceProject` and read it back via `listProjects` (`in-host-probe-project`, seq 2) inside VS Code 1.122.1.
- [x] **Task 4 — postMessage bridge mirroring core ops (AC2)**
  - [x] `apps/vscode-extension/src/bridge.ts`: typed `{id,op,args}`→`{id,ok,result|error}` over a transport-agnostic `Messaging` seam. READ surface wired (`listProjects`/`boardDirectory`/`listRooms`/`listAnnouncements`/`readRoom`/`readContract`); WRITE pattern established with `reply`. Remaining writes NAMED deferred-to-consumer (10.3–10.6), not dropped.
  - [x] MAX(seq) delta poll: short-interval `maxSeq()` → `eventsSince(lastSent)` → push host→webview only; interval `unref()`'d + cleared on `dispose()` (mirrors the web SSE lifecycle).
  - [x] **Rule 13 / contract:** every affordance maps to an EXISTING core op (no fabricated op, no backdoor); no agent-facing push (NFR5 pull-only — structural: only the local webview channel is touched). 9.13-trim discipline applied to `reply` (whitespace-only body rejected host-side). `git diff HEAD -- packages/core packages/mcp-server` EMPTY.
- [x] **Task 5 — Tests discoverable by the default suite (Rule 8) + real-host smoke harness**
  - [x] node:sqlite adapter contract + race tests run under the root `pnpm test` (1236 passed).
  - [x] Bridge request/response + delta-poll covered by `bridge.test.ts` (fake messaging channel + real in-memory node:sqlite data-access handle).
  - [x] The real-host node:sqlite + host-opens-DB proof runs via `@vscode/test-electron`, invoked by `pnpm --filter @agentbbs/vscode-extension test:host` (separate from the headless default suite, but runnable + run — verified green end-to-end).
- [x] **Task 6 — Record decisions (AC3, Rule 3/8)** — Dev Agent Record carries the empirical host findings, the adapter factoring + better-sqlite3 byte-identical proof, the bridge op surface (wired vs deferred), and the `test:host` smoke invocation.

## Dev Notes

### Driver decision (ratified at the Epic-10 gate — read before Task 2)
The extension host uses a **node:sqlite-backed `DataAccess` adapter**, NOT better-sqlite3, because (Story 10.1 + the lead's Epic-10 environment probe): this machine has **no MSVC C++ build tools** (`vswhere` finds no `VC.Tools.x86.x64`), so an `electron-rebuild` of better-sqlite3 from source is brittle/impossible here, and better-sqlite3 v12 ships **no Electron-ABI prebuilds** (its prebuilds target Node). The architecture's RATIFIED design names node:sqlite as the EXPLICIT fallback "if prebuilds prove brittle" (architecture.md l.210–212, l.727–729) — that trigger condition is met, so this is invoking the documented fallback, **not contradicting the design** (Rule 8). The node:sqlite path needs no native toolchain, ships with Electron's embedded Node, and uses the NFR2 swap seam exactly as intended. This RESOLVES the Story-10.1 code-review MED downstream-risk item. **The MCP server / agent backend keeps better-sqlite3 unchanged** — only the VS Code extension host uses the node:sqlite adapter.

### The gating risk (Task 1 is FIRST for a reason)
node:sqlite's availability in **VS Code 1.122.1's Electron host** is NOT yet verified — Story 10.1 only proved node:sqlite in standalone Node 24. Electron can restrict/omit built-in modules, and its embedded Node version may differ. So Task 1 PROBES the real host before any adapter work. If node:sqlite is absent there, BOTH drivers are blocked on this machine → STOP and surface (Rule 8 / the "environment failure" + "user-preference" pause triggers). Do not build the adapter against an unverified host assumption.

### DataAccess port (what the adapter must satisfy)
[Source: packages/core/src/ports.ts] The port is ASYNC (Promise-returning) — the node:sqlite impl (sync internally, like better-sqlite3) conforms by returning resolved Promises. Methods: `append`, `appendGuarded(events, guards)` (atomic check-then-insert in ONE write txn — FR1), `eventsSince(cursor)`, `eventsByType`, `eventsByActor`, `maxSeq`, `getCursor`, `setCursor`, all `seq`-ascending. [Source: packages/data-access/src/data-access.ts] `createDataAccess`/`fromConnection` is the better-sqlite3 composition precedent; mirror its shape for the node:sqlite factory. Schema/migration: `SCHEMA_SQL`, `CURSORS_TABLE`, `migrate` (reuse the driver-agnostic SQL).

### Host + bridge precedent (mirror, don't reinvent)
[Source: packages/cli/src/ui.ts + packages/cli/src/host/] The web host opens the DB via `createDataAccess({dbPath})` (path discovery via `resolveDbPath`, AGENTBBS_DB / walk-up) and mirrors core ops (`boardDirectory`/`listProjects`/`listRooms`/`listAnnouncements`/`readRoom`/`readContract`/`reply`/`react`/`unreact`/`joinBoard`/`updateFocus`/`announceProject`/`postAnnouncement`/`addParticipant`) over an HTTP JSON API, with an SSE `MAX(seq)`-poll delta push. The VS Code bridge is the SAME pattern with `postMessage` instead of HTTP/SSE. [Source: architecture.md l.233–234, l.285–286, l.563] `bridge.ts` = `postMessage ⇄ webview; MAX(seq) poll → push`. Wire shapes should match the ratified MCP/host contract (the web host's `wire.ts` pins them to `docs/mcp-tool-contract.md` §3) — reuse core's types; do NOT invent new wire field casings.

### Module boundary / Rule 13 (LOAD-BEARING)
- The extension imports `@agentbbs/data-access` + `@agentbbs/core` + (later) `@agentbbs/ui-shared` ONLY — never a SQLite driver directly. [Source: architecture.md l.197–202, l.409, l.589]
- The agent-facing contract (core types, MCP wire, `BOARD_ERROR_CODES`, the 10 event types) stays byte-identical — verify `git diff HEAD -- packages/core packages/mcp-server` is EMPTY (this story adds a data-access ADAPTER + an apps/vscode-extension client; it must not touch core/mcp). The node:sqlite adapter is a new data-access impl, not a core/contract change.
- NFR5 pull-only: the bridge is host→its-own-webview. Add NO agent-facing push. Structurally confirm no agent path is touched.

### node:sqlite specifics (Rule 3 — verify against the installed runtime + node docs)
Node 24's `node:sqlite` exposes `DatabaseSync` (synchronous). Verify the exact API against the installed Node 24.16.0 + the official node:sqlite docs pinned to Node 24 (constructor options, `prepare`, statement `.get`/`.all`/`.run`, `.exec`, transaction handling, busy/locking behavior, the stability flag). Story 10.1 already proved `new DatabaseSync(':memory:')` + `SELECT sqlite_version()` works in standalone Node (sqlite 3.53.0). Confirm WAL + busy_timeout can be set via `PRAGMA` `exec` the same way the better-sqlite3 connection does. Record any delta from the better-sqlite3 API in the Dev Agent Record.

### Real-host smoke (`@vscode/test-electron`)
The genuine Electron-host evidence (Rule 12) comes from running an in-host test via `@vscode/test-electron`. VS Code 1.122.1 is installed at `C:\Program Files\Microsoft VS Code\` (Code.exe; product commit 8761a5560c). Prefer driving that installed build; else `@vscode/test-electron` downloads a pinned VS Code. This harness is the smoke mechanism for the rest of Epic 10 too. The default `pnpm test` may stay headless-fast; if the real-host test is a separate script, it MUST still be run (at minimum at the lead smoke) — never let runtime-only behavior pass on a stub (Rule 12).

### Testing standards / baseline
[Source: project-rules.md Rules 5, 7, 8, 12, 13] Canonical gate = ROOT `pnpm test` (not per-package). Mutation-test the load-bearing adapter semantics (append monotonicity / appendGuarded atomicity) non-vacuous (Rule 7). A concurrency-claiming AC needs a genuine forked cross-process race (Rule 5) — assess whether the node:sqlite adapter's atomic-write guarantee needs its own forked race (mirror `data-access/src/register-race.test.ts`). Baseline entering 10.2: 1212 tests (1 known Windows teardown flake in `seed-protocol-race.test.ts`, item E10-baseline-seedrace-eperm — NOT yours; Rule 6).

### Project Structure Notes
- New: a node:sqlite module set under `packages/data-access/src/` (e.g. `node-sqlite/`) + its factory in the barrel; `apps/vscode-extension/src/bridge.ts`; host DB-open wiring in `extension.ts`/`db.ts`; the `@vscode/test-electron` harness + dev dep + catalog entry.
- Keep the existing better-sqlite3 source untouched (verify via `git diff`).
- Add `@vscode/test-electron` to `pnpm-workspace.yaml` catalog (verify the installable version on the registry).

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 10 / Story 10.2]
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions (l.210–212, 228–234), #VS Code surface (l.285–286), #source tree (l.553–566), #Risks (l.727–729)]
- [Source: packages/core/src/ports.ts (DataAccess port); packages/data-access/src/data-access.ts + index.ts (composition + barrel); packages/cli/src/ui.ts + host/ (host-open + op-mirror precedent)]
- [Source: _bmad-output/implementation-artifacts/10-1-...md (Story 10.1 — driver-load proof, node:sqlite fallback, no-MSVC finding); deferred-work.md (Story 10.1 review: MED 10.2 driver downstream-risk — resolved by this story's decision)]
- [Source: .claude/rules/project-rules.md Rules 1, 3, 5, 7, 8, 12, 13; research-first.md]

## Dev Agent Record

### Agent Model Used
claude-opus-4-8[1m] (Opus 4.8, 1M context) — bmad-dev-story.

### Debug Log References

**Task 1 — GATING node:sqlite-in-host probe (PASSED).** Empirical evidence read OUT-OF-BAND from the REAL VS Code 1.122.1 Extension Development Host (via `@vscode/test-electron`, host downloaded + cached under `.vscode-test/`):
- `process.versions.electron = 39.8.8`
- `process.versions.modules = 140` (host ABI — **differs from standalone Node 24's ABI 137**; the host runs **Node 22.22.1** embedded in Electron 39, NOT Node 24)
- `require('node:sqlite')` **resolved**; `new DatabaseSync(':memory:')` + `SELECT sqlite_version()` → **3.51.2**; host exited code 0.
→ **GATE SATISFIED**: node:sqlite IS exposed + usable in VS Code 1.122.1's Electron host. Adapter work proceeded.

**Real-host harness — three hard-won facts (the `@vscode/test-electron` bring-up):**
1. Pointing `vscodeExecutablePath` at the stock installed `C:\Program Files\Microsoft VS Code\Code.exe` fails — the stable product launcher does not accept the internal test-CLI flags.
2. The TRUE cause of `Code.exe: bad option: --no-sandbox` / exit 9 (even on a clean download, nothing running) was **`ELECTRON_RUN_AS_NODE=1` inherited from the surrounding VS Code session** (this dev agent runs inside VS Code's extension host). With that env var set, the spawned `Code.exe` runs AS PLAIN NODE and treats every flag as a node/script arg. Fix: the runner spawns the host with a CLEANED env that strips `ELECTRON_RUN_AS_NODE` + all `VSCODE_*`/`ELECTRON_*` vars. (Node-24's `child_process` `shell:true`+`args` DEP0190 mangling was a red herring; we still spawn with `shell:false` + direct `downloadAndUnzipVSCode` for correctness.)
3. A downloaded **stable** test build collides with the running stable instance via the single-instance lock (CLI forwarding); pinning `AGENTBBS_VSCODE_VERSION=1.122.1` works when no stable instance is running, and the default `insiders` runs concurrently with the dev's stable editor. The harness defaults to `insiders`; the AC1/AC3 evidence above was captured against the exact **1.122.1** build.

**`@vscode/test-electron` API (Rule 3, verified against installed 2.5.2 `out/runTest.d.ts`):** `runTests({ vscodeExecutablePath?, version?, extensionDevelopmentPath, extensionTestsPath, extensionTestsEnv?, launchArgs? }): Promise<number>` (exit code); `extensionTestsPath` → a module exporting `run(): Promise<void>` the host calls. We use `downloadAndUnzipVSCode(version)` + a direct `shell:false` spawn (cleaned env) instead of `runTests` to defeat the env-contamination issue.

**node:sqlite API (Rule 3, verified against installed `@types/node/sqlite.d.ts` AND the live host probe):** `new DatabaseSync(path, opts?)`; `.exec(sql)` (DDL/PRAGMA/txn); `.prepare(sql)` → `StatementSync` with `.get(...p)`/`.all(...p)`/`.run(...p)`; `.run()` → `{ changes, lastInsertRowid }` (`number` with default `readBigInts:false`, matching better-sqlite3 safe-integers-OFF — INTEGER→number, TEXT→string, NULL→null); `.close()`. **DELTAS from better-sqlite3:** (a) NO `db.transaction(fn)` wrapper → transactions via explicit `exec('BEGIN IMMEDIATE')`/`COMMIT`/`ROLLBACK` (see `node-sqlite/tx.ts`); (b) NO `db.pragma()` helper → PRAGMAs via `exec('PRAGMA …')` (set) + `prepare('PRAGMA …').get()` (read-back); (c) `busy_timeout` set via `PRAGMA busy_timeout` (portable to the host's Node 22; the constructor `{ timeout }` option only exists since Node 24). Everything else (prepared-statement reuse, `?` binding, `json_extract` guard, INTEGER PRIMARY KEY AUTOINCREMENT `seq`) is identical.

**Rule 7 mutation-test (node:sqlite marquee semantics, non-vacuous, reverted byte-identically):**
- Atomicity: changed `tx.ts` to `COMMIT` instead of `ROLLBACK` on error → the "rolls back the ENTIRE batch" test went RED (1 failed). Reverted → green.
- appendGuarded conflict: short-circuited the guard `if (false && hit…)` → the 3 conflict/HANDLE_TAKEN tests went RED. Reverted → green. `git diff` on both files empty after revert; full suite green.

### Completion Notes List
- ✅ **AC3 GATE** — node:sqlite proven in the REAL VS Code 1.122.1 Electron host (electron 39.8.8 / Node 22.22.1 / ABI 140 / sqlite 3.51.2), via `@vscode/test-electron`. Real-runtime evidence (Rule 12), not a stub.
- ✅ **AC3 adapter** — `createDataAccessNodeSqlite` (+ `fromNodeSqliteConnection`, `openNodeSqliteDatabase`, `migrateNodeSqlite`) added INSIDE `@agentbbs/data-access` as a parallel module set (`src/node-sqlite/`) reusing the driver-agnostic `SCHEMA_SQL`/`mapping.ts`/`errors.ts`/`path.ts`. Satisfies the IDENTICAL `DataAccess` port; WAL + busy_timeout=5000; `appendGuarded` atomic check-then-insert in ONE `BEGIN IMMEDIATE` txn (FR1); reads seq-ASC; cursors UPSERT. 14 contract-parity tests + a forked 8-process cross-process race (exactly 1 winner, 7 HANDLE_TAKEN, 1 event — Rule 5) + Rule-7 mutation-test, all green.
- ✅ **better-sqlite3 path BYTE-IDENTICAL** — `git diff HEAD -- packages/data-access/src/sqlite packages/data-access/src/data-access.ts mapping.ts errors.ts path.ts` is EMPTY; the agent/MCP backend is not destabilized. The node:sqlite connection declares its OWN tunables/options-type LOCALLY (does NOT import `../sqlite/connection.ts`) so the better-sqlite3 native addon is never dragged into the extension-host bundle.
- ✅ **AC1 host opens DB** — `apps/vscode-extension/src/db.ts#openLedger` opens via `createDataAccessNodeSqlite` + `resolveDbPath` (AGENTBBS_DB / project-root walk-up — the SAME discovery the MCP server + web host use); `extension.ts` opens on `activate`, closes on `deactivate`. Proven in the real host: the in-host ledger probe seeded a project via core `announceProject` and read it back via `listProjects` (`in-host-probe-project`, seq 2).
- ✅ **AC2 bridge** — `apps/vscode-extension/src/bridge.ts`: typed `{id,op,args}`→`{id,ok,result|error}` over a transport-agnostic `Messaging` seam (testable with a fake channel + a real in-memory data-access handle; bindable to a VS Code `Webview` in 10.4). READ surface wired: `listProjects`/`boardDirectory`/`listRooms`/`listAnnouncements`/`readRoom`/`readContract`. WRITE pattern established with `reply` (with 9.13-trim discipline — whitespace-only body → host-surface `BAD_REQUEST`, nothing persists). MAX(seq) delta poll pushes new events host→webview only (NFR5 pull-only preserved; no agent push path added). The remaining writes (react/unreact/joinBoard/updateFocus/announceProject/postAnnouncement/addParticipant) are NAMED deferred-to-consumer (Epic-10 stories 10.3–10.6), NOT fabricated. 9 bridge tests green.
- ✅ **Rule 13** — extension imports `@agentbbs/data-access` + `@agentbbs/core` ONLY (never a SQLite driver directly); production bundle (`dist/extension.cjs`) contains ZERO `require("better-sqlite3")` (tree-shaken via `"sideEffects": false` on data-access — the package has no module-load side effects) and the node:sqlite adapter inlined. `git diff HEAD -- packages/core packages/mcp-server` EMPTY (agent contract byte-identical). Host-surface `BridgeError` (`BAD_REQUEST`/`INTERNAL_ERROR`) kept OUT of core's closed `BoardError` set (mirrors the web host's `HostApiError`).
- ✅ **Gate** — full `pnpm run build` green (all packages); canonical root `pnpm test` = **1236 passed** (baseline 1212 + 24 new); `pnpm run lint` clean. Real-host smoke runnable via `pnpm --filter @agentbbs/vscode-extension test:host`.
- **Design decision (host-surface error codes, Rule 13):** the bridge introduces `BridgeError` for host-detected conditions (`BAD_REQUEST`, `INTERNAL_ERROR`) rather than adding codes to core's closed `BoardError` set — exactly the web host's `HostApiError` precedent. The agent-facing closed error contract stays byte-identical.
- **Design decision (real-host harness location):** the `@vscode/test-electron` harness lives under `apps/vscode-extension/host-tests/` (NOT `src/`) so it is NOT collected by the headless root `pnpm test` (it launches a 250 MB Electron download). It is a separate, runnable, documented script (`test:host`) — runtime-only behavior is still verified (the lead runs it at the per-story smoke), never opted out (Rule 8/12).

### File List
**Added (production):**
- packages/data-access/src/node-sqlite/connection.ts
- packages/data-access/src/node-sqlite/tx.ts
- packages/data-access/src/node-sqlite/migrate.ts
- packages/data-access/src/node-sqlite/data-access-node-sqlite.ts
- apps/vscode-extension/src/db.ts
- apps/vscode-extension/src/bridge.ts

**Added (tests / real-host harness):**
- packages/data-access/src/node-sqlite/data-access-node-sqlite.test.ts
- packages/data-access/src/node-sqlite-register-race-worker.ts
- packages/data-access/src/node-sqlite-register-race.test.ts
- apps/vscode-extension/src/bridge.test.ts
- apps/vscode-extension/host-tests/probe-node-sqlite.in-host.cjs
- apps/vscode-extension/host-tests/open-ledger.in-host.ts
- apps/vscode-extension/host-tests/build-host-tests.cjs
- apps/vscode-extension/host-tests/run-host-tests.cjs

**Modified:**
- packages/data-access/src/index.ts (barrel: node:sqlite exports)
- packages/data-access/package.json ("sideEffects": false)
- apps/vscode-extension/src/extension.ts (open ledger on activate / close on deactivate)
- apps/vscode-extension/src/abi-proof.test.ts (isolate activate() DB to :memory:)
- apps/vscode-extension/src/bundle-and-activation.test.ts (isolate activate() DB to :memory:)
- apps/vscode-extension/package.json (deps: @agentbbs/core, @vscode/test-electron; scripts: build:host-tests, test:host)
- pnpm-workspace.yaml (catalog: @vscode/test-electron)
- eslint.config.js (ignore .vscode-test/; node-globals + CommonJS for host-tests/*.cjs)
- .gitignore (.vscode-test/)
- _bmad-output/implementation-artifacts/sprint-status.yaml (10-2 → in-progress→review)

## Review Findings (code review, 2026-06-02)

**Outcome: APPROVED with 1 MED auto-resolved inline. Gate green (ROOT `pnpm test` = 1248 passed / 146 files), real-host smoke independently re-run GREEN.**

Reviewer: bmad-code-review (Opus 4.8, 1M). Adversarial layers + the brief's specific scrutiny applied. Rules verified: 1, 3, 5, 7, 12, 13 (Rule 6 N/A — no `docs/adr`).

### Verified (no action)
- **AC3 / Rule 3 / Rule 12 (real-runtime):** Independently re-ran `pnpm --filter @agentbbs/vscode-extension test:host` — BOTH in-host probes GREEN (exit 0): the node:sqlite GATE probe + the AC1 host-opens-ledger probe (host opened the ledger via `createDataAccessNodeSqlite`, read back the seeded `in-host-probe-project` seq 2). Ran on the harness-default `insiders` build — electron 42.2.0 / ABI 146 / node 24.15.0 / sqlite 3.51.3 — confirming node:sqlite + the adapter work across a SECOND host ABI in addition to the story's pinned 1.122.1 (ABI 140). Genuine real-runtime evidence, not a stub. The `@vscode/test-electron` 2.5.2 + node:sqlite APIs are verified against installed defs; the env-strip (ELECTRON_RUN_AS_NODE / VSCODE_* / ELECTRON_*) is sound + documented.
- **Adapter parity (the brief's marquee scrutiny):** The node:sqlite adapter is a faithful mirror of the better-sqlite3 path — same prepared statements, same `json_extract` guard probe, same `BEGIN IMMEDIATE` atomicity (via `tx.ts`), same seq-ASC reads (no txn/retry on pure reads, matching the precedent), same `toSeq` MAX_SAFE_INTEGER guard, same cursors UPSERT, same `BUSY_TIMEOUT_MS=5000`/`MAX_WRITE_ATTEMPTS=3`. Import-graph isolation is correct (declares tunables LOCALLY; never imports `../sqlite/*`) so the native addon is never dragged into the bundle. No behavioral drift that would bite a future swap.
- **Rule 5 (concurrency AC):** `node-sqlite-register-race.test.ts` is a GENUINE forked 8-process race (built worker, IPC start-barrier, shared ledger) proving exactly-1-winner / 7-HANDLE_TAKEN / `registeredCount===1` — the atomic check-then-insert read-side derivation across processes. Not sequential.
- **Rule 7 (mutation, re-confirmed by reviewer):** node:sqlite `tx.ts` ROLLBACK→COMMIT-on-error → atomicity test RED (`expected 1 to be 0`); bridge 9.13-trim guard defeated (`if (false && …)`) → whitespace-reject test RED (`ok` true≠false). Both reverted byte-identical; gate green after.
- **Rule 13 (thin client, LOAD-BEARING):** `git diff HEAD -- packages/core packages/mcp-server` EMPTY; the entire better-sqlite3 data-access source byte-identical; the extension imports no driver directly; the bridge maps every affordance to an EXISTING core op (no fabricated op, no backdoor); NO agent-facing push (NFR5 pull-only — only the local webview channel touched); `BridgeError` kept out of core's closed set. Production bundle (`dist/extension.cjs`) re-built by the reviewer: contains `require("node:sqlite")` + `DatabaseSync`, ZERO `require("better-sqlite3")` / no `*.node` (the lone "better-sqlite3" token is a tree-shaken JSDoc comment string, not a require).
- **9.13-trim carry applied:** the `reply` write trims host-side and rejects a whitespace-only body before core (covered + mutation-confirmed).

### MED-1 (RESOLVED inline) — delta-poll exactly-once divergence from the web-SSE precedent
The bridge poll advanced `lastSentSeq` (and stamped the delta frame's `maxSeq`) to the PRE-READ `maxSeq()` snapshot rather than the last PUSHED event's seq. An event committing between the tick's `maxSeq()` and `eventsSince()` reads would be pushed but leave the mark below it → the next tick re-pushes it (a DUPLICATE delta), and the frame's `maxSeq` understates its own events. The ratified web SSE poller (`sse.ts`) advances to `event.seq` and has no such gap. The dev's de-dup test covered idle ticks + the no-overlap advance, not this intra-tick race, so it passed green. **Fix:** advance to the batch high-water (`events[events.length-1].seq`) for both the frame `maxSeq` and `lastSentSeq`, mirroring the SSE precedent. Added a non-vacuous regression test (`bridge.qa.test.ts` — "exactly-once under the read race"): mutation-confirmed RED on the old `=max` advance (`Set size 2 ≠ length 3`), GREEN with the fix. Operator-view-only, narrow window → MED. Full details in `deferred-work.md` (code review of story 10.2).

### Named-deferred (by design, not dropped)
Remaining bridge WRITE ops (react/unreact/joinBoard/updateFocus/announceProject/postAnnouncement/addParticipant) → Epic-10 stories 10.3–10.6, named in `bridge.ts` + recorded in `deferred-work.md`. `updateFocus` must carry the same trim discipline when wired.
