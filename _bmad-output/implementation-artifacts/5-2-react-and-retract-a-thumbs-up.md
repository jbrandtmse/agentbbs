---
baseline_commit: 305f7db
---

# Story 5.2: React and retract a 👍

Status: done

## Story

As a participant,
I want to `react` with 👍 to a specific message and retract it,
So that I can signal agreement and change my mind, all as appended events.

## Acceptance Criteria

1. **Given** a message (identified by its `seq` — a `room.replied` OR the seeding `announcement.posted`) in a room I PARTICIPATE in,
   **When** I `react` with `message_seq`,
   **Then** a `message.reacted` event ({ messageSeq }, actor = me) is appended, and the message's LIVE 👍 state (derived: per actor, latest `react`/`unreact` wins) includes me,
   **And** re-`react`ing when I already hold a live 👍 is an idempotent no-op (no redundant `message.reacted`).

2. **Given** a 👍 I previously placed (a live reaction by me on the message),
   **When** I `unreact` with the same `message_seq`,
   **Then** a `message.unreacted` event ({ messageSeq }, actor = me) is appended and my 👍 is NO longer live,
   **And** `unreact`ing when I hold NO live 👍 is an idempotent no-op (no redundant `message.unreacted`),
   **And** I CANNOT retract another identity's 👍 — `unreact` appends only MY `message.unreacted`, which affects only MY entry in the derived live set (another actor's live 👍 is unchanged).

3. **Given** a `message_seq` that is NOT a message (no event at that `seq`, or the event is not a `room.replied`/`announcement.posted`),
   **When** I `react`/`unreact`,
   **Then** the call is rejected with `MESSAGE_NOT_FOUND` (a NEW additive closed error code) and NOTHING is appended.

4. **Given** I am NOT a participant of the message's room,
   **When** I `react`/`unreact`,
   **Then** the call is rejected with `NOT_A_MEMBER` (reacting is NOT "acting = joining" — only `reply`/`add_participant` grant participation, Epic 3; reacting requires you already participate) and NOTHING is appended.

5. **(Integration AC — real MCP server over the real SQLite ledger.)**
   **Given** the real `McpServer` + real SQLite ledger driven by a real MCP `Client` over `InMemoryTransport`, with a room that has an announcement + replies and ≥2 participants,
   **When** participant A `react`s a message, then participant B `react`s the SAME message, then A `unreact`s,
   **Then** `read_room` shows the message's live reactions as `[A]` after A reacts, `[A, B]` after B reacts, and `[B]` after A retracts (A's retraction left B's 👍 intact — AC #2),
   **And** a `react` to a non-message `message_seq` → `MESSAGE_NOT_FOUND`, and a `react` by a non-participant → `NOT_A_MEMBER`, each appending nothing,
   **And** re-`react`/`unreact` no-ops append no duplicate events (assert the `message.reacted`/`message.unreacted` counts).

## Review Findings

**Code review (2026-05-31) — CLEAN. 0 decision-needed, 0 patch, 0 defer, 7 dismissed.**

Three adversarial layers (Blind Hunter — diff only; Edge Case Hunter — diff + project read; Acceptance Auditor — diff + spec) ran against the changeset + the 5 ACs. No layer failed or returned empty. The reviewer independently re-ran the full gate in honest order — `pnpm run lint` ✓ → `pnpm run build` ✓ (7/7) → `pnpm run typecheck` ✓ → `pnpm test` ✓ **546 passed (75 files)** → `pnpm run format` (`--check`) ✓ — green on Node v24.16.0 / pnpm 11.3.0. The 546 count = the dev's 544 + the QA forked race file's 2 cases; the bootstrap exhaustive tool-list correctly grew to 17 (adds `react` + `unreact`).

**All 5 ACs independently verified satisfied:**
- **AC #1** (react + idempotent re-react; live-set derived per-actor latest-wins; re-react-after-unreact → live): `react.ts` no-op-if-`hasLiveReaction` then plain-append `message.reacted`; `reactions.ts:latestByActor` highest-seq-per-actor; proven `react.test.ts` + `reactions.test.ts` + integration.
- **AC #2** (unreact idempotent; cannot-retract-another): appends only the actor's own `message.unreacted`; liveness per-`event.actor` → A's unreact flips only A; no cross-actor write exists. Proven structurally + by test ("bob's unreact leaves cleo intact") + integration [A,B]→[B].
- **AC #3** (MESSAGE_NOT_FOUND, additive): `findMessage` resolves only `announcement.posted`/`room.replied`, else `undefined` → `BoardError('MESSAGE_NOT_FOUND')` before any append. Code is ADDITIVE (`errors.ts` appended last; `BoardErrorCode` = `(typeof BOARD_ERROR_CODES)[number]` so union↔tuple stay in sync; `error-map.ts` routes generically; `errors.test.ts` closed-set updated). Correctly verified-absent-then-added (Rule 4).
- **AC #4** (NOT_A_MEMBER; requires-but-does-not-grant): gates on `roomParticipants(message.roomId) ∋ actor`; NO `board.joined` on react/unreact (no membership side effect); announcer-who-never-replied excluded (participants = `room.replied` actors ∪ `room.participant_added` handles). Message resolved BEFORE the gate. Proven by core + integration tests.
- **AC #5** (Integration AC, real runtime): `react.integration.test.ts` drives a real `Client` ↔ `McpServer` over `InMemoryTransport` + REAL `createDataAccess` (better-sqlite3) against a genuine SQLite file in `os.tmpdir()` — nothing mocked. Proves [A]→[A,B]→[B] (B intact), MESSAGE_NOT_FOUND, NOT_A_MEMBER, idempotent no-op ledger counts, NO_IDENTITY, Zod boundary, discovery params. Genuine real-runtime evidence (Rule 1 + Rule 3).

**Cross-cutting (verified):** the append invariant + module boundary hold (`core` imports only the `DataAccess` port + `Event` type; PLAIN `append`, no guard; live-👍 + `reactions` DERIVED, never stored; order by `seq`). `read_room` messages gain `reactions: string[]` default `[]`, populated via `liveReactors`; the announcement (message #1) is reactable; the wire boundary is snake_case (`message_seq`; at-rest `messageSeq`↔`message_seq` in `mapping.ts`, both directions). Rule 8: no `.only`/`.skip`/`.todo`; the new tests run in the default suite (the 546 gate). **QA forked race (`react-race.test.ts` + worker):** genuine — forks N=8 real OS processes (`child_process.fork` of the BUILT `dist/react-race-worker.js`, resolving `@agentbbs/core` via the package `dist` barrel, with `tsc -b --force` build-if-stale), proving (a) N distinct concurrent reactors converge to all N live with zero lost reactions + unique monotonic seqs, and (b) the same-actor flap resolves to the deterministic latest-wins-by-seq outcome. Rule 5 (concurrency angle) covered even though 5.2 has no concurrency AC. Rule 6 N/A (no `docs/adr/`).

**Dismissed (7) — noise / pre-existing / latent, none a 5.2-introduced defect:**
- Blind+Edge: `react`/`unreact` read full `eventsSince(0)` per call (O(N) scan) — the established project-wide event-sourcing read pattern (`reply`/`addParticipant`/`roomParticipants`/`roomMessages` all read the full stream); already tracked in `deferred-work.md` as `3.0-b` / `4.6-a` OPEN → Story 6.1 ("per-call full-stream fold cost — measure when `check` composes them"). Not a regression; out of 5.2 scope.
- Blind: post-append read-back is a 2nd full scan — avoidable I/O, not a correctness issue (same tracked perf item).
- Blind+Edge: TOCTOU between the participation gate and the append — benign today (membership is append-only/monotonic; no "leave" op exists); a latent dependency, not a present defect. The code comments reason about it correctly.
- Edge: `messageSeqSchema` has no upper bound (a value > `Number.MAX_SAFE_INTEGER` passes Zod) — absorbed by the MESSAGE_NOT_FOUND not-found path (no event → reject, nothing appended); consistent with every other seq-typed param.
- Blind: the worker's `appendedSeq` IPC field is never asserted by the orchestrator — redundant telemetry; the ledger-count assertions are the real check and can't be masked by it.
- Blind: `react.integration.test.ts` describe says "(AC #5)" while the edited `read-room.integration.test.ts` block says "(AC #6)" — each is correct in its own story's AC frame; cosmetic cross-reference only.
- Blind: the flap-race determinism is sampled once per run — inherent to a non-seeded race; the test asserts the invariant (live iff the max-seq row is a react) for whatever scheduling produced, which is the correct claim.

No deferred-work.md entry added (0 defer findings; the one perf observation is already on the books → Story 6.1).

## Tasks / Subtasks

- [x] Task 1: Add the `MESSAGE_NOT_FOUND` error code (AC: #3)
  - [x] Append `'MESSAGE_NOT_FOUND'` to `BOARD_ERROR_CODES` in `packages/core/src/errors.ts` (additive — non-breaking per the error-contract policy; mirrors Story 4.5's `HANDLE_NOT_FOUND` add). Doc comment: "Referenced message_seq does not identify a message (announcement/reply)." `error-map.ts` routes it generically (no per-code change). Update the `errors.test.ts` closed-set assertion.
- [x] Task 2: Build the reactions projection + message resolver (AC: #1, #2)
  - [x] In `packages/core/src/rooms/reactions.ts`: `liveReactors(events, messageSeq): string[]` = fold `message.reacted`/`message.unreacted` for that `messageSeq`, per actor keep the LATEST (by `seq`) — an actor is a live reactor iff their latest event for the message is a `react`. Return the live-reactor handles in first-live (`seq`) order. Also `hasLiveReaction(events, messageSeq, actor): boolean`. Pure fold.
  - [x] Add a message resolver: `findMessage(events, messageSeq): { messageSeq, roomId, actor, kind } | undefined` — the event at `messageSeq` IFF its type is `announcement.posted` or `room.replied` (returns its `roomId`); `undefined` otherwise (drives `MESSAGE_NOT_FOUND`). (Place in `reactions.ts` or `room-history.ts`.)
  - [x] Unit-test the projection: react → live includes actor; react then unreact → not live; unreact then re-react → live again (latest wins); two actors independent (A's unreact leaves B live); no reactions → empty; ordering by `seq`.
- [x] Task 3: Implement `react` / `unreact` core ops (AC: #1, #2, #3, #4)
  - [x] Create `packages/core/src/rooms/react.ts` exporting `react(dataAccess, actor, messageSeq)` and `unreact(dataAccess, actor, messageSeq)`. Both: `events = eventsSince(0)`; `msg = findMessage(events, messageSeq)` → throw `BoardError('MESSAGE_NOT_FOUND')` if `undefined` (AC #3, nothing appended); gate `roomParticipants(events, msg.roomId)` includes `actor` → else throw `BoardError('NOT_A_MEMBER')` (AC #4); then:
    - `react`: if `hasLiveReaction(events, messageSeq, actor)` → idempotent no-op return (NO append, AC #1); else `append([{ type: 'message.reacted', actor, payload: { messageSeq } }])`.
    - `unreact`: if NOT `hasLiveReaction(...)` → idempotent no-op return (NO append, AC #2); else `append([{ type: 'message.unreacted', actor, payload: { messageSeq } }])`.
    Plain `append` (reactions are not uniqueness-constrained; the projection's latest-wins dedups a benign race). `actor` is a param. `core` imports only the `DataAccess` port.
  - [x] Export `react`, `unreact`, `liveReactors`, `hasLiveReaction`, `findMessage` from `packages/core/src/index.ts`. Unit-test every branch (react/unreact happy; MESSAGE_NOT_FOUND; NOT_A_MEMBER; idempotent no-ops; cannot-retract-another).
- [x] Task 4: Surface live reactions on `read_room` messages (AC: #1, #2, #5)
  - [x] Extend `RoomMessage` (`packages/core/src/rooms/room-history.ts`) with `reactions: string[]` (the live-reactor handles for that message's `seq`, via `liveReactors`); `roomMessages` populates it (fold the full stream once; for each message compute its live reactors). Extend `messageToWire` (`tools/room-shared.ts`) to emit `reactions` (snake_case `reactions`, a string array — no transform needed). So `read_room` shows each message's live 👍 reactors — the observable for AC #5 (and the input 5.3 computes the contract from).
  - [x] Update the Story 4.4 `read_room` tests/integration that assert the message shape to include `reactions` (default `[]` for an un-reacted message).
- [x] Task 5: Wire the `react` + `unreact` MCP tools (AC: all)
  - [x] Create `packages/mcp-server/src/tools/react.ts` and `tools/unreact.ts` mirroring `tools/reply.ts`: a Zod input schema `{ message_seq: <positive int> }` (e.g. `z.number().int().positive()`), the session `NO_IDENTITY` gate, delegate to `core.react`/`core.unreact`, map errors via `error-map.ts` (`MESSAGE_NOT_FOUND`, `NOT_A_MEMBER`, `NO_IDENTITY`), return an envelope (e.g. `{ message_seq, reactions }` — the message's live reactors after the op, consistent with the room-tool envelopes). Register both in `server.ts` + extend the exhaustive tool-list assertion in `server.bootstrap.test.ts`.
- [x] Task 6: Integration AC + full gate (AC: #5)
  - [x] Add `packages/mcp-server/src/tools/react.integration.test.ts`: real `Client`↔`McpServer` over `InMemoryTransport` + real SQLite proving AC #5 (A reacts → [A]; B reacts → [A,B]; A unreacts → [B], B intact; MESSAGE_NOT_FOUND; non-participant → NOT_A_MEMBER; idempotent no-op counts) — observed via `read_room` reactions.
  - [x] Run the full gate in honest order: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final count (Epic 5 at 500 after Story 5.1).

## Dev Notes

This story adds the `react`/`unreact` MCP tools + the reactions projection (live-👍 state derived by latest-react-wins). It introduces the message-reaction surface Story 5.3 computes the agreed contract from. NEW additive error code `MESSAGE_NOT_FOUND`; reuses `message.reacted`/`message.unreacted` (already in the vocabulary).

**Rule 1 (Integration ACs):** AC #5 is the real-runtime Integration AC (react/unreact over real MCP + real SQLite, the live-set transitions observed via `read_room`).
**Rule 3 (real-runtime evidence):** both tools ship with the real `Client`↔`McpServer`↔SQLite test.
**Rule 4 (verify source-facts):** the Source facts (reaction payloads `{ messageSeq }`; `MESSAGE_NOT_FOUND` absent; `RoomMessage`/`messageToWire` shape) were verified against the repo at story creation; the dev re-confirms before coding.
**Rule 5 / Rule 6:** N/A (no NFR; no `docs/adr/`).

### Design decisions (grounded at story creation, baseline `305f7db`)

1. **Reacting REQUIRES participation (→ `NOT_A_MEMBER`); it does NOT grant it.** Only `reply`/`add_participant` are "acting = joining" (Epic 3 success criteria, line 599). A 👍 is a ratification signal within a negotiation you are already in — a non-participant cannot ratify. So `react`/`unreact` gate on `roomParticipants(roomId)` (the message's room), mirroring `add_participant`'s adder-gate.
2. **Live-👍 state is DERIVED by latest-react-wins per actor** — `message.reacted`/`message.unreacted` are appended facts; an actor's 👍 is live iff their LATEST event (by `seq`) for that `messageSeq` is a `react`. No stored reaction state (THE APPEND INVARIANT). This is the projection 5.3's contract computes over.
3. **A message is identified by its `seq`** (the `room.replied` / `announcement.posted` `seq`; Story 4.4 proved `RoomMessage.seq == event.seq`). `react(message_seq)` resolves the message (and its room, for the gate); a `message_seq` that is not a message → `MESSAGE_NOT_FOUND` (NEW additive code — there is no existing code for "not a message"; `ROOM_NOT_FOUND` is for rooms, not messages).
4. **Idempotent react/unreact (mirror `joinBoard`):** re-`react` when already live, or `unreact` when not live, is a no-op (no redundant event). Keeps the ledger clean and "is my 👍 live" unambiguous; the projection's latest-wins is the backstop for a benign race.
5. **Cannot-retract-another is INHERENT, not a guard:** `unreact` appends only the actor's own `message.unreacted`, and the projection scopes liveness per actor — so an `unreact` can only flip the ACTOR's own entry. No special check needed; AC #2 is satisfied structurally.
6. **`read_room` messages gain `reactions: string[]`** (the live reactors) — the observable surface for react/unreact AND the input 5.3 reads. A no-reaction message has `reactions: []`.

### Source facts (verified at story creation, baseline `305f7db`)

- **Reaction payloads** (`packages/core/src/events/payloads.ts:89-98`): `MessageReactedPayload`/`MessageUnreactedPayload` both `{ messageSeq: number }` (at rest `{ message_seq }` — confirm the `mapping.ts` casing). Event types `message.reacted`/`message.unreacted` in `EVENT_TYPES` + `EventPayloadMap`.
- **`MESSAGE_NOT_FOUND` is ABSENT** from `BOARD_ERROR_CODES` (`errors.ts` — 9 codes through `HANDLE_NOT_FOUND`). Add it additively (mirror Story 4.5's `HANDLE_NOT_FOUND` add; update `errors.test.ts`).
- **`roomParticipants`** (`packages/core/src/rooms/participants.ts`, Story 4.5) — the participation gate (actors of `room.replied` ∪ handles of `room.participant_added` for a room).
- **`RoomMessage`** (`room-history.ts`) = `{ seq, actor, body, kind }`; **`messageToWire`** (`room-shared.ts`) = `{ seq, actor, body, kind }`. Extend BOTH with `reactions: string[]`.
- **Message resolution**: the event at `messageSeq` (via `eventsSince(0)` filter on `seq === messageSeq`) must be `announcement.posted` or `room.replied` to be a message; its payload carries `roomId`.
- **Tool pattern**: `tools/reply.ts` (write tool, session gate, error-map, envelope). Tool registration in `server.ts`; tool-list assertion in `server.bootstrap.test.ts` (react + unreact are 2 more tools).
- Toolchain (Epics 1–5): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers).

### Project Structure Notes

- New `packages/core/src/rooms/reactions.ts` (`liveReactors`, `hasLiveReaction`, `findMessage`) + `react.ts` (`react`, `unreact`) (+ tests); extend `room-history.ts` (`RoomMessage.reactions`) + `tools/room-shared.ts` (`messageToWire.reactions`); new `tools/react.ts` + `tools/unreact.ts` (+ integration test); add `MESSAGE_NOT_FOUND`; register in `server.ts`. One barrel.
- THE APPEND INVARIANT: `message.reacted`/`message.unreacted` appended (never mutated); live-👍 state + `reactions` DERIVED by query; order by `seq`; `core` imports only the `DataAccess` port (plain append, no guard).

## Dev Agent Record

### Context Reference

- Story file (this file). Persistent facts loaded on activation: `_bmad-output/project-context.md`, `_bmad/custom/skill-rules.md` (Rules 1–9). Toolchain verified at dev-start: Node v24.16.0, pnpm 11.3.0 (matches the Node 24 / pnpm 11.3 commitment — Rule 9 N/A at dev stage, the lead owns epic pre-flight).

### Rule 4 — source-facts verified against the repo before coding

All Source facts re-confirmed against the working tree (baseline `305f7db`):
- **Reaction payloads** `MessageReactedPayload`/`MessageUnreactedPayload` = `{ messageSeq: number }` ✓ (`packages/core/src/events/payloads.ts:89-99`); at-rest casing `{ message_seq }` ✓ (`packages/data-access/src/mapping.ts:118-125,247-254`, both write + read directions).
- **`MESSAGE_NOT_FOUND` ABSENT** — `BOARD_ERROR_CODES` had 9 codes through `HANDLE_NOT_FOUND` ✓ (`packages/core/src/errors.ts`).
- **`RoomMessage`** = `{ seq, actor, body, kind }` ✓ (`room-history.ts`); **`messageToWire`** = `{ seq, actor, body, kind }` ✓ (`tools/room-shared.ts`).
- **`roomParticipants`/`isParticipant`** exist (`packages/core/src/rooms/participants.ts`) ✓.
- **Tool pattern** via `registerCoreTool` (routes any `BoardError.code` generically through `error-map.ts`) + per-connection `SessionIdentity` NO_IDENTITY gate ✓ (`tools/reply.ts`, `tools/add-participant.ts`).
- No delta from the story's Source facts was found; all coded-to as written.

### Implementation Plan / approach

- **Task 1** — additive `MESSAGE_NOT_FOUND` appended to `BOARD_ERROR_CODES` (mirrors Story 4.5's `HANDLE_NOT_FOUND`); `BoardErrorCode` is derived from the tuple so the union updates automatically; `error-map.ts` needed no change (it maps any `BoardError.code` generically). `errors.test.ts` closed-set assertion extended.
- **Task 2** — new `rooms/reactions.ts`: `liveReactors`/`hasLiveReaction` via a shared `latestByActor` fold (per-actor highest-`seq` react/unreact wins; live iff latest is a react); `liveReactors` orders by each live actor's CURRENT (live) react `seq` (gives the AC #5 `[A]→[A,B]→[B]` transitions and re-react re-ordering). `findMessage` resolves the event at a `seq` to a message iff `announcement.posted`/`room.replied` (returns its `roomId`), else `undefined`.
- **Task 3** — new `rooms/react.ts`: shared `resolveAndGate` (read stream → `findMessage` → MESSAGE_NOT_FOUND; `roomParticipants ∋ actor` → else NOT_A_MEMBER, message resolved BEFORE the gate). `react`/`unreact` then idempotent-no-op (already live / not live) else PLAIN-`append` `message.reacted`/`message.unreacted` `{ messageSeq }`, read-back the live reactors. Returns `{ messageSeq, reactions }`. Cannot-retract-another is inherent (appends only the actor's own event; liveness per-actor). Barrel exports added.
- **Task 4** — `RoomMessage` + `MessageWire` gained `reactions: string[]`; `roomMessages` populates each message's `reactions` via `liveReactors(events, event.seq)` over the same folded stream (it already receives the full `events`); `messageToWire` carries it (snake_case `reactions` is a no-op single word). `room-history.test.ts` + `read-room.test.ts` full-object `.toEqual` assertions updated to include `reactions: []`; a new `roomMessages` reactions describe-block added; `read-room.integration.test.ts` `WireMessage` + a default-`[]` assertion added.
- **Task 5** — new `tools/react.ts` + `tools/unreact.ts` mirroring `reply.ts` (shared `messageSeqSchema = z.number().int().positive()` added to `room-shared.ts`), NO_IDENTITY session gate, delegate to `core.react`/`core.unreact`, `{ message_seq, reactions }` envelope. Both registered in `server.ts`; the bootstrap exhaustive tool-list extended to 17 (adds `react`, `unreact`).
- **Task 6** — `tools/react.integration.test.ts` (real `Client`↔`McpServer`↔SQLite) proving AC #5 + the negative paths + idempotent no-op ledger counts + NO_IDENTITY + Zod-boundary rejection + discovery params.

### Completion Notes

- **All 5 ACs satisfied.** AC #1 (react + live-set + idempotent re-react): core `react.test.ts` + projection `reactions.test.ts`. AC #2 (unreact + idempotent + cannot-retract-another): `react.test.ts` ("bob's unreact leaves cleo intact") + projection two-actor independence. AC #3 (MESSAGE_NOT_FOUND for a non-message seq): core ops + the new error code. AC #4 (NOT_A_MEMBER for a non-participant, incl. the announcer who never replied): core ops. AC #5 (Integration — real MCP + real SQLite): `react.integration.test.ts` proves `[A]→[A,B]→[B]` (B intact) via `read_room` reactions, MESSAGE_NOT_FOUND, non-participant NOT_A_MEMBER, and idempotent no-op event counts.
- **Key design points held (no deviation):** react REQUIRES participation and does NOT grant it (only reply/add_participant are "acting = joining"); live-👍 DERIVED by latest-react-wins (no stored state — THE APPEND INVARIANT); a message = its `seq` (announcement.posted / room.replied); MESSAGE_NOT_FOUND is NEW additive; idempotent no-ops mirror joinBoard; cannot-retract-another is inherent (per-actor liveness). PLAIN `append`, no guard; `core` imports only the `DataAccess` port.
- **Notable choice (surfaced for review):** the core ops return `{ messageSeq, reactions }` (the live reactors after the op, read back from the ledger — mirrors `addParticipant`'s `{ room, participants }` read-back) so the tool envelope `{ message_seq, reactions }` is consistent with the room-tool envelopes. The `liveReactors` ORDER is by each live actor's CURRENT (live) react `seq` (so a re-react re-orders the actor) — chosen to make the AC #5 `[A]→[A,B]→[B]` transitions exact; pinned by a dedicated ordering test.
- **Shared `messageSeqSchema`** placed in `room-shared.ts` (alongside `roomIdSchema`/`announcementBodySchema`) so `react`/`unreact` cannot drift — consistent with the codebase's shared-validator pattern.
- **Test-count delta:** +44 (3 new files: `reactions.test.ts` 16 + `react.test.ts` 17 + `react.integration.test.ts` 8 = 41; plus 3 new `roomMessages` reactions cases in `room-history.test.ts`). The closed-set / read-room / bootstrap / read-room.integration edits added assertions without net new test cases. Final suite: **544 passed (74 files)** = the post-5.1 500 baseline + 44.
- **Honest gate (formatted tree, in order):** `pnpm run lint` ✓ / `pnpm run build` 7-7 ✓ / `pnpm run typecheck` ✓ / `pnpm test` 544 (74 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`) ✓ / `pnpm run format` (`prettier --check .`) ✓ — note `prettier --write` was applied to `room-history.test.ts` + `react.integration.test.ts` (whitespace only), then `--check` re-run clean and the full suite re-run green on the formatted tree.
- **Rules:** Rule 1 (Integration AC) — AC #5 is the real-runtime integration AC, present. Rule 3 (real-runtime evidence) — `react.integration.test.ts` exercises both tools over real `Client`↔`McpServer`↔SQLite. Rule 4 — source-facts verified (above), no delta. Rule 5 (NFR) / Rule 6 (ADR — no `docs/adr/`) — N/A.
- **Left UNCOMMITTED** for the lead's post-CR smoke gate (per the epic-cycle dev-stage contract — the bmad-dev-story default commit was suppressed). `dist/` is git-ignored — not committed.

### File List

New:
- packages/core/src/rooms/reactions.ts
- packages/core/src/rooms/reactions.test.ts
- packages/core/src/rooms/react.ts
- packages/core/src/rooms/react.test.ts
- packages/mcp-server/src/tools/react.ts
- packages/mcp-server/src/tools/unreact.ts
- packages/mcp-server/src/tools/react.integration.test.ts

Modified:
- packages/core/src/errors.ts (add `MESSAGE_NOT_FOUND` to `BOARD_ERROR_CODES`, additive)
- packages/core/src/errors.test.ts (closed-set assertion includes `MESSAGE_NOT_FOUND`)
- packages/core/src/index.ts (barrel: export `react`, `unreact`, `liveReactors`, `hasLiveReaction`, `findMessage`, `ReactResult`, `ResolvedMessage`)
- packages/core/src/rooms/room-history.ts (`RoomMessage.reactions: string[]`; `roomMessages` populates via `liveReactors`)
- packages/core/src/rooms/room-history.test.ts (full-object assertions + new `reactions` describe-block)
- packages/core/src/rooms/read-room.test.ts (full-object assertions include `reactions: []`)
- packages/mcp-server/src/tools/room-shared.ts (`messageSeqSchema`; `MessageWire.reactions`; `messageToWire` carries `reactions`)
- packages/mcp-server/src/server.ts (register `react` + `unreact`; tool-surface comment)
- packages/mcp-server/src/server.bootstrap.test.ts (exhaustive tool-list → 17, adds `react`/`unreact`)
- packages/mcp-server/src/tools/read-room.integration.test.ts (`WireMessage.reactions`; default-`[]` assertion)

### Change Log

| Date | Change |
| --- | --- |
| 2026-05-31 | Story 5.2 implemented: `react`/`unreact` MCP tools + the reactions projection (live-👍 DERIVED by latest-react-wins) + `MESSAGE_NOT_FOUND` (additive) + `read_room` messages gain `reactions`. Full honest gate green (544 tests). Status → review. |
