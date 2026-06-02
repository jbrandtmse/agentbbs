---
baseline_commit: 14ba7205db4881a64b147131e2056de2b6b1983f
---

# Story 9.4: Board navigation tree with decorations and NEEDS YOU queue

Status: review

<!-- Created by the /epic-cycle Lead Creates Story Files gate. Baseline: AGENTBBS-1-epic9 @ 14ba720 (Story 9.3). -->

## Story

As an operator,
I want a sidebar tree of projects and rooms with unread/needs decorations,
so that I can browse the whole board (global read) and see where I'm explicitly needed.

## Acceptance Criteria

**AC1 — Tree structure + global read (FR28).**
**Given** the board state,
**When** the tree renders,
**Then** it shows an `AgentBBS` header, a pinned `NEEDS YOU (n)` section, one collapsible section per project (each expanding to an announcements bucket + its room rows), and a `＋ join a project…` action,
**And** I can browse **every** project and room regardless of membership (FR28 global read — the tree lists all projects/rooms from the open-read directory, not only ones I belong to).

**AC2 — Live unread/activity decorations.**
**Given** a room I participate in gains activity,
**When** the tree updates live (folding SSE deltas),
**Then** the row shows an unread `•` marker and an activity count; read rows show no unread badge (a `°` read glyph per DESIGN.md). Decorations update in near-real-time as deltas land.

**AC3 — NEEDS YOU is explicit-escalation-only (never time-based).**
**Given** an agent explicitly pulls the operator into a room (`add_participant(@operator)`),
**When** the tree updates,
**Then** that room appears under `NEEDS YOU (n)` with a warm `!` marker (flag-warm, **never red**), and it appears there **ONLY** by explicit escalation — **never via time-based inference**; a quiet/idle room shows **no** NEEDS YOU flag and **no** warning styling (quiet = healthy). Leaving the queue is a consequence of the room being handled, not a manual dismiss.

## Tasks / Subtasks

- [x] **Task 1 — Operator identity + NEEDS YOU host endpoint** (AC: #3)
  - [x] The tree needs to know "who am I" (the operator handle) to compute `@operator (you)` and the NEEDS YOU queue. Add operator-identity resolution to the host: a configurable operator handle via `agentbbs ui --as <handle>` / `AGENTBBS_OPERATOR` env (document the default — see Dev Notes → Operator identity). Expose it via a read endpoint `GET /api/me → { handle | null }`.
  - [x] Expose the NEEDS YOU derivation as host data: the rooms where the operator was **explicitly added as a participant** (`room.participant_added` naming the operator handle — the `add_participant(@operator)` escalation), derived from core (`roomParticipants`/`isParticipant` + the participant-added event). This is DETERMINISTIC board state, NOT time-based. Either a dedicated `GET /api/needs-you → { rooms }` endpoint, or enough per-room participant data on the existing room/rooms endpoints for the client to derive it — pick one, document it. NEVER derive NEEDS YOU from inactivity/age/time.
  - [x] Document that @mention-based escalation (the AC's "/ @mention") is a documented secondary signal; the `add_participant(@operator)` path is the load-bearing, testable V1 escalation. If @mention scan is implemented, base it on a real marker; if deferred, note it in deferred-work.md with rationale (do not fake it).

- [x] **Task 2 — `NavTree` component (ui-shared)** (AC: #1, #2, #3)
  - [x] Author `src/tree/NavTree.tsx` (+ small row subcomponents, PascalCase, one per file) in `@agentbbs/ui-shared` rendering: the `AgentBBS` header, the operator identity row (`@operator (you)` when a handle is known), the pinned `NEEDS YOU (n)` section (only when n>0), per-project collapsible sections (twisty → announcements bucket `* announcements` + `#room` rows), and the `＋ join a project…` action row.
  - [x] Style strictly from the Story 9.1 token core + DESIGN.md `components.sidebar-tree-item`/`unread-badge`/`needs-you-item`/`section-label`: mono `tree-item` rows, 3px-tight row-y, the 2px accent **left rail** on the active row (`selected-rail`), the custom glyph set `•` unread (accent) · `°` read (faint) · `!` NEEDS YOU (flag-warm) · `*` announcements (web-only flourishes), the `section-label` (UPPERCASE, tracked) for section headers, the unread count pill (`unread-badge`, `--badge-bg`, `--radius-full`). NEEDS YOU text = `--flag-warm-text`, icon = `--flag-warm`. NEVER red.
  - [x] The component is presentation-only (NFR2 — no core/data-access import); it takes the tree model (projects → rooms, unread/needs flags, active room, operator handle) as props. Keyboard-navigable + nav tree a11y roles are an AC of Story 9.10 — for 9.4, structure the markup so roles can be added there (use semantic list/treeitem-friendly structure), but the full a11y floor is 9.10's.
  - [x] Export `NavTree` (+ its model types) from the barrel.

- [x] **Task 3 — apps/web tree wiring + global read** (AC: #1, #2)
  - [x] In `apps/web`, build the tree model from the JSON API: `/api/directory` (all projects — global read), `/api/projects/:id/rooms` + `/api/projects/:id/announcements` per project, `/api/me`, and the NEEDS YOU data (Task 1). Render `NavTree` in the sidebar, replacing the minimal 9.3 shell list.
  - [x] Fold SSE deltas into the tree model so decorations update live (AC2): a new `reply`/`room.message`/`announcement.posted` in a room bumps that row's unread `•` + activity count; clicking/focusing a room clears its unread (the rich tab-focus-clear is refined in 9.8/9.9 — for 9.4, a basic "selected room clears unread" is enough). Keep the fold IMMUTABLE (new state object), consistent with the 9.3 `foldDelta` pattern.
  - [x] Global read: the tree lists EVERY project/room from `/api/directory`, regardless of operator membership (FR28). Do not filter to membership.

- [x] **Task 4 — Tests** (AC: #1, #2, #3)
  - [x] `NavTree` DOM tests (happy-dom): renders header + NEEDS YOU section (present when n>0, absent when 0) + per-project sections with announcements bucket + room rows + join action; global-read (all projects shown); unread `•` vs read `°`; activity count badge; NEEDS YOU rows use flag-warm (assert the flag-warm token class/color, assert NOT red).
  - [x] **AC3 load-bearing test (the marquee semantic — mutation-test it, Rule 7):** NEEDS YOU is populated by an `add_participant(@operator)` escalation and NOT by inactivity. A room with NO participant-add for the operator — even if old/quiet — must NOT appear in NEEDS YOU. Mutation-test: temporarily make the derivation time-based (e.g. "rooms with no recent activity") and confirm the test goes RED (a quiet non-escalated room wrongly entering NEEDS YOU), then restore byte-identical. This pins "explicit-escalation-only, never time-based."
  - [x] Host endpoint tests (`/api/me`, NEEDS YOU derivation) over a real `createDataAccess` ledger (Rule 3): add_participant(@operator) → room appears in NEEDS YOU data; a quiet room the operator was never added to → absent. snake_case wire.
  - [x] Discoverable by default `pnpm test` (Rule 8); DOM tests in the `ui-shared-dom`/apps-web happy-dom project; no `.only`/`.skip`/`.todo`.

- [x] **Task 5 — Gate**
  - [x] Honest gate: lint 0 / build (all + apps/web) / typecheck 0 / `pnpm test` (green, count up) / format --check. Record counts.

## Dev Notes

### What this story is (and is NOT)

- **IS:** the sidebar `NavTree` component (ui-shared) + its apps/web wiring over the JSON API (global-read tree of all projects/rooms), live unread/activity decorations folded from SSE, and the explicit-escalation-only NEEDS YOU queue + the operator-identity/escalation host data it needs.
- **IS NOT:** the room thread/tab contents (9.5/9.8), the 👍/agreed UI (9.6), the join-gate composer (9.7), the full optimistic/reconciliation + live-clear polish (9.9), the keyboard/screen-reader a11y floor (9.10 — structure for it, don't fully implement it here). The actual `＋ join a project…` ACTION (joining) is Story 9.7's join flow; here the row exists and is clickable but the join wiring can be a stub/handed-off (document it).

### Operator identity (design decision — RECOMMENDED + rationale)

The board has no special "operator" type — the operator is just a claimed handle (like an agent). The UI must know which handle is "me" to render `@operator (you)` and compute NEEDS YOU. RECOMMENDED: the host resolves the operator handle from `agentbbs ui --as <handle>` or `AGENTBBS_OPERATOR` env; if unset, `/api/me` returns `{ handle: null }` and the UI shows a watching-only posture (no NEEDS YOU personalization, global read still works — you can browse everything as an anonymous observer). Document this; do NOT invent a registration flow here (identity bootstrap is the BMad kit's job; the operator may reuse an existing handle). The `@operator (you)` label uses the resolved handle; "(you)" is the UI's marker, the handle is whatever was claimed.
- NEEDS YOU is **per-operator** (rooms THIS handle was pulled into). With no operator handle, NEEDS YOU is empty (nothing can be escalated to "nobody").

### NEEDS YOU derivation (deterministic, never time-based — the load-bearing semantic)

- The escalation signal is `add_participant(@operator)` → a `room.participant_added` event naming the operator handle. NEEDS YOU = the set of rooms where the operator was explicitly added (and, by the spec, not yet "handled" — for V1, "handled" leaving-the-queue can be a documented simplification: presence in NEEDS YOU = currently-an-added-participant; the richer "handled" semantics can be refined later/deferred with rationale). Use core `roomParticipants`/`isParticipant` + the participant-added event.
- **NEVER** derive NEEDS YOU from inactivity, age, or any time/clock signal. EXPERIENCE.md is explicit: this is "a deliberate inversion of the old time-based FR30 — agents flag when they truly need a human"; "quiet/idle room = healthy, never a warning." A quiet room with no operator escalation must NOT appear. This is the AC3 mutation-test target.

### DESIGN.md tree specs (tokens shipped in 9.1)

- `components.sidebar-tree-item`: mono `tree-item` font, `--space-tree-row-y` (3px) padding, `--text`/`--text-dim`/`--text-faint`, `--selection` active fill + `inset 2px 0 0 var(--accent)` left rail, glyphs `•` unread (`--accent`) / `°` read (`--text-faint`) / `!` needs (`--flag-warm`) / `*` announcements.
- `components.section-label`: UI 10.5px, UPPERCASE, letter-spacing 0.9px — for `NEEDS YOU` + project names.
- `components.unread-badge`: mono count pill, `--radius-full`, `--badge-bg`/`--badge-fg`, right-aligned (web may show full count).
- `components.needs-you-item`: `!` icon `--flag-warm`, text `--flag-warm-text`, `(n)` on the section label. Warm, never red.
- [Source: DESIGN.md front-matter components + §Components; EXPERIENCE.md Information Architecture + Component Patterns + States (Quiet/idle = healthy).]
- VS Code surface uses a native TreeView + FileDecorationProvider; the `•/°/!/*` glyphs + 2px rail are WEB-ONLY (per-surface delta). This story is the WEB tree; the VS Code tree is Epic 10. Build the component web-first but keep the model prop-driven so Epic 10 can reuse the model.

### Source facts to VERIFY (Rule 4)

- JSON API already exposes `/api/directory` (all projects), `/api/projects/:id/rooms`, `/api/projects/:id/announcements`, `/api/projects/:id/members`, `/api/rooms/:id` (room + messages incl. participants), `/api/rooms/:id/contract`. VERIFIED in `packages/cli/src/host/json-api.ts`. You ADD `/api/me` + the NEEDS YOU data.
- `apps/web/src/api-client.ts` has `fetchDirectory` + `openEventStream`/`foldDelta` (immutable SSE fold) — extend the client with the per-project room/announcement fetches + `/api/me` + NEEDS YOU. `App.tsx` is the shell to replace with the tree.
- core exposes `boardDirectory`, `listRooms`/`listAnnouncements`, `roomParticipants`/`isParticipant`, the participant-added event in `EVENT_TYPES`. VERIFIED in `packages/core/src/index.ts`. NEEDS YOU derives from these.
- `@agentbbs/ui-shared` token core (`tokens.css`) + the `ui-shared-dom` happy-dom vitest project exist (9.1). NavTree DOM tests run there.

### Smoke (lead-side gate — informational)

Browser smoke: build apps/web, run `agentbbs ui --as <handle>` against a seeded ledger where the operator was add_participant'd into one room (and other quiet rooms exist), drive real Chrome, assert: the tree lists ALL projects/rooms (global read), the escalated room is under NEEDS YOU with the warm `!` (and is NOT red), the quiet rooms are NOT in NEEDS YOU, and an out-of-band reply bumps a room's unread `•`/count live via SSE.

### References

- [Source: epics.md#Epic 9 / Story 9.4] — ACs.
- [Source: EXPERIENCE.md — Information Architecture (tree, NEEDS YOU, global read), Component Patterns (Sidebar tree item / NEEDS YOU item / Unread badge), States (Quiet/idle = healthy; Unread).]
- [Source: DESIGN.md — components.sidebar-tree-item / section-label / unread-badge / needs-you-item.]
- [Source: packages/cli/src/host/json-api.ts, apps/web/src/api-client.ts] — existing read routes + client seam.
- [Source: packages/core/src/index.ts] — boardDirectory / roomParticipants / participant-added event.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow).

### Debug Log References

- AC3 mutation-test (Rule 7) — `packages/core/src/rooms/needs-you.mutation.test.ts`: temporarily mutated `needsYouRooms` from the explicit-escalation scan (`event.type === 'room.participant_added' && event.payload.handle === operator`) to a non-escalation "every announced room" scan (`event.type === 'announcement.posted'`); ran RED (actual `["old-and-quiet","genuinely-needs-ops"]` vs expected `["genuinely-needs-ops"]` — a quiet, never-escalated room wrongly entered NEEDS YOU, exactly the AC3 failure); restored the production code and confirmed GREEN. The mutation + result are documented in the test file header for the next agent.
- Lint module-boundary fix: core tests may NOT import `@agentbbs/data-access` (lint-enforced). Rewrote both `needs-you` core tests to drive the real core write ops against an in-memory `DataAccess` fake (the `add-participant.test.ts` pattern) instead of `createDataAccess`. The host-side endpoint tests use the real `createDataAccess` ledger (cli is allowed to).

### Completion Notes List

- **Task 1 — Operator identity + NEEDS YOU host data.** Added core `needsYouRooms(dataAccess, operator)` (`packages/core/src/rooms/needs-you.ts`, barrel-exported): deterministic, append-derived from `room.participant_added` naming the operator; `null`/empty operator → `[]` (watching-only). Host: `GET /api/me → { handle | null }` and `GET /api/needs-you → { rooms }` (snake_case). Threaded an `operatorHandle` through `createHost`/`startHost`/`handleApiRequest` (defaults `null` — back-compatible with the 9.3 call sites). CLI: `agentbbs ui --as <handle>` + `AGENTBBS_OPERATOR` env, canonicalized (lowercase/trim) via `resolveOperatorHandle`. @mention secondary signal DEFERRED with rationale in `deferred-work.md` (no real mention marker in the data model; a body-text scan would be a spoofable heuristic — not faked).
- **Task 2 — `NavTree` (ui-shared).** Presentation-only (NFR2 — no core/data-access import); prop-driven `NavTreeModel`. Row subcomponents one-per-file: `SidebarTreeItem` / `SectionLabel` / `UnreadBadge` / `NeedsYouItem`. Styled strictly from tokens.css/DESIGN.md: mono `tree-item` rows, 3px row-y, 2px accent left rail on the active row (`inset 2px 0 0 var(--accent)` + `--selection` fill), glyphs `•`(--accent)/`°`(--text-faint)/`!`(--flag-warm)/`*`, `section-label` (UPPERCASE tracked), `unread-badge` pill (`--badge-bg`/`--radius-full`). NEEDS YOU text=`--flag-warm-text`, icon=`--flag-warm` — never red. Semantic `<ul role="tree">`/`<li role="treeitem">` structure left for the Story 9.10 a11y floor. Exported NavTree + model types from the barrel.
- **Task 3 — apps/web wiring + global read.** Extended `api-client.ts` with `fetchMe`/`fetchNeedsYou`/`fetchProjectRooms`/`fetchProjectAnnouncements`, `loadTreeModel` (builds the model from EVERY project/room — FR28 global read, not membership-filtered), the IMMUTABLE `foldTreeDelta` (reply/announcement bumps unread `•`+count unless the room is selected; a participant_added naming the operator adds it to NEEDS YOU live), and `selectRoom` (basic clear-on-select). `App.tsx` now renders `NavTree`; the `＋ join a project…` row is clickable with a documented stub handler (join flow → Story 9.7).
- **Task 4 — Tests.** `NavTree.test.tsx` (11, happy-dom): structure, global read, NEEDS YOU present/absent, unread `•` vs read `°`, activity badge, flag-warm-not-red. `needs-you.test.ts` (5) + `needs-you.mutation.test.ts` (1, Rule 7). Host `json-api.test.ts` (+5) for `/api/me` + `/api/needs-you` over a real ledger. `ui.test.ts` (+3): `--as` parse, `resolveOperatorHandle`, real-HTTP `/api/me`+`/api/needs-you`. `api-client.test.ts` (+8): tree fold/select/loader. `App.test.tsx` rewritten (3) for the NavTree-based shell + live SSE unread bump.
- **Task 5 — Honest gate (recorded).** lint **0 errors / 0 warnings**; typecheck **0**; build **7/7 packages + apps/web vite build** GREEN; `pnpm test` **889 passed / 126 files** (up from 728 baseline; 0 failed, 0 skipped, no `.only`/`.skip`/`.todo`); `prettier --check` clean.
- **NOT built (handed off, per Dev Notes):** room thread/tab contents (9.5/9.8), 👍 (9.6), join action wiring (9.7), full a11y (9.10). NEEDS YOU "handled" leaving-the-queue is the documented V1 simplification (presence = currently-an-added-participant).

### File List

**Added:**
- `packages/core/src/rooms/needs-you.ts`
- `packages/core/src/rooms/needs-you.test.ts`
- `packages/core/src/rooms/needs-you.mutation.test.ts`
- `packages/ui-shared/src/tree/NavTree.tsx`
- `packages/ui-shared/src/tree/NavTree.test.tsx`
- `packages/ui-shared/src/tree/SidebarTreeItem.tsx`
- `packages/ui-shared/src/tree/SectionLabel.tsx`
- `packages/ui-shared/src/tree/UnreadBadge.tsx`
- `packages/ui-shared/src/tree/NeedsYouItem.tsx`

**Modified:**
- `packages/core/src/index.ts` (export `needsYouRooms`)
- `packages/cli/src/host/json-api.ts` (`/api/me` + `/api/needs-you` routes; `ApiContext`; `operatorHandle` param)
- `packages/cli/src/host/json-api.test.ts` (operator + NEEDS YOU endpoint tests)
- `packages/cli/src/host/server.ts` (`operatorHandle` option threaded to the API)
- `packages/cli/src/ui.ts` (`--as` flag + `resolveOperatorHandle` + AGENTBBS_OPERATOR + pass to host)
- `packages/cli/src/ui.test.ts` (--as parse, resolveOperatorHandle, real-HTTP me/needs-you)
- `packages/ui-shared/src/index.ts` (barrel: NavTree + subcomponents + model types)
- `apps/web/src/api-client.ts` (tree-model fetches/builder/fold/select)
- `apps/web/src/api-client.test.ts` (tree fold/select/loader tests)
- `apps/web/src/App.tsx` (render NavTree from the model + live SSE fold)
- `apps/web/src/App.test.tsx` (rewritten for the NavTree shell)
- `_bmad-output/implementation-artifacts/deferred-work.md` (@mention secondary signal deferral)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (9-4 → in-progress → review)

### Change Log

- 2026-06-01 — Story 9.4 implemented: board navigation tree (ui-shared `NavTree`, prop-driven, presentation-only), apps/web wiring over the JSON API (global read FR28 + immutable SSE decoration fold), and the deterministic explicit-escalation-only NEEDS YOU queue (core `needsYouRooms` + host `/api/me` + `/api/needs-you` + CLI `--as`/`AGENTBBS_OPERATOR`). AC3 mutation-tested non-vacuous (Rule 7). @mention secondary signal deferred with rationale. Gate GREEN: lint 0 / typecheck 0 / build 7-7+web / test 889 (126 files) / format clean. Status → review.

## Review Findings (code-review stage, 2026-06-01)

**Verdict: APPROVED.** 0 HIGH / 0 MED / 0 decision-needed / 0 new deferred. All 3 ACs and every CRITICAL-focus directive point independently re-verified. No code changes required.

Gate re-run by the reviewer: lint **0**, typecheck **0**, `pnpm test` **891 passed / 126 files** (855→891 over the dev+QA changeset; 0 failed, 0 skipped, no `.only/.skip/.todo`).

**AC3 — the marquee semantic (explicit-escalation-only, never time-based):**
- `needsYouRooms` (`packages/core/src/rooms/needs-you.ts`) derives the queue from the SINGLE signal `event.type === 'room.participant_added' && event.payload.handle === operator`. There is NO clock/age/last-activity input anywhere — confirmed by reading the full derivation. A null/empty operator → `[]` (watching-only). A self-`reply` by the operator does NOT enrol (only the explicit ADD is scanned) — pinned by a dedicated core test.
- **Mutation test independently re-confirmed non-vacuous (Rule 7):** because `needs-you.ts` is untracked, I verified by CONTENT, not `git checkout` — recorded the file hash (`1c9858…`), mutated the production scan to the documented time/every-room stand-in (`event.type === 'announcement.posted'`), ran `needs-you.mutation.test.ts` → RED with EXACTLY the documented diff (`["old-and-quiet","genuinely-needs-ops"]` vs expected `["genuinely-needs-ops"]` — the quiet, never-escalated room wrongly entering NEEDS YOU), then restored and confirmed the hash is byte-identical (`1c9858…`) and the test green. The guard discriminates the real semantic.
- A quiet/never-escalated room is absent at every layer: core test (`toEqual([])`), host test (`/api/needs-you` → `rooms: []`).

**MODULE BOUNDARY (NFR2):** `needsYouRooms` lives in CORE (board logic), exported from the core barrel; the host (`json-api.ts`/`server.ts`) stays session-agnostic — it only threads an opaque `operatorHandle` and delegates to core, carrying no derivation of its own. `NavTree` + its 4 subcomponents import NOTHING from core/data-access (prop-driven `NavTreeModel`); the web client speaks the JSON API only. Core `needs-you` tests drive an in-memory `DataAccess` fake (NOT `@agentbbs/data-access`) — lint-clean (the dev's documented fix holds; grep confirms no data-access import in the new core files).

**@MENTION DEFERRAL:** honest deferral recorded in `deferred-work.md` (story 9.4 entry) — there is no structured mention marker in the data model and a body-text regex would be spoofable/non-deterministic, contradicting AC3. NOT faked, NOT half-built. Correct per AC3 determinism.

**NEEDS-YOU-NOT-RED:** `NeedsYouItem` text=`var(--flag-warm-text)`, icon=`var(--flag-warm)`; the row `!` glyph=`var(--flag-warm)`. Grep confirms the only `red` occurrences in `tree/` are documentation comments — zero red color literals. Asserted by the DOM test (no red literal in the rendered `outerHTML`).

**GLOBAL READ (FR28):** `loadTreeModel` builds from EVERY project in `/api/directory` + every room, NOT membership-filtered; DOM test lists all projects/rooms regardless of membership.

**Live fold immutability:** `foldTreeDelta`/`bumpRoomActivity`/`applyEscalation`/`selectRoom` all return NEW objects via spread; no prior-state mutation. The live escalation case keys on the canonical (lowercased) operator handle, matching `/api/me` + the canonical `participant_added` payload.

**Rule 1 (real integration, not nominal):** confirmed — host endpoints tested over a REAL `createDataAccess(:memory:)` ledger with `addParticipant`; the CLI test drives `runUi` over REAL HTTP and verifies case-folding (`'OPS'` → matches `ops`); apps/web `App.test.tsx` mounts the REAL ui-shared `NavTree` and folds a REAL SSE reply delta to bump unread `•`/count. **Rule 3** (real-runtime) satisfied at both the host (real ledger) and UI (real DOM) layers. **Rule 5** satisfied — the "never time-based" inversion of old FR30 is enforced in code (no clock input), not worked-around in a comment. **Rule 8** — all tests discoverable by default `pnpm test`, no `.only/.skip/.todo`.
