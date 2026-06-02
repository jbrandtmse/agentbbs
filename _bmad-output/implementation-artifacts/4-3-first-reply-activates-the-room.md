---
baseline_commit: 909144c
---

# Story 4.3: First reply activates the room

Status: done

## Story

As an agent,
I want my `reply` to a proto-room to activate it into a live room,
So that a need becomes a multi-party negotiation seeded with its original announcement.

## Acceptance Criteria

1. **Given** a proto-room (an announcement with no replies) whose `roomId` exists,
   **When** I `reply` with `room_id` and `body`,
   **Then** a `room.replied` event ({ roomId, body }, actor = me) is appended, the room becomes ACTIVE (derived: ≥1 reply), the original `announcement.posted` is message #1 of the room's history (announcement first, replies after, by `seq`), and I am auto-joined as a participant (my `room.replied` makes me one) AND as a sub-board member of the room's `projectId` if not already (a `board.joined` side effect — "acting = joining", FR10),
   **And** the activator is computed as the MIN-`seq` `room.replied` (derived, never stored).

2. **Given** I am NOT already a member of the room's sub-board,
   **When** I `reply`,
   **Then** the append includes a `board.joined` for the room's `projectId` (I become a member), appended ATOMICALLY with the `room.replied` (one transaction);
   **And given** I AM already a member,
   **When** I `reply`,
   **Then** NO redundant `board.joined` is appended (idempotent membership — mirror `joinBoard`), only the `room.replied`.

3. **Given** a `room_id` that does not exist (never announced),
   **When** I `reply`,
   **Then** the call is rejected with `ROOM_NOT_FOUND` and NOTHING is appended.

4. **Given** two replies to the same proto-room arrive concurrently,
   **When** both are appended,
   **Then** they receive sequential `seq`s, EXACTLY ONE (the lowest `seq`) is the activator with NO lock and NO error, and the other is an ordinary message in the now-active room — `reply` is a plain (non-guarded) append, so concurrent replies never collide or reject; the single activator is purely the read-side min-`seq` derivation.

5. **(Integration AC — real MCP server over the real SQLite ledger.)**
   **Given** the real `McpServer` + real SQLite ledger driven by a real MCP `Client` over `InMemoryTransport`,
   **When** identity A announces a board + posts an announcement (proto-room), and identity B (NOT a member of that board) calls `reply` on the room,
   **Then** the room moves from `list_announcements` to `list_rooms` (active), B is now in the board's `list_members` (auto-joined), and the room's derived activator is B,
   **And** a `reply` to an unknown `room_id` is rejected with `ROOM_NOT_FOUND`,
   **And** a second `reply` by an already-member appends a `room.replied` but NO second `board.joined` (assert the `board.joined` count for that actor stays 1),
   **And** two replies appended to the same room yield two `room.replied` events with sequential `seq`s and the activator resolves to the lower-`seq` one (no error).

## Review Findings

**Code review — 2026-05-31 (adversarial 3-layer + 8 directive verifications). Outcome: APPROVED.**

Gate re-run independently in honest order, all green: `lint` (clean) → `build` (7/7) → `typecheck` (clean) → `test` (**394 passed, 60 files**) → `format` (`--check` clean). The 394/60 reconciles to dev's 390/59 plus QA's additions: +1 file (`reply-race.test.ts`, 2 forked-race cases) and +2 integration cases (NFR6 hostile-body verbatim + announcement-as-message-#1 ordering) folded into `reply.integration.test.ts` (now 8 cases). No `.skip`/`.only`/`.todo` anywhere — nothing silently excluded (Rule 8).

All 5 ACs and all 8 directive verifications independently confirmed:
- **AC #1 / Verif #2 — activator:** `foldRooms` sets `activatedBy`/`activatedAtSeq` ONCE on the first (min-`seq`) `room.replied` via `if (room.activatedBy === undefined)`; a higher-`seq` reply never clobbers it (input is `seq`-ascending per the port contract, so first-seen = min-`seq`). Proto-rooms carry both as `undefined`. Derived, no stored column.
- **AC #1 — message #1 ordering:** the announcement's `seq` is strictly below every reply's; the QA integration test folds the room's own events and asserts `history[0].type === 'announcement.posted'` before the replies. (Full `read_room` render is 4.4; the underlying ordering is proven now.)
- **AC #2 / Verif #3 — acting=joining + idempotency:** non-member reply appends `room.replied` + `board.joined` in ONE `dataAccess.append(toAppend)` call (atomic, all-or-nothing); already-member reply skips the join via `if (!alreadyMember)` (count stays 1). `reply` does NOT call `requireMembership` — it GRANTS membership (verified: the only `isMember` use is the conditional-join check, never a gate).
- **AC #3 / Verif #4 — ROOM_NOT_FOUND:** `findRoom` check precedes any append; `BoardError('ROOM_NOT_FOUND')` thrown with nothing appended (core asserts `maxSeq` unchanged + 0 `room.replied`; integration asserts `isError` + code + unchanged ledger). Post-append read-back fail-loud guard present (never fabricates).
- **AC #4 / Verif #2,#5 — plain append + concurrency:** `reply` uses a PLAIN `append` (NOT `appendGuarded`); the in-memory fake's `appendGuarded` throws if touched. QA's `reply-race.test.ts` forks 8 real OS processes (`child_process.fork` of the BUILT `dist/reply-race-worker.js`) with an IPC start-barrier: (a) distinct-members mode proves N `room.replied` land with N unique strictly-increasing `seq`s, exactly one min-`seq` activator, all workers converging; (b) same-actor mode proves the benign concurrent double-`board.joined` dedups to EXACTLY ONE member (members projection `!includes` backstop). Worker resolves `@agentbbs/core` via built `dist` (package `exports`), build-if-stale in `beforeAll` (`tsc -b --force`). Genuine cross-process WAL contention — the load-bearing guarantee is real, not sequential.
- **AC #5 / Verif #6 (Rule 1 + Rule 3):** `reply.integration.test.ts` drives a real `Client` ↔ `createBoardServer` `McpServer` over `InMemoryTransport`, backed by real `createDataAccess` (better-sqlite3) against a real SQLite file in `os.tmpdir()` — nothing mocked. Proves activation (list_announcements→list_rooms), auto-join (list_members), activator=B, ROOM_NOT_FOUND, already-member→no-2nd-join, two-replies sequential `seq`+lower-`seq` activator, NO_IDENTITY, verbatim body, discovery-surface params.
- **Verif #1 — append invariant + module boundary (lint-enforced):** appends only (no UPDATE/DELETE); activation/activator/membership all DERIVED; ordered by `seq`; `core` imports only the `DataAccess` port (grep-confirmed zero `@agentbbs/data-access`/`better-sqlite3` imports in core production source; lint green enforces it).
- **Verif #7 — no new error code / event type:** `ROOM_NOT_FOUND` + `NO_IDENTITY` already in `BOARD_ERROR_CODES`; `room.replied` + `board.joined` already in the vocabulary; `roomToWire` omits `activated_by`/`activated_at_seq` on proto-rooms.
- **Rule 5 / Rule 6 — N/A confirmed:** the body cap is a plain Zod `.max(16_000)` interim cap explicitly deferred to Epic 5 Story 5.1 (a planned boundary, not an NFR workaround); no `docs/adr/` directory exists.

**Blind Hunter (correctness):** 0 findings. The one reachability note — `findProject(events, room.projectId)` returning `undefined` would make `alreadyMember=false` and append a `board.joined` for a phantom project — is unreachable on any real ledger (a room's `projectId` is the board the gated `post_announcement` posted to, which provably exists with the announcer joined) and harmless if reached (the projects projection ignores joins for unknown projects). Defensive degradation, not a bug.

**Findings (2, both LOW, both DEFER — neither caused by a 4.3 defect, neither blocks):**

- [x] [Review][Defer] No call-level negative test that a malformed `room_id` (uppercase / bad slug charset) is rejected at the Zod boundary with nothing appended [packages/mcp-server/src/tools/reply.integration.test.ts] — deferred, test-hardening. The new `roomIdSchema` regex (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) is byte-identical to the proven `projectIdSchema` (`project-shared.ts:86`) and is asserted *present* on the discovery surface, but never asserted to *reject* a malformed id. The directly-parallel sibling `post-announcement.integration.test.ts:487` establishes a boundary-rejection test (empty subject/body); `reply` lacks the `room_id` syntactic-rejection analog. Severity LOW: the validator is correct by parity, no mcp-server tool currently tests *syntactic* slug rejection (codebase-wide pattern), and the empty-`body` boundary is transitively covered by 4.1's test of the shared `announcementBodySchema`. → see deferred-work.md (story 4.3).
- [x] [Review][Defer] No explicit max-length boundary test for `room_id` (`ROOM_ID_MAX_LENGTH`=200) / `body` (`ANNOUNCEMENT_BODY_MAX_LENGTH`=16_000) [packages/mcp-server/src/tools/room-shared.ts] — deferred, test-hardening. Defensive caps shared with already-shipped tools; the NFR6 test exercises a multi-KB body successfully. Severity LOW. → see deferred-work.md (story 4.3).

## Tasks / Subtasks

- [x] Task 1: Extend the rooms projection to derive the activator (AC: #1, #4)
  - [x] In `packages/core/src/rooms/projection.ts`, extend the `room.replied` fold branch (added in 4.2): in addition to setting `active = true`, record the ACTIVATOR = the MIN-`seq` `room.replied` for the room. Add derived fields to `Room`: `activatedBy?: string` (actor of the min-`seq` reply) and `activatedAtSeq?: number` (its `seq`); both `undefined` for a proto-room. Because the fold consumes events in `seq` order, the FIRST `room.replied` seen for a room is the min-`seq` one — set the activator once and do NOT overwrite on later replies (later replies keep `active=true` but do not change the activator). Update the projection doc comment.
  - [x] Unit-test: a proto-room has `activatedBy/activatedAtSeq` undefined; one reply sets them to that reply; a SECOND (higher-`seq`) reply leaves the activator unchanged (still the first) while the room stays active; the activator is the lowest-`seq` reply even if events are folded in a stream containing interleaved rooms.
- [x] Task 2: Implement the `reply` core op (AC: #1, #2, #3)
  - [x] Create `packages/core/src/rooms/reply.ts` exporting `reply(dataAccess, actor, input)` where `input: { roomId, body }`. Steps: (1) `events = eventsSince(0)`; (2) `room = findRoom(events, roomId)` → throw `BoardError('ROOM_NOT_FOUND')` if absent (NOTHING appended — AC #3); (3) resolve the room's `projectId` (from the room record) and check membership via `findProject(events, projectId)` + `isMember(project, actor)`; (4) build the append list: ALWAYS `{ type: 'room.replied', actor, payload: { roomId, body } }`, PLUS `{ type: 'board.joined', actor, payload: { projectId } }` IFF `actor` is not already a member (mirror `joinBoard`'s idempotent-skip — DECISION); (5) `await dataAccess.append(list)` (PLAIN append in ONE transaction — replies are NOT uniqueness-constrained, so no `appendGuarded`; concurrent replies both land with sequential `seq`s, AC #4; the conditional `board.joined` double-append race is benign, deduped by the members projection exactly like `joinBoard`); (6) read back via `findRoom(eventsSince(0), roomId)`, fail loud if absent (mirror the post-append read-back guard), return the now-active `Room`.
  - [x] Reuse `findRoom`/`foldRooms` (rooms projection), `findProject`/`isMember` (`projects/membership.ts` + `projection.js`). `core` imports only the `DataAccess` port (no data-access error class). `actor` is a param (session-agnostic).
  - [x] Export `reply`, `ReplyInput` from `packages/core/src/index.ts`. Unit-test: proto-room reply → room.replied appended + active + activator set; non-member reply → board.joined ALSO appended (member after); already-member reply → NO second board.joined; unknown room → ROOM_NOT_FOUND nothing appended; two sequential replies → two room.replied, activator is the first.
- [x] Task 3: Wire the `reply` MCP tool (AC: #1, #2, #3, #5)
  - [x] Create `packages/mcp-server/src/tools/reply.ts` mirroring `tools/post-announcement.ts`: a Zod input schema `{ room_id, body }` (reuse the `room-shared.ts` `body` schema with the interim cap — the 256 KB cap / `BODY_TOO_LARGE` stays Epic 5; `room_id` is a non-empty slug-charset string), the session `NO_IDENTITY` gate, delegate to `core.reply(dataAccess, actor, { roomId, body })`, map errors via `error-map.ts` (`ROOM_NOT_FOUND`, `NO_IDENTITY` — both already in the closed set; NO new code), return `{ room }` via `roomToWire` (the wire now carries `activated_by`/`activated_at_seq` — extend `roomToWire` for the new derived fields).
  - [x] Register `reply` in `packages/mcp-server/src/server.ts` and extend the exhaustive tool-list assertion in `server.bootstrap.test.ts`.
- [x] Task 4: Tests + full gate (AC: all)
  - [x] Add `packages/mcp-server/src/tools/reply.integration.test.ts`: real `Client`↔`McpServer` over `InMemoryTransport` + real SQLite proving AC #5 (non-member reply auto-joins + activates — cross-checked via `list_rooms`/`list_announcements`/`list_members`; `ROOM_NOT_FOUND`; already-member reply → no second `board.joined`; two replies → sequential `seq`s, activator = lower `seq`). 6 integration cases (incl. NO_IDENTITY + discovery-surface params).
  - [x] Consider a genuine concurrency test for AC #4 — DEFERRED to QA (noted). `reply` is a PLAIN append (no `appendGuarded` contention to stress, unlike 4.1's room-id claim), so a forked-worker race adds little confidence beyond the sequential proof (two replies → sequential `seq`s + min-`seq` activator) already covered by the core unit test AND the real-ledger integration test. A forked harness mirroring `post-announcement-race` remains available if QA wants belt-and-suspenders.
  - [x] Run the full gate in honest order: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final count (Epic 4 at 375 after Story 4.2).

## Dev Notes

This story adds the `reply` MCP tool + `reply` core op — the keystone of Epic 4 (a posted need becomes a live multi-party room). It is the SECOND consumer of the "acting = joining" side effect (after — actually alongside — `add_participant` 4.5): replying to a room makes the replier a sub-board member if not already. It reuses the rooms projection (4.1/4.2) and the membership primitives (3.1/3.5), and extends the projection with the derived activator.

**Rule 1 (Integration ACs):** AC #5 is the real-runtime Integration AC — the `reply` tool exercised over the real MCP server + real SQLite, proving activation, auto-join, the activator, and `ROOM_NOT_FOUND`, cross-checked through `list_rooms`/`list_members`.
**Rule 3 (real-runtime evidence):** the `reply` tool ships with the real `Client`↔`McpServer`↔SQLite test (the Epic 2/3 bar).
**Rule 5 (NFR):** N/A — no NFR work (the body cap / `BODY_TOO_LARGE` is Epic 5; interim Zod cap, not an NFR workaround).
**Rule 6 (ADR):** N/A — no `docs/adr/`.

### Design decisions (grounded at story creation, baseline `909144c`)

1. **`reply` does NOT require prior membership — it GRANTS it ("acting = joining", FR10).** Contrast `post_announcement` (4.1), which GATES on membership (`requireMembership`). `reply` lets ANY established identity reply to any room it discovered via open read (FR9); the act of replying auto-joins them to the room's sub-board. (epics.md Epic 3 success criteria, line 599: "an action that implies joining (reply / add_participant) makes the actor a sub-board member as a side effect.")
2. **Plain `append` (NOT `appendGuarded`) for the reply.** Replies are NOT uniqueness-constrained — concurrent replies to a proto-room must BOTH land with sequential `seq`s and no error (AC #4). The "exactly one activator" is a pure read-side min-`seq` derivation; no write coordination, no lock. This mirrors `joinBoard` (plain append) and contrasts `announceProject`/`postAnnouncement` (atomic uniqueness guard).
3. **Conditional `board.joined` is idempotent (mirror `joinBoard`).** Append `board.joined` only if the actor is not already a member of the room's `projectId`; an already-member reply appends only `room.replied`. A benign concurrent double-join race is deduped by the members projection (same as `joinBoard`'s documented race). The `room.replied` + `board.joined` go in ONE `append` call (atomic transaction) so a non-member's reply-and-join is all-or-nothing.
4. **Activator = MIN-`seq` `room.replied`, derived in the projection.** Exposed on the `Room` record as `activatedBy`/`activatedAtSeq` (undefined for proto-rooms). Since `foldRooms` consumes events in `seq` order, the first reply seen for a room is the activator — set once, never overwritten. This is the read model for AC #1/#4 and feeds 4.4's "announcement is message #1, then replies by `seq`."
5. **The participant set is DERIVED, not built here.** "Auto-joined as a participant" = the `room.replied` event makes the replier a participant (derivable as: actors of `room.replied` ∪ handles of `room.participant_added` for the room). A full participant projection is a 4.5 (`add_participant`) / 4.6 (cursor) concern; 4.3 only lands the `room.replied` (+ conditional `board.joined`). Do NOT build a separate participant store.
6. **`reply` works on proto AND already-active rooms.** "First reply activates" is derived (≥1 reply ⇒ active); a reply to an already-active room is an ordinary message. The op does not branch on proto-vs-active — it always appends `room.replied`; activation is the projection's job.

### Source facts (verified at story creation, baseline `909144c`)

- **`room.replied` payload** (`payloads.ts`): `{ roomId, body }` (at rest `{ room_id, body }`) — already in the vocabulary + wire mapping (`mapping.ts`). No payload change needed (contrast 4.1, which added `projectId` to `announcement.posted`).
- **`ROOM_NOT_FOUND`** is ALREADY in the closed error set (`packages/core/src/errors.ts:26`) and distinguished from `BOARD_NOT_FOUND` (a sub-board vs a room). No new error code.
- **Rooms projection** (`packages/core/src/rooms/projection.ts`): `Room = { roomId, projectId, subject, body, postedBy, seq, active }`; `foldRooms` folds `announcement.posted` (proto) + `room.replied` (`active=true`, added in 4.2). Extend the `room.replied` branch to also set the activator. `findRoom` is the single-room read.
- **`joinBoard`** (`packages/core/src/projects/join-board.ts`) is the idempotent-auto-join template: existence-check → skip if already member → plain `append([{ board.joined }])` → read back. `reply`'s conditional join mirrors it (but bundles `board.joined` with `room.replied` in one append).
- **`isMember`/`findProject`** (`projects/membership.ts`, `projects/projection.ts`) — the membership check for the conditional join.
- **`postAnnouncement`** (`packages/core/src/rooms/post-announcement.ts`) is the core-op template (read → append → read-back → return Room); `reply` mirrors its structure (minus the disambiguator/guard — plain append).
- **`reply` tool**: mirror `tools/post-announcement.ts` (Zod `{ room_id, body }`, session gate, delegate, `error-map`, `{ room }` envelope). `roomToWire` (`tools/room-shared.ts`) must gain `activated_by`/`activated_at_seq` for the new derived fields.
- Toolchain (Epics 1–4): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers); newly-added `core` exports visible from `src` to mcp-server tests/typecheck (Story 4.0).

### Project Structure Notes

- New `packages/core/src/rooms/reply.ts` (+ test); extend `rooms/projection.ts` (activator) + `tools/room-shared.ts` (`roomToWire` wire fields); new `packages/mcp-server/src/tools/reply.ts` (+ integration test); register in `server.ts`. One barrel (`packages/core/src/index.ts`).
- THE APPEND INVARIANT: `room.replied` + conditional `board.joined` appended (never mutated); activation + activator + membership all DERIVED by query (no stored `active`/`activator`/`members` columns); order by `seq`. `core` imports only the `DataAccess` port; uniqueness/`code` duck-typed if ever needed (not needed here — plain append).

## Dev Agent Record

### Context Reference

- Baseline commit `909144c` (matches HEAD at dev start; story frontmatter preserved).
- Implemented red-green-refactor per task; full gate run in honest order at the end.

### Completion Notes

Story 4.3 — the keystone Epic 4 story — is complete. A posted need (proto-room) now becomes a live multi-party room on its first reply.

- **Task 1 (projection activator):** `packages/core/src/rooms/projection.ts` — the `Room` interface gained derived `activatedBy?`/`activatedAtSeq?` (both `undefined` for a proto-room). The `room.replied` fold branch now, alongside `active = true`, records the activator ONCE (`if (room.activatedBy === undefined)`) — because `foldRooms` consumes events in `seq` order the first reply seen IS the min-`seq` one, and a later (higher-`seq`) reply never overwrites it. 4 new unit tests (proto-room undefined; first reply sets it; second reply leaves it; interleaved-rooms each get their own min-`seq` activator).
- **Task 2 (`reply` core op):** new `packages/core/src/rooms/reply.ts` — `reply(dataAccess, actor, { roomId, body })`: read stream → `findRoom` → `ROOM_NOT_FOUND` (nothing appended) → resolve `projectId` + `isMember` → build append list (`room.replied` ALWAYS + `board.joined` IFF not a member) → PLAIN `append` (one transaction, NOT `appendGuarded`) → read-back, fail-loud, return the now-active `Room`. Exported `reply`/`ReplyInput` from the barrel. 5 unit tests (member proto reply → no board.joined; non-member → both events; already-member twice → one board.joined; unknown room → ROOM_NOT_FOUND nothing appended; two replies → sequential seqs + activator = first; reply-to-active = ordinary message).
- **Task 3 (`reply` MCP tool):** new `packages/mcp-server/src/tools/reply.ts` mirroring `post-announcement.ts` — Zod `{ room_id, body }` (new `roomIdSchema` + reused `announcementBodySchema`), `NO_IDENTITY` gate, delegate, `{ room }` envelope. `roomToWire` extended for `activated_by`/`activated_at_seq` (OMITTED when the room is proto, present when active). Registered in `server.ts`; the exhaustive tool-list assertion in `server.bootstrap.test.ts` now includes `reply`.
- **Task 4 (integration + gate):** new `packages/mcp-server/src/tools/reply.integration.test.ts` — real `Client`↔`McpServer` over `InMemoryTransport` + real SQLite (Rule 1 + Rule 3). 6 cases prove AC #5: non-member reply moves the room `list_announcements`→`list_rooms`, auto-joins the replier (`list_members`), activator = them; `ROOM_NOT_FOUND`; already-member double-reply → `board.joined` count stays 1; two replies → sequential `seq`s + activator = lower `seq`; plus `NO_IDENTITY` and the discovery-surface params.

Design points honored exactly: reply GRANTS membership (does not gate); PLAIN append (concurrent replies both land — AC #4); conditional `board.joined` idempotent (already-member → no second join); activator = read-side min-`seq` derivation; participant set DERIVED (no participant store — that's 4.5/4.6); `ROOM_NOT_FOUND` reused (NO new error code). Rules 5/6 N/A (no NFR work; no `docs/adr/`).

**Concurrency test note:** the optional AC #4 forked-worker race test was DEFERRED to QA (noted in Task 4). `reply` is a plain append with no `appendGuarded` contention to stress (unlike 4.1's room-id claim), so a forked harness adds little beyond the sequential proof already in both the core unit test and the real-ledger integration test.

**Gate (honest order, all green):** `pnpm run lint` (clean) → `pnpm run build` (7/7) → `pnpm run typecheck` (clean) → `pnpm test` (**390 passed, 59 files** — was 375; +15: 4 projection + 5 reply op + 6 reply integration) → `pnpm run format` (all files match Prettier). Note: the root `format` script is `prettier --check .`; run it with NO extra args (an earlier `-- --check` double-pass was an invocation error, since corrected). Build precedes the suite so the data-access forked workers resolve `dist`.

### File List

**Added**
- `packages/core/src/rooms/reply.ts`
- `packages/core/src/rooms/reply.test.ts`
- `packages/mcp-server/src/tools/reply.ts`
- `packages/mcp-server/src/tools/reply.integration.test.ts`

**Modified**
- `packages/core/src/rooms/projection.ts` (activator derivation + `Room.activatedBy`/`activatedAtSeq` + doc comment)
- `packages/core/src/rooms/projection.test.ts` (4 activator unit tests + header note)
- `packages/core/src/index.ts` (barrel: export `reply` + `ReplyInput`)
- `packages/mcp-server/src/tools/room-shared.ts` (`roomIdSchema` + `RoomWire.activated_by`/`activated_at_seq` + `roomToWire` mapping + `announcementBodySchema` doc note)
- `packages/mcp-server/src/server.ts` (import + register `reply` + doc comment)
- `packages/mcp-server/src/server.bootstrap.test.ts` (exhaustive tool-list now includes `reply`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (4-3 → in-progress)
- `_bmad-output/implementation-artifacts/4-3-first-reply-activates-the-room.md` (this file)

### Change Log

- 2026-05-31 — Story 4.3 implemented (dev). Rooms projection activator (min-`seq` derivation); `reply` core op (plain append: `room.replied` always + conditional idempotent `board.joined` auto-join, one transaction); `reply` MCP tool (`{ room_id, body }`, `NO_IDENTITY` gate, `{ room }` envelope) + `roomToWire` `activated_by`/`activated_at_seq`; registered in `server.ts`. 15 new tests (4 projection + 5 core op + 6 real-runtime integration). Full gate green at 390 tests (59 files). No new error code / event type. Status → review.
