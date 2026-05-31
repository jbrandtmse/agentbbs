---
baseline_commit: 8e9d7893a46d21cb9c090f758506bb9654568eda
---

# Story 3.0: Epic 2 Deferred Cleanup

Status: done

<!-- Cleanup story — not in epics.md. Created by the /epic-cycle Retrospective Review & Story X.0 gate. -->
<!-- Triages Epic 2 retrospective Action Items (C, D, E, F) + deferred-work.md before Epic 3 feature work begins. -->

## Story

As the project lead,
I want the carried-forward Epic 2 housekeeping items resolved before Epic 3 feature work begins,
so that Epic 3 (which adds many new `core` exports consumed by `mcp-server`) starts with cross-package tests that never need a manual build-first dance, a review gate that no longer reds on a cold-start flake, and the identity presence/focus primitives hardened against the orphan-append wart as a class.

## Acceptance Criteria

1. **Given** cross-package tests resolve `@agentbbs/*` through each package's built `dist/` (the package `exports` map), so a newly-added `core` export is invisible to `mcp-server`/`cli`/`ui-shared` tests until `core` is rebuilt (the Epic 2 "stale-dist `INTERNAL_ERROR`" papercut — Rule 2 / deferred-work 2.4),
   **When** the root `vitest.config.ts` is given a `resolve.alias` mapping each `@agentbbs/<pkg>` specifier to that package's `src/index.ts`,
   **Then** cross-package tests run against live TypeScript source and a brand-new `core` export is visible to `mcp-server` tests **without** any prior `pnpm run build`,
   **And** this is proven by a real test that imports a fresh `core` export through the `@agentbbs/core` specifier from a different package's test and exercises it green from a clean (un-built / stale-`dist`) state,
   **And** the existing full suite stays green under the alias (no regression; the alias does not mask a packaging problem — see Task 1 note on retaining build-mode honesty).

2. **Given** `packages/core/src/boundary-enforcement.test.ts` constructs a fresh `ESLint` instance per `it` case (`makeESLint()` → `new ESLint(...)`), so each case pays the typescript-eslint cold-start and the first run under full-suite parallel load can exceed the default 5000 ms per-test budget (the recurring review-gate flake — deferred-work 2.2, re-observed at the 2.2 and 2.4 gates),
   **When** the cold-start cost is removed from the per-test critical path (hoist a single shared `ESLint` instance / flat-config compile paid once, e.g. in a `beforeAll`, **and/or** give the ESLint-invoking cases an explicit generous per-test timeout),
   **Then** the boundary-enforcement cases no longer race a 5000 ms wall clock on a cold first run,
   **And** the full `pnpm test` suite is green across several consecutive cold runs (re-run enough times to demonstrate the flake is gone, not merely absent once),
   **And** the boundary rules are still genuinely exercised (the test still asserts the real `no-restricted-imports` / `no-restricted-syntax` rule IDs fire — coverage is unchanged, only the timing harness changed).

3. **Given** `recordSeen` (`packages/core/src/identity/record-seen.ts`) and `updateFocus` (`packages/core/src/identity/update-focus.ts`) both APPEND their event (`identity.seen` / `identity.focus_updated`) BEFORE the fail-loud read-back guard throws on an unregistered handle — so an unregistered handle leaves a dangling orphan event in the ledger (deferred-work 2.5, deferred as a class so both are fixed symmetrically),
   **When** both ops are reordered to **guard existence before the append** (read the identity back / check registration FIRST; only append once a prior `identity.registered` is confirmed), applied to BOTH ops as a class (directly or via a shared helper),
   **Then** calling either op for an unregistered handle throws WITHOUT writing any orphan event (the ledger is unchanged on the unregistered path),
   **And** the genuinely-broken-seam case is still fail-loud (if the append succeeds but the post-append read-back still misses, the op throws rather than fabricate an `Identity`),
   **And** the happy path is unchanged: for a registered handle each op still appends exactly one event and returns the updated `Identity` with `lastSeen` advanced (and `currentFocus` set, for `updateFocus`).

4. **Given** the two QA tests that currently pin the orphan-append as the contract — `record-seen.test.ts` "still APPENDS exactly one orphan identity.seen before failing" and "FAILS LOUD … mints NO phantom" (plus the mirrored `update-focus.test.ts` coverage and any real-ledger integration assertion) — encode the OLD (append-then-throw) behavior,
   **When** AC #3's guard-before-append change lands,
   **Then** those tests are updated to assert the NEW contract: the unregistered path writes **NO** orphan event (`identity.seen` / `identity.focus_updated` count stays 0; the ledger is empty after the throw) while STILL asserting the loud throw,
   **And** a test pins the retained broken-seam guard (append succeeded but read-back misses ⇒ still throws), so the defensive branch is not silently dropped,
   **And** the full suite (`pnpm run lint` / `typecheck` / `test` / `build` / `format`) is green.

5. **Given** the remaining LOW deferrals — 1.5 (append-invariant lint guard excludes `*.test.ts`, needs AST-level SQL matching) and 1.6 (`wireToPayload` does not validate payload shape for a known-type-but-malformed row) — are out of scope for this cleanup (no triggering consumer in Epic 3; each needs a larger design decision),
   **When** `deferred-work.md` is reconciled,
   **Then** the 2.2, 2.4, and 2.5 items are marked **RESOLVED** (with the resolving = this story + a one-line evidence citation; retained, not deleted),
   **And** 1.5 and 1.6 remain **OPEN** (carried forward) with their existing rationale intact,
   **And** the ledger snapshot accurately reflects: 2.2 RESOLVED (3.0), 2.4 RESOLVED (3.0), 2.5 RESOLVED (3.0), 1.5 OPEN, 1.6 OPEN.

6. **Given** Rule 2 (`project-rules.md` §2 — "build cross-package `dist/` before running cross-package tests") explicitly says **"delete or supersede this rule once the alias/pretest fix is in"**,
   **When** AC #1's Vitest `resolve.alias` lands and is proven,
   **Then** Rule 2 in `.claude/rules/project-rules.md` is superseded — either removed, or rewritten to record that the build-first dance is no longer required because cross-package specifiers now resolve to `src` (keep a one-line historical note pointing at this story),
   **And** the supersession is consistent with the build-ordering papercut no longer existing.

## Review Findings

Code review of Story 3.0 (2026-05-31, `bmad-code-review` under `/epic-cycle`, three review layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor, conducted directly). Reviewed the uncommitted working-tree changeset against baseline `8e9d789`.

**Verdict: APPROVE.** All 6 ACs met. Full gate re-run green by the reviewer: lint, typecheck, test (**267 passing / 39 files** — story noted 266; the +1 is a harmless count drift, not a regression), build, format. No HIGH or MEDIUM findings. Stage-rule checks: Rule 1 (Integration AC) N/A — not service-introducing, judgment holds; Rule 3 (real-runtime evidence) **satisfied** — the guard-before-append behavior is proven over the REAL SQLite ledger for BOTH ops in `record-seen.integration.test.ts` (`totalEvents() === 0` after the unregistered-path throw); Rule 5 (NFR) N/A — no NFR work; Rule 6 (ADR) N/A — no `docs/adr/`.

**Scrutiny items independently verified:**
- (a) The Vitest `src` alias does NOT mask a `dist`/`exports` packaging problem — `pnpm run build` is retained in the gate as the dist-honesty guard, and the reviewer empirically confirmed the proof test resolves from `src` (transiently tampered `core/dist`'s emitted value to `TAMPERED-DIST-VALUE`; the proof test still asserted the `src` value `agentbbs:core-src-alias:3.0` and passed → genuine `src` resolution, not stale dist; dist restored, and dist is git-ignored / not in the changeset).
- (b) The guard-before-append refactor preserves the exact happy-path contract for BOTH ops (one append, advanced `lastSeen`, `currentFocus` set for `updateFocus` — 12 happy-path unit cases green) AND retains the broken-seam fail-loud branch (covered in both unit files via a two-read `brokenSeam` stub).
- (c) The orphan-append test inversion genuinely asserts NO orphan — `eventsByType(...)` length 0 AND `eventsSince(0)`/`totalEvents()` length 0, not a weaker assertion.
- (d) Rule 2 supersession in `project-rules.md` is coherent — heading/number retained (no dangling references in `deferred-work.md` / Epic 2 retro / this story), residual dist-guard guidance present, Rule 3 untouched.

- [x] [Review][Defer] Test-only alias-proof fixture (`CROSS_PACKAGE_ALIAS_PROOF` / `crossPackageAliasProof`) is a PERMANENT public export in the `@agentbbs/core` barrel (ships in `dist/` forever) [packages/core/src/index.ts:53; packages/core/src/cross-package-alias-proof.ts] — deferred (3.0-a, LOW). Deliberate, documented trade-off; the proof test depends on it being a real cross-package export, so it cannot be removed without removing the proof's subject. Retire once Epic 3's first real `core`→`mcp-server` export becomes the living proof. Logged to deferred-work.md.
- [x] [Review][Defer] Guard-before-append doubles the per-call ledger read on the `recordSeen`/`updateFocus` happy path (two `eventsByActor` + fold reads vs one) [packages/core/src/identity/append-identity-event.ts:56,71] — deferred (3.0-b, LOW). Inherent to AC #3's mandated pre-append existence guard, not a defect; index-scoped, cheap at V1 scale. Flagged for the Story 6.1 `check` hot-path author to measure. Logged to deferred-work.md.

## Tasks / Subtasks

- [x] Task 1: Add a Vitest `resolve.alias` for cross-package `src` resolution (AC: #1)
  - [x] In root `vitest.config.ts`, add a `resolve.alias` (at the top level AND inside the `agentbbs` project's config so it applies to the project run) mapping each workspace specifier to its source barrel: `@agentbbs/core` → `packages/core/src/index.ts`, `@agentbbs/data-access` → `packages/data-access/src/index.ts`, `@agentbbs/mcp-server` → `packages/mcp-server/src/index.ts`, `@agentbbs/cli` → `packages/cli/src/index.ts`, `@agentbbs/ui-shared` → `packages/ui-shared/src/index.ts`. Use absolute paths derived from `import.meta.url` / `fileURLToPath` + `path.resolve` (the config is ESM).
  - [x] Verify deep subpath imports (if any package exposes `@agentbbs/<pkg>/<subpath>` in its `exports`) are not silently broken by the barrel alias; alias only the package roots unless a deep specifier is actually imported by a test. (Current consumers import the barrels — confirm with a quick grep.) — Grep found `@agentbbs/<pkg>/<subpath>` only inside ESLint fixture STRING LITERALS in boundary-enforcement.test.ts (never resolved); no real deep import exists. Object-form alias does exact-string match (root-only).
  - [x] **Build-mode honesty (avoid masking a real `dist`/`exports` problem):** keep at least one assurance that the shipped `dist` artifact is still valid — either retain `pnpm run build` in the gate (it already runs) so a broken barrel `exports` still surfaces at build time, or leave a short comment in `vitest.config.ts` documenting that tests run against `src` and the build step is the `dist` guard. Do NOT add per-package vitest configs (the single-root-config invariant from Story 1.2 stands). — Documented in the config header; `pnpm run build` retained in the Task 7 gate as the `dist` guard; no per-package configs added.
  - [x] Prove it: from a clean/stale-`dist` state (e.g. after `rm -rf packages/core/dist` or before any build), run the targeted cross-package test from AC #1's proof and confirm it passes (the new `core` export is visible via `src`). — RED (pre-alias, stale dist): `CROSS_PACKAGE_ALIAS_PROOF` undefined / `crossPackageAliasProof is not a function`. GREEN (post-alias, SAME stale dist): 2/2 pass. mcp-server+core (179 tests) green under alias.
- [x] Task 2: Kill the `boundary-enforcement.test.ts` cold-start flake (AC: #2)
  - [x] Preferred: hoist the shared `ESLint` instance so the typescript-eslint flat-config compile is paid ONCE — construct it in a module-level `beforeAll` (or a memoized singleton) and reuse it across all `lint(...)` calls, instead of `new ESLint(...)` per case. `ESLint.lintText` is safe to reuse across calls (no fixes are applied). AND/OR give the ESLint-invoking cases an explicit generous timeout (e.g. `it(name, { timeout: 30_000 }, …)`), mirroring how `register-race.test.ts` sets its timeout. — DID BOTH: single `sharedESLint` built in `beforeAll`; all four ESLint-invoking `describe`s given `{ timeout: 30_000 }`. `lintText` reuse safety confirmed against eslint's installed `.d.ts` (read-only across calls).
  - [x] Keep every existing assertion (the rule-ID expectations) intact — only the instance lifecycle / timeout changes, never the coverage. — Unchanged: still 19/19 cases asserting the same `no-restricted-imports` / `no-restricted-syntax` / `unicorn/filename-case` / `import-x/no-default-export` rule IDs.
  - [x] Re-run the FULL `pnpm test` several consecutive times from cold (no warm cache advantage) to demonstrate the first-run flake is gone — capture the run count in the Dev Agent Record. — 3 consecutive COLD `vitest run` (fresh process each): 262/262 green every run, no 5000 ms timeout on the boundary cases. Captured in Dev Agent Record.
- [x] Task 3: Guard-before-append for `recordSeen` AND `updateFocus` as a class (AC: #3)
  - [x] Reorder both ops so the existence/registration check precedes the append. Option A (per-op): read `eventsByActor(handle)` → `findIdentity`; if absent, throw a clear "not registered" error WITHOUT appending; else append the one event, then read back and return (retain a post-append defensive throw for the broken-seam case). Option B (shared helper): extract a single `appendIdentityEventOrThrow(dataAccess, handle, event)` that performs the pre-append existence check + append + read-back, and call it from both ops — preferred if it cleanly removes the duplication without obscuring the per-op event shape. — Chose **Option B**: new `packages/core/src/identity/append-identity-event.ts` exports `appendIdentityEventOrThrow(dataAccess, handle, opName, buildEvent)`. Pre-append `findIdentity` guard (throw, no append if unregistered) → append the one `buildEvent()` event → read-back → broken-seam throw. Both ops delegate; each supplies its own event shape via `buildEvent`, so the per-op shape stays visible.
  - [x] Preserve the happy-path contract exactly: registered handle ⇒ exactly one appended event, returned `Identity` with advanced `lastSeen` (and new `currentFocus` for `updateFocus`). — All 12 happy-path unit cases (success/append-only/multi-ping/isolation) still green; only the 2 orphan-pinning cases fail (expected — rewritten in Task 4).
  - [x] Keep the throw fail-loud and typed/clear; update the inline comments (both files currently describe the append-then-throw structure — rewrite them to describe guard-before-append). — Two distinct loud throws (unregistered-handle pre-guard vs broken-seam post-append); JSDoc + inline comments in record-seen.ts / update-focus.ts / append-identity-event.ts rewritten to describe guard-before-append.
- [x] Task 4: Update the QA tests pinned to the old orphan-append contract (AC: #4)
  - [x] In `record-seen.test.ts`: invert "still APPENDS exactly one orphan identity.seen before failing" to assert NO `identity.seen` is written on the unregistered path (`eventsByType('identity.seen')` length 0; `eventsSince(0)` length 0). Keep the loud-throw assertion (adjust the expected message/shape to the new pre-append guard). — Done: now asserts 0 seen + empty ledger; throw matches `/not registered/`.
  - [x] Mirror the same NO-orphan + loud-throw coverage for `updateFocus` in `update-focus.test.ts` (add it if the unregistered-path case is currently missing there — the class fix must be symmetrically tested). — Added a new `updateFocus — no phantom identity / guard-before-append` describe (was missing): no-phantom throw, NO-orphan ledger-unchanged, broken-seam.
  - [x] Add/keep a test for the retained broken-seam guard (append succeeded but read-back misses ⇒ still throws) so the defensive branch stays covered — e.g. a data-access stub whose `append` is a no-op or whose `eventsByActor` returns nothing post-append. — Both files: a `brokenSeam` DataAccess returns the registration on the 1st (pre-append) read and nothing on the 2nd (post-append) read, append is a no-op ⇒ asserts the `/not found in its own event stream after a successful append/` throw and that both reads ran.
  - [x] Confirm no other test (unit or real-ledger integration) still asserts an orphan is written; update any that do. — `record-seen.integration.test.ts` unregistered case rewritten to assert NO orphan (totalEvents 0). Grep confirmed no mcp-server test pins orphan-append (the `ghost` refs are unrelated `login` unregistered-path tests). Updated the stale "resolves via BUILT dist" header comment in the integration test.
- [x] Task 5: Reconcile `deferred-work.md` (AC: #5)
  - [x] Mark 2.2 RESOLVED (this story — flake fixed), 2.4 RESOLVED (this story — Vitest `src` alias), 2.5 RESOLVED (this story — guard-before-append applied to both ops). Each retains its original Summary/Rationale/Suggested-resolution; add a one-line Resolution with the evidence. — Done: each got a `**Resolution:**` line; original prose retained below it.
  - [x] Leave 1.5 and 1.6 OPEN (carried forward), rationale intact. — Untouched; both remain OPEN with their original text.
  - [x] Update the ledger snapshot line to reflect the new state. — Now reads "reconciled by Story 3.0": 1.2/1.4 RESOLVED, 1.5/1.6 OPEN, 2.2/2.4/2.5 RESOLVED (3.0).
- [x] Task 6: Supersede Rule 2 in `.claude/rules/project-rules.md` (AC: #6)
  - [x] Per Rule 2's own instruction ("delete or supersede this rule once the alias/pretest fix is in"), rewrite or remove Rule 2 now that the alias is in place. Recommended: replace its body with a short "SUPERSEDED by Story 3.0 — cross-package specifiers now resolve to `src` via the Vitest `resolve.alias`, so the build-first dance is no longer required" note (keep the heading/number so existing references don't dangle), or remove it and renumber — pick whichever keeps the file coherent. Document the choice in the Dev Agent Record. — Chose **keep-heading + supersede body** (not delete/renumber): Rule 2's heading is struck through and marked SUPERSEDED (Story 3.0), with a residual "build is the `dist` guard, not a test prerequisite" note. Keeping the number avoids dangling references in deferred-work.md / the Epic 2 retro / this story. Rule 3 is untouched. Choice documented in the Dev Agent Record.
- [x] Task 7: Full-gate verification (AC: #1, #2, #4)
  - [x] Run, in order: `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run format` (`--check`). All green. — All five green. NB: `pnpm run typecheck` resolves `@agentbbs/core` via the package `exports` → `dist/.d.ts` (the Vitest `src` alias is test-only), so the gate must `pnpm run build` BEFORE typecheck when a new cross-package export was added (build is the `dist`-artifact guard — confirms the new barrel export is valid in the shipped artifact). Final order run: lint → build → typecheck → test → build → format, all green.
  - [x] Confirm the test count did not regress (Epic 2 closed at 259 passing / 38 files; the orphan-test edits change assertions, not count materially — note the final count). — Final: **266 passing / 39 files** (no regression; +7 net from added coverage: +2 alias proof, +1 record-seen broken-seam, +3 update-focus guard cases, +1 net from the record-seen orphan-case rewrite; +1 file = the new mcp-server proof test).

## Dev Notes

This is a **housekeeping / internal-tooling + small-hardening story** — it touches test configuration (`vitest.config.ts`), a test harness (`boundary-enforcement.test.ts`), two existing `core` identity primitives (`record-seen.ts`, `update-focus.ts`) + their tests, a tracking document (`deferred-work.md`), and a rules file (`project-rules.md`). It introduces **no new service, MCP tool, or user-facing surface** — it hardens and de-flakes existing surfaces and removes a build-ordering papercut.

- **Rule 1 (Integration ACs):** N/A — not service-introducing. No new public surface for a later story to consume; the `recordSeen`/`updateFocus` changes are behavior-preserving on the happy path (the existing Story 6.1 `check` / Epic 4 post consumers are unaffected — they only ever pass a registered handle).
- **Rule 3 (real-runtime test evidence):** AC #1 carries its own real test (the cross-package `src`-resolution proof). AC #2/#3/#4 are exercised by the existing + updated Vitest suite running against real ESLint and the real fold/append seam. No new MCP tool ⇒ no stdio smoke required for a new surface; the lead's per-story smoke is a library/test-harness exercise (see Smoke note).
- **Rule 5 (NFR tripwire):** N/A — no NFR work.
- **Rule 6 (ADR):** N/A — project has no `docs/adr/` registry (confirmed at epic pre-flight).

### Source facts (verified at story creation, baseline `8e9d789`)

- **Vitest config** is a single root `vitest.config.ts` using `test.projects` (one `agentbbs` project; include glob `packages/*/src/**/*.test.{ts,tsx}` + `apps/*/...`). There is currently **no `resolve.alias`** — cross-package specifiers resolve through each package's `exports` → `dist/`. Package→source map (all `src/index.ts` confirmed present): `@agentbbs/core` → `packages/core/src/index.ts`, `@agentbbs/data-access`, `@agentbbs/mcp-server`, `@agentbbs/cli`, `@agentbbs/ui-shared`.
- **`boundary-enforcement.test.ts`**: `makeESLint()` returns `new ESLint({ cwd: repoRoot })` and is called once per `it` via `lint(code, filePath)` — ~20 cases, each paying a fresh cold-start. No `beforeAll`, no per-test timeout override. `lintText` applies no fixes, so a single shared instance is safe to reuse.
- **`record-seen.ts` / `update-focus.ts`**: identical structure — `await dataAccess.append([...])` FIRST, then `eventsByActor(handle)` → `findIdentity`, then `if (!identity) throw new Error("…not found in its own event stream after append.")`. The orphan event is therefore written before the guard fires for an unregistered handle.
- **Orphan-append tests** live in `packages/core/src/identity/record-seen.test.ts` (lines ~240–279): "FAILS LOUD … mints NO phantom" (asserts the throw + no directory entry) and "still APPENDS exactly one orphan identity.seen before failing" (asserts exactly one orphan `identity.seen` lands + `eventsSince(0)` length 1). `update-focus.test.ts` does NOT currently have the symmetric unregistered-path case (grep shows only the shared `maxSeq` stub) — add it as part of the class fix. No mcp-server / integration test pins the orphan behavior.
- **Rule 2** (`project-rules.md` §2) self-describes as superseding-when-fixed: "**Preferred permanent fix … add a Vitest `resolve.alias` mapping `@agentbbs/*` → each package's `src/index.ts` …** Until that lands, build-first is mandatory and this rule stands; **delete or supersede this rule** once the alias/pretest fix is in." This story lands exactly that fix.
- Toolchain (Rule 9, verified Epic 1/2): Node v24.16.0 (`>=24`), pnpm 11.3.0 — match.

### Project Structure Notes

- `vitest.config.ts` is ESM (`import { defineConfig } from 'vitest/config'`); build alias paths with `fileURLToPath(import.meta.url)` + `path.resolve`. The single-root-config invariant (Story 1.2 — packages extend, never define their own config) MUST be preserved; add the alias to the one root file, not per-package.
- The `recordSeen`/`updateFocus` change is intra-`core` (the consuming tests are in `packages/core/src/identity/`), so it does NOT hit the build-ordering papercut itself — but Task 1's alias is the thing that makes Epic 3's NEW cross-package `core` exports (e.g. `announceProject`, `joinBoard`, `PROJECT_EXISTS`) immediately visible to `mcp-server` tests, which is the whole point of doing 2.4 now.
- After Task 1, the historical reason for "build before cross-package tests" is gone; ensure `pnpm run build` remains in the gate ONLY as the `dist`-artifact validity guard, not as a test prerequisite.

### Smoke note (lead-side, per-story gate)

No new MCP tool/CLI/service is introduced, so the smoke is a **library/harness exercise**, not an stdio-tool drive: the lead (a) demonstrates the cross-package `src` alias by running a cross-package test from a stale-`dist` state and observing it green (the 2.4 papercut is gone), and (b) demonstrates the guard-before-append by exercising `recordSeen`/`updateFocus` against a real `data-access` ledger for an unregistered handle and asserting out-of-band that the ledger has NO orphan row (`maxSeq` unchanged) — the user-observable outcome AC #3 promises.

### References

- [Source: _bmad-output/implementation-artifacts/epic-2-retro-2026-05-31.md#Action Items] — Actions C (build-ordering), D (boundary flake), E (orphan-append), F (Epic 1 LOWs).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — 2.2, 2.4, 2.5 (resolve here); 1.5, 1.6 (carry forward).
- [Source: .claude/rules/project-rules.md#2] — Rule 2 (supersede on alias fix) and Rule 3 (verify installed `.d.ts`).
- [Source: vitest.config.ts] — single-root-config + `test.projects`.
- [Source: packages/core/src/identity/record-seen.ts, update-focus.ts] — the two orphan-append ops.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]` (via `/bmad-dev-story` under `/epic-cycle`).

### Debug Log References

- **Task 1 RED/GREEN proof (stale-`dist` papercut):** with the pre-existing stale `packages/core/dist`, `npx vitest run packages/mcp-server/src/cross-package-alias.proof.test.ts` was RED — `CROSS_PACKAGE_ALIAS_PROOF` resolved `undefined`, `crossPackageAliasProof is not a function` (the `@agentbbs/core` specifier hit the stale `dist`). After adding the `resolve.alias` to `vitest.config.ts` (NO rebuild), the SAME stale-`dist` state went GREEN (2/2). mcp-server + core (179 tests) green under the alias from stale dist.
- **Task 2 flake demonstration:** 3 consecutive COLD `vitest run`s (fresh process each, no warm cache) → 262/262 green every run; the boundary-enforcement cases never hit the 5000 ms timeout.
- **Task 3/4 RED→GREEN:** after the guard-before-append refactor, the 2 old orphan-pinning cases in `record-seen.test.ts` failed (`expected [] to have length 1`) — the expected RED proving the orphan is no longer written. After inverting/adding the tests, all 26 identity+integration cases green.
- **Task 7 typecheck ordering note:** `pnpm run typecheck` first failed `TS2305: Module '"@agentbbs/core"' has no exported member 'CROSS_PACKAGE_ALIAS_PROOF'` — `tsc` resolves the package `exports` → `dist/.d.ts` (the Vitest `src` alias is test-only, it does not affect `tsc`). Resolved by `pnpm run build` first (the build is the `dist`-artifact guard); typecheck then clean. This is the residual guidance recorded in the superseded Rule 2.

### Completion Notes List

- **Task 1 (Vitest `src` alias — AC #1):** Added `resolve.alias` to root `vitest.config.ts` (top-level AND inside the `agentbbs` project config) mapping `@agentbbs/{core,data-access,mcp-server,cli,ui-shared}` → each package's `src/index.ts` (absolute paths via `fileURLToPath(import.meta.url)` + `path.resolve`). Object-form alias = exact-string match (package roots only); confirmed no real deep `@agentbbs/<pkg>/<subpath>` import exists (the only deep specifiers are inside ESLint fixture string literals). Proof: new `packages/core/src/cross-package-alias-proof.ts` exports a fresh sentinel + function, re-exported from the core barrel, exercised cross-package by `packages/mcp-server/src/cross-package-alias.proof.test.ts` from a stale-`dist` state. Build-mode honesty documented in the config header; `pnpm run build` retained as the `dist` guard; no per-package configs (single-root invariant preserved).
- **Task 2 (boundary flake — AC #2):** Hoisted a single shared `ESLint` into a `beforeAll` (flat-config compile paid once, not ~20×) and gave all four ESLint-invoking `describe`s `{ timeout: 30_000 }`. `lintText` reuse safety confirmed against eslint's installed `.d.ts` (stateless across calls; no fixes). Coverage unchanged (same rule-ID assertions, 19/19).
- **Task 3 (guard-before-append — AC #3):** Chose the shared-helper option (Option B): new `packages/core/src/identity/append-identity-event.ts` → `appendIdentityEventOrThrow(dataAccess, handle, opName, buildEvent)`. Order is now: read + `findIdentity` FIRST → throw "…not registered…" WITHOUT appending if absent → append the one `buildEvent()` event → read back → throw "…after a successful append…" on a broken seam. `recordSeen` and `updateFocus` both delegate, each supplying its own event shape (per-op shape stays visible). Happy path unchanged.
- **Task 4 (QA tests — AC #4):** `record-seen.test.ts` orphan cases inverted to assert NO orphan + the new throw; added a broken-seam case. `update-focus.test.ts` gained the previously-missing symmetric unregistered-path coverage (no-phantom, no-orphan, broken-seam). `record-seen.integration.test.ts` unregistered case rewritten to assert `totalEvents() === 0` (no orphan on the real SQLite ledger) and its stale "resolves via BUILT dist" header comment updated. Confirmed no mcp-server test pinned the orphan-append contract.
- **Task 5 (deferred-work.md — AC #5):** 2.2 / 2.4 / 2.5 marked RESOLVED (Story 3.0) each with a one-line evidence `**Resolution:**` (original prose retained); 1.5 / 1.6 left OPEN untouched; ledger snapshot updated to "reconciled by Story 3.0".
- **Task 6 (Rule 2 supersession — AC #6):** Kept the heading/number (avoids dangling references) and struck through + marked it SUPERSEDED (Story 3.0), with residual guidance that the build is the `dist` guard, not a test prerequisite. Rule 3 untouched.
- **Task 7 (gate):** lint / typecheck / test / build / format all green. Final test count 266 passing / 39 files (no regression vs Epic 2's 259/38; +7 from added coverage, +1 file = the proof test).

### File List

- `vitest.config.ts` (modified — `resolve.alias` for cross-package `src` resolution)
- `packages/core/src/index.ts` (modified — re-export the alias-proof sentinel/function)
- `packages/core/src/cross-package-alias-proof.ts` (new — test-only proof fixture)
- `packages/core/src/boundary-enforcement.test.ts` (modified — shared ESLint `beforeAll` + per-`describe` timeouts)
- `packages/core/src/identity/append-identity-event.ts` (new — shared guard-before-append helper)
- `packages/core/src/identity/record-seen.ts` (modified — delegate to the helper; comments rewritten)
- `packages/core/src/identity/update-focus.ts` (modified — delegate to the helper; comments rewritten)
- `packages/core/src/identity/record-seen.test.ts` (modified — no-orphan + broken-seam contract)
- `packages/core/src/identity/update-focus.test.ts` (modified — added symmetric guard-before-append coverage)
- `packages/mcp-server/src/cross-package-alias.proof.test.ts` (new — cross-package `src`-alias proof)
- `packages/data-access/src/record-seen.integration.test.ts` (modified — no-orphan over the real ledger)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — 2.2/2.4/2.5 RESOLVED; snapshot)
- `.claude/rules/project-rules.md` (modified — Rule 2 superseded)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — 3.0 in-progress → review)
- `_bmad-output/implementation-artifacts/3-0-epic-2-deferred-cleanup.md` (modified — this story file)

## Change Log

| Date       | Change                                                                                 |
|------------|----------------------------------------------------------------------------------------|
| 2026-05-31 | Story 3.0 created by the /epic-cycle retro-review gate (triages Epic 2 retro Actions C–F + deferred-work 2.2/2.4/2.5; defers 1.5/1.6). Status → ready-for-dev. |
| 2026-05-31 | Dev implemented all 7 tasks: Vitest `src` alias (+ cross-package proof), boundary-flake fix (shared ESLint + timeouts), guard-before-append helper for recordSeen/updateFocus + QA test updates, deferred-work reconcile (2.2/2.4/2.5 RESOLVED), Rule 2 superseded. Full gate green (lint/typecheck/test 266✓/build/format). Status → review. |

## Triage Table — Epic 2 retrospective + deferred-work.md (covers Epic 2; dated 2026-05-31)

| Item | Source | Triage Decision |
|---|---|---|
| Action A — Codify build-ordering papercut (Rule 2) | epic-2 retro | **Drop** — already DONE (`project-rules.md` Rule 2); no work remaining (this story now SUPERSEDES it via AC #6). |
| Action B — Codify "verify version-specific API against installed `.d.ts`" (Rule 3) | epic-2 retro | **Drop** — already DONE (`project-rules.md` Rule 3); no work remaining. |
| Action C / 2.4 LOW — permanent fix for the build-ordering papercut (Vitest `src` alias / `pretest`); then supersede Rule 2 | epic-2 retro / deferred-work.md | **Include in Story 3.0** (Task 1 + Task 6 / AC #1 + #6) — Vitest `resolve.alias` to `src`; supersede Rule 2. High value: Epic 3 adds many `core` exports consumed by `mcp-server`. |
| Action D / 2.2 LOW — `boundary-enforcement.test.ts` cold-start flake under parallel load | epic-2 retro / deferred-work.md | **Include in Story 3.0** (Task 2 / AC #2) — hoist shared ESLint instance and/or generous per-test timeout; reds the review gate every epic. |
| Action E / 2.5 LOW — orphan-append before the fail-loud guard in `recordSeen` + `updateFocus` (as a class) | epic-2 retro / deferred-work.md | **Include in Story 3.0** (Tasks 3–4 / AC #3 + #4) — guard-before-append applied to BOTH ops symmetrically; update the two pinning QA tests. |
| Action F / 1.5 LOW — append-invariant lint guard excludes `*.test.ts` | epic-2 retro / deferred-work.md | **Defer** — needs AST-level SQL-lint matching (large); low-risk (test helpers don't ship, are reviewed); no trigger in Epic 3. Remains OPEN. |
| Action F / 1.6 LOW — `wireToPayload` no payload-shape validation for known-type-but-malformed row | epic-2 retro / deferred-work.md | **Defer** — add when a `core` projection consumer needs corruption-tolerance; Epic 3 projections read the same trusted ledger, no such need yet. Remains OPEN. |
