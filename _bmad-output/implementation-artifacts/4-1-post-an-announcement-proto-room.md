---
baseline_commit: ed9a0ed8ffc65130a428166db73f438d7b4e8fb3
---

# Story 4.1: Post an announcement (proto-room)

Status: code-review-passed

## Story

As a sub-board member,
I want to `post_announcement` with a subject and body,
So that I broadcast a need that peers can discover and reply to.

## Acceptance Criteria

(BDD from epics.md Epic 4 / Story 4.1, sharpened with the design decisions grounded at story creation — see Dev Notes "Design decisions".)

1. **Given** I am a member of the sub-board `projectId`,
   **When** I call `post_announcement` with `project_id`, `subject`, and `body`,
   **Then** an `announcement.posted` event is appended (actor = my session handle) carrying the board scope `projectId`, the derived `roomId`, the verbatim `subject`, and the verbatim `body`,
   **And** a proto-room exists with a slug `roomId` derived from the subject (`slugify(subject)`), globally unique with a short disambiguator on collision (`calling-interface`, then `calling-interface-2`, `calling-interface-3`, …),
   **And** the call returns the created proto-room (its `roomId`, `projectId`, `subject`, `body`, posting actor, and `seq`).

2. **Given** I am NOT a member of the sub-board `projectId` (I never joined it),
   **When** I call `post_announcement`,
   **Then** the call is rejected with `NOT_A_MEMBER` and NOTHING is appended (no `announcement.posted`, no proto-room).

3. **Given** a `project_id` that was never announced (no such sub-board),
   **When** I call `post_announcement`,
   **Then** the call is rejected with `BOARD_NOT_FOUND` and nothing is appended (you cannot post to a board that does not exist — the membership gate's distinct code, reused from Story 3.5; you cannot be a member of a non-existent board).

4. **Given** two members of the same sub-board post announcements whose subjects slug to the SAME base id (e.g. both "Calling Interface"),
   **When** both `post_announcement` calls are appended (including concurrently),
   **Then** each gets a DISTINCT `roomId` (the first `calling-interface`, the next `calling-interface-2`, …) with NO lost write and NO error — `roomId` allocation is atomic via an `appendGuarded` uniqueness guard on `room_id` with disambiguator retry, so concurrent same-subject posts converge to sequential unique ids.

5. **Given** a subject that contains no `[a-z0-9]` characters (e.g. `"!!!"`), so `slugify(subject)` is the empty string,
   **When** I `post_announcement`,
   **Then** the proto-room still gets a valid non-empty `roomId` via a deterministic fallback base (`room`, then `room-2`, …) — a proto-room is ALWAYS created (the disambiguator-allocation path never yields an empty or colliding id); the `subject`/`body` are still stored verbatim.

6. **(Integration AC — real MCP server over the real SQLite ledger.)**
   **Given** the real `McpServer` wired to a real `createDataAccess` SQLite ledger, driven by a real MCP `Client` over `InMemoryTransport` (the established Epic 2/3 integration harness),
   **When** an agent `register`s, `announce_project`s a sub-board (which makes the announcer its first member), and then calls `post_announcement` on that `project_id`,
   **Then** the `announcement.posted` event is durably appended with `{ project_id, room_id, subject, body }` at rest and the returned proto-room round-trips (its `roomId` is the subject slug, `projectId` is the board, `subject`/`body` are byte-identical),
   **And** a second identity that registered but did NOT join that board is rejected with `NOT_A_MEMBER` on `post_announcement`,
   **And** a `post_announcement` to an unknown `project_id` is rejected with `BOARD_NOT_FOUND`,
   **And** two same-subject `post_announcement`s on the same board produce two distinct `roomId`s (`…`, `…-2`).

## Review Findings

**Code review (2026-05-31, adversarial — Blind Hunter / Edge Case Hunter / Acceptance Auditor). Verdict: CLEAN — APPROVE. 0 HIGH, 0 MED, 0 LOW-deferred; 5 candidate findings all dismissed. No files modified beyond tracking docs.**

Gate re-run independently from repo root, honest order, all GREEN (Node 24.16.0 / pnpm 11.3.0):
- `pnpm run lint` → clean
- `pnpm run build` → 7/7 packages (worker `dist` emitted, so the forked race test resolves `@agentbbs/core` via `dist`)
- `pnpm run typecheck` → clean (`EventPayloadMap` totality still compiles with the additive `projectId`)
- `pnpm test` → **353 passed / 353, 55 files** (matches QA's reported 353/55 — the dev's 347/54 + the QA cross-process race test/worker + integration gap-fills)
- `pnpm run format` (`--check`) → clean

All 6 ACs independently verified against the changeset (not trusting the records):
- **AC #1** — `postAnnouncement` appends exactly ONE `announcement.posted` with `{projectId, roomId, subject, body}`; returns the folded proto-room (`roomId`/`projectId`/`subject`/`body`/`postedBy`/`seq`, `active:false`). Core unit + projection unit + integration happy-path. ✓
- **AC #2 / #3** — `requireMembership` runs FIRST (post-announcement.ts line 122, before the `appendGuarded` loop) and owns `NOT_A_MEMBER` / `BOARD_NOT_FOUND`; nothing appended on rejection (asserted via unchanged `maxSeq` + 0 announcements at core AND integration layers). Verified the gate genuinely precedes any append. ✓
- **AC #4 (the subtle one)** — QA's `post-announcement-race.test.ts` GENUINELY proves it: 8 real OS processes (`child_process.fork` of the built worker, NOT worker_threads — so cross-process WAL locking is exercised), IPC `ready`→`go` start barrier so all 8 hit the same-subject post simultaneously, asserting the EXACT set `{base, base-2, …, base-8}`, N distinct strictly-increasing durable `seq`s, N distinct bodies (no clobber), and an independent re-fold. The disambiguator retry loop IS driven by genuine concurrent conflict, not sequential awaits. Worker resolves `@agentbbs/core` via built `dist`; `beforeAll` build-if-stale (`tsc -b --force`). ✓
- **AC #5** — `roomIdBase('!!!')` → `room` (slug `''` fallback); core unit + helper unit + integration (`!!!`→`room`, `％％％`→`room-2`). ✓
- **AC #6 (Integration AC, Rule 1 + Rule 3)** — real `Client`↔`McpServer` over `InMemoryTransport` + real `createDataAccess` SQLite, NOTHING mocked. Proves durable `{project_id, room_id}` at rest (transitively via the mapper in mcp-server; AND directly via a raw better-sqlite3 connection in `queries.test.ts` lines 379-387), `NOT_A_MEMBER`, `BOARD_NOT_FOUND`, same-subject→distinct (`…`, `…-2`), plus `NO_IDENTITY`, discovery surface, verbatim hostile-Markdown/unicode fidelity, and Zod caps. Service-introducing story with its consumer wiring proven in-story → **Rule 1 satisfied**; genuine real-runtime test → **Rule 3 satisfied**. ✓

Brief checklist (all PASS):
1. **Append invariant (lint-enforced + meta-tested by `boundary-enforcement.test.ts`):** no `UPDATE`/`DELETE` on `events`; rooms projection FOLDS (`Map<roomId,Room>`), never stores; `active` derived (`false`); ordering by `seq`. Confirmed no production SQL `UPDATE`/`DELETE` against `events`.
2. **Module boundary (lint-enforced):** `core` imports only the `DataAccess` port (no better-sqlite3, no `@agentbbs/data-access`); uniqueness conflict duck-typed by `code === 'UNIQUENESS_CONFLICT'` (no error-class import). `post-announcement.ts` mirrors `announceProject` exactly.
3. **Core op shape:** gate-first; exactly-one-append; `roomIdForAttempt` 1-based ordinal (`base`, then `base-2` for the 2nd — matches AC); defensive bound `MAX_ROOM_ID_ATTEMPTS = 10_000` sound (no off-by-one — each attempt is a distinct monotonic candidate, every conflict permanently claims that id); post-append read-back via `eventsByActor(actor)` + `findRoom`, fail-loud-on-miss (cannot fabricate; reads OWN stream so a foreign same-id room can't leak).
4. **AC #4 concurrency** — see above; the genuine cross-process proof closes the retry-under-contention gap the dev's sequential tests left.
5. **AC #6 real-runtime** — see above; snake_case at-rest asserted.
6. **Payload change correctness:** `projectId` prepended to `AnnouncementPostedPayload` (was `{roomId,subject,body}` — never written to any ledger, so genuinely additive); BOTH mapping directions wired (`payloadToWire` emits `project_id`; `wireToPayload` reads it); `EventPayloadMap extends Record<EventType,object>` totality still compiles; all-10-types round-trip carries `projectId` byte-identical (mapping.test.ts + queries.test.ts real SQLite); at-rest key is `project_id` (snake_case, confirmed on disk).
7. **No new error code:** `NOT_A_MEMBER` + `BOARD_NOT_FOUND` reused from the closed `BOARD_ERROR_CODES`; `registerCoreTool` maps any thrown `BoardError`, so no `error-map.ts` edit. The `ANNOUNCEMENT_BODY_MAX_LENGTH = 16_000` cap is a plain Zod `.max()` raising a Zod validation error (NOT `BODY_TOO_LARGE`) — proven by the integration test asserting `readErrorPayload` is `undefined` on the over-cap reject — with an explicit Epic 5 Story 5.1 deferral note. **Rule 5 framing confirmed:** this is a planned scope boundary, not an NFR workaround.
8. **Full gate** — green, 353/55, as above.

Candidate findings (adversarial), all triaged DISMISS (no patch / no defer):
- TOCTOU between the membership gate (separate read txn) and the `appendGuarded` — DISMISS: membership is durable + monotonic in V1 (no un-join / un-announce events exist in the closed vocabulary), so the gate can only become more-true by append time; room-id uniqueness is independently atomic. Mirrors every existing op.
- Read-back uses `eventsByActor(actor)` not the global stream — DISMISS: a strength (only finds the room THIS actor just appended; fail-loud on miss), not a defect.
- `MAX_ROOM_ID_ATTEMPTS` exhaustion — DISMISS: unreachable (convergence = existing_same_base + 1; proven by the 8-way race); exceeding throws loud. Correctly-sized defensive guard.
- AC #6 at-rest snake_case is transitive in the mcp-server test — DISMISS: the literal on-disk `project_id`/`room_id` keys ARE directly asserted via raw connection in `queries.test.ts`; transitive is correct in mcp-server (the better-sqlite3 import-boundary lint forbids a raw connection there).
- `ANNOUNCEMENT_SUBJECT_MAX_LENGTH = 200` permits a 200-char slug — DISMISS: tested (at-cap accepted, over-cap Zod-rejected); the cap exists precisely to bound it.

No items added to `deferred-work.md` (none warranted). No `docs/adr/` registry → Rule 6 N/A.

## Tasks / Subtasks

- [x] Task 1: Add the board scope `projectId` to the `announcement.posted` payload + wire mapping (AC: #1, #6)
  - [x] In `packages/core/src/events/payloads.ts`, add `projectId: string` to `AnnouncementPostedPayload` (the board the announcement was posted to — the existing fields are `roomId`, `subject`, `body`). Document it (`/** Slug id of the sub-board (project) this announcement was posted to. */`). This is an ADDITIVE field on an event type that has NEVER been written to any ledger (Epic 4 is the first to post announcements) — it ratifies the Epic-1 placeholder shape, not a migration.
  - [x] In `packages/data-access/src/mapping.ts`, update BOTH directions for `announcement.posted`: `payloadToWire` (~line 101–103) to emit `{ project_id: p.projectId, room_id: p.roomId, subject: p.subject, body: p.body }`, and `wireToPayload` (~line 225–230) to read back `projectId: String(wire.project_id)`. Keep snake_case at rest (`project_id`, `room_id`).
  - [x] Extend the mapping round-trip test (the all-types real-runtime round-trip in `packages/data-access`) so `announcement.posted` carries `projectId` through write→read byte-identical. Update `payloads.test.ts` if it pins the announcement payload shape. _(Done: mapping.test.ts 3 samples + queries.test.ts 2 fixtures + a new on-disk `project_id`/`room_id` snake_case spot-check; payloads.test.ts gained an `announcement.posted` shape pin.)_
- [x] Task 2: Build the room-id allocation helper (AC: #1, #4, #5)
  - [x] Create `packages/core/src/rooms/room-id.ts`. Export a PURE base-deriver `roomIdBase(subject: string): string` = `slugify(subject)` (REUSE `packages/core/src/projects/slug.ts` — do NOT duplicate the slug algorithm) with the empty-subject fallback to the literal base `room` (so an all-punctuation subject still yields a non-empty base). Document that disambiguation is NOT done here (it requires a ledger read) — this helper only derives the deterministic base, mirroring how `slug.ts` keeps collision handling out of the pure helper.
  - [x] Unit-test `roomIdBase`: `"Calling Interface"` → `"calling-interface"`; `"!!!"` → `"room"`; whitespace → `"room"`; reuse mirrors `slugify`.
- [x] Task 3: Implement the `postAnnouncement` core op (AC: #1–#5)
  - [x] Create `packages/core/src/rooms/post-announcement.ts` exporting `postAnnouncement(dataAccess, actor, input)` where `input: { projectId, subject, body }` (camelCase; the MCP boundary maps snake_case→this, mirroring `AnnounceProjectInput`).
  - [x] Step 1 — membership gate: `await requireMembership(dataAccess, actor, projectId)` FIRST (REUSE `packages/core/src/projects/membership.ts`; this is its declared first consumer per the Story 3.5 Rule-1 escape clause). It throws `BoardError('BOARD_NOT_FOUND')` for an unknown board (AC #3) and `BoardError('NOT_A_MEMBER')` for a non-member (AC #2) — do NOT re-implement these checks; let the gate own them, then append only after it resolves.
  - [x] Step 2 — allocate a unique `roomId`: `base = roomIdBase(subject)`; try `appendGuarded([{ type: 'announcement.posted', actor, payload: { projectId, roomId, subject, body } }], [{ type: 'announcement.posted', field: 'room_id', value: roomId }])`. On an `isUniquenessConflict(err)` (the same duck-typed `code === 'UNIQUENESS_CONFLICT'` detector `announceProject` uses — core must NOT import the data-access error class, the lint-enforced boundary), increment the suffix (`base`, `base-2`, `base-3`, …) and retry. The loop converges (each conflict means that exact `roomId` now exists; the suffix increases monotonically). Add a defensive sanity bound on iterations and throw a loud non-domain error if exceeded (unreachable in practice).
  - [x] Step 3 — read back the just-posted proto-room through the rooms projection (Task 4) for the actor's stream (or `eventsSince(0)` if the projection needs the full ledger) and return it; fail loud if the just-appended room is not found (mirrors `announceProject`'s post-append read-back guard — never fabricate a record).
  - [x] Non-uniqueness errors (e.g. `StoreBusyError`) propagate as-is.
- [x] Task 4: Build the rooms projection (AC: #1, #6)
  - [x] Create `packages/core/src/rooms/projection.ts` with a `Room` record type and `foldRooms(events)` / `findRoom(events, roomId)` that fold `announcement.posted` into proto-room records: `{ roomId, projectId, subject, body, postedBy (actor), seq, active: false }`. (Activation — `active: true` when a `room.replied` exists, message #1 = the announcement — is Story 4.3; build the projection so 4.3/4.4 extend it, but only `announcement.posted` is folded here. Order by `seq`.)
  - [x] Export the new rooms surface from `packages/core/src/index.ts` (`postAnnouncement`, `PostAnnouncementInput`, `Room`, `foldRooms`, `findRoom`, `roomIdBase`) following the existing barrel grouping/comment style.
  - [x] Unit-test the projection (proto-room folds; `findRoom` miss → undefined; multiple rooms ordered by `seq`).
- [x] Task 5: Wire the `post_announcement` MCP tool (AC: #1, #2, #3, #6)
  - [x] Create `packages/mcp-server/src/tools/post-announcement.ts` mirroring `tools/announce-project.ts`: a Zod v4 input schema (`project_id`, `subject`, `body` — all non-empty strings with sane length caps; the formal 256 KB body cap + `BODY_TOO_LARGE` is Epic 5 Story 5.1, NOT this story — use a reasonable cap here and note the deferral), resolve the acting handle from the session (reuse the session/identity-shared helper the other post-style tools use), delegate to `core.postAnnouncement(dataAccess, actor, { projectId, subject, body })`, and return `structuredContent` (an object envelope, e.g. `{ room: { roomId, projectId, subject, body, postedBy, seq } }` — MCP `structuredContent` must be an object; follow the `{ project }`/`{ projects }` envelope convention).
  - [x] Map domain errors via the existing `error-map.ts`: `NOT_A_MEMBER`, `BOARD_NOT_FOUND` (both already in the closed error-code set from Epic 3 — confirm; add to the map only if missing). No new error code is introduced by this story. _(Confirmed both already in `BOARD_ERROR_CODES`; `registerCoreTool` maps any thrown `BoardError` → `{ code, message }`, so no `error-map.ts` edit was needed.)_
  - [x] Register the tool in `server.ts` (mirror how `announce_project` is registered) and confirm it appears in the tool list. _(Registered last in the factory; `server.bootstrap.test.ts`'s exhaustive tool-list assertion now includes `post_announcement`, and the integration test's discovery-surface case confirms it.)_
- [x] Task 6: Tests + full gate (AC: all)
  - [x] Add the real-runtime integration test `packages/mcp-server/src/tools/post-announcement.integration.test.ts` (mirror `announce-project.integration.test.ts`): real `Client`↔`McpServer` over `InMemoryTransport` + real `createDataAccess` SQLite ledger, proving AC #6 end-to-end (happy path round-trip; `NOT_A_MEMBER`; `BOARD_NOT_FOUND`; same-subject → distinct roomIds). Core unit tests for `postAnnouncement` (member happy path, non-member throw, unknown-board throw, disambiguator on collision, empty-subject fallback) over the in-memory/real fake.
  - [x] Run the full gate in honest order from repo root: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final test count (Epic 4 opened at 322 after Story 4.0). _(All green: lint clean; build 7/7; typecheck clean; test 347/347 across 54 files (+25 from 322); format --check clean.)_

## Dev Notes

This story introduces the FIRST Epic 4 service surface: the `post_announcement` MCP tool, the `postAnnouncement` core op, the `rooms` projection, and the room-id allocation helper. It is the FIRST consumer of the Story 3.5 membership write-gate (`requireMembership`), exactly as that story's Rule-1 escape clause forward-declared (Epic 4 4.1/4.3/4.5).

**Rule 1 (Integration ACs):** SATISFIED — AC #6 is a real-runtime Integration AC (the `post_announcement` tool, exercised over the real MCP server + real SQLite ledger, with the membership gate and disambiguator proven). Service-introducing, with its consumer wiring proven in-story.

**Rule 3 (real-runtime evidence):** the user-facing surface (`post_announcement`) MUST ship with a real `Client`↔`McpServer`-over-`InMemoryTransport` + real SQLite test (AC #6), not unit tests alone — the established Epic 2/3 bar (no tool approved on unit tests only).

**Rule 5 (NFR tripwire):** N/A — no NFR work. (The 256 KB body cap / `BODY_TOO_LARGE` is Epic 5 Story 5.1; this story uses a sane Zod length cap and explicitly defers the formal cap — note it, do NOT invent an NFR workaround.)

**Rule 6 (ADR):** N/A — no `docs/adr/` registry.

### Design decisions (grounded at story creation, baseline `ed9a0ed`)

1. **`post_announcement` is sub-board-scoped and takes `project_id`.** 4.1 gates on sub-board membership and 4.2 lists announcements per sub-board; `requireMembership` (Story 3.5) is `projectId`-scoped and 4.1 is its declared first consumer. So the tool takes `project_id` and the actor must be a member of THAT board.
2. **`projectId` is ADDED to `AnnouncementPostedPayload`.** The Epic-1 pre-wired payload (`{ roomId, subject, body }`) carried no board scope; since the announcement must record which sub-board it belongs to (for 4.2's per-board listing) and the payload is the only place to store it, `projectId` is added. Safe + additive: no `announcement.posted` event exists in any ledger yet (architecture.md line 247 — "starting shape, ratify at init"). Architecture line 332/335: adding within a type is additive; only renaming a type is breaking.
3. **Room id = `slugify(subject)` + disambiguator, GLOBALLY unique** (architecture.md line 347). This DIFFERS from projects: a project title collision REJECTS with `PROJECT_EXISTS` (3.1 dual guard), but an announcement subject collision DISAMBIGUATES (`calling-interface-2`) — many announcements may share a subject, and each `post_announcement` always creates a NEW proto-room. `roomId` is globally unique because `read_room` (4.4) / `reply` (4.3) reference a room by `roomId` alone (no `projectId` param), so the disambiguator-with-guard-retry guarantees a unique id even under concurrent same-subject posts.
4. **Empty-subject fallback base = `room`.** A subject with no `[a-z0-9]` slugs to `''`; rather than reject (no new error code) or store an empty `roomId`, fall back to the base `room` and disambiguate (`room`, `room-2`, …) — a proto-room is always created (AC #5). (Contrast Story 3.1's empty-slug title, which the boundary rejected; announcements never reject on the slug, they disambiguate.)
5. **No `board.joined` side effect here.** The actor is ALREADY a member (the gate requires it), so `post_announcement` appends only the one `announcement.posted` event. ("Acting = joining" is for `reply` (4.3) and `add_participant` (4.5), where the actor/target may not yet be a member.)

### Source facts (verified at story creation, baseline `ed9a0ed`)

- **`announcement.posted` payload** (`packages/core/src/events/payloads.ts:61`): currently `{ roomId, subject, body }` → add `projectId`. **Wire mapping** (`packages/data-access/src/mapping.ts`): `payloadToWire` case at ~line 101–103 (`{ room_id, subject, body }`), `wireToPayload` case at ~line 225–230 (`roomId: String(wire.room_id), …`). Event type `announcement.posted` already in `EVENT_TYPES`/`EventType` (`events/types.ts`) and `EventPayloadMap` (`payloads.ts:113`) — no type-set change needed.
- **`announceProject`** (`packages/core/src/projects/announce-project.ts`) is the structural template for the core op: `appendGuarded(events, guards)`, the duck-typed `isUniquenessConflict` (`code === 'UNIQUENESS_CONFLICT'`), and the post-append fail-loud read-back. **The KEY difference:** `announceProject` throws `PROJECT_EXISTS` on conflict; `postAnnouncement` RETRIES with a disambiguator instead.
- **`slugify`** (`packages/core/src/projects/slug.ts`) — pure `toLowerCase → replace [^a-z0-9]+ with '-' → trim '-'`; returns `''` for a no-alphanumeric title. REUSE it (Task 2 wraps it; do not re-implement).
- **`requireMembership` / `isMember`** (`packages/core/src/projects/membership.ts`) — `requireMembership(dataAccess, actor, projectId)` reads `eventsSince(0)`, `findProject`, throws `BOARD_NOT_FOUND` (unknown board) / `NOT_A_MEMBER` (board exists, not a member), else resolves void. Call it FIRST in `postAnnouncement`; it owns AC #2 + #3.
- **MCP tool pattern** (`packages/mcp-server/src/tools/announce-project.ts` + `announce-project.integration.test.ts`): Zod-validate → resolve session handle (`identity-shared.ts`/`project-shared.ts`) → thin delegate to core → `error-map.ts` → object `structuredContent`. Tool registration is in `packages/mcp-server/src/server.ts`. Reuse the session-handle resolution the other write tools use.
- **Error codes:** `NOT_A_MEMBER` and `BOARD_NOT_FOUND` were introduced in Epic 3 (closed set); confirm both are in `error-map.ts`. This story adds NO new error code.
- **`appendGuarded`** (`packages/core/src/ports.ts:91`): `appendGuarded(events, guards)` — a guard `{ type, field, value }` rejects (atomically rolls back) if an event of `type` already has at-rest `field === value`. Guard on `room_id` (snake_case at rest).
- Toolchain (verified Epics 1–3 + Story 4.0): Node v24.16.0 (`>=24`), pnpm 11.3.0. `python3` not on PATH (use `py`/`python` 3.13.7 if needed). Cross-package `core` exports are now visible to `mcp-server` tests AND typecheck from `src` (Story 4.0 — no build-first dance), but the gate still runs `build` before `test` for the forked cross-process workers.

### Project Structure Notes

- NEW core module `packages/core/src/rooms/` (`room-id.ts`, `post-announcement.ts`, `projection.ts` + co-located `*.test.ts`), paralleling `packages/core/src/projects/`. Export the public surface from the single `packages/core/src/index.ts` barrel (one barrel; do not add per-module entrypoints).
- NEW MCP tool `packages/mcp-server/src/tools/post-announcement.ts` + `post-announcement.integration.test.ts`; register in `server.ts`.
- `core` imports nothing from `data-access`/clients/better-sqlite3 — only the `DataAccess` port (lint-enforced). The uniqueness-conflict signal is duck-typed by `code`, never by importing the data-access error class.
- THE APPEND INVARIANT (lint-enforced): every state change is an appended event; no `UPDATE`/`DELETE` on `events`; order by `seq`, never `created_at`; derived state (proto-room records, membership) computed by query every time — no stored `status`/membership columns.

## Dev Agent Record

### Implementation summary

Implemented in the story's task order, each task red→green against co-located tests, then the full gate.

- **Task 1 (payload + wire):** added `projectId: string` (board scope) as the first field of `AnnouncementPostedPayload` (`packages/core/src/events/payloads.ts`) — additive on an event type never yet written to any ledger. Wired BOTH mapping directions for `announcement.posted` (`packages/data-access/src/mapping.ts`): `payloadToWire` emits `{ project_id, room_id, subject, body }`; `wireToPayload` reads `projectId: String(wire.project_id)`. Extended the round-trip tests (`mapping.test.ts`, `events/payloads.test.ts`, `sqlite/queries.test.ts`) and added an on-disk snake_case spot-check proving `project_id`/`room_id` (not the camelCase forms) are literally on disk through the real SQLite round-trip.
- **Task 2 (`rooms/room-id.ts`):** pure `roomIdBase(subject)` = `slugify(subject)` (reused from `projects/slug.ts`, NOT duplicated) with empty-subject fallback to the literal base `room` (`EMPTY_SUBJECT_ROOM_BASE`). No disambiguation here (that needs a ledger read) — mirrors how `slug.ts` keeps collision handling out of the pure helper.
- **Task 3 (`rooms/post-announcement.ts`):** `postAnnouncement(dataAccess, actor, { projectId, subject, body })`. Step 1 `requireMembership` FIRST (its declared first consumer; owns `BOARD_NOT_FOUND`/`NOT_A_MEMBER`, nothing appended on rejection). Step 2 allocates a globally-unique `roomId` via `appendGuarded` with a single `room_id` guard + disambiguator retry (`base`, `base-2`, …); conflict detected by the duck-typed `code === 'UNIQUENESS_CONFLICT'` (core does NOT import the data-access error class); defensive `MAX_ROOM_ID_ATTEMPTS` bound. Step 3 reads back via `eventsByActor` → `findRoom`, fails loud on a miss. Non-uniqueness errors propagate as-is.
- **Task 4 (`rooms/projection.ts`):** `Room` record + `foldRooms`/`findRoom`, folding ONLY `announcement.posted` (keyed by `roomId`, ordered by `seq`), `active: false` always (Story 4.3 flips it via `room.replied`). Exported the rooms surface (`postAnnouncement`, `PostAnnouncementInput`, `Room`, `foldRooms`, `findRoom`, `roomIdBase`) from the single core barrel.
- **Task 5 (`tools/post-announcement.ts` + `tools/room-shared.ts`):** thin tool mirroring `announce-project.ts` — Zod schema (`project_id` REUSES `project-shared.ts`'s `projectIdSchema`; `subject`/`body` are new in `room-shared.ts`), session-handle precondition (`NO_IDENTITY`), thin delegate to `core.postAnnouncement`, `{ room }` object `structuredContent` envelope + mirrored JSON text block. Registered in `server.ts`. No new error code.
- **Task 6:** real-runtime integration test (`tools/post-announcement.integration.test.ts`) over real `Client`↔`McpServer`/`InMemoryTransport` + real `createDataAccess` SQLite — proves AC #6 (durable round-trip, `NOT_A_MEMBER`, `BOARD_NOT_FOUND`, same-subject→distinct roomIds) plus `NO_IDENTITY` + discovery surface. Core unit tests for the op/projection/helper.

### Completion notes

- **All 6 ACs satisfied.** AC #1 (append + derived proto-room + return) — core op + projection unit tests + integration happy-path; AC #2 `NOT_A_MEMBER` / AC #3 `BOARD_NOT_FOUND` (nothing appended) — core unit + integration; AC #4 disambiguator (distinct roomIds, no lost write) — core unit (`-2`, `-3`) + integration; AC #5 empty-subject `room` fallback — helper + core unit; AC #6 real-runtime — the integration suite.
- **Rule 3 (real-runtime evidence):** SATISFIED — the user-facing `post_announcement` ships with the real `Client`↔`McpServer`-over-`InMemoryTransport` + real SQLite test, not unit tests alone.
- **Rule 5 (NFR tripwire):** N/A — no NFR work; the 256 KB body cap / `BODY_TOO_LARGE` is explicitly deferred to Epic 5 Story 5.1 (interim sane Zod cap `ANNOUNCEMENT_BODY_MAX_LENGTH = 16_000` with a deferral comment; NO `BODY_TOO_LARGE` added). No planning artifact amended.
- **Rule 6 (ADR):** N/A — no `docs/adr/` registry.
- **APPEND INVARIANT:** upheld — one appended `announcement.posted` per post; no `UPDATE`/`DELETE`; proto-room state is computed by `foldRooms`, never stored; `active` is derived (`false`); ordering by `seq`. Lint (incl. the better-sqlite3 + deep-import boundary rules) green.
- **Decisions of note:** (1) extracted room-field boundary plumbing into a new `tools/room-shared.ts` (parallel to `project-shared.ts`) for the Epic-4 room tools; (2) the at-rest `{ project_id, room_id }` assertion in the integration test is transitive (the better-sqlite3 import boundary forbids opening a raw connection from `mcp-server`), but the data-access `queries.test.ts` opens a raw connection to assert the literal on-disk snake_case keys; (3) the disambiguator suffix is the 1-based ordinal (`base-2` for the 2nd room), matching the story's `calling-interface-2` convention.
- **Pre-existing fixtures updated (additive-field fallout):** the new required `projectId` forced two `announcement.posted` constructors in `sqlite/queries.test.ts` and the exhaustive tool-list assertion in `server.bootstrap.test.ts` to be updated — the compile/test guard working as intended, not a regression.

### File List

**Created**
- `packages/core/src/rooms/room-id.ts`
- `packages/core/src/rooms/room-id.test.ts`
- `packages/core/src/rooms/projection.ts`
- `packages/core/src/rooms/projection.test.ts`
- `packages/core/src/rooms/post-announcement.ts`
- `packages/core/src/rooms/post-announcement.test.ts`
- `packages/mcp-server/src/tools/room-shared.ts`
- `packages/mcp-server/src/tools/post-announcement.ts`
- `packages/mcp-server/src/tools/post-announcement.integration.test.ts`

**Modified**
- `packages/core/src/events/payloads.ts` (added `projectId` to `AnnouncementPostedPayload`)
- `packages/core/src/events/payloads.test.ts` (pin the new announcement shape)
- `packages/core/src/index.ts` (export the rooms surface)
- `packages/data-access/src/mapping.ts` (both directions: `project_id` ⇄ `projectId`)
- `packages/data-access/src/mapping.test.ts` (announcement samples carry `projectId`)
- `packages/data-access/src/sqlite/queries.test.ts` (2 announcement fixtures + on-disk `project_id`/`room_id` spot-check)
- `packages/mcp-server/src/server.ts` (register `post_announcement`)
- `packages/mcp-server/src/server.bootstrap.test.ts` (exhaustive tool-list assertion includes `post_announcement`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status → in-progress → review)

### Change Log

- 2026-05-31 — Story 4.1 implemented: `post_announcement` MCP tool + `postAnnouncement` core op + rooms projection + room-id helper; added `projectId` to `announcement.posted` (additive). Full gate green (lint / build 7-7 / typecheck / test 347 across 54 files, +25 from 322 / format --check). Status → review.
