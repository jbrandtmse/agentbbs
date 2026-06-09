---
baseline_commit: a16359b3619f2273d0a082dcdae12646d428de5b
---

# Story 11.0: Epic 10 Deferred Cleanup

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the Epic 11 lead,
I want the long-carried test-infra flakes stabilized and the trivial `5.1-roomid-cap-edge` test-hardening item finally closed,
so that Epic 11's round-trip-fidelity test (Story 11.4) and the release / OSS-readiness gate (Story 11.5) run on a reliably-green suite — an outside developer who clones the repo and runs `pnpm test` must see green, not an intermittent red.

## Context: this is the Epic-11 retro-review cleanup story (Story X.0)

This story is the mechanical output of the `/epic-cycle` retro-review gate: it triages the items the Epic 10 retrospective (`epic-10-retro-2026-06-05.md`) and `deferred-work.md` carried forward, and **includes only the small subset that is actionable now and benefits Epic 11's reliable-gate / OSS-readiness goal.** The full triage disposition (include / defer-to-named-consumer / defer-no-trigger) is recorded in the **Triage table at the bottom of this file**. Everything not included is deferred there with rationale — nothing was dropped silently.

**Scope discipline:** this is a cleanup story. Touch ONLY the three items in the ACs below. Do NOT refactor adjacent code, do NOT pull in other deferred items, do NOT change any production board logic. The agent contract (`packages/core`, `packages/mcp-server` wire, the closed error/event sets) must stay **byte-identical** (Rule 13) — this story adds/stabilizes tests and at most hardens test-teardown; it ships no behavior change to the board.

## Acceptance Criteria

### AC1 — Windows `seed-protocol-race.test.ts` teardown `EPERM` no longer intermittently reds the gate

**Given** `packages/data-access/src/seed-protocol-race.test.ts` (the 8-way cross-process protocol-seed race),
**When** the full root suite (`pnpm test`) runs on Windows under parallel load, repeatedly,
**Then** the test's **assertions still pass** (exactly-one protocol announcement / main project / system identity; every worker resolves) AND the **temp-tree teardown no longer surfaces an `EPERM`** that fails the test,
**And** the fix does not weaken the test's guarantee — the race assertions (lines 280–295) are unchanged; only the teardown robustness is improved,
**And** no temp directories are leaked into a location other than `os.tmpdir()` (the existing `os.tmpdir()` discipline is preserved; if a Windows handle-release lag genuinely prevents removal, teardown cleanup failure must be **best-effort / non-fatal to the test** rather than left to fail the gate — document the chosen approach in the test's comment).

> **Source fact (verified):** the file ALREADY has `removeTempTree` with `rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })` (lines 143–145) AND calls `reapChildren()` before `removeTempTree(dir)` in `finally` (lines 296–298). The flake recurs DESPITE this. Likely causes to investigate: (a) `reapChildren()` sends `SIGKILL` but does **not await** child exit, so `rmSync` can run while a just-killed child still holds the `.db`/`-wal`/`-shm` handle (the happy path `await Promise.all(workerPromises)` means workers normally exit 0 before `finally`, but the defensive `reapChildren` path and OS handle-release lag remain); (b) Windows reports `EPERM` (not `EBUSY`) for a directory whose child file handle is still mapped; (c) AV/indexer momentarily locking the WAL sidecar. A robust, behavior-preserving fix is what AC1 wants — the dev decides between awaiting child exit before removal, widening the retry budget, or swallowing a teardown-only `EPERM` after the assertions have passed.

### AC2 — the recurring Shiki full-suite tokenizer flake is stabilized

**Given** `packages/ui-shared/src/markdown/highlight.test.ts` (and any sibling test that drives the Shiki singleton under full-suite parallel load),
**When** the full root suite (`pnpm test`) runs repeatedly,
**Then** `highlight.test.ts` is **green under parallel load**, not merely green in isolation,
**And** the NFR12 invariants it pins (class-spans only, never inline `style=`/`color:`; HTML-escaped token text; the four `.code-*` tints; unknown-lang inert fallback) are **unchanged** — only the flake's root cause (concurrent/unprewarmed singleton WASM `createHighlighter` init contention, or an under-budget implicit timeout under load) is addressed,
**And** the chosen stabilization follows the established **prewarm discipline** (`render-markdown.test.ts` already does `await prewarmHighlighter()` in a test; `highlight.ts` exports `prewarmHighlighter()` for exactly this) — e.g. a `beforeAll(prewarmHighlighter)` so the singleton is initialized once for the file before the per-test async calls, and/or a generous explicit timeout on the WASM-init-bearing tests.

> **Source fact (verified):** `highlight.ts` lazily builds a singleton via `getHighlighter()` (one shared in-flight `highlighterPromise`, lines 79–96) and exports `prewarmHighlighter()` (line 99). `highlight.test.ts` calls the async `highlightToInertHtml(...)` directly in 6 tests with **no `beforeAll` prewarm** — so each test independently awaits the singleton; under full-suite parallel load the first WASM `createHighlighter` (oniguruma) contends with the other Shiki-driving DOM test files (`render-markdown.test.ts`, `RoomApp.live.test.ts`). This is the `9.5-shiki-warmup` / `10.5` / `10.6` flake signature.

### AC3 — `5.1-roomid-cap-edge` closed: a shared `roomIdSchema` length cap-edge test exists

**Given** `roomIdSchema` (`packages/mcp-server/src/tools/room-shared.ts`, with `ROOM_ID_MAX_LENGTH = 200`),
**When** a `room_id` of exactly the cap length (200) and one of cap+1 (201) are validated,
**Then** a test asserts the at-cap value is **accepted** and the cap+1 value is **rejected** by the shared schema (a `.safeParse` unit test is sufficient and matches codebase precedent — no need for a full per-tool integration call test),
**And** the test is discoverable by the default suite (`*.test.ts` under `packages/mcp-server/src/**`),
**And** this finally closes the item carried since Story 4.3 / 5.1 across seven epics.

> **Source fact (verified):** `ROOM_ID_MAX_LENGTH = 200` and `roomIdSchema` are exported from `packages/mcp-server/src/tools/room-shared.ts` (confirmed via the built `room-shared.d.ts` + the `import { roomIdSchema } from './room-shared.js'` in `add-participant.ts:30`, `read-room.ts:22`, `read-contract.ts:28`). No existing mcp-server test pins a syntactic length cap-edge for `room_id` (that absence is exactly the open item).

### AC4 — full gate green, contract byte-identical, no regressions

**Given** the three changes above,
**When** the canonical root gate runs (`pnpm run lint` · `pnpm run typecheck` · `pnpm run build` · `pnpm test` · `pnpm run format --check`),
**Then** every stage is green, the test count is **≥ the 1484 baseline** (Epic 10 close) plus the new cap-edge test(s),
**And** `git diff HEAD -- packages/core packages/mcp-server/src` shows **no production-logic change** (only the new `room-shared` cap-edge test file, if placed under mcp-server; the schema itself is unchanged),
**And** the AC1/AC2 stabilizations are demonstrated by **repeated** full-suite runs (run `pnpm test` several times — the flakes are intermittent, so a single green run is not sufficient evidence; the lead's smoke gate will also re-run).

## Tasks / Subtasks

- [x] **Task 1 — AC1: stabilize `seed-protocol-race.test.ts` Windows teardown** (AC: 1)
  - [x] Reproduce/inspect: run the full suite several times on Windows; confirm the `EPERM` is teardown-only (assertions pass) and identify whether it is the `.db`, `-wal`, or `-shm` handle.
  - [x] Apply the minimal robust fix (await child exit before `rmSync`, and/or widen retry budget, and/or make a post-assertion teardown `EPERM` non-fatal). Keep the race assertions byte-identical.
  - [x] Document the chosen approach in the test's comment so the next maintainer understands why.
- [x] **Task 2 — AC2: stabilize the Shiki full-suite flake** (AC: 2)
  - [x] Add `beforeAll(prewarmHighlighter)` (or equivalent) to `highlight.test.ts` so the singleton WASM init happens once for the file; add an explicit generous timeout to the WASM-init-bearing tests if needed.
  - [x] Verify the NFR12 assertions are unchanged and still pass under repeated full-suite runs.
  - [x] If a sibling test file shares the flake under load, apply the same prewarm discipline there (mirror `render-markdown.test.ts`). — N/A this run: the only file with the no-prewarm/6-direct-async-call signature is `highlight.test.ts` (`render-markdown.test.ts` already prewarms in-test; the `.tsx` files render via React components that await internally). No sibling flake surfaced across 5 repeated full-suite runs, so no sibling change was made (scope discipline).
- [x] **Task 3 — AC3: add the `roomIdSchema` cap-edge test** (AC: 3)
  - [x] Add a `.safeParse` unit test (at-cap 200 accepted, cap+1 201 rejected) co-located with the room tools (e.g. `packages/mcp-server/src/tools/room-shared.cap-edge.test.ts`).
  - [x] Confirm it is collected by the default root suite.
- [x] **Task 4 — AC4: gate + repeated-run evidence** (AC: 4)
  - [x] Run the full canonical gate green.
  - [x] Run `pnpm test` several times to demonstrate the flakes are stabilized; record the run count + results in the Dev Agent Record.
  - [x] Confirm `git diff HEAD -- packages/core packages/mcp-server/src` is production-logic-clean (tests only).

## Dev Notes

### What this story is NOT
- NOT a feature. No new MCP tool, event type, error code, or board op. No production board-logic edit. The agent contract stays byte-identical (Rule 13).
- NOT a license to sweep other deferred items. The Triage table below deliberately defers `1.5`, `1.6` (→ named consumer Story 11.3), `8.4-helper-crlf`, the Epic-9 web nits, the other Epic-10 UI nits, the bundle-size item (→ named consumer Story 11.5), the databasePath enhancement, and the owed manual a11y/HC pass. Do not pull any of them into this story.

### Testing standards (verified against the repo)
- Tests are `*.test.ts` co-located under `packages/*/src/**` and run via the root `pnpm test` (Vitest, root config with a `projects`/multi-environment split — the `*-dom` happy-dom project + a node project). **The canonical gate is the ROOT `pnpm test`, never a per-package `vitest` run** (Rule 12 corollary: a per-package run bypasses the root DOM-project mapping and false-reds `.tsx`/DOM tests with `document is not defined`).
- The cross-process race tests (`seed-protocol-race.test.ts`, `concurrency.test.ts`, `register-race.test.ts`, `check-race.test.ts`) `child_process.fork` a **built** `dist/*-worker.js`; their `beforeAll` is BUILD-IF-MISSING/STALE (`tsc -b --force`). Do not break that pattern.
- AC1/AC2 are about **intermittent** flakes: a single green run is not proof. Demonstrate with repeated full-suite runs (Rule 12 fidelity — and the lead re-runs at the smoke gate).

### Source-fact references (Rule 4 — all verified this session)
- `packages/data-access/src/seed-protocol-race.test.ts` — already has `removeTempTree` retry (L143–145) + `reapChildren()` before removal in `finally` (L296–298); race assertions L280–295.
- `packages/ui-shared/src/markdown/highlight.ts` — singleton `getHighlighter()` (L79–96), `prewarmHighlighter()` export (L99); `highlight.test.ts` has NO `beforeAll` prewarm (6 direct async calls).
- `packages/ui-shared/src/markdown/render-markdown.test.ts:70–71` — precedent: `await prewarmHighlighter()` inside a test.
- `packages/mcp-server/src/tools/room-shared.ts` — `ROOM_ID_MAX_LENGTH = 200`, `roomIdSchema` (consumed by `add-participant.ts`, `read-room.ts`, `read-contract.ts`).

### Project Structure Notes
- New test files co-locate beside the code they test (`room-shared.cap-edge.test.ts` beside `room-shared.ts`). No structural variance.
- No change to `eslint.config.js`, no new dependency, no catalog change.

### References
- [Source: _bmad-output/implementation-artifacts/epic-10-retro-2026-06-05.md#Next epic preview — Story 11.0 carry-forward list]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — Story 10.0/10.5/10.6 entries (seedrace-eperm, shiki flake), Story 5.1/4.3 room-tool cap-edge items]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 11 — Stories 11.4 (round-trip fidelity) + 11.5 (distribution/OSS readiness) are the consumers that need a reliably-green gate]
- [Source: .claude/rules/project-rules.md — Rule 12 (real-browser/root-gate), Rule 13 (byte-identical contract), Rule 7 (mutation non-vacuity if a stabilization touches an assertion)]

## Dev Agent Record

### Context Reference

- Story file: `_bmad-output/implementation-artifacts/11-0-epic-10-deferred-cleanup.md`
- Project context: `_bmad-output/project-context.md` (NFR12 inert render, append invariant, module boundaries, testing — root `pnpm test` is the canonical gate)
- Rules applied: project-rules #7 (mutation non-vacuity), #12 (root-gate canonical / repeated-run fidelity), #13 (byte-identical agent contract)

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Baseline (HEAD `a16359b`): full root `pnpm test` → 172 files / **1484** tests green (the Epic 10 close baseline).
- After changes: full root `pnpm test` → 173 files / **1487** tests green (= 1484 + 3 new cap-edge tests). Repeated **5×** consecutive full-suite runs (runs 1–5), all 1487/1487 green — the AC1/AC2 flakes did not recur under repeated parallel load.

### Completion Notes

**AC1 — `seed-protocol-race.test.ts` Windows teardown EPERM (test-robustness only; race assertions byte-identical):**
- Root cause (per AC source-fact): the defensive `reapChildren()` sent `SIGKILL` but did **not await** child exit, so the subsequent `removeTempTree(dir)`/`rmSync` could run while a just-killed worker still held the `.db`/`-wal`/`-shm` handle → Windows reports `EPERM` (not `EBUSY`) on the directory removal, intermittently red-ing the gate even though the race assertions had already passed.
- Fix (two complementary, behavior-preserving changes, both teardown-only): (1) `reapChildren()` is now `async` and **awaits each killed child's `exit`** (bounded 2s per child so a wedged child can't hang teardown) before returning, so the OS has released the worker's file handles before the tree removal; both call sites (`afterEach`, the `it` `finally`) now `await` it. (2) `removeTempTree()` keeps the wide `maxRetries: 20, retryDelay: 50` budget but now **swallows a residual removal error** (best-effort / non-fatal) — a cleanup nuisance after the assertions passed must not fail the gate. `os.tmpdir()` discipline preserved (worst case = a stray temp dir under the OS temp root, never a repo orphan). Rationale documented inline in both helper comments.
- Verified `git diff` of the test file touches **zero assertion lines** (grep for every assertion identifier returned "NO ASSERTION LINES CHANGED"); the race guarantee (exactly-one announcement/main-project/system-identity; every worker resolves) is unchanged.

**AC2 — Shiki full-suite tokenizer flake (NFR12 assertions unchanged; init-timing only):**
- `highlight.test.ts` had **no** `beforeAll` prewarm — each of its 6 direct `highlightToInertHtml(...)` calls independently awaited the lazy singleton `createHighlighter` (oniguruma WASM); under full-suite parallel load that first cold WASM init contends with the other Shiki-driving files and intermittently exceeds the implicit per-test timeout (the `9.5-shiki-warmup` / `10.5` / `10.6` flake).
- Fix: added `beforeAll(async () => { await prewarmHighlighter(); }, 30_000)` — the established prewarm discipline (`render-markdown.test.ts:70` does the same in-test), with a generous explicit timeout covering the one-time cold WASM compile under load. The NFR12 assertion bodies (class-spans only, never inline `style=`/`color:`; HTML-escaped token text; the four `.code-*` tints; unknown-lang inert fallback) are byte-identical — only init timing is made deterministic.

**AC3 — `5.1-roomid-cap-edge` closed:**
- Added `packages/mcp-server/src/tools/room-shared.cap-edge.test.ts`: a `.safeParse` unit test pinning the `roomIdSchema` length cap edge — pins `ROOM_ID_MAX_LENGTH === 200`, asserts an at-cap (200) slug is **accepted** and a cap+1 (201) slug is **rejected**. Co-located beside `room-shared.ts`, collected by the default root suite (node project).
- **Mutation-tested non-vacuous (Rule 7):** temporarily set `ROOM_ID_MAX_LENGTH = 201` → all 3 tests went RED (the literal-200 pin + the over-cap boundary); reverted `room-shared.ts` byte-identically (`git diff HEAD -- room-shared.ts` empty) → 3/3 green again.

**AC4 — gate + contract:**
- Canonical root gate all green on this machine: `pnpm run lint` (eslint clean) · `pnpm run typecheck` (tsc clean) · `pnpm run build` (all packages + apps/web Vite dist + vscode-extension bundle) · `pnpm test` (1487/1487, run 5×) · `pnpm run format` (`prettier --check .` — all files Prettier-clean). Note: the repo's format script is `pnpm run format` (= `prettier --check .`); the AC's `format --check` shorthand maps to it.
- Contract byte-identical (Rule 13): `git diff HEAD -- packages/core packages/mcp-server/src` excluding the new test file is **empty** — no production board-logic change, no new tool/event/error code; the only `mcp-server/src` addition is the new cap-edge test file.

### File List

- `packages/data-access/src/seed-protocol-race.test.ts` (modified — teardown robustness: async `reapChildren` awaits child exit; best-effort `removeTempTree`; assertions byte-identical)
- `packages/ui-shared/src/markdown/highlight.test.ts` (modified — `beforeAll(prewarmHighlighter)` stabilization; NFR12 assertions unchanged)
- `packages/mcp-server/src/tools/room-shared.cap-edge.test.ts` (new — `roomIdSchema` length cap-edge `.safeParse` unit test)
- `_bmad-output/implementation-artifacts/11-0-epic-10-deferred-cleanup.md` (modified — frontmatter `baseline_commit`, task checkboxes, Dev Agent Record, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story status `ready-for-dev` → `in-progress` → `review`)

### Change Log

- 2026-06-06 — Story 11.0 dev-story: AC1 stabilized the Windows `seed-protocol-race.test.ts` teardown EPERM (await child exit + best-effort tree removal; race assertions byte-identical). AC2 stabilized the Shiki full-suite flake via `beforeAll(prewarmHighlighter)` in `highlight.test.ts` (NFR12 assertions unchanged). AC3 closed `5.1-roomid-cap-edge` with a new `roomIdSchema` cap-edge `.safeParse` test (mutation-tested non-vacuous). AC4 full canonical gate green; flakes verified stable over 5 repeated full-suite runs; agent contract (`packages/core`, `packages/mcp-server/src`) byte-identical. (Note: the final cap-edge file carries 5 tests after the QA lower-edge additions → 1484→1489, not the pre-QA 1487 figure above.)
- 2026-06-06 — Story 11.0 code-review: CLEAN. All three review lenses (Blind Hunter / Edge Case Hunter / Acceptance Auditor) produced zero findings. Independently re-verified: AC1 race assertions byte-identical + best-effort swallow scoped to `rmSync` only (fires post-assertion, in `finally`, cannot mask a real failure) + exit-waits run in parallel (`Promise.all`, bounded 2s total) + temp dirs stay under `os.tmpdir()`; AC2 only substantive edit is the prewarm, 8 NFR12 `it()` blocks intact; AC3 discoverable in root suite (1484→1489) and re-mutation-tested non-vacuous (set `ROOM_ID_MAX_LENGTH=201` → 4/5 RED, reverted byte-identical via `git diff` empty → 5/5 green). Rule 13 re-confirmed: `git diff HEAD -- packages/core packages/mcp-server/src` empty (only the untracked new test). Canonical root gate green: lint · typecheck · build · `pnpm test` (1489/1489, run **3×** consecutively this review, no flake recurrence) · `prettier --check` clean.

### Review Findings (code-review 2026-06-06)

✅ **Clean review — all layers passed.** 0 decision-needed · 0 patch · 0 defer · 0 dismissed. No production board-logic change; agent contract byte-identical (Rule 13). Story set to `done`.

---

## Epic-11 Retro-Review Triage (covers Epic 10 → Epic 11; gate run 2026-06-06)

Triage of every item the Epic 10 retrospective + `deferred-work.md` carried into the Epic 11 cycle. Disposition per item: **Include** (scoped into the ACs above) · **Defer→consumer** (Rule-9 named-consumer deferral) · **Defer** (no Epic-11 trigger) · **Close** (already resolved by a later Epic-10 story; confirmed this session).

| Item | Source | Triage Decision |
| --- | --- | --- |
| Windows `seed-protocol-race.test.ts` teardown `EPERM` (`E10-baseline-seedrace-eperm`) | retro + deferred-work (Story 10.0) | **Include → AC1.** Flaky gate undermines Epic 11's 11.4 fidelity test + 11.5 OSS-readiness ("clone & `pnpm test` is green"). |
| Recurring Shiki full-suite tokenizer flake (`9.5-shiki-warmup` / `10.5` / `10.6`) | retro + deferred-work (Story 10.5/10.6) | **Include → AC2.** Same reliable-gate rationale; concrete prewarm-discipline fix available. |
| `5.1-roomid-cap-edge` (no at-cap/cap+1 test for `room_id` length) | deferred-work (Story 4.3/5.1) | **Include → AC3.** Trivial one-test close of debt carried 7 epics; finally retire it. |
| `1.6` — `wireToPayload` doesn't validate a known-type-but-**malformed** payload row | deferred-work (Story 1.6) | **Defer→consumer: Story 11.3 (import).** Import replays an external NDJSON archive; a malformed archive row IS exactly the known-type-but-malformed-payload case, and import is the correct seam for replay validation. The import story should validate archive rows and decide the failure mode (reject vs skip-and-log) — that addresses 1.6's class at its real consumer. |
| Room webview bundle ~10 MB (Shiki grammars inlined) | retro | **Defer→consumer: Story 11.5 (VSIX packaging).** VSIX distribution is where bundle size becomes a real concern; measure + decide there (Rule 9 — defer to the consumer that can measure the hot path). |
| `1.5` — append-invariant lint guard disabled in `*.test.ts` | deferred-work (Story 1.5) | **Defer (no trigger).** Needs an AST-level SQL-lint approach; out of scope; revisit when the append-invariant tooling is next touched. Production source stays fully guarded. |
| `8.4-helper-crlf` — LF block spliced into a CRLF file (cosmetic) | deferred-work (Story 8.4) | **Defer (no trigger).** Cosmetic; idempotency/backup/foreign-safety all hold under CRLF (empirically). Fold into the next install-kit helper touch (likely Epic 12). |
| Epic-9 web nits: `9.1-L2` (DESIGN ratio), `9.4-mention`, `9.10-no-modal-substring`, `9.10-tree.css-comment` | deferred-work (Epic 9) | **Defer (no trigger).** Epic-9/10 UI polish; no Epic-11 (export/import + docs) trigger. |
| `9.13-trim` (host-side trim discipline) | deferred-work (Epic 9) | **Defer / effectively addressed.** Carried into Epic 10 as an awareness-carry and applied where `update_focus`/`reply` were wired; no Epic-11 trigger. |
| `10.3-treeitem-description` — uncapped `"N new"` has no direct test assertion | deferred-work (Story 10.3/10.6) | **Defer (no trigger).** Epic 11 does not touch the VS Code tree provider; re-own at the next tree touch. |
| `10.3-operator-handle-dup` — `resolveOperatorHandle` duplicated (not imported) from web host | deferred-work (Story 10.3) | **Defer (no trigger).** LOW/INFO refactor; no Epic-11 trigger. |
| `10.4-csp-imgsrc` — room webview CSP `img-src` admits `https:`, `font-src` not nonce-pinned | deferred-work (Story 10.4) | **Defer (no trigger).** Webview CSP hardening nit, distinct from distribution; no Epic-11 trigger. |
| `10.5-retainContext` — non-retained room panel re-renders on hidden→visible | deferred-work (Story 10.5) | **Defer (no trigger).** Forward-risk perf; no Epic-11 trigger. |
| `agentbbs.databasePath` live re-config needs a window reload | retro | **Defer (no trigger).** Enhancement; documented behavior, not a defect. |
| Manual a11y / high-contrast NFR pass owed (Story 10.6 — visual-paint + screen-reader) | retro | **Defer (manual gate).** Manual-only NFR gate (happy-dom/probe can't model it); not code, cannot be done in 11.0. Schedule a manual a11y/HC pass. (No concrete date in the artifacts → not auto-scheduled here.) |
| `10.1-MED` — better-sqlite3↔Electron-host ABI downstream risk | deferred-work (Story 10.1) | **Close.** RESOLVED by Story 10.2 (the `node:sqlite` `DataAccess` adapter behind the NFR2 seam, proven across two real Electron host ABIs). Confirmed in deferred-work this session. |
| `10.2-LOW/INFO` — remaining bridge WRITE ops named-deferred to 10.3–10.6 | deferred-work (Story 10.2) | **Close.** All bridge writes wired by Epic 10's completion (full operator↔agent initiate+respond parity, incl. Story 10.7). |

**Net:** 3 included (AC1/AC2/AC3), 2 deferred-to-named-consumer (1.6→11.3, bundle→11.5), 10 deferred-no-trigger/manual, 2 closed-confirmed. Nothing dropped silently.
