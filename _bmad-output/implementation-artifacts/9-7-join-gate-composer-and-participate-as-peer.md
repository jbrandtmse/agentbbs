---
baseline_commit: 1c2abbc29da0902c2e2c4775ebfbf54ebabf8bb0
---

# Story 9.7: Join-gate composer and participate-as-peer

Status: review

<!-- Created by the /epic-cycle Lead Creates Story Files gate. Baseline: AGENTBBS-1-epic9 @ 1c2abbc (Story 9.6). -->
<!-- Completes the UI WRITE path (join + reply/post + add_participant). Mode B, FR31. -->

## Story

As an operator,
I want to join a room and post as a peer,
so that I can resolve an agent-flagged boundary directly on the board (Mode B, FR31).

## Acceptance Criteria

**AC1 — Join-gate composer (two states).**
**Given** a room I have not joined,
**When** I view the composer,
**Then** it shows a single `[ join room to post ]` button (reading needed no join);
**And when** I click join,
**Then** it becomes `✓ you joined` + a text field + send, and I can post, 👍, and `add_participant` **as a peer over the same core the MCP clients use**,
**And** I follow the **same rule as agents** (read open board-wide; posting requires joining).

**AC2 — Posture flip (Mode A→B) + same-core participation.**
**Given** I join + post,
**When** my participation is established,
**Then** the joined-participants row posture flips `you: watching` → `you: @operator (peer)` (the Story 9.5 posture line, now driven by a real participation change), and my posted message appears in the thread authored by my operator handle — produced by the SAME core board ops agents use (no operator backdoor).

## Tasks / Subtasks

- [x] **Task 1 — Join + reply (+ add_participant) WRITE endpoints** (AC: #1, #2)
  - [x] Extend the host write seam (the POST dispatch Story 9.6 established) with the board's participation/post ops, actor = the operator handle:
    - `POST /api/projects/:projectId/join` → core `joinBoard(da, operator, projectId)` (sub-board membership).
    - `POST /api/rooms/:roomId/reply` (body: `{ body }`) → core `reply(da, operator, { roomId, body })` (posts a message AND grant-on-act makes the operator a room participant + sub-board member — "acting = joining").
    - `POST /api/rooms/:roomId/participants` (body: `{ handle }`) → core `addParticipant(da, operator, { roomId, handle })` (operator pulls in another peer; gated on operator already being a participant).
  - [x] These carry a JSON BODY (unlike 9.6's path-only react) — add minimal request-body parsing to the host (JSON, size-bounded; the core body cap `MAX_BODY_BYTES`/`BODY_TOO_LARGE` still applies in `reply`). Map `BoardError` → status: `BODY_TOO_LARGE` → 413, `ROOM_NOT_FOUND`/`PROJECT_NOT_FOUND` → 404, `NOT_A_MEMBER` (add_participant by a non-participant) → 403, `NO_OPERATOR` (watching host) → 403. Snake_case wire; return the resulting Room/ReactResult/etc.
  - [x] Tests over a real ledger (Rule 3): operator reply → message appears + operator becomes a room participant + sub-board member (verify via roomParticipants/isMember); operator add_participant (after they're a participant) → target added; add_participant by a non-participant operator → 403; reply over the body cap → 413; watching host → 403.

- [x] **Task 2 — `Composer` component + join-gate (ui-shared)** (AC: #1)
  - [x] Author `src/room/Composer.tsx` per DESIGN `components.join-gate-composer`: TWO states only. **not-joined** = a single `[ join room to post ]` button (`--surface-panel` bg, `--border` top). **joined** = `✓ you joined` (`--agreed-green`) + a mono `--surface-input` text field (`--radius-default`) + an `--accent` send button. Prop-driven: `joined` (whether the operator can post here), `onJoin`, `onSend(body)`, pending/disabled states. The composer is the bottom of the Story 9.5 `RoomView` stack (fills the placeholder seam via `composerSlot`).
  - [x] Wire the Story 9.6 `ReactionChip` `canReact` + the `add_participant` affordance to the operator's ROOM-PARTICIPATION state (not just board membership) — see the Design reconciliation below. A non-participant's chip stays the "join to react" handoff (9.6) until participation is established. (RoomView already gates `canReact` on `posture==='peer'`; the composer's `joined` and the chip's `canReact` both flip on real participation.)
  - [x] Export `Composer` from the barrel.

- [x] **Task 3 — apps/web join + post wiring** (AC: #1, #2)
  - [x] Wire the composer: `onJoin` → POST join (see reconciliation — `joinBoard` for immediate membership + reveals the field), `onSend(body)` → POST reply (the message + grant-on-act participation), then refetch the room model so the new post appears, the posture flips to `you: @operator (peer)`, and the 👍/add_participant affordances enable. (Basic refetch is fine — optimistic echo + failure-retry is Story 9.9.)
  - [x] The `＋ join a project…` tree action (Story 9.4 stub) — DISPOSITION: kept as a documented hand-off (a board-picker affordance, distinct from the in-room composer which IS this story's focus). `handleJoinProject` documents the disposition; the composer's `onJoin` wires `joinBoard` for the open room's sub-board.
  - [x] Confirm the operator posts via the SAME core `reply` the MCP clients use (no operator-only path) — the host endpoint calls core `reply` with actor=operator.

- [x] **Task 4 — Tests** (AC: #1, #2)
  - [x] `Composer` DOM tests: not-joined shows ONLY `[ join room to post ]`; clicking join → `✓ you joined` + field + send; typing + send fires `onSend(body)`; empty/whitespace body does not send.
  - [x] apps/web integration (Rule 3): operator opens a room as watching → composer shows join button → join + send a reply → the message appears in the thread authored by the operator handle → posture flips to `you: @operator (peer)` → the 👍 chip become enabled (participation established). This is the **Mode A→B end-to-end proof** (the marquee AC). PLUS host.integration.test.ts drives the BODY-carrying reply over REAL HTTP (the node:http body-parse path).
  - [x] **Same-core proof (AC2):** the operator's post is a real `room.replied` event in the ledger (same event type an agent's reply produces — asserted in json-api.test.ts); apps/web asserts the post goes to the `/api/rooms/:id/reply` endpoint (no operator-only path). Rule 7 mutation-tested: forcing the host reply actor to a literal turns the same-core + grant-on-act tests RED; reverted byte-identical.
  - [x] Discoverable by default `pnpm test` (Rule 8); DOM in happy-dom; no `.only`/`.skip`/`.todo`.

- [x] **Task 5 — Gate**
  - [x] Honest gate: lint 0 / build (all + apps/web) / typecheck 0 / `pnpm test` (green, count up) / format --check. Counts recorded in the Dev Agent Record.

## Dev Notes

### Design reconciliation (Rule 8 — honor the shipped board model; flag to reviewer)

The board (Epics 3–5) has NO standalone "join this ROOM as a participant" op. Room PARTICIPATION (what `react`/`add_participant` gate on, via `roomParticipants`) is GRANTED ONLY by **acting** — `reply` (grant-on-act: a non-member's reply bundles a `board.joined` + `room.replied`, "acting = joining", FR10) or being `add_participant`'d. `joinBoard` joins the SUB-BOARD (membership), which is necessary for posting announcements (Story 3.5 gate) but is NOT room participation.

So the join-gate composer maps to the board as:
- **`[ join room to post ]` → `joinBoard(operator, projectId)`** (the operator becomes a sub-board member; the immediate, no-body "join" the UX wants → `✓ you joined`, posture begins the Mode A→B move).
- **Sending a message → `reply(operator, { roomId, body })`** — the post AND the grant-on-act that makes the operator a ROOM PARTICIPANT (and a member, idempotently). After the first post, `roomParticipants ∋ operator`, so the posture is fully `you: @operator (peer)` and `react`/`add_participant` (which gate on participation) are enabled.
- Therefore the operator's full peer capabilities (👍, add_participant) light up once they are a ROOM PARTICIPANT — i.e. after their first post (reply) or if an agent already `add_participant`'d them. This is EXACTLY the agent rule ("posting requires joining"; acting = joining) — the operator is a peer over the same core, no backdoor.

**This is a reconciliation, not a contradiction:** the epics.md 9.7 AC ("click join → can post, 👍, add_participant as a peer") describes the operator's CAPABILITIES as a peer; the board's grant-on-act model means participation (enabling 👍/add_participant) is established by the act of posting, not by a separate room-join op that doesn't exist. Implement join=joinBoard + post=reply; document this; surface it to the reviewer (per project-rules Rule 8 — a later story's AC reconciled against earlier shipped design). If the reviewer judges the operator should be a room participant the INSTANT they click "join" (before any post), the only board-faithful way is to treat the first send as the join (composer reveals field on click; participation on send) — note that alternative.

### What this story is (and is NOT)

- **IS:** the join-gate `Composer` (two states), the join/reply/add_participant WRITE endpoints (completing the UI write path), the apps/web wiring so the operator joins + posts as a peer over the SAME core, and the Mode A→B posture flip on real participation.
- **IS NOT:** optimistic post echo + reconciliation + inline retry-on-failure (Story 9.9 — a basic refetch after the write is fine here; 9.9 adds the pending/optimistic/retry polish), tabs (9.8), calm-states/voice/a11y (9.10).

### Source facts to VERIFY (Rule 4)

- core `reply(da, actor, {roomId, body})` — does NOT gate on membership; GRANTS participation + membership (acting=joining); applies `MAX_BODY_BYTES`/`BODY_TOO_LARGE`. `joinBoard(da, actor, projectId)` — sub-board membership (plain append, idempotent). `addParticipant(da, actor, {roomId, handle})` — GATES on actor being a room participant (else NOT_A_MEMBER). VERIFIED in core. `react`/`unreact` gate on `roomParticipants` (Story 9.6).
- The host write seam (Story 9.6) established POST dispatch (method-scoped, NO_OPERATOR host-surface code). 9.6's react endpoints are path-only; 9.7 adds body-carrying POSTs (join/reply/add_participant) — add bounded JSON body parsing.
- `RoomView`/`MessagePost` (9.5) has the composer placeholder seam + the posture line; Story 9.6 wired ReactionChip `canReact`. 9.7 fills the composer + drives the participation state.
- DESIGN `components.join-gate-composer` (9.1 tokens): not-joined button / joined ✓ + field + send.

### Smoke (lead-side gate — informational)

Browser smoke: build apps/web, run `agentbbs ui --as <operator>` against a seeded ledger with a room the operator is NOT yet a participant of, drive real Chrome: open the room → composer shows `[ join room to post ]`, posture `you: watching` → click join → `✓ you joined` + field + send → type + send a reply → the operator's message appears in the thread (authored by the operator handle, a real `room.replied`), posture flips to `you: @operator (peer)`, and the 👍 chip becomes enabled (participation established). Confirm the operator used the SAME core reply (the event is a normal reply in the ledger).

### References

- [Source: epics.md#Epic 9 / Story 9.7] — ACs.
- [Source: DESIGN.md — components.join-gate-composer; EXPERIENCE.md — Mode B participate-as-peer, "same rule as agents".]
- [Source: packages/core/src/rooms/reply.ts (grant-on-act), projects/join-board.ts, rooms/add-participant.ts (participant gate), rooms/react.ts (participation gate).]
- [Source: 4-3-…md "acting = joining"/grant-on-act; project-rules Rule 8 (reconcile later-story AC vs shipped design).]
- [Source: 9-6-…md write seam + ReactionChip canReact; 9-5-…md composer seam + posture.]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, BMad dev-story workflow under /epic-cycle).

### Debug Log References

- Honest gate (this machine, Node 24 / pnpm 11.3): **lint 0** / **build** (6 packages tsc -b + apps/web Vite dist all built) / **typecheck 0** (`tsc -p tsconfig.typecheck.json`) / **test 1001 passed (130 files), 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`** / **format `prettier --check .` clean**. Prior post-9.6 baseline was 966 over 129 files; +35 over +1 file (Composer.test.tsx): Composer DOM 8, json-api 9.7 writes 15, host.integration 9.7 4, api-client 9.7 write helpers 5, App.test 9.7 Mode A→B 3.
- Build-before-test ran (forked cross-process workers resolve core via `dist`); this story adds no new core export consumed by a forked worker, but the gate built anyway.

### Completion Notes List

- **AC1 (join-gate composer, two states) MET.** `Composer.tsx` (ui-shared, barrel-exported): not-joined = a single `[ join room to post ]` button; joined = `✓ you joined` (`--agreed-green`) + a mono `--surface-input` field (`--radius-default`) + an `--accent` send. Prop-driven (NFR2 — no core/data-access import); the surface owns the writes. Fills the Story 9.5 RoomView composer seam via `composerSlot`.
- **AC2 (posture flip Mode A→B + same-core participation) MET.** apps/web wires `onJoin`→`postJoin` (joinBoard) + reveals the field; `onSend`→`postReply` (core `reply`, grant-on-act) then refetches → posture flips `you: watching` → `you: @operator (peer)` + the 👍/add_participant affordances enable. The operator's post is a real `room.replied` event (same type an agent produces) — proven over a real ledger; no operator backdoor.
- **WRITE endpoints** (host json-api.ts): `POST /api/projects/:id/join` (joinBoard, path-only), `POST /api/rooms/:id/reply` (`{ body }` → core reply), `POST /api/rooms/:id/participants` (`{ handle }` → addParticipant). BoardError→status: BODY_TOO_LARGE→413, ROOM/BOARD_NOT_FOUND→404, HANDLE_NOT_FOUND→404, NOT_A_MEMBER→403; host-surface NO_OPERATOR→403 (watching host), BAD_REQUEST→400 (missing/malformed body field). snake_case wire.
- **Body parsing (Research-First, Rule 3):** confirmed against Node 24 — `IncomingMessage` is consumed via async iteration (`for await (const chunk of req)`); there is NO `req.json()` on core http, and `stream/consumers` has no size bound, so a custom byte-bounded loop is the idiomatic approach. `server.ts` parses + size-bounds the body (`MAX_REQUEST_BODY_BYTES = MAX_BODY_BYTES + 64 KB` slack) and passes the parsed object into `handleApiRequest` (5th arg); the unit tests call `handleApiRequest` with an object body directly, the integration test drives the real node:http stream. An oversize body is rejected with 413 BEFORE fully buffering (pause + `Connection: close` so the client reliably reads the status — an early `req.destroy()` caused ECONNRESET and was replaced).
- **Rule 8 reconciliation (surfaced to reviewer):** the board has NO standalone "join this ROOM as a participant" op. Room PARTICIPATION (what react/add_participant gate on) is granted ONLY by ACTING — `reply` (grant-on-act, FR10) or being `add_participant`'d. `joinBoard` joins the SUB-BOARD (membership), needed for posting, but is NOT room participation. So `[ join room to post ]`→`joinBoard` (immediate membership + reveals the composer field); SEND→`reply` (the grant-on-act that makes the operator a room participant). The epics.md 9.7 AC ("click join → can post, 👍, add_participant as a peer") describes the operator's CAPABILITIES; the grant-on-act model means participation (enabling 👍/add_participant) is established by the act of POSTING, exactly the agent rule. I implemented the story's named alternative ("treat the first send as the join: composer reveals field on click; participation on send") — clicking join reveals the field (apps/web `joinedIntent`) so the operator can type their first post; that first SEND grants participation and the posture flips to peer. This is a reconciliation, not a contradiction; no contradicting "join room" op and no operator backdoor were invented.
- **Rule 7 mutation-test (non-vacuous):** temporarily forced the host reply route's actor to a literal `'alice'` → the SAME-CORE proof + the grant-on-act participant tests + the add_participant-after-reply gate test went RED (4 failures); reverted byte-identical (`git diff` confirms only `actor` restored) → 51/51 green. The same-core/grant-on-act assertions discriminate, they are not vacuous.
- **Rule 1 / Rule 3 (real-runtime evidence):** host write endpoints tested over a real in-memory createDataAccess ledger (nothing mocked); the body-carrying reply tested over REAL HTTP (`fetch` POST + JSON body → node:http body parse → core reply → SQLite); the Composer + the App Mode A→B flow tested in real happy-dom (observable DOM). NFR2 boundary held: Composer is prop-driven (no core/data-access import); apps/web speaks only the JSON API.
- **Rule 5 (NFR tripwire):** none — NFR2 implementable as worded, no planning-artifact amendment.
- **Rule 6 (ADR):** N/A — `docs/adr/` has no ADRs.
- NOT built (out of scope, per Dev Notes): optimistic echo/reconciliation/inline retry (9.9 — basic refetch only here; a `pending` disabled state is the extent of write-in-flight handling), tabs (9.8), calm-states/voice/a11y (9.10).

### File List

- `packages/cli/src/host/json-api.ts` (modified — 3 write routes + `RequestBody`/`requireBodyString` + `body` param on `handleApiRequest`)
- `packages/cli/src/host/server.ts` (modified — `readRequestBody` async-iteration body parse + size bound; `MAX_REQUEST_BODY_BYTES`; wire parsed body into the POST dispatch)
- `packages/cli/src/host/json-api.test.ts` (modified — +15 9.7 write-endpoint tests over a real ledger, incl. the same-core proof)
- `packages/cli/src/host/host.integration.test.ts` (modified — +4 body-carrying reply tests over real HTTP)
- `packages/ui-shared/src/room/Composer.tsx` (new — the two-state join-gate composer)
- `packages/ui-shared/src/room/Composer.test.tsx` (new — +8 Composer DOM tests)
- `packages/ui-shared/src/index.ts` (modified — export `Composer` + `ComposerProps`)
- `apps/web/src/api-client.ts` (modified — `postJoin`/`postReply`/`postAddParticipant` + `postJsonBody` + response types)
- `apps/web/src/api-client.test.ts` (modified — +5 write-helper tests)
- `apps/web/src/App.tsx` (modified — Composer wiring: `joinedIntent`/`composerPending` state, `handleJoinRoom`/`handleSendMessage`, `composerSlot`)
- `apps/web/src/App.test.tsx` (modified — +3 Mode A→B end-to-end + same-core tests)
- `_bmad-output/implementation-artifacts/9-7-join-gate-composer-and-participate-as-peer.md` (this story — frontmatter baseline, task checkboxes, Dev Agent Record, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story status ready-for-dev → in-progress → review)

### Change Log

- 2026-06-01 — Story 9.7 implemented: join-gate Composer (two states) + the join/reply/add_participant WRITE endpoints (completing the UI write path) + apps/web participate-as-peer wiring (Mode A→B posture flip on real participation). Implements the Rule 8 reconciliation (join=joinBoard, post=reply/grant-on-act; first-send-grants-participation) — documented + surfaced. Honest gate green: lint 0 / build / typecheck 0 / test 1001 (130 files) / format clean. Status → review.

## Review Findings

**Code review (2026-06-01) — APPROVED. 0 HIGH / 0 MED / 0 LOW-blocking / 0 deferred. Both ACs met.**

Reviewer re-ran the honest gate GREEN: **lint 0** (changed prod files) / **typecheck 0** (`tsc -p tsconfig.typecheck.json`, exit 0) / **full `pnpm test` 1007 passed (130 files), 0 failed / 0 skipped**, no `.only`/`.skip`/`.todo` in the new test files. Changeset's 5 test files: 111 passed.

- **AC1 (join-gate composer, two states): MET.** `Composer.tsx` has exactly two states — not-joined = single `[ join room to post ]` button (no field/send); joined = `✓ you joined` + mono field + accent send. DOM tests pin both, the empty/whitespace no-send, and pending-disable. Read is open (GET routes ungated); posting requires joining over the same core.
- **AC2 (posture flip + same-core): MET.** Posture is driven by `room.operatorPosture.kind === 'peer'`, computed by the surface from the REAL `participants` list on `/api/rooms/:id` (App.test stateful stub proves the flip happens ONLY after the reply POST adds `ops` to `participants` — not from `joinedIntent`). The operator's post is a real `room.replied` event, proven over a real ledger (json-api same-core test) and real HTTP (integration). No operator-only write path.

**Rule 8 reconciliation (the key judgment) — SOUND.** Verified in core that the board genuinely has no standalone "join room as participant" op: `joinBoard`=sub-board membership; `reply`/`addParticipant`=grant-on-act room participation. The dev's mapping ([join]→`joinBoard`+reveal-field, SEND→`reply`/grant-on-act) is faithful to the shipped Epics 3–5 model and to the agent rule ("acting = joining"). The posture flip is driven by REAL participation (`roomParticipants` via the envelope), NOT a local-only flag — `joinedIntent` only reveals the field locally; it does NOT fake the peer posture. Documented in json-api.ts header, Composer.tsx, App.tsx + the Dev Agent Record. Not a contradiction, not a backdoor.

**CRITICAL-focus verification:**
- **Body parsing / 413:** Host bound (`MAX_BODY_BYTES + 64KB`) is ABOVE the core cap, so over-core-under-host bodies REACH core for the CONTRACT `BODY_TOO_LARGE` (integration test asserts 413 + `maxSeq` unchanged). Over-host-bound → readable 413 via `req.pause()` + `Connection: close` (the no-ECONNRESET test proves `.json()` resolves cleanly — a reset would reject). Malformed → 400. No unbounded buffering (`totalBytes` checked per chunk, stops at the bound); no socket leak.
- **add_participant gate:** Non-participant operator → 403 NOT_A_MEMBER (core gate, nothing appended); watching host → 403 NO_OPERATOR (host-surface, before core). Both proven over real HTTP.
- **Module boundary (NFR2):** `Composer` prop-driven, no core/data-access import; core + mcp-server + data-access byte-unchanged (`git diff HEAD` empty); apps/web speaks only the JSON API.
- **Body-cap contract:** `reply` still enforces `MAX_BODY_BYTES`/`BODY_TOO_LARGE` unchanged; the host did not weaken it.
- **Rule 10 (contract drift):** core + MCP byte-unchanged; `NO_OPERATOR`/`BAD_REQUEST` correctly kept OUT of `BOARD_ERROR_CODES` (host-surface codes), preserving the agent-facing closed contract.
- **Rule 7 (reviewer-confirmed non-vacuous):** independently mutated the host reply route's actor → literal `'alice'`; 7 tests went RED (the same-core proof, grant-on-act participant tests, add_participant-after-reply gate). Reverted byte-identical (`'alice'` grep = 0; the 142-line diff stat matches the original). The same-core/grant-on-act assertions discriminate.
- **Rules 1 & 3:** host write endpoints over a real in-memory ledger; the body-carrying reply over REAL HTTP (`fetch` POST → node:http parse → core → SQLite); Composer + App Mode A→B in real happy-dom DOM.

**LOW observations (non-blocking, NOT deferred):**
1. A whitespace-only `handle` to add_participant passes `requireBodyString` (non-empty) and reaches core → `HANDLE_NOT_FOUND` (404). Behaviorally correct (no bad append); just a valid-but-different status. Not a defect.
2. `postAddParticipant` ships endpoint+helper tested at the API/host layer; the in-room UI button for it is not in this story's composer (story scopes the add_participant capability to "lights up after first reply"). Endpoint is consumer-ready; consistent with stated scope.

Rules 5, 6 N/A (NFR2 implementable as worded; `docs/adr/` has no ADRs). Left UNCOMMITTED for the lead's post-CR smoke gate.
