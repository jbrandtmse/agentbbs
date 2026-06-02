---
baseline_commit: d268db8
---

# Story 7.1: Document the Negotiation Protocol

Status: review

## Story

As an outside developer or agent author,
I want a documented Negotiation Protocol,
So that everyone follows the same propose → counter → ratify → frozen ritual.

## Acceptance Criteria

1. **Given** the repo,
   **When** I open `docs/negotiation-protocol.md`,
   **Then** it states the FOUR moves — **Propose**, **Counter**, **Ratify (via 👍)**, **Frozen (= the latest 👍'd message is the contract)** — each mapped to the concrete board tool that performs it: Propose/Counter = `reply` (a message in a room), Ratify = `react` 👍 on a message (retract = `unreact`), Frozen/the current contract = computed by `read_contract` (the highest-`seq` live-👍'd message, FR21),
   **And** it states the ESCALATION guidance: pull the operator in when stuck (the operator is a peer who can dial in via global read and act / nudge — the pull-only dead-letter backstop).

2. **Given** the doc,
   **When** I read it,
   **Then** it makes EXPLICIT that the board ENFORCES NONE of the protocol — it is a CONVENTION (the tools are unopinionated; `read_contract` mechanically computes "the latest 👍'd message" but the board never validates that a negotiation followed the ritual), so adoption is by convention + the Epic 8 cadence/prompt, not by enforcement.

3. **Given** the doc is open-source-ready (NFR8),
   **When** it is published,
   **Then** it is cross-linked from the README + the tool contract (`docs/mcp-tool-contract.md`), and a CONTENT-GUARD test asserts the doc contains the four moves + the tool mappings + the "convention / not enforced" statement (so the protocol doc can't silently lose a move or drift from the tools).

## Review Findings

**Code review (2026-05-31) — APPROVED. Clean review: 0 HIGH / 0 MED / 0 decision-needed / 0 defer / 0 dismiss.** Proportionate review of a DOC + content-guard changeset with ZERO production-logic change. No files modified by the reviewer (no inaccuracy found); no new deferred items (a doc-only story introduces none — the Epic-7 contract-pinning items `E3-tool-names` / `4.5-tool-label` were already resolved at Story 7.0).

1. **ZERO production-logic change — CONFIRMED.** `git diff` vs baseline `d268db8`: tracked changes are only `README.md`, `docs/mcp-tool-contract.md`, `cycle-log-epic-7.md`, `sprint-status.yaml`; untracked are `docs/negotiation-protocol.md` (new), `packages/mcp-server/src/negotiation-protocol-doc.test.ts` (new), this story file. The ONLY `.ts` touched anywhere is the `*.test.ts` content guard — NO non-test `*.ts` under `packages/*/src/`. APPEND INVARIANT untouched (no new tool / event / error code / ledger change).

2. **Protocol accuracy — independently verified against shipped source (Rule 4).** Every move→tool mapping confirmed against the code, not just the contract doc:
   - **Propose / Counter = `reply`** — `packages/core/src/rooms/reply.ts:112` appends `room.replied` (always) + conditional `board.joined` auto-join (grant-on-act); first reply activates the proto-room. Doc §2 + §5 example accurate.
   - **Ratify = `react` / `unreact`** — `packages/core/src/rooms/react.ts:131` (reacted) / `:176` (unreacted); liveness is per-actor latest-wins (`reactions.ts:84-87` `latestByActor`, `live = type === 'message.reacted'`); retract affects only the actor's own 👍 (structural). Doc "live until retracted / only your own 👍" accurate.
   - **Frozen = `read_contract` (FR21)** — `packages/core/src/rooms/contract.ts:70-76` `currentContract` walks messages from the HIGHEST `seq` down and returns the first holding ≥1 live reactor, else `null`; COMPUTED every call, NEVER stored; reversion-on-retract is emergent recomputation. The doc does NOT mischaracterize the contract as "most 👍s" or a stored freeze — it states "the highest-`seq` message currently holding a live 👍 ... computed every call ... reverts on retraction" (§2, §4) — exactly the shipped semantic.
   - **Convention-not-enforced + escalation** — doc §4 ("the board enforces none of the Negotiation Protocol ... it is a convention ... `read_contract` mechanically computes ... it never validates the ritual") and §3 (pull the operator in; global-read FR9 peer; the pull-only dead-letter backstop) match `docs/pull-only-delivery.md` §4–§5. Cross-doc anchors (`#4-the-accepted-pull-only-dead-letter-nfr11`, `#5-where-this-lives-in-the-code`) resolve.

3. **Content guard NON-VACUOUS — mutation-tested (Rule 7).** Ran the 4-test guard against four deliberately-mutated copies of the doc (doc restored after each); each mutation fails exactly its corresponding test and nothing else:
   - drop a move (`Frozen`→`Settled`) → "names all four protocol moves" FAILS ✓
   - drift a mapping (`read_contract`→`get_contract`) → "maps each move to its shipped tool" FAILS ✓
   - remove the enforcement disclaimer → "states EXPLICITLY ... convention (AC #2)" FAILS ✓
   - **FR21 mischaracterization** (`highest-`seq``→`most 👍s`) → the QA-added "pins the FR21 contract semantic" test FAILS with its intended message ✓ (the load-bearing claim the prompt flagged — confirmed genuinely caught).

4. **Cross-links — CONFIRMED.** `README.md:74` (Key-concepts "Negotiation Protocol" row) and `docs/mcp-tool-contract.md:17-20` (companion-docs note, correctly summarizing the four moves + mappings + "enforces none of") both link to `docs/negotiation-protocol.md`.

5. **Full gate — GREEN end-to-end (honest order lint → build → typecheck → test → format):** lint 0 errors / build 7-7 packages / typecheck 0 errors / **test 622 passed (90 files), 0 failed / 0 skipped** (no `.only`/`.skip`/`.todo`) / `prettier --check` clean. Count matches QA's 622/90 (618 Story-7.0 baseline + 3 dev content-guard + 1 QA FR21 pin = 622).

Adversarial layers (proportionate, run inline for a zero-production-logic doc change): Blind Hunter — 0 correctness issues (path resolution + both regexes verified, no false-green); Edge Case Hunter — 0 actionable (the prose-tolerant presence checks are deliberate per the test's own comments; a *complete* mischaracterization is caught, proven by M4); Acceptance Auditor — 0 AC violations (all 3 ACs satisfied). Rules 1/3/5/6 N/A (doc + content-guard, no NFR, no `docs/adr/`); Rule 4 satisfied (move→tool mapping verified against code); Rule 7 satisfied (content guard mutation-tested non-vacuous). Left UNCOMMITTED (incl. no dist) for the lead's post-CR smoke gate.

## Tasks / Subtasks

- [x] Task 1: Author `docs/negotiation-protocol.md` (Appendix A) (AC: #1, #2)
  - [x] State the four moves with their tool mappings:
    - **Propose** — post a proposal as a `reply` in a room (a CommonMark message; the room's seeding `announcement.posted` is the original need / message #1).
    - **Counter** — post an alternative as another `reply` (counters are ordinary messages; the negotiation is the ordered `read_room` history).
    - **Ratify** — `react` 👍 on the message you agree to (retract with `unreact`; a 👍 is live until you retract it — Story 5.2).
    - **Frozen** — the current contract is the **highest-`seq` message currently holding a live 👍**, computed by `read_contract` (FR21, Story 5.3); it reverts automatically if that 👍 is retracted. "Frozen" = the agreed terms an agent can mechanically locate; there is no separate "freeze" action.
  - [x] State the escalation guidance: when a negotiation is stuck (no convergence, or a needed peer never dials in — the pull-only dead-letter), pull the OPERATOR in. The operator is a peer (global read, FR9) who can dial in, read the room/contract, and act or nudge (the documented dead-letter backstop — cross-ref `docs/pull-only-delivery.md`).
  - [x] State EXPLICITLY (AC #2): the board ENFORCES NONE of this — it is a CONVENTION. The tools are unopinionated; `read_contract` mechanically computes the latest live-👍'd message but never validates the ritual. Adoption is by convention + the Epic 8 cadence hook + the agent-prompt snippet (Story 7.3), not enforcement.
- [x] Task 2: Content-guard test + cross-links (AC: #3)
  - [x] Add a lightweight content-guard test (`packages/mcp-server/src/negotiation-protocol-doc.test.ts`) that reads `docs/negotiation-protocol.md` and asserts it contains: the four move names (Propose, Counter, Ratify, Frozen), the tool mappings (`reply`, `react`, `unreact`, `read_contract`), and the explicit "convention" / "enforce"-none statement. (A simple substring/section presence check — so a future edit can't silently drop a move or the convention disclaimer.)
  - [x] Cross-link `docs/negotiation-protocol.md` from the README and from `docs/mcp-tool-contract.md` (the protocol is the recommended USE of the contract's tools).
- [x] Task 3: Full gate (AC: #3)
  - [x] Run lint → build → typecheck → test → format (`--check`). All green. Final count: 621 (618 baseline after Story 7.0 + 3 content-guard tests).

## Dev Notes

This is a DOCUMENTATION story — `docs/negotiation-protocol.md` (Appendix A, FR25). It documents the CONVENTION (the four moves) over the existing tools (`reply`/`react`/`unreact`/`read_contract`); NO new tool/event/error code/production-logic. A content-guard test keeps the doc from silently drifting from the tools.

**Rule 1 (Integration ACs):** N/A — documentation of a convention over existing tools.
**Rule 3 (real-runtime evidence):** N/A for a doc (the content-guard test is the verification that the doc is complete).
**Rule 4 (verify source-facts):** the move→tool mapping (`reply`/`react`/`unreact`/`read_contract`) reflects the SHIPPED Epic 4/5 tools — verify the tool names + the contract semantics (`read_contract` = highest-`seq` live-👍'd, FR21) against `docs/mcp-tool-contract.md` + the code.
**Rule 5 / Rule 6:** N/A (no NFR; no `docs/adr/`).

### Source facts (verified at story creation, baseline `d268db8`)

- **The four moves map to shipped tools:** Propose/Counter = `reply` (Story 4.3, `room.replied`); Ratify = `react` 👍 / `unreact` (Story 5.2, `message.reacted`/`message.unreacted`); Frozen/contract = `read_contract` (Story 5.3 — highest-`seq` message with a live 👍, FR21, reverts on retraction). All ratified in `docs/mcp-tool-contract.md` (Story 7.0).
- **Escalation backstop** is the pull-only dead-letter (`docs/pull-only-delivery.md`, Story 6.2): the operator is a peer (global read, FR9) who can dial in and act when a negotiation is stuck or a need is undelivered.
- **Convention-not-enforced:** the board never validates the ritual; `read_contract` mechanically computes the contract; adoption is by convention + Epic 8 (cadence hook + the agent-prompt snippet, Story 7.3, `integration/bmad/`).
- **Docs:** `docs/` holds `append-invariant-checklist.md`, `pull-only-delivery.md`, `mcp-tool-contract.md`. Add `negotiation-protocol.md`. README + the tool contract are the cross-link points.
- Toolchain (Epics 1–7): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers).

### Project Structure Notes

- New `docs/negotiation-protocol.md` + README + tool-contract cross-links; one content-guard test. NO production-logic change, NO new tool/event/error code.
- The protocol is a CONVENTION layered on the already-complete tool surface — Story 7.2 seeds it as a main-board announcement; Story 7.3 ships the agent-prompt snippet; Epic 8 wires the cadence.

## Dev Agent Record

### Context Reference

- Story file (this file), `docs/mcp-tool-contract.md` (the ratified Epic 2–6 tool surface, Story 7.0), `docs/pull-only-delivery.md` (the escalation/dead-letter backstop, Story 6.2), `README.md`, `_bmad-output/project-context.md`, `_bmad/custom/skill-rules.md`.

### Implementation Plan

DOCUMENTATION story — no production-logic, no new tool/event/error code. Three tasks:

1. Author `docs/negotiation-protocol.md` (FR25, Appendix A) — the four moves mapped to the shipped tools, the escalation guidance, and the explicit "board enforces none of it — it is a convention" caveat. House style mirrors `docs/pull-only-delivery.md` / `docs/mcp-tool-contract.md` (TL;DR blockquote, Audience line, numbered `##` sections, a "Where this lives in the code" table).
2. Content-guard test `packages/mcp-server/src/negotiation-protocol-doc.test.ts` — reads the doc and asserts presence of the four move names + four tool mappings + the convention/not-enforced statement. Cross-link the doc from README + `docs/mcp-tool-contract.md`.
3. Full gate (lint → build → typecheck → test → format --check).

### Source-fact verification (Rule 4)

Verified the move→tool mapping against `docs/mcp-tool-contract.md` AND the code before documenting (the mapping reflects the SHIPPED Epic 4/5 tools):

- **Propose / Counter = `reply`** — `EVENT_TYPES` contains `room.replied` (`packages/core/src/events/types.ts:32`); core op `packages/core/src/rooms/reply.ts` appends `room.replied` (+ conditional `board.joined` auto-join). Tool `reply` documented in `docs/mcp-tool-contract.md` §3/§6.
- **Ratify = `react` 👍 / retract = `unreact`** — `EVENT_TYPES` contains `message.reacted` / `message.unreacted` (`types.ts:34-35`); both appended by `packages/core/src/rooms/react.ts` (`react.ts:131` reacted / `:176` unreacted; idempotent, latest-wins, per-actor liveness). Tools `react` / `unreact` in §3/§6.
- **Frozen / contract = `read_contract` (FR21)** — `currentContract(events, roomId)` in `packages/core/src/rooms/contract.ts` returns the HIGHEST-`seq` message holding ≥1 live 👍 (or `null`), COMPUTED every call, NEVER stored; reversion-on-retract is emergent recomputation (no stored state). Confirmed against `docs/mcp-tool-contract.md` §3 (`read_contract`) + §5 derived-state note.
- **Escalation backstop** — the operator is a peer with global read (FR9) + the pull-only dead-letter, per `docs/pull-only-delivery.md` §4. Cross-referenced, not re-stated.

Note: §6 code-path table initially drafted `packages/core/src/messaging/react.ts` / `reply.ts`; corrected to the real paths — both core ops live under `packages/core/src/rooms/` (`react.ts`, `reply.ts`), verified by glob. No source-fact was coded against a stale path.

### Completion Notes

- **Authored `docs/negotiation-protocol.md`** (FR25 / Appendix A, NFR8 open-source-ready): the four moves (**Propose** / **Counter** = `reply`; **Ratify** = `react` 👍 / `unreact`; **Frozen** = `read_contract`, the highest-`seq` live-👍'd message, FR21, reverts on retraction — no separate "freeze" action), the escalation guidance (pull the operator in when stuck; the operator is a peer via global read FR9, the pull-only dead-letter backstop — cross-ref `docs/pull-only-delivery.md`), and the EXPLICIT load-bearing caveat that the board ENFORCES NONE of it — it is a CONVENTION (`read_contract` mechanically computes the contract but never validates the ritual; adoption is by convention + the Epic 8 cadence hook + the Story 7.3 prompt snippet). Includes a worked Propose→Counter→Ratify→Frozen example and a code-path reference table.
- **Content-guard test** `packages/mcp-server/src/negotiation-protocol-doc.test.ts` (3 tests): reads the doc and asserts (1) all four move names present, (2) all four tool mappings (`reply`/`react`/`unreact`/`read_contract`) present, (3) the explicit "convention" + "enforce(s) none / not enforced" + "computed" statements present — each with a clear failure message so a future edit cannot silently drop a move, a mapping, or the disclaimer. Presence checks (not exact-text) so prose can be reworded freely. Path resolution mirrors `tool-contract.drift.test.ts` (`import.meta.url` → repo root → `docs/`). This is a content guard (a documentation convention), NOT a code drift guard — there is no runtime "moves" list to compare against; the code-surface drift guard remains `tool-contract.drift.test.ts`.
- **Cross-links** added: README Key-concepts "Negotiation Protocol" row → `docs/negotiation-protocol.md`; `docs/mcp-tool-contract.md` companion-docs note → `docs/negotiation-protocol.md` (the recommended USE of the contract's tools).
- **NO production code, NO new tool/event/error code, NO ledger change** — THE APPEND INVARIANT untouched (a doc + a content-guard test only). Rules 1/3/5/6 N/A as scoped in Dev Notes.

### Validation — full gate (all green)

- **lint** (`pnpm run lint`) — 0 errors.
- **build** (`pnpm run build`) — 7/7 packages built (build-before-test for the forked workers).
- **typecheck** (`pnpm run typecheck`) — 0 errors.
- **test** (`pnpm test`) — **621 passed (90 files)**, 0 failed / 0 skipped (no `.only`/`.skip`/`.todo`). 618 baseline (after Story 7.0) + 3 new content-guard tests = 621.
- **format** (`pnpm run format` = `prettier --check .`) — clean, all matched files (incl. the new doc + test + edited README / `mcp-tool-contract.md`).

### File List

- `docs/negotiation-protocol.md` (new) — the Negotiation Protocol doc (FR25, Appendix A).
- `packages/mcp-server/src/negotiation-protocol-doc.test.ts` (new) — content-guard test (3 tests).
- `README.md` (modified) — cross-link the protocol doc from the Key-concepts row.
- `docs/mcp-tool-contract.md` (modified) — cross-link the protocol doc from the companion-docs note.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — story 7-1 status ready-for-dev → in-progress → review; `last_updated` note.
- `_bmad-output/implementation-artifacts/7-1-document-the-negotiation-protocol.md` (modified) — this file (task checkboxes, Dev Agent Record, Status).

### Change Log

| Date | Change |
|---|---|
| 2026-05-31 | Story 7.1 implemented: authored `docs/negotiation-protocol.md` (four moves → shipped tools, escalation, convention-not-enforced caveat), added content-guard test, cross-linked from README + tool contract. Full gate green (621 tests). Status → review. |
