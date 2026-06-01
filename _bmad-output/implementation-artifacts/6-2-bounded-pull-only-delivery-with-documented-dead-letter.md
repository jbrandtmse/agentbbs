---
baseline_commit: 0da782d
---

# Story 6.2: Bounded, pull-only delivery with documented dead-letter

Status: done

## Story

As the board,
I want `check` to be a cheap, bounded cursor query that never pushes,
So that polling cost stays low and the pull-only contract holds.

## Acceptance Criteria

1. **Given** a large ledger,
   **When** I call `check`,
   **Then** the response contains ONLY the new delta (new items since `max(cursor, floor)`, NOT the full back-history) — the delta size is bounded by NEW activity, independent of the total ledger size,
   **And** the delta is served by an indexed cursor read (`eventsSince` is `seq`-ordered and `seq`-indexed; the back-history is excluded by the cursor + per-scope floors, never transmitted).

2. **Given** the pull-only contract (NFR5),
   **When** any operation runs,
   **Then** NO notification, interrupt, or async push is ever emitted to an agent — `check` is strictly request→response (the agent dials in; the board answers; it never calls out). This is asserted (no push/notify/SSE API is invoked by `check` or any MCP tool).

3. **Given** a need (announcement/room) posted to / for an agent whose workflow has ENDED (it never dials in again),
   **When** that agent does not `check`,
   **Then** the need PERSISTS in the ledger (nothing is lost — append-only), is still visible to any OPEN read (`list_announcements`/`read_room`/`read_contract` — FR9 global read) and to the OPERATOR as the escalation backstop,
   **And** this "pull-only dead-letter" is DOCUMENTED as an accepted V1 limitation with the operator-escalation / global-read backstop (per NFR11).

4. **(Real-runtime evidence — bounded + persistent.)**
   **Given** the real SQLite ledger with a large back-history,
   **When** a freshly-floored identity `check`s,
   **Then** the delta is bounded by the post-floor NEW items (a test proves the delta count does NOT grow with the back-history size — e.g. N old events + k new → the delta is ~k, not N+k),
   **And** a need posted for an agent that never checks remains in the ledger and is returned by an OPEN read (the dead-letter persists, not lost).

## Review Findings

**Code review (2026-05-31) — APPROVED; EPIC 6 COMPLETE.** Proportionate review of a docs + tests-only
changeset (ZERO new production code). Adversarial three-lens pass (Blind Hunter / Edge Case Hunter /
Acceptance Auditor): 0 HIGH / 0 MED / 0 decision-needed / 0 defer-to-backlog. 1 LOW auto-resolved
inline (below). Verdict: all 4 ACs satisfied with real-runtime evidence; the pull-only / bounded /
dead-letter contract doc is accurate against the code.

- [x] [Review][Patch] Doc tool-count inaccuracy ("12 tools" → count-agnostic) [docs/pull-only-delivery.md:39, :196] — **RESOLVED inline.** The new doc asserted "every one of the 12 tools" (§1) and "without changing the 12 tools agents already see" (§5/V2-path), but `server.ts` registers **17** tools (lines 196–212: register, login, update_focus, announce_project, list_projects, join_board, list_members, post_announcement, list_announcements, list_rooms, reply, read_room, add_participant, react, unreact, read_contract, check). This is the same repo-wide tool-count-label drift tracked as deferred-work `4.5-tool-label` / `E3-tool-names` (→ Epic 7 `mcp-tool-contract.md`, where the exact count + names get contract-pinned). NOT load-bearing (the no-push claim holds for any N) but it would mislead an outside dev (NFR8). Fixed with count-agnostic phrasing ("every one of its tools" / "the tools agents already see") so the doc is accurate today AND does not bake in a number Epic 7's ratification may itself adjust. Re-checked: no other tool-count claim remains in the doc; `prettier --check` clean.

**Verifications performed (all PASS):**
1. **ZERO production-source change** — the full changeset vs baseline `0da782d` is `*.test.ts` (4 files, all under `packages/mcp-server/src/`) + `docs/pull-only-delivery.md` + `README.md` + 3 tracking docs. NO `*.ts` under `packages/*/src/` except `*.test.ts`; `check.ts` (core + tool), `server.ts`, `register-tool.ts` all `git diff --stat`-clean vs baseline.
2. **Bounded tests genuine + load-bearing (not vacuous)** — both prove the delta is bounded by NEW activity, not ledger size: per-BOARD floor (announcements: 400 back-history + 3 delta → first check returns EXACTLY 3, `toEqual(newRoomIds)`, none of the 400 leak, `length < maxSeq/10`, `maxSeq ≥ 400`) AND per-ROOM floor (QA messages test: 400 reply back-history + late `add_participant` → EXACTLY the post-add delta, exercising the `room.participant_added` floor branch the announcement test never touches). Both add SCALE-INVARIANCE (same delta count at 10 vs 400 back-history on one shared ledger; `large.maxSeq > small.maxSeq`). A broken floor would return back_history+delta and fail `toHaveLength(DELTA)` — the assertions are load-bearing (mutation-style: the floor is the thing under test). Real `createDataAccess` SQLite, nothing mocked (Rule 3).
3. **No-push genuinely asserted** — STRUCTURAL: scans ALL production `*.ts` in `mcp-server/src` (non-vacuity guarded: `files.length > 15`, server.ts + tools/check.ts present) for push CALL forms (`sendNotification(` / `.notification(` / `sendLoggingMessage(` / `createMessage(` / `elicitInput(` / `SSEServerTransport` / `EventSource`) → 0 hits; pins the lone `ServerNotification` token to its `RequestHandlerExtra<ServerRequest, ServerNotification>` TYPE position in `register-tool.ts`. Independently reproduced the grep: the only two `ServerNotification` hits are register-tool.ts:37 (type import) + :44 (type alias) — zero CALL forms. BEHAVIOURAL: a real `Client` receives 0 server notifications across register→check (via `fallbackNotificationHandler`) while `check` returns a `CallToolResult` — verified `fallbackNotificationHandler?: (notification: Notification) => Promise<void>` is present on the INSTALLED `@modelcontextprotocol/sdk@1.29.0` `dist/esm/shared/protocol.d.ts:265` (Rule 3 — installed `.d.ts` is authoritative).
4. **Dead-letter persists (durability-without-delivery)** — Z registers + joins the board (the need IS in Z's scope) but Z's workflow ENDS, Z NEVER checks (asserted 0 `identity.seen` for Z, the only presence-recording op). The `announcement.posted` remains in the ledger (out-of-band `eventsByType('announcement.posted')` filtered to the room == 1) AND is returned by OPEN reads (`list_announcements` subject + `read_room` body verbatim "tasks table column types") to a NON-member operator (asserted `operator ∉ list_members`). Genuinely proves durable + operator-visible, only undelivered-by-pull. Real SQLite.
5. **Doc accuracy (`docs/pull-only-delivery.md`)** — every load-bearing claim verified against code: §2/§3 `seq > max(cursor, joinFloor)` composition matches `check.ts:189` (board) + `:205` (room) exactly; §3 cursors-table append-invariant carve-out matches `cursors.ts:83-84` (`INSERT INTO cursors … ON CONFLICT(handle) DO UPDATE SET seq = excluded.seq`); §3 `maxReturned`-not-`maxSeq()` cursor advance matches `check.ts:215-228`; §4 FR9 open reads gate identity-not-membership (verified `list_announcements.ts` + `read-room.ts`, locked by `board-read-open.fr9.integration.test.ts`); §1 README cross-refs exist ("nobody is ever pushed to" line 20; "push notifications (pull-only — agents dial in)" out-of-scope line 168). The ONLY inaccuracy was the "12 tools" label (finding above), now fixed — cosmetic, tracked, not a load-bearing lie.
6. **Rule 5 honesty (no NFR dodge)** — the bounded test's query-cost smoke (`checkMs < 2000`, the whole bounded file ~3s over two 400-event builds) confirms `check` is cheap at V1 scale; consistent with Story 6.1's measurement. No NFR was found unmeasurable/impossible; no planning artifact amended; no paper-over comment. Honest reaffirmation of an existing property.
7. **Full gate GREEN (honest order)** — lint (0) → build (7/7 packages) → typecheck (0) → test (**615** passed, 88 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`) → format (`--check` clean, incl. the edited doc). The 4 Story-6.2 test files were confirmed to actually RUN (9 tests pass by path filter, real-SQLite files take 700–1040ms each — Rule 8: discovered by the default suite). Count: 606 (post-6.1) + 7 dev + 2 QA (bounded-messages) = 615.

**Rules:** Rule 1 N/A (not service-introducing — documents + reaffirms existing `check`). Rule 3 satisfied (bounded + dead-letter + no-push-behavioural over real `createDataAccess` SQLite). Rule 4 source-facts independently re-verified vs repo (above), no deltas. Rule 5 honest (no amendment). Rule 6 N/A (no `docs/adr/`). Rule 8 — all 3 dev files + the QA file are `*.test.ts` under `packages/mcp-server/src/**`, default-suite-discovered + confirmed-run. THE APPEND INVARIANT held (nothing new appended/mutated; the dead-letter persists BECAUSE append-only; `check` PUSHES nothing).

**Deferred:** NO new deferred items introduced by this story. Carried-forward OPEN set for the Epic 6 retro (unchanged): `1.5`, `1.6`, `5.1-roomid-cap-edge`, `E3-tool-names` (→ Epic 7), `4.5-tool-label` (cosmetic — this story's "12 tools" doc fix is a fresh instance of the same drift, fixed inline; the convention-ratification still lands in Epic 7).

## Tasks / Subtasks

- [x] Task 1: Document the pull-only / bounded / dead-letter delivery model (AC: #1, #2, #3)
  - [x] Create `docs/pull-only-delivery.md` (open-source-ready, NFR8): explain (a) `check` is PULL-ONLY — the board never pushes/notifies/interrupts; agents dial in on their own cadence (Epic 8 wires the post-step cadence); (b) `check` is BOUNDED — the response is the delta since `max(cursor, floor)`, served by an indexed `seq` cursor read; back-history is never transmitted (it is browsed on demand via the open reads); (c) the per-identity cursor + per-scope floors (Stories 4.6/6.1) and how they compose; (d) the ACCEPTED pull-only DEAD-LETTER limitation (NFR11) — a need posted for an agent whose workflow has ended is NOT delivered (the agent never dials in) but is NEVER LOST (append-only ledger), remains visible to every open read (FR9) and to the operator, and the documented BACKSTOP is operator escalation / global-read (the operator is a peer who can dial in, read the board, and act / nudge). State plainly that V1 accepts this (no delivery guarantee, only durability + pull); a networked push backend is the deferred V2 path.
  - [x] Cross-link from the README (or the docs index) so the contract is discoverable.
- [x] Task 2: Reaffirming tests — bounded + no-push + dead-letter persists (AC: #1, #2, #4)
  - [x] **Bounded:** a test (real `createDataAccess` SQLite OR the in-memory fake at scale) that seeds a LARGE pre-floor back-history (e.g. hundreds of events the identity is floored out of) + a small post-floor delta (k items), calls `check`, and asserts the returned delta count == k (NOT total) — proving the response is bounded by NEW activity, not ledger size. (This also re-confirms the Story 6.1 floor.)
  - [x] **No push:** an assertion that `check` (and the MCP server generally) emits no push — e.g. a test confirming `check` is a pure request→response (returns a `CallToolResult`, registers no notification handler, the server exposes no SSE/notify surface). A grep-style structural assertion is acceptable (no `notification`/`sendNotification`/push API in the tool/server paths) — document the method.
  - [x] **Dead-letter persists:** a real-runtime test — post a need (announcement) intended for an agent; that agent NEVER `check`s; assert the `announcement.posted` remains in the ledger and is returned by an OPEN read (`list_announcements`/`read_room`) — the need is durable and operator-visible, only undelivered-by-pull.
- [x] Task 3: Full gate (AC: all)
  - [x] Run the full gate in honest order: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final count (Epic 6 at 606 after Story 6.1).

## Dev Notes

This story closes Epic 6 and SM1 (the zero-relay loop): it DOCUMENTS the pull-only / bounded / dead-letter contract that Story 6.1's `check` already implements, and adds reaffirming tests (boundedness, no-push, dead-letter persistence). It is primarily a DOCUMENTATION + test-hardening story — `check` is already pull-only + delta-bounded from 6.1; this story makes the contract explicit (NFR5/NFR11/NFR8) and proves the bound + the durable dead-letter. NO new MCP tool, event type, or error code is expected; minimal-to-no new production code.

**Rule 1 (Integration ACs):** N/A — not service-introducing (documents + reaffirms the existing `check`). AC #4 carries real-runtime evidence (bounded + persistent over the real ledger).
**Rule 3 (real-runtime evidence):** the bounded + dead-letter-persists tests run over the real `createDataAccess` SQLite ledger.
**Rule 4 (verify source-facts):** confirm against the repo — `check` reads the delta via the cursor + floors (Story 6.1); the MCP server exposes no push/notification surface; the open reads (`list_announcements`/`read_room`) are FR9-open.
**Rule 5 (NFR tripwire — IMPORTANT):** NFR5 says `check` is a CHEAP cursor query. Story 6.1 MEASURED the per-call full-stream fold and applied a contained optimization (3.0-b/4.6-a resolved). If, while writing the bounded test, you find the QUERY (not just the response) scales with total ledger size in a way that violates "cheap" at a realistic V1 size, do NOT paper over it with a comment — surface it (it would be an NFR tripwire to amend the planning artifact / re-open the perf item). Expected: the response is bounded (delta-only) and the query is acceptable at V1 scale (6.1's measurement), so this is documentation, not an NFR workaround — but verify the bounded test honestly.
**Rule 6 (ADR):** N/A — no `docs/adr/`.

### Design decisions (grounded at story creation, baseline `0da782d`)

1. **"Bounded" = the RESPONSE (delta) is bounded by NEW activity, not ledger size.** Story 6.1's `check` excludes the back-history via the cursor + per-scope floors, so the delta is ~`new items`, independent of total events. The test proves this (large back-history + small delta → delta count == small). (The QUERY reads the stream for scope — measured acceptable at V1 in 6.1; the "cheap cursor query" claim is about the bounded delta + the indexed `seq` read, with the scope-fold cost the measured-acceptable V1 cost.)
2. **"Pull-only / never pushes" is a structural property to ASSERT, not just document.** The MCP server is request→response (stdio JSON-RPC); no tool emits a notification/SSE/interrupt. The test asserts the absence of any push surface (structural / grep-style), making NFR5's no-push explicit.
3. **The dead-letter is DURABILITY without delivery-guarantee.** Append-only means nothing is ever lost; pull-only means an ended-workflow agent simply never receives it. The accepted V1 contract: durable + operator-visible (global read / escalation backstop, NFR11), NOT guaranteed-delivered. Documented plainly so an operator knows the backstop is "dial in and act / nudge".
4. **No new code expected.** `check` (6.1) already implements bounded pull-only. This story documents + proves; if a tiny helper is needed for the bounded test, keep it test-side. Do NOT add a push surface (that would violate NFR5).

### Source facts (verified at story creation, baseline `0da782d`)

- **`check`** (`packages/core/src/discovery/check.ts`, Story 6.1): returns the delta since `max(cursor, floor)` (bounded), advances the cursor to `maxReturned`, `recordSeen` for presence. Reads `eventsSince(0)` for scope (measured-acceptable at V1; 3.0-b/4.6-a resolved). The MCP `check` tool returns a `CallToolResult` (request→response).
- **MCP server** (`packages/mcp-server/src/server.ts`): stdio JSON-RPC; tools are request→response handlers — there is no notification/SSE/push surface (V1 daemonless; the V2 HTTP+SSE backend is deferred). Confirm by grep (no `notification`/`sendNotification` in the tool/server paths).
- **Open reads** (FR9): `list_announcements`/`list_rooms`/`read_room`/`read_contract`/`list_members`/`list_projects` succeed for any established identity without membership — the operator-escalation / global-read backstop surface.
- **Docs:** `docs/` currently holds `append-invariant-checklist.md`. Add `docs/pull-only-delivery.md`. (`docs/negotiation-protocol.md` is Epic 7.)
- Toolchain (Epics 1–6): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers).

### Project Structure Notes

- New `docs/pull-only-delivery.md` + a README/docs cross-link; new/extended tests (bounded; no-push; dead-letter-persists) — likely under `packages/core/src/discovery/` (bounded/dead-letter over the fake or real ledger) and/or `packages/mcp-server/src/` (no-push structural assertion). NO new production module expected.
- THE APPEND INVARIANT: nothing new appended/mutated beyond `check`'s existing behavior; the dead-letter PERSISTS precisely because the ledger is append-only (nothing is ever deleted). `check` PUSHES nothing.

## Dev Agent Record

### Context

Epic-6-closing story. PRIMARILY DOCUMENTATION + reaffirming tests for the pull-only / bounded /
dead-letter contract that Story 6.1's `check` already implements. **Zero new production code** — no
new MCP tool, event type, error code, or push surface was added (adding any push surface would
violate NFR5). `check.ts` (core + tool) and `server.ts` are unchanged.

### Source facts re-verified against the repo (Rule 4)

- **`check` returns the bounded delta** — `packages/core/src/discovery/check.ts` surfaces an item
  only if `seq > max(cursor, joinFloor)` (per-board `boardFloors` + per-room `roomFloors`), so the
  back-history is excluded by the cursor + per-scope floors, never transmitted. The cursor advances
  to `maxReturned` (NOT `maxSeq()`). The `check` MCP tool (`tools/check.ts`) returns a
  `CallToolResult` (request→response) and "PUSHES nothing".
- **No push surface** — grep of `packages/mcp-server/src` for `notification` / `sendNotification` /
  `SSE` / `push` finds NO production push CALL. The only `ServerNotification` token is a **type
  parameter** of the SDK's `RequestHandlerExtra<ServerRequest, ServerNotification>` in
  `register-tool.ts` (the per-call handler-context type, request-handling infrastructure — NOT a
  push emitter). Every `push` hit is `Array.push` / the existing "PUSHES nothing" comments. The
  server is stdio JSON-RPC request→response only.
- **Open reads are FR9-open** — `list_announcements` / `read_room` / `list_members` (and
  `read_contract` / `list_projects` / `list_rooms`) gate only on `NO_IDENTITY`, never on membership
  (confirmed in `tools/list-announcements.ts`; locked-in by the existing
  `board-read-open.fr9.integration.test.ts`). These are the dead-letter escalation / global-read
  backstop surface.
- At-rest payloads are `snake_case`; the data-access read path
  (`packages/data-access/src/mapping.ts`) maps them back to internal `camelCase` `Event.payload`
  (`room_id` → `roomId`), so the dead-letter test's out-of-band `eventsByType` filter on
  `payload.roomId` is correct (the same internal form `check.ts` uses).
- `fallbackNotificationHandler?: (notification: Notification) => Promise<void>` verified present on
  the installed `@modelcontextprotocol/sdk@1.29.0` Protocol type (`dist/esm/shared/protocol.d.ts`)
  before coding the behavioural no-push assertion to it (Rule 3 — installed `.d.ts` is authoritative).

### Design decisions realized

1. **"Bounded" = the RESPONSE is bounded by NEW activity, not ledger size.** The bounded test proves
   it two ways over the real SQLite ledger: (a) ABSOLUTE — a 400-event pre-floor back-history + a
   3-item post-floor delta → the freshly-floored identity's first `check` returns EXACTLY 3, none of
   the 400 pre-join rooms leak, and the response is `< maxSeq/10`; (b) SCALE-INVARIANCE — the same
   post-floor delta returns the SAME count at a small (10) and a large (400) back-history layered on
   one shared ledger, so the response does not grow with the ledger.
2. **"No push" is an ASSERTED structural property.** The no-push test statically scans every
   production `*.ts` in `mcp-server/src` for push CALL forms (`sendNotification(` / `.notification(`
   / `sendLoggingMessage(` / `createMessage(` / `elicitInput(` / `SSEServerTransport` / `EventSource`)
   — zero hits — pins the one `ServerNotification` token to its type position in `register-tool.ts`,
   and behaviourally asserts a real client receives ZERO server notifications across register→check
   (fallback notification handler fires 0 times) while `check` returns a `CallToolResult`.
3. **The dead-letter is DURABILITY without delivery-guarantee.** The dead-letter test (real ledger):
   Z registers + joins a board (so a need IS in Z's `check` scope) but Z's workflow ENDS — Z NEVER
   `check`s (asserted: 0 `identity.seen` for Z). The `announcement.posted` remains in the ledger
   (out-of-band `eventsByType` == 1) and is returned by OPEN reads (`list_announcements` +
   `read_room`, body verbatim) to a non-member OPERATOR — durable + operator-visible, only
   undelivered-by-pull.

### Rule 5 (NFR tripwire) — verified honestly, NOT a workaround

NFR5 says `check` is a CHEAP cursor query. The bounded test's Rule-5 smoke timed the `check` over
the 400-event back-history and it completed comfortably under a loose 2000ms ceiling (the whole
bounded file — two 400-event builds + checks — runs in ~3s). So the RESPONSE is bounded (delta-only)
AND the QUERY is acceptable at a realistic V1 size (consistent with Story 6.1's measurement). **No
tripwire**: this is documentation reaffirming an existing property, not papering over a perf issue.
No planning artifact was amended.

### Rules applied

- **Rule 1** N/A — not service-introducing (documents + reaffirms the existing `check`).
- **Rule 3** — the bounded + dead-letter-persists tests run over the real `createDataAccess` SQLite
  ledger (nothing mocked); the no-push behavioural test also uses the real ledger.
- **Rule 4** — source-facts re-verified vs the repo (above), no deltas coded to.
- **Rule 5** — verified honestly, no amendment (above).
- **Rule 6** N/A — no `docs/adr/`.
- **Rule 8** — all 3 new test files are `*.test.ts` under `packages/mcp-server/src/**` → discovered
  by the default `vitest.config.ts` `include` glob (ran in the full 613-test suite).
- **THE APPEND INVARIANT** — nothing new appended/mutated beyond `check`'s existing behaviour; the
  dead-letter PERSISTS precisely because the ledger is append-only; `check` PUSHES nothing.

### Gate (honest order, all GREEN)

`pnpm run lint` (0) → `pnpm run build` (7/7 packages) → `pnpm run typecheck` (0) → `pnpm test`
(**613** passed, 87 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`) → `pnpm run format`
(`--check` clean after `--write` on the 3 new test files, then full suite re-run green on the
formatted tree). Count: 606 (post-6.1 baseline) + 7 new (bounded 2, no-push 4 [3 structural + 1
behavioural], dead-letter 1) = 613. Build-before-test observed (forked workers resolve via `dist`;
this story adds no core export, so no forked worker is affected). `dist/` left un-committed
(git-ignored). Left UNCOMMITTED for the lead's post-CR smoke gate.

### File List

**Added**

- `docs/pull-only-delivery.md` — the canonical pull-only / bounded / dead-letter delivery contract
  (NFR5 / NFR8 / NFR11), open-source-ready, with the code map + reaffirming-test pointers.
- `packages/mcp-server/src/tools/check.bounded.integration.test.ts` — bounded delivery, real
  SQLite (AC #1, #4) + the Rule-5 query-cost smoke.
- `packages/mcp-server/src/no-push.contract.test.ts` — the no-push structural + behavioural contract
  (AC #2; NFR5).
- `packages/mcp-server/src/tools/dead-letter.integration.test.ts` — the pull-only dead-letter
  persists + stays operator-visible, real SQLite (AC #3, #4; NFR11).

**Modified**

- `README.md` — cross-linked `docs/pull-only-delivery.md` from the `check`/cursor Key-concepts row
  and the `check` MCP-tool-surface row (two discovery points).
- `_bmad-output/implementation-artifacts/6-2-bounded-pull-only-delivery-with-documented-dead-letter.md`
  — Tasks/Subtasks checked, Status → review, this Dev Agent Record.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 6-2 ready-for-dev → in-progress
  → review.

### Change Log

- 2026-05-31 — Story 6.2 implemented (Epic-6-closing). Documented the pull-only / bounded /
  dead-letter delivery contract (`docs/pull-only-delivery.md` + README cross-links) and added 3
  reaffirming test files (bounded over real SQLite incl. scale-invariance + a Rule-5 query-cost
  smoke; no-push structural [grep-style] + behavioural [zero-notification] contract; dead-letter
  persists + operator-visible over real SQLite). Zero new production code / tool / event / error
  code / push surface. Full gate green (613 tests). Status → review.
