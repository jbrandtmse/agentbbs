# Test Automation Summary — Story 13.1 (Windows temp-dir teardown flake hardening)

QA stage: `qa-generate-e2e-tests`. Date: 2026-06-10. Epic 13 (deferred-work cleanup & hardening), TEST-INFRA-ONLY story.

## Generated Tests

### Helper-contract test (discoverable by default ROOT `pnpm test`, Rule 8)
- [x] `packages/data-access/src/temp-dir.test.ts` — direct, discoverable contract test of the shared test-only helper `test/support/temp-dir.ts` (the Story 13.1 deliverable). 5 tests:
  - `makeTempDir` creates a real directory under `os.tmpdir()` (hermetic — never the repo tree).
  - `makeTempDir` preserves the requested prefix and is unique per call (the per-test no-collision guarantee).
  - `removeTempDir` removes a real, non-empty tree (nested dirs + files).
  - `removeTempDir` is idempotent on an already-removed dir (no throw).
  - `removeTempDir` SWALLOWS a residual removal error instead of throwing — the load-bearing teardown-must-never-fail-the-gate property.

## Why this test

The deliverable is a shared test-support helper whose robustness IS the fix for the two recorded Windows temp-dir teardown flakes (`E10-baseline-seedrace-eperm`, `E12-postmerge`). The two consumer suites exercise the helper's create/teardown seam only as a side effect of their own assertions — they prove the SUITES are green, not that the helper's contract holds. This QA test pins the helper's two load-bearing properties (hermetic-unique create; best-effort error-swallowing teardown) DIRECTLY and discoverably.

## Discoverability (Rule 8)

Co-located at `packages/data-access/src/temp-dir.test.ts`, named `*.test.ts`, so the ROOT `pnpm test` collects it via the `packages/*/src/**/*.test.{ts,tsx}` node project glob. A test under `test/support/` would NOT have been collected — the root globs only cover `packages/*/src` and `apps/*/src`; that placement was rejected. The helper import uses the same relative path (`../../../test/support/temp-dir.js`) as the two consumer suites.

## Non-vacuity (Rule 7)

Mutation-tested: temporarily replaced the helper's `catch {}` swallow with `catch (e) { throw e }` → the SWALLOWS test went RED (`expected [Function] to not throw … TypeError [ERR_INVALID_ARG_TYPE]`), the other 4 stayed green. Reverted the helper byte-identical → 5/5 green. The swallow assertion discriminates.

## Gate (Rule 20 — full canonical gate, ROOT commands, independently re-run)

- lint (`eslint .`): 0
- typecheck (`tsc -p tsconfig.typecheck.json`): 0
- build (`pnpm -r build`): clean (required — seed-protocol-race forks a built worker dist)
- test (ROOT `vitest run`): 185 files / 1668 passed / 0 failed (was 184/1663; +1 file, +5 tests)
- format (`prettier --check .`): clean

## Contract / scope discipline

- Production-source diff EMPTY: `git diff HEAD -- packages/core packages/data-access/src packages/mcp-server/src packages/cli/src` excluding `*.test.ts(x)` shows nothing. 17-tool agent contract byte-identical.
- Did NOT weaken or duplicate the two consumer suites' assertions (`seed-protocol-race.test.ts`, `cli/index.test.ts` left exactly as the dev shipped them).
- The shared helper `test/support/temp-dir.ts` is byte-unchanged (mutation reverted; confirmed via the test going green again on the original catch block).

## Next Steps (lead)

- Lead per-story smoke + commit. All changes left uncommitted (QA does not commit).

---

# Test Automation Summary — Story 13.2 (Shiki serialization flake hardening)

QA stage: `qa-generate-e2e-tests`. Date: 2026-06-10. Epic 13, TEST-INFRA-ONLY story.

Story 13.2 killed the `@shikijs/primitive@4.1.0` full-suite tokenizer flake by collecting
the 12 highlighter-using test files into a serialized Vitest project (`markdown-serial`,
`fileParallelism: false`), excluded from the two parallel projects. No new product
surface. The QA-relevant risk is purely DISCOVERABILITY (Rule 8): do the 12 files run
exactly ONCE in `markdown-serial`, not zero / not twice — and does the mapping stay
correct as the codebase grows.

## Generated Tests

### Discoverability drift-guard (durable, runs in default ROOT `pnpm test`, Rule 8)
- [x] `packages/ui-shared/src/markdown/highlighter-serialization.guard.test.ts` — pins the
  `highlighterSuites` list (single source of truth) against the actual set of test files
  that import/mount the markdown renderer. 4 assertions: scan-non-empty + size-12 sanity;
  every highlighter-using file is serialized (none missing); no stale entries; the two
  sets are exactly equal. Catches the SILENT regression class — a future renderer-mounting
  test not added to the serial list (would tokenize concurrently and resurrect the flake);
  the guard goes RED first.
- [x] `vitest.highlighter-suites.ts` (supporting module) — extracted the list so the guard
  imports the source of truth WITHOUT dragging `vitest.config.ts` (and its non-project
  `passWithNoTests` typings) into the typecheck program. `vitest.config.ts` now imports it.

## Verification Evidence

- **Collection mapping (empirical, `vitest list` parse):** the 12 highlighter files run in
  EXACTLY `markdown-serial`. Per-project counts `{agentbbs: 161, ui-shared-dom: 13,
  markdown-serial: 12}` = 186 unique files, ZERO double-runs.
- **List completeness:** repo-wide scan for highlighter-trigger imports returns EXACTLY
  the 12 listed files — no highlighter-using file fell outside the serial project
  (non-listed candidates matched only type-only `RoomViewModel` imports / prose).
- **Env/DOM preserved:** `markdown-serial` standalone = 12 files / 175 tests GREEN under
  happy-dom; `.tsx` renders work (no `document is not defined`); pure-node `.ts` pass too.
- **Rule-7 non-vacuity:** drop a serialized file → RED; plant a phantom renderer test not
  in the list → RED; clean restore → GREEN. Discriminates in both drift directions.
- **Contract frozen (Rule 13):** `git diff HEAD -- packages/core packages/mcp-server/src`
  EMPTY; `packages/ui-shared/src` production byte-identical (only the new guard added).
- **Full gate (Rule 20):** format clean, lint clean, typecheck exit 0, ROOT `pnpm test`
  ×2 = 186 files / 1672 tests passed; zero `startIndex` fault, zero `document is not defined`.

## Findings (handed to lead/CR)

- The dev's (and pre-existing) `passWithNoTests: true` inside per-PROJECT configs is
  technically invalid per the installed `vitest@4.1.7` types (it is a top-level-only
  `NonProjectOptions` key). It is PRE-EXISTING on HEAD, harmless at runtime, and never
  caught because `vitest.config.ts` is outside the typecheck `include`. The QA guard
  imports the list from a separate types-free module precisely so it does NOT newly expose
  this latent error in the gate. Flagged, not fixed (out of scope; not a 13.2 regression).

## Next Steps (lead)

- Lead per-story smoke + commit. All changes left uncommitted (QA does not commit).
