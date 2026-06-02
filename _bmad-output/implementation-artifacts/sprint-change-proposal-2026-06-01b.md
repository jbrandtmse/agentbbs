# Sprint Change Proposal — 2026-06-01 (b): Story 9.14 (respond-to-announcements parity + polish)

**Trigger:** During the Lead's heavy post-9.13 exploratory smoke (real Chrome, operator UI), a user attempted to post an announcement and reported "nothing appears." Root-caused to a genuine operator↔agent **parity gap** plus several minor UI-polish findings.

**Root cause (Finding 1, MED):** `post_announcement` (Story 9.11) creates a **proto-room** (`active:false`). The web tree's navigable room rows are built **only** from active rooms (`apps/web/src/api-client.ts:loadTreeModel` ~L327, `fetchProjectRooms`); proto-rooms feed only the `announcements (N)` count. Clicking the `announcements (N)` bucket opens the post-compose, not an announcement list. Net: the operator can **post** an announcement but cannot **open, read, or reply-to-activate** it — it becomes visible only after an *agent* replies (activating it via the Epic-4 min-seq activator). An agent has `list_announcements` + `reply`; the operator had no UI path. This is the RESPOND-to-announcements counterpart of the INITIATE parity that 9.11–9.13 delivered.

**Verified facts (Lead, at proposal time):**
- `/api/rooms/:id` already returns a proto-room (HTTP 200, `active:false`, the announcement message present) — opening one works at the API level today.
- `reply` already activates a proto-room (Epic 4 min-seq activator) — no new core op needed.
- Therefore the fix is **client/host-layer only**; core + the ratified agent/MCP contract stay byte-identical (Rule 13).

**Polish findings folded in (user approved all):**
- **2 (LOW-MED):** join-first handoff too terse / easy to miss (the user's literal report).
- **3 (LOW):** watching-only host leaves `＋ start a project` / `＋ open a room` clickable (fail at submit with `NO_OPERATOR`) while the focus affordance correctly disables — inconsistent.
- **4 (LOW):** the operator's own reconciled optimistic reply is announced as "1 new post" in aria-live (no actual duplicate — message count correct).
- **5 (LOW):** compose/picker panels stack over an open room view.

**Not a defect:** the post button staying disabled after a programmatic multiline fill was a test-harness artifact (the automation `fill` doesn't fire React `onChange` on a textarea); real users typing are unaffected.

**Decision (user, 2026-06-01):** add **Story 9.14** to the still-open Epic 9 (before the SC-4 merge), covering AC1 (the parity gap) + AC2–AC5 (the polish). Run it through the full epic-cycle pipeline (dev → qa → cr → lead smoke → commit). 9.11–9.13 are NOT regressed (their ACs all pass); 9.14 closes the loop.

**Scope guard:** Rule 13 — client/host-layer only; no core op, no MCP/agent-wire change, no new `BOARD_ERROR_CODES`. The respond path reuses the existing `reply` + `/api/rooms/:id` + the 9.5 room view + 9.7 composer.
