---
baseline_commit: 09898e2
---

# Story 13.1: Windows temp-dir teardown flake hardening

Status: done

<!-- Epic 13 (deferred-work cleanup & hardening). Closes deferred-work.md E10-baseline-seedrace-eperm + E12-postmerge. Test-infra ONLY — NO production-source behavior change; 17-tool agent contract byte-identical. -->

## Story

As a developer relying on the CI gate,
I want the full test suite to stop flaking on Windows temp-dir teardown,
So that a red gate always means a real regression.

## Acceptance Criteria

1. **(AC1 — shared helper)** Given the `data-access` `seed-protocol-race.test.ts` and the `cli` `index.test.ts` import-dispatch negative path (the two recorded Windows temp-dir flakes — `E10-baseline-seedrace-eperm`, `E12-postmerge`), when the test infra is hardened, then a **shared temp-dir helper** creates a hermetic per-test directory and removes it with retry/backoff (or a swallow-on-EPERM best-effort, since temp dirs are OS-reclaimed), and **the assertion-bearing logic is unchanged**.

2. **(AC2 — flake eliminated, not masked)** Given the hardened suites, when the full ROOT `pnpm test` is run **N≥3 consecutive times on Windows under full parallel load**, then **neither flake recurs**, and the fix ELIMINATES the race — verify the assertions still fire by a **Rule-7 mutation** (break the asserted logic → the test goes RED; revert byte-identical → GREEN).

3. **(AC3 — test-infra only + items closed)** Given the change, when inspected, then it is **test-infra only** (no production-source behavior change — `git diff HEAD -- packages/core packages/data-access/src packages/mcp-server/src packages/cli/src` shows only `*.test.ts` + the new test-helper, no production `.ts`), and the `deferred-work.md` entries `E10-baseline-seedrace-eperm` + `E12-postmerge` are **closed with evidence**.

## Tasks / Subtasks

- [x] **Task 1 — Create the shared temp-dir helper** (AC: #1)
  - [x] Add ONE shared test-only helper exposing `makeTempDir(prefix)` (wraps `mkdtempSync(join(tmpdir(), prefix))`) and `removeTempDir(dir)` (robust removal: `rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })` wrapped in a try/catch that SWALLOWS a residual Windows `EPERM`/`ENOTEMPTY` since the dir lives under `os.tmpdir()` and is OS-reclaimed). Mirror the EXISTING proven semantics in `seed-protocol-race.test.ts#removeTempTree` (the Story 11.0 best-effort retry/swallow) — do NOT invent new behavior, just factor it out.
  - [x] **Location decision (Dev Notes):** the helper must be reachable by BOTH a `data-access` test and a `cli` test, and must NOT pollute a published package's public `dist`/`exports` surface (Rule 13 — keep the shipped API byte-identical). RECOMMENDED: a repo-level test-support module (e.g. `test/support/temp-dir.ts`) imported by **relative path** from both test files (Vitest resolves relative paths fine; no `@agentbbs/*` barrel export, so nothing ships). Acceptable alternative: a `*.testkit.ts` co-located in one package and imported cross-package via the Vitest `src` alias ONLY IF it is provably never re-exported from that package's public barrel (grep the barrel `index.ts`). Pick one, justify it, and confirm `git diff` shows no production `.ts` change. **DECISION: chose the recommended `test/support/temp-dir.ts` repo-level module, relative-imported (`../../../test/support/temp-dir.js`) from both test files — see Completion Notes for the full justification.**
- [x] **Task 2 — Adopt the helper in both flaky suites** (AC: #1, #3)
  - [x] `packages/data-access/src/seed-protocol-race.test.ts`: replace the local `removeTempTree` + inline `mkdtempSync` with the shared helper. KEEP the `reapChildren()`-before-removal ordering (await child exit so handles are released before removal — the Story 11.0 fix) and KEEP every assertion byte-identical.
  - [x] `packages/cli/src/index.test.ts`: replace the five inline `mkdtempSync(...)` / `rmSync(dir, { recursive: true, force: true })` pairs (lines ~109/120, 132/148, 153/170, 175/190, 199/209) with the shared helper. The naive `rmSync` here has NO `maxRetries` — the upgrade to the retry/swallow helper is the `E12-postmerge` fix. KEEP every assertion (including the `agentbbs import: failed` / non-zero exit negative-path assertions) byte-identical.
  - [x] Confirm no OTHER assertion-bearing logic changed (the helper swap is purely the create/teardown seam).
- [x] **Task 3 — Prove the flake is eliminated (N≥3) + Rule-7 non-vacuity** (AC: #2)
  - [x] Run the full ROOT `pnpm test` **N≥3 consecutive times** on Windows under full parallel load; record each run's pass/fail + file/test counts in the Dev Agent Record. Neither `seed-protocol-race` EPERM nor the CLI import-dispatch ENOENT may recur.
  - [x] **Rule-7 mutation (non-vacuity):** temporarily break a load-bearing assertion in EACH touched suite (e.g. in seed-race flip an expected count `toBe(1)` → `toBe(2)`; in the CLI import negative-path flip the expected error string / exit code) → confirm RED; revert **byte-identical** (`git diff` on the file empty) → confirm GREEN. The helper swap must not have made any assertion vacuous.
- [x] **Task 4 — Close the deferred-work items** (AC: #3)
  - [x] In `deferred-work.md`, flip `E10-baseline-seedrace-eperm` (line ~340) and `E12-postmerge` (line ~484) headings `OPEN → RESOLVED (Story 13.1)` with a resolution sub-line citing the shared helper + the N≥3 evidence. Retain the original entries (do not delete).

## Dev Notes

### What's flaking and why (current state — READ BEFORE CODING)

- **`packages/data-access/src/seed-protocol-race.test.ts`** (read in full): forks 8 OS-process workers against one shared SQLite ledger, asserts exactly-one protocol announcement / main project / system identity. It ALREADY carries a robust local `removeTempTree(dir)` (Story 11.0 AC1: `maxRetries: 20, retryDelay: 50` + swallow-on-error) and awaits `reapChildren()` (bounded child-exit wait so handles release) BEFORE removal. The `E10-baseline-seedrace-eperm` entry recorded the Windows `EPERM` teardown race at the Epic-10 baseline. The assertions are sound; only the temp-dir lifecycle races the Windows handle-release. **13.1 factors this proven local helper into the SHARED helper** so the same robustness covers the CLI suite too — and confirms (N≥3) the swallow path actually eliminates the gate flake.
- **`packages/cli/src/index.test.ts`** (read in full): five tests each `mkdtempSync(join(tmpdir(), 'agentbbs-*-'))` then `rmSync(dir, { recursive: true, force: true })` in `finally` — **NO `maxRetries`, no swallow**. The `E12-postmerge` flake was an `ENOENT … agentbbs-import-dispatch-*/no-such-archive.ndjson` on the import negative path under full-suite parallel load on Windows (the temp NDJSON path racing the OS temp-dir lifecycle); GREEN on immediate re-run. Same Windows-full-suite-temp-race CLASS as the seed-race EPERM, a different signature in the `cli` package. The robust shared helper (retry + swallow + hermetic per-test dir) is the fix.

### Constraints (Rule 13 + test-infra discipline)

- **NO production-source behavior change.** This story touches `*.test.ts` files + ONE new test-only helper. The 17-tool agent contract, `packages/core/src`, the MCP wire, and the closed error/event sets stay byte-identical. AC3's `git diff HEAD` check is the gate: only test files + the helper may appear, no production `.ts`.
- **Do not weaken any assertion.** The helper swap is purely the temp-dir create/teardown seam. Every count, every error-string/exit-code assertion, the `reapChildren`-before-removal ordering, and the BUILD-IF-MISSING/STALE `beforeAll` in seed-race stay exactly as they are. Rule 7 (Task 3) proves the assertions still discriminate.
- **One shared helper, no duplication.** Do NOT copy the removal logic into each file (that is the exact drift anti-pattern Story 13.5 removes for operator-handle canonicalization). One source of truth, both files import it.

### N≥3 proof discipline (Sprint Change Proposal §3 risk mitigation)

The named risk for the P1 flake stories is "a flake fix that masks rather than fixes." Mitigation is built into AC2: re-run the FULL suite N≥3 times (not a single pass) AND mutation-test that the assertions still fire. A swallow-on-EPERM is legitimate ONLY because the temp dir is under `os.tmpdir()` (OS-reclaimed) and the removal runs AFTER the assertions already passed — it is teardown hygiene, never an assertion. Make that explicit in the helper's doc comment.

### Project Structure Notes

- New file: a single shared test-support helper (location per Task 1 decision; recommended `test/support/temp-dir.ts` at repo root, relative-imported). If a new top-level `test/` dir is introduced, confirm it is NOT collected as a Vitest test (no `*.test.ts` suffix on the helper) and not excluded from lint/format in a way that hides it.
- Touched: `packages/data-access/src/seed-protocol-race.test.ts`, `packages/cli/src/index.test.ts`, `deferred-work.md`.
- The canonical gate is the ROOT `pnpm test` (Rule 12 monorepo corollary) — never a per-package `vitest` run, which bypasses the root project/env mapping.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.1] — the three ACs.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-09.md §3] — N≥3 + Rule-7 mask-vs-fix mitigation; sequencing (13.1 first — makes every later story's gate trustworthy).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — `E10-baseline-seedrace-eperm` (line ~340), `E12-postmerge` (line ~484).
- [Source: packages/data-access/src/seed-protocol-race.test.ts#removeTempTree] — the proven retry/swallow semantics to factor out (Story 11.0 AC1).
- [Source: .claude/rules/project-rules.md] — Rule 7 (mutation non-vacuity), Rule 12 (root gate), Rule 13 (frozen contract), Rule 20 (full gate = lint+typecheck+build+test+format).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — Claude Code dev-story stage.

### Debug Log References

- Full ROOT `pnpm test` N=3 consecutive (Windows, full parallel load), each **184 files / 1663 passed / 0 failed**. No `seed-protocol-race` EPERM, no CLI import-dispatch ENOENT. A 4th post-revert confirmation run was also 184/1663/0.
- Rule-7 seed-race: `expect(protocolAnnouncementCount).toBe(1)` → `toBe(2)` → RED (received 1); reverted byte-identical → GREEN.
- Rule-7 CLI: import-dispatch negative-path `expect(process.exitCode).toBe(1)` → `toBe(0)` → RED (received 1); reverted byte-identical → GREEN.
- Final gate: lint 0 / typecheck 0 / build clean / `pnpm test` 184/1663/0 / `prettier --check` clean.

### Completion Notes List

- **Location decision (Task 1) — chose `test/support/temp-dir.ts`, relative-imported.** Justification: (a) Rule 13 — the file is NOT under any package's `src` barrel and is never re-exported from a published `@agentbbs/*` package, so nothing ships in any package's public `dist`/`exports`; the agent contract stays byte-identical (production-source `git diff HEAD -- packages/core packages/data-access/src packages/mcp-server/src packages/cli/src` excluding `*.test.ts(x)` is EMPTY). (b) Not collected as a test — the Vitest globs are `packages/*/src/**/*.test.{ts,tsx}` and `apps/*/src/**/*.test.{ts,tsx}`; `test/support/temp-dir.ts` matches neither (no `*.test.ts` suffix, not under those roots). (c) Still covered by the gate — `eslint .` and `prettier --check .` run over the whole repo and the new `test/` dir is NOT in `.prettierignore` or the ESLint `ignores` (which list `integration/`, `_bmad*/`, `docs/`, etc., but not `test/`); filename is kebab-case and exports are named, so lint passes. (d) Typechecked transitively — `tsconfig.typecheck.json` includes only `packages/*/src` + `apps/*/src`, but the two test importers ARE in that set, so `tsc` follows the relative import and type-checks the helper (typecheck exit 0 confirms). The `*.testkit.ts`-in-a-package alternative was rejected: it risks the Vitest `src` alias / barrel re-export surface and needs a grep guard that the repo-level module avoids entirely.
- **One source of truth, no duplication.** The proven Story-11.0 retry/swallow removal (`maxRetries: 20, retryDelay: 50` + swallow-on-`EPERM`/`ENOTEMPTY`) was LIFTED, not re-implemented — `seed-protocol-race.test.ts`'s local `removeTempTree` is deleted and both suites import `removeTempDir`. The swallow is legitimate (documented in the helper header): the dir is under `os.tmpdir()` (OS-reclaimed) and removal runs in `finally` AFTER assertions pass — teardown hygiene, never an assertion.
- **Assertion-bearing logic byte-identical.** The only changes are the temp-dir create/teardown seam (`makeTempDir`/`removeTempDir`), import lines, and comment updates. The seed-race `reapChildren()`-before-removal ordering and the BUILD-IF-MISSING/STALE `beforeAll` are intact; every count, error-string, and exit-code assertion is unchanged (Rule-7 proves they still discriminate).
- **Note:** the `agentbbs import: failed — ENOENT … no-such-archive.ndjson` line printed during `pnpm test` is the EXPECTED stderr of the import negative-path test (importCommand writes to `process.stderr`); the test passes — it is the asserted error contract, not the flake.

### File List

- `test/support/temp-dir.ts` (NEW — shared test-only temp-dir helper)
- `packages/data-access/src/seed-protocol-race.test.ts` (MODIFIED — adopt shared helper, remove local `removeTempTree` + inline `mkdtempSync`/`rmSync`)
- `packages/cli/src/index.test.ts` (MODIFIED — adopt shared helper across all five temp-dir pairs)
- `_bmad-output/implementation-artifacts/deferred-work.md` (MODIFIED — `E10-baseline-seedrace-eperm` + `E12-postmerge` OPEN → RESOLVED with evidence, originals retained)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED — 13-1 ready-for-dev → in-progress)

### Change Log

- 2026-06-10: Story 13.1 implemented — factored the Windows temp-dir create/teardown seam into a single shared test-only helper (`test/support/temp-dir.ts`) used by both flaky suites; verified flake ELIMINATED (N=3 full-suite green) + Rule-7 non-vacuity in both suites; closed the two deferred-work items. Test-infra only (production-source diff empty; 17-tool agent contract byte-identical). Status ready-for-dev → review.
- 2026-06-10: Code review → APPROVED / CLEAN. Status review → done.

## Review Findings

**Code review (2026-06-10) — APPROVED / CLEAN REVIEW.** 0 decision-needed / 0 patch / 0 defer / 3 dismissed. No HIGH/MED. Reviewer: claude-opus-4-8[1m].

Independent verification performed (not trusting dev/QA claims):

- **AC1 (shared helper, no duplication; assertions byte-unchanged) — MET.** ONE shared helper at `test/support/temp-dir.ts` exposing `makeTempDir`/`removeTempDir`; the local `removeTempTree` was DELETED from `seed-protocol-race.test.ts` (not copied). Confirmed the lifted removal options are byte-equivalent to the original (`recursive:true, force:true, maxRetries:20, retryDelay:50` + bare `catch{}` swallow) via `git show HEAD:…seed-protocol-race.test.ts`. Both flaky suites adopt it via the relative import `../../../test/support/temp-dir.js`. Diff is purely the create/teardown seam + import lines + comments — every count / error-string / exit-code assertion and the `reapChildren()`-before-removal ordering are byte-unchanged. `existsSync`/`statSync` correctly retained in seed-race (still used by the BUILD-IF-MISSING/STALE worker check); only `mkdtempSync`/`rmSync`/`tmpdir` dropped → no dangling imports (lint green).
- **AC2 (flake eliminated, not masked; Rule-7 non-vacuity) — MET.** Full ROOT `pnpm test` re-run by the reviewer = **185 files / 1668 passed / 0 failed** (dev's 184/1663 + the new 5-case `temp-dir.test.ts`); no `seed-protocol-race` EPERM, no CLI import-dispatch ENOENT (the `agentbbs import: failed — ENOENT … no-such-archive.ndjson` stderr line is the test's ASSERTED negative-path contract, not the flake). **Reviewer-independent Rule-7 mutation** on the load-bearing swallow property: temporarily removed the helper's `try/catch` → the `temp-dir.test.ts` "SWALLOWS a residual removal error" case went RED (`ERR_INVALID_ARG_TYPE` thrown); restored the catch and confirmed the file hashed BYTE-IDENTICAL to the original (`git hash-object` = `96aacad…`) → 5/5 GREEN. The dev's two consumer-suite mutations (seed-race `toBe(1)`→`toBe(2)` RED; CLI `exitCode toBe(1)`→`toBe(0)` RED, both reverted byte-identical) are accepted; those assertions are byte-unchanged in the diff and the full suite is green.
- **AC3 (test-infra only + items closed) — MET.** `git diff HEAD --name-only -- packages/core packages/data-access/src packages/mcp-server/src packages/cli/src` shows ONLY `packages/cli/src/index.test.ts`, `packages/data-access/src/seed-protocol-race.test.ts` (modified) + `packages/data-access/src/temp-dir.test.ts` (new) — no production `.ts`. The new helper lives at repo-level `test/support/`, outside every package `src`, so it ships in no published `@agentbbs/*` `dist`/`exports` (Rule 13 — 17-tool agent contract byte-identical; the tool-contract / wire drift guards run inside the green suite). Both deferred-work items (`E10-baseline-seedrace-eperm`, `E12-postmerge`) flipped OPEN → RESOLVED (Story 13.1) with the shared-helper + N≥3 evidence; original OPEN entries retained for the audit trail.
- **Rule 20 (full gate) — independently re-run, every leg GREEN:** lint 0 (`eslint .`), `prettier --check .` clean, typecheck 0 (`tsc -p tsconfig.typecheck.json`), build clean (`pnpm -r build`), `pnpm test` 1668 passed / 185 files / 0 failed. (A green test count was NOT trusted alone.)
- **Rule 8 (discoverability) — MET.** The new helper-contract test `packages/data-access/src/temp-dir.test.ts` matches the root Vitest project glob `packages/*/src/**/*.test.{ts,tsx}` (node env) → collected by ROOT `pnpm test`. The helper `test/support/temp-dir.ts` matches NEITHER glob (not under `packages/*/src`, no `.test.` suffix) → correctly import-only, never collected as a test. Placement is correct.
- **Rules 1 / 3 / 5 / 6 — N/A / satisfied.** Rule 1 (Integration AC): no service introduced — pure test-infra refactor of an existing seam. Rule 3 (real-runtime): exempt — non-user-facing test-infra story (no production surface touched); the consumer suites already drive real forked workers / real CLI dispatch. Rule 5: no NFR amendment. Rule 6: ADR registry `docs/adr/` — none present, none referenced.

**Dismissed (3, noise / false positive):**
1. *Swallow test uses `undefined` not a real Windows `EPERM`.* — Dismissed: the helper's `catch` is bare (`catch {}`), swallowing ANY throw identically, so the deterministic `ERR_INVALID_ARG_TYPE` proxy exercises the exact production path and is mutation-proven non-vacuous. A real EPERM is non-deterministic and OS-specific; the proxy is the correct cross-platform stand-in.
2. *Helper not in `tsconfig.typecheck.json` include set.* — Dismissed: `tsc` follows the relative import transitively from the two in-scope test importers; typecheck exit 0 confirms the helper is type-checked.
3. *Possible unused import after the seam swap.* — Dismissed: `existsSync`/`statSync` remain used by the worker build-staleness check; lint is green (0 errors).

No new deferred items. Left UNCOMMITTED for the lead's post-CR smoke gate.
