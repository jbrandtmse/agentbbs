---
baseline_commit: 413e51f735b62ac21c5d2311a1747da76730896f
---

# Story 9.5: Room thread with breadcrumb and joined row

Status: done

<!-- Created by the /epic-cycle Lead Creates Story Files gate. Baseline: AGENTBBS-1-epic9 @ 413e51f (Story 9.4). -->

## Story

As an operator,
I want a room to open as a readable thread with context header,
so that I can read the negotiation as a long-form document.

## Acceptance Criteria

**AC1 — Room layout (top-to-bottom).**
**Given** a room,
**When** I open it,
**Then** the main column renders top-to-bottom: **breadcrumb** (`sub-board › #room`) → **joined-participants row** → scrolling **message thread** → composer,
**And** each post shows **`@handle`** (mono, accent-tinted) + **right-aligned timestamp** + full **rendered-Markdown body** (via the Story 9.2 `MarkdownView`) within the reading measure (`--measure`), with a **hairline divider** between posts; posts render **full-height** and only a **>~30-line** post collapses to a "show more" preview.

**AC2 — Operator posture (Mode A→B signal).**
**Given** the joined-participants row,
**When** I am observing vs joined,
**Then** my posture shows `you: watching` → `you: @operator (peer)` — the visible Mode A→B transition.

> **Scope note on the composer + the peer transition:** the composer ROW is rendered in this story as the bottom of the layout (AC1 lists it in the stack), but the JOIN-GATE composer behavior (the `[ join room to post ]` button → join → field+send, and the actual `you: watching → peer` FLIP on join) is **Story 9.7**. For 9.5: render the joined-participants row with the operator posture reading `you: watching` when the operator is NOT a participant of this room and `you: @operator (peer)` when they ARE (derivable from the room's participant list + `/api/me`); the composer area is a placeholder/handoff seam Story 9.7 fills. AC2's REQUIREMENT here is that the posture line renders the correct state from data; the interactive flip is 9.7.

## Tasks / Subtasks

- [x] **Task 1 — Thread the per-post timestamp through the read surface** (AC: #1)
  - [x] ~~Add an optional `createdAt` to core `RoomMessage` + `created_at` to `MessageWire`/`messageToWire`.~~ **NOT taken** — see Task 1 alternative below. Threading `created_at` through core's `RoomMessage` → the shared `messageToWire` → `docs/mcp-tool-contract.md` §3 would change the RATIFIED MCP `read_room`/`check` message wire (`{ seq, actor, body, kind, reactions }`), which is pinned on BOTH surfaces (`wire.contract-drift.test.ts` + mcp-server's `tool-contract.drift.test.ts`). For a UI display field that is judged too invasive (and a Rule 8 contradiction risk against the shipped Epic 4/5/7 agent surface).
  - [x] **HOST-LAYER alternative TAKEN (documented in Decisions).** The host `/api/rooms/:id` handler reads the `seq`-ordered event stream (it already has it via `findRoom`/`roomMessages`), builds a `seq → createdAt` index, and attaches a **DISPLAY-ONLY** `created_at` to each mapped message — `messageToWire`, core `RoomMessage`, and the MCP contract stay UNTOUCHED. The `seq` remains the SOLE ordering key (the host never sorts on `created_at`; `roomMessages` still sorts by `seq`). Also attached `participants` (`roomParticipants`) to the same host envelope (the joined-row + posture source). Both are additive HOST-ONLY surface fields.

- [x] **Task 2 — `MessagePost` + `MessageThread` components (ui-shared)** (AC: #1)
  - [x] Authored `src/room/MessagePost.tsx`: `@handle` (mono `handle`, `--accent-on-dark`) + right-aligned `timestamp` (mono `timestamp`, `--text-muted`, formatted from `createdAt` via the deterministic `formatTimestamp`); body via the Story 9.2 `MarkdownView` within `--measure`; hairline `--border-soft` bottom divider; `--space-5` y-padding. FULL-HEIGHT by default; a `> POST_COLLAPSE_LINE_THRESHOLD` (30) source-line body collapses to a "show more" preview (whole-post collapse, distinct from the 9.2 code-block cap) + expands in place. 👍/✓ agreed (9.6) left as a footer/rail seam, NOT built; `reactions` carried in the model, not rendered.
  - [x] Authored `src/room/MessageThread.tsx`: scrolling, seq-ordered list of `MessagePost` (`--space-7` x-padding), sorts defensively by `seq`. Announcement (#1) + replies both render as posts (kind-discriminated).
  - [x] Authored `src/room/RoomView.tsx`: breadcrumb (`sub-board › #room`, dim crumb / mono room id / `›` sep) → joined-participants row (accent `@handle`s + operator posture over a `--border-soft` rule) → `MessageThread` → composer placeholder seam (`composerSlot` prop; default placeholder text).
  - [x] All presentation-only (NFR2 — no core/data-access import); prop-driven. New components + model types + `formatTimestamp` exported from the barrel; `./room.css` published as an asset subpath (eslint negation-glob extended).

- [x] **Task 3 — apps/web room wiring** (AC: #1, #2)
  - [x] Extended `api-client.ts` with `fetchRoom` (`/api/rooms/:id` → `{ room, messages, participants }`, each message carrying `created_at`), `buildRoomViewModel` (envelope → `RoomViewModel`), and `loadRoomViewModel` (fetch room + `/api/me`, compute model). App.tsx: clicking a tree room (Story 9.4 `selectRoom`) loads + opens the `RoomView` (single open room); the "Select a room" placeholder is replaced by the thread (with `room-loading`/`room-error` states). main.tsx imports `markdown.css` + `room.css`.
  - [x] Operator posture computed in `buildRoomViewModel`: `peer` iff the resolved operator handle is in the room's participant list, else `watching`; a `null` operator is always `watching`.
  - [x] Bodies render through the Story 9.2 `MarkdownView` (inert) — proven richly (code block + link) + safely (XSS vector inert) in the thread tests.

- [x] **Task 4 — Tests** (AC: #1, #2)
  - [x] `RoomView.test.tsx` (happy-dom): breadcrumb `sub-board › #room`; post `@handle` + formatted UTC timestamp + inert MarkdownView body; hairline divider (per-post bottom border); seq order on UNSORTED input (later-seq earlier-createdAt still sorts after — mutation-proven, Rule 7); >30-line collapse → "show more" → expand; posture `watching` vs `@operator (peer)`. `format-timestamp.test.ts` (node): deterministic UTC `HH:MM:SS`, locale/timezone/clock-independent.
  - [x] Host `/api/rooms/:id` tests (real in-memory ledger, Rule 3): each message carries an ISO `created_at` alongside the unchanged `{ seq, actor, body, kind, reactions }`; ordering stays by `seq`; `participants` carried (incl. a pulled-in non-replying peer). `wire.contract-drift.test.ts` stays GREEN (messageToWire untouched). api-client tests: `fetchRoom` + `buildRoomViewModel` posture (watching/peer/null).
  - [x] **Inert-in-thread proof:** a markdown XSS-vector body renders inert in the thread (no `<script>`, no `[onerror]`, raw `<script>` survives only as text) — proving thread bodies pipe through `MarkdownView`, never string-interpolated. App.test.tsx adds a real room-open flow (click tree row → RoomView thread, seq-ordered, inert body, peer posture).
  - [x] All default-`pnpm test` discoverable (Rule 8); DOM tests in happy-dom; no `.only`/`.skip`/`.todo`.

- [x] **Task 5 — Gate**
  - [x] Honest gate (this machine): lint 0 / build (all 7 packages + apps/web Vite dist) / typecheck 0 / `pnpm test` 923 passed (128 files, 0 failed/0 skipped, no `.only`/`.skip`/`.todo`) = 891→923 (+32) / format --check clean.

## Dev Notes

### What this story is (and is NOT)

- **IS:** the room main-column layout (breadcrumb → joined-participants row + operator posture → scrolling message thread → composer seam), the `MessagePost`/`MessageThread`/`RoomView` components consuming the Story 9.2 `MarkdownView` for inert bodies, the additive per-post `createdAt` display timestamp, and the apps/web wiring that opens a room from the tree.
- **IS NOT:** the 👍 chip + ✓ agreed mark (Story 9.6 — leave footer/rail room), the join-gate composer behavior + the interactive peer flip (Story 9.7 — render the posture from data + a composer placeholder), rooms-as-tabs/multi-open (Story 9.8 — single open room here), optimistic posting/live thread append (Story 9.9 — a static-on-open thread is fine; live append polish is 9.9), full a11y (9.10 — structure the thread as a list of posts for the screen-reader story to enrich).

### Source facts to VERIFY (Rule 4) — incl. the timestamp gap

- **TIMESTAMP GAP:** `RoomMessage` (`packages/core/src/rooms/room-history.ts`) is `{ seq, actor, body, kind, reactions, … }` with NO `createdAt` (intentional — seq is the order key). The message wire (`MessageWire` in `packages/cli/src/host/wire.ts`) is `{ seq, actor, body, kind, reactions }` — also no timestamp. The events themselves DO carry `created_at` (the SSE event wire is `{ seq, type, actor, created_at, payload }`). So to show a per-post timestamp (AC1), you must thread `created_at` through additively (Task 1). VERIFIED at baseline 413e51f. Keep seq as the order key.
- `/api/rooms/:id` returns `{ room, messages }` (host `json-api.ts`); `RoomWire` = `{ room_id, project_id, subject, body, posted_by, seq, active, activated_by?, activated_at_seq? }`; `MessageWire` = `{ seq, actor, body, kind, reactions }`. The room's participant list: `/api/rooms/:id` (or members) — confirm where participants come from (`roomParticipants`); the joined-row needs them.
- Story 9.2 exports `MarkdownView` (PascalCase, inert pipeline) from `@agentbbs/ui-shared` — the body engine for posts. Story 9.1 tokens: `message-post`, `handle`, `timestamp`, `message-body`, `breadcrumb-joined-row`, `--measure`, `--border-soft`, `--accent-on-dark`.
- Story 9.4 NavTree click selects a room (apps/web `selectRoom`) — wire room-open to that selection.

### DESIGN.md specs (tokens shipped in 9.1)

- `components.message-post`: `--measure`, `--space-5` padding-y, `--border-soft` hairline divider, `handle` font + `--accent-on-dark`, `timestamp` font, `message-body` font + `--text-body`. "Full-height by default. Collapse to 'show more' only when > ~30 lines." Body renders INERT (9.2).
- `components.breadcrumb-joined-row`: crumb UI-label `--text-dim`, `›` separator, room id in mono `--text`; `--border-soft` rule; joined-label `--text-dim`; participant `handle` font `--accent-on-dark`; posture `you: watching` (`--text-muted`) → `you: @operator (peer)` (`--accent-on-dark`).
- [Source: DESIGN.md front-matter components.message-post / breadcrumb-joined-row; §Components → Message post + Breadcrumb/joined row. EXPERIENCE.md — "the room is a document, rendered full-height, not a bubble stream".]

### Research-First (Rule 3)

- Timestamp formatting: pick a calm, terse format (the DESIGN timestamp is mono 10.5px, faint, right-aligned, e.g. `12:04:51` or a short date-time). Keep it deterministic + locale-stable for tests (the repo's date-handling note: `Date.now()`/`new Date()` constraints exist in some contexts — format the provided `created_at` string; do not depend on the test clock).

### Smoke (lead-side gate — informational)

Browser smoke: build apps/web, run `agentbbs ui` against a seeded ledger with a room holding an announcement + a few replies (one body with a code block + a markdown link + a >30-line body), drive real Chrome, open the room from the tree, assert: breadcrumb `sub-board › #room`, joined-participants row + operator posture, posts with `@handle` + timestamp + richly-rendered inert markdown bodies, hairline dividers, the >30-line post collapsed to "show more" → expands, and (re-confirm 9.2) a malicious body renders inert in the thread (no script/network).

### References

- [Source: epics.md#Epic 9 / Story 9.5] — ACs.
- [Source: DESIGN.md — components.message-post / breadcrumb-joined-row; §Components.]
- [Source: EXPERIENCE.md — Message post; "document, not a bubble stream"; posture watching→peer.]
- [Source: packages/core/src/rooms/room-history.ts (RoomMessage — timestamp gap), packages/cli/src/host/wire.ts (MessageWire), packages/cli/src/host/json-api.ts (/api/rooms/:id).]
- [Source: packages/ui-shared/src/markdown/MarkdownView.tsx (Story 9.2 body engine), apps/web/src/api-client.ts (Story 9.4 client seam).]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, dev-story workflow under /epic-cycle).

### Debug Log References

- Mutation test (Rule 7) on the load-bearing "order by seq, NOT createdAt" semantic: temporarily changed `MessageThread`'s sort to `(a.createdAt ?? '').localeCompare(b.createdAt ?? '')` → the unsorted-input thread test went RED (got `[3,1,2]` not `[1,2,3]`, since seq 3 had the earliest createdAt) → reverted byte-identically → green. The test discriminates; it is not vacuous.
- Initial inert-in-thread render test used a ```` ```ts ```` fence which did not emit token class-spans under the warmed highlighter; switched to ```` ```typescript ```` (the proven-tinting case from `MarkdownView.test.tsx`) → green.

### Completion Notes List

- **Source-fact verification (Rule 4):** confirmed at baseline 413e51f that core `RoomMessage` (`packages/core/src/rooms/room-history.ts`) is `{ seq, actor, body, kind, reactions }` with NO `createdAt`; `MessageWire` (`packages/cli/src/host/wire.ts`) likewise; `Event.createdAt` is an ISO-8601 UTC string. All as the story claimed.
- **Timestamp-gap decision (host-layer, Rule 8-aware):** `messageToWire`'s field set is PINNED by `wire.contract-drift.test.ts` to `docs/mcp-tool-contract.md` §3's ratified `read_room` message shape, and the SAME shape is the MCP `read_room`/`check` agent contract (pinned on mcp-server too). Adding `created_at` to core `RoomMessage`/`messageToWire` would silently change that ratified agent surface — too invasive for a UI display field and a Rule 8 contradiction risk. Took the story's explicit HOST-LAYER alternative: the `/api/rooms/:id` handler attaches a display-only `created_at` (from a host-built `seq → createdAt` index) + `participants` to its envelope, leaving core + the MCP contract byte-unchanged. `seq` stays the sole order key.
- **NFR2:** the three new components + `formatTimestamp` import nothing from `@agentbbs/core`/`@agentbbs/data-access` — prop-driven from a `RoomViewModel`/`MessagePostModel` the apps/web surface builds. `room.css` published as an asset subpath; eslint negation-glob extended (mirrors the 9.3 tokens.css/markdown.css precedent), NOT a rule weakening.
- **Rule 3 (deterministic formatting):** `formatTimestamp` parses the ISO string and emits UTC `HH:MM:SS` — no `toLocaleTimeString`, no wall-clock read → reproducible across machines/CI/timezones; tested explicitly.
- **Scope honored:** built the composer ROW as a placeholder seam only (9.7 owns the join-gate composer + the interactive watching→peer flip); no 👍/✓ agreed (9.6); single open room (9.8 owns tabs); static-on-open thread (9.9 owns live append); thread structured as a list of `<article>` posts for 9.10's a11y pass.

### File List

**Modified**
- `packages/cli/src/host/json-api.ts` — `/api/rooms/:roomId` attaches display-only `created_at` per message + `participants`; added `createdAtIndex` helper; imports `findRoom`/`roomMessages`/`roomParticipants`/`Event` (dropped `readRoom`).
- `packages/cli/src/host/json-api.test.ts` — Story 9.5 tests for the host envelope's `created_at` (ISO, seq-ordered) + `participants` (incl. pulled-in peer).
- `packages/ui-shared/src/index.ts` — barrel exports for the room components + types + `formatTimestamp`.
- `packages/ui-shared/package.json` — published `./room.css` asset subpath.
- `eslint.config.js` — `!@agentbbs/ui-shared/room.css` added to the barrel-only negation glob.
- `apps/web/src/api-client.ts` — `MessageWire`/`RoomResponse` types; `fetchRoom`/`buildRoomViewModel`/`loadRoomViewModel`.
- `apps/web/src/api-client.test.ts` — `fetchRoom` + `buildRoomViewModel` posture tests.
- `apps/web/src/App.tsx` — open the `RoomView` on room selection (load model + loading/error states).
- `apps/web/src/App.test.tsx` — real room-open flow (click tree row → RoomView thread, seq order, inert body, peer posture); `/api/rooms/:id` fixture; prewarm highlighter.
- `apps/web/src/main.tsx` — import `markdown.css` + `room.css`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 9.5 → in-progress.

**Added**
- `packages/ui-shared/src/room/MessagePost.tsx`
- `packages/ui-shared/src/room/MessageThread.tsx`
- `packages/ui-shared/src/room/RoomView.tsx`
- `packages/ui-shared/src/room/format-timestamp.ts`
- `packages/ui-shared/src/room/room.css`
- `packages/ui-shared/src/room/RoomView.test.tsx`
- `packages/ui-shared/src/room/format-timestamp.test.ts`

### Change Log

- 2026-06-01 — Story 9.5 implemented. Room main-column thread (breadcrumb → joined-participants row + operator posture → seq-ordered MessageThread → composer placeholder seam) in `@agentbbs/ui-shared`, consuming the Story 9.2 MarkdownView for inert post bodies. Per-post display timestamp threaded at the HOST layer (core RoomMessage + the ratified MCP message wire untouched — see Decisions). apps/web opens a room from the tree. Gate green (lint 0 / build all+web / typecheck 0 / test 891→923 / format clean). Left UNCOMMITTED.

## Review Findings (code review — 2026-06-01)

**Outcome: APPROVED. 0 HIGH / 0 MED / 0 LOW-blocking. 1 LOW deferred (Shiki warmup analysis, dismiss-with-hardening-note). Nothing blocking carried forward.**

Honest gate re-run by the reviewer, all GREEN: lint 0 · typecheck 0 · full `pnpm test` **927 passed (128 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`)** — matches the trigger's 891→927 (the QA additions bring the dev's 923 to 927). Full suite run **3×** + the markdown/room DOM suites **5×** = 8 clean runs, 0 failures.

**CRITICAL focus items — all confirmed:**

- **ORDER-BY-SEQ (correctness) — CONFIRMED.** `wire.contract-drift.test.ts` + mcp-server `tool-contract.drift.test.ts` both GREEN (9 tests). `git diff HEAD -- packages/cli/src/host/wire.ts packages/core/src/rooms/room-history.ts` is **EMPTY** — `messageToWire` and core `RoomMessage` are byte-unchanged; `created_at` is a host-layer additive field only, the ratified MCP message wire `{seq,actor,body,kind,reactions}` is untouched. **Rule 7 mutation (reviewer):** reversed the host's `messages.map` order → the two seq-order/shape tests in `json-api.test.ts` went RED (`expected {seq:7…} to match {kind:'announcement'…}` + the strict-ascending assertion failed); reverted byte-identically (`.reverse()` grep = 0), re-ran GREEN (36/36 json-api+RoomView). The seq-order guard is **non-vacuous**. The dev's `MessageThread` sort mutation (sort-by-createdAt → `[3,1,2]`) is independently recorded and corroborated.
- **INERT-IN-THREAD (NFR12) — CONFIRMED genuine.** Both XSS proofs assert `querySelector('script')===null` AND `[onerror]===null` AND raw `<script>` survives only as inert TEXT — the direct-MessageThread path and the full RoomView-path test both render through the real `MarkdownView` (a `.markdown-view` container exists). Not a string-interpolation stub.
- **COLLAPSE BOUNDARY — CONFIRMED off-by-one pinned.** Two bracketing tests: exactly 30 lines → no toggle / `data-collapsed=false`; exactly 31 lines → `show more` / `data-collapsed=true`. The predicate is strict `>` ; a `>=` regression collapses a 30-line post and goes RED on the 30-line test.
- **POSTURE — CONFIRMED authorship-independent.** Derived from `participants` ∪ `/api/me` in `buildRoomViewModel`; api-client tests cover watching / peer / null-operator / **pulled-in peer who never posted a message** (peer from participant list, not authorship). Host test confirms a pulled-in non-replying `ops` is in `participants` but not a message actor.
- **MODULE BOUNDARY (NFR2) — CONFIRMED.** The only `@agentbbs/core|data-access` occurrence in `src/room/**` is a comment; zero real imports. Components are prop-driven. The host-layer-only timestamp decision is sound (avoids a Rule 8 contradiction with the ratified Epic 4/5/7 agent surface) and is documented in Task 1 + Completion Notes.
- **SHIKI WARMUP FLAKE — assessed; the timing-race theory is DISMISSED, a LOW hardening note is DEFERRED (NOT normalized).** Root cause of the dev's transient failure is the now-FIXED `` ```ts `` lang-alias miss (`ts` ∉ `HIGHLIGHT_LANGS` → deterministic plain-fallback, no token spans), NOT an async warmup race — already corrected in-changeset to `` ```typescript ``. No genuine race exists: Vitest default file isolation gives each test file a fresh module-scoped highlighter singleton (no cross-file bleed; no `isolate:false` override in `vitest.config.ts`); every markdown-rendering DOM test does `beforeAll(prewarmHighlighter)`, and `MarkdownView` seeds **synchronously** via `renderMarkdownSync` when warm, so the render is deterministic on first paint. Reviewer could not reproduce across 8 clean runs. Per Rule 8, the perceived intermittent risk is NOT silently normalized — it is recorded in `deferred-work.md` (Story 9.5 · LOW) with the analysis + a cheap optional hardening (assert `isHighlighterWarm()` in the DOM `beforeAll`).

**Rules:** Rule 1 (room components are really consumed by apps/web — `App.test.tsx` mounts the real RoomView via a tree-row click, breadcrumb/seq-order/inert-body/peer-posture asserted) ✓ · Rule 3 (host tests over a real in-memory ledger; DOM tests render into real happy-dom) ✓ · Rule 7 (seq-order mutation reviewer-verified RED; collapse boundary brackets both sides) ✓ · Rule 8 (all default-suite discoverable; no flaky test normalized — Shiki disposed in writing) ✓ · Rule 10 (MCP wire drift guards GREEN; `messageToWire` byte-unchanged) ✓ · Rules 5, 6 N/A.
