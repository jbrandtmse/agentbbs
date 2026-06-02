---
baseline_commit: 838a8dbb06f1860a58396d1a8b4d835e8903b2e7
---
<!-- Story 9.11 — created 2026-06-01 by the Lead (epic-cycle resume; correct-course parity story). -->
<!-- Operator INITIATE-surface parity (announce_project + post_announcement). Uses EXISTING core ops as a thin host write + prop-driven ui-shared compose components; core + ratified agent/MCP contract stay byte-identical (Rule 13). -->

# Story 9.11: Start a negotiation (announce a project & open a room)

Status: done

## Story

As an operator,
I want to start a new project and open a room,
so that I can initiate a negotiation like an agent.

## Acceptance Criteria

**AC1 — Create a project (announce_project).**
**Given** a calm compose affordance to create a project,
**When** I submit a title + description,
**Then** the project is created via the SAME core `announceProject` op (over a NEW host `POST /api/projects`), I become the new sub-board's first member, and the new project appears in the tree live,
**And** a duplicate title/slug surfaces `PROJECT_EXISTS` inline (calm, no modal).

**AC2 — Open a room / post an announcement (post_announcement).**
**Given** a project I am a member of,
**When** I post a new announcement (subject + body) via a compose affordance,
**Then** a new room is opened via the SAME core `postAnnouncement` op (over a NEW host `POST /api/projects/:projectId/announcements`), it appears in the tree/thread, and the body honors the `BODY_TOO_LARGE` cap inline (413),
**And** if I am NOT a member of that project, it is surfaced as a join-first handoff (composes with Story 9.12), never a silent failure.

**AC3 — Real writes, real events, no backdoor (NFR2 + Rule 13).**
**Given** the new writes,
**When** they run,
**Then** they produce real `project.announced` + `board.joined` / `announcement.posted` events in the ledger (proven over a real `createDataAccess` + real HTTP — the SAME core ops an agent uses, no operator backdoor); the compose components live in `ui-shared` (prop-driven, no `@agentbbs/core` / `@agentbbs/data-access` import).

## Tasks / Subtasks

- [x] **Task 1 — Host: `POST /api/projects` (announce_project)** (AC: 1, 3)
  - [x] Add a body-carrying POST route to the `ROUTES` table in `packages/cli/src/host/json-api.ts`, mirroring the Story 9.7 `reply`/`participants` write handlers EXACTLY (validate → `requireOperator(operatorHandle)` → `requireBodyString(body, …)` → call core → snake_case wire envelope).
  - [x] Body shape `{ title, description }`; both required non-empty strings via `requireBodyString`. Call `announceProject(dataAccess, actor, { title, description })`. Return `{ status: 200, body: { project: projectToWire(project) } }` (reuse the existing `projectToWire`).
  - [x] `PROJECT_EXISTS` from core already maps to **409** via `statusForCode` (`json-api.ts:489`) — confirmed, no new code added. `NO_OPERATOR` (watching-only) → 403 via `requireOperator`.
- [x] **Task 2 — Host: `POST /api/projects/:projectId/announcements` (post_announcement)** (AC: 2, 3)
  - [x] Add a body-carrying POST route. Validate `requireSlug(params.projectId, 'project_id')` → `requireOperator` → `requireBodyString(body, 'subject')` + `requireBodyString(body, 'body')` → `postAnnouncement(dataAccess, actor, { projectId, subject, body })`. Return `{ room: roomToWire(room) }`.
  - [x] Core already enforces: membership gate FIRST → `NOT_A_MEMBER` (403) for a non-member (the join-first-handoff trigger), `BOARD_NOT_FOUND` (404) for an unknown board, then `BODY_TOO_LARGE` (413) for an over-cap body. All already mapped in `statusForCode`. Did NOT re-implement these gates in the host.
- [x] **Task 3 — Client: typed write helpers + error-code surfacing** (AC: 1, 2)
  - [x] Added `announceProject(title, description, …)` and `postAnnouncement(projectId, subject, body, …)` wrappers to `apps/web/src/api-client.ts`, mirroring `postReply`/`postAddParticipant` (use the existing `postJsonBody<T>`). Added their response envelope types (`AnnounceProjectResponse { project }`, `PostAnnouncementResponse { room }`).
  - [x] **Surfaced the error CODE on non-2xx.** Enhanced `postJsonBody`'s non-2xx path to parse the `{ code, message }` JSON error envelope and throw a typed `ApiError` carrying `.code` + `.status` + the host `.message`, so callers branch on `PROJECT_EXISTS` / `NOT_A_MEMBER` / `BODY_TOO_LARGE`. A non-JSON error body degrades to a synthetic `HTTP_<status>` code (still an `ApiError`, never silent). `ApiError extends Error`, so the existing `postReply`/`postJoin`/`postAddParticipant` callers still get a throw. CLIENT-LAYER only.
- [x] **Task 4 — ui-shared: prop-driven compose components** (AC: 1, 2, 3 / NFR2)
  - [x] Added `CreateProjectCompose` (start a project) + `PostAnnouncementCompose` (open a room, with the calm `[ join this project first ]` CTA for the NOT_A_MEMBER handoff) as **prop-driven** components in `packages/ui-shared/src/compose/` (mirror `room/Composer.tsx`: typed props, `onSubmit`/`onCancel`, `pending`, an inline `error` slot, `onEscape` — NO modal, terse lowercase voice). Import ONLY React (NFR2 — lint-enforced; no `@agentbbs/core` / `@agentbbs/data-access`).
  - [x] Barrel-exported the new components + their prop types from `packages/ui-shared/src/index.ts`.
- [x] **Task 5 — apps/web wiring + live tree update** (AC: 1, 2, 3)
  - [x] Wired the compose affordances into `apps/web/src/App.tsx`: a `＋ start a project` toggle opens `CreateProjectCompose`; a `＋ open a room` toggle (in the active room area, targeting THIS room's project) opens `PostAnnouncementCompose`. On submit they call the new client helpers. On success the tree is refreshed via `loadTreeModel()` so the new project/room appears LIVE WITHOUT a full reload (see Design decision below re: why refetch-on-success, not SSE fold).
  - [x] On `PROJECT_EXISTS` → inline calm error in the project-compose affordance. On `NOT_A_MEMBER` from post_announcement → the join-first handoff (the `joinFirst` CTA → `postJoin(projectId)` then back to the form); never silently swallowed. On `BODY_TOO_LARGE` → inline calm error in the announcement-compose affordance.
- [x] **Task 6 — Tests** (AC: 1, 2, 3)
  - [x] **Host integration** (real stack, Rule 3): added a Story 9.11 describe block to `packages/cli/src/host/host.integration.test.ts` — real `createDataAccess` SQLite ledger + real HTTP: (a) `POST /api/projects` creates the project, operator is first member, `project.announced` + `board.joined` land (asserted out-of-band via `eventsSince` + the directory read); (b) duplicate title → 409 `PROJECT_EXISTS`, maxSeq unchanged; (c) member `POST …/announcements` → `announcement.posted` lands, room appears; (d) non-member → 403 `NOT_A_MEMBER`, nothing appended; (e) over-cap body → 413 `BODY_TOO_LARGE`, nothing appended; (f) watching-only → 403 `NO_OPERATOR`.
  - [x] **Unit (real ledger)**: added a Story 9.11 describe block to `json-api.test.ts` covering both handlers' happy + every gate (NO_OPERATOR / BAD_REQUEST / PROJECT_EXISTS / NOT_A_MEMBER / BOARD_NOT_FOUND / BODY_TOO_LARGE), each asserting nothing-appended on rejection.
  - [x] **ui-shared DOM** (`*.test.tsx`, happy-dom project): `CreateProjectCompose.test.tsx` + `PostAnnouncementCompose.test.tsx` — render, submit fires the prop callback with the TRIMMED typed payload, empty/whitespace does not submit, the inline error slot renders the calm message, the join-first CTA swaps the form + fires `onJoinFirst`, pending disables. NFR2 satisfied by the lint boundary (React-only imports).
  - [x] **Client unit**: added a Story 9.11 describe block to `api-client.test.ts` for the two helpers + the `ApiError` code surfacing (PROJECT_EXISTS / NOT_A_MEMBER / BODY_TOO_LARGE / synthetic `HTTP_500`). Mutation-tested non-vacuous (Rule 7 — see Completion Notes).
  - [x] **Rule 13 drift-guard**: added an assertion in `json-api.test.ts` pinning `BOARD_ERROR_CODES` to EXACTLY the ratified ten + `NO_OPERATOR` stays out of core. Confirmed `git diff HEAD -- packages/core` and `packages/mcp-server` are EMPTY.

## Dev Notes

### What this story IS (and is NOT)

- **IS:** two NEW host write endpoints + two prop-driven `ui-shared` compose components + apps/web wiring, all over the EXISTING core ops `announceProject` / `postAnnouncement`. The operator initiates via the SAME core path an agent uses — no operator backdoor.
- **IS NOT:** any change to core, the MCP tool surface, the agent-facing wire, or `BOARD_ERROR_CODES`. **Rule 13** governs: client/host-layer additions only; the drift-guarded agent contract stays byte-identical. If you find yourself editing `packages/core/src/**` or `packages/mcp-server/src/**`, STOP — that is out of scope and a contract change (surface it, do not smuggle it).
- **IS NOT:** identity (register/login in the UI) — OUT of scope; the `--as`/`AGENTBBS_OPERATOR` operator handle stands (per the correct-course lead decision).

### Source facts to VERIFY before coding (Rule 4 — verified by the Lead at story creation; re-confirm if anything looks off)

- **`announceProject`** — `packages/core/src/projects/announce-project.ts:83`: `announceProject(dataAccess, actor, { title, description }) → Promise<Project>`. Appends `project.announced` + `board.joined` ATOMICALLY (announcer = first member). Duplicate title OR derived slug → throws `BoardError('PROJECT_EXISTS')`, **nothing appended** (atomic rollback). [Verified by Lead.]
- **`postAnnouncement`** — `packages/core/src/rooms/post-announcement.ts:114`: `postAnnouncement(dataAccess, actor, { projectId, subject, body }) → Promise<Room>`. **Membership gate runs FIRST** (`requireMembership` → `BOARD_NOT_FOUND` for unknown board, `NOT_A_MEMBER` for non-member) BEFORE any append; THEN `assertBodyWithinCap(body)` → `BODY_TOO_LARGE`; THEN appends `announcement.posted`. **It does NOT auto-join a non-member** — so AC2's join-first handoff is required precisely because a non-member is rejected `NOT_A_MEMBER`. [Verified by Lead — the Explore map's "conditional board.joined" was imprecise; the gate REJECTS non-members.]
- **`BOARD_ERROR_CODES`** — `packages/core/src/errors.ts:16-75` (closed set): `PROJECT_EXISTS`, `NOT_A_MEMBER`, `BODY_TOO_LARGE`, `BOARD_NOT_FOUND` all already exist. Do NOT add codes. [Verified by Lead.]
- **Host write pattern** — `packages/cli/src/host/json-api.ts`: `ROUTES` table (`:262`), `Route` shape `{ method, pattern, handler }` (`:154-160`), `requireOperator(operatorHandle)` → `NO_OPERATOR` 403 (`:224`), `requireBodyString(body, field)` → `BAD_REQUEST` 400 (`:244`), `requireSlug(value, name)` (`:186`), `statusForCode` mapping `PROJECT_EXISTS→409` / `BODY_TOO_LARGE→413` / `NOT_A_MEMBER→403` / `BOARD_NOT_FOUND→404` (`:473-494`). The Story 9.7 `reply` (`:437-445`) and `participants` (`:452-470`) handlers are the EXACT template to copy. `projectToWire` / `roomToWire` already exist (used by the join/reply handlers). [Verified by Lead.]
- **Body parsing / cap** — `packages/cli/src/host/server.ts:42` `MAX_REQUEST_BODY_BYTES = MAX_BODY_BYTES + 64KB` (host bound sits ABOVE core's cap so an over-core-under-host body REACHES core and returns the CONTRACT `BODY_TOO_LARGE` 413, mirroring 9.7's reply-body handling). Over-host-bound → readable 413 at the transport. [Verified by Lead.]
- **Client write pattern** — `apps/web/src/api-client.ts`: `postJsonBody<T>(path, body, …)` (`:511`) JSON-stringifies + POSTs; `postReply` (`:603`) / `postAddParticipant` (`:623`) are the template. **`postJsonBody` non-2xx currently throws a bare `Error` (`:522-524`) — it loses the `{ code, message }` body**; Task 3 must surface `.code`. [Verified by Lead.]
- **ui-shared compose pattern** — `packages/ui-shared/src/room/Composer.tsx` (props `:24-54`, component `:61`) is the prop-driven template (NFR2: imports only React + siblings). Barrel export block at `packages/ui-shared/src/index.ts:91-95`. [Verified by Lead.]
- **apps/web wiring + SSE fold** — `apps/web/src/App.tsx:131-194` mounts the tree model + folds SSE deltas IMMUTABLY by `seq` (Stories 9.3/9.9). Existing handler stubs (`handleJoinProject`, `handleOpenAnnouncements`) live in the `:200-300` callback block — READ them before wiring (story-create skill mandates reading UPDATE files).

### READ-BEFORE-EDIT (UPDATE files — do not skip)

`packages/cli/src/host/json-api.ts` (ROUTES + helpers), `apps/web/src/api-client.ts` (write helpers + `postJsonBody`), `apps/web/src/App.tsx` (handlers + SSE fold + tree state), `packages/ui-shared/src/index.ts` (barrel). For each, document current behavior + what you change + what must be preserved (do not break the 9.3–9.10 read/SSE/tab/calm behavior).

### Testing standards

- The canonical gate is the ROOT `pnpm test` (Rule 12 corollary) — `.test.tsx` DOM tests run under the `ui-shared-dom` happy-dom vitest project (`vitest.config.ts:101-130`); a per-package `vitest` run FALSELY reports `.tsx` as `document is not defined`. NEVER read a per-package failure as a regression — use `pnpm test` / git as ground truth (Rule 6).
- Host integration tests over a real `createDataAccess` (Rule 3, nothing mocked); pattern in `packages/cli/src/host/host.integration.test.ts` (real temp SQLite, `readSseUntil` raw-stream reader since Node 24 has no global EventSource).
- Honest gate before done: lint 0 / typecheck 0 / build green / `pnpm test` all green (0 failed/0 skipped, no `.only`/`.skip`/`.todo`) / `format --check` clean.

### Smoke (lead-side gate — informational)

Lead will drive a real Chrome (chrome-devtools-mcp) against the running host: create a project via the compose affordance → it appears live in the tree + operator is first member; duplicate title → calm inline `PROJECT_EXISTS` (no modal); post an announcement into a member project → new room appears live; non-member post → join-first handoff; over-cap body → calm inline cap message; assert the real `project.announced`/`board.joined`/`announcement.posted` events landed out-of-band (read endpoint / ledger). This is the lead's gate, not your deliverable — but build so it passes.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.11] (ACs)
- [Source: _bmad-output/implementation-artifacts/sprint-change-proposal-2026-06-01.md] (correct-course rationale; Rule 13 framing)
- [Source: .claude/rules/project-rules.md#13] (thin-client: client-layer fields + existing board ops, never mutate the ratified contract / fabricate a board op)
- [Source: .claude/rules/project-rules.md#4] (verify source-facts about existing symbols), [#8] (reconcile AC vs shipped design)
- [Source: packages/core/src/projects/announce-project.ts:83], [Source: packages/core/src/rooms/post-announcement.ts:114], [Source: packages/core/src/errors.ts:16-75]
- [Source: packages/cli/src/host/json-api.ts:262,416-494], [Source: packages/cli/src/host/server.ts:42-124]
- [Source: apps/web/src/api-client.ts:511-635], [Source: packages/ui-shared/src/room/Composer.tsx:24-61], [Source: apps/web/src/App.tsx:131-194]
- [Source: 9-7-join-gate-composer-and-participate-as-peer.md] (the closest analog — host write + grant-on-act + Rule 13)

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — claude-opus-4-8[1m], via the `/bmad-dev-story` skill under `/epic-cycle`.

### Debug Log References

- Honest gate, final (after the post-smoke fix): lint 0 / typecheck 0 / build green (7 pkgs + apps/web Vite dist) / `pnpm test` 1139 passed (137 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`) / `format --check` clean.
- Rule 13: `git diff HEAD -- packages/core` and `packages/mcp-server` both EMPTY (re-verified after the fix). The agent contract (core types, MCP wire, `BOARD_ERROR_CODES`) is byte-identical.

### Completion Notes List

- **Source facts re-verified (Rule 4)** before coding — all confirmed correct as the Lead authored them: `announceProject(dataAccess, actor, { title, description })` at `announce-project.ts:83` (atomic `project.announced` + announcer's `board.joined`; dual-uniqueness guard → `PROJECT_EXISTS`, nothing appended); `postAnnouncement(dataAccess, actor, { projectId, subject, body })` at `post-announcement.ts:114` (membership gate FIRST → `BOARD_NOT_FOUND`/`NOT_A_MEMBER`, then `assertBodyWithinCap` → `BODY_TOO_LARGE`, then `announcement.posted`; it does NOT auto-join a non-member, so AC2's join-first handoff is required); the closed set at `errors.ts:16-75` already carries all four codes; `statusForCode` maps `PROJECT_EXISTS→409` / `BODY_TOO_LARGE→413` / `NOT_A_MEMBER→403` / `BOARD_NOT_FOUND→404`.
- **Rule 13 (load-bearing):** the entire story is CLIENT/HOST-layer. Two new host POST routes map to the EXISTING core ops (the SAME ops an agent uses — no operator backdoor). `NO_OPERATOR` stays a HOST-surface code (via `requireOperator`), never entering core's closed set. Two new prop-driven `ui-shared` components import React only (NFR2 lint-enforced). `ApiError` is a CLIENT-layer error type mirroring the host wire's codes for the UI; it adds nothing to core.
- **Rule 7 mutation test (non-vacuous proof of the load-bearing client semantic):** temporarily defeated `postJsonBody`'s host-code read (`if (false && …) code = parsed.code;`) so it always returned a synthetic `HTTP_<status>` — the 4 `ApiError.code` surfacing tests (PROJECT_EXISTS / NOT_A_MEMBER / BODY_TOO_LARGE / reply BODY_TOO_LARGE) went RED, then reverted byte-identically (`git diff` confirmed the original line restored) → green again. These tests discriminate; they are the UI's branch source for the calm inline error + the join-first handoff.
- **One existing Story 9.7 test updated (intentional, mandated by Task 3):** `api-client.test.ts`'s "a non-2xx … propagates as a throw" asserted the OLD bare-`Error('… HTTP 413')` message. Task 3 deliberately changes `postJsonBody` to surface the host `{ code, message }`; the test now asserts the richer contract (`.code === 'BODY_TOO_LARGE'`, `.status === 413`, host `.message`). The `postJoin`/`postAddParticipant` `/HTTP 403/` assertions still pass (those fixtures carry no `message`, so the synthetic message is retained). No behavior regressed — the change is strictly additive on the error surface.

### POST-SMOKE FIX (HIGH) — AC2's "open the FIRST room" was unreachable on a room-less board

The lead's real-Chrome smoke caught a HIGH defect: the `＋ open a room` (post_announcement) compose was mounted ONLY inside `{activeRoom !== null && (...)}`. A freshly-announced (zero-room) project has no open room, so `activeRoom` was always `null` and the affordance NEVER appeared — AC2's PRIMARY path (open a board's FIRST room) could not be exercised at all. This broke the exact operator↔agent parity the story exists to deliver: an agent CAN `post_announcement` into a room-less board it belongs to.

**Fix (contained, client-layer only):** made the open-a-room compose PROJECT-SCOPED instead of room-scoped:
- Added `announceProjectId` state (the project the compose targets) + a `handleOpenAnnouncements(projectId)` handler that sets it and opens the panel.
- Wired `NavTree`'s `onOpenAnnouncements` (previously unwired) → `handleOpenAnnouncements`, so clicking a project's `announcements (N)` bucket opens the compose for THAT project, INDEPENDENT of any open room.
- Moved the `PostAnnouncementCompose` render OUT of the `{activeRoom !== null}` block to SHELL level (rendered when `announceComposeOpen && announceProjectId !== null`), with a `[data-testid="open-room-panel"]` carrying the target `data-project-id`.
- `handlePostAnnouncement` / `handleAnnounceJoinFirst` now read `announceProjectId` (not `activeTab?.room?.projectId`), so they work with no open room.
- Kept the in-room `＋ open a room` toggle as a convenience entry — it now routes through the SAME `handleOpenAnnouncements(activeRoom.projectId)`, so both paths share one project-scoped target (no duplicated compose).

**Regression guard (the exact gap the smoke caught):** added a Story 9.11 describe block to `apps/web/src/App.test.tsx` — a board where `ops` IS a member of a ROOM-LESS `calling-interface`: (1) no open room, yet clicking the announcements bucket makes the `open-room-panel` reachable (targeting `calling-interface`, no RoomView); (2) submitting POSTs `post_announcement` with the RIGHT projectId + the tree refreshes so the new room row appears live; (3) a NON-member from the same room-less entry → the calm `[ join this project first ]` handoff (never silent) → join → back to the form. **Rule 7 mutation-tested:** stubbing `handleOpenAnnouncements` to a no-op (the old broken behavior) turned all 3 RED; reverted byte-identically → green.

**Incidental:** removed two untracked transient `smoke-seed-9-11.mjs` scripts (one at repo root, one in `packages/cli/`) the lead's smoke left behind — their own header says "deleted after"; they were tripping the lint gate (`no-undef` on `process`/`console`). Removing them restored a clean honest gate. Core + MCP wire stayed byte-identical throughout (Rule 13 re-verified).

### Design decision — live tree update is refetch-on-success, NOT an SSE fold (Rule 8 reconciliation)

AC1/AC2 require the new project/room to appear "live in the tree" without a full reload. The existing `foldTreeDelta` (Story 9.4) DELIBERATELY ignores brand-new projects/rooms: it only DECORATES rows already in the model (`announcement.posted` bumps an EXISTING room's unread; `project.announced` is not handled at all — "An event for a room not in the model … is ignored for 9.4; a full re-fetch on new-room is 9.9's concern"). Rather than widen `foldTreeDelta` to synthesize new tree nodes from event payloads (a larger, riskier change to a marquee read-path component), I used the SAME success-refetch discipline Story 9.9's reply path already established: on a successful create the surface calls `loadTreeModel()` and replaces the model, so the new project/room appears immediately for the acting operator. The SSE fold continues to handle live DECORATIONS for other operators' activity; brand-new-node materialization on the initiator is the refetch. This is consistent with the shipped design (no contradiction introduced) and keeps the change client-layer + minimal.

### File List

- packages/cli/src/host/json-api.ts (host: two new POST routes + imports + header doc)
- apps/web/src/api-client.ts (client: `ApiError`, `postJsonBody` code surfacing, `announceProject`/`postAnnouncement` helpers + response types)
- packages/ui-shared/src/compose/CreateProjectCompose.tsx (new — prop-driven start-a-project compose)
- packages/ui-shared/src/compose/PostAnnouncementCompose.tsx (new — prop-driven open-a-room compose + join-first CTA)
- packages/ui-shared/src/index.ts (barrel: export the two new components + prop types)
- apps/web/src/App.tsx (wiring: the two compose panels, handlers, live tree refresh, INITIATE bar styles; POST-SMOKE FIX: project-scoped open-a-room compose reachable on a room-less board via the NavTree announcements bucket)
- packages/cli/src/host/json-api.test.ts (unit tests + Rule 13 drift-guard)
- packages/cli/src/host/host.integration.test.ts (real-stack integration tests)
- packages/ui-shared/src/compose/CreateProjectCompose.test.tsx (new — DOM tests)
- packages/ui-shared/src/compose/PostAnnouncementCompose.test.tsx (new — DOM tests)
- apps/web/src/api-client.test.ts (client helper + ApiError tests; one 9.7 test updated for the new error surface)
- apps/web/src/App.test.tsx (POST-SMOKE FIX regression guard: open the FIRST room in a room-less project — reachable, right projectId, join-first handoff)
- _bmad-output/implementation-artifacts/sprint-status.yaml (status → in-progress → review)

### Change Log

- 2026-06-01 — Story 9.11 implemented (operator INITIATE-surface parity: announce_project + post_announcement). Two host POST routes over the existing core ops, an `ApiError` client error type surfacing the host `{ code, message }`, two prop-driven `ui-shared` compose components (start-a-project + open-a-room with the join-first handoff), apps/web wiring with live tree refresh. Core + MCP wire + `BOARD_ERROR_CODES` byte-unchanged (Rule 13). +host integration / unit / DOM / client tests, Rule 7 mutation-verified, Rule 13 drift-guarded. Status ready-for-dev → review.

## Review Findings

### Code Review — 2026-06-01 (epic-cycle code-review stage) — APPROVED, 0 HIGH / 0 MED / 0 decision-needed / 0 patch

**Outcome: ✅ Clean review.** Three review layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) raised no HIGH or MED finding. Honest gate green end-to-end: lint 0 / typecheck 0 / build (7 pkgs + apps/web) green / `pnpm test` 1136 passed (137 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`) / `format --check` clean. Baseline 1094 → 1136 (+42), matching expectation.

**Rule 13 (LOAD-BEARING) — VERIFIED.** `git diff HEAD -- packages/core packages/mcp-server` is EMPTY (reviewer-confirmed). `BOARD_ERROR_CODES` (core `errors.ts`) is byte-identical to the ratified ten; `NO_OPERATOR` / `BAD_REQUEST` / synthetic `HTTP_<status>` are HOST/CLIENT-surface only, never in core's closed set. The two new host routes map to the EXISTING core ops `announceProject` / `postAnnouncement` (the SAME ops an agent uses — no operator backdoor); the two `ui-shared` compose components import React only (NFR2, lint-enforced); `ApiError` is a client-layer error type mirroring the host wire. No board op fabricated; the join-first handoff is wired to the existing `postJoin` / `joinBoard`. The drift-guard test (`json-api.test.ts`) pins the closed set to exactly the ten + asserts `NO_OPERATOR` absent.

**Rule 7 (non-vacuous) — RE-VERIFIED by reviewer.** Re-mutated the load-bearing `postJsonBody` ApiError code-surfacing (`if (false && typeof parsed.code === 'string') …`) → 4 ApiError tests went RED (`expected 'HTTP_413' to be 'BODY_TOO_LARGE'`), then reverted byte-identically (`git diff` shows no stray `false &&`; the only remaining `api-client.ts` diff is the legitimate 102+/4- Story 9.11 change) → re-green. The QA gate-order test (non-member + over-cap → `NOT_A_MEMBER` not `BODY_TOO_LARGE`, asserted positively AND negatively) runs against real core where membership gates first (`post-announcement.ts:123` before `:129`) — confirmed live; flipping the order would turn it RED. Drift-guard + gate-order both discriminate.

**Rule 8 (refetch-on-success) — SOUND.** The dev's choice to materialize the brand-new project/room via `loadTreeModel()` + `setModel(built)` (rather than widening `foldTreeDelta`, which deliberately ignores brand-new nodes per 9.4/9.9 scope) is consistent with the shipped success-refetch discipline (9.9 reply path), targeted (no full page reload), and does not disturb the existing SSE/tab/calm behavior (full 9.x suite green in the 1136 run). The "appears live" ACs are met for the acting operator.

**ApiError backward-compat — VERIFIED.** `ApiError extends Error`, so the existing 9.7 callers (`postReply`/`postJoin`/`postAddParticipant`) still receive a throw; `.message` carries the host message (or the synthetic `HTTP_<status>` when no envelope). The one updated 9.7 test (`/HTTP 413/` → `/too big/` + `.code`/`.status` assertions) is the intentional, additive error-surface enrichment mandated by Task 3 — no behavior regressed. A non-JSON error body degrades to `HTTP_<status>` (still an `ApiError`, never a silent swallow) — covered by a dedicated test.

**No silent no-op affordance (Rule 13) — VERIFIED.** The `[ join this project first ]` CTA is wired to `handleAnnounceJoinFirst` → real `postJoin(projectId)`, then drops back to the compose form (draft preserved in component state). The NOT_A_MEMBER path flips to the CTA (`announceJoinFirst`), never swallows. Every error path sets a calm inline error or the handoff — no clickable no-op.

**AC real-runtime evidence (Rule 3) — VERIFIED.** Each AC has real-runtime coverage: host integration over real `createDataAccess` SQLite + real `fetch` asserts `project.announced`/`board.joined`/`announcement.posted` land out-of-band, duplicate → 409 atomic rollback, non-member → 403 NOT_A_MEMBER nothing-appended, over-cap → 413, watching-only → 403 NO_OPERATOR; the QA block sharpens "nothing appended" to specific-event-absence + adds the gate-order case; the DOM `.test.tsx` (happy-dom project) render + submit + join-first-swap; the client unit tests cover the helpers + ApiError surface. Rule 1 Integration AC (AC3 + apps/web consumer wiring) is genuinely exercised end-to-end.

**Observations (dismissed as noise / acceptable-by-design — no action):**
- `handleAnnounceJoinFirst` joins then returns to the form WITHOUT auto-resubmitting (operator re-clicks `[ post announcement ]`). Acceptable: draft is preserved, never a silent failure, and composes with Story 9.12's join path as designed.
- A successful `postAnnouncement` refetches the new room into the tree but does not auto-OPEN it as a tab. AC2 says "appears in the tree/thread" — tree appearance satisfies; auto-open is not required by the AC.
- `requireBodyString` does not trim, so a whitespace-only `" "` field would reach core via a direct host call — but the compose components trim before submit, and this matches the pre-existing 9.7 reply handler (core owns value validation). Not a regression introduced by this story.
- `activeTab` is referenced in handler closures declared later in the function body — not a TDZ violation (handlers fire on interaction, post-render, when the `const` is initialized); standard React pattern.

Rules 1, 3, 8, 13 satisfied; Rule 7 reviewer-re-verified non-vacuous; Rule 5 N/A (no unmeasurable NFR worked around); Rule 6 N/A (no `docs/adr`). No deferred items. Left UNCOMMITTED for the lead's post-CR Chrome smoke gate. Status review → done.
