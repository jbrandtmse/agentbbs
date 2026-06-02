---
baseline_commit: c1eb1d4
---

# Story 5.3: Compute the current agreed contract

Status: done

## Story

As a reader,
I want the current contract computed as the most-recent live-👍'd message,
So that I can mechanically locate the agreement without the board ever storing "the contract."

## Acceptance Criteria

1. **Given** a room where several messages have received and/or lost 👍s,
   **When** I request the current contract (a new `read_contract` open read),
   **Then** it is the message with the HIGHEST `seq` that CURRENTLY holds at least one LIVE 👍 (via the Story 5.2 `liveReactors`), computed by QUERY — there is NO stored "contract" flag or column.

2. **Given** the current contract's last live 👍 is retracted (so it no longer holds any live 👍),
   **When** I recompute,
   **Then** the contract REVERTS to the previous message that still holds a live 👍 (the next-highest-`seq` live-👍'd message), or resolves to "no contract yet" (`null`) if none remain.

3. **Given** a room with NO live 👍 anywhere (never reacted, or all retracted),
   **When** I request the current contract,
   **Then** the result is "no contract yet" (`null`).

4. **Given** the contract is an OPEN read (FR9 — "computed by ANY reader"),
   **When** any established identity (NOT necessarily a participant/member) calls `read_contract` for a room,
   **Then** it succeeds (the only precondition is `NO_IDENTITY` if no identity is established),
   **And** an unknown `room_id` → `ROOM_NOT_FOUND` (reused; no new error code).

5. **(Integration AC — real MCP server over the real SQLite ledger.)**
   **Given** the real `McpServer` + real SQLite ledger driven by a real MCP `Client` over `InMemoryTransport`, with a room whose messages are message M1 (`seq` a) and a later M2 (`seq` b > a),
   **When** a participant 👍s M1 → `read_contract` returns M1; then 👍s M2 → `read_contract` returns M2 (highest-`seq` live-👍 wins); then retracts M2's 👍 → `read_contract` REVERTS to M1; then retracts M1's 👍 → `read_contract` returns `null` ("no contract yet"),
   **And** a brand-new room with no reactions → `null`,
   **And** a NON-member identity can `read_contract` the room (open read), and an unknown `room_id` → `ROOM_NOT_FOUND`.

## Review Findings

**Code review — Story 5.3 (2026-05-31). APPROVED. 0 decision-needed / 0 patch / 0 defer-to-backlog. 1 LOW auto-resolved inline (test-count drift). 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) all returned 0 findings.** EPIC 5 IS COMPLETE after this story — whole suite green end-to-end.

### Independent verification (all 9 directive points + 5 ACs PASS)

1. **Append invariant + module boundary (lint-enforced) — the FR21 guarantee.** The contract is DERIVED by query every call; there is NO stored contract. Grep across `packages/data-access` confirms NO `current_contract`/`contract` column, flag, or event (the only "contract" hits are the word in comments: migrate.ts "forward-only is the contract", errors.ts "wire contract"). `currentContract` (contract.ts) and `readContract` (read-contract.ts) only READ + fold — grep for `eventsSince`/`appendGuarded`/`.append(` in contract.ts → none; `read-contract.ts` reads `eventsSince(0)` once, never appends. Ordered by `seq` (the loop walks `roomMessages`' seq-sorted output). `core` imports only the `DataAccess` port + the room-history/projection folds (which import only `Event`) — the lint-enforced boundary; build/typecheck green confirms no boundary violation.
2. **AC #1 — highest-seq live-👍 wins (count irrelevant).** `currentContract` = `roomMessages(events, roomId)` (each message annotated with its live `reactions` via Story 5.2 `liveReactors`), walked from the highest index (= highest seq, ascending sort) down, returning the FIRST with `reactions.length > 0`. It does NOT re-fold reactions (calls `roomMessages` only, never `liveReactors` directly — Design decision 2). COUNT is never compared — only seq + ≥1 live. The QA "highest-seq-not-most-reactors" test (contract.test.ts:341-379) genuinely pins this: seq 2 carries THREE live reactors, seq 3 carries ONE → asserts `contract.seq === 3` (a popularity bug would return 2), and the symmetric retract case drops to the 3-reactor seq 2 only because it is then the highest live-👍'd. GENUINE pin.
3. **AC #2 — reversion is automatic (no special logic).** No stored "previous contract", no revert branch — `currentContract` is a fresh `roomMessages` fold each call. The QA multi-level (≥3) reversion test (contract.test.ts:305-339) walks M3→M2→M1→null retracting one 👍 at a time; the critical step (lines 330-333) retracts BOTH M3 and M2 so the loop must SKIP PAST two consecutive now-dead messages to reach the live M1 — exercising the multi-level downward walk the dev's 2-level tests never hit. GENUINE.
4. **AC #3 — null when no live 👍.** A room whose messages have no reactions → null (contract.test.ts:106); a 👍'd-then-un-👍'd message is NOT the contract (latest-react-wins → null, contract.test.ts:185). Op-layer + integration both pin the all-retracted → null tail.
5. **AC #4 — OPEN read (FR9) + ROOM_NOT_FOUND distinct from null.** The `read_contract` tool gates ONLY on `session.handle === null` → NO_IDENTITY; grep confirms NO `isMember`/`requireMembership`/`isParticipant`/`board.joined` in the tool — a non-member reads it. The core `readContract` op resolves `findRoom` FIRST → throws ROOM_NOT_FOUND for an unknown room; a KNOWN room with no live 👍 returns `contract: null`. The two cases are genuinely distinguished (read-contract.test.ts:110-128: unknown → ROOM_NOT_FOUND rejection, known-empty → resolves null).
6. **AC #5 — Integration AC (Rule 1 + 3).** read-contract.integration.test.ts drives a real `Client` ↔ `createBoardServer`-built `McpServer` ↔ real `createDataAccess` (better-sqlite3 behind the NFR2 seam, genuine SQLite file under `os.tmpdir()`) over `InMemoryTransport` — NOTHING mocked. Proves the M1→M2→M1→null progression (seqs captured from `read_room`; participant `bob` 👍 M1 → M1, 👍 M2 → M2, retract M2 → reverts M1, retract M1 → null), no-reactions room → null, NON-member open read (`dan` never joined/replied), unknown room → ROOM_NOT_FOUND, NO_IDENTITY, and the discovery-surface `room_id`. The contract assertions check `env.contract.body` against the exact posted strings (lines 225/241/341) — confirming `read_contract` returns the full contract MESSAGE incl. `body`, not a pointer. GENUINE real-runtime evidence.
7. **Thin-client boundary.** The `read_contract` TOOL is thin: it does the session gate + `await readContract(dataAccess, args.room_id)` + `messageToWire` mapping only. No `eventsSince`, no board logic (existence + ROOM_NOT_FOUND moved into the core `readContract` op, mirroring `readRoom` exactly — same `findRoom` → throw → project shape). Clean. The pure `currentContract(events, roomId)` projection stays existence-agnostic (null for unknown/empty); the op layers the existence check over a single stream read.
8. **No new event/error code; the strict-typecheck cast fix.** EVENT_TYPES unchanged (still 10); BOARD_ERROR_CODES unchanged (`ROOM_NOT_FOUND`/`NO_IDENTITY` reused, no new code). The integration test casts `structuredContent` via a `type ContractEnvelope = {...}` ALIAS (anonymous object-literal type that carries the index signature), NOT a named `interface` — grep confirms zero `interface ContractEnvelope` anywhere; the named interface failed `tsconfig.typecheck.json` with TS2352 (no index signature) and the Vitest src-alias had hidden it. `pnpm run typecheck` is GREEN (exit 0) — the fix is genuine, the build/typecheck gate is the guard the dev's note describes.
9. **Full gate (honest order) — GREEN end-to-end.** `lint` (0 findings) → `build` (7/7 projects) → `typecheck` (0) → `test` **575 passed / 78 files / 0 failed / 0 skipped** (no `.only`/`.skip`/`.todo` in the contract tests) → `format` (`prettier --check .` clean). The 575/78 matches the QA-reported count exactly. `read_contract` is in the bootstrap exhaustive tool-list assertion (server.bootstrap.test.ts:226-245, sorted 18-name list incl. the 2 representatives) and registered in server.ts:196. EPIC 5 COMPLETE.

### Adversarial layers — all clean

- **Blind Hunter (diff-only, correctness):** 0 findings. The `messages[i]!` non-null assertion (contract.ts:71) is safe — `i ∈ [0, length-1]` so the element is always defined (a `noUncheckedIndexedAccess` narrowing, no runtime risk). The null-vs-message envelope (`contract === null ? null : messageToWire(...)`) maps absence to JSON `null` per the project convention; `structuredContent` and `content[].text` carry the same shape.
- **Edge Case Hunter (diff + project read):** 0 unhandled. Walked: empty stream / unknown room → null (op throws ROOM_NOT_FOUND first); equal-seq ties impossible (unique AUTOINCREMENT seq); cross-room isolation (inherited from `roomMessages`' roomId filter — pinned contract.test.ts:219-249); re-react after retract re-instates (latest-wins — pinned :206); order-independence (pinned :279); the announcement (#1) CAN be the contract incl. a proto-room (pinned :252-277); the integration `connect()` helper shares ONE module-level `dataAccess` across connections so the progression is a genuine single-ledger sequence.
- **Acceptance Auditor (diff + spec + context):** 0 AC violations. All 5 ACs map to passing tests at the projection, op, and real-runtime layers.

### Findings

- **[Review][Resolved-inline] LOW — Test-count drift in the Dev Agent Record (572 → 575; "16 unit + 5 op + 6 integration" → 19 + 4 + 6).** The Completion Notes / Change Log stated 572 passed and a +27 breakdown of "16 contract.test.ts + 5 read-contract.test.ts + 6 integration". The measured suite is **575 passed / 78 files** and the actual new-test breakdown is **19 (contract.test.ts) + 4 (read-contract.test.ts) + 6 (integration) = 29** — QA appended 3 cases to contract.test.ts (the multi-level ≥3 reversion + the two highest-seq-not-most-reactors tests) after the dev's draft count, and the op file carries 4 it() blocks (2 describe × 2), not 5. Net +29 over the post-5.2 baseline of 546 = 575. Code unaffected — a documentation/count drift identical in shape to the Story 4.4 review's auto-resolved test-count correction. **Auto-resolved inline** in the Completion Notes + Change Log below (and reflected in `sprint-status.yaml`); not carried to backlog.

### Carried-forward OPEN items (for the Epic 5 retrospective triage — Story 5.3 did NOT resolve any; it is a read-only projection + read tool with NO new validator/event/error code and NO append path)

- **1.5 OPEN** — append-invariant lint guard disabled in `*.test.ts` (test-helper SQL relies on review). Unaffected by 5.3.
- **1.6 OPEN** — `wireToPayload` does not validate a known-type-but-malformed payload row. Unaffected by 5.3.
- **3.0-b OPEN → Story 6.1** — guard-before-append doubles the per-call ledger read on `recordSeen`/`updateFocus` (the `check` hot-path consumer). Not touched by 5.3.
- **4.6-a OPEN → Story 6.1** — `roomJoinSeq`/`roomMessagesSince` per-call full-stream fold cost; measure when `check` composes them. Not touched by 5.3 (note: `currentContract`/`readContract` likewise fold the full stream per call — the same DERIVED-by-query architecture, a perf-watch not a defect; fold into the same 6.1 measurement if it ever shows up).
- **5.1-roomid-cap-edge OPEN** — no at-cap/cap+1 test for `room_id` `ROOM_ID_MAX_LENGTH`=200. 5.3 reuses the shared `roomIdSchema` (its `read_contract` input) without adding a new validator, consistent with codebase-wide precedent (no tool pins a syntactic length cap-edge call test). Fold into the next room-tool touch / Epic 7 contract.
- **E3-tool-names OPEN → Epic 7** — MCP tool names not contract-pinned. 5.3 names `read_contract` + the `{ room_id, contract }` envelope by the established convention (`read_*` reads, object-wrapped result); ratify or rename in Epic 7's `mcp-tool-contract.md` while the agent population is still zero. The bootstrap exhaustive tool-list assertion is the source of truth meanwhile.

## Tasks / Subtasks

- [x] Task 1: Build the `currentContract` projection (AC: #1, #2, #3)
  - [x] In `packages/core/src/rooms/contract.ts`, export `currentContract(events, roomId): RoomMessage | null` = of the room's messages (`roomMessages(events, roomId)` — Story 4.4, which now carry `reactions`), the one with the HIGHEST `seq` whose `reactions` (live reactors, Story 5.2) is non-empty; `null` if none. Pure fold; reuse `roomMessages` (which already computes each message's `reactions` via `liveReactors`) — do NOT re-fold reactions independently. Reverting is automatic: it is always a fresh query over the current live-👍 state, so a retraction that empties the top message's 👍 naturally yields the next-highest live-👍'd message (AC #2) with no special "revert" logic.
  - [x] Unit-test: no reactions → `null`; one live-👍'd message → that message; two live-👍'd → the higher-`seq`; after the higher loses its last live 👍 → reverts to the lower; after the lower also loses it → `null`; a message that was 👍'd then un-👍'd is NOT the contract; cross-room isolation (room A's contract ignores room B's reactions); the announcement (message #1) CAN be the contract if it is the highest-`seq` live-👍'd.
- [x] Task 2: Wire the `read_contract` MCP tool (AC: #1, #4, #5)
  - [x] Create `packages/mcp-server/src/tools/read-contract.ts` mirroring `tools/read-room.ts`: a `{ room_id: roomIdSchema }` Zod input schema, the session `NO_IDENTITY` gate (OPEN read — NO membership/participation, FR9), resolve the room via `findRoom` → `ROOM_NOT_FOUND` if absent, then delegate to `core.currentContract(dataAccess, roomId)`, return `{ room_id, contract: <messageToWire(msg)> | null }` (the contract MESSAGE incl. its `body`/`seq`/`actor`/`kind`/`reactions`, or `null` for "no contract yet"). Reuse `messageToWire` (`room-shared.ts`). No new error code (`ROOM_NOT_FOUND`/`NO_IDENTITY` reused).
  - [x] `currentContract` core op signature: decide whether the room-existence check lives in core (`currentContract` throws `ROOM_NOT_FOUND`) or the tool (tool calls `findRoom` first). Prefer the tool resolves existence (mirrors how `readRoom` throws `ROOM_NOT_FOUND` in core) — pick one and be consistent; document it. (Simplest: `currentContract` returns `null` for an unknown/empty room and the TOOL does the `findRoom` → `ROOM_NOT_FOUND` existence check, distinguishing "room doesn't exist" from "room exists but no contract yet".) **Resolution:** kept the pure `currentContract(events, roomId)` projection existence-agnostic (returns `null` for unknown/empty — exactly as Task 1 / Source-facts specify and unit-tested), and added a THIN core read op `readContract(dataAccess, roomId)` that reads the stream once, does `findRoom` → `ROOM_NOT_FOUND`, then returns `currentContract(events, roomId)` — mirroring `readRoom`. The tool delegates to `readContract` (stays thin — no `eventsSince`/board-logic in mcp-server, the project-context thin-client rule), so existence resolution + the ROOM_NOT_FOUND throw live in core where they already do for `readRoom`/`reply`. "Room doesn't exist" (throws) is DISTINCT from "exists, no contract yet" (`null`). See Dev Agent Record.
  - [x] Register `read_contract` in `packages/mcp-server/src/server.ts` and extend the exhaustive tool-list assertion in `server.bootstrap.test.ts`.
- [x] Task 3: Integration AC + full gate (AC: #5)
  - [x] Add `packages/mcp-server/src/tools/read-contract.integration.test.ts`: real `Client`↔`McpServer` over `InMemoryTransport` + real SQLite proving AC #5 — the 👍 M1 → 👍 M2 → retract M2 → retract M1 progression (contract = M1 → M2 → M1 → null), a no-reactions room → null, a non-member open read, and `ROOM_NOT_FOUND`. Capture message seqs from `read_room`.
  - [x] Run the full gate in honest order: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final count (Epic 5 at 546 after Story 5.2).

## Dev Notes

This story computes the **current agreed contract** — the marquee Epic 5 capability (FR21): the contract is the most-recent (highest-`seq`) message currently holding a live 👍, computed by query, NEVER stored. It adds the `currentContract` projection + the `read_contract` open-read tool. Reuses Story 4.4's `roomMessages` (with the Story 5.2 `reactions`) — no new event type, no new error code.

**Rule 1 (Integration ACs):** AC #5 is the real-runtime Integration AC (the contract computation + reversion + null over real MCP + real SQLite).
**Rule 3 (real-runtime evidence):** `read_contract` ships with the real `Client`↔`McpServer`↔SQLite test.
**Rule 4 (verify source-facts):** the Source facts (`roomMessages` carries `reactions`; `liveReactors`; `messageToWire`; `findRoom`) were verified at story creation; the dev re-confirms.
**Rule 5 / Rule 6:** N/A (no NFR; no `docs/adr/`).

### Design decisions (grounded at story creation, baseline `c1eb1d4`)

1. **The contract is COMPUTED, never stored** (FR21 / THE APPEND INVARIANT). `currentContract` is a fresh query over the current live-👍 state every call. Reversion-on-retract (AC #2) needs NO special logic — because nothing is stored, recomputing after a retraction naturally yields the next-highest live-👍'd message (or `null`). There is no `contract` column, flag, or event.
2. **Reuse `roomMessages` (which already carries `reactions`)** — Story 5.2 made each `RoomMessage` carry its live reactors. `currentContract` filters those to the non-empty-reactions messages and takes the max `seq`. Do NOT re-implement reaction folding.
3. **The contract is an OPEN read (FR9, "computed by ANY reader").** `read_contract` gates only on `NO_IDENTITY` — a non-participant/non-member can read a room's contract (like `read_room`). An unknown `room_id` → `ROOM_NOT_FOUND`; a known room with no live 👍 → `contract: null` ("no contract yet") — these are DISTINCT (existence vs emptiness).
4. **A dedicated `read_contract` tool (not just a `read_room` field).** The contract is the marquee negotiation primitive (propose → counter → ratify → the contract is the frozen agreement) that Epic 7's protocol references; a first-class tool is the clean affordance for "what is currently agreed here?" and returns just the contract message (not the full history). (The Story 5.2 `read_room` `reactions` already let a client compute it too, but `read_contract` is the authoritative server-computed answer.)
5. **The contract result IS the message** (incl. `body`) — "show me the agreed text", not just a pointer. `null` = "no contract yet".

### Source facts (verified at story creation, baseline `c1eb1d4`)

- **`roomMessages`** (`packages/core/src/rooms/room-history.ts`, Story 4.4 + 5.2): returns `RoomMessage[]` ordered by `seq`, each `{ seq, actor, body, kind, reactions: string[] }` (live reactors). `currentContract` = max-`seq` message with `reactions.length > 0`.
- **`liveReactors`** (`packages/core/src/rooms/reactions.ts`, Story 5.2) is the live-👍 fold `roomMessages` already uses — no need to call it directly.
- **`findRoom`** (`packages/core/src/rooms/projection.ts`) — the room-existence check for `ROOM_NOT_FOUND`.
- **`messageToWire`** (`packages/mcp-server/src/tools/room-shared.ts`) maps a `RoomMessage` → `{ seq, actor, body, kind, reactions }` (snake_case). Reuse for the contract wire (or `null`).
- **Read-tool pattern**: `tools/read-room.ts` ({ room_id }, NO_IDENTITY gate, delegate, ROOM_NOT_FOUND, envelope). `read_contract` mirrors it. Tool registration in `server.ts`; tool-list assertion in `server.bootstrap.test.ts` (`read_contract` is one more tool).
- **`ROOM_NOT_FOUND`/`NO_IDENTITY`** already in `BOARD_ERROR_CODES`. NO new error code, NO new event type.
- Toolchain (Epics 1–5): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers).

### Project Structure Notes

- New `packages/core/src/rooms/contract.ts` (`currentContract`) (+ test); new `packages/mcp-server/src/tools/read-contract.ts` (+ integration test); register in `server.ts`. One barrel (`packages/core/src/index.ts`).
- THE APPEND INVARIANT: the contract is DERIVED by query every call — no stored contract; order by `seq`; `core` imports only the `DataAccess` port. This is the FR21 "never store the contract" guarantee.

## Dev Agent Record

### Context Reference

- Story file: `_bmad-output/implementation-artifacts/5-3-compute-the-current-agreed-contract.md`
- Persistent facts loaded: `_bmad-output/project-context.md`, `_bmad/custom/skill-rules.md`.

### Implementation Plan

Red-green-refactor per task:
1. **Task 1** — wrote `contract.test.ts` first (RED: module missing), then the pure `currentContract(events, roomId): RoomMessage \| null` projection (GREEN). It reuses `roomMessages` (which already carries each message's live `reactions` via `liveReactors`) and walks from the highest `seq` down, returning the first message with a non-empty `reactions`, else `null`. No reaction re-folding. Barrel export added.
2. **Task 2** — added the thin core read op `readContract(dataAccess, roomId)` (mirrors `readRoom`): one stream read, `findRoom` → `ROOM_NOT_FOUND`, then return `currentContract(events, roomId)`. Wrote `read-contract.ts` MCP tool (mirrors `read-room.ts`): `{ room_id }` Zod schema, `NO_IDENTITY` gate, delegate to `readContract`, return `{ room_id, contract: messageToWire(msg) \| null }`. Registered in `server.ts`; extended the exhaustive tool-list assertion in `server.bootstrap.test.ts` (now 18 names incl. the 2 representatives). Added `read-contract.test.ts` (op-layer existence-vs-emptiness + progression).
3. **Task 3** — wrote `read-contract.integration.test.ts` (real `Client`↔`McpServer`↔SQLite) proving AC #5, then ran the full honest gate.

### Key decision — where the room-existence (`ROOM_NOT_FOUND`) check lives

The story's Task 2 subtask 2 left this open (core throws vs the tool resolves), preferring "the tool resolves existence (mirrors how `readRoom` throws `ROOM_NOT_FOUND` in core)". I resolved it by keeping **two** clean layers, faithful to BOTH the precise Task 1 / Source-facts signature AND the thin-client rule:

- `currentContract(events, roomId): RoomMessage \| null` stays the **pure, existence-agnostic projection** exactly as Task 1 and the Source facts specify (returns `null` for an unknown/empty room) — this is what the unit tests pin.
- `readContract(dataAccess, roomId)` is a **thin core read op** (the `readRoom` mirror) that reads the stream once, does `findRoom` → `ROOM_NOT_FOUND`, then returns `currentContract(events, roomId)`.
- The `read_contract` **tool** delegates to `readContract` only.

Why not put `findRoom` + `currentContract` directly in the tool (as the subtask's "simplest" note literally describes)? Because the tool layer is a THIN client — by the project-context rule it must NOT read `dataAccess` or hold board logic (the existence-vs-emptiness distinction). A grep confirmed `eventsSince` appears in NO existing tool handler (only in tests); every tool delegates to a core op. So existence resolution + the `ROOM_NOT_FOUND` throw live in core where they already do for `readRoom`/`reply`. Net effect is identical to what the AC requires: unknown room → `ROOM_NOT_FOUND` (throws), known room with no live 👍 → `contract: null` — DISTINCT.

### Completion Notes

- **FR21 / THE APPEND INVARIANT honored:** the contract is COMPUTED by query every call — NO stored `contract`/`current_contract` column, flag, or event; NO new event type; NO new error code (`ROOM_NOT_FOUND`/`NO_IDENTITY` reused). Reversion-on-retract (AC #2) needed NO special logic: a fresh `currentContract` query after a retraction naturally yields the next-highest live-👍'd message (or `null`). Proven both at the projection layer (`contract.test.ts`) and end-to-end over the real MCP+SQLite stack (`read-contract.integration.test.ts`: M1 → M2 → revert to M1 → null).
- **Reuse, not re-fold:** `currentContract` consumes `roomMessages` (Story 4.4 + 5.2 `reactions`) and does not re-implement reaction folding (Design decision 2).
- **OPEN read (FR9):** `read_contract` gates only on `NO_IDENTITY`; a non-member reads the contract (proven). The announcement (message #1) CAN be the contract (proven — proto-room whose only message is 👍'd).
- **Rule 4 (verify source-facts):** re-confirmed against the repo before coding — `roomMessages` carries `reactions: string[]` (room-history.ts); `liveReactors` is the live fold it uses; `messageToWire` maps `{ seq, actor, body, kind, reactions }` (room-shared.ts); `findRoom` resolves a `Room \| undefined` (projection.ts). No deltas.
- **Rule 1 + Rule 3:** AC #5 is the real-runtime Integration AC — `read-contract.integration.test.ts` exercises the real `Client`↔`McpServer`↔SQLite (nothing mocked). Rule 5 / Rule 6 N/A (no NFR amendment; no `docs/adr/`).
- **TS subtlety found at typecheck (not at vitest run):** the strict `tsconfig.typecheck.json` rejected casting `structuredContent` (`{ [x: string]: unknown } \| undefined`) to a NAMED `interface ContractEnvelope` (TS2352 — a named interface does not carry the index signature). Fixed by making the cast target a `type` alias (anonymous object-literal type), which overlaps with the index signature — the idiom the other integration tests use (inline literals). The vitest `src`-alias hid this; the build/typecheck gate surfaced it (consistent with Rule 2's "dist-artifact guard" note).
- **Honest gate — all green:** `lint` (0) → `build` (7/7) → `typecheck` (0) → `test` **575 passed / 78 files / 0 failed / 0 skipped** (no `.only`/`.skip`/`.todo`; +29 vs the 546 post-5.2 baseline = 19 `contract.test.ts` + 4 `read-contract.test.ts` + 6 `read-contract.integration.test.ts`) → `format` (`prettier --check` clean; `--write` applied to 2 new test files for whitespace, then re-checked + suite re-run green). [Count reconciled at code review 2026-05-31: the dev draft stated 572 / "16+5+6=27"; the measured suite is 575/78 and QA appended 3 cases to `contract.test.ts` (the multi-level ≥3 reversion + the two highest-seq-not-most-reactors tests, 16→19) with the op file at 4 it() blocks (not 5), so the true delta is +29 over 546. See Review Findings.]
- **Left UNCOMMITTED** for the lead's post-CR smoke gate (per instruction).

### File List

New:
- `packages/core/src/rooms/contract.ts`
- `packages/core/src/rooms/contract.test.ts`
- `packages/core/src/rooms/read-contract.ts`
- `packages/core/src/rooms/read-contract.test.ts`
- `packages/mcp-server/src/tools/read-contract.ts`
- `packages/mcp-server/src/tools/read-contract.integration.test.ts`

Modified:
- `packages/core/src/index.ts` (barrel — export `currentContract` + `readContract`)
- `packages/mcp-server/src/server.ts` (import + register `read_contract`; tool-block doc comment)
- `packages/mcp-server/src/server.bootstrap.test.ts` (exhaustive tool-list assertion + comment)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (5-3 → in-progress, then review)

### Change Log

- 2026-05-31 — Story 5.3 implemented: `currentContract` projection (FR21) + `readContract` core read op + `read_contract` MCP tool (open read, ROOM_NOT_FOUND vs `contract: null`). The current agreed contract is COMPUTED by query, never stored; reverts automatically on retraction. +29 tests (19 unit projection [16 dev + 3 QA] + 4 op + 6 real-runtime integration). Full honest gate green (575/78). Status → review.
- 2026-05-31 — Code review: APPROVED, EPIC 5 COMPLETE. 0 decision-needed / 0 patch / 0 defer; 3 adversarial layers + all 5 ACs + 9 directive points clean. 1 LOW (test-count drift 572→575 / breakdown 16+5+6 → 19+4+6) auto-resolved inline. Honest gate re-run by the reviewer GREEN (lint 0 / build 7-7 / typecheck 0 / test 575-78 / format --check). Status → done.
