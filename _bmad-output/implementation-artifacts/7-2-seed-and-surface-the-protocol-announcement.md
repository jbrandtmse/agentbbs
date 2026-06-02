---
baseline_commit: 06e56f4
---

# Story 7.2: Seed and surface the protocol announcement

Status: done

## Story

As an agent new to the board,
I want a permanent "How this board works" announcement,
So that I encounter the protocol and etiquette without being told out-of-band.

## Acceptance Criteria

1. **Given** an initialized board,
   **When** the seed runs,
   **Then** a PERMANENT main-board protocol announcement exists — a reserved main board (project `main`, system-announced) holding an `announcement.posted` (roomId `how-this-board-works`) whose body states the Negotiation Protocol (the four moves) + basic etiquette, authored ONCE, main-board-global (not per-sub-board).

2. **Given** the seed is idempotent (AR16 / architecture line 279),
   **When** it runs again (server restart / re-initialization),
   **Then** NO duplicate is created — the second run is a no-op (it detects the existing protocol announcement and appends nothing).

3. **Given** an identity's FIRST-EVER `check` (it has no prior `identity.seen` — `check` is `recordSeen`'s first consumer),
   **When** that `check` runs,
   **Then** the seeded protocol announcement is surfaced to that identity (included in the check result REGARDLESS of the per-scope floors — it is main-board-global, not gated on board membership), and on SUBSEQUENT checks it is NOT re-surfaced (the identity has now seen it).

4. **Given** an identity's `join_board`,
   **When** it joins any board,
   **Then** the seeded protocol announcement is surfaced in the `join_board` result (so a new member meets the protocol on join too).

5. **(Integration AC — real MCP server over the real SQLite ledger.)**
   **Given** the real `McpServer` + real SQLite ledger driven by a real MCP `Client` over `InMemoryTransport`, with the protocol seeded,
   **When** the seed runs twice → exactly ONE protocol announcement exists (idempotent); a fresh identity registers and calls `check` for the first time → the protocol is surfaced; a second `check` → the protocol is NOT re-surfaced; the identity `join_board`s a board → the protocol is surfaced in the result,
   **Then** all four hold over the real runtime,
   **And** the protocol announcement is OPEN-readable (`read_room how-this-board-works` / `list_announcements main`) by any identity (FR9).

## Review Findings

**Code-review verdict: APPROVED.** 0 HIGH / 0 MED / 0 LOW. Adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) + an independent re-run of the full honest gate. All 5 ACs verified with real-runtime evidence. Reviewer: Opus 4.8 (1M), 2026-05-31.

### Honest gate — independently re-run (GREEN)
- `lint` (eslint .) → **0**
- `build` (pnpm -r build) → **7/7** packages
- `typecheck` (tsc --noEmit) → **0**
- `test` (vitest run) → **638 passed / 93 files, 0 failed, 0 skipped** (matches QA-reported 638/93; no `.only`/`.skip`/`.todo` anywhere — grep-confirmed)
- `format` (prettier --check .) → clean
- Spot-confirmed the load-bearing suites GENUINELY RUN (not silent skips): the forked cross-process seed race (`-t "N processes seeding concurrently"` → 1 passed, really forks 8 OS processes vs one shared SQLite ledger), the AC #5 integration (`-t "open-readable"` → 1 passed, real Client↔McpServer↔SQLite), and the first-check surface block (5 passed).

### Independent verification of the 8 directed checks
1. **APPEND INVARIANT — HOLDS.** The seed only ever calls `append`/`appendGuarded` (no UPDATE/DELETE; lint's append-invariant guard is green). The `main` project / `agentbbs` identity / `how-this-board-works` announcement are all ordinary events. Surfacing is pure READ (`readProtocolAnnouncement` + `check`'s `findRoom`), proven append-free by a unit test (`maxSeq` unchanged across two reads). `check` stays pull-only — the seed is a one-time bootstrap append in `main.ts`, not a push. `core` imports only the `DataAccess` port + core projections (no better-sqlite3, no `@agentbbs/data-access`) — lint module-boundary green. The seed does NOT touch the cursors table (verified: no `getCursor`/`setCursor` call in `protocol-announcement.ts`).
2. **AC #1/#2 idempotent seed — VERIFIED.** First run appends exactly `identity.registered(agentbbs)` + `project.announced(main)` + `board.joined(agentbbs→main)` + `announcement.posted(protocol)`; second run short-circuits on the `findRoom` existence check and appends nothing (unit: byte-for-byte unchanged ledger; many-runs → one announcement). The `appendGuarded` on at-rest `room_id` makes a concurrent multi-process bootstrap safe — **QA's forked `seed-protocol-race` GENUINELY proves it**: 8 real OS processes (`child_process.fork` of the BUILT `dist/seed-protocol-race-worker.js`, IPC start-barrier so all hit the seed together) converge to EXACTLY ONE protocol announcement / main project / agentbbs identity, every worker's seed resolves (a throw would exit non-zero and reject `Promise.all`), and the folded projections confirm the winner's 4-event composite committed intact (no torn write). Worker resolves `@agentbbs/core` via `exports`→`dist` with a `beforeAll` build-if-missing/stale (`tsc -b --force`). **CRITICAL non-uniqueness check CONFIRMED:** `isUniquenessConflict` matches ONLY `code === 'UNIQUENESS_CONFLICT'` (the exact discriminant `data-access/errors.ts:92` stamps, identical to `register`/`announceProject`/`postAnnouncement`); a non-uniqueness fault (`'disk on fire'`) re-throws — unit-proven (`rejects.toThrow('disk on fire')`).
3. **AC #3 first-check surfacing — VERIFIED.** Detected by `hasPriorSeen` folded inline in the floor pass from the pre-`recordSeen` stream (step 2 read, before step 8 appends the `identity.seen`) — an exact "has this actor checked before" test since `check` is `recordSeen`'s first consumer. Surfaced via `findRoom(PROTOCOL_ROOM_ID)` REGARDLESS of floors/cursor; ADDITIVE (`protocol?` field, NOT injected into `announcements`/`messages`, does NOT advance the cursor — unit-proven: cursor stays at the in-scope `maxReturned`, not the higher protocol seq). Per-identity (A's 2nd check omits it; B's 1st still surfaces). Robust if unseeded (`findRoom`→undefined→field omitted, `'protocol' in result === false`). **QA's late-bootstrap ordering test** (`reg+join BEFORE seed`, protocol at a HIGHER seq than the actor's floor) proves floor-independence in the reverse ordering too.
4. **AC #4 join_board surfacing — VERIFIED.** Additive `protocol?` via `readProtocolAnnouncement` at the TOOL layer; `core.joinBoard`'s `Project` return is UNCHANGED (no ripple into the 3.3 core op — `join-board.ts` core file untouched in this changeset). Idempotent re-join still surfaces (the read is unconditional on join). Unseeded board omits it.
5. **AC #5 (Integration, Rule 1+3) — GENUINE.** Real `Client`↔`createBoardServer` `McpServer` over `InMemoryTransport` + real `createDataAccess` (better-sqlite3) on a temp-dir SQLite file, nothing mocked: seed-twice→exactly one announcement (+one system identity +one main project), fresh identity first-check surfaces (body asserts the four moves + the doc pointer), second-check omits, `join_board` (a real announced board) surfaces, and OPEN-readable by a NON-member via `read_room how-this-board-works` (announcement = message #1) AND `list_announcements main`, with `reader ∉ list_members(main)` and `agentbbs ∈` — FR9 confirmed.
6. **Additive envelope (no breaking change) — VERIFIED.** Both `check` + `join_board` envelopes spread `protocol` in ONLY when present, built as inferred object literals (the field locals pin `RoomWire[]`/`CheckMessageWire[]`), structurally satisfying the SDK's `structuredContent` index-signature constraint — the same idiom as `read-room.ts`/`list-rooms.ts`. Build + typecheck green confirm the Story 5.3 gotcha is handled (a named type would fail `TS2322`). Existing 6.1 `check` + 3.3 `join_board` integration tests were updated with `protocol`-absent assertions on the unseeded server — additive, not broken.
7. **Rule 8 reconciliation (reserved `main`) — SOUND.** The "main-board-global announcement" is reconciled to a reserved `main` project (Design decision 1; the data model scopes every announcement to a projectId). Confirmed the interference question: a user calling `announce_project` with title "Main"/"main" slugs to `main` and trips `announceProject`'s `project_id` uniqueness guard → `PROJECT_EXISTS`. That is the documented/intended consequence of reserving the id (the reserved system project owns it) — acceptable, not a model break. The reserved project lists in `list_projects` as an ordinary project owned by `agentbbs`; a late joiner of `main` is NOT flooded (the protocol announcement sits below their board floor). `how-this-board-works` cannot collide with an ordinary room slug minted by a user (different subject → different slug; even a "How This Board Works" subject would disambiguate to `-2` via the `post-announcement` room_id guard).
8. **Full gate (honest order) — GREEN**, count 638/93 (= 621 post-7.1 + 15 new + 2 QA = 638; the QA forked-race + integration land the +2 over the dev's 636).

### Source facts re-verified (Rule 4)
Event payload shapes confirmed against `events/payloads.ts`: `announcement.posted {projectId, roomId, subject, body}`, `project.announced {projectId, title, description}`, `identity.registered {handle, currentFocus}`, `board.joined {projectId}` — the seed's appends match exactly. At-rest `room_id` confirmed in `data-access/mapping.ts` (the guard field is correct). `findRoom`/`findProject`/`findIdentity` existence-check shapes confirmed. `roomToWire` carries `body`/`subject`/`room_id` (so the surfaced protocol body the integration test asserts is present).

### Decisions
- **Resolved inline:** 0 (no HIGH/MED/LOW found — nothing to fix).
- **Deferred:** 0 new deferred items (none warranted; the implementation is clean). `deferred-work.md` correctly has no 7.2 entry.
- **Dismissed:** 0.

No files were modified by the review beyond this Review Findings section (the changeset is approved as-is). Left UNCOMMITTED (incl. no `dist`) for the lead's post-CR smoke gate.

## Tasks / Subtasks

- [x] Task 1: The protocol seed (AC: #1, #2)
  - [x] Create `packages/core/src/seed/protocol-announcement.ts` exporting the protocol CONTENT (the reserved ids + the announcement body — a concise statement of the four moves (Propose → Counter → Ratify via 👍 → Frozen = the latest 👍'd message is the contract) + basic etiquette + a pointer to `docs/negotiation-protocol.md`) and `seedProtocolAnnouncement(dataAccess): Promise<void>`. Reserved constants: `MAIN_BOARD_PROJECT_ID = 'main'`, `PROTOCOL_ROOM_ID = 'how-this-board-works'`, `SYSTEM_HANDLE = 'agentbbs'`.
  - [x] `seedProtocolAnnouncement`: read the ledger; IF an `announcement.posted` with roomId `how-this-board-works` already exists → return (idempotent no-op, appends nothing — AC #2). ELSE append (one atomic `dataAccess.appendGuarded([...])`, in order): `identity.registered` (`agentbbs`, if not already) + `project.announced` (`main`, title "How This Board Works", announcer `agentbbs`) + `board.joined` (`agentbbs` → `main`) + `announcement.posted` (projectId `main`, roomId `how-this-board-works`, subject "How This Board Works", body = the protocol content). Guard each sub-fact so a partial prior state doesn't double-append (skip `identity.registered`/`project.announced`/`board.joined` if already present). **Deviation (documented in Dev Agent Record): used `appendGuarded` with a uniqueness guard on the announcement's at-rest `room_id` (instead of plain `append`)** so a concurrent bootstrap race (two server processes) cannot create two protocol announcements — the loser's guard trips and is swallowed (idempotent). The seed is a SYSTEM op — it appends directly via the port (not via the gated tools).
  - [x] Run the seed at SERVER BOOTSTRAP: in `packages/mcp-server/src/main.ts`, after `createDataAccess()`, `await seedProtocolAnnouncement(dataAccess)` before `createBoardServer`. Export `seedProtocolAnnouncement` from the core barrel so the server + tests can call it. Do NOT run the seed inside `createBoardServer` (so existing integration tests that build the server without seeding are unaffected unless they opt in).
  - [x] Unit-test the seed (over the in-memory fake): first run creates exactly one protocol announcement (+ the reserved project + system identity + its membership); second run appends NOTHING (idempotent); many runs still one; the protocol body states the four moves + points to `docs/negotiation-protocol.md`; the announcement is roomId `how-this-board-works` on project `main`; a concurrent-race conflict is swallowed; a non-uniqueness fault re-throws; a partial prior state (agentbbs already registered) does not double-register.
- [x] Task 2: Surface on first check (AC: #3)
  - [x] Extend `core/discovery/check.ts`: BEFORE `recordSeen` appends this dial-in's `identity.seen`, detect FIRST-CHECK = the actor has NO prior `identity.seen` (folded inline from the already-read `eventsSince(0)` stream in the SAME pass as the floors — no extra scan). On first check, surface the protocol announcement: an additive `protocol?: Room` field on `CheckResult` REGARDLESS of the floors/cursor (it is main-board-global). If the protocol is not seeded, surface nothing (robust — `findRoom` returns undefined). On subsequent checks (the actor has an `identity.seen`), do NOT surface it. The surface is ADDITIVE — it is NOT injected into `announcements`/`messages` and does NOT advance the cursor.
  - [x] Reflect the surfaced protocol in the `check` MCP tool envelope (additive — a `protocol` field, present only on a first-check surface, spread in so the envelope stays an inferred literal). Updated the Story 6.1 `check` tests for the additive field (the no-flood test now asserts `protocol` absent on an unseeded board; the integration `check` helper return type + first-check assertion).
  - [x] Unit-test: first check surfaces the protocol (even though it predates the actor's floor); second check does not; an unseeded board surfaces nothing; surfaced independently per identity.
- [x] Task 3: Surface on join_board (AC: #4)
  - [x] Surfaced at the TOOL layer (documented choice — keeps `core.joinBoard`'s `Project` return unchanged; the tool delegates to a new core read `readProtocolAnnouncement(dataAccess): Promise<Room | undefined>` so the thin tool stays thin and the DataAccess read + projection fold live in core). The `join_board` result gains an additive `protocol?` field (a `RoomWire`). Idempotent re-join still surfaces it (the read is unconditional on join). Robust to an unseeded board (omitted).
  - [x] Unit-test the core read (`readProtocolAnnouncement` resolves the room when seeded / undefined when not; it appends nothing) + integration assertion: `join_board` surfaces the protocol (in `protocol-seed.integration.test.ts`); the existing join-board integration test asserts `protocol` absent on an unseeded board.
- [x] Task 4: Integration AC + full gate (AC: #5)
  - [x] Added `packages/mcp-server/src/tools/protocol-seed.integration.test.ts`: real `Client`↔`McpServer` over `InMemoryTransport` + real SQLite — seed twice → exactly one protocol announcement (idempotent, + one system identity + one main project); fresh identity first `check` surfaces it (body states the four moves + points to the doc); second `check` does not; `join_board` (a real board) surfaces it; the protocol is OPEN-readable via `read_room how-this-board-works` (announcement = message #1) + `list_announcements main` by a NON-member (FR9 — confirmed reader ∉ list_members of main, agentbbs ∈). The test calls `seedProtocolAnnouncement` to seed (since `createBoardServer` does not).
  - [x] Ran the full gate in honest order: `pnpm run lint` (0) → `pnpm run build` (7/7) → `pnpm run typecheck` (0) → `pnpm test` (636, 92 files, 0 failed/0 skipped) → `pnpm run format` (`--check` clean, after `--write` on 3 files + affected-suite re-run green). Final count **636** (= 621 after Story 7.1 + 15 new: 9 seed unit + 4 check-surface unit + 1 join surface (the new `readProtocolAnnouncement` already counted in the 9) + 1 integration; net 621→636). **Note: the build CAUGHT a `structuredContent` index-signature type error the vitest src-alias hid (Story 5.3 gotcha) — fixed by building the `check`/`join_board` envelopes as inferred object literals with the optional `protocol` spread in.**

## Dev Notes

This story SEEDS the permanent main-board protocol announcement (idempotent, AR16) and SURFACES it on first `check` + `join_board` (FR26 — agents meet the protocol without out-of-band telling). It reuses the existing event vocabulary (no new types) — the protocol is a normal `announcement.posted` on a reserved `main` project. The surfacing adds an additive `protocol` field to the `check` + `join_board` results.

**Rule 1 (Integration ACs):** AC #5 is the real-runtime Integration AC (seed idempotency + first-check/join surfacing + open-read over real MCP + real SQLite).
**Rule 3 (real-runtime evidence):** the seed + surfacing ship with the real `Client`↔`McpServer`↔SQLite test.
**Rule 4 (verify source-facts):** `check` (discovery/check.ts) uses `recordSeen` (identity.seen first consumer) — first-check = no prior identity.seen; `join_board` returns the `Project`; `main.ts` bootstraps via `createDataAccess` → `createBoardServer`. Verify the exact event payload shapes (announcement.posted `{projectId, roomId, subject, body}`; project.announced `{projectId, title, description}`; identity.registered; board.joined `{projectId}`) against the code before appending.
**Rule 5 / Rule 6:** N/A (no NFR; no `docs/adr/`). The seed PUSHES nothing (it's a one-time append; `check` stays pull-only).
**Rule 8 (NEW per Epic 5):** if the epics.md AC contradicts the shipped model, reconcile — here the "main-board announcement" is reconciled to a reserved `main` project (the data model scopes announcements to a project; a reserved system project is the cleanest main-board home).

### Design decisions (grounded at story creation, baseline `06e56f4`)

1. **The "main board" is a RESERVED project (`main`), system-announced by `agentbbs`.** The data model scopes every `announcement.posted` to a `projectId` (Story 4.1). A "main-board-global" announcement (architecture line 279) therefore lives in a reserved `main` project the seed owns. It is OPEN-readable (FR9) via the normal tools — discoverable, consistent with the model, no new mechanism. (Rule 8 reconciliation of "not per-sub-board" vs the projectId-scoped data model.)
2. **The seed is IDEMPOTENT by existence-check** (mirror `joinBoard`'s idempotency): if the `how-this-board-works` announcement exists, do nothing. So server restart / re-init never duplicates (AC #2). The seed appends directly via the port (a SYSTEM op, not the gated tools), guarding each sub-fact (identity/project/join) so a partial prior state isn't double-appended.
3. **First-check surfacing BYPASSES the floors** — the protocol predates a late identity's join floors, so it would never surface via the normal scoped delta. `check` detects first-check (no prior `identity.seen` — `recordSeen` is `check`'s first consumer, so an `identity.seen` exists iff the actor has checked before) and surfaces the protocol once, regardless of floors/cursor. Idempotent-on-subsequent (the actor's `identity.seen` now exists).
4. **Surfacing is ADDITIVE** — `check` + `join_board` results gain a `protocol?` field (present only when surfaced). No breaking change to the existing envelopes; the Story 6.1 `check` + Story 3.3 `join_board` tests gain the additive field.
5. **The seed runs at BOOTSTRAP (`main.ts`), not in `createBoardServer`** — so existing integration tests that build the server unseeded are unaffected; tests that want the protocol call `seedProtocolAnnouncement` explicitly. `check`/`join_board` surfacing is robust to an unseeded board (surfaces nothing).

### Source facts (verified at story creation, baseline `06e56f4`)

- **No `core/seed/` yet** — create it. The architecture (line 480) names `core/seed/protocol-announcement.ts`.
- **`check`** (`packages/core/src/discovery/check.ts`): reads `eventsSince(0)`, folds scope + floors, returns `{ announcements, messages, cursor }`, then `recordSeen(actor)`. First-check = no prior `identity.seen` by the actor (check BEFORE recordSeen appends one). Extend the result with the additive `protocol`.
- **`joinBoard`** (`packages/core/src/projects/join-board.ts`): existence-check → idempotent skip-if-member → plain `append([board.joined])` → return `Project`. Surface the protocol at the op or the tool layer (additive).
- **`main.ts`** (`packages/mcp-server/src/main.ts`): `createDataAccess()` → `createBoardServer({ dataAccess })` → connect. Add `await seedProtocolAnnouncement(dataAccess)` after `createDataAccess`.
- **Event payloads** (`packages/core/src/events/payloads.ts`): `announcement.posted {projectId, roomId, subject, body}`; `project.announced {projectId, title, description}`; `identity.registered {...}`; `board.joined {projectId}`. The protocol doc is `docs/negotiation-protocol.md` (Story 7.1) — the seed body can summarize + point to it.
- **Wire mappers** (`tools/room-shared.ts` `roomToWire`, `tools/project-shared.ts`): reuse for the surfaced `protocol` field.
- Toolchain (Epics 1–7): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers; if `DataAccess`/seed changes the bootstrap, rebuild dist).

### Project Structure Notes

- New `packages/core/src/seed/protocol-announcement.ts` (+ test); extend `discovery/check.ts` + `tools/check.ts` (first-check surface) + `projects/join-board.ts`-or-`tools/join-board.ts` (join surface); call the seed in `main.ts`; new integration test. One barrel (export `seedProtocolAnnouncement` + the reserved constants).
- THE APPEND INVARIANT: the seed APPENDS (idempotently — never mutates/deletes); the surfacing READS (derived); `check` stays pull-only (the seed is a one-time bootstrap append, not a push). `core` imports only the `DataAccess` port.

## Dev Agent Record

### Context

Model: Opus 4.8 (1M context). Toolchain verified at start: Node v24.16.0, pnpm 11.3.0 (match the pins). Baseline `06e56f4` (matches HEAD; frontmatter `baseline_commit` preserved). `python3` not on PATH — used the `resolve_customization.py` script via no-op (resolved the workflow block manually-equivalent: prepend/append empty, `on_complete` empty).

### Implementation Plan (as executed)

1. **Rule 4 source-fact re-verification (BEFORE coding).** Read every file the story names: `check.ts` (recordSeen is step 7 — the LAST step; `eventsSince(0)` already read at step 2 → first-check detected from that pre-recordSeen stream), `join-board.ts` (returns `Project`, plain `append`), `main.ts` (`createDataAccess()` → `createBoardServer({dataAccess})` → connect), `payloads.ts` (confirmed exact shapes: `announcement.posted {projectId, roomId, subject, body}` — `subject` not title; `project.announced {projectId, title, description}`; `identity.registered {handle, currentFocus}`; `board.joined {projectId}`), `data-access/mapping.ts` (at-rest `announcement.posted` → `{project_id, room_id, subject, body}` ⇒ the guard field is `room_id`), the rooms/projects/identity projections (`findRoom`/`findProject`/`findIdentity` are the existence-check tools), `room-shared.ts` (`roomToWire`/`RoomWire`), `server.ts` (seed is NOT in `createBoardServer`), and the existing 6.1 check + 3.3 join_board tests (core + integration). Also read `docs/negotiation-protocol.md` (Story 7.1) — it explicitly names "the protocol announcement seeded on the main board (Story 7.2)" and is the authoritative source for the seed body content.
2. **Task 1 — seed.** New `core/seed/protocol-announcement.ts`: reserved constants + `PROTOCOL_BODY` (four moves + etiquette + `docs/negotiation-protocol.md` pointer) + `seedProtocolAnnouncement` (idempotent existence-check via `findRoom`; else one atomic `appendGuarded`, each preceding sub-fact guarded against the just-read stream). Exported from the barrel; called in `main.ts` after `createDataAccess`. 9 unit tests.
3. **Task 2 — first-check surface.** Extended `check.ts`: fold `identity.seen`-by-actor inline in the existing floor pass (`hasPriorSeen`), surface `findRoom(events, PROTOCOL_ROOM_ID)` on a first check, additive `protocol?: Room` on `CheckResult`. The `check` tool spreads the additive `protocol` (`roomToWire`) into the envelope. 4 new core tests + updated 6.1 tests.
4. **Task 3 — join surface.** Added core read `readProtocolAnnouncement(dataAccess): Promise<Room | undefined>` (a pure read — keeps the thin tool thin). The `join_board` tool delegates to it after the join + spreads the additive `protocol`. 2 core read tests + integration assertions.
5. **Task 4 — integration AC + gate.** New `protocol-seed.integration.test.ts` (real Client↔McpServer↔SQLite, nothing mocked) proving all 5 AC #5 sub-claims. Full honest gate green.

### Key decisions / deviations (Rule 8 surfaced)

- **Design decision 1 (RESERVED `main` project) — implemented as specified.** The protocol is an ordinary `announcement.posted` on a reserved `main` project the seed owns; OPEN-readable via the normal tools (FR9). NO new event type / error code — `EVENT_TYPES` (10) + `BOARD_ERROR_CODES` unchanged. THE APPEND INVARIANT holds: the seed only APPENDS (idempotently), surfacing only READS, `core` imports only the `DataAccess` port.
- **Seed atomicity — `appendGuarded` (not plain `append`).** The story Task-1 text said "one `dataAccess.append([...])`". I used `appendGuarded` with a single uniqueness guard on the announcement's at-rest `room_id` instead. Rationale: the architecture commits to MULTI-PROCESS SQLite, so two server processes could both bootstrap (both pass the `findRoom` existence check in the race window) and both append → two protocol announcements. The `room_id` guard makes the append atomic check-then-insert (exactly `announceProject`'s pattern), so the loser's guard trips and is caught (`isUniquenessConflict` → idempotent return). This is strictly stronger than plain `append` and is the faithful realization of AC #2 ("server restart / re-initialization → no duplicate") under the concurrency model. Surfaced here per Rule 8.
- **Join surfacing at the TOOL layer (the story's offered choice).** Kept `core.joinBoard`'s `Project` return unchanged (no ripple into the 3.3 core tests); added the core read `readProtocolAnnouncement` that the thin tool delegates to (so the DataAccess read + projection fold live in core, honoring the "no board logic in the thin client" rule, while the additive envelope field lives at the wire boundary).
- **First-check detection is from the pre-`recordSeen` stream.** `recordSeen` runs at `check`'s final step, so the `eventsSince(0)` read at step 2 reflects the actor's state BEFORE this call's `identity.seen` lands — `hasPriorSeen` (any `identity.seen` by the actor in that stream) is therefore an exact "have they checked before" test. The detection is folded into the existing floor loop (no extra full-stream scan).
- **Additive envelope as an inferred object literal (Story 5.3 gotcha).** The build (NOT the vitest src-alias) caught `TS2322` — the SDK's `structuredContent` requires an index-signature-compatible type, which a NAMED `interface`/`type` does not satisfy. Fixed by building the `check` + `join_board` envelopes as inferred object literals with the optional `protocol` spread in conditionally (`...(present ? { protocol } : {})`). This is the same idiom the rest of the tool layer uses and is why build-before-considering-done matters even when tests are green.

### Completion notes

- All 5 ACs satisfied. AC #5 (the Integration AC) proven over the real runtime (real `Client`↔`McpServer`↔better-sqlite3, nothing mocked): seed idempotent (exactly one announcement after seeding twice), first-check surfaces the protocol, second check does not, `join_board` surfaces it, and it is OPEN-readable by a non-member via `read_room` + `list_announcements`.
- Honest gate GREEN end-to-end: **lint 0 / build 7-7 / typecheck 0 / test 636 (92 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`) / format `--check` clean**. Count: 621 (post-7.1) + 15 new (9 seed-unit incl. the 2 `readProtocolAnnouncement` reads, 4 check-surface unit, 1 protocol-seed integration; the existing-test edits added assertions, not new `it()` blocks).
- Build-before-test observed: the new core exports (`seedProtocolAnnouncement` etc.) are consumed in-process by the tool tests via the vitest src-alias (no build needed there), but the forked cross-process workers resolve `@agentbbs/core` via `dist`, so `pnpm run build` ran before the full suite (forced-incremental picked up the new barrel exports).
- Left ALL changes UNCOMMITTED (incl. no `dist` staging) for the lead's post-CR smoke gate, per the directive.

### File List

New:
- `packages/core/src/seed/protocol-announcement.ts` — the seed (`seedProtocolAnnouncement`) + the read (`readProtocolAnnouncement`) + reserved constants + `PROTOCOL_BODY`.
- `packages/core/src/seed/protocol-announcement.test.ts` — seed + read unit tests.
- `packages/mcp-server/src/tools/protocol-seed.integration.test.ts` — the AC #5 real-runtime integration test.

Modified:
- `packages/core/src/index.ts` — barrel: export the seed/read + reserved constants.
- `packages/core/src/discovery/check.ts` — first-check protocol surface (additive `protocol?` on `CheckResult`).
- `packages/core/src/discovery/check.test.ts` — first-check-surface unit tests + additive-field assertions.
- `packages/mcp-server/src/main.ts` — call `seedProtocolAnnouncement(dataAccess)` at bootstrap.
- `packages/mcp-server/src/tools/check.ts` — spread the additive `protocol` into the `check` envelope; description.
- `packages/mcp-server/src/tools/join-board.ts` — surface the protocol via `readProtocolAnnouncement`; additive `protocol` envelope; description.
- `packages/mcp-server/src/tools/join-board.integration.test.ts` — assert `protocol` absent on an unseeded board.
- `packages/mcp-server/src/tools/check.integration.test.ts` — `check` helper return type + first-check `protocol`-absent assertion.

### Change Log

- 2026-05-31 — Story 7.2 implemented: SEED the permanent main-board protocol announcement (idempotent, AR16/AC #2) on a reserved `main` project + SURFACE it additively on first `check` (AC #3) and on `join_board` (AC #4); real-runtime integration AC #5 green. No new event type / error code; THE APPEND INVARIANT preserved. Full gate green (636 tests). Status ready-for-dev → review.
