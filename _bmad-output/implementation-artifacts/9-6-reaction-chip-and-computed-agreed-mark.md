---
baseline_commit: 83836a75142437a8c2f8320536300e4e5fa82ae7
---

# Story 9.6: Reaction chip and computed agreed mark

Status: done

<!-- Created by the /epic-cycle Lead Creates Story Files gate. Baseline: AGENTBBS-1-epic9 @ 83836a7 (Story 9.5). -->
<!-- First UI WRITE path: react/unreact POST endpoints (the host write seam's first use). -->

## Story

As an operator,
I want per-message 👍 and a visible agreed mark,
so that I can ratify and find the frozen contract at a glance (FR29).

## Acceptance Criteria

**AC1 — 👍 reaction chip (live count + toggle, FR21).**
**Given** a message,
**When** I view its footer,
**Then** a 👍 chip shows a **live count** with **resting vs currently-👍'd** states and **toggles in one click** (latest-currently-👍'd-wins per FR21 — react then a later un-react by the same actor removes the live 👍; the chip reflects the operator's own live state).

**AC2 — Computed agreed mark (FR21, never stored).**
**Given** the room's computed current contract,
**When** the thread renders,
**Then** the converged message shows a `✓ agreed` mark in **head and footer**, **computed live from current 👍 state** (the highest-`seq` message currently holding a live 👍 — `readContract`, **never a stored flag**), and it **moves/disappears correctly as 👍s change** (a higher-`seq` message gaining a live 👍 moves the mark; all live 👍s being retracted removes it).

> **Participation gate on the WRITE (the toggle):** `react`/`unreact` (core) throw `NOT_A_MEMBER` unless the actor is a room participant — toggling a 👍 is a participation action. The READ side (the live count, the currently-👍'd state for a known operator, and the `✓ agreed` mark) is OPEN (FR9 — any reader). So: the chip + agreed mark RENDER for any operator (open read); the TOGGLE works end-to-end when the operator IS a participant (e.g. was `add_participant`'d, or after the Story 9.7 join). For a non-participant operator, the toggle is gated — surface it as disabled / "join to react" handoff to Story 9.7 (the join-gate); do NOT silently swallow a NOT_A_MEMBER. This story builds the chip, the agreed mark, the react/unreact write endpoints, and the participant-operator toggle path; the non-participant join-to-react flow lands with 9.7.

## Tasks / Subtasks

- [x] **Task 1 — react/unreact WRITE endpoints (host write seam's first use)** (AC: #1)
  - [x] Add POST endpoints to the host JSON API write seam (documented in Story 9.3 `json-api.ts`): `POST /api/rooms/:roomId/messages/:seq/react` and `.../unreact` (PATH-ONLY, no body). Each resolves the operator handle (the `--as`/`AGENTBBS_OPERATOR` identity the host already holds) as the `actor`, calls core `react`/`unreact(dataAccess, actor, messageSeq)`, and returns the `ReactResult` (`{ message_seq, reactions }`) on the wire (snake_case). Map `BoardError` → HTTP status: `NOT_A_MEMBER` → 403, `MESSAGE_NOT_FOUND` → 404; a watching-only host (no operator) → 403 `NO_OPERATOR` (a HOST-surface code, NOT a core `BoardError` — preserves core's closed error set).
  - [x] This is the FIRST write endpoint. The write-dispatch was established cleanly: the `Route.method` widened to `'GET' | 'POST'`, dispatch is method-scoped (a GET on a write route → 404), no request-body parsing needed (path-only). Read routes unchanged. The write pattern is documented in the `json-api.ts` header for 9.7's join/reply/add_participant.
  - [x] Tests over a real `createDataAccess` ledger (Rule 3): a participant operator react → live count up + operator in reactions; unreact → removed; a NON-participant operator react → 403 NOT_A_MEMBER (nothing appended — `maxSeq` unchanged); a watching-only host → 403 NO_OPERATOR (nothing appended); unknown message → 404; malformed seq → 400.

- [x] **Task 2 — `ReactionChip` + `AgreedMark` components (ui-shared)** (AC: #1, #2)
  - [x] Authored `src/room/ReactionChip.tsx` per DESIGN `components.thumbs-up`: pill (`--radius-full`), `👍 + count`; **resting** = `--chip-bg` + 1px `--border` + `--text-dim`; **currently-👍'd** = green-tinted bg (`rgba(78,192,122,0.13)`) + `--agreed-line` border + brighter `--text`. Toggles in one click. Prop-driven: `count`, `reacted` (operator's live 👍), `onToggle`, `canReact` (participant) — when `!canReact`, renders the disabled/"join to react" hand-off (seam to 9.7), does NOT fire a doomed write. Green tint gated behind a `highContrast` prop (default `false` = web V1 non-HC; noted — Story 9.10 owns the real HC floor).
  - [x] Authored `src/room/AgreedMark.tsx` per DESIGN `components.agreed-mark`: `✓ agreed` in `--agreed-green`, mono `identifier` font, `placement` = head | footer.
  - [x] Wired into `MessagePost`: the footer carries the `ReactionChip`; the agreed post gets the `AgreedMark` (head + footer) + the agreed-rail (`2px --agreed-green` left border) + agreed-wash (`rgba(78,192,122,0.07)`, gated behind `highContrast`). The agreed message is identified by the `agreed` prop the surface computes from the room contract (Task 3), NOT a stored flag.
  - [x] Exported the new components (`ReactionChip`, `REACTION_CHIP_HAS_BG`, `AgreedMark`, `AGREED_POST_WASH`) from the barrel. Threaded `agreedSeq`/`operatorHandle`/`onToggleReaction`/`canReact`/`highContrast` through `MessageThread` + `RoomView`.

- [x] **Task 3 — Agreed-mark computed live (apps/web)** (AC: #2)
  - [x] `fetchContract` reads `/api/rooms/:id/contract` (the highest-`seq` live-👍'd message, or null); `buildRoomViewModel` sets `agreedSeq = contract.contract.seq` (or null) — COMPUTED, never stored. `RoomView`/`MessageThread` mark the post whose `seq === agreedSeq`.
  - [x] On a 👍 toggle (`handleToggleReaction` in App.tsx): decide react-vs-unreact from the operator's current live state, call `postReact`/`postUnreact`, then RE-LOAD the room view model (`loadRoomViewModel` refetches room + `/api/me` + contract) so the count, the currently-👍'd state, and the agreed-mark POSITION all re-derive. The MOVES/REVERTS/DISAPPEARS behavior is proven end-to-end in the host test + the App toggle test.
  - [x] The operator's own currently-👍'd state per message is computed in `MessageThread` from `post.reactions.includes(operatorHandle)`.

- [x] **Task 4 — Tests** (AC: #1, #2)
  - [x] `ReactionChip`/`AgreedMark` DOM tests (`ReactionChip.test.tsx`): resting vs currently-👍'd visual state (green-tint tokens on 👍'd, chip-bg/border on resting; HC drops the wash); count renders; one-click toggle fires `onToggle`; `!canReact` → disabled/join-handoff (no toggle fired); `✓ agreed` in agreed-green head + footer.
  - [x] `MessagePost` + `RoomView` agreed-mark wiring DOM tests (`RoomView.test.tsx`): the agreed post shows `✓ agreed` head AND footer + the agreed rail; a non-agreed post shows neither; exactly the `agreedSeq` post is marked through the thread; a watching operator's chips are the disabled hand-off.
  - [x] **AC2 load-bearing test (the marquee FR21 semantic — mutation-tested, Rule 7):** TWO layers. (a) END-TO-END over the real ledger (`json-api.test.ts`): react M1 → M1 agreed; react higher-seq M2 → mark MOVES to M2 (even though M1 has MORE reactors — highest-seq live-👍'd wins, NOT most-reactors); retract M2 → REVERTS to M1; retract all → mark GONE (null). (b) the UI mapping (`api-client.test.ts`): `buildRoomViewModel` sets `agreedSeq` to the contract seq, honoring a higher-seq contract over a lower-seq more-reactors message. **Mutation-tested**: pinned the `agreedSeq` derivation to a WRONG "most-reactors" rule → 4 AC2 tests RED (expected 6, got 5) → restored byte-identical (`git diff` on api-client.ts agreedSeq line empty) → green. (The core selection itself was mutation-tested in Story 5.3.)
  - [x] Host react/unreact endpoint tests (real ledger, Rule 3) per Task 1; the full App toggle round-trip (Rule 3 real-runtime DOM — click chip → POST react → refetch → chip flips + ✓ agreed appears).
  - [x] Discoverable by default `pnpm test` (Rule 8); DOM tests in happy-dom; no `.only`/`.skip`/`.todo` (grep: 0).

- [x] **Task 5 — Gate**
  - [x] Honest gate: lint **0**; build (all packages + apps/web) **OK**; typecheck **0**; `pnpm test` **960 passed / 129 files / 0 failed / 0 skipped** (up from 927 at Story 9.5); format --check **clean**. No `.only/.skip/.todo`.

## Review Findings

Code review (bmad-code-review, 2026-06-01, claude-opus-4-8). Diff source: uncommitted Story 9.6 changeset (HEAD @ 83836a7, baseline Story 9.5). Three layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor.

**Outcome: CLEAN — 0 decision-needed, 0 patch, 0 defer, 5 dismissed. No HIGH/MED. Story → done.**

Honest gate re-verified by the reviewer: lint 0, typecheck 0, build OK (all packages + apps/web), `vitest run` 966 passed / 129 files / 0 failed / 0 skipped, prettier --check clean. No `.only/.skip/.todo`.

### Independently confirmed (CRITICAL focus)

- [x] **FR21 agreed mark is COMPUTED, never stored.** `buildRoomViewModel` derives `agreedSeq` from `/api/rooms/:id/contract` (`readContract` → core `currentContract`); no stored "agreed" flag anywhere. The mark is the HIGHEST-`seq` live-👍'd message (NOT most-reactors) — confirmed by reading `contract.ts` (walks high→low, returns first non-empty reactor set).
- [x] **Mutation test non-vacuous at BOTH layers (Rule 7), re-run by the reviewer.** (a) UI mapping: pinned `buildRoomViewModel` `agreedSeq` to a most-reactors rule → 4 AC2 tests RED → restored byte-identical (`git diff` confirms the single `agreedSeq` line is the dev's original). (b) Host real-ledger: pinned core `currentContract` to most-reactors → the MOVES/REVERTS host tests RED (expected m2, got m1 because m1 had 2 reactors) → restored byte-identical via `git checkout`. The host MOVES test genuinely has fewer-reactors-higher-seq (M2, 1 reactor) beating more-reactors-lower-seq (M1, 2 reactors).
- [x] **First write path integrity.** actor = operator handle; method-scoped dispatch (GET on a write route → 404, tested both react + unreact); NOT_A_MEMBER → 403 with `maxSeq` unchanged (tested react AND unreact symmetrically — QA-added); MESSAGE_NOT_FOUND → 404; malformed seq → 400. Participation gate genuinely blocks a non-participant (no silent swallow).
- [x] **Error contract (Rule 10).** `NO_OPERATOR` is a `HostApiError` (host-surface), NOT in core's `BOARD_ERROR_CODES`. The QA drift guard pins NO_OPERATOR out AND the closed set to exactly the ratified 10 codes. core/data-access/mcp-server byte-unchanged (`git diff --stat` empty) — the agent error contract is untouched.
- [x] **Participation-gated-write vs open-read.** Chip READ (count + agreed mark) renders for any operator; the TOGGLE is gated to a peer (`canReact = posture.kind === 'peer'`); a non-participant sees the disabled "join to react" hand-off and fires no doomed write.
- [x] **Module boundary (NFR2).** ui-shared `ReactionChip`/`AgreedMark` prop-driven, no core/data-access import; apps/web speaks only the JSON API; core react/unreact + contract semantics UNTOUCHED (consumed, not modified).

### Dismissed (noise / scoped-out-by-design)

- [x] [Review][Dismiss] `requireSeq` accepts loose numeric forms (`0x5`, `5e2`, `+5`, whitespace) via `Number()` coercion `[json-api.ts:175]` — each still resolves to a positive integer that hits a real message or returns MESSAGE_NOT_FOUND; no injection/overflow (clamped lookup); the UI builds `${seq}` from a real number so the forms are unreachable. `requireSlug` is the real shape guard; empty string → 0 → correctly rejected. Cosmetic only.
- [x] [Review][Dismiss] roomId in the react/unreact path is validated but ignored — core resolves the message by `seq` alone `[json-api.ts:341]` — core gates on the MESSAGE's room participation, so the advisory path roomId cannot enable a cross-room write escalation. Documented as intentional ("the room in the path is the addressing context").
- [x] [Review][Dismiss] `postJson` discards the `{code}` body on a non-2xx, so App cannot distinguish NOT_A_MEMBER from NO_OPERATOR `[api-client.ts:462]` — rich error voice is explicitly Story 9.10; the `canReact` gate prevents the common doomed write and the catch handles the race. Scoped out by the story.
- [x] [Review][Dismiss] Double-click / stale-closure on a rapid toggle — core `react`/`unreact` is idempotent (re-react when live = no-op); the room-switch guard (`prev.roomId === roomId`) handles a fast switch; optimistic echo + reconciliation is explicitly Story 9.9.
- [x] [Review][Dismiss] AC1/AC2/FR21 acceptance coverage — all ACs met and mutation-verified non-vacuous at both layers (above). No gap.

## Dev Notes

### What this story is (and is NOT)

- **IS:** the per-message 👍 `ReactionChip` (live count + resting/👍'd + one-click toggle), the computed `✓ agreed` mark (head + footer, live from `readContract`, never stored, moves/disappears with 👍s), the react/unreact WRITE endpoints (the host write seam's first use), and the participant-operator toggle path.
- **IS NOT:** the join-gate composer + the non-participant join-to-react/join-to-post flow (Story 9.7 — here a non-participant sees a disabled/"join" chip handoff), the full optimistic echo + reconciliation + failure-retry (Story 9.9 — a basic refetch/fold after the write is fine for 9.6), tabs (9.8), a11y (9.10).

### FR21 — the agreed mark is COMPUTED, never stored (the marquee semantic)

- The current contract = the **highest-`seq` message that currently holds a live 👍** (react minus a later un-react by the same actor). It is a pure query (`readContract`/`currentContract`, Story 5.3), re-derived every time — reversion on retraction needs NO special logic. The UI MUST NOT store an "agreed" flag; it reads `/api/rooms/:id/contract` and marks the message whose `seq` matches. This is the AC2 mutation-test target (it mirrors the Story 5.3 core test that pinned "highest-seq live-👍'd, NOT most-reactors").
- "latest-currently-👍'd-wins" (AC1/FR21): the chip reflects the operator's CURRENT live 👍 (their latest react not since un-reacted). Toggling = react if not currently-👍'd, unreact if currently-👍'd.

### Source facts to VERIFY (Rule 4)

- core `react`/`unreact(dataAccess, actor, messageSeq): Promise<ReactResult{ messageSeq, reactions[] }>` — gate `NOT_A_MEMBER` (actor must be a participant; react does NOT grant participation, unlike reply), `MESSAGE_NOT_FOUND`. `readContract(dataAccess, roomId): Promise<RoomMessage | null>`. VERIFIED in `packages/core/src/rooms/react.ts` + `read-contract.ts`.
- The room message wire carries `reactions` (the live reactor handles) already (`MessageWire.reactions`); the chip's count = `reactions.length`, the operator's-👍'd = operator ∈ reactions. `/api/rooms/:id/contract` exists (returns `{ room_id, contract }`). VERIFIED.
- The host write seam is documented but EMPTY (`json-api.ts` notes "WRITE endpoints … a write route slots in as `{ method:'POST', pattern, handler }` … Do NOT add writes now"). 9.6 is when writes START. The host already resolves the operator handle (Story 9.4 `/api/me`/`--as`).
- DESIGN tokens (9.1): `thumbs-up` (chip-bg, agreed-line, radius-full, the `rgba(78,192,122,0.13)` has-bg), `agreed-mark` (--agreed-green), `message-post` agreed-rail (`2px --agreed-green`) + agreed-wash (`rgba(78,192,122,0.07)`).
- `MessagePost` (Story 9.5) left footer/rail room for the chip + agreed mark — wire them in.

### Research-First (Rule 3)

- POST body parsing in `node:http` (if the endpoints carry a body) — confirm the host's existing request handling; the react endpoints may be path-only (seq in the path) needing no body. Prefer path-only to keep it simple.

### Smoke (lead-side gate — informational)

Browser smoke: build apps/web, run `agentbbs ui --as <operator>` against a seeded ledger where the operator IS a participant of a room with ≥2 messages, drive real Chrome: 👍 a message → count increments + chip shows currently-👍'd + `✓ agreed` appears on it (head+footer); 👍 a higher-`seq` message → the `✓ agreed` mark MOVES to it; retract → it reverts; retract all → mark gone. Confirm the agreed mark tracks the highest-`seq` live-👍'd message (FR21), computed not stored. (Optionally confirm a non-participant operator's chip is disabled/join-handoff.)

### References

- [Source: epics.md#Epic 9 / Story 9.6] — ACs.
- [Source: DESIGN.md — components.thumbs-up / agreed-mark / message-post (agreed-rail/wash).]
- [Source: packages/core/src/rooms/react.ts, read-contract.ts (FR21 contract); packages/cli/src/host/json-api.ts (write seam).]
- [Source: 5-3-…md (the core FR21 contract semantic the UI must honor — highest-seq live-👍'd, never stored).]
- [Source: 9-5-…md MessagePost (footer/rail seam), apps/web api-client (Story 9.4/9.5 client).]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad dev-story workflow under /epic-cycle).

### Debug Log References

- **`reply` returns the ROOM, not a message** (test-fixture bug caught during the AC2 host test). The `reply` core op resolves to a `Room` whose `seq` is the room/activation seq, NOT the reply's message seq. My first AC2 fixture used `reply().seq` as the message seq, so M1 and M2 both got the same seq (5) and the REVERTS assertion failed (`null` instead of m1). Fixed by reading the actual per-message reply seqs from `/api/rooms/:id` (filter `kind === 'reply'`, sort ascending). No production-code defect — pure test-fixture error, surfaced by a probe test (deleted) that dumped seqs to a file.
- **happy-dom CSS readback quirks**: (1) `var()` is dropped from the `border` SHORTHAND on readback → switched `ReactionChip` to `borderWidth`/`borderStyle`/`borderColor` longhands so the design-token var survives; (2) `rgba()` spacing is normalized (`rgba(78, 192, 122, 0.13)`) → tests strip whitespace before the substring match.
- **oxc parse error on `👍'd`**: an apostrophe inside a single-quoted `describe`/`it` string is a parse error under the Vite oxc transform; reworded the affected test labels to "reacted"/"live-reacted" (comments with `👍'd` are fine).

### Completion Notes List

- **First UI WRITE path established.** `json-api.ts` now serves `POST /api/rooms/:roomId/messages/:seq/react` + `/unreact` (PATH-ONLY, no body). `Route.method` widened to `'GET' | 'POST'`; dispatch is method-scoped; read routes byte-unchanged. The write pattern is documented in the file header for 9.7.
- **`NO_OPERATOR` is a HOST-surface error, NOT a core `BoardError`.** A watching-only host (no operator) cannot write; rather than add a code to core's closed `BOARD_ERROR_CODES` (a versioned public contract) for a host-only condition, I added a `HostApiError` class (status + code) caught alongside `BoardError` in `handleApiRequest`. Core's closed error set is unchanged. A KNOWN non-participant operator still gets core's `NOT_A_MEMBER` (403), surfaced (not swallowed) so the chip's "join to react" hand-off (Story 9.7) is honest.
- **FR21 agreed mark is COMPUTED, never stored.** The UI marks the post whose `seq === agreedSeq`, where `agreedSeq` is derived in `buildRoomViewModel` from `/api/rooms/:id/contract` (the highest-`seq` live-👍'd message). On every 👍 toggle the shell re-loads room + contract, so the mark MOVES/REVERTS/DISAPPEARS with no special logic. Mutation-tested non-vacuous (Rule 7) — a "most-reactors" derivation turned 4 AC2 tests RED, then restored byte-identical.
- **Participation gate honored on the WRITE, OPEN on the READ.** The chip RENDERS (count + agreed mark) for any operator; the TOGGLE works only for a peer (`canReact = posture.kind === 'peer'`). A watching operator sees the disabled "join to react" chip — no doomed write fired.
- **NFR2 clean**: ui-shared components are prop-driven, no core/data-access import; apps/web speaks only the JSON API (no core/cli/data-access dep added). PascalCase.tsx, one component per file, no default exports.
- **Rule 5 (NFR tripwire)**: none triggered — no NFR was found unimplementable. **Rule 6 (ADR)**: N/A — `docs/adr/` has no ADRs, story declares ADR none-required. **Rule 3 (external API)**: `node:http` POST handling confirmed — the existing `server.ts` already passes the method through to `handleApiRequest`; path-only writes needed no body parsing.

### File List

**Modified:**
- `packages/cli/src/host/json-api.ts` — react/unreact POST routes; `HostApiError`; `requireSeq`/`requireOperator`; `Route.method` → `'GET'|'POST'`; header doc for the write seam.
- `packages/cli/src/host/json-api.test.ts` — write-endpoint tests + the AC2 MOVES/REVERTS/DISAPPEARS real-ledger tests.
- `packages/ui-shared/src/room/MessagePost.tsx` — footer `ReactionChip` + agreed `AgreedMark` (head+footer) + agreed rail/wash; new props (`agreed`, `operatorReacted`, `canReact`, `onToggleReaction`, `highContrast`); `AGREED_POST_WASH`.
- `packages/ui-shared/src/room/MessageThread.tsx` — threads `agreedSeq`/`operatorHandle`/`canReact`/`onToggleReaction`/`highContrast` to each post.
- `packages/ui-shared/src/room/RoomView.tsx` — `agreedSeq`/`operatorHandle` on the model; `onToggleReaction`/`highContrast` props; `canReact` derived from posture.
- `packages/ui-shared/src/room/RoomView.test.tsx` — MessagePost + RoomView agreed-mark/chip wiring DOM tests.
- `packages/ui-shared/src/index.ts` — barrel exports for the new components.
- `apps/web/src/api-client.ts` — `ContractResponse`/`ReactResponse` types; `fetchContract`/`postReact`/`postUnreact`; `buildRoomViewModel`/`loadRoomViewModel` carry `agreedSeq`+`operatorHandle`.
- `apps/web/src/api-client.test.ts` — `buildRoomViewModel` agreedSeq derivation + AC2 mutation-test target.
- `apps/web/src/App.tsx` — `handleToggleReaction` (write → refetch); wired to `RoomView`.
- `apps/web/src/App.test.tsx` — full toggle round-trip DOM test + contract response fixture.

**Added:**
- `packages/ui-shared/src/room/ReactionChip.tsx`
- `packages/ui-shared/src/room/AgreedMark.tsx`
- `packages/ui-shared/src/room/ReactionChip.test.tsx`

### Change Log

- 2026-06-01 — Story 9.6 implemented: react/unreact WRITE endpoints (the host write seam's first use), the `ReactionChip` (live count + resting/👍'd + one-click toggle, FR21), the computed `✓ agreed` mark (head+footer, live from `/api/rooms/:id/contract`, never stored), and the participant-operator toggle path. AC2 marquee semantic mutation-tested non-vacuous (Rule 7). Honest gate green (lint 0 / build OK / typecheck 0 / 960 tests / format clean). Left UNCOMMITTED for the lead's post-CR smoke gate.
