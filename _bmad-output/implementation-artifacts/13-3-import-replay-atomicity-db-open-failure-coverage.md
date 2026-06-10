---
baseline_commit: ad9b30f
---

# Story 13.3: Import replay atomicity + DB-open-failure coverage

Status: done

<!-- Epic 13 (deferred-work cleanup & hardening). Closes deferred-work.md 11.3-replay-nonatomicity + 11.2-dbopen-trigger. Touches packages/cli PRODUCTION code (import.ts) + tests. NO core/MCP/port/contract change — 17-tool agent contract byte-identical. -->

## Story

As an operator restoring a backup,
I want a corrupt/non-contiguous archive to append NOTHING rather than leave a partial ledger,
So that a failed `import` never half-writes my board.

## Acceptance Criteria

1. **(AC1 — atomic import)** Given `agentbbs import` and a NON-CONTIGUOUS / hand-mangled archive (`11.3-replay-nonatomicity`), when the replay runs, then the import is **fully atomic** — a **pre-replay contiguity check** (archived seqs are exactly `1..N`) rejects a bad archive in the **nothing-appended** phase; the valid replay runs as a **SINGLE batched `await dataAccess.append(orderedNewEvents)`** (the existing atomic `.immediate()` transaction); and a **post-append `assignedSeqs[i] === ordered[i].seq` assertion** remains as defense-in-depth. The QA non-atomicity characterization test (`import.test.ts:620`) is **updated to assert an EMPTY ledger** on the now-pre-replay rejection. **No core/MCP/port change** (the batched-atomic `append` already exists — `ports.ts:55-64`).

2. **(AC2 — DB-open-failure coverage on BOTH commands)** Given the DB-OPEN-failure path of AC5 (`11.2-dbopen-trigger`), when `export` and `import` are pointed at an **unopenable `--db`** (an existing directory / a non-SQLite file), then each reports `agentbbs <cmd>: failed …` on stderr + a **non-zero exit**, asserted directly by a test (closing the second half of the AC5 error matrix on **BOTH** commands).

3. **(AC3 — atomicity non-vacuous + items closed)** Given the changes, when tested, then a **Rule-7 mutation confirms atomicity is non-vacuous** (a planted mid-replay throw must leave an **EMPTY** ledger, not a partial one — revert byte-identical → GREEN), and `deferred-work.md` `11.3-replay-nonatomicity` + `11.2-dbopen-trigger` are **closed with evidence**. The 17-tool agent contract + closed error/event sets are byte-identical (`git diff HEAD -- packages/core packages/mcp-server/src` empty; the import error stays a CLI/operator-surface error, NOT a `BOARD_ERROR_CODE`).

## Tasks / Subtasks

- [x] **Task 1 — Make the replay atomic** (AC: #1, #3)
  - [x] In `packages/cli/src/import.ts#runImport`, replace the per-event loop with: (1) pre-replay contiguity check, (2) single batched append, (3) post-append defense-in-depth assertion. DONE — contiguity check placed BEFORE `createDataAccess` (nothing-appended phase); error message `archive is not contiguous: expected seq <i+1>, found <seq> — a normal export is contiguous from 1; nothing was appended.`; empty archive (N=0) vacuously contiguous; single `await dataAccess.append(orderedNewEvents)`; post-append `assignedSeqs[i] !== ordered[i].seq` throws with the existing `/seq mismatch/i` shape.
  - [x] Keep the AC2 empty-board guard + cursor-restore loop unchanged; keep parse/validate BEFORE opening the ledger. DONE.
  - [x] Update the doc-comment block at the top of `import.ts` (step 3) + the `runImport` function doc to describe the three-layer flow. DONE.
- [x] **Task 2 — Update the non-atomicity characterization test** (AC: #1)
  - [x] `import.test.ts` characterization test flipped to assert an EMPTY ledger (`toEqual([])`) on the now-pre-replay rejection; retitled `'a non-contiguous archive is rejected pre-replay → EMPTY ledger (atomic, nothing appended)'`; explanatory comment rewritten to the atomic contract. DONE.
  - [x] AC4 loud-failure test (first-event seq≠1) kept as a faithful guard — it now trips the PRE-replay contiguity check (matcher updated `/seq mismatch/i` → `/not contiguous/i`); also asserts the ledger stays EMPTY. Describe-block + title updated to reflect "rejected pre-replay, nothing appended". DONE.
- [x] **Task 3 — Direct DB-open-failure tests on BOTH commands** (AC: #2)
  - [x] Added `exportCommand` DB-open test: `--db` at an existing DIRECTORY and at a non-SQLite junk file → `agentbbs export: failed —` + `process.exitCode === 1` (savedExitCode seam). DONE.
  - [x] Added symmetric `importCommand` DB-open test (directory + junk file → `agentbbs import: failed —` + non-zero exit), with a valid header-only archive fixture so parse + contiguity pass and the DB-open failure is the sole cause. DONE.
  - [x] Used the shared `test/support/temp-dir.ts` helper (`makeTempDir`/`removeTempDir`). DONE.
- [x] **Task 4 — Rule-7 atomicity mutation + close items** (AC: #3)
  - [x] Rule-7: planted a mid-batch throw in `append.ts`'s transaction body, fed a CONTIGUOUS 2-event archive (passes the pre-replay check, reaches the batched append) → ledger EMPTY (`toEqual([])`, rolled back, NOT partial). Reverted byte-identical (`git diff` empty) → the temp probe went RED (import then succeeds). Temp probe deleted. Recorded in Completion Notes + deferred-work. DONE.
  - [x] `deferred-work.md` — `11.3-replay-nonatomicity` + `11.2-dbopen-trigger` headings flipped OPEN→RESOLVED (Story 13.3) with full resolution sub-lines; originals retained. DONE.
- [x] **Task 5 — Contract-freeze verification** (AC: #3)
  - [x] `git diff HEAD -- packages/core packages/mcp-server/src` confirmed EMPTY (no new error code; contiguity rejection is a plain CLI `Error`). Full ROOT gate green: lint 0 / typecheck 0 / build clean / test 1674 passed (186 files) / format clean. DONE.

## Dev Notes

### Current state (READ FIRST — both files read in full by the lead)

- `packages/cli/src/import.ts#runImport`: reads + `parseAndValidateArchive` BEFORE opening the ledger; opens via `createDataAccess({ dbPath })`; guards empty board (AC2); then **loops** `await dataAccess.append([newEvent])` per event with a per-iteration `assignedSeq !== event.seq` throw. THIS LOOP IS THE NON-ATOMICITY: a non-contiguous archive (e.g. seq 1 ok, seq 5) commits the seq-1 event, then the seq-5 event appends as seq 2 → mismatch throw → seq-1 (and any earlier) already committed → **partial ledger** (`11.3-replay-nonatomicity`).
- `packages/core/src/ports.ts:55-64`: `append(events: NewEvent[]): Promise<number[]>` — "Append one or more events in a SINGLE transaction" (`BEGIN IMMEDIATE`, proven atomic since Story 1.7). So a SINGLE `append(orderedNewEvents)` call is already all-or-nothing — the fix needs NO new data-access affordance (AC1 "no core/MCP/port change").
- `packages/cli/src/export.ts` + `import.ts` command wrappers: both already `try { … } catch { log('agentbbs <cmd>: failed — …'); process.exitCode = 1 }`. The DB-open failure (an unopenable `--db`) flows through `createDataAccess` → throws → this catch. The `11.2-dbopen-trigger` gap is that this CAUSE is not DIRECTLY asserted — only the unwritable-out-path trigger of the same catch is. AC2 just adds the direct assertions; NO production change needed for AC2.
- Existing tests: `import.test.ts:588` (AC4 loud-failure on first-event seq≠1), `import.test.ts:620` (the partial-ledger characterization to flip to EMPTY). The export unwritable-out-path failure test exists (mirror it for the directory/non-SQLite `--db` case).

### Why the pre-replay contiguity check is load-bearing (subtle)

A batched `append(all)` commits the whole transaction, THEN the code can check the assigned seqs — so the post-append seq check alone would detect a bad archive only AFTER committing (not atomic). The **pre-replay contiguity check (seqs exactly 1..N) is what makes the mangled-archive rejection atomic** — it fires before any append, so nothing is written. The batched append then makes the *valid* replay all-or-nothing against any OTHER failure (e.g. a DB error mid-batch). The post-append assertion is retained purely as defense-in-depth. State all three layers in the code + Dev Agent Record.

### Constraints

- **Rule 13 / contract freeze:** no new `BOARD_ERROR_CODE`; the contiguity rejection is a plain CLI `Error` (operator surface), exactly like the existing empty-board rejection. `git diff HEAD -- packages/core packages/mcp-server/src` must be EMPTY. 17-tool surface byte-identical.
- **No behavior change for the happy path:** a normal `agentbbs export` archive is always contiguous from seq 1, so the contiguity check is a no-op on every real archive; the round-trip fidelity test (`round-trip.fidelity.test.ts`) must stay green. Only the corruption path changes (partial → empty).
- **NFR10 (ledger integrity) / NFR3 (resilience):** this story reinforces both — a failed restore now leaves the board untouched.
- Canonical gate is ROOT `pnpm test` (Rule 12). Full gate (lint+typecheck+build+test+format) per Rule 20.

### Project Structure Notes

- Production change: `packages/cli/src/import.ts` (the replay flow + doc comment). NO `export.ts` production change (AC2 is test-only for export).
- Tests: `packages/cli/src/import.test.ts` (flip the characterization test + add the import DB-open test), `packages/cli/src/export.test.ts` (add the export DB-open test). `deferred-work.md`.
- Reuse Story 13.1's `test/support/temp-dir.ts` for temp fixtures.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.3] — the three ACs.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-09.md §2/§Technical impact] — "the 11.3 atomicity fix uses the EXISTING batched-atomic `append([])`; no new affordance, no contract change (pre-designed in the 11.3 deferred entry)."
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — `11.3-replay-nonatomicity` (~line 471, includes the pre-designed fix), `11.2-dbopen-trigger` (~line 461).
- [Source: packages/cli/src/import.ts] — the current per-event replay loop (the non-atomicity).
- [Source: packages/core/src/ports.ts:55-64] — `append(events[])` is a single atomic transaction (no new affordance needed).
- [Source: packages/cli/src/import.test.ts:588,620] — the AC4 loud-failure test + the partial-ledger characterization to flip.
- [Source: .claude/rules/project-rules.md] — Rule 7 (atomicity mutation non-vacuous), Rule 12 (root gate), Rule 13 (frozen contract — no new error code), Rule 20 (full gate).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

- Full ROOT gate (Rule 20): `pnpm run lint` 0 · `pnpm run typecheck` 0 · `pnpm run build` clean (both vscode bundles) · `pnpm test` **1674 passed / 186 files / 0 failed** · `pnpm run format` clean.
- Contract-freeze (Rule 13): `git diff HEAD -- packages/core packages/mcp-server/src` EMPTY.
- Rule-7 probe (temp, deleted): planted mid-batch throw in `packages/data-access/src/sqlite/append.ts` transaction body → contiguous 2-event archive left EMPTY ledger (rolled back); reverted byte-identical (`git diff` empty) → probe RED (import succeeds). `append.ts` confirmed unchanged vs HEAD.

### Completion Notes List

- **AC1 (atomic import) — three layers, all in `packages/cli/src/import.ts#runImport`:** (1) PRE-REPLAY CONTIGUITY CHECK — sort `archive.events` by `seq`, assert `ordered[i].seq === i + 1` for all `i`; thrown BEFORE `createDataAccess` (the nothing-appended phase). This is the LOAD-BEARING atomicity layer (a batched `append` commits before any post-append check can run, so only a pre-replay check makes a bad-archive rejection atomic). (2) SINGLE BATCHED `await dataAccess.append(orderedNewEvents)` — the existing `BEGIN IMMEDIATE` transaction (`ports.ts:55-64`) makes the valid replay all-or-nothing against any mid-batch failure; NO new port/affordance. (3) POST-APPEND `assignedSeqs[i] === ordered[i].seq` assertion retained as defense-in-depth (kept the `/seq mismatch/i` message shape). Empty archive (N=0) is vacuously contiguous (header-only restore). Updated both the file-header doc-comment and the `runImport` JSDoc to describe the three-layer flow.
- **AC1 (tests):** the QA non-atomicity characterization test was flipped from a PARTIAL 2-event ledger to an EMPTY ledger (`toEqual([])`) on the now-pre-replay rejection and retitled `'a non-contiguous archive is rejected pre-replay → EMPTY ledger (atomic, nothing appended)'`. The AC4 loud-failure test (first-event seq≠1) was kept as a faithful guard — it now trips the pre-replay contiguity check, so its matcher moved `/seq mismatch/i` → `/not contiguous/i` and it additionally asserts the ledger stays EMPTY; the describe-block + title were updated to reflect "rejected pre-replay, nothing appended". No coverage deleted.
- **AC2 (DB-open coverage, TEST-ONLY):** added direct DB-open-failure tests to `packages/cli/src/index.test.ts` for BOTH `exportCommand` and `importCommand`, each covering (a) `--db` at an existing DIRECTORY and (b) `--db` at a non-SQLite junk file → `better-sqlite3` cannot open → command `catch` → `agentbbs <cmd>: failed — …` on the injected `log` + `process.exitCode === 1` (captured/restored via the suite's existing `savedExitCode` beforeEach/afterEach). No production change needed (the catch already handled the unopenable `--db`). Used the shared `test/support/temp-dir.ts` helper. The import fixture is a valid header-only archive (`{ agentbbs_archive: 1 }`) so parse + contiguity PASS, isolating the DB-open failure as the sole rejection cause.
- **AC3 (non-vacuous + items closed):** Rule-7 mutation proven (above). `deferred-work.md` `11.3-replay-nonatomicity` + `11.2-dbopen-trigger` flipped OPEN→RESOLVED (Story 13.3) with full evidence sub-lines, originals retained. Contract frozen (Rule 13): no new `BOARD_ERROR_CODE` — the contiguity rejection is a plain CLI/operator-surface `Error`, exactly like the existing empty-board rejection.
- **Design note (deviation from the deferred-entry suggestion, faithful to the story):** the contiguity check was placed in `runImport` directly (NOT in the shared `validateParsedArchive` codec, as the 11.3 deferred entry's "suggested resolution" had floated). The check needs only the sorted archive events; co-locating it with the replay keeps the shared `archive.ts` codec byte-identical and avoids changing a separately-unit-tested function. The story Dev Notes Task 1 explicitly endorse this ("placing it before `createDataAccess` is cleanest").
- **Happy path unchanged:** a normal `agentbbs export` archive is always contiguous from seq 1, so the contiguity check is a no-op on every real archive; the round-trip fidelity test stays green (verified in the full suite).

### File List

- packages/cli/src/import.ts (production — three-layer atomic replay + doc comments)
- packages/cli/src/import.test.ts (atomicity characterization flipped to EMPTY ledger; AC4 loud-failure matcher + assertions updated)
- packages/cli/src/index.test.ts (AC2 DB-open-failure tests on both commands; `writeFileSync` import added)
- _bmad-output/implementation-artifacts/deferred-work.md (11.3-replay-nonatomicity + 11.2-dbopen-trigger flipped OPEN→RESOLVED with evidence)

## Review Findings

**Code review (2026-06-10, `claude-opus-4-8[1m]`) — CLEAN. 0 decision-needed / 0 patch / 0 defer / 1 dismissed. Story → `done`.**

Three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) run against the combined dev+QA changeset (`packages/cli/src/import.ts` + `import.test.ts` + `index.test.ts` + `deferred-work.md`). No HIGH / MED / LOW.

**AC1 (atomicity) — three layers independently verified + correctly ordered:** (1) PRE-REPLAY contiguity check (`import.ts:164-172`, sort by `seq` then `ordered[i].seq !== i+1` for 1..N) runs BEFORE `createDataAccess`/`append` (`:175`) — the nothing-appended phase; (2) SINGLE batched `await dataAccess.append(orderedNewEvents)` (`:201`); (3) post-append `assignedSeqs[i] !== ordered[i].seq` assertion (`:209-216`) retained as defense-in-depth. The load-bearing claim — a non-contiguous archive leaves an EMPTY ledger — confirmed: the rejection fires before the ledger is opened. A mid-batch failure also rolls back to empty, verified against `data-access/src/sqlite/append.ts` (the whole batch runs inside ONE `db.transaction(...).immediate()` — better-sqlite3 ROLLBACKs on any throw in the body, so a partial commit is structurally impossible). The contiguity check operates on integer seqs guaranteed by `archive.ts#isShapedEvent` (`Number.isInteger`) which runs in `parseAndValidateArchive` BEFORE the check — no NaN/string sort risk.

**AC1 — Rule-7 atomicity mutation RE-CONFIRMED non-vacuous by the reviewer:** independently defeated the contiguity-check throw in `import.ts` (replaced with a no-op) → 5 tests went RED (the 4 non-contiguous-archive rejection tests + the bad-seq AC4 test, all on the `/not contiguous/i` matcher). Reverted byte-identical (`git diff HEAD -- packages/cli/src/import.ts` shows ONLY the dev/QA diff, no probe residue) → 21/21 GREEN. The guard discriminates; it is not vacuous.

**AC2 (DB-open coverage) — verified:** `index.test.ts` adds direct tests on BOTH `exportCommand` and `importCommand`, each pointing `--db` at (a) an existing DIRECTORY and (b) a non-SQLite junk file → asserts `agentbbs <cmd>: failed —` on the injected `log` + `process.exitCode === 1`. The tests live in the `dispatch — export (real…)` describe block which has the `savedExitCode` beforeEach/afterEach seam, and explicitly reset `process.exitCode = undefined` between sub-cases — no exitCode leak across tests. The import fixture is a valid header-only archive (`{ agentbbs_archive: 1 }`) so parse + contiguity PASS, isolating the DB-open failure as the sole cause. Both empirically green (3 ms / 9 ms).

**AC3 / Rule 13 (contract freeze) — verified:** `git diff HEAD -- packages/core packages/mcp-server/src` EMPTY; no new `BOARD_ERROR_CODE` (the contiguity rejection is a plain CLI `Error`); the round-trip fidelity test (`round-trip.fidelity.test.ts`) stays green (contiguity is a no-op on a real contiguous export). deferred-work `11.3-replay-nonatomicity` + `11.2-dbopen-trigger` flipped OPEN→RESOLVED with full evidence sub-lines, originals retained.

**AC4 test change — verified faithful, no coverage lost:** the bad-seq (first-event seq≠1) test now trips the PRE-replay contiguity check (matcher `/seq mismatch/i` → `/not contiguous/i`) AND additionally asserts the ledger stays EMPTY. This is a STRICTLY STRONGER guarantee than the prior post-append partial-commit check. The former partial-ledger characterization is correctly superseded by an EMPTY-ledger atomicity assertion. The 6 QA atomicity-edge tests (deep gap, duplicate seq, offset run, shuffled-complete=valid, N=0, ≥8-event contiguous happy-path) all discoverable + green (Rule 8).

**Rule 20 (full ROOT gate) — INDEPENDENTLY RE-RUN, all five legs GREEN:** `pnpm run lint` 0 · `pnpm run typecheck` 0 · `pnpm run build` clean (both vscode bundles + cli web-dist) · `pnpm test` **1680 passed / 186 files / 0 failed** (dev recorded 1674; +6 = QA's atomicity-edge block — consistent) · `pnpm run format` (`prettier --check`) clean. Toolchain Node 24.16.0 / pnpm 11.3.0 (matches commitment).

**Rules 1/3/5/6:** Rule 3 SATISFIED (real-runtime CLI tests — actual `runImport`/`exportCommand`/`importCommand` invocation with stderr-message + exit-code + real `createDataAccess` SQLite ledger read-back assertions). Rule 1 N/A (hardening of an existing CLI surface; no new service). Rule 5 N/A (no NFR worked around — the story REINFORCES NFR10/NFR3). Rule 6 N/A (no `docs/adr/`).

**Dismissed (1, noise):** the post-append seq assertion is now structurally unreachable on a fresh empty board (the contiguity check guarantees 1..N), but it is intentional, documented defense-in-depth — and IS exercised when the contiguity check is defeated (reviewer mutation above), so it is not dead. Not a finding.
