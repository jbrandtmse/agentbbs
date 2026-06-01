---
baseline_commit: 27587624fc73786a67c4c97857088a0a7491734a
---

# Story 9.9: Live updates, optimistic posting, and reconciliation

Status: review

<!-- Created by the /epic-cycle Lead Creates Story Files gate. Baseline: AGENTBBS-1-epic9 @ 2758762 (Story 9.8). -->

## Story

As an operator,
I want a kept-open view to update in near-real-time with optimistic posting,
so that the board feels live without breaking the pull-only model.

## Acceptance Criteria

**AC1 — Live SSE fold into the open view (Mode A watch-live).**
**Given** a room/tree I keep open,
**When** new messages and 👍s land,
**Then** the view folds the SSE event delta **immutably** into state and updates in near-real-time (Mode A watch-live); there is **no background push beyond the view I chose to keep open** (the SSE is the operator's own kept-open live view — agents stay pull-only; the host never pushes to agents).

**AC2 — Optimistic post + reconciliation + inline failure-retry (no modal, no lost draft).**
**Given** I post a message,
**When** it is in flight,
**Then** it echoes optimistically (**pending**) and **reconciles** when its `seq` arrives; on failure it shows inline `post failed — retry` with the **draft preserved** (no modal, no lost draft),
**And** a failed **join** shows inline retry with **no half-joined state**, and a failed **👍** **reverts inline** with **no count drift**.

## Tasks / Subtasks

- [x] **Task 1 — Live SSE fold into the open room view + tree (AC1)**
  - [x] The open room's thread folds SSE deltas in near-real-time: a `room.replied` in the OPEN room appends the post to the thread immutably; a `message.reacted`/`message.unreacted` updates the affected message's reactions + (re-derives) the agreed mark; tree/tab unread decorations already fold (9.4/9.8) — ensure the OPEN room's thread itself updates live (not just the tree). Keep every fold IMMUTABLE (new state objects; no in-place mutation), consistent with the existing `foldDelta`/`foldTreeDelta` pattern. → `foldRoomDelta` in api-client.ts (pure, immutable); `foldTabRoom` in App.tsx maps it over every open tab.
  - [x] Re-affirm (comment + a test) that this SSE channel is the operator's chosen kept-open live view (Mode A) and there is NO background push to agents — the host→browser SSE does not change the agent-facing pull-only contract (NFR5). No new agent push surface. → NFR5 comments on `foldRoomDelta`/`foldTabRoom`; NFR5 test asserts an inbound delta fires ZERO outbound writes. No new host/agent surface added.
  - [x] De-dup against optimistic echoes (Task 2): when a `room.replied` SSE delta arrives whose `seq`/content matches a pending optimistic post by THIS operator, reconcile it (replace the pending with the confirmed) rather than appending a duplicate. → `foldReplied` idempotent by seq + replaces a matching (actor+body) pending/failed echo.

- [x] **Task 2 — Optimistic post echo + reconciliation (AC2)**
  - [x] On send (the Story 9.7 reply flow): immediately echo the operator's message into the thread in a **pending** visual state (dimmed + "sending…" affordance — token-based pending style on MessagePost; composer NOT blocked). When the real `room.replied` lands, **reconcile**: the pending post becomes the confirmed post at its real `seq`, in seq order, with no duplicate. → `makePendingPost`/`appendPendingPost` + the refetch-reconcile in `sendReplyAndReconcile`.
  - [x] Reconciliation key (REVISED — see Design decision): the reply POST returns the ROOM, NOT the new message `seq`, so the response seq is NOT usable as the reconciliation key. Reconcile by REFETCH (authoritative) + drop the pending echo by `clientToken`; the redundant SSE delta is de-duped by `foldRoomDelta` (idempotent by seq + actor/body echo replacement).

- [x] **Task 3 — Inline failure handling (AC2 — no modal, no lost draft/half-state)**
  - [x] **Post failure:** the pending post flips to `failed` showing inline `post failed — retry`; the **draft is preserved** in the failed echo body; retry re-sends the SAME body. NO modal. → `markPendingPostFailed` + the MessagePost `post failed — retry` affordance + `handleRetryPost`.
  - [x] **Join failure:** the join handler already drops `joinedIntent` back to false on failure (no half-joined state — the composer returns to the `[ join room to post ]` gate); re-verified unchanged + correct for 9.9.
  - [x] **👍 failure:** the toggle is now OPTIMISTIC (instant chip/count/agreed update) and **reverts inline** to the exact prior reactions on failure with **no count drift** (ReactResult `reactions` is authoritative on success). → `handleToggleReaction` optimistic apply + revert-on-catch.
  - [x] All failure surfaces inline + calm (no modal, no blocking spinner).

- [x] **Task 4 — Tests (AC1, AC2)**
  - [x] Live-fold tests (api-client + App): SSE `room.replied` appends live + immutable (prior model/array not mutated); `message.reacted` bumps the chip count + re-derives the agreed mark live; new references asserted.
  - [x] Optimistic-post tests (App): send → pending echo appears immediately; reconciles to confirmed (no duplicate); a redundant SSE delta for the operator's own post does NOT double-append.
  - [x] **Failure tests + mutation tests (Rule 7):** post failure → `post failed — retry` + draft preserved + retry re-sends; 👍 failure → chip reverts to prior count (no drift); 👍 success keeps the toggle (count 1). MUTATION 1 (👍 revert → `optimisticReactions`): the "no count drift" test went RED (`resting`≠`reacted`), reverted byte-identically. MUTATION 2 (de-dup `echoIndex = -1`): the unit `foldRoomDelta` REPLACES-it test went RED (4≠3 messages → duplicate), reverted byte-identically. Both non-vacuous.
  - [x] NFR5 assertion: an inbound SSE delta folds into the open view but fires ZERO outbound writes (operator-only; no agent push).
  - [x] Discoverable by default `pnpm test` (Rule 8); DOM in happy-dom; no `.only`/`.skip`/`.todo` (grep-verified).

- [x] **Task 5 — Gate**
  - [x] Honest gate (all recorded in Dev Agent Record): lint 0 / build (all + apps/web) / typecheck 0 / `pnpm test` 1050 passed 131 files 0 failed/0 skipped (baseline 1026 → +24) / format --check clean.

## Dev Notes

### What this story is (and is NOT)

- **IS:** the live SSE fold into the OPEN room thread (Mode A watch-live, immutable), optimistic post echo + seq-reconciliation + de-dup, and inline failure-retry for post / join / 👍 (no modal, no lost draft, no half-joined, no count drift). It makes the writes from 9.6/9.7 feel live + resilient.
- **IS NOT:** the broader calm empty/cold/disconnected states + the connection footer LED + voice/microcopy + the a11y floor (Story 9.10 — 9.9 owns ONLY the post/join/👍 in-flight + failure behavior; 9.10 owns the connection-loss footer, empty/cold states, and keyboard/SR). New tree/tab decorations are 9.4/9.8 (9.9 ensures the open thread also folds live).

### Source facts to VERIFY (Rule 4)

- SSE delta wire = `{ seq, type, actor, created_at, payload }` (Story 9.3 event wire); `openEventStream`/`foldDelta`/`foldTreeDelta` exist (apps/web api-client, immutable). The host SSE pushes `room.replied`/`message.reacted`/`message.unreacted`/`announcement.posted`/etc. deltas. VERIFIED.
- The reply POST (9.7) returns the resulting Room (carrying the new room state); confirm whether it returns the new message `seq` directly — if the reply response does not expose the new message `seq`, reconcile by refetching the room (and de-dup the SSE delta) OR thread the seq through the response. Document the reconciliation key chosen.
- react/unreact POST (9.6) returns `ReactResult { message_seq, reactions }` — use it for the optimistic-revert authoritative state.
- NFR5: the host SSE is operator→browser only (Story 9.3 framing); agents stay pull-only via `check`. No agent push. Re-affirm; do not add one.
- DESIGN/EXPERIENCE: "optimistic post echo → reconciles when the event's seq lands"; "post failed — retry with the draft preserved (no modal, no lost draft)"; "a failed join shows inline retry with no half-joined state, and a failed 👍 reverts inline with no count drift" (EXPERIENCE.md state patterns).

### Research-First (Rule 3)

- SSE reconnect/missed-delta: if the SSE connection drops and reconnects, the host's per-connection lastSentSeq logic (9.3) resumes from the client's position — confirm the open view does not miss or double-apply deltas across a reconnect (the broader disconnected-footer UX is 9.10, but the fold correctness is 9.9). Keep the fold idempotent by seq where feasible.

### Smoke (lead-side gate — informational)

Browser smoke: build apps/web, run `agentbbs ui --as <operator>` (operator a participant of an open room), drive real Chrome with the room kept open: (a) append an event out-of-band (another client) → it folds into the open thread live (Mode A); (b) post a message → it echoes pending then reconciles to confirmed at its seq (no duplicate when the SSE delta also arrives); (c) simulate a failure (e.g. point the client at a a bad endpoint / stop the host mid-post) → `post failed — retry` + draft preserved, retry succeeds when restored; (d) a 👍 with a forced failure reverts the chip with no count drift. (The lead may exercise the optimistic/failure paths via the automated suite + a targeted browser check of the live-fold + optimistic echo.)

### References

- [Source: epics.md#Epic 9 / Story 9.9] — ACs.
- [Source: EXPERIENCE.md — live updates / optimistic post / retry-on-failure state patterns; "near-real-time live updates while a view is open"; "no background push".]
- [Source: architecture.md#Frontend — "optimistic post echo → reconciles when the event's seq lands".]
- [Source: apps/web/src/api-client.ts (openEventStream/foldDelta/foldTreeDelta, postReply/postReact), App.tsx (composer + tabs + room view); 9.3 SSE host; 9.6 react; 9.7 reply/join.]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, BMad dev-story workflow under /epic-cycle).

### Debug Log References

- Honest gate (all from clean post-format state):
  - `pnpm build` — all packages + apps/web built (exit 0).
  - `pnpm typecheck` (`tsc --noEmit -p tsconfig.typecheck.json`) — exit 0, 0 errors.
  - `pnpm lint` (`eslint .`) — exit 0 (after removing an unused `removePendingPost` import from App.tsx; the helper stays exported + unit-tested).
  - `pnpm test` (`vitest run`) — 131 files, 1050 passed, 0 failed, 0 skipped. Baseline (Story 9.8) was 1026 → +24 (api-client.test.ts +18, App.test.tsx +6 net incl. removed/added flows, RoomView.test.tsx +2... net workspace +24).
  - `pnpm format` (`prettier --check .`) — "All matched files use Prettier code style!".
  - `.only`/`.skip`/`.todo` — grep across the three changed test files: none.

### Completion Notes List

- **Research-First (Rule 3) — the reconciliation-key finding.** Verified against the SHIPPED host: `POST /api/rooms/:id/reply` returns `{ room: roomToWire(room) }` (json-api.ts:443-444) — the ROOM, NOT the new message seq. `RoomWire.seq`/`activated_at_seq` is the activation seq, not the just-posted message's seq, so a reply to an already-active room returns a seq unchanged from a prior activation. **The POST-response seq is therefore NOT a usable reconciliation key** (the story's Task 2 preferred it). Decision: reconcile by REFETCH (authoritative — the refetched room carries the confirmed post at its real seq + the grant-on-act posture flip) and drop the pending echo by `clientToken`; the redundant SSE `room.replied` is de-duped by `foldRoomDelta` (idempotent by seq + replaces a matching actor+body echo). The SSE `room.replied` event's OWN `seq` IS the message seq (events/payloads + sse.ts), so the SSE path is seq-correct; only the POST response lacks it.
- **Research-First — reaction delta shape.** `message.reacted`/`message.unreacted` SSE deltas carry only `{ message_seq }` (payloads.ts:90-99) — NOT the resulting reactor set. So `foldReaction` re-derives by adding/removing `event.actor` from the target message's `reactions`, then re-derives the agreed mark via `deriveAgreedSeq` (highest-seq message with a live 👍, FR21). On the WRITE side, the optimistic 👍 uses the `ReactResult.reactions` (the react/unreact POST DOES return `{ message_seq, reactions }`) as the authoritative post-success state.
- **NFR5 re-affirmed, no agent-push surface added.** Every 9.9 helper is a pure client-side reducer over host→browser SSE deltas (the operator's OWN kept-open view). No host endpoint, no agent path, was added or changed. Re-affirmed in code comments + an explicit NFR5 test (an inbound delta folds into the view but fires ZERO outbound writes). Rule 5 (NFR tripwire) N/A — NFR5 is implementable as worded; no planning-artifact amendment needed.
- **Immutability.** `foldRoomDelta`, `appendPendingPost`, `markPendingPostFailed`, `removePendingPost`, and the optimistic 👍 patch all return NEW model/message objects; unit tests assert the prior model + its `messages` array are untouched (the 9.3/9.4 discipline extended to the open thread).
- **Composer not blocked on send.** The optimistic echo lets the operator keep typing — `handleSendMessage` no longer sets `composerPending` (that stays for the JOIN flow's disable). The Composer clears its own field on submit; the draft survives a failure inside the failed echo (retry re-sends from there), satisfying "no lost draft".
- **Scope discipline.** Built ONLY post/join/👍 in-flight + failure-retry + live-fold. Did NOT build the calm empty/cold/disconnected states, the connection-footer LED, voice/microcopy, or the a11y floor — all Story 9.10. The failure surfaces are inline + calm but the broader disconnected UX is deferred to 9.10 as the story directs.
- **Rules:** Rule 3 (verified the reply/react response shapes + delta payloads against the shipped host before coding the reconciliation key) and Rule 4 (verified the story's "Source facts" — confirmed `openEventStream`/`foldDelta`/`foldTreeDelta` exist + the `ReactResult` shape, and CORRECTED the false premise that the reply response exposes the new message seq) both exercised. Rule 7 (two mutation tests, both RED then reverted byte-identical) satisfied. Rules 5, 6 N/A (no NFR tripwire; no ADRs — `docs/adr/` empty).

### File List

- apps/web/src/api-client.ts (added the Story 9.9 live-fold + optimistic-post helper seam: `PENDING_SEQ_BASE`, `newClientToken`, `makePendingPost`, `appendPendingPost`, `markPendingPostFailed`, `removePendingPost`, `deriveAgreedSeq`, `foldRoomDelta` + the `foldReplied`/`foldReaction` internals)
- apps/web/src/App.tsx (wired the live thread fold `foldTabRoom` into the SSE effect; optimistic `handleSendMessage` + `sendReplyAndReconcile` + `handleRetryPost`; optimistic-with-revert `handleToggleReaction` + `patchTabPostReactions`; `onRetryPost` passed to RoomView)
- packages/ui-shared/src/room/MessagePost.tsx (added `pending`/`failed`/`clientToken` to `MessagePostModel`; the dimmed "sending…" pending affordance + the inline `post failed — retry` affordance + `onRetryPost` prop; suppress chip/agreed-mark on an optimistic echo; `data-pending`/`data-failed` attrs)
- packages/ui-shared/src/room/MessageThread.tsx (key by `clientToken ?? seq`; pass `onRetryPost` through)
- packages/ui-shared/src/room/RoomView.tsx (added + threaded the `onRetryPost` prop)
- apps/web/src/api-client.test.ts (Story 9.9 unit tests: `foldRoomDelta` live fold + immutability + idempotency + de-dup; optimistic-post helpers; `deriveAgreedSeq`)
- apps/web/src/App.test.tsx (Story 9.9 real-runtime DOM block: live SSE fold, optimistic post + reconcile + de-dup, post-failure inline retry, 👍 optimistic revert/success, NFR5 no-write)
- packages/ui-shared/src/room/RoomView.test.tsx (MessagePost optimistic-state cases: pending "sending…"/suppressed chip; failed inline retry + onRetryPost token)
- _bmad-output/implementation-artifacts/sprint-status.yaml (status ready-for-dev → in-progress → review)

### Change Log

- 2026-06-01 — Story 9.9 implemented: live SSE fold into the OPEN room thread (Mode A, immutable), optimistic post echo + refetch-reconcile + SSE de-dup, inline failure-retry for post/👍 (no modal, no lost draft, no count drift), join-failure no-half-state re-verified. Research-First: the reply POST returns the Room (not the new message seq) → reconcile by refetch + clientToken de-dup (documented Design decision). Two Rule-7 mutation tests confirmed non-vacuous + reverted byte-identical. Honest gate green (build / typecheck 0 / lint 0 / 1050 tests pass / format clean). Left UNCOMMITTED.
