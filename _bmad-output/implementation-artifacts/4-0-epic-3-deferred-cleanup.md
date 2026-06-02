---
baseline_commit: 5ef57e0f438635f70a635b0dc07a662ddbf11252
---

# Story 4.0: Epic 3 Deferred Cleanup

Status: done

<!-- Cleanup story — not in epics.md. Created by the /epic-cycle Retrospective Review & Story X.0 gate. -->
<!-- Triages the Epic 3 retrospective Action Items (A–E) + deferred-work.md OPEN items before Epic 4 feature work begins. -->

## Story

As the project lead,
I want the carried-forward Epic 3 housekeeping items resolved before Epic 4 feature work begins,
so that Epic 4 (which adds six new MCP post/read tools and several new `core` event types + projections consumed by `mcp-server`) starts with a typecheck gate that no longer needs a manual build-first dance for cross-package source, and with the public `@agentbbs/core` API surface free of the now-redundant test-only alias-proof fixture.

## Acceptance Criteria

1. **Given** `pnpm run typecheck` (`tsc --noEmit -p tsconfig.typecheck.json`) resolves cross-package `@agentbbs/*` specifiers through each package's `exports` map → built `dist/*.d.ts`, so a newly-added cross-package `core` export trips `TS2305` ("has no exported member") until `pnpm run build` is run first (the recurring Epic 2/3 build-first papercut — deferred-work **E3-typecheck-dist**; every Epic 3 dev/QA/CR stage hit this transient false-red and built first),
   **When** `tsconfig.typecheck.json` is given a `paths` mapping (with the necessary `baseUrl`) that maps each `@agentbbs/<pkg>` specifier to that package's `src/index.ts` — mirroring the Story 3.0 Vitest `resolve.alias` — so the single non-composite typecheck pass resolves cross-package specifiers to live TypeScript **source** rather than `dist/*.d.ts`,
   **Then** `pnpm run typecheck` resolves cross-package `core` exports from `src` and no longer requires a prior build,
   **And** this is proven by deleting the built output (`rm -rf packages/*/dist`, or at minimum `packages/core/dist`) and running `pnpm run typecheck` GREEN from that no-`dist` state (before the `paths` mapping, the same command reds with `TS2305`/module-resolution errors on every cross-package `@agentbbs/*` import),
   **And** the production build is unaffected — `pnpm run build` (`pnpm -r build` → per-package `tsc -b`) still compiles each package against the real `exports`/`dist` and stays in the gate as the shipped-artifact guard, so the `paths` mapping (typecheck-config-only) does not mask a broken barrel `exports`.

2. **Given** the cross-package alias-proof fixture (`packages/core/src/cross-package-alias-proof.ts`, exporting `CROSS_PACKAGE_ALIAS_PROOF` / `crossPackageAliasProof`) is a PERMANENT public member of the shipped `@agentbbs/core` barrel (`packages/core/src/index.ts`) whose ONLY purpose is to be a fresh cross-package export for the Story 3.0 Vitest `src`-alias proof test (`packages/mcp-server/src/cross-package-alias.proof.test.ts`) — and Epic 3 has since shipped many REAL `core` exports consumed cross-package by `mcp-server` tests, which are now the living, operational proof of the alias (deferred-work **3.0-a**; Epic 3 retro Action C),
   **When** the synthetic fixture, its barrel re-export, and the dedicated proof test are retired (delete `cross-package-alias-proof.ts`; remove the `CROSS_PACKAGE_ALIAS_PROOF` / `crossPackageAliasProof` re-export block from `packages/core/src/index.ts`; delete `packages/mcp-server/src/cross-package-alias.proof.test.ts`; remove any remaining reference, verified by grep),
   **Then** the public `@agentbbs/core` surface no longer ships a test-only sentinel (it is gone from `core/dist` after a rebuild),
   **And** the Story 3.0 Vitest `resolve.alias` is still proven to resolve from `src` (not `dist`) by deleting `packages/core/dist` and running the FULL `pnpm test` suite GREEN from that no-`dist` state — every cross-package `@agentbbs/core` import in `mcp-server`/`cli` tests resolves to source (without the alias, a deleted `core/dist` would break those imports with module-not-found), so the dedicated synthetic proof is genuinely redundant before it is removed.

3. **Given** the remaining LOW deferrals are out of scope for this cleanup — **1.5** (append-invariant lint guard excludes `*.test.ts`; needs AST-level SQL-call-site matching, no Epic 4 trigger), **1.6** (`wireToPayload` does not validate payload shape for a known-type-but-malformed row; a corruption-tolerance concern with no Epic 4 trigger), **3.0-b** (guard-before-append doubles the `recordSeen`/`updateFocus` per-call read; explicitly a Story 6.1 `check` hot-path measurement item), and **E3-tool-names** (the MCP tool names/envelopes are not contract-pinned; Epic 7's `mcp-tool-contract.md` is the ratification point) —
   **When** `deferred-work.md` is reconciled,
   **Then** **E3-typecheck-dist** is marked **RESOLVED** (resolving story = this 4.0 + a one-line evidence citation; retained, not deleted) and **3.0-a** is marked **RESOLVED** (this 4.0),
   **And** 1.5, 1.6, 3.0-b, and E3-tool-names remain **OPEN** (carried forward) with their existing rationale intact (3.0-b still pointed at Story 6.1; E3-tool-names still pointed at Epic 7),
   **And** the ledger-snapshot line is updated to reflect: E3-typecheck-dist RESOLVED (4.0), 3.0-a RESOLVED (4.0), 1.5 OPEN, 1.6 OPEN, 3.0-b OPEN, E3-tool-names OPEN.

4. **Given** the full quality gate must stay green across the changes,
   **When** the gate is run in an order that is honest about the `dist` artifact,
   **Then** `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, `pnpm test`, and `pnpm run format` (`--check`) are all GREEN,
   **And** the test count does not regress except for the deliberate removal of the 2 retired alias-proof cases (note the exact final count and that the −2 is the fixture retirement, not a lost assertion).

## Review Findings

**Code-review stage (2026-05-31) — ✅ CLEAN. 0 decision-needed · 0 patch · 0 defer · 0 dismissed. 0 HIGH / 0 MED.**

Adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor) found nothing. Every AC was **independently re-verified** (not taken on the Dev Agent Record's word):

- **AC #1 (typecheck `paths` → `src`):** Re-proven from a fully no-`dist` state (`rm -rf packages/*/dist packages/*/*.tsbuildinfo`): `pnpm run typecheck` GREEN (exit 0); `tsc --traceResolution` confirms `@agentbbs/core` → `C:/git/agentbbs/packages/core/src/index.ts` (live source). The `paths` block is **typecheck-config-ONLY** — grep confirms NO `paths`/`baseUrl` in `tsconfig.base.json` or any package build config; the only `"paths"` key in any tsconfig is `tsconfig.typecheck.json:74`. The mapping did NOT mask a packaging problem: a clean `pnpm run build` from no-`dist` compiled all **7/7** projects green against the real `exports`/`dist`. The 5 mappings match the Vitest `resolve.alias` set exactly (core, data-access, mcp-server, cli, ui-shared).
- **No-`baseUrl` decision (project-rules Rule 3):** validated against the INSTALLED TS **6.0.3** with a 3-config empirical probe — `baseUrl: "."` (story's literal Task 1 spec) → `TS5101` deprecation (exit 2); no-`baseUrl` + non-relative target → `TS5090` (exit 2); no-`baseUrl` + relative `./`-target (the SHIPPED choice) → exit 0. Omitting `baseUrl` with relative targets is the correct and only clean call for the installed compiler. The dev's deviation from the story's literal spec is correct and documented.
- **AC #2 (fixture retirement):** Repo-wide grep for `CROSS_PACKAGE_ALIAS_PROOF` / `crossPackageAliasProof` / `cross-package-alias-proof` — the ONLY code/config hit is `vitest.config.ts` (comment-only, repointed at the living proof); the other 4 are tracking/rules Markdown (history, acceptable). Re-proven from no-`dist`: FULL `pnpm test` GREEN (50 files / 322 tests) — every cross-package `@agentbbs/core` import in mcp-server/cli resolves to `src` via the surviving alias WITHOUT the sentinel. After rebuild, `core/dist/index.d.ts` has **0** occurrences of the sentinel and **3** of the real exports (`announceProject`/`requireMembership`/`joinBoard`). No production code ever imported the sentinel. No real deep-subpath `@agentbbs/<pkg>/<subpath>` import exists (the 2 hits are ESLint forbidden-import fixture string literals in `boundary-enforcement.test.ts`, not module imports).
- **AC #3 (deferred-work reconciliation):** E3-typecheck-dist + 3.0-a → RESOLVED (Story 4.0) with `**Resolution:**` evidence lines, originals retained; 1.5/1.6/3.0-b/E3-tool-names → OPEN with rationale intact (3.0-b → Story 6.1; E3-tool-names → Epic 7). Ledger-snapshot line (deferred-work.md:7) accurate against every entry heading.
- **AC #4 (full gate, honest order):** Re-run end-to-end — `lint` 0 · `build` 0 (7/7) · `typecheck` 0 · `test` 0 (50 files / **322** tests) · `format --check` 0 ("All matched files use Prettier code style!"). Count delta verified exact: the deleted proof test had precisely **2** `it()` cases; it is the ONLY `*.test.ts` deleted; NO other `*.test.ts(x)` was modified — so 324 − 2 = 322 is solely the fixture retirement, not a lost assertion elsewhere. The full suite passes IDENTICALLY (322) from both dist-present and no-`dist` states — strongest proof the alias, not stale `dist`, does the work.

**QA's 0-tests decision — VALIDATED (sound).** The changeset introduces **zero new runtime/exported symbols and zero new code paths** — the only `.ts` source changes are a DELETION (`cross-package-alias-proof.ts`) + a pure barrel removal (`index.ts`, no `+export`) + a comment-only `vitest.config.ts` edit (alias logic byte-identical). There is therefore no user-facing/runtime surface to test, so Rule 3's HIGH does not apply; its real-runtime evidence is the no-`dist` gate proofs (independently re-run green above). No honest, durable, `vitest run`-discoverable regression test is missing: an AC #1 "typecheck-resolves-from-`src`" assertion **cannot** live in Vitest (Vitest uses its own esbuild alias and never consults `tsconfig.typecheck.json`) — the gate's `typecheck` step IS that guard; an AC #2 synthetic "alias-from-`src`" test would merely re-create the fixture being retired, where the surviving real-export cross-package suite (green from no-`dist`) is the superior standing proof. Mirrors the Epic 3 3.3/3.4 config/deletion-cleanup precedent.

**Rule check:** Rule 1 N/A (housekeeping + deletion, no service introduced). Rule 3 satisfied (no untested runtime surface; real evidence = no-`dist` gate proofs). Rule 5 N/A (no NFR). Rule 6 N/A (no `docs/adr/` registry). No deferred items generated by this review (the deferred-work.md reconciliation is the subject under review, verified correct — nothing to add).

## Tasks / Subtasks

- [x] Task 1: Add a `paths` mapping to `tsconfig.typecheck.json` for cross-package `src` resolution (AC: #1)
  - [x] First read `tsconfig.base.json` to confirm whether it already sets `baseUrl` / `paths` (do not clobber an inherited mapping; merge intent). Add to `tsconfig.typecheck.json` `compilerOptions`: `"baseUrl": "."` (the config sits at repo root) and a `"paths"` block mapping every workspace specifier to its source barrel — `"@agentbbs/core": ["packages/core/src/index.ts"]`, `"@agentbbs/data-access": ["packages/data-access/src/index.ts"]`, `"@agentbbs/mcp-server": ["packages/mcp-server/src/index.ts"]`, `"@agentbbs/cli": ["packages/cli/src/index.ts"]`, `"@agentbbs/ui-shared": ["packages/ui-shared/src/index.ts"]`. (TypeScript 4.1+ permits `paths` without `baseUrl`, but set `baseUrl: "."` for an unambiguous, explicit root.) Map package ROOTS only (mirror the Vitest alias exactly); no deep `@agentbbs/<pkg>/<subpath>` specifier is imported by any source/test (confirm with a grep, as Story 3.0 did). — DONE. `tsconfig.base.json` confirmed to have NO `baseUrl`/`paths` (nothing to clobber). All five package roots mapped, mirroring the Vitest alias exactly. Grep confirmed NO real deep-subpath import (only two `@agentbbs/data-access/src/...` STRING LITERALS inside `boundary-enforcement.test.ts`, which are forbidden-import assertion fixtures fed to ESLint, not module imports). **Deviation (verified against installed TS 6.0.3 — see Debug Log):** omitted `baseUrl` instead of setting `"."` — `baseUrl` is deprecated (`TS5101`) in the installed TS 6.0.3 and removed in TS 7.0; `paths` works without it when each target is written relative (leading `./`), resolving relative to this config's directory (repo root). Targets are therefore `./packages/<pkg>/src/index.ts`. Future-proof, no deprecation diagnostic.
  - [x] Update the header comment in `tsconfig.typecheck.json` to document that cross-package specifiers now resolve to `src` via `paths` (mirroring the Vitest `resolve.alias`), and that `pnpm run build` remains the shipped-`dist` guard — so typecheck no longer needs a build-first step for a freshly-added cross-package export. — DONE (header block added documenting the `paths` mapping, the no-`baseUrl`/relative-target rationale, and build-mode honesty).
  - [x] Prove it: from a no-`dist` state (`rm -rf packages/*/dist`), run `pnpm run typecheck` and confirm GREEN. Capture in the Dev Agent Record the before/after (without the mapping, the same no-`dist` typecheck reds on cross-package `@agentbbs/*` imports). Do NOT commit any `dist` (it is git-ignored); rebuild afterward for the rest of the gate. — DONE. BEFORE (no `dist`, no mapping): `tsc` exit 2, 172 errors (70× `TS2307` "Cannot find module '@agentbbs/core'"). AFTER (no `dist`, with mapping): exit 0, 0 errors. `--traceResolution` confirmed `@agentbbs/core` → `packages/core/src/index.ts`. `dist` not committed (git-ignored); rebuilt for the gate.
  - [x] Confirm the production build is unchanged: `pnpm run build` still drives per-package `tsc -b` against the real `exports`; the new `paths` lives ONLY in `tsconfig.typecheck.json`, never in `tsconfig.base.json` or any package build config (preserve the "packages never redefine the root config / shipped dist stays honest" invariant). — DONE. From a fully clean state (all `dist` + `.tsbuildinfo` wiped), `pnpm run build` built all 7 projects green; the `paths` block is only in `tsconfig.typecheck.json`.
- [x] Task 2: Retire the redundant cross-package alias-proof fixture (AC: #2)
  - [x] Delete `packages/core/src/cross-package-alias-proof.ts`. — DONE.
  - [x] Remove the `CROSS_PACKAGE_ALIAS_PROOF` / `crossPackageAliasProof` re-export block (and its preceding explanatory comment) from `packages/core/src/index.ts`. — DONE.
  - [x] Delete the dedicated proof test `packages/mcp-server/src/cross-package-alias.proof.test.ts`. — DONE.
  - [x] Grep the whole repo for `CROSS_PACKAGE_ALIAS_PROOF`, `crossPackageAliasProof`, and `cross-package-alias-proof` and remove every remaining reference (comments in `vitest.config.ts` that point at the fixture file should be updated to point at the operational living proof — Epic 3's real cross-package `core` exports — rather than the deleted file). — DONE. `vitest.config.ts` comment repointed at the living proof (Epic 3's real `core` exports consumed by `mcp-server` tests). Post-edit grep: no live source/test/config references the deleted symbols; remaining hits are tracking docs (`deferred-work.md` 3.0-a, this story, the prior `3-0-...md` record) and `project-rules.md` §2 — all legitimate history, out of this story's edit scope (only `deferred-work.md` is reconciled).
  - [x] Prove the alias still resolves from `src` after retirement: `rm -rf packages/core/dist` (or all `packages/*/dist`), run the FULL `pnpm test` GREEN from that no-`dist` state, demonstrating every cross-package `@agentbbs/core` import in `mcp-server`/`cli` tests resolves to source via the surviving Vitest `resolve.alias`. Capture the run in the Dev Agent Record. Rebuild `dist` afterward. — DONE. From no-`dist`: FULL `pnpm test` GREEN — 50 files / 322 tests (exit 0). After rebuild, `core/dist/index.d.ts` contains 0 occurrences of `CROSS_PACKAGE_ALIAS_PROOF` (sentinel gone from public surface). `dist` rebuilt for the gate.
- [x] Task 3: Reconcile `deferred-work.md` (AC: #3)
  - [x] Mark **E3-typecheck-dist** RESOLVED (this story — `tsconfig.typecheck.json` `paths` mapping; no-`dist` typecheck green) and **3.0-a** RESOLVED (this story — fixture + barrel export + proof test deleted). Each retains its original Summary/Rationale/Suggested-resolution; add a one-line `**Resolution:**` with the evidence. — DONE. Both headings flipped to RESOLVED (Story 4.0); each retains its original Summary/Rationale/Suggested-resolution and gains a `**Resolution:**` line with evidence. E3-typecheck-dist's Resolution explicitly scopes the fix to the TYPECHECK half and records that the forked-worker `dist` dependency is inherent/unchanged.
  - [x] Leave **1.5**, **1.6**, **3.0-b**, and **E3-tool-names** OPEN (carried forward), rationale intact (3.0-b → Story 6.1; E3-tool-names → Epic 7). — DONE. 1.5/1.6 untouched (still OPEN). 3.0-b and E3-tool-names headings annotated with their carry-forward targets (→ Story 6.1 / → Epic 7) confirmed at this triage; bodies/rationale intact.
  - [x] Update the ledger-snapshot line at the top of `deferred-work.md` to reflect the new state. — DONE (reconciled by Story 4.0: E3-typecheck-dist + 3.0-a RESOLVED; 1.5/1.6/3.0-b/E3-tool-names OPEN).
- [x] Task 4: Full-gate verification (AC: #1, #2, #4)
  - [x] Run, in order: `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, `pnpm test`, `pnpm run format` (`--check`). All green. (Build-before-typecheck/test keeps the FORKED cross-process worker tests — `register-race`/`concurrency`, which resolve `@agentbbs/core` via the real `exports`→`dist` in a child Node process, NOT the Vitest alias — able to load their built workers; the typecheck `paths` mapping does NOT change that runtime resolution, only the typecheck pass. This forked-worker `dist` dependency is unchanged by this story — note it in the Dev Agent Record so it is not mistaken for a regression.) — DONE. lint exit 0; build exit 0 (7/7 projects); typecheck exit 0 (0 errors); test exit 0 (50 files / 322 tests); format exit 0 ("All matched files use Prettier code style!"). Forked-worker `dist` dependency unchanged (those tests also self-build via `beforeAll` BUILD-IF-MISSING/STALE) — not a regression.
  - [x] Note the final test count (Epic 3 closed at 324 passing / 51 files; this story removes the 2 alias-proof cases and adds none, so expect ~322 — confirm the delta is exactly the retired fixture). — DONE. Final: **322 passing / 50 files** = 324 − 2 (the two retired alias-proof cases) and 51 − 1 (the deleted proof test file). Delta is exactly the fixture retirement; no other test removed and none added.

## Dev Notes

This is a **housekeeping / internal-tooling story** — it touches one typecheck config (`tsconfig.typecheck.json`), deletes one test-only `core` fixture + its barrel re-export + one proof test, updates a config comment (`vitest.config.ts`), and reconciles a tracking document (`deferred-work.md`). It introduces **no new service, MCP tool, `core` op, event type, error code, or user-facing surface** — it removes a build-ordering papercut for the typecheck gate and prunes a now-redundant test fixture from the public API surface.

- **Rule 1 (Integration ACs):** N/A — not service-introducing. No new public surface for a later story to consume; the only API-surface change is a DELETION (the test-only sentinel) that no production consumer should ever have imported.
- **Rule 3 (real-runtime test evidence):** No new MCP tool ⇒ no stdio smoke for a new surface. AC #1 and AC #2 each carry their own real proof (no-`dist` `pnpm run typecheck` green; no-`dist` `pnpm test` green) — these ARE the real-runtime evidence for the tooling change. The lead's per-story smoke is a CLI/library exercise of the gate from a clean `dist` state (see Smoke note).
- **Rule 5 (NFR tripwire):** N/A — no NFR work.
- **Rule 6 (ADR):** N/A — project has no `docs/adr/` registry (confirmed at epic pre-flight).

### Source facts (verified at story creation, baseline `5ef57e0`)

- **`tsconfig.typecheck.json`** extends `tsconfig.base.json`; a single non-composite `noEmit` pass with `include` globs `packages/*/src/**/*.ts(x)` + `apps/*/src/**/*.ts(x)` and `exclude` `**/node_modules/**` + `**/dist/**`. It currently has **no `paths` / `baseUrl`**, so cross-package `@agentbbs/*` specifiers resolve via node resolution → each package's `exports` → `dist/*.d.ts`. (Confirm whether `tsconfig.base.json` sets `baseUrl`/`paths` before adding — Task 1.)
- **Vitest `resolve.alias`** (Story 3.0) already maps each `@agentbbs/<pkg>` → `packages/<pkg>/src/index.ts` (top-level AND inside the `agentbbs` project config) in the root `vitest.config.ts`. The typecheck `paths` mapping should mirror this exactly (same five package roots). The Vitest alias is NOT touched by this story (only its trailing comment reference to the deleted fixture file is updated).
- **Alias-proof fixture**: `packages/core/src/cross-package-alias-proof.ts` exports `CROSS_PACKAGE_ALIAS_PROOF = 'agentbbs:core-src-alias:3.0'` + `crossPackageAliasProof()`; re-exported from `packages/core/src/index.ts` (the block at lines ~71–75, preceded by an explanatory comment). The dedicated proof test is `packages/mcp-server/src/cross-package-alias.proof.test.ts` (2 cases). No production code imports the sentinel (grep to confirm at dev time).
- **Forked cross-process worker tests** (`packages/data-access/src/register-race.test.ts`, `concurrency.test.ts`) `child_process.fork` a BUILT `dist/*-worker.js` that resolves `@agentbbs/core` via the real `exports` → `dist` in a separate Node process — NOT via the Vitest alias and NOT via the typecheck `paths`. They genuinely need `dist` built; this story does NOT change that (build stays first in the gate). This is the documented residual from `project-rules.md` §2.
- Toolchain (verified Epics 1–3): Node v24.16.0 (`>=24`), pnpm 11.3.0 — match.

### Project Structure Notes

- `tsconfig.typecheck.json` is the ONE typecheck config (the analogue of the single root `vitest.config.ts`). The `paths` mapping is typecheck-only by design — it MUST NOT be added to `tsconfig.base.json` (which the per-package production builds extend), or the shipped `dist` would resolve cross-package imports to source and the build-honesty guard would be lost. Keep the production build resolving via real `exports`.
- After this story the build-first dance is eliminated for BOTH in-Vitest tests (Story 3.0 alias) AND the typecheck pass (this story's `paths` mapping). The only remaining `dist`-before-everything dependency is the forked cross-process workers, which is inherent to their real-process resolution and stays covered by the standard `build`-before-`test` gate ordering.

## Dev Agent Record

### Implementation Plan

Housekeeping story executed in the four-task order: (1) add the typecheck `paths` mapping + prove no-`dist` typecheck green; (2) retire the alias-proof fixture + prove no-`dist` `pnpm test` green; (3) reconcile `deferred-work.md`; (4) full honest gate. Both no-`dist` proofs were run BEFORE rebuilding (the proofs are the AC #1 / AC #2 real evidence for a tooling change), then `dist` was rebuilt from a fully clean state for the gate. No new service/MCP tool/`core` op/event/error code — the only public-surface change is a DELETION (the test-only sentinel).

### Debug Log

**TS 6.0.3 `baseUrl` deprecation (`TS5101`) — the one real decision point (Research-First + project-rules Rule 3).**

The story Task 1 specified `"baseUrl": "."` + non-`./`-prefixed `paths` targets. Implementing that literally produced a hard error against the INSTALLED compiler:

```
tsconfig.typecheck.json(65,5): error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0. Specify compilerOption '"ignoreDeprecations": "6.0"' to silence this error.
```

Installed TypeScript = **6.0.3** (`node -e "require('typescript/package.json').version"`). This is a Research-First trigger (version-specific external-API behavior). Per `.claude/rules/research-first.md` + project-rules Rule 3, I verified against the INSTALLED compiler, not just web search:

- A Perplexity `search` pass returned 5.x-era guidance claiming "`paths` without `baseUrl` is ignored / not resolved relative to tsconfig dir" and could NOT confirm TS 6.0 behavior — it explicitly told me to verify with `tsc --traceResolution`. Per Rule 3, the installed `.d.ts`/compiler wins when web search and the installed package disagree.
- Empirical probe against TS 6.0.3 from a no-`dist` state:
  - `paths` WITHOUT `baseUrl`, targets NON-relative (`packages/core/src/index.ts`) → `TS5090: Non-relative paths are not allowed when 'baseUrl' is not set. Did you forget a leading './'?`
  - `paths` WITHOUT `baseUrl`, targets RELATIVE (`./packages/core/src/index.ts`) → **typecheck exit 0, 0 errors**; `--traceResolution` shows `Module name '@agentbbs/core' was successfully resolved to 'C:/git/agentbbs/packages/core/src/index.ts'`.

**Decision:** omit `baseUrl` (deprecated, removed in TS 7.0) and write the five targets relative with a leading `./`. This is strictly better than the story's literal `baseUrl: "."` (which works but emits `TS5101`) and better than `ignoreDeprecations: "6.0"` (which retains a doomed option). The story's own Task 1 note ("TypeScript 4.1+ permits `paths` without `baseUrl`") anticipated this path; the only nuance the installed compiler enforces is relative targets. Recorded here per Rule 3 so the next agent does not re-litigate it.

**`tsc -b` incrementality observed (not a defect).** After the first gate `pnpm run build`, `packages/cli/dist` and `packages/ui-shared/dist` were absent though the build reported "Done" for both — `tsc -b` consulted their fresh `.tsbuildinfo` and skipped emit (their barrel sources were unchanged; their `dist` had only been wiped by my `rm -rf`). Confirmed harmless: a clean rebuild (`rm -rf` all `dist` + all `.tsbuildinfo`, then `pnpm run build`) produced all 7 `dist` dirs green. This is exactly the documented `project-rules.md` §2 `tsc -b` "deleted/stale dist needs `--force`" behavior; unrelated to the `paths` change (those packages have no cross-package consumer yet).

### AC-by-AC evidence

- **AC #1 (typecheck resolves cross-package from `src`, build unaffected):** BEFORE (no `dist`, no mapping) `pnpm run typecheck` = exit 2, 172 errors (70× `TS2307` cross-package module-not-found). AFTER (no `dist`, with mapping) = exit 0, 0 errors; `--traceResolution` → `packages/core/src/index.ts`. Production build unaffected: full clean `pnpm run build` = exit 0, all 7 projects; the `paths` block is ONLY in `tsconfig.typecheck.json` (never `tsconfig.base.json`).
- **AC #2 (fixture retired, alias still proven from `src`):** fixture file + barrel re-export + proof test deleted; `vitest.config.ts` comment repointed at the living proof. From no-`dist`, FULL `pnpm test` = exit 0, 50 files / 322 tests — every cross-package `@agentbbs/core` import in `mcp-server`/`cli` tests resolved to `src` via the surviving Vitest alias WITHOUT the sentinel. After rebuild, `core/dist/index.d.ts` has 0 occurrences of `CROSS_PACKAGE_ALIAS_PROOF` (gone from the shipped surface). Grep confirmed no production code ever imported it.
- **AC #3 (`deferred-work.md` reconciled):** E3-typecheck-dist + 3.0-a → RESOLVED (Story 4.0) with `**Resolution:**` evidence lines, originals retained. 1.5/1.6/3.0-b/E3-tool-names → OPEN (3.0-b → Story 6.1; E3-tool-names → Epic 7). Ledger-snapshot line updated and cross-checked against every entry heading.
- **AC #4 (full gate green, count −2 = fixture only):** lint exit 0 · build exit 0 (7/7) · typecheck exit 0 (0 err) · test exit 0 (50 files / 322 tests) · format exit 0. Final count **322** = 324 − 2 (retired alias-proof cases); files **50** = 51 − 1 (deleted proof test). Delta is exactly the fixture retirement.

### Forked-worker `dist` note (not a regression)

The forked cross-process worker tests (`packages/data-access/src/register-race.test.ts`, `concurrency.test.ts`) `child_process.fork` a BUILT `dist/*-worker.js` that resolves `@agentbbs/core` via the real `exports` → `dist` in a separate Node process — NOT via the Vitest alias and NOT via the new typecheck `paths`. This story does NOT change that. They are BUILD-IF-MISSING/STALE (each `beforeAll` runs `tsc -b --force` on `@agentbbs/data-access` if its worker `dist` is missing/stale), so they pass even from a no-`dist` `pnpm test`. The standard `build`-before-`test`/`typecheck` gate ordering remains the documented mitigation for this last inherent `dist` dependency (`project-rules.md` §2 caveat).

### Completion Notes

- Implemented the `tsconfig.typecheck.json` `paths` mapping (5 package roots → `src/index.ts`), mirroring the Story 3.0 Vitest `resolve.alias`; eliminates the E3-typecheck-dist build-first papercut for the typecheck gate. No `baseUrl` (TS 6.0.3 deprecation) — relative `./`-prefixed targets, verified via `--traceResolution`.
- Retired the synthetic cross-package alias-proof fixture (`cross-package-alias-proof.ts` + its barrel re-export + `cross-package-alias.proof.test.ts`); Epic 3's real `core` exports consumed by `mcp-server` tests are now the standing operational proof. The public `@agentbbs/core` surface no longer ships a test-only sentinel.
- Reconciled `deferred-work.md` (E3-typecheck-dist + 3.0-a RESOLVED; 1.5/1.6/3.0-b/E3-tool-names OPEN; ledger updated).
- Full gate green; test count 322 (= 324 − the 2 retired cases), no other regression.
- Rule 1 N/A (no service introduced — only a deletion). Rule 3 satisfied (the two no-`dist` proofs ARE the real-runtime evidence for the tooling change; story is a non-user-facing internal-tooling change). Rule 5 N/A (no NFR). Rule 6 N/A (no `docs/adr/`).

### File List

Modified:
- `tsconfig.typecheck.json` — added the cross-package `paths` mapping (5 roots → `src/index.ts`, no `baseUrl`, relative targets) + header documentation.
- `vitest.config.ts` — repointed the alias-proof comment from the deleted fixture file to the living operational proof (Epic 3's real `core` exports); noted the Story 4.0 retirement.
- `packages/core/src/index.ts` — removed the `CROSS_PACKAGE_ALIAS_PROOF` / `crossPackageAliasProof` re-export block and its explanatory comment.
- `_bmad-output/implementation-artifacts/deferred-work.md` — marked E3-typecheck-dist + 3.0-a RESOLVED (Story 4.0) with evidence; annotated 3.0-b (→6.1) / E3-tool-names (→Epic 7) OPEN; updated the ledger-snapshot line.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 4-0 status ready-for-dev → in-progress → review (+ status comment line).
- `_bmad-output/implementation-artifacts/4-0-epic-3-deferred-cleanup.md` — this story file (Tasks/Subtasks checked, Dev Agent Record, Status).

Deleted:
- `packages/core/src/cross-package-alias-proof.ts` — the synthetic test-only sentinel fixture.
- `packages/mcp-server/src/cross-package-alias.proof.test.ts` — the dedicated synthetic proof test (2 cases).

(No `dist/` changes are committed — `dist/` is git-ignored.)

### Change Log

- 2026-05-31 — Story 4.0 (Epic 3 deferred cleanup): added `tsconfig.typecheck.json` `paths` mapping for cross-package `src` resolution (resolves E3-typecheck-dist — no-`dist` typecheck green, no `baseUrl` per TS 6.0.3); retired the redundant cross-package alias-proof fixture + barrel re-export + proof test (resolves 3.0-a — no-`dist` `pnpm test` green, sentinel gone from `core/dist`); reconciled `deferred-work.md`. Full gate green; 322 tests (−2 = retired alias-proof cases, no assertion lost).

## Retro-Review Triage (Epic 3 → Story 4.0)

Triage covers the **Epic 3 retrospective** (`epic-3-retro-2026-05-31.md`, Action Items A–E) and the OPEN items in `deferred-work.md`, conducted at the `/epic-cycle` Retrospective Review gate on **2026-05-31** before Epic 4 feature work.

| Item | Source | Triage Decision |
|---|---|---|
| **3.0-a** — retire the test-only cross-package alias-proof fixture from the public `@agentbbs/core` barrel | Epic 3 retro Action C / deferred-work.md | **INCLUDE (Task 2)** — Epic 3's real cross-package `core` exports are now the standing operational proof of the Vitest `src` alias; the synthetic fixture is redundant and pollutes the public API surface. |
| **E3-typecheck-dist** — `pnpm run typecheck` resolves `@agentbbs/*` via `dist`, forcing a build-first dance for every freshly-added cross-package export | Epic 3 retro Action A / deferred-work.md | **INCLUDE (Task 1)** — recurs every epic (each adds `core` exports consumed by `mcp-server`); fixed with a `tsconfig.typecheck.json` `paths` mapping mirroring the Story 3.0 Vitest alias. High ROI before Epic 4 adds six tools + new event types. |
| **1.5** — append-invariant lint guard disabled in `*.test.ts` (string-literal regex, not AST) | Epic 3 retro Action E / deferred-work.md | **DEFER (carry forward, OPEN)** — the fix needs AST-level matching of real `better-sqlite3` call sites; low risk (test helpers don't ship, are reviewed); no Epic 4 trigger. |
| **1.6** — `wireToPayload` does not validate payload shape of a known-type-but-malformed row | Epic 3 retro Action E / deferred-work.md | **DEFER (carry forward, OPEN)** — corruption-tolerance hardening reachable only by foreign/corrupt rows; the write→read round-trip contract holds; no Epic 4 corruption-tolerance requirement. |
| **3.0-b** — guard-before-append doubles the `recordSeen`/`updateFocus` per-call ledger read | Epic 3 retro Action D / deferred-work.md | **DEFER → Story 6.1 (OPEN)** — explicitly a `check` hot-path measurement item; the double read is inherent to the AC #3 pre-append existence guard, not a defect; measure when 6.1 wires `recordSeen` into `check`. |
| **E3-tool-names** — MCP tool names + result envelopes not contract-pinned | Epic 3 retro Action B / deferred-work.md | **DEFER → Epic 7 (OPEN)** — Epic 7 has a dedicated `mcp-tool-contract.md` ratification story; Epic 4's six new tools follow the same established convention (`list_*` reads; `*_announcement`/`*_room`/`*_participant` writes) and will be ratified with the complete 12-tool surface in one coordinated pass while the agent population is still zero. |

**Summary:** included = 2 (3.0-a, E3-typecheck-dist), deferred = 4 (1.5, 1.6, 3.0-b, E3-tool-names), dropped = 0.
