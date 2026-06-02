---
baseline_commit: 75e6e0bdbb0eec827959fe392edf675999f79800
---

# Story 9.8: Rooms as editor tabs

Status: done

<!-- Created by the /epic-cycle Lead Creates Story Files gate. Baseline: AGENTBBS-1-epic9 @ 75e6e0b (Story 9.7). -->

## Story

As an operator,
I want rooms to open as tabs I can keep open side-by-side,
so that I can work across multiple boundaries like files.

## Acceptance Criteria

**AC1 — Rooms open as tabs in a tab strip.**
**Given** I click rooms in the tree,
**When** they open,
**Then** each opens as a tab in the web tab strip (**active** = base bg + leading `•` when unread + trailing `×`; **inactive** = panel bg + dim text), and **multiple stay open side-by-side**.

**AC2 — Closing a tab ≠ leaving the room; unread clears on focus.**
**Given** a tab,
**When** I close it,
**Then** closing a tab does **not** leave the room (read stays board-wide — the operator is still whatever participant they were; closing is a VIEW action, not a board op),
**And** an unread `•` on a background tab **clears when focused**.

## Tasks / Subtasks

- [x] **Task 1 — `RoomTab` + `TabStrip` components (ui-shared)** (AC: #1)
  - [x] Author `src/room/RoomTab.tsx` + `src/room/TabStrip.tsx` per DESIGN `components.room-tab`: mono `identifier` label; **active** = `--surface-base` bg + `--text-strong` + a 2px `--accent` **top** rail + leading `•` (`--accent`) when unread + trailing `×` (`--text-faint`) close glyph; **inactive** = `--surface-panel` bg + `--text-dim`. 1px `--border` divider between tabs. Prop-driven: the open-tab list (room id + label + unread flag), the active tab, `onSelect(roomId)`, `onClose(roomId)`. Multiple tabs render side-by-side.
  - [x] Export `TabStrip`/`RoomTab` + types from the barrel.

- [x] **Task 2 — apps/web multi-tab room state** (AC: #1, #2)
  - [x] Replace the Story 9.5 single-open-room model with a multi-tab model: an ordered list of OPEN rooms + the ACTIVE room id. Clicking a tree room (Story 9.4 `selectRoom`) OPENS it as a tab (or focuses it if already open) and makes it active. The `RoomView` (Story 9.5) renders the ACTIVE tab's room.
  - [x] `onClose(roomId)`: removes the tab from the open list (and picks a sensible new active tab if the closed one was active). Closing does NOT call any board op — it is purely a VIEW state change (the operator remains whatever participant they were; reopening the tab shows the same room, read still board-wide). Add a clear comment/test asserting close fires NO write.
  - [x] Unread on a background tab: when a tab is NOT active and its room gains activity (folded from SSE, Story 9.4's tree-decoration fold can feed the tab unread too), show the leading `•`; when the tab is FOCUSED (becomes active), clear its unread `•`. Keep the fold immutable.
  - [x] Keep multiple `RoomView`s' data available (at least the active one rendered; you MAY keep background rooms' models cached for instant switch — but only the active is shown). Document the retain policy (a simple "keep open rooms' models in state" is fine; the VS Code WebviewPanel retain-context policy is an Epic 10 concern, noted).

- [x] **Task 3 — Tests** (AC: #1, #2)
  - [x] `TabStrip`/`RoomTab` DOM tests: open 2+ tabs side-by-side; active vs inactive styling (base+rail+×+leading-• when unread vs panel+dim); `onSelect`/`onClose` fire; unread `•` shows on a background tab, absent on the active/read tab.
  - [x] apps/web multi-tab tests: clicking two tree rooms opens two tabs; the active tab's RoomView renders; clicking an open room focuses (does not duplicate) its tab; closing a tab removes it + reactivates another + fires NO board write (assert no POST/write call); a background tab with SSE activity shows `•`, which clears when focused.
  - [x] **AC2 load-bearing assertion:** closing a tab is a VIEW-only action — assert it issues NO network write (no join/reply/leave call) and the operator's participation is unchanged (reopening shows the same room state). (The board has no "leave room" op; closing MUST NOT fabricate one.)
  - [x] Discoverable by default `pnpm test` (Rule 8); DOM in happy-dom; no `.only`/`.skip`/`.todo`.

- [x] **Task 4 — Gate**
  - [x] Honest gate: lint 0 / build (all + apps/web) / typecheck 0 / `pnpm test` (green, count up) / format --check. Record counts.

## Dev Notes

### What this story is (and is NOT)

- **IS:** the web tab strip (`TabStrip`/`RoomTab`), multi-room open/active/close state in apps/web (rooms behave like editor tabs, side-by-side), the active-tab `RoomView` rendering, background-tab unread `•` that clears on focus, and the "closing ≠ leaving" view-only semantic.
- **IS NOT:** the full live-update/optimistic/reconciliation polish (Story 9.9 — basic SSE-fed unread on tabs is fine here; 9.9 owns the optimistic post echo + retry), calm-states/connection-footer/voice/a11y (Story 9.10), the VS Code native editor-tab host (Epic 10 — this is the WEB tab strip; the leading-•/×/top-rail are web-only flourishes per DESIGN, the model stays prop-driven for Epic 10 reuse).

### Key semantic — closing a tab is a VIEW action, never a board op (AC2)

The board has NO "leave room" / "un-participate" op (membership/participation is append-only and monotonic — Epics 3–5). Closing a tab MUST be purely client-side view state: drop the tab from the open list. The operator stays a member/participant; reopening the tab re-fetches the same room; read remains board-wide (FR28). Do NOT invent a leave/close board write. (This mirrors EXPERIENCE.md: "closing a tab does not leave the room — read stays board-wide.")

### DESIGN.md room-tab spec (9.1 tokens)

- `components.room-tab`: `identifier` font; bg `--surface-panel`; active-bg `--surface-base`; active-rail `inset 0 2px 0 var(--accent)` (2px TOP rail); active-text `--text-strong`; rest-text `--text-dim`; divider 1px `--border`; unread-dot `--accent` (leading `•`); close-glyph `--text-faint` (trailing `×`). All WEB-ONLY (VS Code host renders tab chrome — Epic 10).
- [Source: DESIGN.md front-matter components.room-tab; §Components → Room tab; §Shapes. EXPERIENCE.md — Room tab ("one room per tab; open multiple side-by-side; × closes; closing does not leave the room; unread • clears when focused").]

### Source facts to VERIFY (Rule 4)

- apps/web currently opens a SINGLE room (Story 9.5 `RoomView` on `selectRoom`); `App.tsx` holds the selected room + its loaded model. 9.8 generalizes this to a tab list. VERIFIED at baseline 75e6e0b.
- Story 9.4 NavTree `selectRoom` + the SSE `foldTreeDelta` (immutable) drive room selection + tree unread; reuse the same delta signal to feed tab unread. The host needs NO new endpoint (tabs are pure client view state over the existing room reads).
- DESIGN tokens (9.1): room-tab, --surface-base/panel, --accent, --text-strong/dim/faint, --border, --radius (tabs are crisp, not pill).

### Smoke (lead-side gate — informational)

Browser smoke: build apps/web, run `agentbbs ui` against a seeded ledger with ≥2 rooms, drive real Chrome: click room A → opens as an active tab (base bg + top rail); click room B → opens a second tab side-by-side, B active, A inactive (panel/dim); click A's tab → A active again (no duplicate); an out-of-band reply in the inactive room shows its tab's leading `•`, which clears when that tab is focused; close a tab with `×` → it disappears, another stays active, and (out-of-band check) the operator's participation/membership in the closed room is UNCHANGED (no leave write fired).

### References

- [Source: epics.md#Epic 9 / Story 9.8] — ACs.
- [Source: DESIGN.md — components.room-tab; EXPERIENCE.md — Room tab.]
- [Source: apps/web/src/App.tsx (single-room baseline), api-client.ts (selectRoom + foldTreeDelta).]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, /epic-cycle dev stage).

### Debug Log References

- Initial multi-tab refactor regressed all 6 room-open tests: a stale `let isNew` flag set INSIDE a `setOpenTabs` updater was read by `if (isNew) loadTabRoom(roomId)` BEFORE the updater ran (React batches the updater; it does not run synchronously). Fixed by deciding open-vs-focus from the CURRENT `openTabs` via a functional `.some()` check OUTSIDE the updater, then calling `loadTabRoom` unconditionally for the new-tab branch (the updater keeps a double-open race guard). After the fix all 10 prior App tests + 6 new = 16 green.
- Lint flagged `react-hooks/exhaustive-deps` as an UNKNOWN rule (the plugin is not configured in this repo's flat ESLint config). Removed the `// eslint-disable-next-line react-hooks/exhaustive-deps` directive (it referenced a rule that does not exist → an error). The mount-once SSE effect reads the current active tab via `activeRoomIdRef` (a ref), not a captured value, so there is no genuine stale-closure concern for the configured rules.

### Completion Notes List

- **Task 1 — TabStrip/RoomTab (ui-shared, prop-driven, NFR2):** `RoomTab.tsx` renders one open room as an editor tab; active = `--surface-base` + `--text-strong` + a 2px `--accent` TOP rail (`boxShadow: inset 0 2px 0 var(--accent)`), inactive = `--surface-panel` + `--text-dim`; leading `•` (`--accent`) when `unread`; trailing `×` (`--text-faint`) close button whose click `stopPropagation()`s so it does not also fire `onSelect`. `TabStrip.tsx` renders the ordered open-tab list side-by-side with a 1px `--border` left-divider on every tab after the first; renders `null` when no tabs are open. Both exported from the barrel with their types. No core/data-access import; PascalCase one-per-file; no default export.
- **Task 2 — apps/web multi-tab state:** generalized the Story 9.5 single-open-room shell to an ordered `OpenTab[]` (roomId + label + unread + retained `room` model + per-tab roomError + joinedIntent) plus an `activeRoomId`. Clicking a tree room OPENS-or-FOCUSES its tab (focus clears its unread `•`, no refetch — model retained); the active tab's `RoomView` renders. SSE deltas fold into BOTH the tree (`foldTreeDelta`, unchanged) and the open-tab unread flags (`foldTabUnread`, immutable new array) — a background tab gains `•`, the active tab stays read (read via `activeRoomIdRef` so the mount-once handler sees the current active tab). **AC2:** `handleCloseTab` drops the tab + reactivates a neighbor (right→left→none) and fires NO board write — the board has no leave/un-participate op (Epics 3-5); reopening re-fetches the same room. **Retain policy:** each open tab keeps its loaded `RoomViewModel` in state for instant switch; only the active is rendered. The VS Code WebviewPanel retain-context LRU is an Epic 10 concern (documented in DESIGN room-tab + the App header comment).
- **Task 3 — Tests (Rule 3 real-runtime DOM evidence):** `TabStrip.test.tsx` (10 tests, ui-shared-dom happy-dom): 2 tabs side-by-side in order; renders nothing when empty; active base+strong+2px-accent-rail vs inactive panel+dim; background unread `•` shown / active-read absent; trailing `×` present; 1px `--border` divider between (not before first); `onSelect`/`onClose` fire with the room id; `×` does NOT also fire `onSelect`. `App.test.tsx` new block (6 tests): two tree clicks open two tabs + active RoomView renders; re-click focuses (no duplicate); **AC2 close removes + reactivates neighbor + writes==[] across close→reopen, posture unchanged (`you: @ops (peer)`)**; closing the last tab → empty placeholder, no write; background SSE `•` then clears on focus, no write; the active tab does NOT gain unread on its own room's SSE activity. A fetch stub COUNTS every non-GET as a board write so the no-write assertion is mechanical.
- **Rule 7 mutation-tests (non-vacuous, both reverted byte-identical, `grep MUTATION`=0 / focus-clear reverted):** (1) made `handleCloseTab` fire a phantom `postReply` → both `writes==[]` assertions went RED (the AC2 close test + the close-last-tab test). (2) made focus keep `unread: tab.unread` instead of clearing it → the focus-clears-unread test went RED.
- **Rule 4 (verify source facts):** all three story Source-facts confirmed at baseline — the 9.5 single-open-room `App.tsx` shell, the 9.4 `selectRoom` + immutable `foldTreeDelta`, and the DESIGN room-tab tokens (`--surface-base/panel`, `--text-strong/dim/faint`, `--accent`, `--border`, `identifier` font) all exist as described. No corrections needed.
- **Rules N/A:** Rule 5 (no NFR tripwire — all ACs implementable as worded), Rule 6 (ADR registry `docs/adr/` empty — none-required per the story). No new host endpoint (tabs are pure client view state over existing room reads, as the story states).
- **Honest gate (recorded):** `pnpm lint` exit 0; `pnpm typecheck` (`tsc --noEmit -p tsconfig.typecheck.json`) exit 0; `pnpm build` all packages + apps/web succeeded; `pnpm test` 131 files / **1023 passed** / 0 failed / 0 skipped (baseline 1007 → +16: 10 TabStrip + 6 App); no `.only/.skip/.todo` in the changeset; `pnpm format --check` clean. Left UNCOMMITTED for the lead's post-CR smoke gate.

### File List

- `packages/ui-shared/src/room/RoomTab.tsx` (new)
- `packages/ui-shared/src/room/TabStrip.tsx` (new)
- `packages/ui-shared/src/room/TabStrip.test.tsx` (new — RoomTab + TabStrip DOM tests)
- `packages/ui-shared/src/index.ts` (modified — barrel exports for TabStrip/RoomTab + types)
- `apps/web/src/App.tsx` (modified — single-open-room → multi-tab model; TabStrip wired; close = view-only; SSE-fed tab unread)
- `apps/web/src/App.test.tsx` (modified — new "rooms as editor tabs (Story 9.8)" describe block, 6 tests)
- `_bmad-output/implementation-artifacts/9-8-rooms-as-editor-tabs.md` (modified — frontmatter baseline_commit, task checkboxes, Dev Agent Record, status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — 9-8 ready-for-dev → in-progress → review)

### Change Log

- 2026-06-01 — Story 9.8 implemented: rooms as editor tabs. New ui-shared `TabStrip`/`RoomTab` (active/inactive + accent top rail + background-unread `•` + close `×`); apps/web generalized to a multi-tab open/active/close model with SSE-fed background-tab unread that clears on focus. AC2 load-bearing semantic — closing a tab is VIEW-ONLY, fires NO board write (proven mechanically + mutation-tested non-vacuous). Gate green (lint 0 / typecheck 0 / build OK / 1023 tests pass / format clean). Status → review.

### Review Findings

**Code review (2026-06-01, /epic-cycle code-review stage) — APPROVED. 0 HIGH / 0 MED / 0 patch-required. 2 LOW dismissed. Status → done.**

Adversarial review against AC1 (rooms as tabs; active=base+top-rail+leading-•-when-unread+trailing-×, inactive=panel+dim; multiple side-by-side) and AC2 (close=VIEW-ONLY, focus clears unread). All ACs met.

Reviewer-verified, independent of the dev/QA claims:

- **AC2 CLOSE = VIEW-ONLY (load-bearing) — CONFIRMED + reviewer-mutation-verified non-vacuous.** `handleCloseTab` (`App.tsx:267`) fires NO board write (no leave/un-participate — the board has no such op); it only drops the tab + reactivates a neighbor; reopening re-fetches the same room (posture `you: @ops (peer)` unchanged across close→reopen). MUTATION: inserted a phantom `postReply(roomId, …)` into `handleCloseTab` → 4 close-no-write tests went RED (AC2-close, close-last, middle-tab, inactive-tab); reverted byte-identical (`grep MUTATION` = 0; suite re-GREEN).
- **FOCUS-CLEARS-UNREAD + immutable SSE fold — CONFIRMED + reviewer-mutation-verified non-vacuous.** `foldTabUnread` (`App.tsx:160`) returns a NEW tabs array (no prior-state mutation) and reads the CURRENT active tab via `activeRoomIdRef` (the stale-active-ref bug is genuinely fixed — the active tab never accrues unread; proven by the "active tab does not gain unread on its own SSE" test). Focus clears `•` in the `alreadyOpen` branch of `handleSelectRoom` (`App.tsx:222`, `unread: false`). MUTATION: changed the clear to `unread: tab.unread` → the focus-clears-unread test went RED; reverted byte-identical, suite re-GREEN.
- **OPEN-OR-FOCUS / neighbor-pick — CONFIRMED.** Re-clicking an open room focuses (no duplicate tab; inner `.some()` appender guard); a new room appends; close neighbor-pick `Math.min(index, next.length-1)` is right→left→none (the middle-tab test exercises the RIGHT branch explicitly; close-last → empty placeholder + strip unmounts).
- **TAB STYLING (DESIGN) — CONFIRMED.** Active = `--surface-base` + `--text-strong` + 2px `--accent` inset top rail; inactive = `--surface-panel` + `--text-dim`; leading `•` (`--accent`) on background unread; trailing `×` (`--text-faint`); 1px `--border` divider after the first tab; the `×` `stopPropagation()`s so it does not also fire `onSelect` (asserted).
- **MODULE BOUNDARY (NFR2) — CONFIRMED.** `RoomTab.tsx`/`TabStrip.tsx` import only React + the sibling local file — no `@agentbbs/core`/`@agentbbs/data-access`; fully prop-driven. No new host endpoint; open/close/focus/unread are pure client view state over the existing room reads.
- **Rules:** Rule 1 (TabStrip/RoomTab really consumed by apps/web in `App.test.tsx` via real tree-row clicks — real integration, not a mock), Rule 3 (real happy-dom render evidence over a stubbed host JSON-API + SSE), Rule 7 (both load-bearing mutations reviewer-verified non-vacuous + reverted byte-identical), Rule 8 (29 changed-file tests discoverable in the default `pnpm test`; no `.only/.skip/.todo`). Rules 5, 6 N/A (no NFR tripwire; `docs/adr/` empty → none-required).
- **Honest gate re-run GREEN by the reviewer:** lint exit 0 (changeset) · typecheck (`tsc --noEmit -p tsconfig.typecheck.json`) exit 0 · full default `pnpm test` **1026 passed** / 131 files / 0 failed / 0 skipped (baseline 1007 → +19: 10 TabStrip + 9 App-9.8-block).

LOW (dismissed — no code change):

- [Review][Dismiss] `roomLabelFromTree` JSDoc says "its subject, falling back to the id" but returns `room.roomId`. Behavior is CORRECT per DESIGN (the tab label is the mono room `identifier`, i.e. the room id `#room-id`, not the human subject); only the doc-comment word "subject" is loose. Cosmetic.
- [Review][Dismiss] Two same-frame clicks on the same UNopened room read the render-time `openTabs` closure in the open-or-focus decision (`App.tsx:217`) and could both take the not-open branch → `loadTabRoom` (a GET) fires twice. Benign: the appender's inner `.some()` guard prevents a duplicate TAB, and the doubled call is a read, never a write. No user-visible defect.
