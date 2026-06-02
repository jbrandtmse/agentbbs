---
baseline_commit: 0f9f9ab
---

# Story 4.4: Read a room's full ordered history

Status: done

## Story

As any identity,
I want to `read_room`,
So that I can read a room's complete, ordered history — including before I join.

## Acceptance Criteria

1. **Given** an activated room,
   **When** I call `read_room` with `room_id`,
   **Then** I receive the room's COMPLETE history ordered by `seq`, STARTING with the seeding announcement as message #1 (the `announcement.posted` body/subject), followed by every `room.replied` in `seq` order,
   **And** the room metadata (`roomId`, `projectId`, `subject`, `active`, the derived activator) accompanies the message list.

2. **Given** any registered identity,
   **When** I call `read_room` WITHOUT being a member or participant of the room,
   **Then** the read SUCCEEDS (board-wide open read, FR9 — read is never gated on membership; the only precondition is an established identity → `NO_IDENTITY` if none).

3. **Given** a `room_id` that does not exist,
   **When** I call `read_room`,
   **Then** the call is rejected with `ROOM_NOT_FOUND`.

4. **Given** the append-only model,
   **When** I read a room at any later time (after more replies),
   **Then** NO historical message has been truncated or deleted — the history is monotonically growing; an earlier `read_room`'s messages are all still present (by `seq`) in a later `read_room`, in the same order, with the same bodies (verbatim).

5. **Given** a PROTO-room (an announcement with no replies yet),
   **When** I call `read_room`,
   **Then** I receive a history of exactly one message — the seeding announcement (message #1) — and the room metadata shows `active = false` (a proto-room is still readable; FR9).

6. **(Integration AC — real MCP server over the real SQLite ledger.)**
   **Given** the real `McpServer` + real SQLite ledger driven by a real MCP `Client` over `InMemoryTransport`,
   **When** an agent announces a board, posts an announcement, two identities reply, and a THIRD identity (non-member, never replied) calls `read_room`,
   **Then** the third identity receives `[announcement (#1), reply, reply]` in `seq` order with byte-identical bodies (open read works without membership),
   **And** `read_room` on an unknown `room_id` is rejected with `ROOM_NOT_FOUND`,
   **And** reading the same room again after an additional reply returns the SAME earlier messages plus the new one appended at the end (no truncation — AC #4).

## Review Findings

**Code review (2026-05-31, `bmad-code-review` under `/epic-cycle`) — APPROVED.** 0 HIGH / 0 MED / 0 decision-needed / 0 defer-to-backlog; 1 LOW auto-resolved inline (test-count drift in the tracking docs, corrected below); 1 dismissed as noise. All 6 ACs + all 9 directive verifications independently re-confirmed. Honest gate re-run green by the reviewer: `lint` ✓ → `build` ✓ (7/7) → `typecheck` ✓ → `test` ✓ → `format` (`--check`) ✓.

### Independent verification (all 9 directive items + the 3 adversarial layers)

1. **Append invariant + module boundary (lint-enforced):** CONFIRMED read-only — `readRoom`/`roomMessages` append nothing; the history is a pure fold every call (no `messages`/`history` table); ordered by `seq` (`messages.sort((a,b) => a.seq - b.seq)`), never `created_at` (grep-clean: every `createdAt`/`UPDATE`/`DELETE` token in the two new core files is in a comment). `core` imports only the `DataAccess` port — `read-room.ts` imports `findRoom`/`roomMessages`/`BoardError` + `type { DataAccess }` from `../ports.js`; the ESLint `core` block (rule 4) bans `@agentbbs/data-access` + `better-sqlite3` and the suite is green.
2. **AC #1/#5 — history shape:** CONFIRMED. Message #1 = the `announcement.posted` (`body` = announcement body, `kind='announcement'`), then `room.replied`(s) by `seq` (`kind='reply'`). Each `RoomMessage.seq === event.seq` (Epic 5 `message.reacted.messageSeq` alignment) — pinned at the projection/op layer AND over the real surface incl. a NON-activator reply #3 (integration test "each message's seq equals its underlying event seq"). Proto-room → exactly one announcement message + `active=false` (op + integration). `subject` is room metadata only — it is NOT a field of `MessageWire` (verified). [Note: the announcement BODY does appear on both `RoomWire.body` (room metadata) and message #1's `body` — this is by Design decision 3 (the `Room` record carries `body`; message #1's body IS the announcement body) and is consistent with `list_rooms`'s `RoomWire.body`; intentional, not a duplication defect.]
3. **AC #2 — open read (FR9):** CONFIRMED. The tool's only precondition is `session.handle === null → NO_IDENTITY`; there is NO membership call (grep for `isMember`/`requireMembership`/`NOT_A_MEMBER`/`join_board` in `read-room.ts` returns only the "NO membership" doc comments). The integration test's reader `dan`/`gil`/`cleo` never join the board and never reply, yet read succeeds.
4. **AC #3 — ROOM_NOT_FOUND:** CONFIRMED. `readRoom` resolves via `findRoom` and throws `BoardError('ROOM_NOT_FOUND')` for an absent room; `ROOM_NOT_FOUND` is already in `BOARD_ERROR_CODES`; routed through `error-map.ts` (preserves the closed `code`). Proven at the op layer (incl. empty ledger) AND over the real surface.
5. **AC #4 — no truncation:** CONFIRMED genuine. The integration re-read test holds ONE real `createDataAccess` handle for the whole test (created in `beforeEach`); a later reply lands on that same real ledger and the re-read `slice(0, first.length)` equals the earlier messages verbatim + the new one appended. This is a real append-only-store superset proof, not a fresh DB.
6. **NFR6 verbatim:** CONFIRMED. The hostile-body integration test round-trips a markdown/control-char/CJK/RTL/ZWJ-emoji announcement body and a tab/quote/emoji reply byte-identically (`toBe` + `.length`) through register → post/reply → real SQLite → `read_room`. The board never parses/transforms content (no transform on any path; bodies pass through `messageToWire` unchanged).
7. **Interleaving:** CONFIRMED. The integration test "read_room(A) returns ONLY room A's messages … when replies to A and B are interleaved on one real ledger" weaves A/B replies (A,B,A,B,A) on the real seq allocator and asserts each room's history is strictly seq-ordered, disjoint by seq, and free of the other room's bodies. The per-room filter + seq-sort is correct.
8. **No new error code / event type:** CONFIRMED. No new `BOARD_ERROR_CODES` member; no new `EVENT_TYPES` member; the history folds the existing `announcement.posted` + `room.replied`. The bootstrap exhaustive tool-list assertion (`server.bootstrap.test.ts`) lists all 14 names (12 real tools incl. `read_room` + the alpha/beta representatives) and passes — `read_room` is the 12th real tool registered in `server.ts`.
9. **Full gate (honest order):** CONFIRMED green: `lint` ✓ · `build` ✓ (7/7) · `typecheck` ✓ · `test` ✓ · `format` ✓.

**Adversarial layers:** Blind Hunter — 0 correctness findings (the `readRoom` double-pass over the stream — `findRoom`→`foldRooms`, then `roomMessages` — is the intentional Design-decision-5 V1 read cost, not a bug). Edge Case Hunter — 0 unhandled edges (empty stream → ROOM_NOT_FOUND; orphan-reply room → ROOM_NOT_FOUND via `findRoom` gate even though `roomMessages` would surface the reply; duplicate-announcement unreachable via the `room_id` `appendGuarded` global-uniqueness guard, so never two `kind='announcement'`; oversize body capped at the write boundary, read returns verbatim). Acceptance Auditor — all 6 ACs satisfied with genuine real-runtime evidence (Rule 1 + Rule 3). Rule 5 / Rule 6 N/A (no NFR amendment; no `docs/adr/`).

### Findings

- [x] [Review][Patch] Test-count drift in the tracking docs — AUTO-RESOLVED inline. The story body / Completion Notes / Change Log / sprint-status note stated **+22 tests / 416 total** and "7 integration tests"; the measured truth is **+24 tests / 418 total / 63 files** (room-history 9 + read-room op 6 + read-room.integration **9** — the integration file gained 2 QA-addition tests, "interleaved A/B isolation" and "each message's seq == its event seq", after the +7 figure was written). Corrected the counts in this file's Task 4 line, Completion Notes, Change Log, and the sprint-status note. Code unaffected — purely a stale-count correction. [_bmad-output/implementation-artifacts/4-4-…md + sprint-status.yaml]
- Dismissed (noise): the "11th tool" phrasing in the review directive is an off-by-one — the registered surface is 12 real tools (`read_room` is the 12th). The bootstrap exhaustive assertion is genuinely exhaustive (all 14 names) and updated/green; no code action.

## Tasks / Subtasks

- [x] Task 1: Build the room message-history projection (AC: #1, #4, #5)
  - [x] In `packages/core/src/rooms/` add a `roomMessages(events, roomId)` (e.g. in a new `room-history.ts` or extend `projection.ts`) returning the ordered message list for a room. Message #1 = the room's `announcement.posted` (`{ seq, actor: postedBy, body, kind: 'announcement' }`); then every `room.replied` for that `roomId` (`{ seq, actor, body, kind: 'reply' }`); all sorted ascending by `seq` (the announcement is naturally the lowest `seq`). Define a `RoomMessage` type. Pure fold; no I/O; derive from the `seq`-ordered stream (the announcement subject is room metadata, returned via the `Room` record — not duplicated per message; message #1's `body` is the announcement body). [DONE — `packages/core/src/rooms/room-history.ts`: `roomMessages` + `RoomMessage`/`RoomMessageKind`; pure fold, sorts by `seq` explicitly (correct even on an unsorted input).]
  - [x] Unit-test: a proto-room → exactly one message (the announcement, `kind='announcement'`); after replies → `[announcement, reply, reply]` by `seq`; bodies verbatim; an unknown `roomId` → empty list (the op layer turns "no room" into `ROOM_NOT_FOUND`, see Task 2); cross-room isolation (only this room's messages). [DONE — `room-history.test.ts`, 9 tests incl. unsorted-input ordering + no-truncation-under-growth + non-room-events-ignored.]
- [x] Task 2: Implement the `readRoom` core op (AC: #1, #2, #3, #5)
  - [x] Create `packages/core/src/rooms/read-room.ts` exporting `readRoom(dataAccess, roomId)`: `events = eventsSince(0)`; `room = findRoom(events, roomId)` → throw `BoardError('ROOM_NOT_FOUND')` if absent (AC #3); else build `messages = roomMessages(events, roomId)` and return `{ room, messages }` (a `RoomHistory` type). NO append (read). Session-agnostic (no `actor` param; the tool enforces the identity precondition). Reuse `findRoom`/`foldRooms`. [DONE — `read-room.ts`: `readRoom` + `RoomHistory`; reuses `findRoom` + `roomMessages`, single `eventsSince(0)` read.]
  - [x] Export `readRoom`, `RoomMessage`, `RoomHistory` from `packages/core/src/index.ts`. Unit-test: activated room → room + ordered messages; proto-room → room + single announcement message + `active=false`; unknown room → `ROOM_NOT_FOUND`. [DONE — barrel exports `readRoom`/`RoomHistory`/`roomMessages`/`RoomMessage`/`RoomMessageKind`; `read-room.test.ts`, 6 tests incl. no-truncation-across-re-read + cross-room isolation.]
- [x] Task 3: Wire the `read_room` MCP tool (AC: #1, #2, #3, #6)
  - [x] Create `packages/mcp-server/src/tools/read-room.ts` mirroring `tools/list-rooms.ts`: a `{ room_id: roomIdSchema }` Zod input schema (reuse `roomIdSchema` from `room-shared.ts`), the session `NO_IDENTITY` gate (NO membership — open read, FR9), delegate to `core.readRoom`, map the result to the wire as `{ room: roomToWire(room), messages: messages.map(messageToWire) }` (add a `messageToWire` to `room-shared.ts`: `{ seq, actor, body, kind }`). `ROOM_NOT_FOUND` propagates via `error-map.ts` (already in the closed set — NO new code). [DONE — `tools/read-room.ts` + `messageToWire`/`MessageWire` in `room-shared.ts`; envelope built as an inferred object literal to satisfy the SDK `structuredContent` index-signature.]
  - [x] Register `read_room` in `packages/mcp-server/src/server.ts` and extend the exhaustive tool-list assertion in `server.bootstrap.test.ts`. [DONE — registered after `reply`; bootstrap assertion now lists `read_room` (14 entries) and passes.]
- [x] Task 4: Tests + full gate (AC: all)
  - [x] Add `packages/mcp-server/src/tools/read-room.integration.test.ts`: real `Client`↔`McpServer` over `InMemoryTransport` + real SQLite proving AC #6 (a non-member third identity reads `[announcement, reply, reply]` by `seq`, verbatim; `ROOM_NOT_FOUND`; re-read after another reply shows no truncation; proto-room → single announcement message; `NO_IDENTITY` precondition). [DONE — `read-room.integration.test.ts`, 7 tests: non-member open read of `[announcement,reply,reply]` byte-identical by seq, ROOM_NOT_FOUND, no-truncation re-read, proto-room single message, NO_IDENTITY, NFR6 hostile-body verbatim round-trip, discovery-surface `room_id`.]
  - [x] Run the full gate in honest order: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final count (Epic 4 at 394 after Story 4.3). [DONE — all green; build caught a `structuredContent` index-signature type error (fixed). Final: **418 tests / 63 test files** (= 394 + 24: 9 projection + 6 op + 9 integration). NOTE (corrected at code review): an earlier draft of this line said 416/+22/7-integration; the integration file actually carries 9 tests (the +7 figure predated 2 QA-addition integration tests — interleaved A/B isolation + per-message seq referenceability), so the true total is 418/+24.]

## Dev Notes

This story adds the `read_room` tool — the room's complete ordered history (announcement as message #1, then replies by `seq`). It is a READ story — no append, no new event type, no new error code (reuses `ROOM_NOT_FOUND` + `NO_IDENTITY`). It consumes the rooms projection (4.1–4.3) and adds the message-history projection that Epic 5 (react / current-contract) will build on (a "message" is identified by its `seq`).

**Rule 1 (Integration ACs):** AC #6 is the real-runtime Integration AC (the `read_room` tool over real MCP + real SQLite, proving ordered history, open read, ROOM_NOT_FOUND, no-truncation).
**Rule 3 (real-runtime evidence):** `read_room` ships with the real `Client`↔`McpServer`↔SQLite test.
**Rule 5 / Rule 6:** N/A (no NFR; no `docs/adr/`).

### Design decisions (grounded at story creation, baseline `0f9f9ab`)

1. **A "message" in a room = the seeding announcement (message #1) + each `room.replied`, identified by its `seq`.** There is NO separate `message.posted` event type in the vocabulary (`announcement.posted`, `room.replied`, `room.participant_added`, `message.reacted`, `message.unreacted`); posting a message to a room IS `room.replied` (Story 4.3). So the room history folds `announcement.posted` (msg #1) + `room.replied`(s). Epic 5's `react`/`current-contract` operate on these messages by `seq` (`message.reacted.messageSeq`). This story establishes the message-history projection they consume.
2. **`read_room` is an OPEN read (FR9).** Any established identity can read any room's full history WITHOUT membership or participation — the only precondition is `NO_IDENTITY`. This is the FR9 "read history on demand even before you join" guarantee (the `check` cursor — Epic 6 / Story 4.6 — only governs the pull DELTA, never what `read_room` can fetch).
3. **Message #1 is the announcement; `subject` is room-level metadata.** The seeding announcement is message #1 with its `body`; the room `subject` is returned once on the `Room` record (not repeated per message). Each message carries a `kind` (`announcement` | `reply`) so a consumer (UI/Epic 5) can distinguish the seed from replies.
4. **No-truncation (AC #4) is inherent to the append-only ledger, but assert it explicitly.** Because nothing is ever `UPDATE`/`DELETE`d, a later `read_room` is a superset (by `seq`) of an earlier one. The integration test asserts this directly (read, reply, re-read → earlier messages unchanged + the new one appended).
5. **Fold the full stream (`eventsSince(0)`) and filter by `roomId`,** consistent with the other rooms/projects projections (there is no `eventsByRoom` read method). Per-room scoping is a V1-acceptable read cost (same class as deferred-work 3.0-b; not optimized here).

### Source facts (verified at story creation, baseline `0f9f9ab`)

- **Rooms projection** (`packages/core/src/rooms/projection.ts`): `Room = { roomId, projectId, subject, body, postedBy, seq, active, activatedBy?, activatedAtSeq? }`; `foldRooms`/`findRoom` fold `announcement.posted` + `room.replied`. The message-history projection is NEW (reuses the same events; the announcement's `body`/`actor`/`seq` and each reply's `body`/`actor`/`seq`).
- **`announcement.posted`** payload `{ projectId, roomId, subject, body }`; **`room.replied`** payload `{ roomId, body }` (actor on the event). Both at-rest snake_case via `mapping.ts`.
- **`ROOM_NOT_FOUND`** already in the closed error set (`errors.ts`). No new error code.
- **Read-tool pattern**: `tools/list-rooms.ts` / `tools/read`... mirror — `{ room_id: roomIdSchema }` (reuse `roomIdSchema` from `room-shared.ts`, added in 4.3), `NO_IDENTITY` gate (open read, NO membership), delegate, envelope. `roomToWire` exists in `room-shared.ts`; ADD `messageToWire` (`{ seq, actor, body, kind }`).
- **DataAccess reads**: `eventsSince(0)` (all events, `seq`-ordered), `eventsByType`, `eventsByActor`, `totalEvents` — no `eventsByRoom`. Fold the stream + filter by `roomId`.
- **Tool registration**: `server.ts`; exhaustive advertised-tool-list assertion in `server.bootstrap.test.ts` (extend for `read_room`).
- Toolchain (Epics 1–4): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers); newly-added `core` exports visible from `src` to mcp-server tests/typecheck (Story 4.0).

### Project Structure Notes

- New `packages/core/src/rooms/read-room.ts` (+ message-history projection in `room-history.ts` or `projection.ts`) (+ tests); extend `tools/room-shared.ts` (`messageToWire`); new `packages/mcp-server/src/tools/read-room.ts` (+ integration test); register in `server.ts`. One barrel (`packages/core/src/index.ts`).
- THE APPEND INVARIANT: read only — fold every call; never store a `messages`/`history` table; order by `seq` never `created_at`; `core` imports only the `DataAccess` port.

## Dev Agent Record

### Context Reference

- Implemented by the `bmad-dev-story` workflow under `/epic-cycle` (dev stage for Story 4.4).
- Grounded against the live codebase at baseline (rooms projection 4.1–4.3, `list-rooms` read-op + tool patterns, `reply` integration test as the real-runtime template, `room-shared.ts`, `error-map.ts`, `register-tool.ts`, `server.ts` + `server.bootstrap.test.ts`).
- Toolchain verified to match the pins before coding: Node v24.16.0, pnpm 11.3.0 (Rule 9).

### Implementation Plan (as executed)

1. **Message-history projection** (`packages/core/src/rooms/room-history.ts`) — `roomMessages(events, roomId)` folds the `seq`-ordered stream filtered to one room into `RoomMessage[]` = [announcement (`kind:'announcement'`, body = announcement body), then `room.replied`(s) (`kind:'reply'`)], sorted ascending by `seq`. Pure fold, no I/O; sorts explicitly so the contract holds for any input ordering. A "message" carries its `seq` (the identity Epic 5's `message.reacted.messageSeq` targets), `actor`, `body`, `kind`. The room `subject` is NOT duplicated per message (it is room metadata on the `Room` record).
2. **`readRoom` core op** (`packages/core/src/rooms/read-room.ts`) — single `eventsSince(0)` read → `findRoom` (→ `ROOM_NOT_FOUND` if absent) → `roomMessages` → `{ room, messages }` (`RoomHistory`). Read-only, session-agnostic. No new error code (reuses `ROOM_NOT_FOUND`). Barrel exports added (`readRoom`, `RoomHistory`, `roomMessages`, `RoomMessage`, `RoomMessageKind`).
3. **`read_room` MCP tool** (`packages/mcp-server/src/tools/read-room.ts`) — mirrors `list-rooms.ts`: `{ room_id: roomIdSchema }`, `NO_IDENTITY` gate (NO membership — open read, FR9), delegate to `core.readRoom`, envelope `{ room: roomToWire(room), messages: messages.map(messageToWire) }`. Added `messageToWire`/`MessageWire` (`{ seq, actor, body, kind }`) to `room-shared.ts`. Registered in `server.ts`; bootstrap exhaustive tool-list extended.
4. **Integration test + full gate** — `read-room.integration.test.ts` (real `Client`↔`McpServer`↔SQLite) proves AC #6 + the mandatory cases; full gate run in honest order.

### Debug Log

- **Build caught a real type error the Vitest alias hid (Rule #2 residual guidance confirmed).** First gate `build` failed: `tools/read-room.ts` typed `structuredContent` with a named `interface ReadRoomEnvelope`, which does NOT satisfy the SDK's `structuredContent: { [x: string]: unknown }` index-signature (TS2322 — interfaces lack implicit index signatures). The test run passed because the Vitest `resolve.alias` resolves against `src` and the in-process SDK types were satisfied structurally. **Fix:** build the envelope as an inferred object literal (`const envelope = { room, messages }`), matching the existing `list-rooms.ts`/`reply.ts` pattern. Rebuilt → green. This is exactly the "build is the `dist`-artifact guard, not a test prerequisite" case in project-rules Rule #2.
- **Prettier line-ending mismatch on one new file.** `format --check` flagged `read-room.integration.test.ts`; `prettier --write` reported it "unchanged" (content already conformant) but it had CRLF endings while the repo default is `endOfLine: lf` (no prettier config → defaults). Normalized that file to LF; `format --check` then fully clean. Re-ran the affected tests after the normalization (content logically identical) — still green.

### Completion Notes

- **All 6 ACs satisfied.** AC #1 (announcement = message #1, then replies by `seq`, with room metadata) — projection + op unit tests + integration. AC #2 (open read, any established identity, NO membership) — `NO_IDENTITY` gate only; integration's non-member reader. AC #3 (`ROOM_NOT_FOUND`) — op + integration. AC #4 (no truncation) — projection growth test + op re-read test + integration re-read-after-reply. AC #5 (proto-room → single announcement message, `active=false`) — op + integration. AC #6 (real MCP + real SQLite) — `read-room.integration.test.ts`, nothing mocked (Rule 1 + Rule 3 real-runtime evidence).
- **No new event type, no new error code** (reuses `announcement.posted` + `room.replied`, and `ROOM_NOT_FOUND`/`NO_IDENTITY`). A "message" = the seeding announcement (#1) + each `room.replied`, identified by `seq` — the projection Epic 5 (react / current-contract) consumes.
- **THE APPEND INVARIANT honored:** read-only (no append); the history is a pure fold every call (no `messages`/`history` table); ordered by `seq` never `created_at`; `core` imports only the `DataAccess` port. Lint green (the invariant is lint-enforced).
- **Rule 5 / Rule 6:** N/A — no NFR was found unmeasurable/contradictory; no `docs/adr/` directory exists.
- **Full gate green (honest order):** `lint` ✓ · `build` ✓ (7/7) · `typecheck` ✓ · `test` ✓ **418 tests / 63 test files** (= 394 after 4.3 + 24 new: 9 projection + 6 op + 9 integration) · `format --check` ✓. No `.skip`/`.only`/`.todo`. [Count corrected at code review from a stale 416/+22/7-integration draft — the integration file carries 9 tests, incl. 2 QA additions.]
- **Left uncommitted by design** — the lead commits after the smoke gate (per the epic-cycle dev-stage directive).

### File List

**New:**
- `packages/core/src/rooms/room-history.ts`
- `packages/core/src/rooms/room-history.test.ts`
- `packages/core/src/rooms/read-room.ts`
- `packages/core/src/rooms/read-room.test.ts`
- `packages/mcp-server/src/tools/read-room.ts`
- `packages/mcp-server/src/tools/read-room.integration.test.ts`

**Modified:**
- `packages/core/src/index.ts` (barrel: `readRoom`, `RoomHistory`, `roomMessages`, `RoomMessage`, `RoomMessageKind`)
- `packages/mcp-server/src/tools/room-shared.ts` (`messageToWire` + `MessageWire`; `RoomMessage` type import)
- `packages/mcp-server/src/server.ts` (register `read_room` + doc comment)
- `packages/mcp-server/src/server.bootstrap.test.ts` (exhaustive tool-list now includes `read_room`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (4-4 → in-progress → review)
- `_bmad-output/implementation-artifacts/4-4-read-a-rooms-full-ordered-history.md` (this file)

### Change Log

- 2026-05-31 — Story 4.4 implemented: added the `read_room` MCP tool — a room's COMPLETE ordered history (announcement = message #1, then `room.replied`(s) by `seq`); an OPEN read (FR9, no membership; `NO_IDENTITY` the only precondition); `ROOM_NOT_FOUND` for an unknown room; never truncated (append-only). New `room-history.ts` message-history projection (`roomMessages`/`RoomMessage`) + `read-room.ts` core op (`readRoom`/`RoomHistory`) + `read-room.ts` tool (+ `messageToWire`). No new event type / error code. +24 tests (418 total; corrected at code review from a stale +22/416). Full gate green.
