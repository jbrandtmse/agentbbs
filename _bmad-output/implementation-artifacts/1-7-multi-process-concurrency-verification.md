---
story_id: "1.7"
story_key: "1-7-multi-process-concurrency-verification"
epic: 1
baseline_commit: "1748ef07cd643154eece0edd8fa335419a96e617"
---

# Story 1.7: Multi-process concurrency verification

Status: done

## Story

As a developer,
I want an automated test proving concurrent appends from multiple processes lose no writes and receive a strict total order,
so that NFR3/NFR10 — the correctness lynchpin — is demonstrably true before anything builds on it.

## Acceptance Criteria

**AC1 — N×M concurrent appends, strict total order, no lost writes**
**Given** N concurrent writer processes each appending M events to one shared DB,
**When** the test completes,
**Then** exactly N×M rows exist, every `seq` is unique and strictly monotonic with no gaps that violate ordering, and no write is lost,
**And** the same total order is observed by every reader folding the ledger.

**AC2 — Survives induced lock contention**
**Given** the same scenario under induced lock contention,
**When** writers hit `SQLITE_BUSY`,
**Then** the busy-timeout + retry resolves them and the final row count is still exactly N×M.

## Integration ACs

This story is the **integration correctness proof** of the entire Epic 1 ledger stack (connection 1.4 + append 1.5 + reads 1.6) under real multi-process concurrency. Per skill-rules Rule 1, it introduces no new service — it is the verification gate. The proof itself is the deliverable: a real-runtime test that spawns genuine OS processes (not just threads) writing to one shared SQLite file and asserts the total-order/no-loss guarantees. It also exercises (and thereby validates) the Story 1.4 bounded-retry path under genuine contention — closing the LOW deferral logged for Story 1.4 (no inter-attempt backoff) by demonstrating the retry actually resolves real `SQLITE_BUSY` at this concurrency.

## Consumed-by

- The whole system — this is the gate that licenses every later epic to build projections on `seq` as a correct total order. No downstream code consumes it directly; its passing is the precondition.

## Tasks / Subtasks

- [x] **Task 1: Concurrent-writer harness** (AC: 1)
  - [x] Add a worker entry that, given a DB path + an event count M (and a base label so events are attributable to their writer), opens the shared DB via the Story 1.6 `createDataAccess`/connection and appends M events through the real `append` path. It must run as a SEPARATE OS PROCESS (use `child_process.fork`/`spawn` of a BUILT worker in `dist`, or a `node`-executed built file) — true multi-process, NOT `worker_threads` (threads share the process and don't exercise cross-process WAL/busy_timeout faithfully). Document the mechanism.
  - [x] Choose N and M to be faithful yet fast/reliable in CI (e.g. N=4–8 processes × M=100 events). Document the chosen values and the rationale (must comfortably induce real contention without being flaky/slow). Each event must carry a unique attributable marker (writer id + sequence-within-writer) so loss/duplication is detectable.
- [x] **Task 2: AC1 assertions** (AC: 1)
  - [x] The orchestrating Vitest test: create a fresh temp DB (migrated), spawn N writer processes concurrently, await all, then assert via the Story 1.6 read path:
    - exactly N×M event rows exist;
    - every `seq` is unique and strictly increasing with no ordering-violating gaps (AUTOINCREMENT may legitimately skip values after a rolled-back txn, but within committed rows `seq` must be unique + strictly monotonic — assert uniqueness + strict increase, and that the set of attributable markers is exactly the N×M expected, i.e. no lost/duplicated writes);
    - every writer's M markers are all present (no lost writes);
    - reading the ledger twice / from independent reads yields the identical `seq` order (same total order for every reader).
- [x] **Task 3: AC2 induced-contention variant** (AC: 2)
  - [x] A variant (or the same test tuned) that deliberately maximizes write contention (e.g. all N processes start simultaneously / tight append loops with no stagger) so `SQLITE_BUSY` is actually hit and the 1.4 busy-timeout+retry resolves it. Assert the final row count is still exactly N×M (retry recovered every contended write; no `StoreBusyError` escaped at this N/M — or if exhaustion is possible at the chosen N/M, tune down so the documented retry budget reliably wins, and document the margin).
  - [x] If feasible, surface evidence that contention actually occurred (e.g. count retries, or assert timing/interleaving) so the test isn't trivially un-contended. Document how contention is ensured.
- [x] **Task 4: Discoverability, hygiene, gates** (AC: 1, 2)
  - [x] The test MUST be discoverable by the default `pnpm test` (Rule 8) — correct naming, not excluded/tagged-out. It depends on built worker output: ensure the worker is built before the test runs (the test can `pnpm -r build`-dependency or the worker file is part of the package build; document the ordering so `pnpm test` alone — and CI — runs it green from a clean state). If a built artifact is required, make the test robust (build-if-missing or rely on the CI `build` step that precedes `test`).
  - [x] Use OS temp dirs only; never the repo's `.agentbbs/`. Clean up temp DB + `-wal`/`-shm` sidecars and any spawned processes (no orphans) even on failure. Keep total runtime reasonable (seconds, not minutes) to avoid CI flakiness; set an explicit generous test timeout.
  - [x] Run `pnpm -r build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run format` — all exit 0. Run the concurrency test a few times to confirm it is NOT flaky (document the repetitions).

## Review Findings (code-review, 2026-05-31)

**Outcome: CLEAN — APPROVED. 0 decision-needed, 0 patch, 0 defer, 4 dismissed as noise.**

Independently re-ran ALL gates (did not trust the report): `pnpm -r build` exit 0 (worker emitted to `dist/concurrency-worker.js`); `pnpm run typecheck` exit 0; `pnpm run lint` exit 0; `pnpm test` exit 0 (99 passed / 15 files); `pnpm run format` (`prettier --check .`) exit 0.

**Genuineness (Rule 3) — confirmed real-runtime, not stubbed.** Traced the full path in source: worker forks the BUILT `dist/concurrency-worker.js` via `child_process.fork` (real OS processes, NOT `worker_threads`); each writer calls real `createDataAccess.append([event])` → `runWithRetry(() => appendBatch.immediate(events))` (real BEGIN IMMEDIATE write lock + bounded retry + `StoreBusyError` from `connection.ts`); orchestrator reads back via real `eventsSince(0)` → `WHERE seq > 0 ORDER BY seq ASC`. Schema confirms `seq INTEGER PRIMARY KEY AUTOINCREMENT` (strictly monotonic, never reused). Marker `writer-<id>#<index>` is round-tripped verbatim through `mapping.ts` (`identity.seen` handle), so it is genuinely per-writer-unique — loss shrinks the set, duplication collapses the dedup count. Nothing in the 1.4–1.6 ledger impl is stubbed.

**AC1 strictness — would FAIL on a defect.** `events.length === 600`; strict `seq[i] > seq[i-1]` over read order; `new Set(seqs).size === 600`; full marker-set EQUALITY `toEqual(expectedMarkers)` (detects lost AND duplicated writes); a second independent reader folds the identical `seq` + marker order. Exact assertions, not existence checks. `seq > 0` with AUTOINCREMENT starting at 1 excludes no row.

**AC2 strictness — real contention traversed, hard-fail on escape.** Writer 0 holds a real `BEGIN IMMEDIATE` lock for 150ms after a synchronized IPC barrier, deterministically blocking the other 5 writers' first appends; asserts all AC1 invariants still hold, `busyErrors === 0`, and `slowestContended > LOCK_HOLD_MS * 0.3` (45ms — proves the busy path was genuinely traversed, not trivially un-contended). An escaped `StoreBusyError` rethrows in the worker → `process.exit(1)` → orchestrator `exit` handler rejects → hard test failure (never silently swallowed; `busyErrors` is 0 by construction, asserted as the invariant). AC2 wall time ~814ms vs AC1 ~609ms, consistent with the 150ms hold + contention.

**Flakiness / hygiene — confirmed.** Ran the concurrency test 10× this session (8× isolated battery + 1 verbose + 1 clean-dist), all green. Node process count stable 33→33 (zero orphans). Zero leftover `agentbbs-concurrency-*` temp dirs after all runs. Generous 60s per-test timeout. The dev's thundering-herd fix (pre-migrate once in parent + race the barrier `await` against worker promises) and QA's Windows EBUSY cleanup hardening (`removeTempTree` with `maxRetries:20, retryDelay:50, force`) are sound and cleanup-only — neither weakens an assertion.

**Build-if-missing — verified from clean dist.** Deleted `packages/data-access/dist/concurrency-worker.js`, ran ONLY the concurrency test: `beforeAll` rebuilt the artifact via `tsc -b --force` and passed 2/2. Confirms `pnpm test` is self-contained locally and CI's build→test ordering covers it.

**Scope (Rule 5) — impl unchanged.** `git status` confirms only the two new files (`concurrency-worker.ts`, `concurrency.test.ts`) plus tracking docs changed; HEAD is at baseline `1748ef0` and no 1.4–1.6 ledger source is modified. No correctness bug found; none masked.

**Rule 6 (ADR):** `docs/adr/` confirmed absent — no ADR constraints. **Rule 1 (verification gate):** introduces no new service; it is the integration correctness proof, as declared. **Rule 8 (discoverability):** `concurrency.test.ts` is co-located, `*.test.ts`-named, in the default Vitest project — runs under `pnpm test` (99 passed) and CI.

### Dismissed findings (noise / false-positive)
- [Review][Dismiss] IPC `done`-before-`exit` ordering — Node delivers `process.send` before `exit(0)`; worker `await delay(0)` flushes; empirically non-flaky across 10 runs.
- [Review][Dismiss] `holdWriteLock` redundant pragma ordering — sets `busy_timeout` then `journal_mode=WAL` on a throwaway connection already in WAL; cosmetic, no correctness impact.
- [Review][Dismiss] AC2 evidence floor (45ms) could over-pass on a pathologically slow host — theoretical; would only over-satisfy the evidence gate, never under-assert correctness; the held lock deterministically forces the wait.
- [Review][Dismiss] `eventsSince(0)` depends on AUTOINCREMENT starting at 1 — verified correct by schema; `seq > 0` captures every committed row.

## Dev Notes

### Scope boundary (read first)
This story delivers the **multi-process concurrency verification test** (+ the small worker harness it needs). **Out of scope:** any change to the ledger implementation itself (1.4–1.6 are done) — if the test reveals a real correctness bug, that's a Rule-5-style halt/surface, not a silent workaround; and all `core` domain logic (Epics 2+). Do NOT weaken the assertions to make a flaky test pass — if it's flaky, fix the harness (timeouts, process cleanup, N/M tuning), not the guarantees.

### Authoritative facts [Source: project-context.md; architecture.md]
- **The correctness gate:** the multi-process concurrency test (N×M appends → unique, strictly monotonic `seq`, no lost writes) is the gate BEFORE anything builds on the ledger. [Source: project-context.md#Testing]
- **NFR3 / NFR10:** multiple stdio processes + UI share one SQLite file without corruption/lost writes (WAL + bounded busy-timeout + retry); `seq` is the monotonic total order assigned by SQLite's single-writer serialization — no extra coordination. [Source: project-context.md#SQLite concurrency; architecture.md#Data Architecture]
- **Daemonless model:** N per-agent processes open the one shared file — this test mirrors production faithfully (real processes, not threads). [Source: architecture.md#Process model]

### Build on Stories 1.4/1.5/1.6 (committed through 1748ef0)
- `createDataAccess` (1.6) opens via path discovery + migrate and exposes `append` + reads; `connection.ts` (1.4) supplies WAL + busy_timeout=5000 + the bounded-retry helper + `StoreBusyError`; `append` (1.5) is transactional per call. The worker uses `createDataAccess`/the connection against a shared path; the orchestrator reads back via the 1.6 queries. This test is the named consumer that validates the Story 1.4 LOW deferral (retry-no-backoff) under real load.

### Research-First [Source: .claude/rules/research-first.md]
Verify: `child_process.fork` vs `spawn` for a built ESM worker on Node 24 (passing args/env, awaiting exit, collecting failures), how better-sqlite3 behaves across concurrent processes under WAL (it WILL surface `SQLITE_BUSY` despite busy_timeout in some interleavings — that's the point), and Vitest patterns for orchestrating child processes + setting a per-test timeout. Verify before coding.

### Testing standards [Source: project-context.md#Testing]
Vitest, discoverable, typecheck-clean. Real OS processes + real SQLite file in a temp dir. This single test is the most load-bearing in the project — its assertions must be strict (exact N×M, unique strictly-monotonic seq, full marker-set equality) and it must be reliable (run it multiple times; no orphan processes; explicit cleanup + timeout).

### Project Structure Notes
- Likely files: a worker entry under `packages/data-access/src/` (e.g. `concurrency-worker.ts`, built to dist) + the orchestrating `*.test.ts` co-located in `data-access`. Keep better-sqlite3 inside data-access. Document any build-ordering requirement so `pnpm test` (and CI, which builds first) runs it green.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.7: Multi-process concurrency verification]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture (Concurrency) / Process model (daemonless V1)]
- [Source: _bmad-output/project-context.md#SQLite concurrency / Testing]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md (Story 1.4 LOW — retry no-backoff, validated here)]
- [Source: .claude/rules/research-first.md]

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Research-First (Perplexity MCP `reason`, 2026-05-30): confirmed `child_process.fork` of a BUILT ESM dist worker on Node 24 (argv for scalars + IPC channel for structured results/barrier; `message`+`exit` promise pattern; treat any non-zero exit / pre-result exit as failure); confirmed `busy_timeout=5000` will MASK brief contention unless writers are synchronized onto the write lock simultaneously; confirmed Vitest per-test `{ timeout }` + child reaping in `afterEach`/`finally`.
- Flakiness investigation: an early 50-rep battery hit ONE 60s timeout. Root cause = (a) a thundering herd of N concurrent first-run `migrate()` calls contending for the write lock at worker startup (a `StoreBusyError` could kill a worker before it sent `ready`), and (b) a non-racing start barrier (`await allReady`) that then hung forever waiting on a readiness that could no longer be reached. Fix (HARNESS ONLY — assertions untouched): pre-migrate the shared DB once in the parent before forking, and race the barrier `await` against the worker promises so any startup death rejects instantly. Post-fix: 37/37 consecutive green (15 + 10 + 12 batteries), zero orphan node processes (proc count 33→33).
- Contention probe (latency evidence, AC2): per-writer `maxAppendMs` for the 5 contending writers measured 184–448 ms against writer 0's 150 ms held lock, while the holder itself stayed ~1.5 ms and `busyErrors` stayed 0 across all writers — proving the busy/retry path is genuinely traversed and the 1.4 busy_timeout+retry resolves every contended write.
- Gate evidence (final, all exit 0): `pnpm -r build` ✅; `pnpm run typecheck` ✅; `pnpm run lint` ✅ (one `no-useless-assignment` finding fixed — dead `busyErrors++` before a `throw` replaced with a loud rethrow); `pnpm test` ✅ 99 passed (97 prior + 2 new); `pnpm run format` ✅.
- Build-if-missing verification: deleting `dist/concurrency-worker.js` and running ONLY the test rebuilds via `tsc -b --force` (plain `tsc -b` skipped emit off a fresh `.tsbuildinfo` when only the `.js` was removed — `--force` fixes that) and passes from a clean state.

### Completion Notes List

- ✅ **AC1** — N×M (6×100 = 600) concurrent appends from REAL OS PROCESSES (`child_process.fork` of the built `dist/concurrency-worker.js`, NOT `worker_threads`) to one shared SQLite ledger: asserts exactly 600 rows; every `seq` unique + STRICTLY increasing in read order; the attributable-marker set (`writer-<id>#<index>`) is EXACTLY the 600 expected (no lost/duplicated writes); every writer's own M markers present; and a second independent reader folds the identical `seq` + marker order (one total order for every reader).
- ✅ **AC2** — induced lock contention: writer 0 holds a real `BEGIN IMMEDIATE` write lock for 150 ms after a synchronized start barrier, forcing the other 5 writers' first appends to contend; all AC1 invariants STILL hold; `busyErrors === 0` for every writer (the 1.4 busy_timeout+retry resolved every contended write); and contention is proven by asserting the slowest contending append exceeded `LOCK_HOLD_MS * 0.3`. This closes the Story 1.4 LOW deferral (retry no-backoff) — demonstrated to win under genuine cross-process load, with ~33× margin (150 ms hold vs 5000 ms busy_timeout).
- **Rule 5 (NFR tripwire):** no ledger correctness bug found — assertions are strict and all pass; ledger impl (1.4–1.6) untouched. A `StoreBusyError` escaping the real append path would have rethrown → worker non-zero exit → test failure (never silently swallowed).
- **Rule 6 (ADRs):** verified `docs/adr/` does NOT exist — no ADR constraints to honor.
- **Rule 8 (discoverability):** `concurrency.test.ts` is co-located, `*.test.ts`-named, in the default Vitest project (runs under `pnpm test` and CI). The forked artifact dependency is satisfied by CI's `build`→`test` ordering and, for local runs, a build-if-missing/stale `beforeAll`.
- **Scope:** added ONLY the verification test + its small worker harness; no change to the 1.4–1.6 ledger impl or any `core` domain logic.
- **N/M rationale:** N=6 writers (must serialize on SQLite's single-writer lock) × M=100 events; large enough for real sustained contention after the barrier, fast enough (~1–3 s per run) to stay non-flaky in CI; the 5 s busy_timeout + 3-attempt retry reliably win at this scale (zero `StoreBusyError`).

### File List

- packages/data-access/src/concurrency-worker.ts (new — forked per-writer worker; built to dist)
- packages/data-access/src/concurrency.test.ts (new — orchestrating multi-process verification test; AC1 + AC2)
- _bmad-output/implementation-artifacts/1-7-multi-process-concurrency-verification.md (story: tasks checked, status→review, baseline_commit, Dev Agent Record)
- _bmad-output/implementation-artifacts/sprint-status.yaml (status: 1-7 → in-progress → review)

## QA Notes (qa-generate-e2e-tests, 2026-05-31)

QA verified the deliverable-as-test is GENUINE and STRICT — not vacuous — and hardened cleanup only.

- **Genuineness confirmed (Rule 3, real-runtime evidence).** Traced the full path: the worker forks the BUILT `dist/concurrency-worker.js` via `child_process.fork` (real OS processes, NOT `worker_threads`); each writer appends through the real `createDataAccess.append` → `runWithRetry` → `appendBatch.immediate` (BEGIN IMMEDIATE write lock) seam; the orchestrator reads back through the real `eventsSince(0)` (ORDER BY `seq` ASC). Nothing in the ledger impl is stubbed.
- **Assertions would actually FAIL on a defect.** AC1 asserts `events.length === 600`, strict `seq[i] > seq[i-1]` over read order, `new Set(seqs).size === 600` (uniqueness), and full marker-set EQUALITY `new Set(observedMarkers).toEqual(expectedMarkers)` — a lost write shrinks the set (inequality + count fail), a duplicate collapses the dedup count. A second independent reader must fold the identical `seq` + marker order. These are exact, not existence checks.
- **AC2 induces real contention.** Writer 0 holds a real `BEGIN IMMEDIATE` lock for 150ms after a synchronized IPC start barrier, deterministically blocking the other 5 writers' first appends; asserts all AC1 invariants still hold, `busyErrors === 0` (1.4 busy_timeout+retry resolved every contended write), and slowest contending append > `LOCK_HOLD_MS * 0.3` (proves the busy path was traversed — not trivially un-contended). An escaped `StoreBusyError` rethrows → worker non-zero exit → hard test failure (never silently counted).
- **Non-flaky (Rule 8).** Ran the concurrency test 22× consecutively this session (12 + 5 + 5), all green; zero orphan node processes (stable at 33); zero leftover temp dirs from QA runs.
- **Discoverability (Rule 8).** Confirmed `concurrency.test.ts` is co-located, `*.test.ts`-named, matched by the root Vitest project include glob → runs under default `pnpm test` (99 passed) and in CI (`.github/workflows/ci.yml` build→test→typecheck→lint→format). Verified build-if-missing: deleted `dist/concurrency-worker.js`, ran ONLY the test, it rebuilt the artifact via `tsc -b --force` and passed 2/2 from clean dist.
- **Hardening (cleanup only; NO assertion changed).** Found one PRE-EXISTING orphan temp dir from an earlier (pre-QA) run with intact `-wal`/`-shm` sidecars — evidence of a rare Windows handle-release race where `rmSync` hits EBUSY/EPERM because a just-SIGKILLed worker still holds the WAL handle. Added `removeTempTree()` wrapping `rmSync` with `maxRetries: 20, retryDelay: 50` (linear backoff, retried on EBUSY/EPERM/ENOTEMPTY per Node fs docs; active with `recursive: true`) to absorb that window. Both cleanup call sites use it. Did NOT add a redundant second concurrency test or runner.
- **Gates after hardening (all exit 0):** `pnpm -r build` ✅; `pnpm run typecheck` ✅; `pnpm run lint` ✅; `pnpm test` ✅ 99 passed; `pnpm run format` ✅ (Prettier-clean). ADR registry `docs/adr/` confirmed absent — no ADR constraints.

## Change Log

| Date | Change |
| --- | --- |
| 2026-05-31 | Implemented Story 1.7: multi-process concurrency verification test (`concurrency.test.ts`) + forked worker harness (`concurrency-worker.ts`). AC1 (exact N×M, unique strictly-monotonic `seq`, no lost/dup writes, one total order for every reader) and AC2 (survives induced lock contention; retry resolves every contended write; contention proven by latency). Validates the Story 1.4 retry-no-backoff LOW deferral under real cross-process load. Harness made non-flaky (pre-migrate + raced barrier; 37/37 green, no orphans) and self-contained (build-if-missing). All gates green (build/typecheck/lint/test 99 passed/format). Status → review. |
| 2026-05-31 | QA (qa-generate-e2e-tests): verified test genuineness + strict assertions; 22× non-flake battery (all green, no orphans); confirmed discoverability + build-if-missing from clean dist. Hardened temp-tree cleanup against a rare Windows EBUSY/EPERM handle-release race (`rmSync` `maxRetries`/`retryDelay` via new `removeTempTree`) — cleanup only, no assertion changed. All gates re-run green (build/typecheck/lint/test 99 passed/format). |
