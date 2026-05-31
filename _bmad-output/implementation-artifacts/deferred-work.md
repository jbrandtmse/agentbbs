# Deferred Work

Items deferred during the epic-cycle (code review, dev, QA). Each entry: story ID, severity, summary, rationale, suggested resolution. Clear an item when a later story resolves it.

## Deferred from: code review of story 1.2 (2026-05-30)

- **Story 1.2 · LOW · Unused `eslint-plugin-boundaries` dependency.**
  - **Summary:** `eslint-plugin-boundaries` is declared in root `package.json` `devDependencies` and the `pnpm-workspace.yaml` catalog (and is present in `pnpm-lock.yaml`, 4 occurrences) but is never imported by `eslint.config.js`. The dev deliberately implemented all three import-boundary clauses with `no-restricted-imports` instead (documented in the Dev Agent Record).
  - **Rationale:** Dead installed weight; mildly contradicts the Dev Agent Record's own "eslint-plugin-boundaries was NOT added" note. Not blocking — the boundary rules are fully functional and independently proven to fire without it. Removing it now would churn the lockfile right before the lead's smoke/commit, which is undesirable mid-review.
  - **Suggested resolution:** In a follow-up housekeeping change, remove `eslint-plugin-boundaries` from root `devDependencies`, drop its catalog entry in `pnpm-workspace.yaml`, and refresh `pnpm-lock.yaml`. Re-run `pnpm install` + `pnpm run lint`/`test`/`build` to confirm still green.

## Deferred from: code review of story 1.4 (2026-05-31)

- **Story 1.4 · LOW · `runWithRetry` has no inter-attempt backoff for immediately-surfaced busy errors.**
  - **Summary:** `runWithRetry` (`packages/data-access/src/sqlite/connection.ts`) retries a busy `fn()` back-to-back with zero delay between whole-call attempts. The documented concurrency model relies on better-sqlite3's per-call `busy_timeout=5000ms` to block-and-wait *inside* each `fn()` before it throws, so in real contention the bounded attempts are naturally spaced (~`busy_timeout × attempts` worst case). For busy errors that SQLite surfaces *immediately* without waiting (e.g. a `SQLITE_BUSY_SNAPSHOT` WAL write-write collision, or any connection that has set `busy_timeout=0`), all `MAX_WRITE_ATTEMPTS` (3) fire within microseconds — the retry provides little practical benefit in that narrow case. The behavior is correctly BOUNDED (no busy-spin: capped at `attempts`, then a typed `StoreBusyError`), and matches NFR3/AR4 as worded ("WAL + busy_timeout + bounded retry" — no jittered-backoff requirement). Not a blocker.
  - **Rationale:** Production connections all open with `busy_timeout=5000` (verified in `openDatabase`), so genuine cross-process contention DOES space the attempts; the zero-gap path is only reachable with the `busy_timeout=0` test-harness condition or the residual instant-`SQLITE_BUSY_SNAPSHOT` case. Adding backoff now would be speculative tuning ahead of real evidence and outside this story's "connection plumbing only" scope.
  - **Suggested resolution:** Validate retry behavior under genuine sustained N×M contention in **Story 1.7** (the multi-process concurrency proof, which is the named consumer that stresses this path). If 1.7 surfaces lost writes or premature `StoreBusyError`s under real load, add a small bounded backoff (e.g. a few ms, optionally jittered) between whole-call attempts in `runWithRetry`. Until then, leave as-is.
