---
baseline_commit: 16f667093b65b7d65f2bbc2415e778ae8aee1d4a
---

# Story 2.0: Epic 1 Deferred Cleanup

Status: done

<!-- Cleanup story — not in epics.md. Created by the /epic-cycle Retrospective Review & Story X.0 gate. -->
<!-- Triages Epic 1 retrospective Action Items + deferred-work.md before Epic 2 feature work begins. -->

## Story

As the project lead,
I want the carried-forward Epic 1 housekeeping items resolved before Epic 2 feature work begins,
so that the repo starts Epic 2 with no CRLF churn, no dead dependency weight, and an accurate deferred-work ledger.

## Acceptance Criteria

1. **Given** the repo has no `.gitattributes` (Epic 1 commits emit "LF will be replaced by CRLF" warnings),
   **When** a `.gitattributes` with `* text=auto eol=lf` is added at the repo root,
   **Then** line-ending normalization is enforced and subsequent `git add` operations stop emitting CRLF-conversion warnings,
   **And** the working tree is re-normalized so no spurious whole-file EOL diffs remain (`git add --renormalize .` produces a clean, intentional result).

2. **Given** `eslint-plugin-boundaries` is declared in root `package.json` `devDependencies` (`"catalog:"`) and in the `pnpm-workspace.yaml` catalog (`^6.0.2`) but is never imported by `eslint.config.js` (the boundary clauses are implemented with `no-restricted-imports`),
   **When** the dependency, its catalog entry, and its lockfile traces are removed and `pnpm install` is re-run,
   **Then** `eslint-plugin-boundaries` no longer appears in `package.json`, `pnpm-workspace.yaml`, or `pnpm-lock.yaml`,
   **And** `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, and `pnpm run build` all stay green (the boundary rules still fire — they never depended on the plugin).

3. **Given** the Story 1.4 deferral "`runWithRetry` has no inter-attempt backoff" was validated and effectively closed by Story 1.7 (the multi-process concurrency proof resolved real contention with `busyErrors=0` and a large margin),
   **When** `deferred-work.md` is updated,
   **Then** the 1.4 item is marked **RESOLVED** with a one-line citation of the Story 1.7 evidence (it is closed, not silently deleted — the resolution is recorded).

4. **Given** the remaining LOW deferrals (1.5 append-invariant lint guard excludes `*.test.ts`; 1.6 `wireToPayload` does not validate payload shape of a known-type-but-malformed row) are out of scope for this cleanup,
   **When** `deferred-work.md` is reconciled,
   **Then** 1.5 and 1.6 remain as **open** deferred items with their existing rationale intact (NOT removed — they carry forward to a future triage),
   **And** the deferred-work ledger accurately reflects: 1.2 resolved-by-this-story, 1.4 resolved-by-1.7, 1.5 open, 1.6 open.

## Tasks / Subtasks

- [x] Task 1: Add `.gitattributes` (AC: #1)
  - [x] Create `/.gitattributes` at the repo root with `* text=auto eol=lf` (plus any sensible binary exclusions if the repo already has binaries — none expected in this TS-only repo).
  - [x] Run `git add --renormalize .` and inspect the resulting diff; confirm it is EOL-normalization only (no content changes). Stage the normalized result.
  - [x] Verify a follow-up `git status` / `git add` no longer prints "LF will be replaced by CRLF".
- [x] Task 2: Remove the unused `eslint-plugin-boundaries` dependency (AC: #2)
  - [x] Remove the `"eslint-plugin-boundaries": "catalog:"` line from root `package.json` `devDependencies` (currently line ~26).
  - [x] Remove the `eslint-plugin-boundaries: ^6.0.2` entry from the `catalog:` block in `pnpm-workspace.yaml` (currently line ~52).
  - [x] Run `pnpm install` to refresh `pnpm-lock.yaml` (drops the 4 lockfile traces). Do NOT hand-edit the lockfile.
  - [x] Confirm `eslint.config.js` was already not importing the plugin (the boundary clauses use `no-restricted-imports`) — no change needed there.
- [x] Task 3: Reconcile `deferred-work.md` (AC: #3, #4)
  - [x] Mark the 1.2 item RESOLVED (this story removed the dependency).
  - [x] Mark the 1.4 item RESOLVED, citing Story 1.7 evidence (`busyErrors=0`, contention resolved with margin).
  - [x] Leave 1.5 and 1.6 as open deferred items, rationale intact.
- [x] Task 4: Full-gate verification (AC: #2)
  - [x] Run, in order: `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run format` (or `format:check`).
  - [x] Confirm all green and the 99-test baseline is intact (no test count regression).

## Dev Notes

This is a **housekeeping / internal-tooling story** — it touches build configuration (`.gitattributes`), dependency manifests (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`), and a tracking document (`deferred-work.md`). It introduces **no service, module, or user-facing surface**, so:

- **Rule 1 (Integration ACs):** N/A — not service-introducing. No `## Integration ACs` / `## Consumed-by` sections required.
- **Rule 3 (real-runtime test evidence):** **Exempt** — pure build-pipeline / internal-tooling change. The verification is the full quality gate (lint/typecheck/test/build/format staying green + the lockfile/manifest diff), not a new runtime test. No new feature code is added, so no new automated test is expected; the existing 99-test suite is the regression guard.
- **Rule 5 (NFR tripwire):** N/A — no NFR work.
- **Rule 6 (ADR):** N/A — project has no `docs/adr/` registry.

### Source facts (verified at story creation)

- No `.gitattributes` exists at repo root (confirmed). CRLF-churn warnings were called out in the Epic 1 retro (Action C).
- `eslint-plugin-boundaries`: declared `package.json:26` (`"catalog:"`) and `pnpm-workspace.yaml:52` (`^6.0.2`), 4 occurrences in `pnpm-lock.yaml`, and **not** imported by `eslint.config.js` (the only "boundaries" match there is a comment). Deferred from Story 1.2 code review.
- Toolchain verified at epic pre-flight (Rule 9): Node v24.16.0 (`>=24`), pnpm 11.3.0 (`packageManager` pin) — match.

### Project Structure Notes

- `.gitattributes` is a new root-level file; aligns with the standard monorepo convention and resolves a known cosmetic-but-noisy issue.
- Dependency removal must go through `pnpm install` to keep `pnpm-lock.yaml` authoritative — never hand-edit the lockfile (project uses pnpm workspaces + catalog).
- Watch for native-build `allowBuilds` prompts on `pnpm install` (`unrs-resolver`, `better-sqlite3` were flagged in Epic 1); they should already be configured — if `pnpm install` warns, the existing `pnpm.onlyBuiltDependencies` / `allowBuilds` config covers them.

### References

- [Source: _bmad-output/implementation-artifacts/epic-1-retro-2026-05-31.md#Action Items] — Actions C, D1, D2.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — 1.2, 1.4, 1.5, 1.6 LOW items.
- [Source: _bmad/custom/skill-rules.md#Rule 9] — epic pre-flight toolchain check.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Full quality gate, run in order, all green:
  - `pnpm run lint` → clean (exit 0). **Key AC #2 proof:** the import-boundary rules still fire with `eslint-plugin-boundaries` removed — they were always implemented with `no-restricted-imports`, never the plugin.
  - `pnpm run typecheck` → clean (exit 0).
  - `pnpm test` → **99 passed / 15 files** (baseline intact, no regression).
  - `pnpm run build` → all 7 workspace packages built clean.
  - `pnpm run format` (`prettier --check .`) → "All matched files use Prettier code style!".
- `pnpm install` after the dependency removal: removed `eslint-plugin-boundaries 6.0.2`, pruned 31 transitive packages; no `allowBuilds` prompts (existing `unrs-resolver` / `better-sqlite3` config covered the native builds).

### Completion Notes List

- **Task 1 (`.gitattributes`):** Added `* text=auto eol=lf` at repo root. `git add --renormalize .` was a content no-op — the index already stored every tracked file with LF (`i/lf`), so there were no spurious whole-file EOL diffs. The working tree, however, had been checked out with CRLF on all 86 tracked text files (`core.autocrlf=true`); refreshed the working copy (delete-tracked + `git checkout -- .`) so the tree is now LF-everywhere (0 CRLF files), matching the index and the new `eol=lf` attribute. Verified a fresh `git add` no longer emits "LF will be replaced by CRLF".
- **Task 2 (remove `eslint-plugin-boundaries`):** Removed the `"catalog:"` line from root `package.json` `devDependencies` and the `^6.0.2` catalog entry from `pnpm-workspace.yaml`; refreshed `pnpm-lock.yaml` via `pnpm install` (never hand-edited). Net result: **0 occurrences** of `eslint-plugin-boundaries` across `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` (was 1 / 1 / 4). `eslint.config.js` needed no change (it never imported the plugin — only a comment mentioned "boundaries"). Also reworded the now-stale catalog comment in `pnpm-workspace.yaml` so it no longer claims a boundary plugin is in use and no longer contains the literal plugin name. Benign lockfile side effect: the transitive `eslint-import-resolver-node@0.3.9` (pulled in only by the boundaries plugin) was pruned, simplifying `eslint-plugin-import-x@4.16.2`'s optional-peer resolution variant; `import-x`'s own version is unchanged and lint stays green.
- **Task 3 (reconcile `deferred-work.md`):** Added a status legend + a ledger snapshot line (1.2 RESOLVED / 1.4 RESOLVED / 1.5 OPEN / 1.6 OPEN). Marked **1.2 RESOLVED** (resolved by this story) and **1.4 RESOLVED** (validated by Story 1.7: N=6×M=100=600 appends, unique strictly-monotonic `seq`, no lost writes, `busyErrors=0`, contention probe 184–448 ms vs 150 ms held lock, 22× consecutive green runs — the zero-backoff retry was never the bottleneck under real load). Both resolved items retain their original Summary/Rationale/Suggested-resolution (closed, not deleted). **1.5 and 1.6 left OPEN** with an explicit "carried forward" marker and full rationale intact.
- **Task 4 (full gate):** All five gate steps green in order; 99-test baseline intact (see Debug Log).
- **Rule compliance:** Rule 3 (real-runtime test evidence) **exempt** — pure internal-tooling/build-pipeline change, no user-facing surface, no new feature code; the 99-test suite is the regression guard. Rules 1/5/6 N/A per Dev Notes (not service-introducing; no NFR work; no ADR registry).

### File List

- `.gitattributes` (new)
- `package.json` (modified — removed `eslint-plugin-boundaries` devDependency)
- `pnpm-workspace.yaml` (modified — removed boundaries catalog entry; reworded stale comment)
- `pnpm-lock.yaml` (modified — regenerated by `pnpm install`)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — reconciled ledger: 1.2/1.4 RESOLVED, 1.5/1.6 OPEN)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story status ready-for-dev → in-progress → review)
- `_bmad-output/implementation-artifacts/2-0-epic-1-deferred-cleanup.md` (modified — this story file: baseline_commit, task checkboxes, Dev Agent Record, Change Log, Status)

## Change Log

| Date       | Change                                                                                 |
|------------|----------------------------------------------------------------------------------------|
| 2026-05-31 | Story 2.0 implemented: added `.gitattributes` (`* text=auto eol=lf`) + renormalized working tree to LF; removed unused `eslint-plugin-boundaries` (manifest + catalog + lockfile); reconciled `deferred-work.md` (1.2 & 1.4 RESOLVED, 1.5 & 1.6 OPEN). Full gate green (lint/typecheck/test 99-pass/build/format). Status → review. |
| 2026-05-31 | QA stage (`bmad-qa-generate-e2e-tests`): no new test warranted (Rule 3 exemption — no user-facing/behavioral surface); existing 99-test suite re-verified green as the regression guard. Details in QA Results below. |

## QA Results

**Stage:** `bmad-qa-generate-e2e-tests` (QA) · 2026-05-31 · agent claude-opus-4-8[1m].

**Decision: NO new automated test added.** Story 2.0 is a pure housekeeping / internal-tooling change — it adds `.gitattributes`, removes an unused dev-dependency, and reconciles a tracking document. It introduces no service, module, API, CLI, or UI surface and no new feature code, so per **skill-rules Rule 3** it is **exempt** from real-runtime test evidence. Manufacturing a synthetic test for a no-behavior change would add noise, not coverage.

**Per-AC test rationale:**

- **AC #1 (`.gitattributes` / LF normalization):** Not behaviorally testable in the app-code tier — it is a Git-tooling guarantee (line-ending normalization + no CRLF warnings), not a runtime behavior. Verified by inspection instead: `git check-attr text eol -- package.json` resolves `text: auto`, `eol: lf` (attribute is active), and `git ls-files --eol | grep w/crlf` returns **zero** tracked text files with CRLF in the working tree (tree re-normalized to LF). A new automated test is not appropriate.
- **AC #2 (remove `eslint-plugin-boundaries`; boundary rules still fire):** This is the one AC with an assertable behavioral guarantee — and it is **already covered** by an existing discoverable test, `packages/core/src/boundary-enforcement.test.ts`. That test runs ESLint programmatically against the repo's real flat config and asserts the import-boundary rules report `no-restricted-imports` (better-sqlite3 ban, deep-cross-package ban, core→client/adapter ban) and the append-invariant `no-restricted-syntax` rules. Because the boundary rules were always implemented with `no-restricted-imports` (never the removed plugin), this pre-existing test **is** the regression guard proving the removal was safe. It passed in this stage's run (part of the 99). Adding a second test for the same guarantee would be a duplicate — none added.
- **AC #3 / AC #4 (reconcile `deferred-work.md` ledger):** Editing a Markdown tracking document has no executable behavior to assert. Verified by reading the reconciled ledger (1.2 RESOLVED / 1.4 RESOLVED / 1.5 OPEN / 1.6 OPEN, resolved items retained with citations). Not test-eligible.

**Rule 8 (test discoverability):** No new test file created, so there is nothing new to assess for naming/ignore/tag opt-out. The existing regression guard (`boundary-enforcement.test.ts`) is fully discoverable: `*.test.ts` naming, located under `packages/core/src/` (matched by `vitest.config.ts` `projects` include glob `packages/*/src/**/*.test.{ts,tsx}`), under no ignore path, and it ran in the default `pnpm test` suite.

**Regression evidence — full quality gate re-run green, in order (the QA evidence that the cleanup caused no regression):**

| Step | Command | Result |
|---|---|---|
| Lint | `pnpm run lint` | exit 0 — config valid + boundary rules fire with `eslint-plugin-boundaries` removed |
| Test | `pnpm test` | **99 passed / 15 files** (baseline intact; includes `boundary-enforcement.test.ts`) |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Format | `pnpm run format` | "All matched files use Prettier code style!" |
| Build | `pnpm run build` | all 7 workspace packages built clean |

Also re-confirmed `eslint-plugin-boundaries` has **0 occurrences** across `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`.

**Outcome:** QA gate satisfied with the existing suite as the regression guard. No code or test files modified by this stage.

---

### Review Findings

**Stage:** `bmad-code-review` · 2026-05-31 · agent claude-opus-4-8[1m] · 3 review layers (Acceptance Auditor / Blind Hunter / Edge Case Hunter), reviewed against the 4 ACs over the dev+QA changeset (baseline `16f6670`).

**Result: ✅ Clean review — 0 decision-needed, 0 patch, 0 defer, 0 dismissed. Story 2.0 APPROVED.** All 4 ACs independently verified PASS; the full quality gate was re-run by the reviewer and is green.

**Reviewer-run gate (independent re-verification, all exit 0):**

| Command | Result |
|---|---|
| `pnpm run lint` (`eslint .`) | exit 0 — boundary rules fire with `eslint-plugin-boundaries` removed |
| `pnpm run typecheck` | exit 0 |
| `pnpm test` | **99 passed / 15 files** (baseline intact) |
| `pnpm exec vitest run …/boundary-enforcement.test.ts` | **19 passed** in isolation — the AC #2 regression guard genuinely exercises the boundary rules |
| `pnpm run build` (`pnpm -r build`) | 7 packages `tsc -b` Done |
| `pnpm run format` (`prettier --check .`) | "All matched files use Prettier code style!" |
| `pnpm install --frozen-lockfile` | "Already up to date" — lockfile in sync with manifests (not left half-edited) |

**Per-AC verification:**

- **AC #1 PASS** — `.gitattributes` present with exact `* text=auto eol=lf`. `git check-attr text eol` resolves `text: auto`, `eol: lf` (attribute active). Tracked-file EOL census: **0 `w/crlf`, 994 `w/lf`** (tree fully re-normalized). `git add --renormalize .` emits no "LF will be replaced by CRLF" warning and produces no spurious whole-file EOL diffs (the staged changeset is exactly the 7 intentional Story 2.0 files).
- **AC #2 PASS** — `eslint-plugin-boundaries` = **0 occurrences** across `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` (verified by both `git grep` against tracked content and raw `grep` against the working tree; was 1/1/4). `eslint.config.js` references "boundaries" only in a comment (line 14), never imported the plugin. Boundary rules still fire — proven by the reviewer-run lint (exit 0) and the 19-test `boundary-enforcement.test.ts` passing in isolation. Lockfile prune is sound: removed entries are all genuinely transitive to the plugin (`@boundaries/elements`, `eslint-import-resolver-node`, `eslint-module-utils`, plus the `handlebars`/`uglify-js`/`micromatch`/`chalk` deep tail); `eslint-plugin-import-x` (4 occ) and `typescript-eslint` (59 occ) remain intact; `--frozen-lockfile` confirms internal consistency.
- **AC #3 PASS** — `deferred-work.md` 1.4 item marked **RESOLVED (validated by Story 1.7)** with a one-line Resolution citing the 1.7 evidence (`busyErrors=0`, 600 appends unique/strictly-monotonic, contention probe 184–448 ms, 22× green) and a `[Source: 1-7-…]` reference. The original Summary/Rationale/Suggested-resolution prose is retained (closed, not silently deleted).
- **AC #4 PASS** — 1.5 and 1.6 remain **OPEN (carried forward)** with full original rationale intact (heading count = 2, both present). The ledger snapshot line reads `1.2 RESOLVED (Story 2.0) / 1.4 RESOLVED (Story 1.7) / 1.5 OPEN / 1.6 OPEN`, matching the AC's required state exactly.

**Rule compliance:**

- **Rule 3 (real-runtime test evidence): EXEMPTION CONFIRMED LEGITIMATE.** The changeset adds only a `.gitattributes` file, removes one dev-dependency (manifest + catalog + lockfile), and edits two Markdown tracking docs (`deferred-work.md`, `test-summary.md`) + the story/sprint files. No feature/CLI/API/UI/service code was added (verified against the full diff). AC #2's sole behavioral guarantee is covered by the pre-existing discoverable `boundary-enforcement.test.ts`. No Rule 3 HIGH.
- **Rule 1 (Integration ACs): N/A** — genuinely not service/module/component-introducing (build-config + tracking-doc change only).
- **Rule 5 (NFR tripwire): N/A** — no NFR work.
- **Rule 6 (ADR): N/A** — no `docs/adr/` registry in this project.

**Note (non-blocking, lead-owned, no action by review):** the working tree also carries untracked `_bmad-output/implementation-artifacts/cycle-log-epic-2.md` — this is the lead's cycle log, not part of Story 2.0's deliverable; left untouched per stage constraint (review does not author cycle-log entries). The story's File List omits `tests/test-summary.md`, which QA legitimately appended this cycle — a documentation nit only, not an AC gap.

---

## Triage Table — Epic 1 retrospective + deferred-work.md (covers Epic 1; dated 2026-05-31)

| Item | Source | Triage Decision |
|---|---|---|
| Action A — Epic pre-flight toolchain/environment check | epic-1 retro | **Drop** — already DONE (codified as `skill-rules.md` Rule 9); no work remaining |
| Action C — Add `.gitattributes` (`* text=auto eol=lf`) to eliminate CRLF churn | epic-1 retro | **Include in Story 2.0** (Task 1 / AC #1) |
| 1.2 LOW — unused `eslint-plugin-boundaries` dependency | deferred-work.md | **Include in Story 2.0** (Task 2 / AC #2) — housekeeping removal + lockfile refresh |
| 1.4 LOW (Action D1) — `runWithRetry` has no inter-attempt backoff | deferred-work.md / retro | **Include in Story 2.0** (Task 3 / AC #3) — close as RESOLVED, validated by Story 1.7 (`busyErrors=0`, ~33× margin) |
| 1.5 LOW (Action D2) — append-invariant lint guard excludes `*.test.ts` | deferred-work.md | **Defer** — needs AST-level SQL-lint approach; low-risk (test helpers don't ship, are reviewed); out of scope here. Remains open. |
| 1.6 LOW (Action D2) — `wireToPayload` no payload-shape validation for known-type-but-malformed row | deferred-work.md | **Defer** — add when a `core` projection consumer needs corruption-tolerance; not required by Epic 2 happy-path ACs. Remains open. |
