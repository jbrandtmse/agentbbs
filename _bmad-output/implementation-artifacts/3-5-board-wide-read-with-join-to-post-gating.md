---
baseline_commit: 3b3048b5a9429253d584149f335ac91a775ec87f
---

# Story 3.5: Board-wide read with join-to-post gating

Status: done

## Story

As the board,
I want reading to be open board-wide while posting requires membership/participation,
so that onboarding-by-reading works and the only write gate is acting.

## Acceptance Criteria

1. **Given** any registered identity that is not a member of a sub-board,
   **When** it reads that sub-board's directory / project listing (the Epic 3 read tools `list_projects`, `list_members`),
   **Then** the read succeeds (no membership required) — the board-wide-open-read invariant (FR9) holds for every Epic 3 read surface, for a non-member identity.

2. **Given** a non-member identity and the membership write-gate primitive this story ships,
   **When** the gate is asked to authorize a post into a sub-board the actor has NOT joined,
   **Then** it rejects with `NOT_A_MEMBER` (the gate Epic 4's post tools call before appending) — and authorizes (no throw) when the actor IS a member.

3. **Given** a `project_id` that was never announced,
   **When** the membership gate is invoked,
   **Then** it rejects with `BOARD_NOT_FOUND` (you cannot be a member of a board that does not exist — distinct from `NOT_A_MEMBER` for an existing board you have not joined).

4. **Given** the architecture's "acting = joining" rule (FR10),
   **When** an action that implies joining (`reply` / `add_participant`) occurs,
   **Then** the actor becomes a sub-board member as a side effect — **this behavior is implemented and verified in Epic 4** (the post tools); Story 3.5 ships only the gate + the read-open invariant and DECLARES this forward-link (see Integration ACs / Rule 1 escape clause).

## Integration ACs

5. **Integration AC (real-runtime, Rule 3) — read-open invariant.** **Given** a real `Client`↔`McpServer` pair over `InMemoryTransport` + real `createDataAccess`, **When** A announces a board and a DIFFERENT registered identity B (a member of NOTHING) calls `list_projects` and `list_members` for that board, **Then** both reads succeed for B (board-wide open read, no membership) — proven over the real transport + ledger.

6. **Rule 1 escape clause — no post consumer in Epic 3.** The membership write-gate primitive (`requireMembership` / `isMember`) introduced here has **NO consumer in this story or epic** — reads don't gate on membership, and there is no post/reply/add_participant tool until Epic 4. **The first consumers are the Epic 4 post tools** (`post_announcement` Story 4.1, `reply` Story 4.3, `add_participant` Story 4.5), which call this gate before appending and (for reply/add_participant) implement the "acting = joining" side effect (AC #4). This story proves the gate directly via a real-ledger unit/integration test; the end-to-end post→NOT_A_MEMBER round-trip is an Epic 4 deliverable. (This mirrors Story 2.5's `recordSeen` "no consumer yet" pattern.)

## Tasks / Subtasks

- [x] Task 1: Core membership write-gate primitive (AC: #2, #3)
  - [x] Add `packages/core/src/projects/membership.ts` exporting BOTH a pure predicate and a throwing gate:
    - `isMember(project: Project, actor: string): boolean` — `project.members.includes(actor)` (pure, no I/O; the cheap check Epic 9/10 UI + post ops can reuse).
    - `requireMembership(dataAccess, actor, projectId): Promise<void>` — read `eventsSince(0)`, `findProject(projectId)`: `undefined` → throw `BoardError('BOARD_NOT_FOUND', …)`; else if `!isMember(project, actor)` → throw `BoardError('NOT_A_MEMBER', …)`; else return (authorized). This is the exact gate the Epic 4 post tools call before they append.
  - [x] `actor` is a parameter (session-agnostic core), mirroring the other ops. The gate performs NO append (it is a pure authorization check).
  - [x] Reuse `findProject`/`Project`/`isMember` — do not duplicate the membership fold.
- [x] Task 2: Barrel exports (AC: #2)
  - [x] Export `isMember` and `requireMembership` from `packages/core/src/index.ts`.
- [x] Task 3: Lock-in the board-wide-open-read invariant (AC: #1)
  - [x] Do NOT add a new read tool — `list_projects` (3.2) and `list_members` (3.4) already implement open read (identity-required, membership-free). This task adds EXPLICIT lock-in tests that tie those tools to FR9: a non-member identity successfully reads both, so a future regression that accidentally adds a membership gate to a read is caught. (If 3.2/3.4 already have a non-member read test, ADD a focused FR9 assertion rather than duplicate; the point is an explicit "reads never gate on membership" guard.)
- [x] Task 4: Tests (AC: all + Integration AC #5)
  - [x] Unit (core): `isMember` true/false; `requireMembership` — member → resolves (no throw); non-member of an existing board → `NOT_A_MEMBER`; unknown board → `BOARD_NOT_FOUND`; the announcer (auto-joined) is a member; a joined non-announcer is a member.
  - [x] Integration (mcp-server, real `Client`↔`McpServer` + real `createDataAccess`): AC #5 read-open round-trip (non-member B reads `list_projects` + `list_members` successfully). Optionally exercise `requireMembership` against the same real ledger (read the events the tools wrote, then assert the gate's verdict for a member vs a non-member) to prove the gate agrees with the real membership state — this is the real-runtime evidence for the gate ahead of its Epic 4 tool consumer.
  - [x] Rule 8: co-located `*.test.ts`, discoverable.
- [x] Task 5: Full gate — lint, typecheck, test, build, format all green; note the count.

## Dev Notes

This story closes Epic 3 by formalizing the visibility model: **read = open board-wide (identity, not membership); write = membership-gated.** The read side is already delivered by 3.2/3.4; this story (a) ships the reusable membership WRITE-gate primitive that Epic 4's post tools will call, and (b) locks in the read-open invariant with explicit FR9 tests. There is NO new MCP tool and NO post consumer yet — the gate is plumbing for Epic 4, declared via the Rule 1 escape clause.

- **Rule 1 (Integration ACs):** SATISFIED via the escape clause (AC #6) — the gate is service-introducing but has no Epic-3 consumer; the first consumers are named (Epic 4 Stories 4.1/4.3/4.5). AC #5 still provides a real read-open integration test.
- **Rule 3 (real-runtime):** the read-open invariant is proven over the real transport (AC #5); the gate primitive is proven against a real ledger (Task 4 integration). No new user-facing tool ships, so there is no new stdio-tool surface to smoke beyond the read-open + gate evidence (the lead smoke exercises the read-open over the real stdio server + the gate via core against a real ledger).
- **Rule 5/6:** N/A.

### DECISION — Story 3.5 ships a gate primitive, not a post tool

Posting (`post_announcement`, `reply`, `add_participant`) is Epic 4. Story 3.5's AC #2 ("attempts to post … → NOT_A_MEMBER") describes the GATE'S behavior, which this story implements and tests directly; the end-to-end post→NOT_A_MEMBER through an actual tool is an Epic 4 round-trip. **Decision: implement `requireMembership` + `isMember` in core, export them, prove them against a real ledger, and DECLARE Epic 4 as the first consumer (Rule 1 escape clause)** — rather than inventing a throwaway Epic-3 post tool just to exercise the gate. This mirrors Story 2.5 (`recordSeen` shipped as plumbing with a declared future consumer). The "acting = joining" side effect (AC #4) is likewise an Epic 4 deliverable (the reply/add_participant tools append a `board.joined` as a side effect); it is NOT implemented here — only forward-declared.

### Source facts (verified at story creation, baseline `3b3048b`)

- **`NOT_A_MEMBER`** already in `BOARD_ERROR_CODES` (Story 1.3). `BOARD_NOT_FOUND` added Story 3.3. Reuse both.
- **Projects projection (`projection.ts`):** `findProject(events, projectId): Project | undefined`; `Project.members: string[]` (announcer first, joiners appended, de-duped). `isMember` is `project.members.includes(actor)`.
- **Read-open already true:** `list_projects` (3.2) and `list_members` (3.4) are session-required but membership-FREE (a non-member identity reads them — proven by their integration tests). Task 3 adds explicit FR9 lock-in assertions, not a behavior change.
- **`DataAccess.eventsSince(0)`** — the seq-ordered full read `requireMembership` folds.
- **No new event type, no new error code, no new MCP tool.** Pure additive core helper + tests. (Confirm: the `BOARD_ERROR_CODES` `toContain` test already covers `NOT_A_MEMBER`/`BOARD_NOT_FOUND`; no error-model change.)
- **Pattern for a read+findProject+throw helper:** `board-directory.ts` (Story 3.4) is the closest shape (read `eventsSince(0)` → `findProject` → BOARD_NOT_FOUND) — `requireMembership` is that minus the assembly, plus the `NOT_A_MEMBER` branch.

### Project Structure Notes

- New `core` file `packages/core/src/projects/membership.ts` + test; barrel edits; lock-in test additions to the existing `list-projects`/`list-members` integration tests (or a small dedicated FR9 test). No `mcp-server` tool file, no `server.ts` change (no new tool).
- core depends only on the DataAccess port; the gate is pure authorization (no append).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.5] — board-wide open read; non-member post → NOT_A_MEMBER; acting (reply/add_participant) = joining (verified Epic 4).
- [Source: _bmad-output/planning-artifacts/architecture.md] — FR9 open read / FR10 post-by-membership; #Error shape (NOT_A_MEMBER); "read is open board-wide … posting requires membership, acquired by join_board or implicitly by reply/add_participant (acting = joining)" (PRD addendum §C / architecture).
- [Source: packages/core/src/projects/projection.ts] — `findProject`/`Project.members` (consumed).
- [Source: packages/core/src/projects/board-directory.ts] — the read+findProject+throw shape to mirror.
- [Source: packages/core/src/identity/record-seen.ts] — precedent for shipping a primitive with a declared future consumer (Rule 1 escape clause).

### Review Findings

Code review (2026-05-31, baseline `3b3048b`, three layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor, all run inline — no layer failed). **CLEAN REVIEW — 0 findings (0 decision-needed, 0 patch, 0 defer, 2 dismissed as noise).**

Scrutiny points (a)–(h) all verified PASS:
- (a) `requireMembership` checks `findProject` (existence) BEFORE `isMember` → `BOARD_NOT_FOUND` for an unannounced board is distinct from `NOT_A_MEMBER` for an existing-but-unjoined board; precedence explicitly locked by the unit test "prefers BOARD_NOT_FOUND over NOT_A_MEMBER".
- (b) `isMember` is pure (`project.members.includes(actor)`, no I/O) and matches `Project.members` semantics (join-ordered, de-duped — `projection.ts`).
- (c) Pure authorization — NO append: the gate calls no mutator; the unit fake's mutators all throw, so reaching a `BoardError` proves nothing was written.
- (d) Reuses `findProject`/`Project`/`isMember` — the membership fold is NOT duplicated (mirrors `board-directory.ts`'s read+findProject+throw shape exactly).
- (e) FR9 lock-in asserts a NON-MEMBER (`bob`) reads BOTH `list_projects` AND `list_members`, with explicit `not.toContain('bob')` / `includes('bob') === false` — a future read-gating regression is caught.
- (f) Gate verdict agrees with the REAL ledger after a real `join_board`: the QA-added integration test flips `bob` from `NOT_A_MEMBER` → authorized once a real `board.joined` lands (the precise Epic 4 contract).
- (g) No new event type / error code / MCP tool: `errors.ts` unchanged (`NOT_A_MEMBER` Story 1.3, `BOARD_NOT_FOUND` Story 3.3 reused); no `server.ts` change; no tool file added. Pure additive core helper.
- (h) AC #4 "acting = joining" (FR10) is forward-declared to Epic 4 only — no FR10 code here.

Rule compliance:
- **Rule 1 (escape clause) — SATISFIED.** AC #6 names genuine future consumers: Epic 4 stories 4-1 (`post-an-announcement-proto-room`), 4-3 (`first-reply-activates-the-room`), 4-5 (`pull-a-participant-into-a-room`) all present in `sprint-status.yaml` as `backlog`. The `mcp-server/src/tools/` directory has NO post/reply/add_participant tool — the "no Epic-3 consumer" claim is accurate.
- **Rule 3 (real-runtime) — SATISFIED.** `board-read-open.fr9.integration.test.ts` uses a real `Client`↔`McpServer` over `InMemoryTransport` + real `createDataAccess` (better-sqlite3) — no SDK mock. The gate is exercised against the SAME real ledger the tools wrote.
- **Rule 5 (NFR) / Rule 6 (ADR): N/A** (no NFR change; `docs/adr/` empty).

Verification run by the reviewer: built `@agentbbs/core` (project Rule 2 build-first), `pnpm exec vitest run` on both touched files → **2 files / 9 tests pass** (6 core unit + 3 integration); `pnpm run typecheck` clean (confirms the hand-built unit Events conform to the real `Event` union).

Dismissed as noise (2): the full-stream `eventsSince(0)` read is the established codebase pattern (`board-directory.ts`) not a story-specific perf issue; doc comments verified accurate against the real `announceProject` (which does append the announcer's `board.joined`).

No items added to `deferred-work.md` (nothing to defer).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`

### Debug Log References

- `pnpm run build` — 7/7 packages built (core `dist` refreshed so `tsc` typecheck sees the new exports).
- `pnpm run typecheck` — clean. `pnpm run lint` — clean. `pnpm run format` — clean (after `prettier --write` on the two new test files).
- `pnpm test` — 51 files / **323 tests pass** (+8 from the prior 307 baseline: 6 core unit + 2 mcp-server integration).

### Completion Notes List

- **Task 1 (gate primitive).** Added `packages/core/src/projects/membership.ts` with `isMember(project, actor): boolean` (pure, `project.members.includes(actor)`) and `requireMembership(dataAccess, actor, projectId): Promise<void>`. The gate mirrors `board-directory.ts`'s read+`findProject`+throw shape: `eventsSince(0)` → `findProject` → `undefined` ⇒ `BOARD_NOT_FOUND`; else `!isMember` ⇒ `NOT_A_MEMBER`; else resolves. **Pure authorization — NO append.** `actor` is a parameter (session-agnostic core). Reuses `findProject`/`Project.members`/`isMember` — the membership fold is NOT duplicated.
- **Task 2 (barrel).** Exported `isMember` + `requireMembership` from `packages/core/src/index.ts`.
- **Task 3 (FR9 lock-in).** No new read tool. Added an EXPLICIT FR9 lock-in test (`board-read-open.fr9.integration.test.ts`) asserting a non-member identity B (member of NOTHING) successfully reads BOTH `list_projects` and `list_members` over the real transport — a regression that adds a membership gate to a read fails here. (3.2/3.4 each already had a non-member read case; this is the focused, named "reads never gate on membership" guard rather than a duplicate.)
- **Task 4 (tests).** Core unit `membership.test.ts` (6): `isMember` true/false (announcer auto-joined, joined non-announcer, registered-not-joined, unregistered); `requireMembership` member→resolves (announcer + joined non-announcer), non-member→`NOT_A_MEMBER`, unknown board→`BOARD_NOT_FOUND`, and BOARD_NOT_FOUND-precedence over NOT_A_MEMBER. The fake DataAccess's mutators all throw, so reaching a `BoardError` proves the gate appends nothing. Integration `board-read-open.fr9.integration.test.ts` (2): the FR9 read-open round-trip + `requireMembership` exercised against the SAME real ledger the tools wrote (member ada authorized; non-member bob → `NOT_A_MEMBER`; unknown board → `BOARD_NOT_FOUND`) — real-runtime evidence for the gate ahead of its Epic 4 tool consumer. All co-located `*.test.ts` (Rule 8, discoverable).
- **AC #4 / AC #6 (forward-declared only).** "Acting = joining" (FR10) and the post→`NOT_A_MEMBER` end-to-end round-trip are Epic 4 deliverables (first consumers `post_announcement` 4.1, `reply` 4.3, `add_participant` 4.5). No throwaway Epic-3 post tool was invented — the gate ships as plumbing with a declared future consumer (Rule 1 escape clause), mirroring Story 2.5's `recordSeen`.
- **Rules:** Rule 3 (real-runtime) satisfied by the integration test. Rule 5 (NFR tripwire) N/A — no NFR was unimplementable. Rule 6 (ADR) N/A — no ADRs in `docs/adr/`. No new event type, error code, or MCP tool — `NOT_A_MEMBER` (Story 1.3) and `BOARD_NOT_FOUND` (Story 3.3) reused.

### File List

- packages/core/src/projects/membership.ts (new)
- packages/core/src/projects/membership.test.ts (new)
- packages/core/src/index.ts (modified — barrel: `isMember`, `requireMembership`)
- packages/mcp-server/src/tools/board-read-open.fr9.integration.test.ts (new)

## Change Log

| Date       | Change                                                                          |
|------------|---------------------------------------------------------------------------------|
| 2026-05-31 | Story 3.5 created by the /epic-cycle lead gate (membership write-gate primitive + read-open lock-in; Rule 1 escape clause — first consumers Epic 4 4.1/4.3/4.5). Status → ready-for-dev. |
| 2026-05-31 | Dev: shipped `isMember`/`requireMembership` (`packages/core/src/projects/membership.ts`) + barrel exports; added FR9 read-open lock-in + gate-vs-real-ledger integration test and core unit tests. No new tool/event/error-code; AC #4 (acting=joining) + post-tool consumer forward-declared for Epic 4 (Rule 1 escape clause). Full gate green: lint/typecheck/build/format clean, 323 tests (+8). Status → review. |
