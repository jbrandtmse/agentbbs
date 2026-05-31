# Test Automation Summary — Story 1.1

**Story:** 1.1 — Scaffold the pnpm workspace and package skeleton
**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA) · 2026-05-30 · branch `AGENTBBS-1-epic1`

## Outcome: NO test files generated (intentional)

Story 1.1 is a **pure build-pipeline / scaffold** story. Per skill-rules **Rule 3**, pure non-user-facing (build-pipeline) stories are **exempt** from real-runtime test artifacts — exemption noted explicitly. There is no UI, CLI command, or API/service surface to exercise; the verification surface is the build gate itself.

No automated test file was created because:
- The project's runner — **Vitest + a single root `vitest.workspace.ts`** — is **explicitly deferred to Story 1.2** and does not exist yet (no `vitest.workspace.ts`, no Vitest dependency, no `*.test.ts`/`*.spec.ts`; root `test` script is a placeholder `echo … exit 0`).
- Per **Rule 8 (test discoverability)**, a test file added now would be undiscoverable by any default suite (HIGH finding on later review), and a second runner would violate the "one root Vitest, packages extend" standard.
- The build-verification regression test (assert `pnpm -r build` exit 0 + emitted `dist/`) is carried forward to **Story 1.2**, once the runner lands.

## Live build-gate verification (QA evidence, in lieu of an artifact test)

### API Tests
- N/A — no API surface in this story.

### E2E Tests
- N/A — no UI surface in this story.

### Build-pipeline gate (executed live by QA)
- [x] `pnpm install --frozen-lockfile` — exit 0; single root `pnpm-lock.yaml`, no per-package lockfiles (AC1).
- [x] `pnpm -r build` — exit 0; 7 of 8 projects compile via `tsc -b` in topological order (root orchestrator excluded) (AC2).
- [x] Emitted barrel is genuine strict ESM — `export const CORE_PACKAGE = …` in `packages/core/dist/index.js` (AC2).
- [x] `dist/` / build artifacts git-ignored — clean working tree, no `dist/` in `git status`.

## Coverage
- API endpoints: 0/0 (none in scope).
- UI features: 0/0 (none in scope).
- Build-pipeline ACs (AC1, AC2): 2/2 verified live; 0 automated regression artifacts (runner deferred to 1.2).

## Next Steps
- Story 1.2: stand up the single root `vitest.workspace.ts`, add Vitest, wire the root `test` script, then add a discoverable build-gate / install-gate verification test there.
- Code review: approve the Rule-3 build-pipeline exemption; confirm no orphan test or second runner was introduced.

---

# Test Automation Summary — Story 1.2

**Story:** 1.2 — Shared toolchain and boundary enforcement
**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA) · 2026-05-30 · branch `AGENTBBS-1-epic1`
**Framework:** Vitest 4.1.7 (project's existing runner, now live).

## Rule 3 exemption (noted)

Internal-tooling / build-pipeline story (lint, format, test runner, CI) — exempt from
user-facing real-runtime test evidence; there is no runtime service. The deliverable
(the lint rules) IS directly testable and is exercised via the ESLint Node API in a
discoverable Vitest suite, which is the correct verification surface here.

## Test file

- `packages/core/src/boundary-enforcement.test.ts` — single discoverable suite that
  runs the repo's real flat config (`eslint.config.js`) programmatically against
  inline snippets and asserts the expected rule IDs fire / do not fire. Matched by the
  root `vitest.config.ts` `projects` include glob `packages/*/src/**/*.test.{ts,tsx}`
  (Rule 8: runs in the default `pnpm test`; no second runner).

## Coverage (15 tests, all passing)

### Import boundaries (AC1)
- [x] better-sqlite3 import from `core` → rejected
- [x] deep cross-package import (bypassing barrel) → rejected
- [x] `core` importing a client/app package → rejected
- [x] barrel import from `core` → allowed
- [x] better-sqlite3 in `data-access` → allowed
- [x] **(QA-added)** better-sqlite3 from `mcp-server` (non-core, non-data-access) → rejected via the global default rule — proves the "any package other than data-access" clause of AC1

### Append invariant (AC2)
- [x] `UPDATE events` string literal → flagged
- [x] `DELETE FROM events` string literal → flagged
- [x] `ORDER BY created_at` string literal → flagged
- [x] `ORDER BY seq` → allowed
- [x] **(QA-added)** `UPDATE events` template literal → flagged (separate `TemplateElement` selector that the literal tests did not exercise)

### Naming (AC1)
- [x] non-kebab-case `.ts` filename → flagged
- [x] default export from `.ts` → flagged
- [x] **(QA-added)** non-PascalCase `.tsx` filename → flagged
- [x] **(QA-added)** PascalCase `.tsx` default export → allowed (React-component exception; no false positive)

## Gate runs (clean tree, all exit 0)

| Command | Result |
| --- | --- |
| `pnpm test` | Test Files 1 passed (1) · Tests 15 passed (15) |
| `pnpm run lint` (`eslint .`) | no output — clean |
| `pnpm -r build` | 7 packages `tsc -b` Done |
| `pnpm run format` (`prettier --check .`) | all files conform |

## Coverage / outcome
- Import-boundary, append-invariant, and naming rules: all branches (fire + allow) covered.
- No defects found; rules behave exactly per AC, including allow-cases.

## Next Steps
- When real SQL lands in Story 1.4, tighten the append-invariant lint patterns against
  the actual queries and extend this suite with the data-access read/append paths.

---

# Test Automation Summary — Story 1.3

**Story:** 1.3 — Event vocabulary, DataAccess port, and error model
**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA) · 2026-05-30 · branch `AGENTBBS-1-epic1`
**Framework:** Vitest 4.1.7 + TypeScript `tsc --noEmit` (new typecheck gate, see below).

## Rule 3 exemption (noted)

Non-user-facing **core contract** code (event vocabulary, the `DataAccess` interface,
the `BoardError` + code model) — no UI / CLI / API runtime surface. Per skill-rules
Rule 3 the real-runtime requirement does NOT apply; unit + type tests are the correct
verification surface. The dev's 5 co-located suites are the deliverable under QA review.

## Critical finding: type-level assertions were VACUOUS in the default suite (now fixed)

The dev's tests rely heavily on `expectTypeOf(...)` and `@ts-expect-error`. Investigation
confirmed these were **runtime no-ops** in the default gate, providing a false sense of
coverage:

- `tsconfig.base.json` **excludes `**/*.test.ts`** from every package build, so
  `pnpm -r build` (`tsc -b`) never type-checked the test files.
- `pnpm test` (Vitest) transforms via esbuild **without** type-checking and had **no
  `typecheck` runner** configured (`grep typecheck` → no matches).

**Proof:** changing `expectTypeOf(err.code).toEqualTypeOf<BoardErrorCode>()` to
`...<number>()` — a blatantly false assertion — still produced **38 passed, exit 0** under
`pnpm test`. The dev's one-off manual `tsc --noEmit` (cited in the Dev Agent Record) was
never wired into the suite or CI, so it gave no ongoing protection.

This affected one of the four load-bearing guarantees directly:
**(4) every `EventType` has an `EventPayloadMap` entry** is enforced ONLY by the
compile-time `extends Record<EventType, object>` constraint — there is no runtime
registry to assert against — so with no typecheck in the gate, totality was unguarded.

## Fix: wired a real typecheck gate (the minimal, correct closure)

Rather than fabricate runtime equivalents for inherently compile-time guarantees, the
type assertions were made load-bearing by adding a workspace typecheck gate:

- **`tsconfig.typecheck.json`** (new, root) — non-composite `noEmit` pass that type-checks
  ALL `packages/*/src` + `apps/*/src` source **and** `*.test.ts` files (overrides the base
  `exclude` so tests ARE checked; `types: ["node"]` for the Story 1.2 boundary test).
- **`typecheck` script** in root `package.json` → `tsc --noEmit -p tsconfig.typecheck.json`.
- **CI step** "Typecheck (workspace + tests)" added to `.github/workflows/ci.yml` between
  the test and lint gates (hard, non-zero-fails gate).

**Validated the gate genuinely catches regressions** (each reverted after):
- False `expectTypeOf<number>()` → **TS2344**, exit 2.
- Misused `@ts-expect-error` (no error beneath) → **TS2578**, exit 2.
- 11th event type added without a payload → **TS2741** (totality broken), exit 2 — confirms
  guarantee (4) is now enforced.

## Coverage of the four load-bearing guarantees

| # | Guarantee | Coverage kind | Status |
| - | --------- | ------------- | ------ |
| 1 | `EVENT_TYPES` is EXACTLY the 10 values (count + exact membership/order + no dupes + shape) | **Runtime** (`types.test.ts`) | Genuine, solid |
| 2 | `BoardError` throwable/catchable via `instanceof`, exposes `code`+`message` | **Runtime** (`errors.test.ts`) | Genuine, solid |
| 3 | `BOARD_ERROR_CODES` contains the required closed set (×6 `toContain` + no dupes) | **Runtime** (`errors.test.ts`) | Genuine, solid |
| 4 | Every `EventType` has an `EventPayloadMap` entry (totality) | **Compile-time only** (no runtime registry); now enforced by the typecheck gate + a secondary runtime witness cross-check | Now genuinely enforced |

No new test FILES were added — the dev's runtime assertions for (1)–(3) are sound, and (4)
is inherently a type-level property. The gap was the missing *enforcement* of the type
layer, now closed by the typecheck gate. Adding redundant runtime tests would be
gold-plating.

## Gate runs (clean tree, all exit 0)

| Command | Result |
| --- | --- |
| `pnpm test` | Test Files 6 passed (6) · Tests 38 passed (38) |
| `pnpm run typecheck` (NEW) | `tsc --noEmit -p tsconfig.typecheck.json` — exit 0 |
| `pnpm run lint` (`eslint .`) | clean |
| `pnpm -r build` | 7 packages `tsc -b` Done |
| `pnpm run format` (`prettier --check .`) | all files conform |

## Rule 8 (discoverability)

All 6 `*.test.ts` files on disk are picked up by the default `pnpm test` (6 test files
reported), matched by `packages/*/src/**/*.test.{ts,tsx}`. The new typecheck gate covers
the same files plus future ones via its glob. No second test runner introduced.

## Next Steps
- Story 1.4/1.6: when `data-access` implements `DataAccess`, add the producer↔consumer
  integration test (real append → seq, ordered reads) that this contract-only story defers.
- Keep the `typecheck` gate green as new packages add co-located type tests.

---

# Test Automation Summary — Story 1.4

**Story:** 1.4 — SQLite connection, concurrency mode, and DB discovery
**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA) · 2026-05-30 · branch `AGENTBBS-1-epic1`
**Framework:** Vitest 4.1.7 (single root runner) + the Story 1.3 typecheck gate.

## Rule 3 — real-runtime evidence PRESENT and genuine

This is a library with real-runtime behavior (SQLite via better-sqlite3). The dev's
`connection.test.ts` opens a GENUINE SQLite file via better-sqlite3 in `os.tmpdir()`
(never the repo's real `.agentbbs/`), reads back `journal_mode=wal` and
`busy_timeout=5000`, and induces a REAL `SQLITE_BUSY` via a second connection holding
`BEGIN IMMEDIATE` with `busy_timeout=0` — proving (a) the retried write SUCCEEDS within
the bound, (b) exhaustion throws the typed `StoreBusyError` (asserting
`cause.code='SQLITE_BUSY'`, never a raw leak), and (c) a non-busy error propagates
unwrapped. `path.test.ts` exercises discovery on the real filesystem (temp trees).
Not mocks. Rule 3 satisfied.

## Native build (install clean)

`pnpm install --frozen-lockfile` exit 0; the native addon `better_sqlite3.node` is built
(`node_modules/.pnpm/better-sqlite3@12.10.0/.../build/Release/`) and loads at runtime from
the data-access package context (pragmas exercised, exit 0). Correctly NOT hoisted to root
`node_modules` (only `data-access` depends on it — pnpm isolation, lint-enforced).

## Test files

- `packages/data-access/src/path.test.ts` (dev) — 8 path-discovery tests.
- `packages/data-access/src/sqlite/connection.test.ts` (dev) — 6 real-runtime connection
  + busy-retry tests.
- `packages/data-access/src/sqlite/connection.qa.test.ts` (**QA-added**) — 5 tests closing
  genuine AC-surface gaps.

## QA-added coverage (5 tests, all real-runtime / OS temp dirs)

### AC1 — discovery + WAL first-run side effects
- [x] `openDatabase()` physically CREATES the absent `.agentbbs/` dir + the `.db` file on
  first run — the AC1 "created on first run" side-effect at the `openDatabase` boundary
  (the dev's same-named test only read `journal_mode`, never asserted the creation).
- [x] WAL leaves its defining observable artifact on disk — the `<db>-wal` sidecar after a
  write (file-level evidence beyond the pragma read-back).

### AC2 — busy-code branch + default bound
- [x] `SQLITE_BUSY_SNAPSHOT` (the other `BUSY_CODES` member) is treated as retryable →
  retry SUCCEEDS on a later attempt (branch the dev tests never hit — they only induced
  plain `SQLITE_BUSY`).
- [x] sustained `SQLITE_BUSY_SNAPSHOT` exhausts into the typed `StoreBusyError`
  (`cause.code='SQLITE_BUSY_SNAPSHOT'`).
- [x] the exported default bound `MAX_WRITE_ATTEMPTS` is the one wired into `runWithRetry`
  when no `attempts` arg is passed.

## No extra coordination added (NFR3/AR4 verified)

`connection.ts` adds NOTHING beyond WAL + `busy_timeout` + the bounded whole-call retry —
no app-level locks, mutexes, or coordination that would undermine SQLite's single-writer
serialization (the property that makes `seq` a correct total order). Confirmed by reading
the module.

## Rule 5 / Rule 6

No NFR tripwire (WAL + busy_timeout + bounded retry implementable exactly as worded).
`docs/adr/` confirmed absent — no ADR constraints to honor.

## Gate runs (clean tree, all exit 0)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0; better-sqlite3 native addon built + loads |
| `pnpm test` | Test Files 9 passed (9) · Tests 57 passed (57) (was 8/52 before the QA file) |
| `pnpm run typecheck` | `tsc --noEmit -p tsconfig.typecheck.json` — exit 0 (covers `*.test.ts`) |
| `pnpm run lint` (`eslint .`) | clean |
| `pnpm -r build` | 7 packages `tsc -b` Done |
| `pnpm run format` (`prettier --check .`) | all files conform |

## Rule 8 (discoverability)

Single runner. Root `vitest.config.ts` include glob `packages/*/src/**/*.test.{ts,tsx}`
collects all three Story 1.4 files; the default `pnpm test` went 8→9 files / 52→57 tests
after the QA file was added — auto-discovered, not opted out. No second runner introduced.

## Next Steps
- Story 1.5: producer-side append/migration uses this connection — add the
  append→`seq` ordering integration test there.
- Story 1.7: the multi-process N×M concurrency proof drives this retry path under real
  cross-process contention (the dev's intra-process `SQLITE_BUSY` induction is the
  library-level proxy until then).

# Test Automation Summary — Story 1.6

**Story:** 1.6 — Read-query path and wire/internal mapping
**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA) · 2026-05-30 · branch `AGENTBBS-1-epic1`

## Outcome: 2 real-runtime gap tests added; CI format gate fixed

The dev suite already covered AC1 (seq-ordered camelCase reads, single mapping boundary)
and AC2 (core depends only on the port, lint-guarded), plus the maxSeq empty sentinel,
the `eventsSince(k)` seq>k boundary, filtered reads, and the composed `createDataAccess`
end-to-end. Two genuine gaps were found and closed (Rule 3 real-runtime, Rule 8
discoverable, temp DBs under `os.tmpdir()` only):

### `packages/data-access/src/sqlite/queries.test.ts` (extended)

- **Ordering by `seq`, never `created_at`** — inserts rows (raw connection, real schema)
  with strictly DESCENDING `created_at` while `seq` ascends, then reads through the
  composed `fromConnection` DataAccess and asserts `eventsSince`/`eventsByType` return
  seq-ascending. Pins THE APPEND INVARIANT at the runtime, not just the lint guard.
- **All-10-type real-runtime write→read round-trip** — appends one event of every
  closed-vocabulary type through real SQLite; asserts each camelCase payload survives,
  no snake_case key surfaces, each type is independently retrievable via `eventsByType`,
  and the multi-word keys (`project_id`/`current_focus`/`message_seq`) are snake_case on
  disk via a raw read-only connection.

## Gates (all exit 0)

- `pnpm -r build` — 7/7 Done
- `pnpm run typecheck` — clean
- `pnpm run lint` — clean
- `pnpm test` — **97 passed** (was 95; +2)
- `pnpm run format` — clean

## CI format gate — fixed

`pnpm run format` (`prettier --check .`) was RED on entry: three Story 1.5 files
(`append.qa.test.ts`, `append.test.ts`, `migrate.test.ts`) were dirty (prettier's
`.get() as { n: number }` brace-wrap). The dev had flagged these as "pre-existing
warnings"; since CI enforces `--check`, they were CI-breaking. Ran `pnpm run format:write`
(touched exactly those 3 files + the new `queries.test.ts`). Before: 3 dirty, exit 1.
After: "All matched files use Prettier code style!", exit 0.

## Next Steps
- Story 1.7: the multi-process N×M concurrency proof drives this append→read round-trip
  under real cross-process contention to prove total-order agreement across readers.

---

# Test Automation Summary — Story 1.7

**Story:** 1.7 — Multi-process concurrency verification (the correctness gate, NFR3/NFR10)
**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA) · 2026-05-31 · branch `AGENTBBS-1-epic1`
**Framework:** Vitest 4.1.7 (single root runner) + the typecheck gate.

## Outcome: deliverable-as-test verified GENUINE + STRICT; cleanup hardened (no assertion changed)

This story's deliverable IS the test. Per the directive, QA did NOT author a new
concurrency test (no redundant second test/runner) — it verified the existing one is
real and its assertions would fail on a defect, ran a non-flake battery, and closed one
genuine hygiene gap.

## Files under test (dev deliverable)

- `packages/data-access/src/concurrency-worker.ts` — forked per-writer worker (built to
  `dist`); opens the shared DB via real `createDataAccess` and appends M events through
  the real `append` path; IPC ready/go start barrier; AC2 lock-hold device.
- `packages/data-access/src/concurrency.test.ts` — orchestrator. AC1: N×M (6×100=600)
  concurrent appends from REAL OS processes; AC2: induced `BEGIN IMMEDIATE` contention.

## Genuineness (Rule 3 — strongest in the project; confirmed)

- Real OS processes via `child_process.fork` of the BUILT `dist/concurrency-worker.js`
  (NOT `worker_threads`) → genuine cross-process WAL + busy_timeout.
- Full real seam traced: `append` → `runWithRetry` → `appendBatch.immediate` (BEGIN
  IMMEDIATE write lock) → read-back via `eventsSince(0)` (`ORDER BY seq ASC`). No stubs.
- Assertions fail on defect: exact count (=600), strict `seq[i] > seq[i-1]`, uniqueness
  (`Set(seqs).size === 600`), and full marker-set EQUALITY (`toEqual` over the expected
  600) — a lost write breaks equality + count, a duplicate breaks the dedup count. A
  second independent reader must fold the identical seq + marker order.
- AC2 is genuinely contended: writer 0 holds a real lock 150ms post-barrier blocking the
  other 5; asserts `busyErrors === 0` (1.4 retry resolved every contended write) and
  slowest contending append > `LOCK_HOLD_MS * 0.3` (busy path provably traversed). An
  escaped `StoreBusyError` rethrows → worker non-zero exit → hard fail (never swallowed).

## Reliability + hygiene (Rule 8)

- 22 consecutive concurrency-test runs this session (12 + 5 + 5): ALL green.
- Zero orphan node processes (stable 33). Zero leftover temp dirs from QA runs.
- Discoverable in default `pnpm test` (root Vitest include glob; 99 passed / 15 files) and
  in CI (`.github/workflows/ci.yml` build→test→typecheck→lint→format).
- Build-if-missing verified: deleted `dist/concurrency-worker.js`, ran ONLY the test →
  rebuilt via `tsc -b --force` and passed 2/2 from clean dist.

## Hardening applied (cleanup ONLY — no assertion touched)

One PRE-EXISTING orphan temp dir (from before this QA session) had intact `-wal`/`-shm`
sidecars — evidence of a rare Windows EBUSY/EPERM handle-release race: `reapChildren()`
issues an async SIGKILL, so a just-killed worker can still hold the WAL handle when
`rmSync` runs. Added `removeTempTree()` wrapping `rmSync` with `maxRetries: 20,
retryDelay: 50` (linear backoff, retried on EBUSY/EPERM/ENOTEMPTY per Node fs docs;
active with `recursive: true`). Both cleanup call sites now use it.

## Gate runs (after hardening, all exit 0)

| Command | Result |
| --- | --- |
| `pnpm -r build` | 7 packages `tsc -b` Done |
| `pnpm run typecheck` | `tsc --noEmit -p tsconfig.typecheck.json` — clean |
| `pnpm run lint` (`eslint .`) | clean |
| `pnpm test` | Test Files 15 passed (15) · Tests 99 passed (99) |
| `pnpm run format` (`prettier --check .`) | all files conform |

## Rule 5 / Rule 6

No NFR/correctness tripwire — assertions are strict and all pass; ledger impl (1.4–1.6)
untouched. `docs/adr/` confirmed absent — no ADR constraints.

## Next Steps
- None for this story. The correctness gate passes; deliverable verified genuine, strict,
  non-flaky. Epic 1's ledger is licensed for downstream projections on `seq`.

---

# Test Automation Summary — Story 2.0

**Story:** 2.0 — Epic 1 Deferred Cleanup (housekeeping / internal-tooling)
**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA) · 2026-05-31 · branch `AGENTBBS-1-epic2`
**Framework:** Vitest 4.1.7 (single root runner) + the typecheck gate.

## Outcome: NO new test added (Rule 3 exemption); existing 99-test suite re-verified as the regression guard

Story 2.0 adds `.gitattributes` (`* text=auto eol=lf`), removes the unused
`eslint-plugin-boundaries` dev-dependency (manifest + catalog + lockfile), and reconciles
`deferred-work.md`. It introduces no service, module, API, CLI, or UI surface and no new
feature code, so per **skill-rules Rule 3** it is **exempt** from real-runtime test evidence.
No synthetic test was manufactured for a no-behavior change.

## Per-AC test rationale

- **AC #1** (`.gitattributes` / LF normalization) — a Git-tooling guarantee, not an
  app-runtime behavior. Verified by inspection: `git check-attr text eol -- package.json` →
  `text: auto`, `eol: lf` (attribute active); `git ls-files --eol | grep w/crlf` → **zero**
  tracked text files carry CRLF in the working tree (tree re-normalized to LF). Not
  test-eligible in the app tier.
- **AC #2** (remove `eslint-plugin-boundaries`; boundary rules still fire) — the only AC with
  an assertable behavioral guarantee, and it is **already covered** by the pre-existing
  discoverable test `packages/core/src/boundary-enforcement.test.ts`, which runs ESLint
  programmatically against the repo's real flat config and asserts `no-restricted-imports` /
  `no-restricted-syntax` fire. The boundary rules were always implemented with
  `no-restricted-imports` (never the removed plugin), so this test **is** the regression guard
  proving the removal was safe; it passed this stage (part of the 99). A second test for the
  same guarantee would duplicate it — none added.
- **AC #3 / #4** (reconcile `deferred-work.md`) — Markdown ledger edits have no executable
  behavior to assert; verified by reading the reconciled ledger (1.2 RESOLVED / 1.4 RESOLVED /
  1.5 OPEN / 1.6 OPEN, resolved items retained with citations).

## Rule 8 (discoverability)

No new test file created → nothing new to assess for naming/ignore/tag opt-out. The existing
regression guard `boundary-enforcement.test.ts` remains fully discoverable: `*.test.ts` naming,
under `packages/core/src/` (matched by `vitest.config.ts` `projects` include glob
`packages/*/src/**/*.test.{ts,tsx}`), under no ignore path, ran in the default `pnpm test`.

## Gate runs (full re-run, all exit 0)

| Command | Result |
| --- | --- |
| `pnpm run lint` (`eslint .`) | exit 0 — config valid + boundary rules fire with the plugin removed |
| `pnpm test` | Test Files 15 passed (15) · Tests **99 passed (99)** (baseline intact) |
| `pnpm run typecheck` | `tsc --noEmit -p tsconfig.typecheck.json` — exit 0 |
| `pnpm run format` (`prettier --check .`) | "All matched files use Prettier code style!" |
| `pnpm -r build` | 7 packages `tsc -b` Done |

`eslint-plugin-boundaries`: **0 occurrences** across `package.json`, `pnpm-workspace.yaml`,
`pnpm-lock.yaml` (was 1 / 1 / 4).

## Rule 5 / Rule 6

No NFR tripwire (no NFR work in this story). `docs/adr/` confirmed absent — no ADR constraints.

## Next Steps
- None. QA gate satisfied with the existing 99-test suite as the regression guard. No code or
  test files were modified by this stage (only this summary + the story's QA Results section).
  Lead commits after the per-story smoke gate.

---

# Test Automation Summary — Story 2.3

**Story:** 2.3 — Re-establish identity with `login`
**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA) · 2026-05-31 · branch `AGENTBBS-1-epic2`
**Framework:** Vitest 4.1.7 (single root runner) + the typecheck gate.

## Outcome: 4 real-runtime session-holder gap tests added; dev coverage otherwise strong

The dev suite was assessed critically against the QA brief's priorities. It is genuinely
strong — `core.login` (hit/miss/case-insensitive/appends-nothing) is well unit-tested
(`login.test.ts`), validate-before-core is exhaustively pinned with a spying DataAccess +
a meaningful valid control (`login.qa.test.ts`), and the real-ledger wire shape + happy
paths are covered (`login.integration.test.ts`). Four residual gaps in the NEW
mechanism — the per-connection session-identity holder (first consumed by Story 2.4) —
were found and closed. All are REAL-RUNTIME (Rule 3): real `Client`↔`McpServer` over
`InMemoryTransport`, real `createDataAccess` (better-sqlite3) against a SQLite file under
`os.tmpdir()` — nothing mocked. Temp DBs never touch the repo's real `.agentbbs/`.

## Test file

- `packages/mcp-server/src/tools/login.session.qa.test.ts` (**QA-added**) — 4 tests
  closing session-state-transition gaps the dev suite did not assert.

## QA-added coverage (4 tests, all real-runtime)

### Session-holder semantics (the new mechanism)
- [x] **A FAILED login does NOT clobber an already-established session.** The dev test only
  proved `null → (unknown login) → null`. The load-bearing case is established-as-`ada` →
  (unknown `ghost` login → `LOGIN_UNKNOWN`) → session is **STILL `ada`** (not nulled, not
  set to the unknown handle). A handler that mutated the holder before/regardless of
  resolution would silently change the acting actor here — exactly the bug 2.4/2.5 inherit.
- [x] **A second SUCCESSFUL login REPLACES the session handle** — register `ada`+`bob`, login
  `ada` (session `ada`), then login `bob` ⇒ session moves to `bob` (holder replaced, not
  pinned to the first login).
- [x] **Two independent `createBoardServer` instances have INDEPENDENT sessions** — a
  register/login on server 1 never bleeds into server 2's holder (no shared/global state
  leak; the factory defaults a fresh holder per server). Both share the same real ledger,
  so the identities resolve cross-server, but the session actors stay isolated (`ada` vs `bob`).

### Error contract completeness
- [x] **`LOGIN_UNKNOWN` carries the full `{ code, message }` contract** — not just the code;
  asserts `message` is a present, non-empty string (the dev integration test asserted only
  `code`).

## Why these are non-redundant
- `login.integration.test.ts` proves register-sets-session, login-sets-session, and a fresh
  unknown-login leaves a `null` session `null` — but never the established→failed-login→
  unchanged transition, the A→B replacement, or cross-server isolation.
- `session.test.ts` pins the bare `createSessionIdentity()` factory (independent holders at
  the unit level) — but not two full `createBoardServer` servers over the real transport.

## Gate runs (clean tree, all exit 0)

| Command | Result |
| --- | --- |
| `pnpm test` | Test Files 33 passed (33) · Tests **207 passed (207)** (was 32/203; +1 file, +4 tests) |
| `pnpm run typecheck` | `tsc --noEmit -p tsconfig.typecheck.json` — exit 0 (covers the new `*.test.ts`) |
| `pnpm run lint` (`eslint .`) | clean |
| `pnpm run format` (`prettier --check .`) | "All matched files use Prettier code style!" |

## Rule 8 (discoverability)

Single runner. The new file (`*.test.ts` naming, under `packages/mcp-server/src/tools/`,
matched by the root `vitest.config.ts` include glob `packages/*/src/**/*.test.{ts,tsx}`,
under no ignore path) was auto-discovered: the default `pnpm test` went 32→33 files /
203→207 tests after it was added. No second runner, no opt-out tag.

## Rule 5 / Rule 6

No NFR tripwire (login is implementable exactly as worded; session model works with no
SDK obstruction). `docs/adr/` confirmed absent — no ADR constraints to honor.

## Next Steps
- Story 2.4 (`update_focus`): the FIRST consumer of the session holder — its integration
  AC should assert the appended `identity.focus_updated` event's actor IS the session
  handle these tests prove is correctly established/replaced/isolated.

---

# Test Automation Summary — Story 3.1

**Story:** 3.1 — Announce a project and create its sub-board (`announce_project`)
**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA) · 2026-05-31 · branch `feature/AGENTBBS-1_agentbbs-mvp`
**Framework:** Vitest 4.1.7 (single root runner) + the typecheck gate.

## Outcome: 2 real-runtime gap tests added; dev coverage otherwise strong

This is the first BOARD (non-identity) tool plus a `core` board op (`announceProject`)
and the projects projection. The dev suite is genuinely strong: slug edge cases,
two-event atomic happy path, `PROJECT_EXISTS` (same title AND distinct-title→same-slug)
with nothing-appended against the in-memory fake, projection fold (announcer first
member, seq-ordered, join-order de-dup, unknown-project ignored), and a real-runtime
integration suite (real `Client`↔`McpServer` over `InMemoryTransport` + real
`createDataAccess` SQLite ledger, nothing mocked) covering AC #5 same-title duplicate
(same + cross identity, `maxSeq` unchanged), AC #3 `NO_IDENTITY`, AC #4 invalid-input,
and the snake_case discovery surface.

Two genuine real-runtime gaps were closed (the unit fake modeled them, but the REAL
better-sqlite3 `appendGuarded` did not prove them end-to-end):

## Test file (extended)

- `packages/mcp-server/src/tools/announce-project.integration.test.ts` (**+2 QA tests**)

## QA-added coverage (2 tests, all real-runtime / OS temp DBs)

### AC #2 — dual-guard slug collision over the REAL ledger
- [x] **A DISTINCT title that slugs to the SAME `project_id` is rejected `PROJECT_EXISTS`
  by the real ledger.** The pre-existing same-title duplicate is caught by the `title`
  guard ALONE — so the real adapter's enforcement of the SECOND (`project_id`) guard
  (the dev's documented collision policy) was proven only against the in-memory fake.
  This announces "Hello World" then "hello, world!" (both → `hello-world`) over real
  SQLite: second rejected, `maxSeq` unchanged, still exactly one project + one join. A
  single-guard implementation would let this through — now caught end-to-end.

### AC #1 — multi-event ordering over the REAL ledger
- [x] **`project.announced` lands BEFORE the announcer's `board.joined` (lower `seq`),
  both attributed to the announcer, on the real ledger.** The relative ordering of the
  two atomically-appended events was asserted only against the unit fake; this pins it
  through real better-sqlite3.

## Gate runs (clean tree, all exit 0)

| Command | Result |
| --- | --- |
| `pnpm test` | Test Files 43 passed (43) · Tests **289 passed (289)** (was 287; +2) |
| `pnpm run typecheck` | `tsc --noEmit -p tsconfig.typecheck.json` — exit 0 (covers the new tests) |
| `pnpm run lint` (`eslint .`) | clean |

## Rule 8 (discoverability)

Single runner. The added tests live in an existing `*.test.ts` file under
`packages/mcp-server/src/tools/` (matched by the root `vitest.config.ts` include glob
`packages/*/src/**/*.test.{ts,tsx}`, under no ignore path) — auto-discovered: the default
`pnpm test` went 287→289 tests. The integration suite is real-runtime (real
`createDataAccess` + `InMemoryTransport`, no SDK mock), satisfying Rule 3.

## Rule 5 / Rule 6

No NFR tripwire (`announce_project` implementable exactly as worded). `docs/adr/`
confirmed absent — no ADR constraints to honor.

## Next Steps
- Story 3.2 (`list_projects`): the first cross-story consumer of `foldProjects`/`findProject`
  and `announceProject` — its integration AC should read the directory (ordered by `seq`)
  back over the real transport.

---

# Test Automation Summary — Story 3.2

**Story:** 3.2 — Browse the main board (`list_projects` read tool + `core.listProjects`)
**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA) · 2026-05-31 · branch `feature/AGENTBBS-1_agentbbs-mvp`
**Framework:** Vitest 4.1.7 (single root runner) + the typecheck gate.

## Outcome: 1 real-runtime wire-ordering gap test added; dev coverage otherwise complete

The dev suite was assessed against every AC and the stage scrutiny list. It is genuinely
strong: the core unit suite (`list-projects.test.ts`) proves empty→`[]`, seq-ordering with
a deliberate seq≠alphabetical announce order (C, R, D by seq vs C, D, R by title — a
title-sort bug fails it), accreted membership, and no-phantom-for-unknown-join; the
integration suite (real `Client`↔`McpServer` over `InMemoryTransport` + real
`createDataAccess` SQLite under `os.tmpdir()`, nothing mocked) proves the AC #5
cross-identity board-wide-open read (B=bob, member of neither, sees both + is NOT a
member), the `{ projects: [...] }` envelope in BOTH `structuredContent` and the JSON text
block, AC #3 empty→`[]`, AC #4 `NO_IDENTITY` over the real transport, and the
no-required-params discovery surface.

ONE genuine gap was found and closed:

## Per-scrutiny-point verdict

| Scrutiny point | Verdict |
|---|---|
| AC #1 seq≠alphabetical at the CORE layer | Covered (unit C,R,D) |
| AC #1 seq≠alphabetical at the WIRE/tool layer | **GAP → added** — the AC #5 titles (Calling/Release) were already alphabetical, so the wire path could not distinguish seq from title sort |
| AC #2/#5 board-wide-open read w/o membership (different identity) | Covered (B=bob non-member sees both) |
| AC #3 empty → `[]` (not error) | Covered (unit + integration) |
| AC #4 `NO_IDENTITY` over the real transport | Covered (null session → `isError`, `code: NO_IDENTITY`) |
| `{ projects: [...] }` envelope in structuredContent + text | Covered |
| Ordering uses `seq`, never `created_at` | Covered (core sorts strictly `a.seq - b.seq`; the tool does not re-sort) |
| Integration real-runtime (real createDataAccess + InMemoryTransport, no SDK mock) | Confirmed |
| Rule 8 discoverability | Confirmed |

## Test added (1, real-runtime / OS temp DB)

- `packages/mcp-server/src/tools/list-projects.integration.test.ts` (**+1 QA test**) —
  "orders the wire list by announcement seq, NOT alphabetically by title (AC #1)".
  Announces "Zephyr Board" FIRST then "Alpha Board" SECOND (seq-order is the REVERSE of
  alphabetical); asserts the wire list — in BOTH `structuredContent.projects` and the JSON
  text block — is `[zephyr-board, alpha-board]`. A title/slug-sort anywhere in the full
  wire path (`announce_project` writes → core seq-sort → `projectToWire`) would now fail.
  The tool maps core's already-sorted array straight through, so this is the cheap
  end-to-end insurance the AC #5 case (coincidentally-alphabetical titles) could not give.

## Gate runs (clean tree, all exit 0)

| Command | Result |
| --- | --- |
| `pnpm test` (`vitest run`) | Test Files 45 passed (45) · Tests **299 passed (299)** (was 298; +1) |
| `pnpm prettier --check` (touched file) | "All matched files use Prettier code style!" |
| `pnpm eslint` (touched file) | clean |

(Full `typecheck`/`build`/repo-wide `format` were green at the dev gate — 298 — and this is
a test-only, source-untouched addition resolved through the `src` alias, so no rebuild was
needed; the affected suite + the full run are green at 299.)

## Rule 8 (discoverability)

Single runner. Both Story 3.2 test files are `*.test.ts` (`list-projects.test.ts`,
`list-projects.integration.test.ts` — the latter ends in `.test.ts`), under
`packages/{core,mcp-server}/src/`, matched by the root `vitest.config.ts` include glob
`packages/*/src/**/*.test.{ts,tsx}`, under no ignore path, ran in the default `vitest run`
(45 files / 299 tests). No second runner, no opt-out tag. The integration suite is
real-runtime (real `createDataAccess` + `InMemoryTransport`, no SDK mock) — Rule 3
satisfied.

## Rule 5 / Rule 6

No NFR tripwire (`list_projects` implementable exactly as worded; the `NO_IDENTITY`-but-no-
membership gate works with no SDK obstruction). `docs/adr/` confirmed absent — no ADR
constraints to honor.

## Next Steps
- Story 3.4 (sub-board member directory) and the Epic 9 UI reuse `core.listProjects`; their
  own consumer ACs cover those read paths. Nothing further required for 3.2.
