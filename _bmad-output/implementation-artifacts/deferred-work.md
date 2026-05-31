# Deferred Work

Items deferred during the epic-cycle (code review, dev, QA). Each entry: story ID, severity, summary, rationale, suggested resolution. Clear an item when a later story resolves it.

## Deferred from: code review of story 1.2 (2026-05-30)

- **Story 1.2 · LOW · Unused `eslint-plugin-boundaries` dependency.**
  - **Summary:** `eslint-plugin-boundaries` is declared in root `package.json` `devDependencies` and the `pnpm-workspace.yaml` catalog (and is present in `pnpm-lock.yaml`, 4 occurrences) but is never imported by `eslint.config.js`. The dev deliberately implemented all three import-boundary clauses with `no-restricted-imports` instead (documented in the Dev Agent Record).
  - **Rationale:** Dead installed weight; mildly contradicts the Dev Agent Record's own "eslint-plugin-boundaries was NOT added" note. Not blocking — the boundary rules are fully functional and independently proven to fire without it. Removing it now would churn the lockfile right before the lead's smoke/commit, which is undesirable mid-review.
  - **Suggested resolution:** In a follow-up housekeeping change, remove `eslint-plugin-boundaries` from root `devDependencies`, drop its catalog entry in `pnpm-workspace.yaml`, and refresh `pnpm-lock.yaml`. Re-run `pnpm install` + `pnpm run lint`/`test`/`build` to confirm still green.
