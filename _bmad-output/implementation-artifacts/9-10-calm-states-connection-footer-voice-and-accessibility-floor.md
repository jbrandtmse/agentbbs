---
baseline_commit: b2ec037994f3e2541d9e284788861eb17c4dc6d7
---

# Story 9.10: Calm states, connection footer, voice, and accessibility floor

Status: done

<!-- Created by the /epic-cycle Lead Creates Story Files gate. Baseline: AGENTBBS-1-epic9 @ b2ec037 (Story 9.9). EPIC 9 CAPSTONE. -->

## Story

As an operator,
I want calm empty/cold/disconnected states, terse voice, and a keyboard/screen-reader floor,
so that the tool stays calm, pull-only, and usable.

## Acceptance Criteria

**AC1 — Calm empty / cold / disconnected states.**
**Given** an empty board / cold open / lost connection,
**When** each occurs,
**Then** I see `no projects yet` + one next action / last-known tree with **no blocking spinner** / an inline `reconnecting…` footer LED (**never a modal**, already-loaded content stays readable),
**And** a quiet/idle room is shown as **healthy** — never a warning or nag.

**AC2 — Voice / microcopy.**
**Given** the microcopy,
**When** I read the UI,
**Then** it is **terse, lowercase-leaning, and calm** (`needs you (1)`, `@operator (you)`, `you joined · type to post…`, `connected`), with **lowercase room ids and handles**.

**AC3 — Keyboard + screen-reader floor.**
**Given** keyboard and screen-reader use,
**When** I navigate,
**Then** the tree/thread/composer are **keyboard-navigable**, the tree exposes **nav roles + expanded state**, the thread is a **list of posts announcing handle/timestamp/agreed state** (a **live region coalesces** new posts/👍), focus is **visible at AA**, and **reduced-motion is respected**.

## Tasks / Subtasks

- [x] **Task 1 — Calm states (AC1)**
  - [x] **Empty board:** when there are no projects, the tree shows `no projects yet` + ONE next action (e.g. the `＋ join a project…` row as the single affordance). No spinner-over-everything.
  - [x] **Cold open:** render the last-known tree immediately; the focused room's thread loads into it; NO blocking spinner over the whole app. A brief skeleton/placeholder for the loading region is acceptable (calm, not a full-screen spinner).
  - [x] **Disconnected:** when the SSE/host connection is lost, show an inline `reconnecting…` state in the connection footer (Task 2) — NEVER a modal; already-loaded content stays readable + interactive (reading is offline-tolerant; writes can fail inline per Story 9.9). On reconnect, resume the live fold (9.9) without losing or double-applying.
  - [x] **Quiet/idle room = healthy:** confirm there is NO "stalled"/warning/nag styling or decoration for an idle room (the deliberate inversion of the old time-based FR30). A quiet room looks exactly like a healthy room. (This re-affirms the 9.4 NEEDS-YOU-is-explicit-only posture at the room level.)

- [x] **Task 2 — Connection footer (AC1, AC2)**
  - [x] Author `src/chrome/ConnectionFooter.tsx` (or co-locate) per DESIGN `components.connection-footer`: a quiet sidebar footer — `● connected` (agreed-green LED) normally; `○ reconnecting…` (inline) when the host is unreachable. Mono `identifier`, `--text-dim`. NEVER a modal. Prop-driven from the connection state.
  - [x] Wire the connection state from the SSE/host channel (the `openEventStream` connection status — connected / erroring/reconnecting). The web `EventSource` exposes open/error; map to connected/reconnecting. Keep it inline + calm.

- [x] **Task 3 — Voice / microcopy sweep (AC2)**
  - [x] Sweep the UI strings to the terse, lowercase-leaning, calm voice: `needs you (n)`, `@operator (you)`, `you joined · type to post…`, `connected`, `reconnecting…`, `no projects yet`, `＋ join a project…`, `join room to post`, `post failed — retry`. Lowercase room ids + handles in the chrome. Align the existing components' copy (NavTree, Composer, ConnectionFooter, failure affordances) to this voice. (EXPERIENCE.md flags the exact strings beyond the mock-confirmed set as `[ASSUMPTION]` — use the established voice; do not invent loud/celebratory copy.)
  - [x] A small content-guard test pinning the load-bearing microcopy strings (so a future loud rewrite — `⚠ 1 ROOM NEEDS ATTENTION!` / `Welcome back, Operator! 👋` — is caught). Keep it scoped to the agreed terse strings.

- [x] **Task 4 — Accessibility floor (AC3)**
  - [x] **Tree:** nav `role="tree"`/`treeitem`/`group` with `aria-expanded` on collapsible project sections; arrow-key traversal + Enter-to-open (the EXPERIENCE `[ASSUMPTION]`); the NavTree (9.4) markup was structured for this — add the roles + keyboard handlers now.
  - [x] **Thread:** a `role="list"` of posts (`role="listitem"`), each announcing `@handle` + timestamp + agreed state to a screen reader (aria-label / visually-structured); a polite `aria-live` region that COALESCES new posts/👍 (does not spam — updates are frequent; batch/debounce the announcement).
  - [x] **Composer:** keyboard-reachable (Tab into the field; Enter/Cmd-Enter to send per a sensible convention; Esc returns focus to the thread/tree); the join button keyboard-activatable.
  - [x] **Focus + motion:** focus is VISIBLE at AA (a visible focus ring using `--accent`/focus token, ≥3:1 against its ground); `prefers-reduced-motion` respected (no essential motion; any transition gated behind the media query).
  - [x] Landmark regions: sidebar / room / composer as nav/main/form landmarks (or aria-labelled regions).

- [x] **Task 5 — Tests (AC1, AC2, AC3)**
  - [x] Calm-states DOM tests: empty board → `no projects yet` + the single next action, NO full-app spinner; disconnected → inline `reconnecting…` footer + already-loaded content still in the DOM (no modal/overlay blocking it); quiet room → no warning/nag decoration.
  - [x] ConnectionFooter tests: connected LED (agreed-green) vs reconnecting (inline); never renders a modal/dialog role.
  - [x] Voice content-guard: the terse strings are present; a loud variant is absent (mutation-test: swap a string to a loud variant → guard RED → restore).
  - [x] a11y tests (happy-dom): tree has `role="tree"` + `aria-expanded`; thread is a `role="list"` of `listitem`s announcing handle/timestamp/agreed; an `aria-live` region exists + coalesces (a burst of deltas does not emit N separate blocking announcements); composer is keyboard-reachable; focus-visible style present; `prefers-reduced-motion` honored. (Use role/attribute queries; an automated axe-style check is a bonus if a lib is available — otherwise assert the specific roles/attributes.)
  - [x] Discoverable by default `pnpm test` (Rule 8); DOM in happy-dom; no `.only`/`.skip`/`.todo`.

- [x] **Task 6 — Gate**
  - [x] Honest gate: lint 0 / build (all + apps/web) / typecheck 0 / `pnpm test` (green, count up) / format --check. Record counts. **This is the Epic 9 capstone — confirm the FULL suite is green end-to-end.**

## Dev Notes

### What this story is

- The calm-posture + a11y capstone for the web Operator UI: empty/cold/disconnected states (no modal, no blocking spinner, content stays readable), the connection-footer LED (`● connected` / `○ reconnecting…`), the terse lowercase-leaning voice sweep + a microcopy content-guard, and the keyboard/screen-reader floor (tree nav roles + aria-expanded, thread as an announced list with a coalescing live region, keyboard-reachable composer, AA-visible focus, reduced-motion). It hardens the whole surface built across 9.1–9.9 into the calm, pull-only, usable tool the brand demands.
- **IS NOT:** the VS Code surface's native a11y (TreeView/host-rendered — Epic 10; the web a11y here is web-specific, but keep components prop-driven). New board behavior (none — this is presentation/chrome/a11y over the existing data + the existing SSE connection state).

### Calm posture is the brand (do not dramatize)

- "A quiet room is healthy — the palette must never dramatize idleness" (DESIGN). "Surface disconnection as a quiet inline 'reconnecting…' — never spam modal alerts / interrupt the operator — the world is pull-only" (DESIGN Do/Don't). Disconnection + empty + idle are CALM states, never alarms. NO modal anywhere in the app (the elevation language has no modal scrim — DESIGN §Elevation).
- The connection footer maps to DESIGN `components.connection-footer`: `● connected · led {agreed-green}`, `○ reconnecting… (inline, no modal)`, mono, `--text-dim`.

### Source facts to VERIFY (Rule 4)

- `openEventStream` (apps/web api-client) wraps a web `EventSource` — it exposes `onopen`/`onerror`; map those to the connected/reconnecting footer state (EventSource auto-reconnects; `readyState` CONNECTING=0/OPEN=1/CLOSED=2). The 9.9 live fold resumes on reconnect (per-connection lastSentSeq, 9.3). VERIFY the connection-status surface.
- NavTree (9.4) + MessageThread (9.5) + Composer (9.7) exist and were structured for a11y enrichment ("structure the markup so roles can be added" — 9.4/9.5 Dev Notes). Add the roles/handlers here.
- DESIGN tokens (9.1): `connection-footer`, `--agreed-green` (LED), focus token (`--accent` / the focus ring), `--text-dim`. Contrast: the 9.1 contrast utility (`contrastRatio`) can verify the focus ring ≥3:1 (large/UI floor).
- EXPERIENCE.md microcopy table (the terse vs loud examples) + the `[ASSUMPTION]` keyboard/live-region notes are the spec for AC2/AC3.

### Research-First (Rule 3)

- ARIA tree pattern (WAI-ARIA `role="tree"`/`treeitem`/`group` + `aria-expanded` + arrow-key roving tabindex) — implement the established pattern; verify against the WAI-ARIA APG. `aria-live="polite"` coalescing — confirm the debounce/batch approach announces a summary, not N messages.
- `prefers-reduced-motion` media query usage; focus-visible (`:focus-visible`) for the AA focus ring.

### Smoke (lead-side gate — informational)

Browser smoke: build apps/web, drive real Chrome: (a) EMPTY board (seed nothing / a fresh DB) → `no projects yet` + the single next action, no full-app spinner; (b) DISCONNECTED → stop the host while the UI is open → the footer shows `○ reconnecting…` inline, NO modal, the already-loaded tree/thread stays readable; restart the host → footer returns to `● connected` and live fold resumes; (c) a11y spot-check via the DOM: the tree exposes `role="tree"`/`aria-expanded`, the thread is a `role="list"` of announced posts, an `aria-live` region exists, the composer is keyboard-reachable (Tab/Enter), focus ring visible; (d) voice: the chrome reads terse + lowercase (`connected`, `needs you (n)`, `@operator (you)`). Reduced-motion honored.

### References

- [Source: epics.md#Epic 9 / Story 9.10] — ACs.
- [Source: DESIGN.md — components.connection-footer; §Elevation (no modal); Do/Don't (quiet=healthy, inline reconnecting, light/dark first-class).]
- [Source: EXPERIENCE.md — States (empty/cold/disconnected/quiet-idle = healthy); microcopy table (terse vs loud); Accessibility floor (keyboard-first, semantic structure for SR, live region coalesces, focus visible, reduced-motion).]
- [Source: apps/web/src/api-client.ts (openEventStream connection status), App.tsx; NavTree (9.4), MessageThread (9.5), Composer (9.7).]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story).

### Debug Log References

- Honest gate (Epic 9 capstone — FULL suite end-to-end): `pnpm lint` → 0 errors; `pnpm typecheck` → 0 errors; `pnpm build` (all packages incl. apps/web) → green; `pnpm test` → **135 files / 1089 tests passed, 0 failed** (up from the pre-9.10 baseline); `pnpm format` → "All matched files use Prettier code style!". No `.only`/`.skip`/`.todo`.
- Net-new tests this story (+36 from the 9.9 baseline): ConnectionFooter (4), MicrocopyGuard voice content-guard (8), A11yFloor (11), focus-and-motion node guard (7), App.test calm-states+footer (3), plus the App-test tab suite stayed green (33).
- Mutation-tests (Rule 7), each reverted byte-identically + re-greened:
  - Voice guard: swapped `connected` → `✓ You are securely connected to the server.` in ConnectionFooter → MicrocopyGuard RED (caught `securely connected`) → restored.
  - Live-region coalesce: made the thread announce immediately per-delta (no debounce) → A11yFloor "COALESCES" test RED (announced before the debounce window + the raw count `4 new posts`) → restored.

### Completion Notes List

- **ConnectionFooter (Task 2):** new `packages/ui-shared/src/chrome/ConnectionFooter.tsx` — `● connected` (`--agreed-green` LED) / `○ reconnecting…` (`--text-dim`, inline). Prop-driven (NFR2). Wired from a new `EventStreamOptions.onStatus` on `openEventStream` mapping the web `EventSource` `open`→connected / `error`→reconnecting (Rule 4 — VERIFIED `openEventStream` wraps a real `EventSource` in api-client.ts before extending it; the browser auto-reconnects, and the 9.9 fold resumes idempotently by seq). App holds `connectionStatus` state, renders the footer at the bottom of a new sidebar COLUMN that wraps the NavTree.
- **Calm states (Task 1):** empty board → NavTree renders `no projects yet` + the always-present `＋ join a project…` single next action (no full-app spinner). Cold open → the sidebar column shows a calm `loading…` skeleton (NOT a blocking overlay), tree replaces it on load. Disconnected → only the inline footer changes; already-loaded tree/thread stay in the DOM, no modal anywhere. Quiet/idle room → unchanged healthy rendering (no warning/nag/stalled — re-affirmed by a test).
- **Voice sweep (Task 3):** lowercased the NEEDS YOU label (`needs you (n)`), the App placeholders (`select a room from the sidebar`, `opening room…`), and the error copy (`couldn’t load the board — …` / `couldn’t open the room — …`). Components already carried terse copy (`[ join room to post ]`, `✓ you joined`, `type to post…`, `post failed — retry`). Content-guard (`MicrocopyGuard.test.tsx`) renders each copy-bearing component and asserts terse-present + no loud marker (`!`, emoji, `ATTENTION`, `Welcome back`, …). Rule 10 corollary applied: the decorative aria-hidden `!` flag glyph is NOT copy, so the needs-you scan is scoped to the LABEL (no scan-weakening).
- **A11y floor (Task 4):** NavTree is now a single `role="tree"` with `treeitem` projects (+ live `aria-expanded`), `role="group"` room lists, ROVING TABINDEX (one tabindex=0), and APG arrow-key traversal (Up/Down/Home/End move; Right expand-then-descend; Left collapse-then-ascend; Enter/Space activate) — verified against the WAI-ARIA APG (Research-First/Rule 3). The NEEDS YOU block is a `role="list"` (a flat escalation list, not a 2nd tree). MessageThread is `role="list"` of `role="listitem"` posts (each announcing `@handle`/timestamp/agreed via `aria-label`) + a POLITE, `aria-atomic`, COALESCING `.sr-only` live region (debounced summary "n new posts" — replace-not-append, one announcement per burst). Composer field is keyboard-reachable + Esc fires `onEscape`. Landmarks: App `<main aria-label="room">`, the sidebar column, RoomView `aria-label`, Composer form `aria-label`. New `chrome.css` ships the `:focus-visible` ring (`--accent`, verified ≥3:1 vs all surfaces in both themes by `focus-and-motion.test.ts`, WCAG 2.1 SC 1.4.11), the `prefers-reduced-motion: reduce` gate, and the `.sr-only` helper.
- **Bubbling fix (surfaced + fixed during dev):** the project `<li>` (a treeitem WRAPPING its room group) caught bubbled click/keydown from child room rows → collapsed the project on room-select, breaking the Story 9.8 tab tests. Guarded both handlers to act only when the event's nearest `[data-tree-id]` IS the project header. All 9.8 tab tests green again.
- **NFR2 preserved:** every new/changed ui-shared component is presentation-only, prop-driven, PascalCase, one-per-file, no default export, no core/data-access import. New `chrome.css` added to the `exports` map + the eslint asset-subpath allowlist.
- One pre-existing App test assertion was updated to the swept voice (`room-error` now reads `couldn’t open the room` — Story 9.10 voice change, AC2), consistent with Rule 8 (reconcile the later story's voice with the earlier test rather than silently diverge).

### File List

- `packages/ui-shared/src/chrome/ConnectionFooter.tsx` (new)
- `packages/ui-shared/src/chrome/chrome.css` (new)
- `packages/ui-shared/src/chrome/ConnectionFooter.test.tsx` (new)
- `packages/ui-shared/src/chrome/MicrocopyGuard.test.tsx` (new)
- `packages/ui-shared/src/chrome/A11yFloor.test.tsx` (new)
- `packages/ui-shared/src/chrome/focus-and-motion.test.ts` (new)
- `packages/ui-shared/src/index.ts` (export ConnectionFooter + ConnectionStatus)
- `packages/ui-shared/package.json` (exports/files: `./chrome.css`)
- `packages/ui-shared/src/tree/NavTree.tsx` (tree roles + roving tabindex + APG keyboard + aria-expanded + empty-board calm state + lowercase needs-you label; fills column)
- `packages/ui-shared/src/tree/SidebarTreeItem.tsx` (roving tabindex / treeId / onKeyDown / ariaLabel props)
- `packages/ui-shared/src/room/MessageThread.tsx` (role=list + coalescing polite aria-live region)
- `packages/ui-shared/src/room/MessagePost.tsx` (role=listitem + announced aria-label)
- `packages/ui-shared/src/room/RoomView.tsx` (room landmark aria-label)
- `packages/ui-shared/src/room/Composer.tsx` (form/field aria-label + Esc→onEscape, keyboard reach)
- `apps/web/src/api-client.ts` (openEventStream EventStreamOptions.onStatus → ConnectionStatus)
- `apps/web/src/App.tsx` (connectionStatus state + ConnectionFooter + sidebar column + cold-open skeleton + calm voice)
- `apps/web/src/main.tsx` (import chrome.css)
- `apps/web/src/App.test.tsx` (FakeEventSource open/error; calm-states+footer suite; one voice-aligned assertion)
- `eslint.config.js` (allowlist `@agentbbs/ui-shared/chrome.css` subpath)

### Change Log

- 2026-06-01 — Story 9.10 (Epic 9 capstone): calm empty/cold/disconnected states + quiet=healthy; the prop-driven ConnectionFooter LED (`● connected` / `○ reconnecting…`, never a modal) wired from the SSE transport; the terse lowercase voice sweep + a mutation-tested microcopy content-guard; and the keyboard/screen-reader a11y floor (APG tree roles + roving tabindex + arrow keys + aria-expanded; thread role=list of announced listitems + a coalescing polite aria-live region; keyboard-reachable composer with Esc-returns-focus; AA-visible `:focus-visible` ring ≥3:1; prefers-reduced-motion; landmarks). Full suite 1089 green; lint/typecheck 0; build (all + apps/web) green; format clean.

## Review Findings

**Code review — 2026-06-01 (Epic 9 capstone). APPROVED: 0 HIGH / 0 MED / 2 LOW (deferred). Status review → done.**

All three ACs met with real-runtime evidence (Rule 3). Honest gate re-run GREEN end-to-end: lint 0 · typecheck 0 · build (all 7 + apps/web) green · full `pnpm test` **1094 passed** (135 files, 0 failed/0 skipped, no `.only`/`.skip`/`.todo`) · format --check clean. The Epic 9 suite is green 1.1→1.10 end-to-end.

Adversarial verification highlights:
- **NO MODAL ANYWHERE (calm-posture invariant):** the app-level structural sweep (`assertNoModalAnywhere` across empty/cold/disconnected/post-failure) was **reviewer-mutation-verified non-vacuous** — a planted `<div role="dialog">` in `App.tsx` turned all 4 sweep tests RED; reverted byte-identical (`git diff --stat App.tsx` unchanged 79+/19-, grep MUTATION=0; re-GREEN). The role-based checks (`dialog`/`alertdialog`/`aria-modal`/`alert`/`<dialog>`) are the load-bearing, proven assertions.
- **DISCONNECTED:** `EventSource` `open`→connected / `error`→reconnecting mapping VERIFIED against the real api-client wrapper (Rule 4); inline footer only; already-loaded tree/thread stay in the DOM; reconnect → connected and the 9.9 live fold resumes idempotently-by-seq.
- **A11y FLOOR (measured NFR, Rule 5):** APG tree (roving tabindex / `aria-expanded` toggles / arrow keys / Enter), thread announced `role="list"` of `listitem`s, the coalescing polite `aria-live` region (the QA accumulation test — a 3-re-render burst within the rolling window → ONE "3 new posts", not last-delta — is genuinely non-vacuous; it sums `pendingDeltaRef`), keyboard composer + Esc, and the `--accent` `:focus-visible` ring proven ≥3:1 over both surfaces in both themes by the SHIPPED `contrastRatio` math over the SHIPPED tokens.css (7/7), `prefers-reduced-motion` gated. Genuinely met, not commented-around.
- **VOICE content-guard (Rule 10):** terse strings pinned to the rendered components; the aria-hidden decorative `!` flag glyph correctly scoped OUT of the needs-you scan (no scan-weakening). Dev mutation (`connected`→`✓ You are securely connected…` → MicrocopyGuard RED) re-confirmed.
- **REGRESSION:** the project-`<li>` tree-collapse bubbling guard holds — the full 9.8 tab suite + room-select are green in the 1094 run.
- **MODULE BOUNDARY (NFR2):** all new/changed `ui-shared` chrome/a11y components are presentation-only + prop-driven (no `@agentbbs/core`/`data-access`); `chrome.css` is a published asset subpath; no new board behavior; no core/host contract change.

Rules 1, 3, 5, 7, 8, 10 satisfied; Rule 6 N/A (no `docs/adr` — ADR none-required confirmed).

**2 LOW deferred to `deferred-work.md` (story 9.10):**
1. The app-level no-modal sweep's raw-substring (`modal`/`backdrop`/`scrim`/`overlay`) `not.toContain` checks are brittle to a future legitimate token (the role-based checks remain authoritative; substring checks currently correct + non-vacuous).
2. `SidebarTreeItem.tsx` header comment references the focus rule as "in tree.css"; it actually ships in `chrome.css` (cosmetic — the rule exists, is imported/applied, and is contrast-tested).
