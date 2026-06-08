# Test Automation Summary — Story 12.2 (onboarding announces the project sub-board)

QA stage: `qa-generate-e2e-tests`. Asset + tests story (FR41), NO board-engine change (Rule 13).
Canonical gate = ROOT `pnpm test` (cross-package resolves against live `src`).

## Strengthening rationale

The dev's coverage was already substantial (content-guard + 3 real-runtime cases, both
mutation-tested). QA targeted the three thin spots the lead flagged.

### AC2 — three-way `project_id` consistency, bound to core's ACTUAL slug rule

Gap: the dev's derivation guard pinned that the asset MENTIONS git-remote/origin, folder name,
`@<project>`, and `project_id` — but did NOT pin that the asset describes core's ACTUAL slug
algorithm (the Dev-Notes "do not invent a divergent one" hazard). Added two content-guard cases in
`identity-bootstrap-doc.test.ts`:

- **`states core's ACTUAL slug rule … bound to packages/core/src/projects/slug.ts`** — reads
  `slug.ts` as TEXT (no deep cross-package import → zero typecheck risk) and asserts the bootstrap
  block describes each of core's three transforms: lowercase (`.toLowerCase()`), collapse every run
  of non-`[a-z0-9]` to a single `-` (`/[^a-z0-9]+/g`), strip leading/trailing `-` (`/^-+|-+$/g`).
  Sanity-pins those literals are present in slug.ts first, so the guard can't go vacuous if core's
  algorithm moves. A divergent slug DESCRIPTION in the asset OR a core slug-rule change the asset
  fails to follow turns it RED.
- **`the worked example is slug-consistent`** — applies core's rule (mirrored from slug.ts literals,
  whose presence is asserted) to the worked-example title `Taskflow`, asserting it yields the stated
  `project_id` `taskflow` AND the handle `amelia-dev@taskflow`'s `@<project>` scope — the concrete
  three-way anchor.

Integration: strengthened the first-agent AC #2 assertion in
`identity-bootstrap-workflow.integration.test.ts` to bind the three-way to a `coreSlug` mirror
(`derivedId = coreSlug(title)`; `derivedId === PROJECT_ID`; `sc.project_id === derivedId`;
`handle.endsWith('@'+derivedId)`) rather than the hardcoded constant — so a live-tool slug drift
surfaces as `sc.project_id !== coreSlug(title)`.

### AC1/AC3 — "exactly one sub-board" + "no error surfaced", non-hiding

Gap: `readProject` uses `.find` (first match), which would MASK a second same-id directory record;
`announcedCount === 1` only counts announcement EVENTS. Added `projectRecordCount` (a
`.filter().length` over the live `list_projects` directory) and asserted it `=== 1` in BOTH
idempotent paths (second SESSION same agent; second AGENT same repo) — the non-hiding "exactly one
sub-board record" form. The `join_board` no-error and `PROJECT_EXISTS`-is-the-expected-branch
assertions were already present and load-bearing.

## Mutation tests (Rule 7) — all non-vacuous, all reverted byte-identical

| # | Mutation | Result |
|---|---|---|
| 1 | Asset slug rule → divergent "replace spaces with `-`" (drop `[a-z0-9]`/strip clauses) | slug-rule guard RED. Reverted byte-identical. |
| 2 | core `slug.ts` `.toLowerCase()` → `.normalize()` | slug-rule guard sanity-pin RED (bind to source-of-truth proven). `slug.ts` restored, `git diff` empty (Rule 13). |
| 3 | integration `coreSlug` drop `.toLowerCase()` | first-agent AC2 three-way RED. Reverted byte-identical. |
| 4 | `projectRecordCount(...)` expectation `1 → 2` | second-session AC3 RED (assertion discriminates). Reverted. |
| 5 | Perturb a char INSIDE the install-kit inlined bootstrap block | drift pin (`inlines the identity-bootstrap sentinel block VERBATIM`) RED. Kit restored byte-identical. |

The dev's prior call-form phantom-scan mutations (rename `announce_project{` → phantom RED) remain
covered by the dev's existing cases; the broadened `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` candidate
pattern + the `project_id`/`title`/`description`/`origin`/`taskflow` allowlist (Rule 18) are present
in both guards.

## Two-places drift (Rule 18 / Epic-8 lesson)

`install-kit-doc.test.ts` drift pin GREEN; explicit byte-compare of the two
`AGENTBBS-IDENTITY-BOOTSTRAP` sentinel blocks = BYTE-IDENTICAL. Mutation #5 confirms a divergence
turns the pin RED.

## Discoverability (Rule 8)

All additions extend existing default-suite `.test.ts` files — discoverable, not ignored, not opted
out. Confirmed present in the root `pnpm test` run.

## Gate (Rule 20 — full canonical gate, independently re-run)

- `pnpm run lint` — 0 errors
- `pnpm run typecheck` — 0 errors
- `pnpm run build` — clean
- `pnpm test` — 1605 passed (182 files, 0 failed)
- `pnpm run format` (`prettier --check .`) — clean (fixed one formatting warning the edit introduced)

Rule 13: `git diff HEAD -- packages/core packages/data-access` is EMPTY; board-engine source
byte-identical; only the 3 test files changed by QA (the two assets are dev-authored, unchanged by QA —
all mutation tests restored byte-identical).
