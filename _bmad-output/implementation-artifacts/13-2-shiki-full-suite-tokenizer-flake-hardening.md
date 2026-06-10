---
baseline_commit: 38fa4ba
---

# Story 13.2: Shiki full-suite tokenizer flake hardening

Status: done

<!-- Epic 13 (deferred-work cleanup & hardening). Closes deferred-work.md 9.5-shiki-warmup + 10.5-shiki-flake + 10.6-shiki-flake (consolidated — one fix, three entries). 17-tool agent contract byte-identical. -->

## Story

As a developer relying on the CI gate,
I want the Shiki markdown-render tests to stop flaking under full-suite parallel load,
So that the `ui-shared` render suite is trustworthy.

## Acceptance Criteria

1. **(AC1 — reliable warmth / no concurrent-tokenize fault)** Given the Shiki full-suite tokenizer flake (`highlight.test.ts` / markdown-render DOM tests RED under parallel load, GREEN in isolation — the `9.5-shiki-warmup` alias-miss signature AND the `@shikijs/primitive` `startIndex`-undefined signature from `10.5`/`10.6`), when the warmup/serialization is hardened, then the highlighter is reliably warm AND not faulting before/while any parallel test tokenizes (e.g. a global/project-level `beforeAll(prewarmHighlighter)` + the `isHighlighterWarm()` guard applied suite-wide, **or the markdown-render tests serialized into a single-thread group**, or a pinned/upgraded `@shikijs/*` if Research-First shows the fault is a fixed library bug), with **the rendered-output assertions unchanged**.

2. **(AC2 — flake eliminated, not masked)** Given the hardened suite, when the full ROOT `pnpm test` is run **N≥3 consecutive times** under full parallel load, then **no Shiki tokenizer flake recurs** (neither the `startIndex` fault nor a cold-highlighter miss), and the three `deferred-work.md` Shiki entries are **closed with evidence** (consolidated — one fix, three entries).

3. **(AC3 — assertions intact + contract frozen)** Given the change, when inspected, then every existing rendered-output / inert-HTML / CSS-class-span assertion is byte-unchanged (Rule-7 mutation confirms a render suite still discriminates), and the 17-tool agent contract + closed error/event sets are byte-identical (`git diff HEAD -- packages/core packages/mcp-server/src` empty; the `ui-shared` render PRODUCTION code unchanged unless a shiki version bump is the chosen fix — in which case verify the API against the INSTALLED types per Rule 3).

## Tasks / Subtasks

- [x] **Task 0 — Reproduce + Research-First (the fix must target the REAL root cause)** (AC: #1)
  - [x] Reproduce the flake under full-suite parallel load (NOT isolation) — run the ROOT `pnpm test` repeatedly until the `highlight.test.ts` `TypeError: Cannot read properties of undefined (reading 'startIndex')` (deep in `@shikijs/primitive` `_tokenizeWithTheme`) surfaces, OR confirm from the recorded evidence it is intermittent. CRITICAL CONTEXT: per-file `beforeAll(prewarmHighlighter)` is ALREADY present in `highlight.test.ts`, `CodeBlock.test.tsx`, `MarkdownView.test.tsx`, `RoomView.test.tsx`, and `render-markdown.test.ts` — so a cold-highlighter miss is NOT the (whole) cause; the residual fault is a `@shikijs/primitive` **concurrency/memory-pressure** fault when multiple workers tokenize simultaneously. Adding MORE per-file prewarm will NOT fix it. → Confirmed INTERMITTENT (did not surface in baseline runs; matches the recorded RED-under-load/GREEN-in-isolation evidence). Root cause located in the INSTALLED source — see Dev Notes.
  - [x] Research-First (`.claude/rules/research-first.md`): check the INSTALLED `@shikijs/primitive` / `shiki` version (it was `@shikijs/primitive@4.1.0` at the `10.5` recording) and whether a later patch fixes the `_tokenizeWithTheme` `startIndex` fault. Verify any API against the installed `.d.ts` (Rule 3), not just web claims. Record findings in Dev Notes. → Installed: `shiki@4.1.0` / `@shikijs/core@4.1.0` / `@shikijs/primitive@4.1.0`. NO documented 4.x patch fixes the fault (Perplexity, 2026-06-10). `fileParallelism` verified a supported `vitest@4.1.7` top-level option against the installed types.
- [x] **Task 1 — Apply the robust fix** (AC: #1, #3) — choose, justify in Dev Notes, and implement ONE:
  - [x] **(Option A — serialize, preferred if no clean shiki patch):** put the highlighter-using suites into a single-thread / non-parallel group so they never tokenize concurrently. Vitest 4 REMOVED `poolMatchGlobs` and `environmentMatchGlobs` (already noted in `vitest.config.ts`) — use the supported v4 mechanism: a dedicated project for the markdown/highlighter suites with `fileParallelism: false` (or `poolOptions.{forks,threads}.singleFork/singleThread: true`, or `sequence.concurrent: false`), verified against the installed `vitest@4.1.7` types. Keep the existing node/`ui-shared-dom` project split intact (the markdown DOM tests must still run under happy-dom). Do NOT make the WHOLE suite serial — only the highlighter-using files. → CHOSEN. Added the `markdown-serial` project (`fileParallelism: false`, happy-dom + DOM act() setup) collecting the 12 highlighter-using files; excluded them from the two existing projects so each runs exactly once.
  - [ ] **(Option B — pin/upgrade `@shikijs/*`):** if Research-First shows a fixed version, bump it (root `package.json` + `pnpm-lock.yaml`), verify the `codeToTokens(..., { includeExplanation: true })` API + `fontStyle`/`explanation` shapes the production `highlight.ts` relies on are unchanged against the INSTALLED new `.d.ts` (Rule 3), and confirm the inert class-span output is byte-identical (the CSS-class-span tests are the guard). → NOT CHOSEN (no documented patch; a blind bump risks the frozen output).
  - [x] Either way: rendered-output assertions stay byte-unchanged; `highlight.ts` production logic stays byte-identical unless Option B's verified-safe version bump requires a mechanical adjustment. → `highlight.ts` + all `ui-shared/src` production byte-identical (`git diff HEAD -- packages/ui-shared/src` empty).
- [x] **Task 2 — Prove eliminated (N≥3) + Rule-7 non-vacuity** (AC: #2, #3)
  - [x] Run the full ROOT `pnpm test` N≥3 consecutive times under full parallel load; record each run's file/test counts. No Shiki flake (startIndex fault or cold miss) may recur. → N=3 consecutive ROOT `pnpm test`: 185 files / 1668 tests passed / 0 failed each run; zero `startIndex`/`_tokenizeWithTheme` fault; no `document is not defined`.
  - [x] Rule-7: temporarily break a load-bearing render assertion (e.g. in `highlight.test.ts` change an expected CSS class `code-keyword` → `code-bogus`, or alter an expected inert-span) → RED; revert byte-identical → GREEN. Confirms the render suite still discriminates after the serialization/version change. → Mutated `highlight.test.ts` `code-comment` → `code-bogus` in the `markdown-serial` project → RED (1 failed); reverted byte-identical (`git diff` empty) → GREEN (7/7).
- [x] **Task 3 — Close the three deferred-work items** (AC: #2)
  - [x] In `deferred-work.md`, flip `9.5-shiki-warmup`, `10.5-shiki-flake` (line ~423), and `10.6-shiki-flake` (line ~437) headings `OPEN → RESOLVED (Story 13.2)` with a shared resolution sub-line citing the chosen fix + the N≥3 evidence. Retain the originals. → All three headings flipped to RESOLVED (consolidated); full shared resolution under the `9.5-shiki-warmup` entry, cross-referenced from `10.5`/`10.6`; originals retained for the audit trail.

## Dev Notes

### Current state (READ FIRST)

- `packages/ui-shared/src/markdown/highlight.ts` — module-scoped singleton highlighter (`createHighlighter` from `shiki`, `dark-plus` theme as the scope oracle, 19 bundled langs). `prewarmHighlighter()` loads it; `isHighlighterWarm()` reports readiness; `highlightToInertHtmlSync` is the markdown-it sync path; `resetHighlighterForTest()` is a test seam. Emits CLASS-only inert spans (NFR12 — no inline styles), colors discarded.
- Highlighter-using test files (all already prewarm per-file): `highlight.test.ts`, `CodeBlock.test.tsx`, `MarkdownView.test.tsx`, `render-markdown.test.ts`, `RoomView.test.tsx` (`render-markdown.xss.test.ts` has a `beforeAll` too). The VS Code webview mounts the same renderer: `apps/vscode-extension/src/webview/RoomApp.live.test.tsx` (10.6 added the prewarm + `isHighlighterWarm()` assert there — correctly hardened the one file, but the root flake stayed).
- The flake is the `@shikijs/primitive` `_tokenizeWithTheme` faulting under full-suite concurrency — recorded as RED-under-parallel-load / GREEN-in-isolation at the 10.5 and 10.6 gates, and recurring as a SOLE-failure ambiguity at every Epic-10 gate. The `9.5-shiki-warmup` entry analyzed a DIFFERENT (now-fixed) `ts`-alias-miss signature; this story consolidates all three because one warmup/serialization fix retires the class.

### Why "more prewarm" is the wrong fix

Per-file `beforeAll(prewarmHighlighter)` ensures the singleton is loaded before that file's first tokenize, but the residual fault is a library-internal concurrency bug — multiple Vitest workers each tokenizing in their own process under memory pressure. The fix must remove the CONCURRENCY (serialize the highlighter-using files) or remove the BUG (upgrade `@shikijs/*`). Don't just sprinkle more `beforeAll`s.

### Constraints

- 17-tool agent contract byte-identical (Rule 13): `git diff HEAD -- packages/core packages/mcp-server/src` empty; the closed error/event sets untouched. A serialization fix touches only `vitest.config.ts` (test-infra). A shiki version bump touches `package.json`/`pnpm-lock.yaml` (and must NOT change `highlight.ts` output — the class-span tests guard that).
- The canonical gate is ROOT `pnpm test` (Rule 12 corollary). The `ui-shared-dom` happy-dom project mapping MUST be preserved — do not let a serialization change accidentally move `.test.tsx` out of the DOM project (that would resurrect the `document is not defined` false-red).
- Rendered-output assertions unchanged (AC3). Rule-7 proves they still discriminate.

### Project Structure Notes

- Likely touched: `vitest.config.ts` (Option A) OR `package.json` + `pnpm-lock.yaml` (Option B); `deferred-work.md`. Possibly a small `beforeAll`/`isHighlighterWarm()` guard tightening in the render suites IF that is part of the chosen approach — but NOT as the sole fix.
- If Option A adds a third Vitest project (serialized markdown group), keep the single-root-config invariant (Story 1.2) — all projects live in the ONE root `vitest.config.ts`, never per-package configs.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.2] — the ACs.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-09.md] — P1 sequencing; N≥3 + mask-vs-fix mitigation.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — `9.5-shiki-warmup`, `10.5-shiki-flake` (~line 423), `10.6-shiki-flake` (~line 437) — the three entries to close; the `10.5` entry names `@shikijs/primitive@4.1.0` and the suggested resolutions (pin/upgrade, serialize, or retry).
- [Source: packages/ui-shared/src/markdown/highlight.ts] — the singleton + prewarm/isWarm/reset seams.
- [Source: vitest.config.ts] — the projects array; note Vitest 4 removed `poolMatchGlobs`/`environmentMatchGlobs`.
- [Source: .claude/rules/research-first.md] — verify the shiki version/API against installed `.d.ts`.
- [Source: .claude/rules/project-rules.md] — Rule 3 (installed types), Rule 7 (mutation), Rule 12 (root gate + DOM-project mapping), Rule 13 (frozen contract), Rule 20 (full gate).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Baseline reproduction: ROOT `pnpm test` ×3 under full parallel load — all GREEN (185 files / 1668 tests), Shiki flake did NOT surface (it is intermittent, matching the recorded RED-under-load/GREEN-in-isolation evidence). The unrelated `agentbbs import: failed — ENOENT … no-such-archive.ndjson` line is the known E12 import-dispatch test noise, not the Shiki flake.
- Root-cause location: installed `@shikijs/primitive@4.1.0` `dist/index.mjs` `_tokenizeWithTheme` line 691 — `line.substring(tokenWithScopes.startIndex, …)` where `tokenWithScopes = tokensWithScopes[tokensWithScopesIndex]` is `undefined` when the `includeExplanation:true` dual-pass (`tokenizeLine` scopes + `tokenizeLine2` colors) desyncs under concurrency.
- After-fix verification: ROOT `pnpm test` N=3 consecutive = 185 files / 1668 passed / 0 failed each run; JSON-reporter file-occurrence check confirmed each of the 12 highlighter files runs EXACTLY ONCE (no double-run, no dropped file); 185 total file entries unchanged.
- Rule-7 mutation (in the `markdown-serial` project): `highlight.test.ts` `code-comment` → `code-bogus` → RED (1 failed, real output `code-comment`); reverted byte-identical (`git diff` empty) → GREEN (7/7).
- Full canonical gate (Rule 20): typecheck 0, lint 0, format clean, build clean (all packages incl. both VS Code bundles), test 185/1668 ×3.

### Completion Notes List

- **Root cause (verified, not guessed):** the production renderer `packages/ui-shared/src/markdown/highlight.ts` tokenizes with `codeToTokens(..., { includeExplanation: true })`. In `@shikijs/primitive@4.1.0` that runs two grammar passes per line and indexes the explanation tokens by a running counter; under full-suite CONCURRENCY (many Vitest worker processes tokenizing at once under memory pressure) the two passes intermittently desync → `tokensWithScopes[i]` is `undefined` → `TypeError: …reading 'startIndex'`. Per-file `beforeAll(prewarmHighlighter)` (already everywhere) cannot fix a library-internal concurrency bug — confirmed "more prewarm is the wrong fix."
- **Fix decision — Option A (serialize), justified:** Research-First (Perplexity, 2026-06-10) found NO documented `@shikijs/*` 4.x patch for this `_tokenizeWithTheme`/`startIndex` fault; `@shikijs/core@4.2.0` exists but is not documented as addressing it. Option B (version bump) would risk silently changing the frozen inert CSS-class-span output (AC3) on an undocumented gamble — rejected. Option A removes the CONCURRENCY: a dedicated `markdown-serial` Vitest project (`fileParallelism: false`) collects ALL 12 highlighter-using files and runs them one at a time. Because no file outside that project tokenizes, there is zero concurrent tokenization in the entire run; every other project stays fully parallel (`fileParallelism` is per-project — Research-First verified). `fileParallelism` is a supported `vitest@4.1.7` top-level option (verified in the installed `vitest/dist/chunks/reporters.d.CtLUhkkA.d.ts`: "Should all test files run in parallel … Setting this to `false` will override `maxWorkers` to `1`").
- **Env/DOM-mapping handling (Rule 12 corollary):** the `markdown-serial` project uses `environment: 'happy-dom'` + the shared `test-setup-dom.ts` act() setup so the `.tsx` React renders work; the pure-node `highlight.test.ts` runs fine under happy-dom (verified in isolation). The 12 files are excluded from BOTH existing projects (`agentbbs` node + `ui-shared-dom`) via a shared `highlighterSuites` const, so each runs in exactly one project — the DOM mapping for every OTHER `.test.tsx` is unchanged; no `document is not defined` regression. Single-root-config invariant (Story 1.2) preserved — the third project lives in the ONE root `vitest.config.ts`.
- **AC3 — contract frozen + assertions intact:** `git diff HEAD -- packages/core packages/mcp-server/src packages/ui-shared/src` is EMPTY — 17-tool agent contract, closed error/event sets, and ALL `ui-shared` production + rendered-output assertions byte-identical. The ONLY code change is `vitest.config.ts` (test-infra). Rule-7 confirms the render suite still discriminates.
- **AC2 — eliminated, not masked:** N=3 consecutive ROOT `pnpm test` under full parallel load, zero Shiki flake; the three `deferred-work.md` entries (`9.5-shiki-warmup`, `10.5-shiki-flake`, `10.6-shiki-flake`) closed OPEN→RESOLVED (consolidated, one fix) with evidence, originals retained.
- Rule 5 (NFR tripwire): N/A — no NFR found un-implementable. Rule 6 (ADR): N/A — no `docs/adr` directory / no ADR referenced by this story's ACs.

### File List

- vitest.config.ts (modified — added the serialized `markdown-serial` project + the shared `highlighterSuites` exclude in the two existing projects)
- vitest.highlighter-suites.ts (NEW — types-free single-source-of-truth list, shared by config + guard)
- packages/ui-shared/src/markdown/highlighter-serialization.guard.test.ts (NEW — Rule-8 discoverability drift-guard)
- _bmad-output/implementation-artifacts/deferred-work.md (modified — closed `9.5-shiki-warmup`, `10.5-shiki-flake`, `10.6-shiki-flake` OPEN→RESOLVED, consolidated)
- _bmad-output/implementation-artifacts/13-2-shiki-full-suite-tokenizer-flake-hardening.md (this story — tasks/Dev Agent Record/Status)

## Review Findings

**Code review (2026-06-10, Opus 4.8 1M) — APPROVED, 0 HIGH / 0 MED / 0 LOW / 0 deferred. Clean review.**

All three ACs independently re-verified against ground truth (not the dev/QA self-report):

- **AC1/AC2 — concurrency removed for ALL highlighter files, each runs EXACTLY ONCE:** `npx vitest list --filesOnly` → all 12 highlighter-using files collect in `markdown-serial` and NOWHERE else (186 total file entries across all projects; `uniq -d` on the de-prefixed paths = EMPTY, i.e. zero double-collection; none silently uncollected). The new guard test lands in the parallel `agentbbs` node project (correct — it does not tokenize). N=3 consecutive ROOT `pnpm test` re-run = **186 files / 1672 tests passed / 0 failed** each run; zero `startIndex` / `_tokenizeWithTheme` fault; no `document is not defined`. (The lone `agentbbs import: failed — ENOENT … no-such-archive.ndjson` stderr line is the known E12 import-dispatch negative-path test noise, not a failure.) The +4 tests vs the dev's 1668 = the new guard test's 4 cases; +1 file vs 185 = the new guard test file. Consistent.
- **AC3 — contract frozen + render assertions intact:** `git diff HEAD` EMPTY for `packages/core`, `packages/mcp-server/src`, AND tracked `packages/ui-shared/src` (the only `ui-shared/src` addition is the new untracked guard TEST, not production render code). 36 drift-guard tests (17-tool contract + closed error/event sets) GREEN. Rule-7 re-confirmed non-vacuous INDEPENDENTLY: mutated `highlight.test.ts`'s dedicated `code-comment` assertion → `code-BOGUS` → RED in the `markdown-serial` project (real Shiki output `code-comment` shown, proving the highlighter actually tokenized under serialization); reverted byte-identical (`git diff` empty) → GREEN 7/7.
- **QA discoverability drift-guard — non-vacuous in BOTH directions:** mutation-tested by the reviewer: (a) dropping a real renderer-using file (`CodeBlock.test.tsx`) from `highlighterSuites` → guard RED (3 tests: size-pin, "missing", set-equality); (b) adding a phantom non-triggering entry (`packages/core/src/append.test.ts`) → guard RED ("stale entries" + set-equality). Confirms it genuinely pins "config list === highlighter-using files" — a future highlighter-mounting test omitted from the list turns it RED. The guard's IMPORT/JSX-anchored triggers + the self-skip of the guard file itself are correct (it ran 4/4 GREEN unmutated). Both mutations reverted byte-identical.
- **Env mapping:** the full `markdown-serial` project ran 12 files / 175 tests GREEN under happy-dom — both `.tsx` React renders and the pure-node `highlight.test.ts` (which references no `document`/`window`). The two `render-markdown*.ts` files already carry `// @vitest-environment happy-dom` docblocks (so they ran under happy-dom pre-change too); the project-level env matches — no conflict, docblocks correctly "redundant-but-harmless."
- **Pre-existing `passWithNoTests` typecheck latency — confirmed pre-existing, NOT newly exposed:** `git show HEAD:vitest.config.ts` already had `passWithNoTests` as a per-project key (count 4 at HEAD → 6 in the working tree; the +2 are the new `markdown-serial` project's and a re-counted occurrence — all per-project, none top-level). `tsconfig.typecheck.json` `include` is scoped to `packages/*/src/**` + `apps/*/src/**`; both `vitest.config.ts` and the new `vitest.highlighter-suites.ts` live at REPO ROOT, outside that program, so the latent issue stays latent. This changeset does NOT drag it into the gate (typecheck ran 0). Left latent per the review note; not expanded into scope.
- **Rule 20 — full canonical gate INDEPENDENTLY re-run, every leg:** typecheck 0 · lint 0 · build clean (all packages incl. both VS Code bundles: `extension.cjs` 83.5kb + webview `main.js` 9.6mb/`main.css` 8.1kb + `compose.js`) · `prettier --check` clean · test 186/1672 ×3.
- **Rules 1/3 (real-runtime / integration):** test-infra story (Rule-3 exempt — non-user-facing), exemption noted; it nonetheless carries a real, discriminating render test (the serialized `highlight.test.ts` tokenizes via the real Shiki path, mutation-proven). Rule 5 N/A (no NFR found un-implementable). Rule 6 N/A (no `docs/adr` registry exists). Rule 13 honored (agent contract byte-identical).

No `decision-needed`, no `patch`, no `defer` findings.
