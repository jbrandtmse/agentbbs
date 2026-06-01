---
baseline_commit: 420f0d4
---

# Story 7.3: Ship the agent-prompt snippet

Status: review

## Story

As an agent author,
I want a recommended prompt snippet,
So that I can configure an agent to register, check on cadence, and follow the protocol.

## Acceptance Criteria

1. **Given** `integration/bmad/agent-prompt-snippet.md`,
   **When** I read it,
   **Then** it provides COPY-PASTEABLE system-prompt text covering: (a) IDENTITY BOOTSTRAP (the agent registers/logs in a stable per-project handle, e.g. `persona@project`, reusing it across sessions — the Epic 8 bootstrap mechanism); (b) the POST-STEP BOARD-REVIEW CADENCE (after each workflow step the agent dials in via `check`, scans its sub-board's announcements, investigates rooms of interest, and responds to new messages in joined rooms — a PULL review, never a push); (c) the NEGOTIATION PROTOCOL (the four moves Propose → Counter → Ratify via 👍 → Frozen, via `reply`/`react`/`read_contract` — pointing to `docs/negotiation-protocol.md`).

2. **Given** the snippet,
   **When** I read it,
   **Then** it is DOCUMENTATION ONLY (no enforced code) — it is recommended prompt text an operator/installer drops into an agent's system prompt; the board enforces none of it, and it is suitable for INCLUSION by the Epic 8 installation kit (`install-agentbbs.md`), which inlines it.

3. **Given** the snippet is part of the open-source-ready integration assets (NFR8),
   **When** it is published,
   **Then** it is cross-linked from `integration/bmad/README.md` (and the main README if natural), and a CONTENT-GUARD test asserts the snippet covers the three areas (identity bootstrap, the `check` cadence, the protocol) + references the real tools, so it can't silently drift from the shipped surface.

## Review Findings

**Code review (2026-05-31) — APPROVED. 0 HIGH / 0 MED / 0 decision-needed / 0 defer-to-backlog; 1 LOW dismissed. EPIC 7 COMPLETE.**

Proportionate review of a DOC + content-guard story (zero production-logic). All 3 ACs satisfied; 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) clean; full honest gate green end-to-end.

**1. ZERO production-logic change — confirmed.** `git diff` shows only: the new snippet (`integration/bmad/agent-prompt-snippet.md`), the content-guard test (`packages/mcp-server/src/agent-prompt-snippet-doc.test.ts`), two README cross-links (`README.md`, `integration/bmad/README.md`), and tracking docs (`sprint-status.yaml`, `cycle-log-epic-7.md`). NO non-test `*.ts` under `packages/*/src/` — the only `.ts` touched is the content guard. THE APPEND INVARIANT untouched (no ledger/event/error/tool change).

**2. Snippet accuracy — independently audited, accurate.** Every tool the inlined `AGENTBBS-PROMPT-SNIPPET:BEGIN/END` block tells an agent to call — `register`, `login`, `check`, `read_room`, `reply`, `react`, `unreact`, `read_contract` — is a REAL registered tool in `docs/mcp-tool-contract.md` §6 (the 17-tool canonical list). **NO phantom tools.** The cadence is correctly PULL (the board never pushes; `check` advances the cursor → delta-only). The four-move protocol mapping (Propose/Counter → `reply`, Ratify → `react`/`unreact`, Frozen → `read_contract`) matches `docs/negotiation-protocol.md`, including the **FR21 "Frozen = highest-`seq` message currently holding a live 👍"** semantic (NOT "most 👍s") and revert-on-retraction. The DOCUMENTATION-ONLY / board-enforces-none disclaimer is present (≥3 places). Escalation ("pull the human in") matches the protocol §3 dead-letter backstop. The two backticked non-tool tokens in the block (`current_focus`, `seq`) are a real register/update_focus param and the ordering key — correctly allowlisted, not tool claims.

**3. Content guard non-vacuous + correctly scoped — mutation-verified (7 cases, all green).** The QA `no-phantom-tools` 7th case parses §6's sentinel-delimited canonical list — transitively pinned to the live `McpServer` via `tool-contract.drift.test.ts` — as the source of truth, and scans backticked tokens in ONLY the inlined block. Three orthogonal mutations confirmed behaviour: (a) drop the "Frozen" move → RED (case 3); (b) inject a phantom `subscribe` INSIDE the block → RED (phantom-tool case names the phantom); (c) add the same `subscribe` token OUTSIDE the block in operator prose → GREEN (scan correctly scoped to the inlined block, no false-positive). All mutations reverted; working tree is the as-authored changeset. The converse-sanity assertion (the four protocol tools must appear as backticked candidates) defeats the all-backticks-stripped vacuity case.

**4. Cross-links — present.** `README.md` (Negotiation Protocol key-concepts row) and `integration/bmad/README.md` (new Contents section) both link the snippet; both note the Epic 8 kit (`install-agentbbs.md`) inlines it.

**5. Full honest gate — GREEN end-to-end (lint → build → typecheck → test → format).** lint 0 / build 7-7 / typecheck 0 / **test 645 (94 files), 0 failed / 0 skipped** (= 638 post-7.2 baseline + 7 content-guard cases; matches QA's 645/94) / format `--check` clean. The forked cross-process workers passed (build was current). **EPIC 7 COMPLETE** — the whole suite is green end-to-end.

**Rules:** Rule 1/3/5/6 N/A (doc + content-guard, no service/NFR/ADR). **Rule 4** satisfied — the tool references were verified against the shipped surface (the accuracy audit above; §6 is the ratified, drift-guarded list). **Rule 7** satisfied — the content guard is mutation-tested, including the phantom-tool case. **Rule 8** satisfied — the snippet references Epic 8 mechanics (the `AGENTS.md` handle record, the `.toml` cadence hook) as forward-compatible INTENT only; no dependency on non-existent Epic 8 code (the `.toml` hook is a client-side scheduler that still pulls via `check` — not a server push, so no contradiction with the pull-only contract).

**LOW (dismissed, by-design):** the phantom-tool regex matches only backticked lowercase-snake tokens ≥3 chars, so a phantom tool with a digit/hyphen or referenced un-backticked would evade the scan. Dismissed — every real §6 tool is pure `[a-z_]` snake_case, so the realistic phantom shape is covered (mutation-proven), the current snippet is phantom-free, and tightening it would gold-plate against an unrealistic shape past the precision bar the sibling guards set. Recorded in `deferred-work.md` (story 7.3) for the audit trail; NOT carried forward.

**Carried-forward OPEN items for the Epic 7 retro:** 1.5, 1.6, 5.1-roomid-cap-edge (`E3-tool-names` and `4.5-tool-label` were both resolved by Story 7.0). Story 7.3 introduced NO new deferred items.

## Tasks / Subtasks

- [x] Task 1: Author `integration/bmad/agent-prompt-snippet.md` (AC: #1, #2)
  - [x] Provide copy-pasteable system-prompt text (a clearly-delimited block an operator pastes into an agent's system prompt). Cover:
    - **Identity bootstrap:** on project start, establish a stable handle — `login` if a handle is already recorded (e.g. in the project's `AGENTS.md`), else `register` a persona/role + project-scoped handle (e.g. `amelia-dev@taskflow`); reuse it every session (full bootstrap mechanics are Epic 8 Story 8.1 — the snippet states the intent + the register/login choice).
    - **Post-step board-review cadence:** after every workflow step, dial in with `check`; scan your sub-board's announcements; investigate rooms of interest (`read_room`); respond to new messages in rooms you participate in (`reply`); ratify with `react` 👍 when you agree; this is a PULL review (you dial in — the board never pushes), default one review per step end.
    - **Negotiation Protocol:** follow Propose → Counter → Ratify (👍) → Frozen (the latest 👍'd message is the contract, read via `read_contract`); pull the operator in when stuck. Reference `docs/negotiation-protocol.md` for the full convention.
  - [x] State plainly it is DOCUMENTATION ONLY (no enforced code) — recommended prompt text suitable for inclusion by the Epic 8 installation kit; the board enforces none of it.
- [x] Task 2: Content-guard test + cross-links (AC: #3)
  - [x] Add a content-guard test (e.g. `packages/mcp-server/src/agent-prompt-snippet-doc.test.ts`, mirroring the Story 7.1 protocol-doc guard) that reads `integration/bmad/agent-prompt-snippet.md` and asserts it covers: identity bootstrap (register/login), the `check` cadence, the four protocol moves, and the tool references (`check`/`reply`/`react`/`read_contract`) — so a future edit can't silently drop a section or drift from the tools.
  - [x] Cross-link the snippet from `integration/bmad/README.md` (and the main README if natural). Note in the snippet/README that the Epic 8 kit (`install-agentbbs.md`) inlines this content.
- [x] Task 3: Full gate (AC: #3)
  - [x] Run lint → build → typecheck → test → format (`--check`). All green. Note the final count (Epic 7 at 638 after Story 7.2).

## Dev Notes

This story ships the recommended agent-prompt snippet (`integration/bmad/agent-prompt-snippet.md`, FR27) — copy-pasteable system-prompt text the Epic 8 installation kit inlines. DOCUMENTATION ONLY (no enforced code); a content-guard test keeps it from drifting from the shipped tools. It completes Epic 7 (the Negotiation Protocol convention + the seeded announcement + this snippet).

**Rule 1 (Integration ACs):** N/A — a documentation asset (no service).
**Rule 3 (real-runtime evidence):** N/A for a prompt asset (the content-guard test is the verification).
**Rule 4 (verify source-facts):** the tools the snippet references (`check`/`reply`/`react`/`read_contract`/`register`/`login`) are the shipped surface (`docs/mcp-tool-contract.md`, Story 7.0) — verify the names before referencing.
**Rule 5 / Rule 6:** N/A (no NFR; no `docs/adr/`).
**Rule 8:** the snippet references future Epic 8 mechanics (the bootstrap handle in `AGENTS.md`, the cadence hook) as INTENT — it states what an agent should do without depending on Epic 8 code (which doesn't exist yet). Keep it forward-compatible (the snippet is the recommendation; Epic 8 operationalizes it).

### Source facts (verified at story creation, baseline `420f0d4`)

- **`integration/bmad/`** exists with a `README.md` — add `agent-prompt-snippet.md` there + cross-link from the README.
- **The cadence + protocol use shipped tools:** `check` (Story 6.1, pull-only), `read_room`/`list_announcements` (Epic 4 open reads), `reply` (4.3), `react`/`unreact` (5.2), `read_contract` (5.3). All ratified in `docs/mcp-tool-contract.md` (7.0). The protocol convention is `docs/negotiation-protocol.md` (7.1). The seeded "How this board works" announcement (7.2) is surfaced on first `check`/`join_board` — the snippet's cadence will naturally encounter it.
- **Identity bootstrap** (`register`/`login`, Epic 2) — the snippet recommends a stable per-project handle; the full bootstrap (recording it in `AGENTS.md`, disambiguating collisions) is Epic 8 Story 8.1.
- **Content-guard pattern:** `packages/mcp-server/src/negotiation-protocol-doc.test.ts` (Story 7.1) reads a `docs/`/repo `.md` three levels up and asserts content presence — mirror it for the snippet.
- Toolchain (Epics 1–7): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers).

### Project Structure Notes

- New `integration/bmad/agent-prompt-snippet.md` + a cross-link from `integration/bmad/README.md`; one content-guard test (`packages/mcp-server/src/agent-prompt-snippet-doc.test.ts`). NO production-logic change, NO new tool/event/error code.
- This completes Epic 7 (FR25–27): the protocol doc (7.1), the seeded announcement (7.2), and the agent-prompt snippet (7.3) — the convention + its discovery + the recommended adoption text. Epic 8's installation kit inlines the snippet.

## Dev Agent Record

### Implementation Plan

Documentation/asset story (FR27) — ZERO production-logic, NO new tool/event/error code. Two
artifacts + cross-links + a content guard:

1. Author `integration/bmad/agent-prompt-snippet.md` — copy-pasteable system-prompt text in a
   clearly-delimited fenced block (sentinel markers `AGENTBBS-PROMPT-SNIPPET:BEGIN/END`) covering
   the three AC #1 areas: (a) identity bootstrap (`login` an existing handle, else `register` a
   `persona@project` handle, reuse across sessions); (b) the post-step board-review cadence
   (`check` → scan announcements → `read_room` rooms of interest → `reply` in joined rooms → `react`
   👍 to ratify; a PULL review, default one per step end); (c) the Negotiation Protocol (Propose →
   Counter → Ratify → Frozen via `reply`/`react`/`read_contract`, pointing to
   `docs/negotiation-protocol.md`). Plus an explicit DOCUMENTATION-ONLY / "board enforces none of
   it" disclaimer and a note that the Epic 8 kit (`install-agentbbs.md`) inlines it.
2. Content-guard test `packages/mcp-server/src/agent-prompt-snippet-doc.test.ts` mirroring the
   Story 7.1 `negotiation-protocol-doc.test.ts` (resolve the repo-root `.md` three levels up from
   `import.meta.url`; presence-check the load-bearing tokens). RED-first (ENOENT until the snippet
   exists), then GREEN.
3. Cross-link from `integration/bmad/README.md` (new "Contents" section) and the main `README.md`
   (the Negotiation Protocol key-concepts row).

**Rule 4 (source-facts) — verified before authoring:** all referenced tool names confirmed present
in the ratified `docs/mcp-tool-contract.md` §1/§6 canonical list: `register`, `login`, `check`,
`read_room`, `reply`, `react`/`unreact`, `read_contract`. The cadence/protocol semantics
(pull-only `check`, grant-on-act `reply`, participation-gated `react`, computed `read_contract`)
were taken from the contract + `docs/negotiation-protocol.md`, not from memory.

**Rule 8 (forward-compat):** the snippet references Epic 8 mechanics (the `AGENTS.md` handle record,
the `.toml` cadence hook) as INTENT only — it states what an agent should do without depending on
any Epic 8 code (which does not exist yet).

### Completion Notes

- `integration/bmad/agent-prompt-snippet.md` created — copy-pasteable system-prompt block + operator
  notes + companion-doc cross-links. DOCUMENTATION ONLY; no production code, no new tool/event/error
  code; THE APPEND INVARIANT untouched (no ledger change).
- Content-guard test added (6 cases): identity bootstrap names `register`+`login`; cadence framed as
  a PULL review at workflow-STEP boundaries via `check`; all four protocol moves named; the four
  protocol/cadence tools (`check`/`reply`/`react`/`read_contract`) referenced; pointer to
  `docs/negotiation-protocol.md` present; explicit "documentation only / enforces none" disclaimer
  present. RED confirmed first (ENOENT), then GREEN.
- Cross-linked from `integration/bmad/README.md` (new Contents section) and `README.md` (Negotiation
  Protocol key-concepts row); both the snippet and the bmad README note the Epic 8 kit inlines it.
- **Epic 7 complete:** the convention (`docs/negotiation-protocol.md`, 7.1) + its discovery (seeded
  announcement, 7.2) + the recommended adoption text (this snippet, 7.3).
- Honest gate GREEN end-to-end: **lint** 0 / **build** 7/7 / **typecheck** 0 / **test** 644 (94
  files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`) = 638 baseline (post-7.2) + 6 content-guard
  cases / **format** `--check` clean (after `prettier --write` on the new test file, then `--check`
  re-run + the affected test re-run green on the formatted tree).
- Left UNCOMMITTED (incl. no committed `dist`) for the lead's post-CR smoke gate.

### File List

- `integration/bmad/agent-prompt-snippet.md` (new — the FR27 agent-prompt snippet)
- `packages/mcp-server/src/agent-prompt-snippet-doc.test.ts` (new — content guard, 6 cases)
- `integration/bmad/README.md` (modified — added a Contents section cross-linking the snippet)
- `README.md` (modified — Negotiation Protocol key-concepts row now links the snippet)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story 7-3 status)
- `_bmad-output/implementation-artifacts/7-3-ship-the-agent-prompt-snippet.md` (modified — this story file)

### Change Log

- 2026-05-31 — Story 7.3 implemented (Epic 7 final story). Added `integration/bmad/agent-prompt-snippet.md`
  (FR27 copy-pasteable system-prompt text: identity bootstrap + post-step `check` cadence + the
  four-move Negotiation Protocol; documentation only, board enforces none of it; Epic 8 kit inlines
  it) + content-guard test (6 cases) + README cross-links. No production code, no new
  tool/event/error code; APPEND INVARIANT untouched. Gate green: lint 0 / build 7-7 / typecheck 0 /
  test 644 (94 files) / format --check clean. Status ready-for-dev → review. Left uncommitted for the
  lead's post-CR smoke gate.
