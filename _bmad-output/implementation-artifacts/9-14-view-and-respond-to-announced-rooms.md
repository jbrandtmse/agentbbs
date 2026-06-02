---
baseline_commit: b99e01f1dd379d3519f25ad6603504642bf1d62c
---
<!-- Story 9.14 — created 2026-06-01 by the Lead (epic-cycle; correct-course from the Lead's heavy post-9.13 smoke). -->
<!-- Operator↔agent RESPOND-to-announcements parity (proto-rooms navigable + reply-to-activate) + 4 UI-polish findings. Client/host-layer only; core + ratified agent/MCP contract byte-identical (Rule 13). -->

# Story 9.14: View and respond to announced (proto) rooms + operator-UI polish

Status: done

## Story

As an operator,
I want to see, open, and reply to announced rooms that no one has answered yet,
so that I can advance a negotiation I (or an agent) started — like an agent does.

## Acceptance Criteria

**AC1 — Proto-rooms are navigable (the parity gap — the headline AC).**
**Given** a project with an announced room that is not yet active (a proto-room, `active:false`),
**When** I view the tree,
**Then** that proto-room appears as a **navigable row** (visually distinct as pending/unanswered from an active room), and opening it shows the room view with the announcement subject + body (inert-rendered per NFR12),
**And** replying to it activates the room via the SAME core `reply` op an agent uses (the Epic-4 min-seq activator), after which it renders as an active room **live** — NO new core op, NO backdoor, NO host-endpoint change.

**AC2 — Join-first prominence (polish; Finding 2).**
**When** a post is rejected because I'm not a member, the join-first handoff is **prominent and clearly worded** (a labelled callout, not a terse one-liner that reads as "nothing happened"). The operator's typed subject/body remain preserved across the join (as today).

**AC3 — Watching-only consistency (polish; Finding 3).**
**Given** a watching-only host (no operator handle), the `＋ start a project` and `＋ open a room` affordances are **disabled/hidden inline with a terse reason** — matching the focus affordance (Story 9.13) — rather than appearing active and failing only at submit with `NO_OPERATOR`.

**AC4 — Self-post live announcement (polish; Finding 4).**
**When** my own optimistic reply reconciles, it is **NOT** announced as "1 new post" in the aria-live region; only genuinely-new posts from OTHERS are announced. (No duplicate message is produced today — this is purely the live-announcer mis-counting the operator's own reconciled post.)

**AC5 — Compose panel exclusivity (polish; Finding 5).**
**When** I open a compose/picker affordance (start-a-project / open-a-room / join-picker / focus edit), the panels **do not stack** on top of an open room view — at most one initiate panel is open at a time (opening one closes any other), and the open room stays legible.

**Given** all of the above,
**When** they run,
**Then** operator↔agent parity is closed on the respond-to-announcements axis (an agent uses `list_announcements` + `reply`-to-activate; the operator now has the equivalent UI path), proven over the real stack; core + the ratified agent/MCP contract stay byte-identical (Rule 13).

## Tasks / Subtasks

- [x] **Task 1 — Tree includes proto-rooms as navigable rows** (AC: 1)
  - [x] In `apps/web/src/api-client.ts` `loadTreeModel` (~L305-348): build each project's `rooms` from BOTH `fetchProjectRooms` (active) AND `fetchProjectAnnouncements` (proto-rooms), **deduped by `roomId`** (an active room must not also appear as a proto-row). Add a discriminator to `NavTreeRoom` (e.g. `pending: boolean` — true for `active:false` proto-rooms). Keep `announcementCount` for the bucket. Order: your call (e.g. active rooms then pending, or by seq) — keep it stable.
  - [x] In `packages/ui-shared/src/tree/NavTree.tsx`: extend `NavTreeRoom` with the `pending` field (JSDoc it) and render a pending row **visually distinct** (e.g. a dimmed/`°`-style marker or a "pending" affordance) but still a real `treeitem` that fires `onSelectRoom(roomId)` — opening a proto-room uses the SAME `handleSelectRoom` path as an active room (the room view already serves proto-rooms; see Source facts). Keep NavTree presentation-only/prop-driven (NFR2).
- [x] **Task 2 — Reply-to-activate a proto-room → live activation** (AC: 1)
  - [ ] Opening a proto-room shows the existing room view (Story 9.5) + the join-gate composer (Story 9.7). Replying calls the existing `postReply` → core `reply` ACTIVATES the proto-room (Epic-4 min-seq activator). On success, refresh so the row flips from pending → active **live** (the 9.11 refetch-on-success discipline — `loadTreeModel()` now includes the now-active room as a normal row). Verify the operator can activate a proto-room they posted themselves AND one an agent posted.
- [x] **Task 3 — Join-first prominence** (AC: 2)
  - [x] In `packages/ui-shared/src/compose/PostAnnouncementCompose.tsx` (the `joinFirst` branch): present the handoff as a **labelled, prominent callout** (clear heading/wording, e.g. "You haven't joined <project> yet — join to post here") with the `[ join this project first ]` action, NOT a bare one-liner. Keep it calm/inline (no modal), keep the typed values preserved across the join (already works). Update/extend the DOM test to pin the prominent wording.
- [x] **Task 4 — Watching-only disables initiate affordances** (AC: 3)
  - [x] In `apps/web/src/App.tsx`: when `model.operatorHandle === null` (watching-only), render `＋ start a project` and `＋ open a room` disabled (or hidden) with a terse inline reason — mirror the Story 9.13 `FocusAffordance` disabled treatment. Do NOT remove them for a registered operator. (Optional: also gate `＋ join a project…` consistently — your judgment; the join endpoint already 403s `NO_OPERATOR`, but matching the disabled treatment is cleaner.)
- [x] **Task 5 — Don't announce the operator's own reconciled post** (AC: 4)
  - [x] In the live-announcer path (Story 9.9 reconciliation + Story 9.10 coalescing aria-live — `apps/web/src/App.tsx` / the SSE fold): when a delta is the operator's OWN post being reconciled (already shown optimistically), do NOT increment the "N new posts" aria-live count. Only OTHERS' genuinely-new posts are announced. Pin with a DOM test (operator's own reply → no "1 new post"; another actor's reply → "1 new post").
- [x] **Task 6 — Compose panel exclusivity** (AC: 5)
  - [x] In `apps/web/src/App.tsx`: make the initiate panels mutually exclusive — opening start-a-project / open-a-room / join-picker / focus-edit closes any other open one (single `openPanel` discriminated state, or close-others-on-open). Ensure an open room view stays legible (the panel doesn't overlay/stack on it confusingly). Keep all calm/inline (no modal). Pin with a DOM test (opening B closes A).
- [x] **Task 7 — Tests + Rule 13 drift-guard** (AC: 1-5)
  - [x] **apps/web DOM** (`App.test.tsx`): proto-room renders as a navigable pending row; clicking it opens the room view (proto-room body shown); replying activates it and the row flips to active (refetch). Watching-only disables the two initiate affordances. Panel exclusivity. Self-post not announced.
  - [x] **ui-shared DOM**: NavTree pending-row rendering (distinct + still selectable); PostAnnouncementCompose prominent join-first callout.
  - [x] **Host integration** (real stack, Rule 3): proto-room open + reply-to-activate over a real `createDataAccess` — assert the proto-room (`active:false`) is served by `/api/rooms/:id`, a `reply` lands a real `room.replied` and the room becomes `active:true` (the activator). Reuse/cite the Epic-4 activator coverage where it already proves the min-seq semantics; ADD the host-path assertion that the now-active room appears in `/api/projects/:id/rooms`.
  - [x] **Rule 13 drift-guard**: confirm `git diff HEAD -- packages/core packages/mcp-server` is EMPTY (no core op, no MCP wire change, no new `BOARD_ERROR_CODES`). The proto-room navigability is a CLIENT-layer tree-model change; reply-to-activate reuses the EXISTING `reply`. Mutation-test the most load-bearing new assertion once (Rule 7 — e.g. the proto-room becomes navigable, or reply flips it active) and revert byte-identical.

## Dev Notes

### What this story IS (and is NOT)

- **IS:** a CLIENT-layer tree-model change (proto-rooms become navigable rows) + reuse of the EXISTING room view (9.5) + composer (9.7) + `reply` (which activates a proto-room via the Epic-4 min-seq activator) + 4 small UI-polish fixes. Closes the operator↔agent RESPOND-to-announcements parity gap.
- **IS NOT:** any new core op, MCP tool, agent-wire change, new `BOARD_ERROR_CODES`, or new host endpoint. **Rule 13** governs. `/api/rooms/:id` ALREADY serves proto-rooms; `/api/projects/:id/announcements` ALREADY lists them; `reply` ALREADY activates them. The gap was purely that `loadTreeModel` built rows from active rooms only. Confirm `git diff` on `packages/core` + `packages/mcp-server` is empty.
- **IS NOT:** a regression of 9.11–9.13 (their ACs pass). This is additive.

### Source facts to VERIFY before coding (Rule 4 — verified by the Lead during the heavy smoke)

- **The gap** — `apps/web/src/api-client.ts:305-348` `loadTreeModel`: each project's `rooms` is built ONLY from `fetchProjectRooms` (`:320`, `/api/projects/:id/rooms` → active rooms); `announcements` (`:321`, proto-rooms) feeds ONLY `announcementCount` (`:326`), never a row. [Verified by Lead — this is the whole bug.]
- **`/api/rooms/:id` serves proto-rooms** — Lead fetched `/api/rooms/kickoff-with-markdown` live → HTTP 200, `room.active:false`, the `announcement` message present. So opening a proto-room works at the API level TODAY; only the tree row is missing. [Verified by Lead.]
- **Proto-room vs active** — `/api/projects/:id/rooms` returns `active:true` rooms (a room activates when first REPLIED to — `activated_by`/`activated_at_seq` populated); `/api/projects/:id/announcements` returns `active:false` proto-rooms. The two sets are disjoint by `active`; dedupe by `roomId` defensively. [Verified by Lead: taskflow-renderer rooms=[render-contract-kickoff active:true], payments-api/operator-test-negotiation announcements=[… active:false].]
- **`reply` activates** — Epic 4 (the min-seq activator): the first `reply` to a proto-room activates it. `postReply` (`apps/web/src/api-client.ts`) → `POST /api/rooms/:id/reply` → core `reply`. No new op. [Verified by Lead — board model.]
- **NavTreeRoom shape** — `packages/ui-shared/src/tree/NavTree.tsx:41-52` (`roomId, subject, unread, activityCount, needsYou`); `NavTreeProject.rooms` comment at `:62` ("activated rooms the surface chooses to list") is exactly what this story widens. The room-row click fires `onSelectRoom` (NavTree props ~`:90`). [Verified by Lead.]
- **Room view + composer already room-agnostic** — Story 9.5 `RoomView` + Story 9.7 join-gate `Composer` render any room from `/api/rooms/:id`; `handleSelectRoom` (App.tsx) opens a tab. A proto-room opens the same way. [Verified by Lead — confirmed the room GET works for a proto-room.]
- **Polish anchors** — join-first: `packages/ui-shared/src/compose/PostAnnouncementCompose.tsx` (`joinFirst`/`onJoinFirst` props). Watching-only: `apps/web/src/App.tsx` initiate affordances + the 9.13 `FocusAffordance` disabled pattern to mirror. Self-post aria-live: the 9.9 reconciliation + 9.10 coalescing announcer in `App.tsx`. Panel exclusivity: the `createProjectOpen`/`announceComposeOpen`/`announceProjectId`/join-picker state in `App.tsx`. [Verified by Lead.]

### READ-BEFORE-EDIT (UPDATE files)

`apps/web/src/api-client.ts` (`loadTreeModel` + `NavTreeRoom`/types + `foldTreeDelta` new-room behavior), `packages/ui-shared/src/tree/NavTree.tsx` (room-row render + `NavTreeRoom`), `apps/web/src/App.tsx` (panel state, initiate affordances, the SSE/optimistic live announcer, `handleSelectRoom`/`handlePostAnnouncement`/`handleJoinProject`), `packages/ui-shared/src/compose/PostAnnouncementCompose.tsx` (join-first branch), `packages/ui-shared/src/index.ts` (barrel if types change). Document current behavior + what changes + what to preserve — do NOT break 9.4–9.13 (active-room rows, decorations, SSE fold, tabs, calm states, the 9.11–9.13 compose/picker/focus flows).

### Design decision (AC1 — reconcile with the 9.11 bucket wiring)

The `announcements (N)` bucket currently opens the post-compose (Story 9.11). KEEP that (it's "post a NEW announcement"). AC1 adds proto-rooms as **sibling navigable rows** under the project (next to active room rows), so "post new" (bucket) and "open an existing announcement" (rows) are distinct affordances. Do NOT overload the bucket to do both. This is the cleanest reconciliation and matches how active rooms already render.

### Testing standards

- Canonical gate is ROOT `pnpm test` (Rule 12 corollary): `.test.tsx` under `ui-shared-dom` happy-dom; a per-package `vitest` run FALSELY reports `.tsx` as `document is not defined` — use `pnpm test` + git as ground truth (Rule 6). Use `python` not `python3`.
- Host integration over real `createDataAccess` (Rule 3). Honest gate: lint 0 / typecheck 0 / build / `pnpm test` all green (0 failed/0 skipped, no `.only`/`.skip`/`.todo`) / `format --check` clean. Baseline after 9.13: 1185 tests.
- NOTE the pre-existing transient Shiki-warmup flake in `render-markdown.xss.test.ts` (unrelated; git is ground truth — Rule 6).

### Smoke (lead-side gate — informational)

Lead will drive real Chrome: post an announcement → it appears as a **navigable pending row** (not just a count) → open it → read the inert-rendered body (the `<script>` survives as escaped text) → reply → the row flips to an **active** room live + the reply lands (out-of-band `room.replied` + `active:true`). Plus: watching-only host disables `＋ start a project`/`＋ open a room`; the join-first callout is prominent; opening a second compose panel closes the first; the operator's own reply is not announced as "1 new post".

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.14], [Source: _bmad-output/implementation-artifacts/sprint-change-proposal-2026-06-01b.md]
- [Source: .claude/rules/project-rules.md#13] (thin-client: existing ops, no fabricated op/backdoor), [#8] (reconcile vs shipped design), [#4] (verify source-facts)
- [Source: apps/web/src/api-client.ts:305-348] (the loadTreeModel gap), [Source: packages/ui-shared/src/tree/NavTree.tsx:41-64]
- [Source: 9-5-room-thread-with-breadcrumb-and-joined-row.md] (RoomView), [Source: 9-7-join-gate-composer-and-participate-as-peer.md] (composer + reply-grants), [Source: 9-11-start-a-negotiation.md] (refetch-on-success + PostAnnouncementCompose), [Source: 9-13-set-my-focus.md] (watching-only disabled pattern)

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Honest gate (final): `pnpm run build` green (7 pkgs + apps/web); `pnpm test` = **1200 passed / 139 files / 0 failed / 0 skipped** (baseline 1185 → +15); `pnpm run typecheck` exit 0; `pnpm run lint` clean on ALL story-changed files (the only 2 lint errors are in a PRE-EXISTING untracked stray `packages/cli/smoke-seed-testing.mjs` — present in the session's opening git status, NOT a Story 9.14 artifact — see Issues); `prettier --check` clean on all changed files.
- **Rule 13 drift-guard VERIFIED EMPTY:** `git diff HEAD -- packages/core packages/mcp-server` → no output (exit 0). No core op, no MCP wire change, no `BOARD_ERROR_CODES` change. Every change is client/host-layer (apps/web, packages/ui-shared, packages/cli host TEST only).
- **Rule 7 mutation test (non-vacuous) — the headline AC1 reply-to-activate flip:** temporarily disabled the `loadTreeModel()+setModel` tree-refresh in `sendReplyAndReconcile` (App.tsx) → the App DOM test "row flips PENDING → ACTIVE live" went **RED** (`expected 'true' to be 'false'` on `data-pending`), proving it discriminates. Reverted byte-identically (`git diff --stat` shows the file unchanged from the intended diff) → test GREEN again.

### Completion Notes List

- **AC1 (headline — proto-rooms navigable + reply-to-activate):** `loadTreeModel` (`apps/web/src/api-client.ts`) now builds each project's rows from BOTH `/rooms` (active) AND `/announcements` (proto-rooms, `active:false`), deduped by `roomId` (defensive — an active room cannot also appear as a stale proto-row), active rows first then pending. `NavTreeRoom` gains a `pending?: boolean`; `SidebarTreeItem` renders a pending row VISUALLY DISTINCT (a `°` `pending-glyph` replacing the read/unread glyph + the `--text-dim` ramp + `data-pending`) while staying a real selectable `treeitem` (opening it uses the SAME `onSelectRoom`/`handleSelectRoom` path — `/api/rooms/:id` already serves proto-rooms). Reply-to-activate: `sendReplyAndReconcile` (App.tsx) adds a best-effort `loadTreeModel()+setModel` on reply success so the row flips pending→active LIVE (the now-active room is returned by `/rooms`). NO new op/endpoint — reply IS the Epic-4 min-seq activator.
- **AC2 (join-first prominence):** `PostAnnouncementCompose` join-first branch is now a LABELLED, PROMINENT callout (a `…-join-first-heading` naming the project + a sentence saying the draft is kept) instead of a terse one-liner. New optional `projectLabel` prop (falls back to "this project"); App passes the project title.
- **AC3 (watching-only disables initiate affordances):** App's `＋ start a project` + in-room `＋ open a room` render DISABLED (faint, `not-allowed`, no onClick) with a terse inline reason when `model.operatorHandle === null`, mirroring the 9.13 FocusAffordance pattern. The `＋ join a project…` row is left enabled (the picker already surfaces `NO_OPERATOR` calmly — the optional task judgment).
- **AC4 (no self-post live announcement):** `MessageThread` now EXCLUDES the operator's OWN confirmed posts from the live-region `confirmedCount` (via the existing `operatorHandle` prop), so the operator's own optimistic-echo reconciliation produces no net delta (no "1 new post"), while another actor's reply still bumps the count by one.
- **AC5 (compose-panel exclusivity):** a central `openInitiatePanel(panel)` helper in App closes the OTHER initiate panels (create-project, open-room, join-picker) before opening one — at most one is open at a time, so they don't stack over an open room. (FocusAffordance owns its own sidebar edit toggle; the three main panels are AC5's stacking concern.)
- **Rule 13 (LOAD-BEARING, satisfied):** purely client/host-layer. Core + the ratified MCP wire + `BOARD_ERROR_CODES` BYTE-IDENTICAL (drift-guard empty). No host endpoint added: `/api/rooms/:id` already serves proto-rooms, `/announcements` already lists them, `reply` already activates them — the gap was only that `loadTreeModel` built rows from active rooms.
- **Rule 12 (DOM-test gate):** `.tsx` DOM tests run under the root `ui-shared-dom` happy-dom project; verified via root `pnpm test` (and the mutation check used the root `vitest --project ui-shared-dom`, never a per-package run).

### File List

- `apps/web/src/api-client.ts` (M) — `loadTreeModel` builds proto-rooms as pending rows (deduped).
- `apps/web/src/App.tsx` (M) — reply-to-activate tree refresh; watching-only disabled initiate affordances; `openInitiatePanel` exclusivity; `projectTitle` helper.
- `packages/ui-shared/src/tree/NavTree.tsx` (M) — `NavTreeRoom.pending`; pending-aware row render + aria-label.
- `packages/ui-shared/src/tree/SidebarTreeItem.tsx` (M) — `pending` prop: distinct `°` marker + dimmed + `data-pending`.
- `packages/ui-shared/src/compose/PostAnnouncementCompose.tsx` (M) — prominent labelled join-first callout + `projectLabel` prop.
- `packages/ui-shared/src/room/MessageThread.tsx` (M) — AC4: exclude operator's own posts from the live-region count.
- `apps/web/src/api-client.test.ts` (M, tests) — `loadTreeModel` proto-room/dedupe/bucket-count unit test.
- `apps/web/src/App.test.tsx` (M, tests) — AC1 proto-room navigable+open+reply-flip; AC3 watching-only disabled; AC5 exclusivity (the Rule-7 mutation target lives here).
- `packages/ui-shared/src/tree/NavTree.test.tsx` (M, tests) — pending-row distinct-render + still-selectable.
- `packages/ui-shared/src/compose/PostAnnouncementCompose.test.tsx` (M, tests) — prominent join-first callout.
- `packages/ui-shared/src/chrome/A11yFloor.test.tsx` (M, tests) — AC4 MessageThread self-post-not-announced.
- `packages/cli/src/host/host.integration.test.ts` (M, tests) — real-stack proto-room serve + reply-activates + appears under /rooms (Rule 3).

### Change Log

- 2026-06-01 — Story 9.14 implemented (operator↔agent respond-to-announcements parity + 4 UI-polish fixes). Client/host-layer only; core + ratified MCP contract byte-identical (Rule 13 drift-guard empty). Honest gate green: lint 0 (story files) / typecheck 0 / build green / `pnpm test` 1200 passed (0 failed/0 skipped) / format clean. Rule 7 mutation-tested the reply-to-activate flip non-vacuous + reverted. Left UNCOMMITTED for the lead's post-CR Chrome smoke gate.

## Review Findings

### Code review (2026-06-01 — `bmad-code-review`, epic-cycle CR stage)

**Verdict: ✅ Clean review — APPROVED. 0 decision-needed, 0 patch, 0 defer, 0 dismissed. No HIGH / no MED / no LOW.**

Reviewed the combined dev+QA changeset (14 files: 7 production + 6 test blocks + tracking docs). Three review lenses (Blind Hunter / Edge Case Hunter / Acceptance Auditor) applied inline (subagents not mounted in this harness; no `{failed_layers}`).

**Honest gate — all green (re-run by the reviewer, not taken on trust):**
- `pnpm run build` — green (7 pkgs + apps/web).
- `pnpm test` (ROOT, canonical Rule-12 gate) — **1202 passed / 139 files / 0 failed / 0 skipped** (baseline 1185 → +17; matches the dev+QA target exactly). No `.only`/`.skip`/`.todo` in any changed test file. No Shiki-warmup flake this run.
- `pnpm run typecheck` — exit 0. `pnpm run lint` — exit 0 (clean; the dev's noted stray `smoke-seed-testing.mjs` is already gone — not in the tree).
- `prettier --check` on all 12 changed source/test files — clean.

**Rule 13 (LOAD-BEARING) — VERIFIED:** `git diff HEAD -- packages/core packages/mcp-server` is EMPTY (byte-identical). No `host.ts` change either. AC1 is purely a CLIENT-layer tree-model change (`loadTreeModel` builds proto-rows) + reuse of the EXISTING `reply` (the Epic-4 min-seq activator) + the EXISTING `/api/rooms/:id` (already serves proto-rooms) + `/announcements`. No new core op, no MCP/agent-wire change, no new `BOARD_ERROR_CODES`, no new host endpoint. Operator replies via the SAME core `reply` an agent uses — no backdoor, no fabricated op (Rule 13 satisfied).

**Rule 7 mutation spot-check (reviewer-independent, not taken on the dev/QA's word):** mutated the AC1 dedupe filter in `api-client.ts` (`!seenRoomIds.has(id)` → `true || …`) → the `loadTreeModel … deduped by roomId` test went **RED** (the duplicate `active-room` proto-row appeared, exactly as guarded). Reverted byte-identically (`git diff --stat` back to 35+/6-; zero `true ||` remaining). The dedupe assertion is non-vacuous. (The dev had already mutation-proved the reply-flip; QA the dedupe — independently re-confirmed here.)

**AC-by-AC (Acceptance Auditor):**
- **AC1** (proto-rooms navigable + reply activates) — MET with real-runtime evidence. Host-integration (`host.integration.test.ts`, real `createDataAccess` + real fetch): proto-room served `active:false` under `/announcements` NOT `/rooms`; reply lands a real `room.replied` (out-of-band ledger assertion), flips `active:true`, the now-active room appears under `/rooms`, and grant-on-act makes `ops` a participant. App-shell DOM (`App.test.tsx`): proto-row `data-pending=true` + `°` glyph → open → join → reply → row flips pending→active live + posture `you: @ops (peer)`. Rule 1 end-to-end path genuinely exercised; Rule 3 satisfied.
- **AC2** (join-first prominence) — MET. Labelled callout (heading names the project + "your draft is kept" sentence); test pins heading-names-project + "kept" + the `this project` fallback.
- **AC3** (watching-only disables initiate) — MET, both states pinned: watching-only → `disabled`+`aria-disabled`+terse reason, click does NOT open the panel; registered operator → enabled, no reason.
- **AC4** (self-post not announced) — MET, both boundaries pinned: operator's own post silent across the FULL pending→reconciled lifecycle; ANOTHER actor's reply still bumps "1 new post". Exclusion keys on `m.actor === operatorHandle` (same field as the existing `operatorReacted` line) and is wired in production (`RoomView` passes `operatorHandle` → `MessageThread`), not test-only.
- **AC5** (exclusivity + room legible) — MET, both halves pinned. `openInitiatePanel` closes the other panels; verified structurally complete — ALL three `set*Open(true)` calls route through the helper (no bypass open-site remains). The QA "room stays legible" test proves the room view stays mounted alongside the single open panel.

**Edge Case Hunter — no findings of substance.** Checked: `model===null` pre-load makes `watchingOnly` transiently `false` (affordances render only once the tree loads — benign); the fire-and-forget tree-refresh on reply-success is best-effort + cannot fail the reply reconciliation (App-level state, no unmount); active-wins precedence on a defensive roomId collision is correct (an activated room shows active, not pending).

No items deferred to `deferred-work.md` (nothing to defer).
