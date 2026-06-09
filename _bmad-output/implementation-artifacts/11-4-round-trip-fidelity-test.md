---
baseline_commit: 2aa61e60cb488d18173e96b9dcac9b4046293f43
---

# Story 11.4: Round-trip fidelity test

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a maintainer,
I want an automated export → import → compare test,
so that backup/restore is provably lossless against the SQLite backend (FR34).

## Acceptance Criteria

**From epics.md (Epic 11, Story 11.4):**

**Given** a populated board,
**When** I export it, import into a fresh empty board, and compare,
**Then** all derived state (identities, membership, rooms, messages, reactions, contracts, cursors) is identical,
**And** the test lives in `cli/` and runs in the default suite.

### Refined / testable ACs

**AC1 — a canonical FR34 round-trip fidelity test exists in `packages/cli/src`.**
**Given** the export (Story 11.2) + import (Story 11.3) commands,
**When** a new test (e.g. `packages/cli/src/round-trip.fidelity.test.ts`) runs,
**Then** it: (1) seeds a SOURCE board on a real `createDataAccess` temp SQLite ledger, (2) exports it (via the real `runExport`/`exportCommand` or the `archive.ts` codec + the real port), (3) imports the archive into a SEPARATE, FRESH, empty `createDataAccess` temp ledger (via the real `runImport`/`importCommand`), and (4) reads derived state back from BOTH boards through the core projections and asserts they are IDENTICAL,
**And** the test is `*.test.ts`, co-located under `packages/cli/src`, and collected by the default ROOT `pnpm test` (Rule 8 / Rule 12).

**AC2 — the SOURCE board is comprehensive + representative.**
**Given** the seed,
**When** built,
**Then** it exercises ALL 10 `EVENT_TYPES` (registrations, focus update, project announcement, board join, room announcement/post, replies, participant add, reactions, an unreact, AND at least one `check`/`recordSeen` so a NON-ZERO read-state cursor exists) — so the round-trip proves fidelity across the whole event vocabulary AND the cursor carve-out, not a trivial subset,
**And** the board has multiple identities, ≥1 project, ≥1 room with multiple messages, a live contract (a 👍'd message), and ≥1 non-zero stored cursor (reuse/extend the Story-11.2/11.3 all-10-types seed helper — do not hand-roll a thinner one).

**AC3 — ALL derived-state categories are compared explicitly (the epics list).**
**Given** the two boards (source + restored),
**When** compared,
**Then** EACH of these derived-state categories is asserted equal (read through the core projections, NOT by raw row diff):
- **identities** — `foldIdentities`/`boardDirectory` (handle + currentFocus); display-only `createdAt`/`lastSeen` EXCLUDED per the Story-11.3 reconciliation,
- **membership** — board members per project (`foldProjects`/`listProjects` member sets),
- **rooms** — `listRooms` + `listAnnouncements` (proto vs activated), per-room metadata,
- **messages** — `roomMessages`/`readRoom` per room (seq-ordered body/actor),
- **reactions** — `liveReactors`/live 👍 per message,
- **contracts** — `currentContract` per room (the FR21 highest-seq live-👍'd message),
- **cursors** — `getCursor(handle)` per identity (the read-state carve-out — this is the category most likely to silently break, so assert it explicitly and ensure the seed produced a non-zero one).
**And** the comparison documents WHY `createdAt`/`lastSeen` are excluded (display-only, re-assigned on replay; not seq-derived board state — the Story-11.3 AC4 reconciliation), so the exclusion is a recorded decision, not a silent loosening.

**AC4 — the test is mutation-tested non-vacuous (Rule 7).**
**Given** the fidelity test,
**When** a fidelity-breaking mutation is introduced (e.g. drop one event before import, skip one cursor restore, or alter one message body), 
**Then** the comparison goes RED — proving the test actually discriminates a real round-trip break and is not vacuously loose (a comparison so timestamp-stripped it passes regardless). Record the mutation evidence in the Dev Agent Record (introduce → RED → revert byte-identical → green).

**AC5 — no production change; contract byte-identical.**
**Given** this is a TEST story,
**When** built,
**Then** it adds ONLY the test (+ optionally a shared test-helper), changes NO production code, and `git diff HEAD -- packages/core packages/mcp-server packages/cli/src` shows no PRODUCTION-source change (only the new test file / a test-only helper),
**And** the full canonical root gate is green (`pnpm run lint` · `typecheck` · `build` · `pnpm test` · `pnpm run format`).

## Tasks / Subtasks

- [x] **Task 1 — comprehensive source seed (AC2)** (AC: 2)
  - [x] Reuse/extend the Story-11.2/11.3 all-10-`EVENT_TYPES` seed helper on a real `createDataAccess` temp ledger; ensure ≥1 non-zero stored cursor (a real `check`/`recordSeen` past the actor's join floor) and a live contract (a 👍'd message).
- [x] **Task 2 — round-trip (AC1)** (AC: 1)
  - [x] Export the source (real `runExport`/codec), import into a SEPARATE fresh empty temp ledger (real `runImport`). Two distinct DB files under `os.tmpdir()`; clean up in `finally`.
- [x] **Task 3 — full derived-state comparison (AC3)** (AC: 3)
  - [x] Build a `deriveComparableState(dataAccess)` helper reading EACH category via the core projections (identities/membership/rooms/messages/reactions/contracts/cursors), excluding display-only `createdAt`/`lastSeen` with a documented reason; assert source == restored for every category (ideally per-category asserts so a break localizes).
- [x] **Task 4 — mutation non-vacuity (AC4)** (AC: 4)
  - [x] Temporarily mutate (drop an event / skip a cursor / alter a body) → confirm RED → revert byte-identical → green. Record evidence.
- [x] **Task 5 — gate (AC5)** (AC: 5)
  - [x] Full canonical root gate green; confirm no production-source change.

## Dev Notes

### Verified source facts (Rule 4 — this session)
- **Core projection surface** (`packages/core/src/index.ts`) for the comparison: `foldIdentities`/`findIdentity`, `boardDirectory`, `foldProjects`/`findProject`/`listProjects`, `foldRooms`/`findRoom`/`listRooms`/`listAnnouncements`, `roomMessages`/`readRoom`, `roomParticipants`/`isParticipant`, `liveReactors`, `currentContract`, plus `getCursor(handle)` (the cursor carve-out, on the `DataAccess` port). These ARE the derived state — fold/read them, never diff raw rows.
- **Reuse, don't reinvent:** Story 11.2's `export.test.ts` has an all-10-`EVENT_TYPES` `seedBoard` helper; Story 11.3's `import.test.ts` already has a `deriveState`/import→read-back equality that strips display-only `createdAt`/`lastSeen` and compares seq-keyed state. Story 11.4 is the CANONICAL, comprehensive version of that pattern — broaden the seed (guarantee a non-zero cursor + a live contract), make the comparison per-category + exhaustive over the epics list, and pin it as the FR34 test. If a shared seed/compare helper reduces duplication, factor it into a test-only module (`packages/cli/src/round-trip.fixtures.ts` or similar) — test-only, no production change.
- **createdAt/lastSeen exclusion is RATIFIED** (Story 11.3 AC4 + its QA/CR): replay via `append` re-assigns `createdAt`; these are DISPLAY-ONLY, not seq-derived board state. The QA/CR for 11.3 explicitly confirmed 11.4 should adopt the strip-display-timestamps comparison. Document the exclusion in the test; do NOT treat it as a gap.
- **seq reproduction:** ordered replay into a fresh empty board reproduces `seq` 1..N exactly (Story 11.3 verifies this loudly), so message/contract/cursor seqs match — the comparison can rely on seq equality.

### What this story is NOT
- NOT new export/import FEATURES (11.2/11.3 shipped those) — this is the proving test. No production code change (AC5).
- NOT a change to the archive format or the import logic. If the round-trip reveals a REAL fidelity gap (some derived category does NOT round-trip), that is a defect to surface to the lead (likely a fix in 11.2/11.3, reconciled per Rule 8) — NOT something to paper over by excluding the category from the comparison.

### Testing standards (verified)
- `*.test.ts` under `packages/cli/src/**`; ROOT `pnpm test` is the gate (Rule 12). Real `createDataAccess` temp SQLite ledgers (Rule 3), two distinct DB files under `os.tmpdir()`, cleaned in `finally`. The comparison is the marquee — AC4 mutation-tests it non-vacuous (the lesson of Rule 7: a green comparison that passes even when a category is dropped guards nothing).

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 11 — Story 11.4; SC "round-trip fidelity (export → import → identical derived state) passes against the SQLite backend"]
- [Source: packages/cli/src/export.test.ts (all-10-types seed), packages/cli/src/import.test.ts (import→read-back equality to canonicalize), packages/cli/src/archive.ts, export.ts, import.ts]
- [Source: packages/core/src/index.ts — the projection surface for the comparison]
- [Source: _bmad-output/implementation-artifacts/11-3-import-by-replaying-into-an-empty-board.md — AC4 createdAt/lastSeen exclusion reconciliation + QA/CR confirmation]
- [Source: .claude/rules/project-rules.md — Rule 7 (mutation non-vacuity), Rule 3 (real-ledger), Rule 12 (root gate), Rule 13 (no production change)]

## Dev Agent Record

### Context Reference

- Story: `_bmad-output/implementation-artifacts/11-4-round-trip-fidelity-test.md`
- Reused patterns: `packages/cli/src/export.test.ts` (all-10-`EVENT_TYPES` seed), `packages/cli/src/import.test.ts` (import→read-back equality, `createdAt`/`lastSeen` strip), `packages/cli/src/archive.ts` codec, `packages/cli/src/import.ts` (`runImport`).
- Core projection surface: `packages/core/src/index.ts`.

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Baseline (`git rev-parse HEAD`): `2aa61e60cb488d18173e96b9dcac9b4046293f43`; baseline suite 1542 tests.
- Final canonical ROOT gate ALL GREEN: `pnpm run lint` (eslint, 0) · `pnpm run typecheck` (tsc --noEmit, 0) · `pnpm run build` (all packages clean) · `pnpm test` (179 files, **1547 passed** = 1542 + 5 new) · `pnpm run format` (prettier --check: "All matched files use Prettier code style!").
- The export-0-events / import-ENOENT console lines during `pnpm test` are from PRE-EXISTING export/import suites (deliberate empty-board / bad-in-path cases), NOT this story.

### Completion Notes

- **TEST-ONLY (AC5).** Added ONLY two new files under `packages/cli/src` (one test + one test-only fixtures module). `git status --short -- packages/` shows exactly the two new untracked files; `git diff HEAD --name-only -- packages/` shows ZERO modified tracked production files. The drift-guarded agent contract (core types, MCP wire, error set) is byte-identical.
- **Comprehensive seed (AC2).** `seedComprehensiveBoard` exercises ALL 10 `EVENT_TYPES`, guarantees a NON-ZERO stored read-state cursor (bob's real `check` past his join floor — asserted `> 0` in the seed), AND a live contract (alice 👍 bob's reply; alice 👍s then UN-👍s her own reply so the contract is bob's reply, sharpening the contract-category discrimination). The marquee test re-asserts all 10 types present + cursor `> 0` + ≥1 live contract via `parseArchive` before comparing.
- **Per-category comparison (AC3).** `deriveComparableState` reads EACH category through core projections — identities (`foldIdentities`), membership (`listProjects`/`foldProjects`), rooms (`listRooms`+`listAnnouncements`+`foldRooms`+`roomParticipants`), messages (`roomMessages`), reactions (`liveReactors`), contracts (`currentContract`), cursors (`getCursor`) — never a raw row diff. The marquee asserts each category equal individually (so a break localizes) THEN the whole snapshot. Display-only `createdAt`/`lastSeen` EXCLUDED with the documented WHY (Story-11.3 AC4 ratified carve-out: replay re-assigns `createdAt`; not seq-derived state).
- **Mutation non-vacuity (AC4 / Rule 7).** Three PERMANENT discrimination tests each break the ARCHIVE (drop reactions → reactions+contracts+cursors RED; omit the read-state line → cursors-only RED; tamper one message body → messages+contracts RED). PLUS a transient byte-level Rule-7 proof: temporarily injected `await dest.setCursor('bob', 0)` into the restored-board path → the MARQUEE `toEqual` + cursors-category test went RED (diff showed bob cursor `12 → 0`); reverted byte-identical → 5/5 GREEN. Evidence: RED run = "Tests 2 failed | 3 passed (5)"; post-revert = "Tests 5 passed (5)".
- **Real ledgers (Rule 3 / Rule 12).** Two distinct DB files (`source.db`, `restored.db`) under `os.tmpdir()`, real `createDataAccess` better-sqlite3, cleaned in `finally`/`afterEach`. Collected by the canonical ROOT `pnpm test`; the fixtures module has no `.test.ts` suffix so it is imported, not collected as a suite.
- **No fidelity gap found.** Every derived-state category round-trips identically — the import (11.3) + export (11.2) are lossless against the SQLite backend per FR34. Nothing was papered over (the carve-out is the ratified display-only exclusion, not a category drop).

### File List

- `packages/cli/src/round-trip.fidelity.test.ts` (new — the canonical FR34 round-trip fidelity test)
- `packages/cli/src/round-trip.fixtures.ts` (new — test-only shared seed + per-category `deriveComparableState` + `exportToText`)
- `_bmad-output/implementation-artifacts/11-4-round-trip-fidelity-test.md` (story tracking: frontmatter `baseline_commit`, tasks, Dev Agent Record, status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story state ready-for-dev → in-progress → review)

### Review Findings

**Code review (2026-06-05) — APPROVED / CLEAN. 0 HIGH · 0 MED · 0 patches · 0 decision-needed · 0 deferred · 3 dismissed.** Status review → done.

This is the FR34 maintainer test + the final proving gate for Epic 11's whole backup/restore loop; reviewed with that weight.

**Independent verification performed (not just dev/QA re-read):**

- **AC1/Rule 3 (real-runtime):** Confirmed two DISTINCT real `createDataAccess` better-sqlite3 ledgers (`source.db` + `restored.db` under `os.tmpdir()`, cleaned in `afterEach`/`finally`), real `runExport` codec + real `runImport` replay — nothing mocked. The reviewed surface IS the test; its real-ledger round-trip is the load-bearing evidence.
- **AC2 (comprehensive seed):** Verified the seed exercises ALL 10 `EVENT_TYPES` (the MARQUEE asserts `seededTypes.size === EVENT_TYPES.length` + every type present), a NON-ZERO stored cursor (bob's `check` advances his cursor; empirically `cursor = 13` under this seed, asserted `> 0`), and a live contract.
- **AC3 (all 7 categories, each non-empty):** Verified `deriveComparableState` reads every category through CORE PROJECTIONS (no raw row diff): identities (`foldIdentities`), membership (`listProjects`/`foldProjects`), rooms BOTH halves (`listAnnouncements` proto + `listRooms` activated — confirmed in `list-rooms.ts` these partition by `active=false`/`active=true`, complete + disjoint), messages (`roomMessages`), reactions (`liveReactors`), contracts (`currentContract`), cursors (`getCursor`). The QA-added per-category non-emptiness guards ALL fire on this seed (identities≥2, membership members≥1, proto≥1, activated≥1, messages≥1, live reactions≥1, non-zero cursors≥1) — confirmed the QA proto-room hardening (second un-replied announcement) makes `listAnnouncements` genuinely non-empty, so no category is a trivial `[]===[]`.
- **AC4 (Rule 7 non-vacuity) — INDEPENDENTLY re-confirmed by the reviewer, two categories, fresh mutations:**
  1. **cursors:** injected `await dest.setCursor('bob', 0)` into the restored path → MARQUEE + focused cursors test went RED with a localizing diff (`cursor: 13 → 0`) → reverted byte-identical → green.
  2. **reactions/contracts:** injected a `carol` reaction on the restored board (shifting the FR21 highest-seq live-👍'd contract) → the `reactions`/`contracts` asserts went RED (line 141) → reverted byte-identical → green.
  Both mutations reverted byte-identical (no marker remains in the file; `git` carve-out empty). The 6 permanent archive-mutation discrimination tests genuinely localize (each breaks its OWN named category; the "drop before first reaction" truncation is sound because the seed places all replies/participant-adds/messages BEFORE the first `message.reacted`).
- **createdAt/lastSeen exclusion:** Confirmed it is the ratified Story-11.3 AC4 carve-out, narrow (ONLY those two display-only fields — `currentFocus` IS still compared and proven load-bearing by the focus-tamper discrimination test) and documented on `deriveComparableState` (fixtures L151-157) + the test header. NOT masking a category drop.
- **AC5 (test-only):** `git diff HEAD -- packages/core packages/mcp-server packages/cli/src` (excluding the two new files) is EMPTY — zero production-source change; the drift-guarded agent contract is byte-identical. `round-trip.fixtures.ts` has no `.test.` infix and no top-level `it/describe/test`, and the vitest include glob is `packages/*/src/**/*.test.{ts,tsx}`, so it is imported (not collected as an empty suite).
- **Canonical ROOT gate re-run by the reviewer — ALL GREEN:** `pnpm run lint` (0) · `pnpm run typecheck` (0) · `pnpm run build` (clean, exit 0) · `pnpm test` (**179 files, 1550 passed, 0 failed**) · `pnpm run format` (prettier clean). The `export-0-events` / `import ENOENT` console lines are PRE-EXISTING deliberate empty-board / bad-in-path cases, not this story.

**Dismissed (3, noise / verified-correct):**
1. `toEqual` array-order reliance is undocumented — DISMISSED: order is deterministic AND identical on both boards because ordered replay reproduces `seq` 1..N, so the fold/Map insertion order matches; not a flake.
2. "DROP before first reaction" test asserts the broken categories but not that the complement stays GREEN — DISMISSED: the localization is structurally guaranteed by the seed ordering (all messages/membership precede the first reaction) and the other 5 discrimination tests DO pin their complements; a LOW robustness nit, not a defect.
3. rooms category iterates `projects` while messages/reactions/contracts iterate `foldRooms().values()` — DISMISSED: verified consistent (every seeded room belongs to the announced project; `listRooms`+`listAnnouncements` cover exactly the same room set).

**Rules:** Rule 5 N/A (no NFR amendment). Rule 6 N/A (no `docs/adr`). Rule 1 N/A (this story introduces NO service — it is the proving test). Rule 3 satisfied (the test's real-ledger round-trip IS the evidence). No fidelity gap found — every derived-state category round-trips identically (FR34 lossless against the SQLite backend).

Left UNCOMMITTED for the lead's post-CR per-story smoke gate.

---

**Independent re-review (2026-06-06) — APPROVED / CLEAN. 0 HIGH · 0 MED · 0 LOW · 0 patches · 0 decision-needed · 0 deferred · 3 dismissed (same trio as the prior pass).** Status stays `done`.

A second, independent code-review pass (not a re-read of the prior CR) over the combined dev+QA changeset (the two new test/fixtures files), weighted as the FR34 maintainer test + Epic 11's final proving gate. Three review lenses (blind / edge-case / acceptance-auditor) applied; every load-bearing claim re-verified from primary sources, not trusted from the prior CR.

- **AC1 / Rule 3 (real-runtime):** Re-confirmed two DISTINCT real `createDataAccess` better-sqlite3 ledgers (`source.db` + `restored.db` under `os.tmpdir()`, cleaned in `afterEach`/`finally`), real `runExport` codec → real `runImport` replay — nothing mocked. The reviewed surface IS the test; its real-ledger round-trip is the evidence. Ran the file in isolation via the ROOT `agentbbs` project → 8/8 green.
- **AC2 (comprehensive seed):** Re-verified the seed emits ALL 10 `EVENT_TYPES` (the MARQUEE's `seededTypes.size === EVENT_TYPES.length` + every-type-present asserts would have failed otherwise — and pass), a NON-ZERO stored cursor (bob's `check`; asserted `> 0`), and a live contract. Counted the 10 distinct `await`-ed ops in `seedComprehensiveBoard` → exactly the 10 types.
- **AC3 (all 7 categories via core projections, each non-empty):** Re-verified `deriveComparableState` reads every category through CORE PROJECTIONS (no raw row diff): identities (`foldIdentities`), membership (`listProjects`/`foldProjects`), rooms BOTH halves (`listAnnouncements` proto + `listRooms` activated — confirmed in `core/src/rooms/list-rooms.ts` these partition on `active=false`/`active=true`: complete + disjoint), messages (`roomMessages`), reactions (`liveReactors`), contracts (`currentContract`), cursors (`getCursor`). The QA per-category non-emptiness guards genuinely fire — proven by the blinding probes below (both tripped their guard). The cursor category uses a NON-ZERO stored cursor.
- **AC4 (Rule 7 non-vacuity) — INDEPENDENTLY re-confirmed on TWO categories via a DIFFERENT mutation vector than the prior CR (blinding the COMPARISON helper, not the archive):**
  1. **cursors:** edited `deriveComparableState` to return `cursor: 0` for every identity → the MARQUEE non-emptiness guard, the focused cursors test, AND the cursors clauses of two discrimination tests went RED (4 failed) → reverted byte-identical → 8/8 green.
  2. **reactions:** edited `deriveComparableState` to return `liveReactors: []` for every message → the LIVE-reaction non-emptiness guard AND the "DROP one event → reactions differ" discrimination test went RED (2 failed) → reverted byte-identical → 8/8 green.
  Both reverts confirmed byte-identical (`grep CR-MUTATION` → none; 8/8 re-green). This proves the comparison DISCRIMINATES per category (a blinded category breaks the suite) — the exact Rule-7 vacuity class. The 6 archive-mutation discrimination tests genuinely localize: re-verified the "DROP before first reaction" truncation is sound because the seed places all replies/participant-adds/messages (fixtures L103-106) BEFORE the first `react` (L118).
- **createdAt/lastSeen exclusion:** Re-confirmed the ratified Story-11.3 AC4 carve-out — narrow (ONLY those two display-only fields; `currentFocus` IS still compared, proven load-bearing by the focus-tamper discrimination test) and documented on `deriveComparableState` (fixtures L151-157) + the test header. NOT masking a category drop.
- **AC5 (test-only):** `git diff HEAD -- packages/core packages/mcp-server packages/cli/src` (the two new files excluded) is EMPTY — zero production-source change; the drift-guarded agent contract is byte-identical. `round-trip.fixtures.ts` has no `.test.` infix and no top-level `it/describe/test` (grep → none), and the root `agentbbs` include glob is `packages/*/src/**/*.test.{ts,tsx}` — so it is imported, never collected as an empty suite.
- **Canonical ROOT gate re-run by the reviewer — ALL GREEN:** `pnpm run lint` (eslint, exit 0) · `pnpm run typecheck` (tsc --noEmit, exit 0) · `pnpm run build` (all packages clean, exit 0) · `pnpm test` (**179 files, 1550 passed, 0 failed**) · `pnpm run format` (prettier --check: "All matched files use Prettier code style!"). The `import: failed — ENOENT … agentbbs-import-dispatch-*` console line is the PRE-EXISTING deliberate bad-in-path import suite, NOT this story.

**Dismissed (3 — same as prior pass, independently re-confirmed noise):**
1. `toEqual` array-order reliance — DISMISSED: order is deterministic AND identical on both boards (ordered replay reproduces `seq` 1..N → fold/Map insertion order matches); not a flake.
2. "DROP before first reaction" doesn't assert the complement stays green — DISMISSED: localization structurally guaranteed by seed ordering (verified L103-106 precede L118) and the other 5 discrimination tests pin their complements; a LOW robustness nit, not a defect.
3. rooms iterates `projects` while messages/reactions/contracts iterate `foldRooms().values()` — DISMISSED: verified the two iteration sets are identical (one project; every seeded room belongs to it; `listRooms`+`listAnnouncements` = the same room set, clean partition).

**Rules:** Rule 1 N/A (introduces NO service — it is the proving test). Rule 3 satisfied (real-ledger round-trip IS the evidence). Rule 5 N/A (no NFR amendment). Rule 6 N/A (no `docs/adr`). No fidelity gap — every derived-state category round-trips identically (FR34 lossless against the SQLite backend).

Left UNCOMMITTED for the lead's post-CR per-story smoke gate.

### Change Log

- 2026-06-06 — Story 11.4 INDEPENDENT re-review APPROVED / CLEAN (0 HIGH / 0 MED / 0 LOW / 0 patches / 0 deferred / 3 dismissed). Second adversarial pass (blind/edge/auditor lenses), all claims re-verified from primary sources. AC4 Rule-7 non-vacuity independently re-confirmed via a DIFFERENT vector than the prior CR — blinded the COMPARISON helper for TWO categories (cursors → `cursor:0` = 4 RED; reactions → `liveReactors:[]` = 2 RED), each reverted byte-identical → 8/8 re-green. AC5 zero production-source change re-verified (carve-out diff EMPTY; fixtures not a collected suite). All 7 categories read via core projections + each non-emptiness guard fires (proven by the blinding probes tripping them); cursor non-zero; createdAt/lastSeen exclusion narrow + ratified. FULL ROOT gate re-run GREEN: lint 0 / typecheck 0 / build clean / `pnpm test` 1550 passed (179 files, 0 failed) / format clean. Status stays `done`. Left UNCOMMITTED for the lead's post-CR smoke gate.
- 2026-06-05 — Story 11.4 code review APPROVED / CLEAN (0 HIGH / 0 MED / 0 patches / 3 dismissed). Independently re-confirmed AC4 non-vacuity on TWO categories (cursors `13→0` RED; reactions/contracts carol-reaction RED; both reverted byte-identical). AC5 zero production-source change verified (carve-out diff empty; fixtures not collected as a suite). All 7 categories + each non-emptiness guard fire on the seed; createdAt/lastSeen exclusion confirmed narrow + ratified. FULL ROOT gate re-run GREEN: lint 0 / typecheck 0 / build clean / `pnpm test` 1550 passed (179 files, 0 failed) / format clean. Status review → done.
- 2026-06-05 — Story 11.4 implemented (TEST-ONLY). Added the canonical FR34 round-trip fidelity test + a test-only fixtures module (comprehensive all-10-types seed with a non-zero cursor + live contract; per-category `deriveComparableState` over core projections; display-only `createdAt`/`lastSeen` excluded per the ratified Story-11.3 AC4 carve-out). All 7 derived-state categories round-trip identically (export → import into a fresh empty board → identical derived state). AC4 mutation-tested non-vacuous (3 permanent archive-break discrimination tests + a transient byte-level Rule-7 RED→revert→green proof). Zero production-source change (AC5; two new untracked files only). Full canonical ROOT gate green (lint 0 / typecheck 0 / build clean / test 1547 / format clean).
