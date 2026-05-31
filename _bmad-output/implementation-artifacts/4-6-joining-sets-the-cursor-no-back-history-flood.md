---
baseline_commit: 6a8f9c2
---

# Story 4.6: Joining sets the cursor — no back-history flood

Status: done

## Story

As a newly added or newly replying participant,
I want my room cursor set to the current ledger position on join,
So that my subsequent `check` surfaces only new messages, not the entire back-history.

## Acceptance Criteria

1. **Given** I join a room (by `reply` 4.3) or am added to it (by `add_participant` 4.5) when the room already has history,
   **When** the join event is processed,
   **Then** my room cursor (the per-room FLOOR for `check`) is the `seq` of the event by which I joined that room — i.e. the current ledger position at the instant of my join (my joining event is the newest `seq` when appended),
   **And** this is a DERIVED value (the `seq` of my earliest participating event for the room), NOT a stored/mutated position (THE APPEND INVARIANT — no cursor table, no mutation).

2. **Given** my per-room join cursor,
   **When** "what is new for me in this room" is computed as the room's messages with `seq > myJoinCursor`,
   **Then** I receive ONLY messages appended AFTER I joined — the room's pre-join back-history (the seeding announcement + replies before my join) is EXCLUDED (no flood),
   **And** the full prior history remains available on demand via `read_room` (Story 4.4 — `read_room` is never cursor-scoped).

3. **Given** I joined by replying,
   **When** the cursor is computed,
   **Then** it is the `seq` of my (min-`seq`) `room.replied` for the room — so my own reply is NOT re-surfaced as "new for me" (`seq > myJoinCursor` is strict), but every later participant's message IS.

4. **Given** I joined by being added (`add_participant`) and later also reply,
   **When** the cursor is computed,
   **Then** it is the EARLIEST of those events (the add, which came first) — the cursor is the moment I FIRST became a participant, so nothing between my add and my first reply is lost.

5. **Given** an identity that is NOT a participant of the room,
   **When** the join cursor is requested,
   **Then** it is `undefined` (they have no join position — `check` will not surface that room's messages to them at all; participation is the room-scope gate for `check`).

6. **(Integration AC — real SQLite ledger; producer with a forward-declared consumer.)**
   **Given** the real `createDataAccess` SQLite ledger with a room that has an announcement + several replies (existing history),
   **When** a new identity joins (replies) or is added mid-stream and the per-room join cursor is computed against the real ledger,
   **Then** the cursor equals that identity's joining-event `seq`, and the "new for me in this room" computation (`roomMessages` filtered `seq > cursor`) returns only the post-join messages with the pre-join back-history excluded — proven over the REAL ledger (the projection that Story 6.1 `check` consumes).
   **(Rule 1 escape clause:** this story introduces the join-cursor PRODUCER; it has NO consumer in Epic 4 — the first consumer is **Story 6.1 (`check`)**, which combines this per-room floor with the stored per-identity high-water-mark. No new MCP tool is added.)

## Review Findings

**Code review (2026-05-31) — APPROVED. 0 decision-needed / 0 patch / 0 defer-to-backlog; 2 LOW dismissed (recorded below + in deferred-work.md for the audit trail). Status review → done.**

Adversarial review (all three layers re-run against the changeset + the 6 ACs):
- **Blind Hunter (diff-only):** 0 correctness bugs. `roomJoinSeq` is a clean order-independent MIN fold (the `consider` closure); `roomMessagesSince` is a strict `seq > sinceSeq` filter over `roomMessages` (4.4), output stays seq-sorted. Type-safe within the discriminated `Event` union (no payload-shape guards needed). No mutation, no I/O.
- **Edge Case Hunter (every branch/boundary):** 0 unhandled edge cases in 4.6's own scope. Empty stream / unknown room / announcer-only / non-participant → `undefined`; replied-multiple → first; added-only → add; added↔replied (both orders) → earliest; adder-vs-added distinction; out-of-order input → MIN; cross-room isolation; strict-`>` boundary (own join excluded); added-after-last → `[]`; the announcer-who-authored-#1-but-joins-late does NOT see their own seed as "new" — ALL pinned (unit + integration). One forward-note for 6.1 (dismissed, below).
- **Acceptance Auditor (vs the 6 ACs):** 0 AC violations. AC #1 (derived = join-event seq, no stored cursor) ✓ · AC #2 (no-flood; `read_room`/`roomMessages` NOT cursor-scoped) ✓ · AC #3 (join-by-reply → min `room.replied`, strict `>`, own reply not re-surfaced) ✓ · AC #4 (added+replied → earliest = the add) ✓ · AC #5 (non-participant → `undefined`) ✓ · AC #6 (real `createDataAccess` SQLite ledger, producer w/ forward-declared 6.1 consumer; Rule 1 escape clause) ✓.

Independent verification (the directive's 8 points), all CONFIRMED:
1. **Append invariant + module boundary (lint-enforced):** cursor is DERIVED — folds events every call; NO cursor table, NO stored position, NO mutation, NO `UPDATE`/`DELETE`; `roomMessages`/`roomMessagesSince` order by `seq`; `core` imports only `Event` (the `DataAccess` port surface). `DataAccess`/`ports.ts` UNCHANGED — no `getCursor`/`setCursor` added (only the pre-existing `maxSeq()`, which is NOT used here). Repo-wide grep: zero `getCursor`/`setCursor`/cursor-table anywhere. Lint clean.
2. **AC #1/#3/#4 `roomJoinSeq` correctness:** = MIN `seq` over { actor's `room.replied` for the room ∪ `room.participant_added` naming them }; both event kinds handled; earliest wins in BOTH directions. Runtime-proven against built `core/dist`: cleo added@3 then replied@5 → 3; bob replied@2 → 2.
3. **AC #5 non-participant → `undefined`:** confirmed (announcer-only + bystander). `roomMessagesSince`'s `sinceSeq: number` signature TYPE-GUARDS the composition (it can never be called with `undefined` in-process); the non-participant-room-scope decision is 6.1's documented contract.
4. **AC #2 no-flood:** `roomMessagesSince(roomId, roomJoinSeq)` excludes the pre-join announcement + earlier replies; `read_room` (4.4, via `roomMessages`) is NOT cursor-scoped — full history on demand. Runtime-proven (`sinceSeq=0` → full [1,2,5,6]; the `participant_added`@3 is correctly NOT a message).
5. **Design decision 1 (per-room floor, NOT a mutated global cursor):** genuinely per-(identity, room) derived; `reply`/`add_participant` UNCHANGED (no `mcp-server`/ops files in the diff — `server.ts` last touched in 075e9a8/Story 4.5). The QA combined-floor preview `seq > max(checkCursor, roomJoinSeq)` correctly previews 6.1's `check` contract in BOTH `max` directions (join-floor wins below; check-HWM wins above) and shows neither bound alone suffices.
6. **AC #6 (Rule 1 escape clause + Rule 3):** the `packages/data-access/src/join-cursor.integration.test.ts` real-`createDataAccess` SQLite integration genuinely proves the projection over the real ledger (cursor == joining-event seq; back-history excluded; full history retained) — nothing mocked. Escape-clause framing legitimate (producer with no Epic-4 consumer; first consumer = Story 6.1 `check`; mirrors Story 3.5's membership-gate forward-declaration). Rule 3 satisfied by library-invocation-with-assertions over the real target runtime (no MCP surface to stdio-smoke).
7. **No new tool/event/error code:** barrel adds ONLY `roomJoinSeq`/`roomMessagesSince`; `server.ts` unchanged; `EVENT_TYPES` (10) and `BOARD_ERROR_CODES` UNCHANGED (`HANDLE_NOT_FOUND` was a Story 4.5 add, not this story).
8. **Full gate (honest order), re-run by the reviewer — ALL GREEN:** `pnpm run lint` 0 → `pnpm run build` 0 (7 packages) → `pnpm run typecheck` 0 → `pnpm test` **475 passed / 69 files** (0 failed, 0 skipped, no `.only`/`.skip`/`.todo`) → `pnpm run format` 0 (`prettier --check .`). Epic 4 is COMPLETE — whole suite green end-to-end. **Count reconciliation:** 475 − 26 (the two new 4.6 files) = 449 = the documented post-4.5 baseline. The Dev Agent Record's "470" was the dev-stage count; QA then appended 5 tests (the unit "many participants" block = 4 + the integration "combined floor" preview = 1), 470 + 5 = 475. (The directive's "476/71" is an approximate figure — no new test *files* were added by QA, so the file count stays 69; the measured total is 475.)

Rule 5 / Rule 6: N/A (no NFR work / no tripwire; no `docs/adr/`).

### Review Findings — dismissed (LOW, recorded for the audit trail)

- [x] [Review][Dismiss] **`roomJoinSeq` re-implements `participants.ts`'s participant-event filtering inline** [packages/core/src/rooms/join-cursor.ts:96-119] — Rather than importing from `participants.ts`, `roomJoinSeq` re-folds `room.replied` (actor) + `room.participant_added` (payload.handle) directly. **Dismissed (by-design):** the two compute different things — `roomParticipants` returns the membership SET (first-seen order via a `Set`), `roomJoinSeq` returns the MIN `seq` (a scalar); a shared helper would add indirection for negligible gain and couple two projections with different return shapes. The filtering predicate is trivial (a two-case `switch` on `roomId` match) and identical in both, documented as such in both files' headers. Not a defect.
- [x] [Review][Dismiss] **Non-participant `?? 0` flood-trap is a forward-contract note for Story 6.1, not a 4.6 gap** [packages/data-access/src/join-cursor.integration.test.ts:331-351] — A non-participant's `roomJoinSeq` is `undefined`; `roomMessagesSince` requires `sinceSeq: number`, so 6.1's `check` MUST gate per-room on `roomJoinSeq !== undefined` and must NOT `?? 0` a non-participant (that would surface the FULL history — a flood). **Dismissed (out-of-scope; documented 6.1 contract):** Design decision 5 already specifies a non-participant is "simply not in check's room scope"; the `number` signature prevents the in-process misuse here, and every `?? 0` in the test suite is applied only to participants whose cursor is guarded `toBeDefined()` first. The QA "combined floor" preview (lines 284-352) covers the participant path in both `max` directions but does NOT exercise the non-participant-skip path — a note for Story 6.1's QA, captured in deferred-work.md so 6.1's author sees it. Not a 4.6 finding.

## Tasks / Subtasks

- [x] Task 1: Build the per-(identity, room) join-cursor projection (AC: #1, #3, #4, #5)
  - [x] In `packages/core/src/rooms/` add `roomJoinSeq(events, roomId, handle): number | undefined` (e.g. in `join-cursor.ts` or extend `participants.ts`): the `seq` of the EARLIEST event that made `handle` a participant of `roomId` = the MIN over { the `seq` of each `room.replied` by `handle` for `roomId`, the `seq` of each `room.participant_added` naming `handle` (payload `handle`) for `roomId` }. `undefined` if `handle` is not a participant of the room. Pure fold over the `seq`-ordered stream; derived, never stored. — DONE in `packages/core/src/rooms/join-cursor.ts` (`roomJoinSeq` = MIN over the handle's `room.replied` ∪ the `room.participant_added` naming them; `undefined` for a non-participant; reuses `participants.ts`'s participant-event filtering; pure, order-independent — takes the min).
  - [x] Unit-test: replier → their min-`seq` `room.replied`; added participant → the `room.participant_added` `seq`; added-then-replied → the ADD `seq` (earliest); replied-then-added → the REPLY `seq` (earliest); non-participant → `undefined`; cross-room isolation (a join in room A does not set a cursor in room B). — DONE in `packages/core/src/rooms/join-cursor.test.ts` (11 `roomJoinSeq` cases incl. all of these + multiple-replies→first, announcer-who-never-replied→undefined, unknown-room/empty→undefined, adder-vs-added distinction, order-independence).
- [x] Task 2: Provide the "new for me in this room" floor helper + prove no-flood (AC: #2)
  - [x] Add a small pure helper, e.g. `roomMessagesSince(events, roomId, sinceSeq): RoomMessage[]` = `roomMessages(events, roomId)` filtered to `seq > sinceSeq` (reuse the Story 4.4 `roomMessages`). This expresses the per-room floor `check` (6.1) applies; document that 6.1 combines it as `seq > max(perIdentityCheckCursor, roomJoinSeq)`. Do NOT build `check` or a stored cursor here (that is 6.1). — DONE: `roomMessagesSince` in `join-cursor.ts` (STRICT `seq > sinceSeq`, reuses `roomMessages`); docblock states 6.1 combines it as `seq > max(perIdentityCheckCursor, roomJoinSeq)` and that NO stored cursor / `check` is built here.
  - [x] Export `roomJoinSeq` (and `roomMessagesSince` if added) from `packages/core/src/index.ts`. Unit-test: for a room with [announcement, replyA, replyB], a participant whose `roomJoinSeq` is replyA's `seq` sees only [replyB] as "new" (announcement + replyA excluded); a participant added after replyB sees [] as new (all history is back-history); `read_room` still returns the FULL history for both (no cursor scoping on `read_room`). — DONE: both exported from `packages/core/src/index.ts`; 6 `roomMessagesSince` cases (the [announcement, replyA, replyB] floor=replyA→only [replyB]; added-after-last→[] new; strict `>` boundary; full history NOT cursor-scoped; per-room isolation).
- [x] Task 3: Real-ledger integration proof (AC: #6, Rule 1 escape clause)
  - [x] Add `packages/core/src/rooms/join-cursor.integration.test.ts` (or a data-access-level test) using the REAL `createDataAccess` SQLite ledger: build a room with existing history (announce → post → several replies), then have a new identity reply (or be added) mid-stream; assert `roomJoinSeq` over the real ledger equals their joining-event `seq` and that `roomMessagesSince(roomId, cursor)` excludes the pre-join back-history and includes only post-join messages. (No MCP tool — this is the producer; the `check` tool/consumer is Story 6.1.) — DONE: `packages/data-access/src/join-cursor.integration.test.ts` (4 cases over real `createDataAccess`, nothing mocked: join-by-reply, join-by-add, added-then-reply→earliest=add, non-participant→undefined; each asserts cursor == joining-event seq + back-history excluded + full history still available). Placed in data-access (core's lint forbids importing the SQLite adapter; data-access depends on both), mirroring `record-seen.integration.test.ts`.
  - [x] Run the full gate in honest order: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final count (Epic 4 at 449 after Story 4.5). — DONE: `pnpm run lint` 0 (`eslint .`) / `pnpm run build` 0 (7 packages, `tsc -b`) / `pnpm run typecheck` 0 / `pnpm test` **470 passed (69 files)** = 449 + 21 new (17 unit + 4 integration) / `pnpm run format` 0 ("All matched files use Prettier code style!"). NOTE: in this repo the `--check` variant IS the `format` script (`prettier --check .`); the mutating variant is `format:write` (`prettier --write .`).

## Dev Notes

This story delivers the per-(identity, room) JOIN-CURSOR — the floor that Story 6.1's `check` uses so a newly-joined/added participant is not flooded with a room's back-history. It is a CORE projection with a forward-declared consumer (Story 6.1 `check`); NO new MCP tool, NO new event type, NO new error code, NO stored cursor. It folds the existing `room.replied` + `room.participant_added` events (the same events `roomParticipants` (4.5) folds).

**Rule 1 (Integration ACs) — escape clause:** this story introduces the join-cursor PRODUCER with NO Epic-4 consumer; the first consumer is **Story 6.1 (`check`)**. AC #6 is an explicit "No consumers in this story; the first consumer will be Story 6.1" declaration, with real-ledger evidence of the producer (mirrors how Story 3.5's membership gate forward-declared its Epic 4 consumers).
**Rule 3 (real-runtime evidence):** AC #6 proves the projection over the REAL `createDataAccess` SQLite ledger (no new MCP surface to stdio-smoke; the lead smoke is a real-ledger/library exercise).
**Rule 5 / Rule 6:** N/A (no NFR work; no `docs/adr/`).

### Design decisions (grounded at story creation, baseline `6a8f9c2`)

1. **The join cursor is per-(identity, room) and DERIVED — NOT a single stored position mutated on join.** This reconciles two requirements: (a) architecture.md line 253's "Cursor is a per-identity stored position … advance to max `seq` returned" (the `check` high-water-mark) and (b) this AC's "no back-history flood on ROOM join". A SINGLE per-identity cursor advanced to `maxSeq` on every room-join would skip UNREAD deltas in the identity's OTHER rooms (a real defect). The clean model: **a per-room FLOOR (this story, derived = the join-event `seq`) combined in `check` (6.1) with the per-identity advancing high-water-mark (6.1, stored).** `check` returns, per room, messages with `seq > max(checkCursor, roomJoinSeq)`. The per-room floor prevents back-history flood; the per-identity high-water-mark prevents re-showing seen messages; neither causes the other's loss. So the architecture's stored cursor lives in 6.1; this story adds ONLY the derived per-room floor.
2. **Derived = the `seq` of the earliest participating event.** "Set to the current max `seq` on join" is satisfied because a joining event (`room.replied` / `room.participant_added`) is assigned the newest `seq` at append — so the join-event `seq` IS the ledger position at the instant of join. Deriving it (rather than storing it) keeps the ledger append-only-pure and needs no new event type or cursor table.
3. **Strict `seq > cursor`** so your OWN joining message is not re-surfaced to you as "new", while every later participant's message is (AC #3).
4. **Earliest-participating-event wins (AC #4)** so an add-then-reply (or reply-then-add) participant's floor is the moment they FIRST became a participant — nothing in between is lost.
5. **Non-participant → `undefined` (AC #5):** `check` (6.1) surfaces a room's messages ONLY to its participants; a non-participant has no floor and the room is simply not in their `check` scope (consistent with FR9 — they can still `read_room` openly, but `check` is participation-scoped).
6. **No change to `reply`/`add_participant`.** Because the cursor is derived from their already-appended events, the 4.3/4.5 ops need NO modification — this story is purely additive (a new projection).

### Source facts (verified at story creation, baseline `6a8f9c2`)

- **Events that make you a participant**: `room.replied` (actor = you, payload `{ roomId, body }`) and `room.participant_added` (payload `{ roomId, handle: you }`, actor = the adder). `roomJoinSeq` folds both — same events `roomParticipants` (`packages/core/src/rooms/participants.ts`) already folds; reuse that file's filtering logic.
- **`roomMessages`** (`packages/core/src/rooms/room-history.ts`, Story 4.4) returns the `seq`-ordered `[announcement, …replies]`; `roomMessagesSince` filters it by `seq > sinceSeq`.
- **`maxSeq()`** exists on `DataAccess` (`ports.ts:121`) but is NOT needed here — the join-event `seq` (from the folded events) is the cursor; `maxSeq` would only matter if storing a cursor (which this story does not). Mention it only to note the equivalence (join-event `seq` == `maxSeq` at the instant of that append).
- **No cursor concept exists yet** (`getCursor`/`setCursor`/a cursors table are NOT in `DataAccess` — and this story does NOT add them; the stored `check` cursor is Story 6.1's concern).
- **`check`** is Story 6.1 (Epic 6) — the consumer that combines this floor with the stored high-water-mark. This story forward-declares it (Rule 1 escape clause).
- Toolchain (Epics 1–4): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers); newly-added `core` exports visible from `src` (Story 4.0).

### Project Structure Notes

- New `packages/core/src/rooms/join-cursor.ts` (`roomJoinSeq`, optionally `roomMessagesSince`) + co-located tests; a real-ledger integration test. NO MCP tool, NO `server.ts` change, NO new event/error code. One barrel (`packages/core/src/index.ts`).
- THE APPEND INVARIANT: the cursor is DERIVED by folding existing events every call — no cursor table, no mutation, no `UPDATE`/`DELETE`; order by `seq`. `core` imports only the `DataAccess` port.

## Dev Agent Record

### Implementation Plan

Purely additive CORE projection — no MCP tool, no `server.ts` change, no new event type / error code / stored cursor, no change to `reply`/`add_participant`. Red-green-refactor per task:

1. **Task 1/2 — the projection (`packages/core/src/rooms/join-cursor.ts`):**
   - `roomJoinSeq(events, roomId, handle): number | undefined` — a pure fold returning the MIN `seq` over { `handle`'s `room.replied` for `roomId` } ∪ { the `room.participant_added` whose payload `handle` is `handle`, for `roomId` }; `undefined` if no such event (not a participant). Reuses the SAME participant-event filtering as `participants.ts` (actor of `room.replied`; payload `handle` of `room.participant_added`). Order-independent (takes the minimum, not first-seen), so it is robust to any caller passing an unsorted slice.
   - `roomMessagesSince(events, roomId, sinceSeq): RoomMessage[]` = `roomMessages(events, roomId)` (Story 4.4) filtered STRICT `seq > sinceSeq`. Docblock states Story 6.1's `check` combines this per-room floor with the stored per-identity high-water-mark as `seq > max(perIdentityCheckCursor, roomJoinSeq)`, and that NO stored cursor is added here.
   - Both exported from the `packages/core/src/index.ts` barrel.
2. **Tests:** unit (`join-cursor.test.ts`, 17 cases — every AC branch) RED-first then GREEN; real-ledger integration (`packages/data-access/src/join-cursor.integration.test.ts`, 4 cases) over `createDataAccess`.
3. **Gate** in honest order, all green.

### Completion Notes

- **AC #1 (cursor = join-event seq, DERIVED):** `roomJoinSeq` returns the `seq` of the earliest participating event — which is the newest `seq` at the instant of join (== `maxSeq()` then), satisfying "set the room cursor to current max `seq` on join" WITHOUT a stored cursor. THE APPEND INVARIANT held: no cursor table, no mutation, no `UPDATE`/`DELETE`; `core` imports only the `DataAccess` port (the projection takes only `Event[]`). Lint (the append-invariant + module-boundary rules are lint-enforced) is clean.
- **AC #2 (no back-history flood; full history on demand):** `roomMessagesSince(roomId, roomJoinSeq)` excludes the pre-join announcement + earlier replies; the integration test proves it over the real ledger (join-by-reply: only the 1 post-join message is "new"; the other 4 of 5 are excluded) — and `roomMessages` (what `read_room` renders) is NEVER cursor-scoped (still returns all 5).
- **AC #3 (strict `>`, own join not re-surfaced):** `roomMessagesSince` uses strict `seq > sinceSeq`, so the joiner's own `room.replied` (== their floor) is excluded while every later participant's message is included. Pinned in both unit and integration tests.
- **AC #4 (earliest-participating-event wins):** `roomJoinSeq` takes the MIN, so added-then-replied floors at the ADD, replied-then-added at the REPLY. Proven over the real ledger (cleo added@N then replied@M>N → floor == add seq) and in unit tests both ways.
- **AC #5 (non-participant → undefined):** a handle with no `room.replied` and no naming `room.participant_added` for the room → `undefined`; covers the announcer-who-never-replied and a registered bystander, real-ledger-proven.
- **AC #6 (Rule 1 escape clause + Rule 3 real-runtime):** `packages/data-access/src/join-cursor.integration.test.ts` exercises the projection against the REAL `createDataAccess` SQLite ledger (nothing mocked — real `register`/`announceProject`/`postAnnouncement`/`reply`/`addParticipant` drive it). NO MCP tool added; the first consumer is forward-declared as Story 6.1 (`check`). Placed in `data-access` (core's lint forbids importing the SQLite adapter; data-access depends on both), mirroring `record-seen.integration.test.ts`. Rule 3 is satisfied by the library-invocation-with-assertions evidence over the real target runtime (this story adds no user-facing MCP surface to stdio-smoke).
- **Rule 5 / Rule 6:** N/A — no NFR work (no tripwire); no `docs/adr/` (no ADR to consult).
- **Design-decision fidelity:** the cursor is per-(identity, room) and DERIVED (NOT a single per-identity stored position advanced to `maxSeq` on join — that would skip unread deltas in the identity's OTHER rooms). The architecture's stored per-identity high-water-mark remains Story 6.1's; this story adds ONLY the derived per-room floor. No deviation from the 6 Design decisions.
- **Honest gate (full, in order):** `pnpm run lint` 0 (`eslint .`) → `pnpm run build` 0 (7 packages, `tsc -b`) → `pnpm run typecheck` 0 → `pnpm test` **470 passed / 69 files** (= 449 post-4.5 baseline + 21 new: 17 unit + 4 integration; 0 failed, 0 skipped, no `.only`/`.skip`/`.todo`) → `pnpm run format` 0 ("All matched files use Prettier code style!"). NOTE: in this repo the `(--check)` variant the story's gate calls for IS the `format` script (`prettier --check .`); the MUTATING variant is `format:write` (`prettier --write .`). (`prettier --write` was used once as the remediation for the 3 new files' line-wrapping, then `pnpm run format` confirmed green — no semantic change.)
- **Toolchain note:** `python3` is not on PATH on this machine; the dev-story activation resolver was run with `py`. No effect on the deliverable.
- Left UNCOMMITTED for the lead's post-CR smoke gate (per the epic-cycle protocol — the dev stage does not commit).

### File List

New:
- `packages/core/src/rooms/join-cursor.ts` — `roomJoinSeq` + `roomMessagesSince` (the projection).
- `packages/core/src/rooms/join-cursor.test.ts` — 17 core unit tests (every AC branch).
- `packages/data-access/src/join-cursor.integration.test.ts` — 4 real-`createDataAccess` integration tests (AC #6).

Modified:
- `packages/core/src/index.ts` — barrel: export `roomJoinSeq`, `roomMessagesSince`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status backlog → in-progress → review (+ note).
- `_bmad-output/implementation-artifacts/4-6-joining-sets-the-cursor-no-back-history-flood.md` — Tasks/Subtasks checked; this Dev Agent Record; Status → review.

### Change Log

- 2026-05-31 — Implemented Story 4.6: the per-(identity, room) JOIN-CURSOR projection (`roomJoinSeq` + the `roomMessagesSince` floor helper) in `@agentbbs/core`. Pure, derived, append-invariant-clean; reuses `participants.ts` filtering + `room-history.ts` `roomMessages`. No MCP tool / event type / error code / stored cursor / change to reply/add_participant (Rule 1 escape clause — first consumer is Story 6.1 `check`). +21 tests (17 unit + 4 real-ledger integration). Full gate green: lint / build (7) / typecheck / test 470 (69 files) / format (`prettier --check .`). Status → review.
