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

---

# Story 13.4 — data-access malformed-payload validation + append-invariant test-file lint guard (QA stage)

## Generated / Extended Tests

### 1.6 — malformed-payload validation (`packages/data-access/src/mapping.test.ts`, EXTENDED)
- [x] **Systematic malformed-payload matrix across all 10 closed event types** — a single
  source-of-truth `cases` table drives, per type: a well-formed round-trip (validation does
  NOT fire) + every required STRING key dropped / wrong-typed (number) / NULL + every required
  INTEGER key missing / string-`"x"` / non-integer-`1.5`. Hardens the dev's representative
  subset to EVERY field of EVERY branch (project.announced title/description, announcement.posted
  room_id/subject/body, board.joined project_id, room.participant_added handle, identity.seen
  handle, identity.focus_updated, etc. — all previously unsampled).
- [x] **rowToEvent propagation widened** to a second multi-key type (announcement.posted,
  4-key) so the on-disk JSON → `JSON.parse` → `wireToPayload` chain is proven beyond the dev's
  project.announced case.
- [x] **QA OBSERVATION pinned** — `message_seq` positivity is NOT validated (only integer-ness):
  a negative (`-5`) and zero (`0`) seq currently PASS `requireInt`. Two tests pin this current
  behavior so it is a documented choice, not an unstated gap. **LOW** (see Findings).

### 1.5 — append-invariant test-file lint guard (`packages/data-access/src/append-invariant-guard.test.ts`, NEW)
A durable regression test for `eslint.config.js` block 6 (`APPEND_INVARIANT_TEST_FILE_SYNTAX`),
replacing the dev's throwaway empirical probe. Runs the repo's REAL flat config via the ESLint
Node API (`ESLint.lintText` against a virtual `*.test.ts` path), mirroring
`packages/core/src/boundary-enforcement.test.ts`.
- [x] FIRES on executed `db.prepare('UPDATE events …').run()` (string literal)
- [x] FIRES on executed `db.exec('DELETE FROM events …')`
- [x] FIRES on executed `db.prepare('… ORDER BY created_at …').all()`
- [x] FIRES on UPDATE **and** DELETE inside a **TEMPLATE literal** passed to `.prepare` (Rule-18
  call-form blind spot — both literal forms covered)
- [x] FIRES repo-wide (also under a `packages/core/src/*.test.ts` path, not just data-access)
- [x] PERMITS bare `const sql = 'UPDATE/DELETE/ORDER BY created_at …'` assertion strings
  (boundary-enforcement.test.ts fixture style — never executed)
- [x] PERMITS executed `INSERT INTO events` (append-only permits inserts — the Rule-8 reconciliation)
- [x] PERMITS executed `ORDER BY seq`
- [x] PERMITS the documented `ORDER BY created_at` proof SELECT under its scoped
  `/* eslint-disable no-restricted-syntax */` carve-out (mirrors append.qa.test.ts)

## Mutation Testing (Rule 7) — both halves proven non-vacuous

- **1.6 matrix:** reverted `announcement.posted` `body` from `requireString` → bare `String(wire.body)`
  → EXACTLY the 4 body cases (missing / wrong-typed / null / rowToEvent-propagation) went RED, the
  other 82 stayed GREEN; restored byte-identical → 86/86 GREEN. (Complements the dev's own
  `String/Number` revert that reddened his block.)
- **1.5 guard (direction A — guard active vs off):** reverted block 6 to `no-restricted-syntax: 'off'`
  → all 6 FIRES cases RED, all 6 PERMITS cases GREEN; restored → 12/12 GREEN.
- **1.5 guard (direction B — AST precision vs bare regex):** swapped block 6 to the production
  bare-literal `APPEND_INVARIANT_RESTRICTED_SYNTAX` → EXACTLY the 3 bare-assertion-string PERMITS
  cases went RED (the bare regex wrongly flags fixture strings), INSERT/seq/carve-out PERMITS stayed
  GREEN; restored → 12/12 GREEN. Proves the AST-precision (boundary-fixture-strings-survive) property
  specifically.

## Verification Evidence

- **Contract frozen (AC3 / Rule 13):** `git diff HEAD -- packages/core/src/errors.ts packages/mcp-server/src`
  EMPTY; `MalformedPayloadError` is data-access-local, NOT a `BOARD_ERROR_CODE`. `mapping.ts` has zero
  bare-coercion residue (all branches use `requireString`/`requireInt`).
- **Discoverability (Rule 8):** the new `append-invariant-guard.test.ts` is co-located `*.test.ts`,
  in no ignore list; ran in the default ROOT suite (187 files) and standalone (12 tests).
- **Full gate (Rule 20), every leg:** `pnpm lint` 0 (the re-enabled guard green on all legit code,
  incl. this guard test's own fixture strings — they are args to the local `lint()` helper, not to
  `prepare/exec/run/pragma`, so the AST guard correctly does not self-trip) / `pnpm typecheck` exit 0 /
  `pnpm format` (`prettier --check .`) clean / ROOT `pnpm test` 187 files **1769 passed** 0 failed
  (was 186 / 1687 at dev hand-off; +1 file +82 cases).

## Findings (handed to lead/CR)

- **LOW — `message_seq` positivity unvalidated.** `requireInt` rejects non-numbers/NaN/non-integers
  but accepts negative and zero integers. No AC requires positivity (the AC asks for "missing/wrong-typed",
  not "out-of-range"), and the upstream write path only ever stamps real positive AUTOINCREMENT seq values,
  so a ≤ 0 seq cannot arise except from a hand-corrupted ledger that already failed other invariants.
  Pinned as current behavior, not changed (production untouched by QA). Surfaced for the lead/CR to
  decide whether a positivity guard is worth adding — judged out of scope for this story.

## Next Steps (lead)

- Lead per-story smoke + commit. All changes left UNCOMMITTED (QA does not commit).
