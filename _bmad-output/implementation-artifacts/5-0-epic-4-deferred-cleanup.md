---
baseline_commit: c30968c
---

# Story 5.0: Epic 4 Deferred Cleanup

Status: done

<!-- Cleanup story — not in epics.md. Created by the /epic-cycle Retrospective Review & Story X.0 gate. -->
<!-- Triages the Epic 4 retrospective Action Items (A–D) + deferred-work.md OPEN items before Epic 5 feature work. -->

## Story

As the project lead,
I want the one actionable Epic-4 carry-forward (the room write-tools' missing negative-path input-validation tests) closed before Epic 5 feature work,
so that the Epic 4 room tools (`reply`, `add_participant`) have explicit boundary-rejection coverage proving a malformed `room_id`/`handle` is rejected at the Zod boundary with NOTHING appended — closing deferred-work 4.3-a and applying it consistently — while the remaining LOWs (1.5, 1.6, 3.0-b, 4.6-a, E3-tool-names) carry forward to their already-targeted destinations and the body-cap hardening (4.3-b) is left to Story 5.1, which replaces the cap.

## Acceptance Criteria

1. **Given** the Epic 4 room WRITE tools (`reply`, `add_participant`) validate their inputs with a Zod schema at the MCP boundary (the SDK rejects an invalid call BEFORE the core delegate runs, so no event is appended),
   **When** each is called with a malformed `room_id` (empty / whitespace / non-slug-charset) — and `add_participant` additionally with a malformed `handle` (empty / non-handle-charset) —
   **Then** the call is rejected as invalid input (an `isError` result from Zod validation) and NOTHING is appended to the ledger (asserted over the real `Client`↔`McpServer`↔SQLite stack: the relevant `eventsByType` counts are unchanged),
   **And** these negative-path cases are added as discoverable tests (closing deferred-work **4.3-a**: the malformed-`room_id` boundary-rejection test gap).

2. **Given** the remaining OPEN deferrals are out of scope for this cleanup,
   **When** `deferred-work.md` is reconciled,
   **Then** **4.3-a** is marked **RESOLVED** (this story 5.0, with evidence),
   **And** **1.5**, **1.6**, **3.0-b**, **4.6-a**, **E3-tool-names** remain **OPEN** with their existing rationale + destinations intact (3.0-b + 4.6-a → Story 6.1 measurement; E3-tool-names → Epic 7),
   **And** **4.3-b** (the `body` cap-edge test gap) is annotated as OWNED BY Story 5.1 (which replaces the interim `.max(16000)` char cap with the formal 256 KB byte cap + `BODY_TOO_LARGE`, and must test the cap edge there),
   **And** the ledger-snapshot line is updated.

3. **Given** the full quality gate must stay green,
   **When** the gate is run in honest order,
   **Then** `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, `pnpm test`, and `pnpm run format` (`--check`) are all GREEN,
   **And** the test count grows by exactly the added negative-path cases (no production source change — note the final count).

## Review Findings

**Code review — 2026-05-31 (Story 5.0, branch `AGENTBBS-1-epic5`, baseline `c30968c`). Outcome: APPROVED — clean review. 0 decision-needed / 0 patch / 0 defer / 0 dismissed.**

Reviewed proportionately for a LEAN test-only changeset (3 `*.integration.test.ts` + 3 tracking docs; NO production source). The adversarial-layer ceremony (parallel Blind/Edge/Auditor subagents) was not warranted at this scope; the equivalent checks were performed directly — every changed line read, the load-bearing discriminator traced to source, each AC confirmed, the honest gate re-run, and the deferred-work reconciliation validated.

Verification (all PASS):

- [x] [Review] **NO production-source change** — `git diff --name-only c30968c -- 'packages/*/src/**/*.ts' ':(exclude)packages/*/src/**/*.test.ts'` returns nothing. Changeset = `reply.integration.test.ts` (+1 case), `add-participant.integration.test.ts` (+1 case, `room_id` AND `handle`), `read-room.integration.test.ts` (+1 READ-parity case), plus `deferred-work.md` / `sprint-status.yaml` / `tests/test-summary.md`. Body cap (`ANNOUNCEMENT_BODY_MAX_LENGTH = 16_000`, Story 5.1's) untouched.
- [x] [Review] **Negative-path tests are genuine (not vacuous).** Each malformed case asserts BOTH `result.isError === true` AND `readErrorPayload(result) === undefined`. The discriminator is sound and was traced to source: `register-tool.ts` documents (verified vs `@modelcontextprotocol/sdk@1.29.0`) that the SDK runs `validateToolInput` and throws `InvalidParams` BEFORE the handler body — so a Zod-boundary rejection never reaches `registerCoreTool`'s `try/catch` → `mapErrorToResult` is NOT called → no `structuredContent.{code,message}` → `readErrorPayload` is `undefined`. Contrast the core paths (`ROOM_NOT_FOUND`/`HANDLE_NOT_FOUND`), which DO go through `mapErrorToResult` and carry a closed `code` (the sibling cases assert `toMatchObject({ code: 'ROOM_NOT_FOUND' })`). So `undefined` correctly proves rejection happened at the Zod boundary, before any append path. The "nothing appended" counts are anchored to a GENUINELY-ESTABLISHED prior `=== 1` (a real `reply`/`add_participant` appended first), then asserted unchanged together with `maxSeq()` per rejected call — the stronger "a valid op DID append, a malformed one does NOT" guarantee, not `=== 0`. Malformed inputs (`''`, `'   '`, `'Bad Room!'`, `'UPPER'`, `'--leading'`, `'a..b'`; handles `''`, `'   '`, `'Bad Handle!'`, `'has space'`, `'UPPER!'`) are each genuinely rejected by the confirmed regexes. 3 suites re-run green: 28/28 unfiltered; `-t "boundary"` → 3 passed / 25 skipped (exactly one new case per file).
- [x] [Review] **deferred-work.md reconciliation accurate.** 4.3-a → RESOLVED (Story 5.0, with a `**Resolution:**` line + evidence naming the 3 cases). 4.3-b → OPEN, annotated OWNED BY Story 5.1 (cap-edge; 5.1 replaces the interim char cap with 256 KB / `BODY_TOO_LARGE`). 1.5, 1.6, 3.0-b (→6.1), 4.6-a (→6.1), E3-tool-names (→Epic 7) remain OPEN with rationale + destinations intact; the cosmetic 4.5-tool-label also retained OPEN. Ledger-snapshot line re-headed "reconciled by Story 5.0" and is internally consistent with the per-item entries.
- [x] [Review] **Rule 4 (Epic 4 retro) applied — no stale source-fact coded to.** The dev verified the story's source-facts against the repo and caught the `bodySchema` → **`announcementBodySchema`** name delta (`reply.ts` / `read-room.ts` both import `announcementBodySchema` from `room-shared.ts`); recorded in the Dev Agent Record, not load-bearing (body cap deliberately untouched). Re-confirmed at review: `roomIdSchema = z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)`, `handleSchema = z.string().min(1).max(128).regex(/^[a-z0-9._@-]+$/)`, event types `room.replied`/`room.participant_added` (closed vocabulary), `eventsByType`/`maxSeq` real `DataAccess` SQLite read paths (`queries.ts`). `read_room` reuses the SAME `roomIdSchema` (line 38) — the READ-parity case is genuine new coverage.
- [x] [Review] **Rule 1 N/A** (not service-introducing — strengthens existing tools' Rule 3 boundary coverage). **Rule 3 satisfied** — all 3 cases run over the real `Client`↔`McpServer`↔`InMemoryTransport`↔`createDataAccess`/SQLite stack, nothing mocked. **Rule 5/6 N/A** (no NFR work; no `docs/adr/`). **Rule 8** — all 3 files are co-located `*.integration.test.ts` matched by the root glob; no `.only`/`.skip`/`.todo` in `tools/` (grep-verified).
- [x] [Review] **Full honest gate GREEN (re-run by reviewer), in order:** `pnpm run lint` (0) → `pnpm run build` (7/7) → `pnpm run typecheck` (0) → `pnpm test` (**478 / 69 files**, 0 failed / 0 skipped) → `pnpm run format` `--check` (clean). Test delta = 475 → 478 = **+3** exactly (no new test files), matching AC #3.

**No deferred items introduced by this review.** Left UNCOMMITTED per the stage directive (the lead commits after the smoke gate).

## Tasks / Subtasks

- [x] Task 1: Add negative-path input-validation tests for the room write tools (AC: #1)
  - [x] In `packages/mcp-server/src/tools/reply.integration.test.ts` (or a co-located `*.test.ts`), add cases over the real `Client`↔`McpServer`↔SQLite stack: `reply` with `room_id` = `""`, `"   "`, and a non-slug-charset value (e.g. `"Bad Room!"` / uppercase) → `isError` (Zod rejection), and assert `eventsByType('room.replied')` count is UNCHANGED (nothing appended). First establish a known room (announce → post → reply) so the count delta is meaningful.
  - [x] In `packages/mcp-server/src/tools/add-participant.integration.test.ts`, add cases: `add_participant` with malformed `room_id` AND with malformed `handle` (empty / non-`[a-z0-9._@-]`) → `isError`, `eventsByType('room.participant_added')` UNCHANGED.
  - [x] (Optional, if cheap) spot-check a READ tool's `room_id`/`project_id` rejection (`read_room` empty `room_id` → `isError`) for parity — only if it adds genuine coverage not already present. **DONE** — added a `read_room` malformed-`room_id` boundary-rejection case (genuine new coverage: `read-room.integration.test.ts` had only the well-formed-but-unknown `ROOM_NOT_FOUND` path, not a Zod-boundary rejection).
  - [x] Do NOT change any production source — this is test-only hardening. Do NOT touch the body cap (Story 5.1 owns it). Confirm the new tests are discoverable by the default `vitest run` (correct `*.test.ts`, default project). **Confirmed**: 0 production-source files changed; the +3 cases are in existing `*.integration.test.ts` files and run in the default `vitest run` (475 → 478).
- [x] Task 2: Reconcile `deferred-work.md` (AC: #2)
  - [x] Mark **4.3-a** RESOLVED (this story — negative-path room-tool input-validation tests; evidence = the new cases). Add a one-line `**Resolution:**`.
  - [x] Annotate **4.3-b** as owned by Story 5.1 (body-cap replacement). Leave **1.5**, **1.6**, **3.0-b** (→6.1), **4.6-a** (→6.1), **E3-tool-names** (→Epic 7) OPEN, rationale intact.
  - [x] Update the ledger-snapshot line.
- [x] Task 3: Full-gate verification (AC: #3)
  - [x] Run, in order: `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, `pnpm test`, `pnpm run format` (`--check`). All green. Note the final test count (Epic 4 closed at 475 / 69 files). **Result: 478 / 69 files** (= 475 + 3 added cases, no new test files), 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`.

## Dev Notes

This is a **test-hardening / housekeeping story** — it adds negative-path boundary-rejection tests for the Epic 4 room write tools and reconciles `deferred-work.md`. It introduces NO new service, MCP tool, `core` op, event type, error code, or production-source change.

- **Rule 1 (Integration ACs):** N/A — not service-introducing. The added tests exercise EXISTING tools' boundary over the real runtime (strengthening Rule 3 coverage, not adding a surface).
- **Rule 3 (real-runtime evidence):** the new negative-path cases run over the real `Client`↔`McpServer`↔SQLite stack (the established bar).
- **Rule 5 / Rule 6:** N/A (no NFR work; no `docs/adr/`).
- **Rule 4 (NEW, Epic 4 retro):** before relying on this story's source-facts (the room tools' schema names / `eventsByType` types), the dev VERIFIES them against the repo (`reply.ts`/`add-participant.ts` schemas; `room.replied`/`room.participant_added` event types) — do not assume.

### Triage source facts (verified at story creation, baseline `c30968c`)

- **Deferred-work OPEN set** (ledger snapshot, reconciled by Story 4.0 + extended by Epic 4 reviews): 1.5, 1.6, 3.0-b, 4.6-a, E3-tool-names, 4.3-a, 4.3-b, plus the 4.5 tool-label doc LOW. This story resolves ONLY 4.3-a (the actionable one); the rest are no-trigger defers (1.5/1.6), Story-6.1 measurement items (3.0-b, 4.6-a), an Epic-7 contract item (E3-tool-names), a Story-5.1-owned cap item (4.3-b), and a cosmetic doc LOW (4.5 — fold opportunistically or leave).
- **Room write tools**: `packages/mcp-server/src/tools/reply.ts` (`{ room_id: roomIdSchema, body: bodySchema }`), `add-participant.ts` (`{ room_id: roomIdSchema, handle: handleSchema }`). `roomIdSchema`/`bodySchema` in `room-shared.ts` (`.min(1).max(...)`, slug charset); `handleSchema` in `identity-shared.ts` (`^[a-z0-9._@-]+$`). The SDK validates these BEFORE the delegate, so a malformed input never reaches core / never appends.
- **Body cap**: `ANNOUNCEMENT_BODY_MAX_LENGTH = 16_000` (interim char cap, plain Zod error) — explicitly Story 5.1's to replace with 256 KB + `BODY_TOO_LARGE`. Do NOT touch it here.

## Dev Agent Record

### Context Reference

- Story implemented under `/epic-cycle` (dev stage). Model: Claude Opus 4.8 (1M context). Baseline commit `c30968c` (preserved in frontmatter; matched `git rev-parse HEAD` at start — clean tree).

### Rule 4 (Epic 4 retro) source-fact verification — DONE before coding

The story's source-facts about EXISTING symbols were verified against the repo BEFORE relying on them (Rule 4 / Research-First):

- **`roomIdSchema`** (`packages/mcp-server/src/tools/room-shared.ts`) — confirmed `z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)`. Rejects empty / whitespace / uppercase / spaces / punctuation / leading-or-double-hyphen.
- **`handleSchema`** (`packages/mcp-server/src/tools/identity-shared.ts`) — confirmed `z.string().min(1).max(128).regex(/^[a-z0-9._@-]+$/)`. Rejects empty / spaces / uppercase / out-of-charset.
- **Body schema delta:** the story's source-fact calls `reply`'s body validator `bodySchema`; the actual symbol is **`announcementBodySchema`** (re-used from `room-shared.ts`). Not load-bearing for this story (Story 5.1 owns the body cap; Task 1 deliberately does NOT touch `body`), but recorded so the next agent doesn't re-litigate the name.
- **Event types** `room.replied` / `room.participant_added` — confirmed in `project-context.md` (closed vocabulary) AND exercised throughout the existing integration suites.
- **`eventsByType(type)` / `maxSeq()`** — confirmed on `DataAccessHandle`; the existing suites read counts/`maxSeq` out-of-band over the REAL ledger as the nothing-appended evidence.
- **Canonical Zod-boundary-rejection assertion pattern** — mirrored from `announce-project.integration.test.ts` ("rejects invalid input (empty title) at the boundary"): `expect(result.isError).toBe(true)` + `expect(readErrorPayload(result)).toBeUndefined()` (the discriminator — a Zod rejection carries NO closed board code, distinct from a core `BoardError` with a `code`) + `maxSeq` unchanged + the event count unchanged.

### Completion Notes

- **Task 1 (AC #1) — DONE, test-only.** Added 3 negative-path boundary-rejection cases over the real `Client`↔`McpServer`↔SQLite stack (nothing mocked; real `createDataAccess`):
  - `reply.integration.test.ts` — establishes a genuine active room (announce → post → a real reply ⇒ `room.replied` count = 1), then drives `reply` with `room_id` ∈ `['', '   ', 'Bad Room!', 'UPPER', '--leading', 'a..b']`; each is rejected at the Zod boundary (`isError`, `readErrorPayload` undefined), `maxSeq` unchanged, and the real `room.replied` count stays 1 (a stronger guarantee than asserting 0 — a valid reply DID append, a malformed one does NOT).
  - `add-participant.integration.test.ts` — establishes a real `room.participant_added` (B replies → B pulls in C ⇒ count = 1), then drives malformed `room_id` (valid handle) AND malformed `handle` (valid room_id, `handle` ∈ `['', '   ', 'Bad Handle!', 'has space', 'UPPER!']`); each rejected at the boundary, `maxSeq` unchanged, `room.participant_added` stays 1.
  - `read-room.integration.test.ts` — the optional READ-side parity spot-check: malformed `room_id` → `isError` + `readErrorPayload` undefined (NOT `ROOM_NOT_FOUND`). Genuine new coverage — `read_room`'s suite previously had only the well-formed-but-unknown `ROOM_NOT_FOUND` path.
  - **No production source changed.** Body cap untouched (Story 5.1 owns it).
- **Task 2 (AC #2) — DONE.** `deferred-work.md` reconciled: **4.3-a RESOLVED** (this story, with a `**Resolution:**` + evidence pointing at the 3 cases); **4.3-b OPEN → OWNED BY Story 5.1** (cap-edge — 5.1 replaces the interim `.max(16000)` char cap with the formal 256 KB / `BODY_TOO_LARGE` and tests the edge there); ledger-snapshot line re-reconciled (now "reconciled by Story 5.0"); the Epic-4 carried-forward block updated (added explicit OPEN bodies for **4.6-a → 6.1** and the cosmetic **4.5-tool-label**, which the snapshot references). **1.5**, **1.6**, **3.0-b (→6.1)**, **E3-tool-names (→Epic 7)** remain OPEN with rationale intact.
- **Task 3 (AC #3) — DONE.** Honest gate, in order: `pnpm run lint` (clean) → `pnpm run build` (7/7) → `pnpm run typecheck` (clean) → `pnpm test` (**478 / 69 files**) → `pnpm run format --check` (clean). Prettier `--check` initially flagged the 2 write-tool test files (the new bad-input arrays wrapped to multi-line); applied `prettier --write` to those 2 files and re-ran `--check` green; re-ran the full suite green on the formatted tree (478). Test delta = **475 → 478 = +3** (exactly the added cases; no new test files), 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`.
- **Build-before-test:** ran `pnpm run build` before `pnpm test` per project-rules §2 caveat (the forked cross-process worker suites resolve `@agentbbs/core` via `dist`, not the Vitest `src` alias). This story adds NO new `core` export, so the alias/`dist` distinction did not bite — build-first observed for gate honesty.
- **Rule 1 (Integration ACs):** N/A — not service-introducing; strengthens EXISTING tools' boundary coverage (Rule 3). **Rule 5 (NFR tripwire):** N/A. **Rule 6 (ADRs):** N/A — no `docs/adr/`.
- **Commit:** left UNCOMMITTED per the stage directive (the lead commits after the smoke gate). `dist/` is git-ignored — not staged.

### File List

- `packages/mcp-server/src/tools/reply.integration.test.ts` (modified — +1 negative-path case)
- `packages/mcp-server/src/tools/add-participant.integration.test.ts` (modified — +1 negative-path case, covers `room_id` AND `handle`)
- `packages/mcp-server/src/tools/read-room.integration.test.ts` (modified — +1 READ-side parity case)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — 4.3-a RESOLVED, 4.3-b → 5.1, snapshot + carried-forward block reconciled)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story status ready-for-dev → in-progress → review)
- `_bmad-output/implementation-artifacts/5-0-epic-4-deferred-cleanup.md` (modified — this story file: Tasks checked, Dev Agent Record, Status)

### Change Log

| Date | Change |
|---|---|
| 2026-05-31 | Story 5.0 dev: added 3 negative-path Zod-boundary-rejection integration cases (`reply` / `add_participant` malformed `room_id`+`handle`, `read_room` READ-parity) over the real stack — test-only, 0 production-source change. Reconciled `deferred-work.md` (4.3-a RESOLVED; 4.3-b → Story 5.1; snapshot updated). Honest gate green: lint / build 7-7 / typecheck / test **478 (69 files)** / format `--check`. Status → review. |

## Retro-Review Triage (Epic 4 → Story 5.0)

Triage covers the **Epic 4 retrospective** (`epic-4-retro-2026-05-31.md`, Action Items A–D) and the OPEN items in `deferred-work.md`, at the `/epic-cycle` Retrospective Review gate on **2026-05-31** before Epic 5 feature work.

| Item | Source | Triage Decision |
|---|---|---|
| **4.3-a** — malformed-`room_id` boundary-rejection test gap (room write tools) | Epic 4 retro Action D / deferred-work | **INCLUDE (Task 1)** — small, real test-hardening; closes the gap + applies consistently to `reply`/`add_participant`. |
| **4.3-b** — `room_id`/`body` cap-edge test gap | Epic 4 retro Action D / deferred-work | **DEFER → Story 5.1** — 5.1 replaces the interim body cap with the formal 256 KB / `BODY_TOO_LARGE` and must test the cap edge there; testing the interim cap now would be thrown away. |
| **1.5** — append-invariant lint guard excludes `*.test.ts` | Epic 1 / deferred-work | **DEFER (OPEN)** — needs AST-level matching; no Epic 5 trigger. |
| **1.6** — `wireToPayload` payload-shape validation | Epic 1 / deferred-work | **DEFER (OPEN)** — corruption-tolerance; no Epic 5 trigger (5.x reads messages but the write→read round-trip holds). |
| **3.0-b** — guard-before-append double-read | Epic 3 / deferred-work | **DEFER → Story 6.1 (OPEN)** — `check` hot-path measurement; 6.1 is imminent. |
| **4.6-a** — `roomJoinSeq`/`roomMessagesSince` per-call full-stream fold cost | Epic 4 / deferred-work | **DEFER → Story 6.1 (OPEN)** — same class as 3.0-b; measure when `check` composes them per dial-in. |
| **E3-tool-names** — MCP tool names/envelopes not contract-pinned | Epic 3 / deferred-work | **DEFER → Epic 7 (OPEN)** — `mcp-tool-contract.md`; now covers 12+ tools. |

**Summary:** included = 1 (4.3-a), deferred = 6, dropped = 0.
