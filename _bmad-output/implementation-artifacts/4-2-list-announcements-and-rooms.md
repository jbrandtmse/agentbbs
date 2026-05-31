---
baseline_commit: 85247dd
---

# Story 4.2: List announcements and rooms

Status: review

## Story

As any identity,
I want to `list_announcements` and `list_rooms` for a sub-board,
So that I can browse open needs and active conversations.

## Acceptance Criteria

1. **Given** a sub-board `projectId` with proto-rooms (announcements with no reply yet) and activated rooms (≥1 reply),
   **When** I call `list_announcements` with `project_id`,
   **Then** I receive the PROTO-rooms only (rooms with `active = false`) for that board, ordered by `seq`;
   **And when** I call `list_rooms` with `project_id`,
   **Then** I receive the ACTIVATED rooms only (`active = true`) for that board, ordered by `seq`.

2. **Given** both reads,
   **When** I call either with only an established identity and NO membership of `projectId`,
   **Then** the read SUCCEEDS (board-wide open read, FR9 — membership is required to POST, never to READ); a non-member sees the full listing. (Precondition is `NO_IDENTITY` if no identity is established, mirroring `list_projects`/`list_members`.)

3. **Given** a `project_id` that was never announced,
   **When** I call `list_announcements` or `list_rooms`,
   **Then** the call is rejected with `BOARD_NOT_FOUND` (the same existence-check the read tool `list_members` uses — a typo'd board is a clear error, not a silently-empty list).

4. **(Integration AC — real MCP server over the real SQLite ledger.)**
   **Given** the real `McpServer` + real `createDataAccess` SQLite ledger driven by a real MCP `Client` over `InMemoryTransport`,
   **When** an agent registers, announces a sub-board, posts two announcements, and ONE of those rooms is activated by appending a `room.replied` for it (seeded via the `DataAccess` port directly — the `reply` TOOL is Story 4.3),
   **Then** `list_announcements(project_id)` returns exactly the one still-proto room and `list_rooms(project_id)` returns exactly the one activated room, both `seq`-ordered,
   **And** a second identity that registered but did NOT join the board gets the SAME results (open read),
   **And** `list_announcements`/`list_rooms` on an unknown `project_id` are rejected with `BOARD_NOT_FOUND`.

## Review Findings

**Code review (2026-05-31) — APPROVED. 0 HIGH / 0 MED / 0 deferred; 1 LOW auto-resolved inline.** Full gate re-run green in honest order: lint → build (7/7) → typecheck → test **375 passed (57 files)** → format `--check`. The QA-reported 375/57 is confirmed. All 4 ACs independently re-verified against the changeset; all 8 directive verification items pass (see below).

### Resolved inline (LOW)

- **LOW — Stale doc comment on `RoomWire.active` (`packages/mcp-server/src/tools/room-shared.ts`).** The comment read `Whether the room is active (a reply exists). Always `false` until Story 4.3.` — factually invalidated by THIS story: 4.2's `foldRooms` `room.replied` branch makes `active = true` reachable, and this changeset's own integration test asserts `active: true` flowing through `roomToWire`. The file is a Story 4.1 file unchanged since baseline (strictly outside the diff), but the changeset semantically obsoleted the comment. **Resolution:** rewrote the comment to describe the 4.2 activation read-model (`true` iff ≥1 reply, derived in `foldRooms`; still-proto → `false`). Comment-only, zero behaviour change; Prettier-clean; gate stays green.

### Independent verification (8 directive items — all PASS)

1. **Append invariant + module boundary (lint-enforced):** PASS. Reads only — no `append` in either list op; `active` is DERIVED in `foldRooms` (mutates the in-`Map` record on `room.replied`), never stored (no `rooms`/`active` table or column); ordering is `.sort((a,b) => a.seq - b.seq)` (the only `createdAt` reference is the "NEVER createdAt" doc note); `core/rooms/list-rooms.ts` imports only `findProject`, `foldRooms`, `BoardError`, and the `DataAccess`/`Room` types — the port only. `pnpm run lint` (which enforces the invariant + boundaries) green.
2. **AC #1 (the split):** PASS. `listRoomsByActive` filters `room.projectId === projectId && room.active === active`; `listAnnouncements` passes `false`, `listRooms` passes `true` → disjoint partition (boolean flag). Both `seq`-sorted, both scoped to the queried board. The QA-added interleaved-ledger test (`list-rooms.test.ts` "seq-orders both lists when announcements and replies are INTERLEAVED") genuinely proves disjointness: it asserts `annIds.has(id) === false` for every active room AND `annIds.size + roomIds.size === 4` (all rooms, none twice), with the active subset NOT a ledger suffix (defeats a naive append-order impl). A replied room appears in `list_rooms` and is absent from `list_announcements`.
3. **AC #2 (open read, FR9):** PASS. Both tools gate ONLY on `session.handle === null → NO_IDENTITY`; no `requireMembership`/`isMember`/`boardDirectory`/membership call leaked into either tool or the core ops (grep-confirmed — the only "membership" hits are doc comments stating "NO membership is consulted"). The integration test "a SECOND identity that did NOT join the board gets the SAME results" proves a non-member sees the full listing over the real surface.
4. **AC #3 (BOARD_NOT_FOUND):** PASS at BOTH layers. Core: `listRoomsByActive` existence-checks via `findProject` BEFORE returning any list → `BoardError('BOARD_NOT_FOUND')` if absent (mirrors `boardDirectory` exactly, same message shape). Tool: propagates through `error-map.ts`. Distinguished from announced-but-empty (→ empty arrays, success): proven at core (`a board with no announcements yet returns empty lists (not an error)`) AND over the real surface (QA-added `an announced board with ZERO announcements returns EMPTY lists (not BOARD_NOT_FOUND)`).
5. **AC #4 (Integration AC, Rule 1 + Rule 3):** PASS. `list-announcements-rooms.integration.test.ts` drives a real `Client` ↔ `createBoardServer` `McpServer` over `InMemoryTransport` backed by real `createDataAccess` (better-sqlite3) against a temp-dir SQLite file (never the repo `.agentbbs/`). Nothing mocked. Proves the proto/activated split, open read (non-member), BOARD_NOT_FOUND (both tools), seq order independent of reply order, cross-board scoping (QA-added tool-layer test), and NO_IDENTITY. The at-rest `room.replied` seeding via the `DataAccess` port is legitimate read-tool testing (Design decision 4 — the reply TOOL is 4.3; the READ is under test, seeded through the very port 4.3 will use) — NOT a missing-consumer gap.
6. **Activation read-model correctness:** PASS. The `room.replied` branch sets `active=true` idempotently (multiple replies → one active room, emitted once — proven by `list-rooms.test.ts` "a room with MULTIPLE replies appears in listRooms exactly ONCE" + `projection.test.ts` "multiple replies keep the room active"); a `room.replied` for an unknown roomId is ignored (mints no phantom — `projection.test.ts` "a room.replied for an unknown room is ignored"); does NOT compute the min-`seq` activator (correctly deferred to 4.3/4.4 per Design decision 2). The projection module-header + `Room.active` + `foldRooms` doc comments were updated to record the read-model is owned here, consistent with 4.1's documented seam.
7. **No new error code; no new event type:** PASS. `BOARD_NOT_FOUND` + `NO_IDENTITY` reused (both pre-existing in `BOARD_ERROR_CODES`); no append anywhere; `room.replied` already in the closed event vocabulary (`EventPayloadMap`). The `Event` discriminated union narrows `event.payload` to `RoomRepliedPayload` in the fold — type-safe.
8. **Full gate (honest order):** PASS. lint → build (7/7) → typecheck → test **375 (57 files)** → format `--check`. Dev recorded 371; QA added 4 (interleaved-ordering, multiple-replies idempotence, cross-board at tool layer, empty-board at tool layer) → 375. Matches the QA-reported 375/57.

**Rules:** Rule 1 (Integration AC #4 present, exercises both read tools over the real runtime) ✓. Rule 3 (real-runtime evidence — both user-facing tools covered by the real `Client`↔`McpServer`↔SQLite test, not a mock) ✓. Rule 5 / Rule 6: N/A (no NFR; no `docs/adr/`).

## Tasks / Subtasks

- [x] Task 1: Extend the rooms projection to derive activation (read-model) (AC: #1, #4)
  - [x] In `packages/core/src/rooms/projection.ts`, add a `room.replied` branch to `foldRooms`: when a `room.replied` for a known `roomId` is folded, set that room's `active = true` (a room is ACTIVE iff ≥1 `room.replied` exists for it — architecture.md line 251). Keep folding `announcement.posted` → proto-room (`active = false`). A `room.replied` for a `roomId` with no folded announcement is defensively ignored (cannot happen on the happy path — a reply targets an existing room with a lower `seq` announcement).
  - [x] Update the projection's doc comment: the activation READ-MODEL (active-on-reply) is owned HERE (Story 4.2, because `list_rooms` needs it); Story 4.3 adds the reply WRITE-op (which appends `room.replied`, auto-joins the replier, and refines the activator = MIN-`seq` reply + the announcement-as-message-#1 read). Do NOT compute the activator/min-seq here — `active` is a boolean existence-of-reply derivation; the min-`seq` activator identity is a 4.3/4.4 read concern.
  - [x] Unit-test the activation fold: a room with a `room.replied` folds `active = true`; a room with none stays `active = false`; multiple replies keep it active (idempotent); a `room.replied` for an unknown room is ignored.
- [x] Task 2: Core read ops `listAnnouncements` / `listRooms` (AC: #1, #2, #3)
  - [x] In a new `packages/core/src/rooms/list-rooms.ts` (or extend the rooms module), export `listAnnouncements(dataAccess, projectId)` and `listRooms(dataAccess, projectId)`. Each: existence-check the board via `findProject(eventsSince(0), projectId)` → throw `BoardError('BOARD_NOT_FOUND')` if absent (REUSE the Story 3.1 `findProject`; mirror `boardDirectory`/`requireMembership`'s existence check); then `foldRooms(events)`, filter to `room.projectId === projectId` AND (`active === false` for announcements / `active === true` for rooms), return `seq`-ordered (`Room[]`).
  - [x] These ops perform NO append (reads). Session-agnostic (no `actor` param — the server's session gate is the only identity precondition, enforced at the tool). Unit-test: proto-only board → `listAnnouncements` returns all, `listRooms` empty; after a seeded `room.replied` → the activated room moves from `listAnnouncements` to `listRooms`; unknown board → `BOARD_NOT_FOUND`; ordering by `seq`; cross-board isolation (rooms of board A absent from board B's lists).
  - [x] Export `listAnnouncements`, `listRooms` from `packages/core/src/index.ts`.
- [x] Task 3: Wire the `list_announcements` + `list_rooms` MCP tools (AC: #1, #2, #3, #4)
  - [x] Create `packages/mcp-server/src/tools/list-announcements.ts` and `tools/list-rooms.ts`, mirroring `tools/list-members.ts`: a `{ project_id: projectIdSchema }` Zod input schema, the session precondition (`NO_IDENTITY` if `session.handle === null` — NO membership check, open read), delegate to the core op, map each `Room` via the existing `roomToWire` (`tools/room-shared.ts`), wrap as `{ announcements: [...] }` / `{ rooms: [...] }` (object envelope, both `structuredContent` and the `text` block). `BOARD_NOT_FOUND` propagates through `error-map.ts`. No new error code.
  - [x] Register both tools in `packages/mcp-server/src/server.ts` (mirror `list_members` registration) and update the exhaustive tool-list assertion in `server.bootstrap.test.ts`.
- [x] Task 4: Tests + full gate (AC: all)
  - [x] Add `packages/mcp-server/src/tools/list-announcements-rooms.integration.test.ts` (one file may cover both tools): real `Client`↔`McpServer` over `InMemoryTransport` + real SQLite proving AC #4 (proto vs activated split via a port-seeded `room.replied`; open read for a non-member; `BOARD_NOT_FOUND`; `seq` order; `NO_IDENTITY` precondition).
  - [x] Run the full gate in honest order from repo root: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final test count (Epic 4 at 353 after Story 4.1).

## Dev Notes

This story adds the two browse tools (`list_announcements`, `list_rooms`) that consume Story 4.1's proto-rooms + this story's activation read-model. It is a READ story — no append, no new event type, no new error code (reuses `BOARD_NOT_FOUND` + `NO_IDENTITY`).

**Rule 1 (Integration ACs):** the read tools are user-facing surfaces consuming the rooms projection; AC #4 is the real-runtime Integration AC proving them over the real MCP server + real SQLite (proto/activated split, open read, BOARD_NOT_FOUND).
**Rule 3 (real-runtime evidence):** both tools ship with the real `Client`↔`McpServer`↔SQLite test (the Epic 2/3 bar — no tool approved on unit tests alone).
**Rule 5 / Rule 6:** N/A (no NFR work; no `docs/adr/`).

### Design decisions (grounded at story creation, baseline `85247dd`)

1. **The activation READ-MODEL lives in this story (4.2), the reply WRITE-op in 4.3.** `list_rooms` (AC #1) must return activated rooms, so `foldRooms` must derive `active` from `room.replied` HERE. Story 4.1's projection deliberately left `active = false` with a documented seam for "the activating reply"; 4.2 fills that seam (active = ≥1 reply exists). Story 4.3 then adds the `reply` op/tool that APPENDS `room.replied` (+ auto-join + min-`seq` activator + announcement-as-message-#1), and 4.4 reads the ordered history. Clean read-model (4.2) / write-op (4.3) split.
2. **`active` is existence-of-reply, not the activator identity.** A room is active iff ≥1 `room.replied` for it exists (architecture.md line 251). WHICH reply is the activator (the min-`seq` one) and the message-#1 seeding are 4.3/4.4 read concerns — do NOT compute them in this story's boolean `active`.
3. **`list_announcements` and `list_rooms` both take `project_id` and are open reads (FR9).** Like `list_members`, the only precondition is an established identity (`NO_IDENTITY` otherwise); membership is NOT required to browse. An unknown `project_id` → `BOARD_NOT_FOUND` (the `list_members`/`boardDirectory` existence-check precedent — a permissive silently-empty result would hide a typo'd board id).
4. **The integration test seeds activation via a direct `DataAccess` port append of `room.replied`** because the `reply` tool does not exist until Story 4.3. This is legitimate for a READ-tool test — the read is what's under test; the ledger is seeded through the port (the same port the 4.3 op will use). Note this explicitly so the reviewer does not read it as a missing-consumer gap.

### Source facts (verified at story creation, baseline `85247dd`)

- **Rooms projection** (`packages/core/src/rooms/projection.ts`): `Room = { roomId, projectId, subject, body, postedBy, seq, active }`; `foldRooms(events): Map<roomId, Room>` currently folds ONLY `announcement.posted` (active=false), with `room.replied` activation called out as the next seam. `findRoom` is the single-room convenience. Extend `foldRooms` with the `room.replied` branch.
- **`room.replied` payload** (`packages/core/src/events/payloads.ts`): `{ roomId, body }` (at rest `{ room_id, body }`) — already in the vocabulary + wire mapping. Folding it needs only the `roomId` to flip `active` (the body/order matter to 4.4, not to the boolean `active`).
- **Read-tool pattern** (`packages/mcp-server/src/tools/list-members.ts`): `{ project_id: projectIdSchema }` schema → session `NO_IDENTITY` gate → delegate to core (which does the `BOARD_NOT_FOUND` existence check) → `{ members: [...] }` envelope. `list_projects.ts` is the no-param variant. Mirror `list-members` (it takes a `project_id`).
- **`roomToWire`** (`packages/mcp-server/src/tools/room-shared.ts`) maps `Room` → `{ room_id, project_id, subject, body, posted_by, seq, active }` (snake_case). REUSE it for both list envelopes.
- **`findProject`** (`packages/core/src/projects/projection.ts`) — the board-existence resolver `requireMembership`/`boardDirectory` use; returns `undefined` for an unknown board (→ `BOARD_NOT_FOUND`).
- **Tool registration** is in `packages/mcp-server/src/server.ts`; the exhaustive advertised-tool-list assertion is in `server.bootstrap.test.ts` (extend it for the two new tools, as Story 4.1 did for `post_announcement`).
- Toolchain (Epics 1–4): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Newly-added `core` exports are visible to `mcp-server` tests/typecheck from `src` (Story 4.0); gate still runs `build` before `test` for the forked workers.

### Project Structure Notes

- Extend `packages/core/src/rooms/` (projection fold + a `list-rooms.ts` read op); two new `packages/mcp-server/src/tools/list-*.ts` + one integration test; register in `server.ts`. One barrel (`packages/core/src/index.ts`).
- THE APPEND INVARIANT: reads only — fold the ledger every call; never store an `active`/`rooms` table; order by `seq` never `created_at`. `core` imports only the `DataAccess` port.

## Dev Agent Record

### Completion Notes

Implemented Story 4.2 (the two room browse tools + the activation read-model) exactly per the Tasks/Subtasks and Design decisions. All four ACs satisfied; full gate green.

- **Activation read-model (Task 1):** added a `room.replied` branch to `foldRooms` (`packages/core/src/rooms/projection.ts`) that flips an EXISTING room's `active` to `true` (existence-of-reply; idempotent — a second reply re-asserts the flag). It does NOT mint a phantom room for a reply to an unknown `roomId` (defensively ignored). Per Design decision 2, `active` is a boolean existence derivation ONLY — the min-`seq` activator identity + message-#1 read are explicitly left to Story 4.3/4.4. Updated the module/`Room.active`/`foldRooms` doc comments to record that the activation read-model is owned here.
- **Core read ops (Task 2):** new `packages/core/src/rooms/list-rooms.ts` exporting `listAnnouncements` (active=false) / `listRooms` (active=true). Both share a private `listRoomsByActive` helper: `findProject` existence-check → `BoardError('BOARD_NOT_FOUND')` if absent (mirrors `boardDirectory`), then `foldRooms` filtered to `projectId` + the active flag, `seq`-sorted explicitly (matches `listProjects` — order independent of `Map` internals). Reads only, no `actor` param (session-agnostic). Exported both from the `@agentbbs/core` barrel.
- **MCP tools (Task 3):** new `tools/list-announcements.ts` + `tools/list-rooms.ts`, mirroring `tools/list-members.ts` (NOT the no-param `list_projects`): `{ project_id: projectIdSchema }` schema, `NO_IDENTITY` session gate (no membership check — open read, FR9), delegate to the core op, reuse `roomToWire`, envelopes `{ announcements: [...] }` / `{ rooms: [...] }` carried in both `structuredContent` and the JSON `text` block. No new error code. Registered both in `server.ts`; extended the exhaustive advertised-tool-list assertion in `server.bootstrap.test.ts` to 10 built-in tools (added `list_announcements`, `list_rooms`).
- **Integration test (Task 4 / AC #4):** `tools/list-announcements-rooms.integration.test.ts` — real `Client`↔`McpServer` over `InMemoryTransport` + real `createDataAccess` SQLite (temp dir, never the repo's `.agentbbs/`). One room is activated by appending a `room.replied` DIRECTLY through the `DataAccess` port (Design decision 4 — the `reply` tool is Story 4.3; legitimate for a read-tool test). Proves: proto-vs-activated split returns exactly the right room in each list; `seq` order independent of reply order; a second identity that did NOT join sees the SAME results (open read); `BOARD_NOT_FOUND` on an unknown board (both tools); `NO_IDENTITY` with no session (both tools); snake_case `project_id` on the discovery surface.

**THE APPEND INVARIANT honored:** reads fold the ledger every call (no stored `active`/`rooms` table); ordering is by `seq` (never `created_at`); `core` imports only the `DataAccess` port. Lint (which enforces the invariant) passed.

**Rules 5/6:** N/A — no NFR tripwire encountered; no `docs/adr/` directory (no ADR work).

**Gate result (honest order, repo root):** `pnpm run lint` ✅ → `pnpm run build` ✅ → `pnpm run typecheck` ✅ → `pnpm test` ✅ **371 passed (57 files)** → `pnpm run format --check` ✅. Epic 4 was at 353 after Story 4.1; this story added 18 tests (4 projection activation + 8 core list-rooms + 6 integration) → **371**.

### File List

- `packages/core/src/rooms/projection.ts` (modified — added the `room.replied` activation branch to `foldRooms` + doc comments)
- `packages/core/src/rooms/projection.test.ts` (modified — added the activation-fold describe block + a `replied` helper)
- `packages/core/src/rooms/list-rooms.ts` (new — `listAnnouncements` / `listRooms` read ops)
- `packages/core/src/rooms/list-rooms.test.ts` (new — core read-op unit tests)
- `packages/core/src/index.ts` (modified — barrel export of `listAnnouncements` / `listRooms`)
- `packages/mcp-server/src/tools/list-announcements.ts` (new — the `list_announcements` MCP tool)
- `packages/mcp-server/src/tools/list-rooms.ts` (new — the `list_rooms` MCP tool)
- `packages/mcp-server/src/server.ts` (modified — registered both browse tools)
- `packages/mcp-server/src/server.bootstrap.test.ts` (modified — extended the exhaustive tool-list assertion)
- `packages/mcp-server/src/tools/list-announcements-rooms.integration.test.ts` (new — AC #4 real-runtime integration test)

### Change Log

- 2026-05-31: Implemented Story 4.2 (list announcements + rooms; the rooms activation read-model). Extended `foldRooms` with the `room.replied` → `active=true` branch (existence-of-reply); added the `listAnnouncements` / `listRooms` core read ops (existence-check + fold/filter/seq-sort) and the two `list_announcements` / `list_rooms` MCP browse tools (open reads, `NO_IDENTITY` gate, `BOARD_NOT_FOUND` for unknown boards); registered both tools. Added 18 tests (projection activation fold, core read ops incl. cross-board isolation + unknown-board throw, and the real Client↔McpServer↔SQLite integration test). Full gate green at 371 tests.
