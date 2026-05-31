---
story_id: "1.4"
story_key: "1-4-sqlite-connection-concurrency-mode-and-db-discovery"
epic: 1
baseline_commit: "ccdb6703f3504b0149f1514f9af8311842c409eb"
---

# Story 1.4: SQLite connection, concurrency mode, and DB discovery

Status: done

## Story

As a developer,
I want `data-access` to open the shared SQLite file in WAL mode with busy-timeout + retry and discover the DB path correctly,
so that multiple processes can safely share one ledger without an always-on daemon.

## Acceptance Criteria

**AC1 — Discovery + WAL + busy-timeout**
**Given** no DB exists yet,
**When** the connection module opens the database,
**Then** it resolves the path to `<project-root>/.agentbbs/agentbbs.db` by walking up from CWD, honoring an `AGENTBBS_DB` override, and creates `.agentbbs/` on first run,
**And** the connection enables WAL mode and sets a bounded `busy_timeout` (~5s).

**AC2 — Busy retry + typed exhaustion error**
**Given** a writer encounters `SQLITE_BUSY`,
**When** it retries within the timeout window,
**Then** the write succeeds on a subsequent attempt rather than failing immediately,
**And** sustained contention past the bounded retry surfaces a clear, typed error (the documented signal to graduate to the HTTP backend).

## Integration ACs

This story introduces the `data-access` **connection + path-discovery** modules — the first `better-sqlite3`-backed code and the substrate the rest of the seam builds on. Per skill-rules Rule 1:

- **No external consumer ships in this story**, but the deliverable is directly exercised: a real-runtime test opens an actual SQLite file via `better-sqlite3`, asserts `journal_mode=wal` and the `busy_timeout` pragma, asserts path discovery (walk-up + `AGENTBBS_DB` override + `.agentbbs/` creation), and asserts the busy-retry resolves a real lock and the exhaustion path throws the typed error. **First consumers:** Story 1.5 (`migrate.ts`/`append.ts` use this connection), Story 1.6 (`queries.ts`), Story 1.7 (the multi-process N×M concurrency proof drives this retry path under real contention).

## Consumed-by

- Story 1.5 — Append-only events table (migration + transactional append open via this connection).
- Story 1.6 — Read-query path (queries run on this connection).
- Story 1.7 — Multi-process concurrency verification (stresses WAL + busy-timeout + retry under real contention).

## Tasks / Subtasks

- [x] **Task 1: Add better-sqlite3 (native dep)** (AC: 1)
  - [x] Add `better-sqlite3` as a dependency of the `data-access` package, referencing the catalog version declared in Story 1.1 (verify/update the catalog pin to a current version via Research-First). This is the ONLY package allowed to depend on better-sqlite3 (import-boundary lint enforces it).
  - [x] better-sqlite3 is a NATIVE module; pnpm 11.3 blocks unapproved postinstall builds (`ERR_PNPM_IGNORED_BUILDS`, as seen with `unrs-resolver` in Story 1.2). Add `better-sqlite3` to the `allowBuilds` (a.k.a. approved-builds) list in `pnpm-workspace.yaml` so `pnpm install --frozen-lockfile` builds it and exits 0. Verify the native addon loads at runtime (`node -e "require('better-sqlite3')"` or an equivalent ESM check).
- [x] **Task 2: DB path discovery** (AC: 1)
  - [x] `packages/data-access/src/path.ts`: resolve the DB path. Order: (1) if `AGENTBBS_DB` env var is set, use it verbatim (override); (2) else walk UP from CWD to the project root and use `<project-root>/.agentbbs/agentbbs.db`. Define "project root" deterministically — RESEARCH/DECIDE: walk up until a `pnpm-workspace.yaml` (or `.git`) marker is found, falling back to CWD if no marker; document the chosen rule. If walking up finds an existing `.agentbbs/` dir, prefer it. Create the `.agentbbs/` directory on first run if absent (recursive mkdir). `.agentbbs/` is already git-ignored (.gitignore from Story 1.1).
  - [x] Pure path resolution should be unit-testable without opening a DB (inject CWD / env for tests).
- [x] **Task 3: Connection + WAL + busy-timeout + retry** (AC: 1, 2)
  - [x] `packages/data-access/src/sqlite/connection.ts`: open the better-sqlite3 database at the resolved path; set `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = <~5000ms>` (make the timeout a documented constant). Confirm pragmas took effect (read them back).
  - [x] Implement bounded retry on `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT` for write operations: a helper that retries the write within the timeout window (better-sqlite3's `busy_timeout` handles intra-call waiting; add an explicit bounded-retry wrapper for the cases it surfaces as `SQLITE_BUSY`). On sustained contention past the bound, throw a clear, TYPED error (see decision below) — not a raw better-sqlite3 error.
  - [x] **DECISION — exhaustion error type:** surface contention exhaustion as a typed error clients can map (architecture: "the documented signal to graduate to the HTTP backend"). Either (a) a `data-access`-local typed error class (e.g. `StoreBusyError`) that clients map at their boundary, or (b) an additive `BoardError` code in core (e.g. `STORE_BUSY`/`DB_BUSY`) — additive to the closed set is allowed. Pick one, document the rationale, keep it consistent with the uniform `{code,message}` error model. Do NOT leak a raw `SQLITE_BUSY` exception past the seam. **→ Chose (a): `StoreBusyError` in `data-access/src/errors.ts`. Rationale in Dev Agent Record + the file header.**
- [x] **Task 4: Tests + gates** (AC: 1, 2)
  - [x] Co-located `*.test.ts` (Vitest, discoverable): real-runtime tests using a temp dir / temp DB file —
    - path discovery: `AGENTBBS_DB` override wins; walk-up resolves to `<root>/.agentbbs/agentbbs.db`; `.agentbbs/` created on first run.
    - connection: opening a fresh DB yields `journal_mode=wal` and the expected `busy_timeout`.
    - retry: induce a real `SQLITE_BUSY` (e.g. hold a write transaction on a second connection) and assert the retried write SUCCEEDS within the window; and that exhausting the bound throws the TYPED error (not a raw better-sqlite3 error).
  - [x] Clean up temp files; never write into the repo's real `.agentbbs/`.
  - [x] Run `pnpm -r build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test` — all exit 0.

## Dev Notes

### Scope boundary (read first)
This story delivers ONLY the connection plumbing: native dep wiring, path discovery, WAL + busy_timeout + bounded retry, and the typed exhaustion error. **Out of scope:** the `events` table schema + migration + the transactional append (Story 1.5), read queries + the snake_case⇄camelCase mapping (Story 1.6), the multi-process N×M concurrency proof (Story 1.7), and any `core` domain logic. Do NOT create the events schema here. Do NOT implement the full `DataAccess` interface yet — this story stands up the connection module the later stories build the implementation on.

### Authoritative facts [Source: project-context.md; architecture.md]
- **Concurrency (NFR3/AR4):** WAL mode + `busy_timeout` (~5s) + bounded retry on `SQLITE_BUSY`; each tool call wraps its append(s) in one transaction; never hold a transaction across I/O; reads need no transaction. SQLite single-writer serialization is what makes `seq` a correct total order — add NO extra coordination. [Source: project-context.md#SQLite concurrency; architecture.md#Data Architecture / Process Patterns]
- **DB discovery (AR6):** default `<project-root>/.agentbbs/agentbbs.db`, discovered by walking up from CWD; `AGENTBBS_DB` env var overrides; `.agentbbs/` is git-ignored, created on first run. [Source: project-context.md#Development workflow; architecture.md#Data Architecture / DB location]
- **Driver:** better-sqlite3 (synchronous). ONLY `data-access` imports it (import-boundary lint). [Source: project-context.md#Technology Stack; architecture.md#Driver]
- **Exhaustion = documented graduation signal:** sustained contention past the bounded retry is the documented signal to graduate to the V2 HTTP backend (NFR2) — surface it as a clear typed error, don't swallow it. [Source: architecture.md#Data Architecture / Concurrency]

### Existing contracts to honor [from Story 1.3, ccdb670]
- `core` exposes `BoardError` + `BoardErrorCode` (closed, additively-extensible) and the async `DataAccess` interface. If you choose the additive-`BoardError`-code route for the exhaustion error, add it in `core/errors.ts` (this is the allowed additive change) and import it in data-access via the `@agentbbs/core` barrel.
- `data-access` may depend on `@agentbbs/core` (barrel only). It must NOT be imported BY core.

### Native build note (pnpm 11.3)
Per Story 1.2's experience, pnpm 11.3 refuses to run a dependency's install scripts unless approved (`allowBuilds`/approved-builds in `pnpm-workspace.yaml`). `better-sqlite3` compiles a native addon on install — it MUST be in that allow-list or `pnpm install`/CI will warn/fail and the addon won't be built. CI (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile` on Linux — confirm better-sqlite3 builds there (prebuild or node-gyp); the VS-Code-Electron ABI concern (AR2) is a LATER story (10.1), NOT this one — here it's plain Node 24.

### Research-First [Source: .claude/rules/research-first.md]
Verify against authoritative docs before coding: current `better-sqlite3` version + ESM import usage under Node 24; exact pragma syntax + how better-sqlite3 surfaces `SQLITE_BUSY` (error `.code`) and how `busy_timeout` interacts with an explicit retry wrapper; pnpm 11.3 approved-builds config key name. Don't rely on stale memory.

### Testing standards [Source: project-context.md#Testing]
Vitest, co-located `*.test.ts`. These are real-runtime tests (a genuine SQLite file via better-sqlite3) — appropriate library-level evidence (Rule 3). Use OS temp dirs; never touch the repo's real `.agentbbs/`. Tests must be discoverable by the default `pnpm test` (Rule 8) and typecheck-clean (the Story 1.3 typecheck gate covers `*.test.ts`).

### Project Structure Notes
- Files: `packages/data-access/src/path.ts`, `packages/data-access/src/sqlite/connection.ts`, co-located tests, and barrel updates in `packages/data-access/src/index.ts` (replace the Story 1.1 placeholder). Paths per architecture.md#Complete Project Directory Structure.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4: SQLite connection, concurrency mode, and DB discovery]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture (the Ledger) / The Data-Access Seam / Complete Project Directory Structure]
- [Source: _bmad-output/project-context.md#SQLite concurrency / Development workflow / Technology Stack]
- [Source: .claude/rules/research-first.md]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — `bmad-dev-story` under `/epic-cycle`.

### Debug Log References

Research-First (Perplexity MCP) before coding:
- **better-sqlite3 v12 + Node 24 ESM:** default import `import Database from 'better-sqlite3'`, then `new Database(path)` (CJS module → synthetic default export; `esModuleInterop: true` already set in tsconfig.base). `SQLITE_BUSY` surfaces as a synchronous throw of `SqliteError` whose `.code === 'SQLITE_BUSY'`. `PRAGMA busy_timeout = N` (ms) makes a single call block-and-retry internally for up to N ms before throwing; an explicit whole-call retry wrapper stacks on top (worst case ≈ N × attempts). Pragmas: `db.pragma('journal_mode = WAL', { simple: true })` returns `'wal'`; `db.pragma('busy_timeout = 5000')`; read back with the `{ simple: true }` form. `busy_timeout` is per-connection (not persisted) → set on every open; WAL persists in the file.
- **pnpm 11.3 approved-builds key:** Perplexity was inconclusive (feature newer than its sources), so verified against ground truth IN-REPO — Story 1.2 already uses `allowBuilds:` in `pnpm-workspace.yaml` for `unrs-resolver` and that install passes CI. Used the same `allowBuilds:` key. Confirmed `pnpm install` (exit 0, "Done" native build) and `pnpm install --frozen-lockfile` (exit 0) both build better-sqlite3; CI uses the identical frozen-lockfile invocation on ubuntu-latest + Node 24, and the dep is in the allow-list, so the native addon builds on Linux too.
- **Catalog pins verified current (npm, 2026-05-30):** `better-sqlite3 ^12.10.0` (latest = 12.10.0) and `@types/better-sqlite3 ^7.6.13` (latest = 7.6.13). No catalog change needed.
- **Runtime load check:** `node --input-type=module -e "import Database from 'better-sqlite3'; new Database(':memory:')…"` → exit 0, addon loads.

Gate results (all exit 0, after a `format:write` pass on the three new files):
- `pnpm -r build` → 0 (all 7 buildable packages Done)
- `pnpm run typecheck` → 0 (src + co-located *.test.ts)
- `pnpm run lint` → 0
- `pnpm test` → 0 (8 files, 52 tests; 14 new in data-access)
- `pnpm run format` → 0 (clean)

### Completion Notes List

- **Scope honored:** connection plumbing ONLY — native dep wiring, `path.ts` discovery, `connection.ts` (WAL + busy_timeout + bounded retry), and the typed exhaustion error. No events schema/migration/append (1.5), no read queries/mapping (1.6), no N×M concurrency proof (1.7), no core domain logic. The `DataAccess` interface is NOT implemented yet (deliberately deferred).
- **DECISION — exhaustion error type → option (a): a data-access-local `StoreBusyError`** (in `packages/data-access/src/errors.ts`), NOT an additive `BoardError` code. Rationale: `BoardError`'s closed code set is a versioned PUBLIC WIRE contract of board-DOMAIN semantics (`HANDLE_TAKEN`, `ROOM_NOT_FOUND`, …); store-busy is an INFRASTRUCTURE/operational signal ("graduate to the V2 HTTP backend", NFR2), not a domain validation result — freezing it into the public domain code set would conflate the storage substrate's operational signal with the board's vocabulary. core throws `BoardError`; data-access sits below core behind the seam, so a local typed error keeps layering clean and lets core/clients map at their boundary. It still satisfies the contract: a clear, typed error (`instanceof StoreBusyError`, stable `code: 'STORE_BUSY'`, `attempts`, `cause`) — never a raw better-sqlite3 `SqliteError` past the seam.
- **Project-root rule (documented in `path.ts`):** walking up from the start dir, the first dir matching ANY marker wins, by priority: (a) an existing `.agentbbs/` dir (an initialised ledger wins → nested CWD reuses it); (b) `pnpm-workspace.yaml`; (c) `.git`. No marker up to the filesystem root → fall back to the START dir (never `/`).
- **Real-runtime tests (Rule 3 evidence):** open genuine SQLite files via better-sqlite3 in `os.tmpdir()` (never the repo's real `.agentbbs/`; temp trees removed in `afterEach`). A REAL `SQLITE_BUSY` is induced via a second connection holding `BEGIN IMMEDIATE` with `busy_timeout=0` — one test proves the retried write SUCCEEDS within the bound (lock released between attempts), another proves exhausting the bound throws the TYPED `StoreBusyError` (asserting `code='STORE_BUSY'`, `attempts=3`, and `cause.code='SQLITE_BUSY'`), and a third proves a non-busy error propagates unwrapped. Path-discovery tests assert the `AGENTBBS_DB` override, walk-up resolution, existing-`.agentbbs/` preference, no-marker fallback, and `.agentbbs/` creation on first run.
- **Rule 5 (NFR tripwire):** none triggered — NFR3/AR4 (WAL + busy_timeout + bounded retry) is implementable exactly as worded; no planning-artifact amendment needed.
- **Rule 6 (ADRs):** `docs/adr/` does not exist — confirmed absent; no ADR constraints to honor.
- **Native ABI note (AR2):** the VS-Code/Electron ABI-matched prebuild concern is Story 10.1, explicitly out of scope here — this story is plain Node 24.
- **NOT committed:** all changes left uncommitted per epic-cycle directive (lead commits after the smoke gate).

### File List

- pnpm-workspace.yaml (modified — added `better-sqlite3: true` to `allowBuilds`)
- pnpm-lock.yaml (modified — better-sqlite3 + transitive deps)
- packages/data-access/package.json (modified — `better-sqlite3` dep + `@types/better-sqlite3` devDep, both `catalog:`)
- packages/data-access/src/index.ts (modified — barrel now exports path discovery, connection, and StoreBusyError)
- packages/data-access/src/path.ts (new — DB path discovery, AR6)
- packages/data-access/src/errors.ts (new — `StoreBusyError` typed exhaustion error)
- packages/data-access/src/sqlite/connection.ts (new — WAL + busy_timeout + bounded retry)
- packages/data-access/src/path.test.ts (new — path-discovery tests)
- packages/data-access/src/sqlite/connection.test.ts (new — real-runtime connection + busy-retry tests)

### Change Log

- 2026-05-30 — Story 1.4 implemented: better-sqlite3 native dep wired (catalog pin verified current; added to pnpm `allowBuilds`), DB path discovery (`AGENTBBS_DB` override + walk-up + `.agentbbs/` creation), WAL + 5s busy_timeout connection with bounded busy-retry, and the typed `StoreBusyError` exhaustion signal. 14 real-runtime tests added. All gates (build/typecheck/lint/test/format) exit 0. Status → review.

## QA Results

### QA stage — qa-generate-e2e-tests (2026-05-30, claude-opus-4-8[1m])

**Verdict: AC coverage adequate; real-runtime evidence genuine (Rule 3 satisfied); discoverability confirmed (Rule 8). 5 QA tests added to close genuine AC-surface gaps. All gates exit 0.**

**Real-runtime evidence (Rule 3) — verified genuine.** The dev tests open an actual SQLite file via better-sqlite3 in `os.tmpdir()` (never the repo's real `.agentbbs/`), read back `journal_mode=wal` and `busy_timeout=5000`, and induce a REAL `SQLITE_BUSY` via a second connection holding `BEGIN IMMEDIATE` with `busy_timeout=0` — proving retry-success within the bound, typed-`StoreBusyError` exhaustion (asserting `cause.code='SQLITE_BUSY'`, never a raw leak), and unwrapped non-busy propagation. Not mocks.

**Native build (install clean).** `pnpm install --frozen-lockfile` exit 0; the native addon `better_sqlite3.node` is built (`node_modules/.pnpm/better-sqlite3@12.10.0/.../build/Release/better_sqlite3.node`) and loads at runtime from the data-access package context (pragmas exercised, exit 0). Not hoisted to root `node_modules` — correct pnpm isolation (only `data-access` depends on it).

**Discoverability (Rule 8).** Single runner (`vitest run`); root `vitest.config.ts` include glob `packages/*/src/**/*.test.{ts,tsx}` collects all three Story 1.4 files. Default `pnpm test` went 8→9 files / 52→57 tests after the QA file — auto-discovered, not opted out. No second runner introduced.

**QA-added tests (`connection.qa.test.ts`, real-runtime + OS temp dirs) — genuine gaps closed:**
- AC1: `openDatabase()` physically CREATES the absent `.agentbbs/` dir + the `.db` file on first run (the dev's same-named test only read `journal_mode`, never asserted the side-effect at the `openDatabase` boundary).
- AC1: WAL leaves its defining observable artifact on disk — the `<db>-wal` sidecar appears after a write (file-level evidence beyond the pragma read-back).
- AC2: `SQLITE_BUSY_SNAPSHOT` (the other `BUSY_CODES` member) is treated as retryable — retry-success and typed-exhaustion branches, which the dev tests never exercised (they only induced plain `SQLITE_BUSY`).
- AC2: the exported default bound `MAX_WRITE_ATTEMPTS` is the one wired into `runWithRetry` when no `attempts` arg is passed.

**Rule 5 / Rule 6:** no NFR tripwire (WAL+busy_timeout+bounded retry implementable as worded); `docs/adr/` confirmed absent — no ADR constraints. No extra coordination/locking added beyond WAL + busy_timeout (verified in `connection.ts`).

**Gates (all exit 0):** `pnpm install --frozen-lockfile`, `pnpm -r build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (9 files / 57 tests), `pnpm run format`.

## Review Findings

### Code review stage — bmad-code-review (2026-05-31, claude-opus-4-8[1m])

**Verdict: APPROVED. All ACs met, all critical invariants honored, scope discipline clean. Gates re-run independently — all exit 0. 1 LOW finding deferred (no HIGH/MED).**

**Independent gate re-run (not trusting the report):**
- `pnpm install --frozen-lockfile` → 0 ("Already up to date"). Native addon present at `node_modules/.pnpm/better-sqlite3@12.10.0/.../build/Release/better_sqlite3.node`; loads + runs from the data-access package context (`journal_mode`/`busy_timeout` pragmas exercised, exit 0). Correctly NOT hoisted to root `node_modules` — only data-access depends on it.
- `pnpm -r build` → 0 (7 packages Done). `pnpm run typecheck` → 0 (src + `*.test.ts`). `pnpm run lint` → 0. `pnpm test` → 0 (9 files / 57 tests).

**AC1 (discovery + WAL + busy_timeout) — PASS.** `resolveDbPath` honors `AGENTBBS_DB` verbatim (non-empty), else walks up to a marker (`.agentbbs/` > `pnpm-workspace.yaml` > `.git`, documented priority) and returns `<root>/.agentbbs/agentbbs.db`; falls back to start dir (never `/`). `openDatabase` creates `.agentbbs/` recursively on first run, sets `busy_timeout=5000` every open (per-connection), sets WAL on writable opens AND reads it back — fails loud if `journal_mode !== 'wal'` (not just issued, verified). Tests assert the pragma read-backs AND the on-disk side effects (`.agentbbs/` + `.db` created, `-wal` sidecar after a write).

**AC2 (busy retry + typed exhaustion) — PASS.** `runWithRetry` retries `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT` within a BOUNDED `MAX_WRITE_ATTEMPTS` (3) loop, returns on success, and on exhaustion throws the typed `StoreBusyError` (stable `code='STORE_BUSY'`, `attempts`, `cause`) — the raw better-sqlite3 `SqliteError` never escapes the seam. Non-busy errors propagate unwrapped. Real-runtime test induces a GENUINE `SQLITE_BUSY` via a second connection holding `BEGIN IMMEDIATE` with `busy_timeout=0` and proves both the retry-success and typed-exhaustion paths (Rule 3 evidence genuine — not mocked). Bound is finite (no unbounded busy-spin).

**CRITICAL invariant — no extra coordination: PASS.** `connection.ts` contains ONLY WAL + busy_timeout + bounded retry. No mutex, no lockfile, no app-level lock anywhere in the diff. SQLite single-writer serialization remains the sole `seq` total-order mechanism (project-context honored).

**Import boundary — PASS.** `better-sqlite3` is imported only by `packages/data-access/**`. `eslint.config.js` bans it globally (`NO_BETTER_SQLITE3`) and relaxes the ban only under `packages/data-access/**`; lint exit 0 confirms no violation. `allowBuilds` correctly lists `better-sqlite3: true`; frozen-lockfile install builds the addon (and would on Linux CI — same invocation, dep in allow-list).

**Scope discipline — PASS.** No events schema/migration/append (1.5), no read queries/mapping (1.6), no N×M proof (1.7), no core domain logic. The `DataAccess` interface is NOT implemented — only referenced in comments as deferred. Barrel exports only the connection/path/error substrate.

**Error-model consistency — PASS.** `StoreBusyError` faithfully mirrors core's `BoardError` pattern (`Object.setPrototypeOf` guard, `name`, readonly SCREAMING_SNAKE `code`). The decision to keep it data-access-local rather than adding a `BoardError` code is correct and well-rationalized: `BOARD_ERROR_CODES` is a versioned public DOMAIN wire contract; store-busy is an infrastructure/operational signal (NFR2 graduation) that does not belong in the domain code set.

**Rule checks:** Rule 1 (Integration ACs) — adequate; no external consumer this story, future consumers named (1.5/1.6/1.7). Rule 3 (real-runtime) — genuine real SQLite file + induced real lock, present and adequate. Rule 5 (NFR tripwire) — none; NFR3/AR4 implementable as worded, no comment+defer workaround. Rule 6 (ADRs) — `docs/adr/` confirmed absent, no ADR constraints. Rule 8 (discoverability) — all 3 data-access test files (`path.test.ts`, `connection.test.ts`, `connection.qa.test.ts`) run in default `pnpm test` (verified via `vitest run --reporter=verbose`) and are typecheck-clean. No test pollution — repo has no `.agentbbs/` after the suite (all tests use `os.tmpdir()`).

**Findings:**
- **LOW (deferred → Story 1.7):** `runWithRetry` has no inter-attempt backoff; for immediately-surfaced busy errors (`busy_timeout=0` or instant `SQLITE_BUSY_SNAPSHOT`) the 3 attempts fire back-to-back. Behavior is correctly bounded and matches NFR3/AR4 as worded; in production every connection has `busy_timeout=5000` so real contention naturally spaces attempts. Logged in `deferred-work.md` — validate under genuine N×M contention in Story 1.7; add bounded/jittered backoff only if 1.7 surfaces a problem. No code change this story.

No HIGH or MED findings. No files modified beyond tracking docs (story Review Findings + deferred-work.md). Status remains `review` for the lead's smoke gate + commit.
