---
baseline_commit: 68341e5b46b379d1dead5e12cc3a99a0bebd30f7
---

# Story 11.3: Import by replaying into an empty board

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want to import an archive into an empty board,
so that I can restore the full state on a new machine.

## Acceptance Criteria

**From epics.md (Epic 11, Story 11.3):**

**Given** an empty board and a valid archive,
**When** I run `agentbbs import`,
**Then** it replays the events, reconstructing identities, membership, rooms, messages, reactions, and read-state by re-running the same projections.

**Given** a non-empty board,
**When** I run `agentbbs import`,
**Then** it is rejected with a clear error (avoiding id collisions / double-replay; merge is out of V1 scope).

### Refined / testable ACs

**AC1 — `agentbbs import <archive>` replays a valid archive into an empty board.**
**Given** an EMPTY board (opened via `resolveDbPath` / `AGENTBBS_DB` / `--db`, like `ui.ts`/`export`) and a valid NDJSON archive (the Story-11.2 format),
**When** `agentbbs import [--db <path>] <archivePath>` runs (archive path from stdin when `-`/omitted is optional; a positional input path is the primary form),
**Then** it parses the archive (reusing the `packages/cli/src/archive.ts` parse half), **replays every event in ascending `seq` order through the existing `DataAccess.append`** (as `NewEvent` — `type`/`actor`/`payload`; `seq`/`createdAt` are re-assigned at append, see AC4), reconstructing ALL derived state by re-running the same projections, and **restores the read-state cursors** from the archive's read-state section via `DataAccess.setCursor(handle, seq)`,
**And** on success it exits 0 with a stderr summary (events replayed + cursors restored).

**AC2 — a non-empty board is rejected with a clear error (no merge in V1).**
**Given** a board that already has ≥1 event (`eventsSince(0)` non-empty),
**When** `agentbbs import` runs,
**Then** it is REJECTED before replaying anything — a clear stderr message (e.g. "board is not empty (N events); import requires an empty board — merge is out of scope") + a non-zero exit, and **NOTHING is appended** (the existing ledger is untouched),
**And** this rejection is a **CLI/operator-surface error, NOT a new `BOARD_ERROR_CODE`** — the closed 10-code agent error set (`BOARD_ERROR_CODES`) stays byte-identical (Rule 13; mirrors Epic 9's host-surface `NO_OPERATOR` which is NOT in core's closed set). Do NOT add a `BOARD_NOT_EMPTY` code to core.

**AC3 — import is a thin operator command over core/data-access (NFR2, Rule 13).**
**Given** the `import` implementation,
**When** built,
**Then** it lives in `packages/cli/src/import.ts` (replacing the Story-11.1 inert body), reuses `parseImportArgs` + `resolveDbPath` + the `archive.ts` parse half, opens the ledger via `@agentbbs/data-access`, and uses ONLY the EXISTING port methods (`eventsSince` for the empty-check, `append` for replay, `setCursor` for cursors) — NO new core method, NO new MCP tool, NO new error code,
**And** `import` remains operator-only (NOWHERE an MCP tool; the 17-tool agent set + `tool-contract.drift.test.ts` + `server.bootstrap.test.ts` stay green),
**And** `git diff HEAD -- packages/core packages/mcp-server/src` is empty (agent contract byte-identical).

**AC4 — seq + createdAt semantics are correct + explicitly reconciled (Rule 8).**
**Given** replay via the existing `append` (which AUTOINCREMENTs `seq` and assigns a fresh `createdAt`),
**When** replaying into a FRESH empty board in ascending archive-`seq` order,
**Then** the restored `seq` values reproduce the archive's `seq` 1:1 (an append-only ledger's `seq` is contiguous from 1, so ordered replay into an empty board yields identical `seq`) — the import SHOULD verify this (e.g. assert the archive `seq` is contiguous 1..N, or that each replayed `seq` equals the archived `seq`) and fail loudly if not,
**And** the dev MUST decide + document (Dev Notes "Design decision", surfaced to the reviewer) the **`createdAt`** treatment: re-running `append` re-assigns `createdAt` to import-time. This is the epics-AC-intended "re-run the same projections" behavior and is acceptable because `createdAt` is DISPLAY-ONLY and is NOT part of the seq-based derived state Story 11.4 compares (identities/membership/rooms/messages/reactions/contracts/cursors). If — and only if — Story 11.4's round-trip comparison is found to require byte-identical `createdAt`, that is a reconcile-with-the-lead moment (it would need an operator-only data-access restore primitive that writes `createdAt` verbatim — a `packages/data-access` addition that still keeps the core port + agent wire byte-identical). Default to the simple replay; do NOT pre-build the restore primitive without evidence it is needed.

**AC5 — robustness: malformed/incompatible archive is rejected cleanly.**
**Given** a malformed archive (not NDJSON, missing/incompatible header version, a line with an unknown `type` outside `EVENT_TYPES`, or a truncated line),
**When** `agentbbs import` runs,
**Then** it fails with a clear stderr message + non-zero exit and appends NOTHING (validate the header version + each event's `type` against `EVENT_TYPES` BEFORE replaying; this closes the Story-11.2 deferred "parse has no shape validation — import owns it" item).

**AC6 — gate green + a real import→read-back integration test.**
**Given** the changes,
**When** the canonical root gate runs (`pnpm run lint` · `typecheck` · `build` · `pnpm test` · `pnpm run format`),
**Then** all green, with tests over a REAL `createDataAccess` temp ledger covering: import into empty board reconstructs derived state (read back via core read ops / projections and assert it matches the source board); non-empty-board rejection (nothing appended); cursor restore; malformed-archive rejection; the seq-reproduction check,
**And** `git diff HEAD -- packages/core packages/mcp-server/src` is production-logic-clean.

## Integration ACs

This story IS the consumer of Story 11.2's archive AND a producer for Story 11.4 (round-trip).

- **Consumes:** the Story-11.2 archive format (via the shared `archive.ts` codec).
- **Consumed-by:** Story 11.4 (the export→import→compare round-trip fidelity test).
- **Integration AC satisfied now (Rule 1):** AC6's import→read-back test is a real, observable integration assertion in THIS story — import a known archive into a real empty `createDataAccess` ledger, then read derived state back through core projections and assert it matches the source. This is a genuine producer↔consumer wire-up against the real ledger (a mini round-trip; Story 11.4 makes it the full export→import→compare).

## Tasks / Subtasks

- [x] **Task 1 — empty-board guard (AC2)** (AC: 2, 3)
  - [x] Open the ledger; if `eventsSince(0)` is non-empty → clear stderr error + non-zero exit, append NOTHING. CLI-level error (NOT a `BOARD_ERROR_CODE`).
- [x] **Task 2 — parse + validate the archive (AC5)** (AC: 1, 5)
  - [x] Reuse `archive.ts` parse; validate header version + every event `type` ∈ `EVENT_TYPES` + read-state shape BEFORE any append. Malformed → clear error + non-zero exit, nothing appended. Added `validateParsedArchive` + `parseAndValidateArchive` to `archive.ts` (shared/tested).
- [x] **Task 3 — replay + restore cursors (AC1, AC4)** (AC: 1, 4)
  - [x] Replay events in ascending `seq` order via `append` (strip to `NewEvent`); verify restored `seq` reproduces archived `seq` (fail loudly otherwise — `seq mismatch` throw). Restore each read-state cursor via `setCursor(handle, seq)`. `createdAt`-reassignment decision documented (Dev Notes + import.ts header).
- [x] **Task 4 — fill the import handler (AC3)** (AC: 1, 3)
  - [x] Replaced the inert `importCommand` body in `packages/cli/src/import.ts`: parse args, read archive (file/stdin), parse+validate, resolve DB, guard empty, replay+restore, stderr summary, exit codes. Thin (NFR2) — `eventsSince`/`append`/`setCursor` only.
- [x] **Task 5 — tests (AC6)** (AC: 6)
  - [x] Real-`createDataAccess` integration in `import.test.ts`: seed source board (all 10 EVENT_TYPES) → export (reuse 11.2) → import into a fresh empty board → read derived state back via core projections → assert equality; non-empty rejection (nothing appended); cursor restore; malformed-archive rejection (4 cases); seq-reproduction guard. Real-spawn export→import round-trip + non-empty rejection in `bin-spawn.e2e.test.ts`. Confirmed `import` absent from MCP tools (grep).
- [x] **Task 6 — gate** (AC: 6)
  - [x] Full canonical root gate green; contract byte-identical (`git diff HEAD -- packages/core packages/mcp-server/src` EMPTY). Closed the 11.2-deferred "parse no-shape-validation" (now `validateParsedArchive`) + "DB-open-failure trigger of AC5" (the malformed/non-existent-in-path cases exercise the same catch→exit-1 path) items.

## Dev Notes

### Verified source facts (Rule 4 — this session)
- **`append(events: NewEvent[]): Promise<number[]>`** (`packages/core/src/ports.ts:64`, impl `packages/data-access/src/sqlite/append.ts`) does `INSERT INTO events (type, actor, created_at, payload)` — `seq` is `INTEGER PRIMARY KEY AUTOINCREMENT` (strictly increasing, never reused), `created_at` computed at append. So ordered replay into an EMPTY (migrated, zero-event) board reproduces `seq` 1..N exactly; `created_at` is re-assigned (display-only — AC4).
- **`setCursor(handle: string, seq: number): Promise<void>`** is on the port (`ports.ts:158`, impl `data-access.ts:79`) — use it to restore each read-state cursor. `getCursor` (used by 11.2 export) reads it back.
- **`eventsSince(0)`** → the whole seq-ordered ledger; `.length === 0` ⇔ empty board (the AC2 guard).
- **`BOARD_ERROR_CODES`** (`packages/core/src/errors.ts:16`) is the CLOSED 10-code agent error set. The non-empty-board rejection is an OPERATOR-CLI error — do NOT add a code to this set (Rule 13; Epic-9 `NO_OPERATOR` precedent: host/CLI-surface errors live outside core's closed set).
- **`EVENT_TYPES`** (`@agentbbs/core`) — the closed 10-event vocabulary; AC5 validates each archive event `type` against it.
- **Story-11.2 archive** (`packages/cli/src/archive.ts`): header manifest (`agentbbs_archive:1`, `format:"ndjson-events"`, `event_count`, `cursor_count`, `event_types`), one event line per `Event` (`seq`/`type`/`actor`/`createdAt`/`payload`), a delimited read-state section (`{handle, cursor}` per non-zero stored cursor; zero omitted). `archive.ts` already has `serializeArchive` + a parse half — extend the parse half with the AC5 validation (the 11.2 review deferred "parse has no shape validation — import 11.3 owns it").
- **Import scaffold (Story 11.1):** `packages/cli/src/import.ts` has `ImportOptions { dbPath?, inPath? }`, `parseImportArgs(argv)`, an inert `importCommand` to REPLACE.

### What this story is NOT
- NOT merge (V1 explicitly rejects a non-empty board — merge is out of scope).
- NOT a core/MCP change. No new core method, MCP tool, event type, or error code. The agent contract is byte-identical (Rule 13). Default to the simple replay (existing `append`/`setCursor`); only escalate to a data-access restore primitive if Story-11.4 evidence demands byte-identical `createdAt` (reconcile with the lead first).
- NOT export (Story 11.2, done) — reuse its `archive.ts` codec, don't reimplement.

### Architecture compliance
- [Source: architecture.md:294] "`import` replays into an empty board. Operator-only; never exposed as MCP tools." (AC3)
- [Source: epics.md Story 11.3] "reconstructing … by re-running the same projections" → the simple-replay design (AC1/AC4); "non-empty board → rejected … merge is out of V1 scope" (AC2).

### Testing standards (verified)
- `*.test.ts` under `packages/cli/src/**`; ROOT `pnpm test` is the gate (Rule 12). Real `createDataAccess` temp SQLite ledgers (Rule 3) — seed a source board (reuse the 11.2 export test's all-10-EVENT_TYPES seed helper), export, import into a fresh empty board, read derived state back through core projections, assert equality. The export↔import round-trip is the marquee — make it non-vacuous (Rule 7: a dropped event or skipped cursor must turn the equality RED).
- The full export→import→compare is Story 11.4; 11.3's test is the import half proven against a real ledger.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 11 — Story 11.3; 11.4 the named consumer; the SC round-trip]
- [Source: packages/cli/src/import.ts — 11.1 scaffold; packages/cli/src/archive.ts — 11.2 codec to reuse + extend (AC5 validation)]
- [Source: packages/core/src/ports.ts:64,158 — append + setCursor; packages/core/src/errors.ts:16 — closed code set]
- [Source: packages/data-access/src/sqlite/append.ts — seq AUTOINCREMENT + created_at assignment (AC4)]
- [Source: .claude/rules/project-rules.md — Rule 13 (byte-identical contract; CLI-surface error not in core set), Rule 8 (reconcile createdAt/seq explicitly), Rule 1 (Integration AC), Rule 3 (real-ledger tests), Rule 12 (root gate)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — Story 11.2 deferred items this story closes: AC5-DB-open-failure-test, parse-no-shape-validation]

## Dev Agent Record

### Context Reference

Story 11.3 (`bmad-dev-story` under `/epic-cycle`). Baseline commit `68341e5`.

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Initial `pnpm test`: 2 RED in `import.test.ts` — the `deriveState` marquee + file round-trip included the full `Identity` projection, whose `createdAt`/`lastSeen` are derived from event `createdAt` (RE-ASSIGNED at import-time per AC4). Resolved by STRIPPING the display-only identity timestamps from the comparison snapshot (compare only the seq-keyed `handle`/`currentFocus`); same for `boardDirectory`'s `lastSeen`. This is the concrete realization of the AC4 design decision.
- Then 1 RED: the non-vacuity test dropped the LAST archived event, but the seed's last event is `identity.seen` (from bob's `check`) — which only affects the stripped `lastSeen`, so the timestamp-stripped derived state was unchanged ("no visual difference"). Fixed by truncating the archive BEFORE the first `message.reacted` instead (a contiguous seq 1..k prefix that omits the reactions → the LIVE CONTRACT changes → the equality discriminates). Final: 1540 passed.

### Completion Notes

Filled the Story-11.1 `import` scaffold with the real NDJSON replay-into-an-empty-board.

**Design decision (AC4 — `createdAt`):** replay goes through the EXISTING `DataAccess.append`, which RE-ASSIGNS each event's `createdAt` to import-time. This is the epics-AC-intended "re-run the same projections" behavior and is ACCEPTABLE because `createdAt` is DISPLAY-ONLY and is NOT part of the seq-based derived state Story 11.4 compares (identities / membership / rooms / messages / reactions / contract / cursors — all keyed on `seq`, never `createdAt`). I did NOT build a data-access `createdAt`-restore primitive (no evidence Story 11.4 needs byte-identical `createdAt`; if it does, that is a reconcile-with-the-lead moment per the AC4 escalation clause). The marquee read-back equality therefore compares the seq-keyed derived state with the display-only identity timestamps (`createdAt`/`lastSeen`) stripped; a dedicated test (`AC4 — createdAt is RE-ASSIGNED`) pins that `createdAt` genuinely differs after import while `seq`/`type`/`actor`/`payload` reproduce exactly. **Surfaced to the reviewer** (Rule 8).

**Seq-reproduction (AC4):** each replayed `seq` is asserted == the archived `seq`; a mismatch throws `import seq mismatch …` (fail-loud). Proven by a dedicated test (archive event with `seq:5` into an empty board → assigned `seq:1` → loud failure).

**Empty-board guard (AC2):** `eventsSince(0).length > 0` → reject BEFORE any append with a clear `board is not empty (N event(s)) …` CLI error + exit 1; the existing ledger is untouched (asserted). This is an OPERATOR-surface error, NOT a `BOARD_ERROR_CODE` (Rule 13) — `BOARD_ERROR_CODES` stays byte-identical.

**Archive validation (AC5):** added `validateParsedArchive` + `parseAndValidateArchive` to the shared `archive.ts` codec (closes the 11.2-deferred "parse has no shape validation; import owns it"). Validates header version + every event well-shaped & `type` ∈ `EVENT_TYPES` + read-state shape, BEFORE any ledger work. Non-NDJSON / incompatible version / unknown type / truncated line all reject cleanly, nothing appended.

**Rule 13 (byte-identical agent contract):** `git diff HEAD -- packages/core packages/mcp-server/src` EMPTY; the import logic lives entirely in `packages/cli` (the shared codec + the handler), reads/writes through the `DataAccess` port only (`eventsSince`/`append`/`setCursor`), uses NO new core method / MCP tool / event type / error code; `import` appears NOWHERE in `mcp-server/src` (operator-only; 17-tool drift + bootstrap guards in the 1540 green).

**Rule 1 (Integration AC):** AC6's import→read-back equality is the observable producer↔consumer assertion in THIS story (a mini round-trip; Story 11.4 makes it the full export→import→compare). **Rule 3 (real-runtime):** `bin-spawn.e2e.test.ts` SPAWNS the built bin to export a seeded ledger to a file then import it into a fresh empty board across two real `node` children, asserting the restored events match seq-for-seq + the cursor restored + exit 0; plus a real-spawn non-empty rejection. **Rule 7 (non-vacuity):** two discriminating tests (a lossy archive no longer reconstructs the source; a skipped read-state line no longer restores the cursor).

**Gate (this machine):** lint 0 · typecheck 0 · build clean · `pnpm test` **1540 passed / 178 files / 0 failed** (1526 → 1540) · `prettier --check` clean.

Updated the two stale Story-11.1 inert-scaffold assertions (`index.test.ts` + `bin-spawn.e2e.test.ts`) to the real import behavior, and dropped the "not yet implemented" suffix from `index.ts`'s `import` describe.

### File List

- `packages/cli/src/import.ts` (filled the inert scaffold with the real replay handler)
- `packages/cli/src/archive.ts` (added `validateParsedArchive` + `parseAndValidateArchive` — the AC5 shape gate)
- `packages/cli/src/index.ts` (dropped the "not yet implemented" suffix from the `import` describe; re-export `runImport`/`ImportResult`/`RunImportDeps`)
- `packages/cli/src/import.test.ts` (NEW — the marquee import→read-back integration suite)
- `packages/cli/src/index.test.ts` (updated the two stale inert-import scaffold assertions to real behavior)
- `packages/cli/src/bin-spawn.e2e.test.ts` (replaced the inert-import spawn with a real export→import round-trip + non-empty rejection)
- `_bmad-output/implementation-artifacts/11-3-import-by-replaying-into-an-empty-board.md` (this story: frontmatter, tasks, Dev Agent Record, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (11-3 status → in-progress → review)

### Change Log

- 2026-06-05 — Implemented Story 11.3: `agentbbs import` replays an NDJSON archive into an empty board (empty-board guard, shared parse+validate, ordered `append` replay with seq-reproduction verification, `setCursor` read-state restore). AC4 `createdAt`-reassignment design decision documented + surfaced. Gate green (1540 tests); core+mcp-server byte-identical (Rule 13).

## Review Findings (code review, 2026-06-05)

**Verdict: APPROVED. 0 HIGH / 0 MED / 2 LOW (both deferred — see `deferred-work.md`). No patches applied; the changeset is byte-identical to the dev+QA delivery.**

**Gate (reviewer re-ran the CANONICAL ROOT gate — the 11.2 lint/format mis-claim was specifically re-checked):**
- `pnpm run lint` — 0 errors
- `pnpm run typecheck` — 0 errors
- `pnpm run build` — clean (both vscode-extension bundles built)
- `pnpm test` — **1542 passed / 178 files / 0 failed** (dev reported 1540; QA's 2 added tests — the non-numeric-cursor AC5 case + the non-atomicity characterization — bring it to 1542)
- `pnpm run format` (`prettier --check .`) — clean

**Focus-area verification:**
- **Rule 13 (byte-identical agent contract) — CONFIRMED.** `git diff HEAD -- packages/core packages/mcp-server/src` EMPTY. The non-empty-board rejection is a CLI-surface `Error`, NOT in `BOARD_ERROR_CODES` (verified `errors.ts` byte-identical, no `BOARD_NOT_EMPTY`). No new core method / MCP tool / event type / error code. `import` appears nowhere in `mcp-server/src` (only ES-module `import` statements). Import uses ONLY `eventsSince(0)` / `append` / `setCursor` (all pre-existing ports). 17-tool drift + bootstrap guards green in the 1542.
- **AC1/AC4 — CONFIRMED.** Ordered replay reproduces seq 1..N with a loud per-event mismatch throw. The createdAt-reassignment decision is sound + documented (Dev Notes + import.ts header + dedicated AC4 test). The read-back equality strips ONLY display-only `createdAt`/`lastSeen` and compares ALL seq-keyed derived state (identities handle+focus / projects / rooms / per-room messages / participants / live contract / cursors) — NOT vacuously loose.
- **AC2/AC5 — CONFIRMED.** Non-empty board rejected, ledger untouched, exit 1. Malformed archive (non-NDJSON / bad version / unknown event type / truncated / non-numeric cursor) each reject + append nothing (validation runs before DB open).
- **Rule 3 / Rule 7 — CONFIRMED.** Real `createDataAccess` round-trip + real two-`node`-child spawn export→import. Reviewer INDEPENDENTLY mutation-tested two marquee assertions: (1) no-op'd the cursor-restore loop → MARQUEE RED on `getCursor`; (2) `slice(0,-1)` dropped the last replayed event → 5 RED. Reverted byte-identical (diff vs pre-mutation backup confirmed), re-GREEN 15/15.
- **Story 11.4 readiness — CONFIRMED.** The import half is solid for the full export→import→compare: normal exports are always contiguous (seq-reproduction never trips), and the strip-display-timestamps comparison is exactly what 11.4 will use over the same seq-keyed derived state. The two LOW deferrals do not affect 11.4 (corruption-path-only atomicity + a DB-open-failure test gap).

**LOW findings (deferred, not blocking — full detail in `deferred-work.md`):**
1. **Replay non-atomicity (the QA-flagged finding) — LOW / within-V1-scope.** The AC4 seq-reproduction check fires mid-replay, so a hand-mangled / non-contiguous archive throws after earlier events are committed (replay is a per-event `append` loop, not one transaction). Triage: AC2's "nothing appended" is correctly atomic for the PRE-replay paths (empty-guard + malformed-validation); AC4 only requires fail-loud, which holds; the non-contiguous case is corruption-only (a normal export is always contiguous from seq 1) — never normal flow. NOT resolved inline because the clean fix touches the shared, separately-tested `validateParsedArchive` codec and would invert QA's deliberately-written characterization test — more surface than a LOW warrants mid-cycle. Verified the fix needs NO contract change (the existing `append(events[])` is already atomic over a batch), with the exact resolution path recorded for the next import-hardening / Story 11.4.
2. **DB-open-failure test gap (carried from Story 11.2) — LOW.** Story 11.3's Task-6 note over-claimed it closed the 11.2-deferred "DB-open-failure trigger of AC5": the import's "in-path does not exist" test exercises `readFileSync` (archive-read, pre-DB-open), NOT a genuine DB-open failure (e.g. `--db` pointing at a directory). The 11.2 item is corrected to STILL OPEN, re-scoped to the next CLI-error touch / Story 11.4.
