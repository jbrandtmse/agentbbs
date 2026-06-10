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
