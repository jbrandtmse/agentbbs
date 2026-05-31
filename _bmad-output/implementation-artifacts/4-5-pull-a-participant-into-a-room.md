---
baseline_commit: 4d99b1e
---

# Story 4.5: Pull a participant into a room

Status: done

## Story

As a participant,
I want to `add_participant` by handle,
So that I can bring a peer into an ongoing negotiation mid-stream.

## Acceptance Criteria

1. **Given** an active room I participate in and a target identity's (registered) handle,
   **When** I call `add_participant` with `room_id` and `handle`,
   **Then** a `room.participant_added` event ({ roomId, handle }, actor = me) is appended, the target becomes a participant of the room AND a sub-board member of the room's `projectId` if not already (a `board.joined` side effect, appended atomically), and the target can immediately `read_room` the full history (already true — `read_room` is open, FR9; the AC confirms it).

2. **Given** a `handle` that does not correspond to a registered identity,
   **When** I call `add_participant`,
   **Then** the call is rejected with `HANDLE_NOT_FOUND` and NO participant is added (nothing appended).

3. **Given** a `room_id` that does not exist,
   **When** I call `add_participant`,
   **Then** the call is rejected with `ROOM_NOT_FOUND` (nothing appended).

4. **Given** a room I do NOT participate in (I have neither replied nor been added),
   **When** I call `add_participant`,
   **Then** the call is rejected with `NOT_A_MEMBER` (room-level participation reuses `NOT_A_MEMBER` per the architecture's MCP error model — you can only pull a peer into a negotiation you are part of) and nothing is appended.

5. **Given** the target is ALREADY a participant of the room,
   **When** I call `add_participant` for them again,
   **Then** it is an idempotent no-op — NO redundant `room.participant_added` (and NO redundant `board.joined`); the target stays a single participant/member (mirror `joinBoard`'s idempotent re-join).

6. **(Integration AC — real MCP server over the real SQLite ledger.)**
   **Given** the real `McpServer` + real SQLite ledger driven by a real MCP `Client` over `InMemoryTransport`,
   **When** identity A announces a board + posts an announcement, B replies (B is now a participant + member), and B calls `add_participant` to pull in C (a registered non-member) by handle,
   **Then** C becomes a participant + a member of the board (C appears in `list_members`), C can `read_room` the full history, and a `room.participant_added` for C is in the ledger,
   **And** `add_participant` with an unregistered handle → `HANDLE_NOT_FOUND` (nothing appended),
   **And** `add_participant` to an unknown `room_id` → `ROOM_NOT_FOUND`,
   **And** a NON-participant (e.g. A, who announced but never replied, OR a bystander) calling `add_participant` → `NOT_A_MEMBER`.

## Review Findings

**Code review (2026-05-31) — APPROVED.** 0 HIGH, 0 MED, 1 LOW deferred (doc-only label drift), 1 dismissed (the `HANDLE_NOT_FOUND` additive code-add — verified correct). All 6 ACs independently re-verified; all 8 directive verification points confirmed; the honest gate was re-run by the reviewer and is green: lint clean → build 7/7 → typecheck clean → test **449 passed (67 files)** → format `--check` clean. No code changes were required by the reviewer; the working tree is exactly the dev/QA changeset.

_(Count note: the dev's gate reported 448/66 because it ran before QA added the forked race file; with `add-participant-race.test.ts` the measured suite is 449 passed / 67 files.)_

### DISMISSED

- **`HANDLE_NOT_FOUND` additive error-code addition — VERIFIED CORRECT, not a defect.** The one acknowledged deviation (the story's Source-fact "already exists at `errors.ts:29`" was a false premise — the closed set at baseline had HANDLE_TAKEN, LOGIN_UNKNOWN, PROJECT_EXISTS, NOT_A_MEMBER, ROOM_NOT_FOUND, BOARD_NOT_FOUND, BODY_TOO_LARGE, NO_IDENTITY, with no HANDLE_NOT_FOUND; line 29 is BOARD_NOT_FOUND's doc). The dev's additive fix is correct on all four axes:
  - **(a) Additive:** `HANDLE_NOT_FOUND` is appended LAST in `BOARD_ERROR_CODES` (`errors.ts:60`); every pre-existing code keeps its position — no reorder/rename. This is exactly the non-breaking operation the `errors.ts` header sanctions ("adding a code is additive; renaming/removing is breaking").
  - **(b) Generic routing:** `error-map.ts` `mapErrorToResult` routes ANY `BoardError` via `{ code: error.code, message }`, and `ErrorPayload.code` is `BoardErrorCode | INTERNAL_ERROR` (auto-includes the new code). So it surfaces as `{ code: "HANDLE_NOT_FOUND", message }` with NO client/error-map change — confirmed by the integration test (`readErrorPayload(...).toMatchObject({ code: 'HANDLE_NOT_FOUND' })`).
  - **(c) In sync:** `BoardErrorCode = (typeof BOARD_ERROR_CODES)[number]` derives the union from the runtime tuple — they cannot drift; `errors.test.ts` asserts membership + no-duplicates.
  - **(d) Distinct from `NOT_A_MEMBER`:** AC #2/#6 use HANDLE_NOT_FOUND for an unregistered TARGET handle; NOT_A_MEMBER is the actor-not-a-participant case (gate order: room → participation → target). Both are proven distinctly in the core op tests and the integration test.

### LOW

- **LOW-1 [DEFERRED — doc-only]** — "12th/final V1 tool" label drift. The story, the `server.ts` doc comment, the bootstrap comment, and sprint-status call `add_participant` the "12th" tool, but it is the **13th** distinct registered tool (register, login, update_focus, announce_project, list_projects, join_board, list_members, post_announcement, list_announcements, list_rooms, reply, read_room, add_participant). The "12" traces to the PRD/architecture §7 canonical surface — which also lists not-yet-built `react`+`check` and omits `list_members` — an approximate planning count, not the registered count. The actual correctness gate (the **exhaustive** sorted tool-list assertion in `server.bootstrap.test.ts`) lists all 13 real tools + the 2 representatives and is green, so the discovery surface is correct. Cosmetic only; no code impact. (Prior Story 4.4 CR already dismissed the symmetric "11th tool" off-by-one.) Logged in `deferred-work.md`.

### NOTE — a corrected reviewer mis-step (transparency)

During the review a transient tool-result corruption (a fabricated `Read` of `append.ts` showing a `.immediate()` body that does not exist in the tree, alongside a batch of cancelled commands) briefly led the reviewer to believe the QA forked race was RED and that the shared `append` seam had a DEFERRED-vs-IMMEDIATE write-lock deadlock. This was **investigated and disproven** against authoritative state: `git show b337c9b:packages/data-access/src/append.ts` and a working-tree diff confirm `append`/`appendGuarded` use plain `db.transaction(...)` (DEFERRED) as committed, UNCHANGED by 4.5; and `add-participant-race.test.ts` passes **deterministically (4/4 fresh runs, ~6s each, genuinely forking 8 OS processes)**, with the full suite green at 449/67. There is **no concurrency defect**, and the reviewer made **no code change** to `append.ts`/`connection.ts`. Recorded here so the (incorrect) intermediate reasoning does not resurface as a phantom finding.

### Verification points re-confirmed (directive)

1. **Append invariant + module boundary (lint-clean):** `room.participant_added` + conditional `board.joined` appended, never mutated; participation/membership DERIVED (`roomParticipants` folds `room.replied` actors ∪ `room.participant_added` handles; `findProject.members`); ordered by `seq`; `core/rooms/add-participant.ts` imports only `../ports.js` (DataAccess port), `../errors.js`, and sibling projections — NO `@agentbbs/data-access` import (the "data-access" string hits are comments). PLAIN `append` (the core-test fake throws if `appendGuarded` is touched).
2. **AC #1 target auto-join, atomic, correct actor attribution:** ONE `append([{ room.participant_added, actor=ADDER, payload.handle=TARGET }, { board.joined, actor=TARGET }])` — the participant_added's actor is the adder, the board.joined's actor is the pulled-in target. Atomicity = the single `append` array. Conditional: board.joined is omitted iff the target is already a member (core test "target already a member → participant_added but NO board.joined", maxSeq == before+1).
3. **AC #4 adder gate = room PARTICIPATION, not board membership:** `isParticipant(events, roomId, actor)` → `NOT_A_MEMBER`; the announcer-who-never-replied (a board member but not a participant) is rejected. Proven in both the core op tests (ada-announcer → NOT_A_MEMBER) and the integration test (announcer + bystander → NOT_A_MEMBER).
4. **AC #5 idempotent re-add + AC #2/#3 pre-append checks:** target already a participant → no-op, nothing appended (maxSeq unchanged; still exactly 1 participant_added / 1 board.joined). HANDLE_NOT_FOUND / ROOM_NOT_FOUND throw with maxSeq == before and 0 participant_added. Gate order room → participation → target proven (unknown room + unknown handle → ROOM_NOT_FOUND).
5. **AC #4 concurrency (QA forked race) — GENUINE and GREEN:** N=8 real OS processes (`child_process.fork` of the BUILT `dist/add-participant-race-worker.js`, IPC start barrier) each add the SAME target. The worker resolves `@agentbbs/core` via the package `exports` → `dist` (adapter→port direction, lint-allowed) with a build-if-stale `beforeAll` (`tsc -b --force`). It regresses: every participant_added lands (unique, strictly-increasing seqs, zero lost writes), no error, and the projections collapse the target to EXACTLY ONE participant AND EXACTLY ONE board member. Passes 4/4 fresh runs (deterministic, ~6s — genuinely running, not a no-op).
6. **AC #6 integration — GENUINE (Rule 1 + Rule 3):** real `Client` ↔ `createBoardServer` `McpServer` over `InMemoryTransport` + real `createDataAccess` (better-sqlite3) against a temp-dir SQLite file; nothing mocked. B (replier/participant) pulls C (registered non-member) → C in `list_members` (`['ada','bob','cleo']`) + C `read_room`s the full history (`[announcement, reply]`) + ledger participant_added(actor=bob)/board.joined(actor=cleo); HANDLE_NOT_FOUND; ROOM_NOT_FOUND; non-participant announcer → NOT_A_MEMBER; bystander → NOT_A_MEMBER; idempotent re-add; NO_IDENTITY; discovery-surface snake_case params.
7. **`room.participant_added` does NOT activate a proto-room:** `foldRooms` flips `active` only on `room.replied`; `room.participant_added` falls to `default: break` (ignored). Moot in practice (the gate implies a reply already exists) but correctly handled by the projection.
8. **Full gate (honest order) green:** lint → build 7/7 → typecheck → test **449 passed (67 files)** → format `--check` clean. The bootstrap exhaustive tool-list assertion includes `add_participant`. No `.skip`/`.only`/`.todo` in the new files.

## Tasks / Subtasks

- [x] Task 1: Build the room-participants projection (AC: #1, #4, #5)
  - [x] In `packages/core/src/rooms/` add `roomParticipants(events, roomId): string[]` (e.g. in `participants.ts` or extend `projection.ts`): the set of participant handles for a room = the actors of `room.replied` for that `roomId` UNION the `handle`s of `room.participant_added` for that `roomId`, de-duplicated, in first-seen (`seq`) order. (The announcer is NOT a participant unless they replied — participation = posted-in or pulled-in.) Pure fold. Also export an `isParticipant(events, roomId, handle)` convenience (or compute from the array). — DONE: new `packages/core/src/rooms/participants.ts` (`roomParticipants` via an insertion-ordered `Set`; `isParticipant` = `.includes`). Pure fold, derived, `core` imports only `Event`.
  - [x] Unit-test: repliers are participants; added handles are participants; the announcer who never replied is NOT; de-dup (a handle that replied and was also added appears once); ordering by `seq`; unknown room → empty. — DONE: `participants.test.ts` (11 tests, incl. cross-room isolation + announcer-becomes-participant-on-reply).
- [x] Task 2: Implement the `addParticipant` core op (AC: #1–#5)
  - [x] Create `packages/core/src/rooms/add-participant.ts` exporting `addParticipant(dataAccess, actor, input)` where `input: { roomId, handle }`. Steps: (1) `events = eventsSince(0)`; (2) `room = findRoom(events, roomId)` → throw `BoardError('ROOM_NOT_FOUND')` if absent (AC #3, nothing appended); (3) gate: `actor` must be in `roomParticipants(events, roomId)` → else throw `BoardError('NOT_A_MEMBER')` (AC #4); (4) canonicalize the target `handle` (lowercase — the canonical form, consistent with register/login) and resolve `findIdentity(events, handle)` → throw `BoardError('HANDLE_NOT_FOUND')` if undefined (AC #2, nothing appended); (5) idempotency: if the target is ALREADY a participant of the room → return unchanged, NO append (AC #5); (6) else build the append list: ALWAYS `{ type: 'room.participant_added', actor, payload: { roomId, handle: <canonical target> } }`, PLUS `{ type: 'board.joined', actor: <canonical target>, payload: { projectId } }` IFF the target is not already a member of the room's `projectId` (the target joins the board — mirror the reply auto-join; note the `board.joined` actor is the TARGET, not the adder); `await dataAccess.append(list)` (PLAIN append, ONE transaction — participation is not uniqueness-constrained; the members/participants projections de-dup a benign race); (7) read back and return the room + participants (fail loud if the room vanished). — DONE: `add-participant.ts`, exact gate ordering room→participation→target→idempotency→append. Returns `AddParticipantResult { room, participants }`.
  - [x] Reuse `findRoom` (rooms projection), `roomParticipants` (Task 1), `findIdentity` (`identity/projection.js`, canonical-handle existence), `findProject`/`isMember` (`projects/`). `core` imports only the `DataAccess` port. `actor` is a param. — DONE: all reused; PLAIN `append` (not `appendGuarded`); session-agnostic `actor` param.
  - [x] Export `addParticipant`, `AddParticipantInput`, `roomParticipants`, `isParticipant` from `packages/core/src/index.ts`. Unit-test every AC branch (happy path appends participant_added + target board.joined; HANDLE_NOT_FOUND; ROOM_NOT_FOUND; non-participant actor → NOT_A_MEMBER; already-participant target → idempotent no-op; target already a member → participant_added but NO second board.joined). — DONE: barrel exports `roomParticipants`, `isParticipant`, `addParticipant`, `AddParticipantInput`, `AddParticipantResult`. `add-participant.test.ts` (13 tests) covers every branch + room-checked-before-target + added-peer-can-add + handle canonicalization.
- [x] Task 3: Wire the `add_participant` MCP tool (AC: #1, #2, #3, #4, #6)
  - [x] Create `packages/mcp-server/src/tools/add-participant.ts` mirroring `tools/reply.ts`: a Zod input schema `{ room_id: roomIdSchema, handle: <handle schema> }` (reuse the handle schema the `register`/`login` tools use — non-empty, handle charset; canonicalization happens in core), the session `NO_IDENTITY` gate, delegate to `core.addParticipant(dataAccess, actor, { roomId, handle })`, map errors via `error-map.ts` (`ROOM_NOT_FOUND`, `NOT_A_MEMBER`, `HANDLE_NOT_FOUND`, `NO_IDENTITY` — ALL already in the closed set; NO new code), return an envelope (e.g. `{ room, participants }` via `roomToWire` + the participant handle list, or `{ room }` — pick the shape consistent with the other room tools; document it). — DONE: `add-participant.ts` reuses `roomIdSchema` (room-shared) + `handleSchema` (identity-shared); `NO_IDENTITY` gate; envelope `{ room, participants }` (consistent with `read_room`'s `{ room, messages }`). DEVIATION: `HANDLE_NOT_FOUND` was NOT pre-existing — added to the closed set in `core/errors.ts` additively (see Completion Notes / Decisions). Errors route through `register-tool.ts` → `error-map.ts` (no per-code branching).
  - [x] Register `add_participant` in `packages/mcp-server/src/server.ts` and extend the exhaustive tool-list assertion in `server.bootstrap.test.ts` (this is the 12th tool). — DONE: registered last; bootstrap exhaustive sorted list now includes `add_participant` (15 names incl. alpha/beta representatives).
- [x] Task 4: Tests + full gate (AC: all)
  - [x] Add `packages/mcp-server/src/tools/add-participant.integration.test.ts`: real `Client`↔`McpServer` over `InMemoryTransport` + real SQLite proving AC #6 (B pulls in C → C is a member (`list_members`) + can `read_room`; `HANDLE_NOT_FOUND`; `ROOM_NOT_FOUND`; non-participant → `NOT_A_MEMBER`; idempotent re-add). Plus core unit tests for the projection + the op branches. — DONE: `add-participant.integration.test.ts` (8 tests): B→C member+read_room+ledger participant_added/board.joined; HANDLE_NOT_FOUND; ROOM_NOT_FOUND; non-participant announcer → NOT_A_MEMBER; bystander → NOT_A_MEMBER; idempotent re-add; NO_IDENTITY; discovery-surface params. Nothing mocked (real `createDataAccess`).
  - [x] Run the full gate in honest order: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final count (Epic 4 at 425 after Story 4.4). — DONE: lint clean → build 7/7 → typecheck clean → test **448 passed (66 files)** → format `--check` clean. +32 net-new tests (11 projection + 13 core op + 8 integration; the `errors.test.ts` new code rode an existing `toContain` loop, no new `it`).

## Dev Notes

This story adds the `add_participant` tool — pulling a registered peer into a room mid-negotiation. It is the OTHER "acting = joining" consumer (alongside `reply` 4.3): adding a participant makes the TARGET a sub-board member if not already. It introduces the room-participants projection (consumed by this story's gate AND by Story 4.6's join-cursor). `add_participant` is the 12th (final V1) MCP tool.

**Rule 1 (Integration ACs):** AC #6 is the real-runtime Integration AC (the `add_participant` tool over real MCP + real SQLite, proving the target becomes a participant+member and can read, plus all three error paths).
**Rule 3 (real-runtime evidence):** `add_participant` ships with the real `Client`↔`McpServer`↔SQLite test.
**Rule 5 / Rule 6:** N/A (no NFR work; no `docs/adr/`).

### Design decisions (grounded at story creation, baseline `4d99b1e`)

1. **The actor must be a room PARTICIPANT — surfaced as `NOT_A_MEMBER`.** The closed error set's comment (`errors.ts`) states "room-level participation reuses `NOT_A_MEMBER` per architecture §MCP error model." A participant = someone who replied or was added (NOT the announcer-who-never-replied). So a proto-room has no participants and no one can `add_participant` to it (the gate naturally enforces "active room I participate in" without a separate proto check).
2. **Target unknown → `HANDLE_NOT_FOUND`** (already in the closed set, explicitly "Epic 4 add_participant — target handle unknown"). Resolve via `findIdentity` (canonical/lowercased handle). No new error code (all four codes — ROOM_NOT_FOUND, NOT_A_MEMBER, HANDLE_NOT_FOUND, NO_IDENTITY — pre-exist).
3. **The target joins the board (`board.joined`), the adder does not change.** `add_participant` appends `room.participant_added` (actor = the adder, handle = the target) PLUS, if the target is not already a member, a `board.joined` whose ACTOR is the TARGET (the target gains membership — mirror `reply`'s auto-join, but for the pulled-in peer). Both atomic. Participation itself is derived from `room.participant_added` + `room.replied` (no separate participant event for the adder).
4. **Idempotent re-add (mirror `joinBoard`).** If the target is already a participant, it is a no-op — no redundant `room.participant_added`/`board.joined`. A benign concurrent double-add is deduped by the participants/members projections (plain append, no guard needed).
5. **Participation is DERIVED, never stored.** `roomParticipants` folds `room.replied` actors ∪ `room.participant_added` handles every call. No participants table/column. This projection is also Story 4.6's input (the join-cursor is set for a newly-added/newly-replying participant).
6. **`add_participant` does NOT activate a proto-room.** Activation is ≥1 `room.replied` (4.2); `room.participant_added` does not activate. Since the gate requires the actor to be a participant (⇒ a reply exists ⇒ the room is already active), this is moot in practice but kept clean: the activation projection ignores `room.participant_added`.

### Source facts (verified at story creation, baseline `4d99b1e`)

- **`room.participant_added` payload** (`payloads.ts`): `{ roomId, handle }` (at rest `{ room_id, handle }`) — already in the vocabulary + wire mapping. `handle` is the ADDED identity (distinct from the event `actor`, who is the adder). No payload change.
- **Error codes**: `HANDLE_NOT_FOUND` (`errors.ts:29`, for this exact case) + `NOT_A_MEMBER` + `ROOM_NOT_FOUND` + `NO_IDENTITY` all pre-exist in `BOARD_ERROR_CODES`. NO new code.
- **`findIdentity`** (`packages/core/src/identity/projection.js`, exported from the core barrel line 60) resolves an identity by handle, `undefined` if unregistered — the target-existence check. Canonicalize the handle (lowercase) before lookup, consistent with `register`/`login`.
- **Rooms projection** (`packages/core/src/rooms/projection.ts`): `findRoom`/`foldRooms`; `Room.projectId` is the board scope (for the target's `board.joined`). The participants projection is NEW (folds `room.replied` + `room.participant_added`).
- **`reply`** (`packages/core/src/rooms/reply.ts`) is the template for the conditional-`board.joined` auto-join (here applied to the TARGET) + the plain-append pattern. `joinBoard` is the idempotent-skip template.
- **`isMember`/`findProject`** (`projects/`) — the target's board-membership check for the conditional `board.joined`.
- **Tool pattern**: `tools/reply.ts` (write tool with session gate + error-map). The handle schema is in the `register`/`login` tools (reuse it). Tool registration in `server.ts`; exhaustive tool-list assertion in `server.bootstrap.test.ts` — `add_participant` is the 12th tool.
- Toolchain (Epics 1–4): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers); newly-added `core` exports visible from `src` (Story 4.0).

### Project Structure Notes

- New `packages/core/src/rooms/add-participant.ts` + the participants projection (`participants.ts` or extend `projection.ts`) (+ tests); new `packages/mcp-server/src/tools/add-participant.ts` (+ integration test); register in `server.ts`. One barrel (`packages/core/src/index.ts`).
- THE APPEND INVARIANT: `room.participant_added` + conditional `board.joined` appended (never mutated); participation/membership DERIVED by query; order by `seq`; `core` imports only the `DataAccess` port (no data-access error class — plain append, no guard needed).

## Dev Agent Record

### Context Reference

- Dev stage run under `/epic-cycle` Epic 4. Implemented against baseline `4d99b1e` (preserved in the frontmatter). Toolchain verified live: Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (used `py` for the customization resolver).

### Implementation Plan (as executed, red-green-refactor per task)

1. **Task 1 — room-participants projection.** New `packages/core/src/rooms/participants.ts`: `roomParticipants(events, roomId)` folds `room.replied` actors ∪ `room.participant_added` payload `handle`s for the room into an insertion-ordered `Set` (de-dup + first-seen `seq` order), returned as `string[]`. `isParticipant` = `roomParticipants(...).includes(handle)`. Pure fold; the announcer is excluded unless they replied. RED (`participants.test.ts`, module-missing) → GREEN (11 tests).
2. **Task 2 — `addParticipant` core op.** New `packages/core/src/rooms/add-participant.ts`. Gate order: (1) `findRoom` → `ROOM_NOT_FOUND`; (2) `isParticipant(actor)` → `NOT_A_MEMBER`; (3) canonicalize target (`.toLowerCase()`) + `findIdentity` → `HANDLE_NOT_FOUND`; (4) idempotent no-op if target already a participant; (5) PLAIN `append` `room.participant_added` (actor = adder, payload.handle = canonical target) + a conditional `board.joined` (actor = TARGET) iff the target is not already a member; (6) read-back `{ room, participants }` (`AddParticipantResult`). Barrel exports added. RED (`add-participant.test.ts`) → GREEN (13 tests, every AC branch).
3. **Task 3 — `add_participant` MCP tool.** New `packages/mcp-server/src/tools/add-participant.ts` mirroring `reply.ts`/`read-room.ts`: schema `{ room_id: roomIdSchema, handle: handleSchema }` (reused), `NO_IDENTITY` session gate, delegate to `core.addParticipant`, envelope `{ room, participants }` (consistent with `read_room`). Registered last in `server.ts` (12th/final V1 tool); `server.bootstrap.test.ts` exhaustive list updated. GREEN (bootstrap 6/6).
4. **Task 4 — integration AC #6 + gate.** New `add-participant.integration.test.ts` (8 tests, real `Client`↔`McpServer`↔SQLite, nothing mocked). Full gate green (see Completion Notes).

### Completion Notes

- **All 6 ACs satisfied.** AC #1 (participant_added + conditional target board.joined, atomic, target now participant+member, can read_room); AC #2 (`HANDLE_NOT_FOUND`, nothing appended); AC #3 (`ROOM_NOT_FOUND`, nothing appended); AC #4 (non-participant actor → `NOT_A_MEMBER`, nothing appended); AC #5 (idempotent re-add no-op); AC #6 (the real-runtime integration test, all branches).
- **THE APPEND INVARIANT honored:** `room.participant_added` + conditional `board.joined` are appended, never mutated; participation + membership are DERIVED by query (`roomParticipants` / `findProject.members`), no store; ordered by `seq`; `core` imports only the `DataAccess` port (lint-clean). PLAIN `append` (not `appendGuarded`) — participation is not uniqueness-constrained; a benign concurrent double-add is de-duped by the projections (mirrors `reply`/`joinBoard`).
- **DEVIATION — `HANDLE_NOT_FOUND` was added to the closed error set (additive); the story's "NO new error code" instruction rested on a false premise.** The story's Source facts (line 85) and Design decision 2 assert `HANDLE_NOT_FOUND` "already exists at `errors.ts:29`, NO new code". This is factually wrong: at baseline `4d99b1e` the closed set (`core/errors.ts`) was `HANDLE_TAKEN, LOGIN_UNKNOWN, PROJECT_EXISTS, NOT_A_MEMBER, ROOM_NOT_FOUND, BOARD_NOT_FOUND, BODY_TOO_LARGE, NO_IDENTITY` — there was **no** `HANDLE_NOT_FOUND` (and `errors.ts:29` is the doc comment for `BOARD_NOT_FOUND`). A repo-wide grep confirmed `HANDLE_NOT_FOUND` appeared **only** in the story file. AC #2 and AC #6 nonetheless NAME this exact code for the target-unknown case, distinct from `NOT_A_MEMBER` (the actor-not-a-participant case). Resolution: ADD `HANDLE_NOT_FOUND` to `BOARD_ERROR_CODES` — the additive, non-breaking, contract-sanctioned operation the architecture explicitly allows ("adding a code is additive; renaming/removing is breaking"). This is the smallest change that satisfies the AC as written; overloading an existing code (e.g. `NOT_A_MEMBER`/`LOGIN_UNKNOWN`) would contradict the AC text and conflate two distinct failures. The mapper (`error-map.ts`) routes any `BoardError.code` generically, so no client-side change was needed beyond the set + its contract test. `errors.test.ts` extended with a `toContain('HANDLE_NOT_FOUND')` assertion (additive-code precedent, mirroring the 2.4/3.3 comments). This is surfaced for the lead/code-review per the task's "do not deviate without surfacing".
- **Envelope decision:** `{ room, participants }` (room via `roomToWire`; `participants` is the derived handle list). Consistent with `read_room`'s `{ room, messages }` and `reply`'s `{ room }` — the room tools use a `room`-keyed object envelope.
- **No new event type:** `room.participant_added` (payload `{ roomId, handle }`) and its wire mapping pre-existed in the vocabulary/`data-access` — confirmed end-to-end (`mapping.ts` handles `roomId↔room_id`). No payload change.
- **Full gate (honest order, all green):** `pnpm run lint` (clean) → `pnpm run build` (7/7 packages) → `pnpm run typecheck` (clean) → `pnpm test` (**448 passed, 66 files**) → `pnpm run format --check` (clean). Net-new tests: +32 (11 projection + 13 core op + 8 integration). Prettier reformatted the four new files during the gate (whitespace only; re-ran lint + affected tests green after).
- **Rule 5 (NFR tripwire):** N/A — no NFR work. **Rule 6 (ADRs):** N/A — no `docs/adr/`.
- Left UNCOMMITTED for the lead's post-CR smoke gate (per the stage directive). `dist/` is git-ignored — not committed.

### File List

**New (source):**
- `packages/core/src/rooms/participants.ts`
- `packages/core/src/rooms/add-participant.ts`
- `packages/mcp-server/src/tools/add-participant.ts`

**New (tests):**
- `packages/core/src/rooms/participants.test.ts`
- `packages/core/src/rooms/add-participant.test.ts`
- `packages/mcp-server/src/tools/add-participant.integration.test.ts`

**Modified:**
- `packages/core/src/errors.ts` (added `HANDLE_NOT_FOUND` to the closed set — additive; see Completion Notes)
- `packages/core/src/errors.test.ts` (assert `HANDLE_NOT_FOUND` is in the closed set)
- `packages/core/src/index.ts` (barrel exports: `roomParticipants`, `isParticipant`, `addParticipant`, `AddParticipantInput`, `AddParticipantResult`)
- `packages/mcp-server/src/server.ts` (register `add_participant` — the 12th/final V1 tool + doc comment)
- `packages/mcp-server/src/server.bootstrap.test.ts` (exhaustive tool-list assertion now includes `add_participant`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (`4-5-...` → in-progress → review)

### Change Log

- 2026-05-31 — Story 4.5 dev complete. Added the `add_participant` MCP tool (12th/final V1 tool) + the `addParticipant` core op + the room-participants projection (`roomParticipants`/`isParticipant`). A participant pulls a registered peer into a room: the target becomes a participant + a sub-board member (a `board.joined` whose actor is the TARGET, atomic with `room.participant_added`); idempotent re-add; `NOT_A_MEMBER`/`ROOM_NOT_FOUND`/`HANDLE_NOT_FOUND`/`NO_IDENTITY` paths. Added `HANDLE_NOT_FOUND` to the closed error set (additive — the story's "already exists" Source fact was incorrect; see Dev Agent Record). Gate green: lint / build 7-7 / typecheck / test 448 (66 files) / format --check. +32 tests. Status → review.
