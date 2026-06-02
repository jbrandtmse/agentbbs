---
baseline_commit: 6536d58
---

# Story 8.1: Identity-bootstrap workflow

Status: review

## Story

As an agent starting on a project,
I want a bootstrap that resolves my identity once and records it,
So that every future session reuses the same handle instead of re-registering.

## Acceptance Criteria

1. **Given** no handle is recorded in the project's `AGENTS.md`,
   **When** the bootstrap runs,
   **Then** it `register`s a handle defaulting from persona/role + project scope (e.g. `amelia-dev@taskflow`), and records that handle in `AGENTS.md` (in a sentinel-bounded block the installation kit owns).

2. **Given** a handle is already recorded in `AGENTS.md`,
   **When** the bootstrap runs,
   **Then** it `login`s with that handle and does NOT register a new one (a stable handle is reused across sessions).

3. **Given** the default handle is already taken (e.g. two `dev` agents),
   **When** `register` is rejected with `HANDLE_TAKEN`,
   **Then** the bootstrap disambiguates by appending a short discriminator (e.g. `-2`, `-3`, …) and retries (bounded) before recording the FINAL handle,
   **And** only the PLAIN handle (no secret/token — V1 is claim-based, the handle IS the credential, NFR7) is written to `AGENTS.md` (safe to commit).

4. **Given** the bootstrap is an agent-executed workflow asset (FR37–39),
   **When** it is published in `integration/bmad/`,
   **Then** it is COPY/INLINE-ready for the Story 8.4 installation kit (a self-contained Markdown workflow an agent follows; no board code), uses ONLY the shipped `register`/`login` tools (verified against `docs/mcp-tool-contract.md`), and a CONTENT-GUARD test pins its claims (the three identity cases, the register/login tools, the plain-handle-no-secret rule, the AGENTS.md sentinel block) to the code's source of truth (Rule 10).

## Review Findings

**Code-review stage — 2026-05-31 (AGENTBBS-1-epic8, baseline `6536d58`). Verdict: APPROVED with 1 MED + 1 LOW auto-resolved inline.**

Adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) run inline (epic-cycle sub-agent context — no further subagent fan-out per skill-rules Rule 7). All four ACs satisfied; all skill-rules discharged. Honest gate re-run GREEN end-to-end: **lint 0 / build 7-7 / typecheck 0 / test 657 (96 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`) / format `--check` clean** (657 = 654 dev + 3 QA execution-proof; matches the QA handoff count).

**Rule 4 (source-facts) — re-verified TRUE, independently of the Dev Agent Record:**
- `register{ handle, current_focus }` → `HANDLE_TAKEN`: confirmed at `packages/mcp-server/src/tools/register.ts:40-43,86` (schema + description) and `packages/core/src/identity/register.ts:105` (throw); `HANDLE_TAKEN` in the closed set `packages/core/src/errors.ts:18`.
- `login{ handle }` → `LOGIN_UNKNOWN`: confirmed at `login.ts:35-37,79` and `core/src/identity/login.ts:58`; `LOGIN_UNKNOWN` at `errors.ts:20`.
- Handle charset `[a-z0-9._@-]`, lowercase, `persona@project` supported (FR39): `register.ts:11-21`. NFR7 claim-based / no token: `login.ts:79` + description. All asset references accurate.
- `register` + `login` both present in the contract §6 canonical block (`docs/mcp-tool-contract.md`), which `tool-contract.drift.test.ts:190-216` pins to the live `McpServer` via a real `Client.listTools()` — so the content-guard's "is this a real tool?" source of truth is transitively bound to the live registered surface, not a hand-maintained list. CONFIRMED.

**Rule 10 (content-guard non-vacuity) — independently mutation-tested by the reviewer (not taken on faith):**
- Standalone backticked phantom `` `subscribe` `` injected into the inlined block → guard went RED (`["subscribe"]`). The dev's primary non-vacuity holds.
- The dev's negative-lookahead pins (`/AGENTBBS-IDENTITY(?!-BOOTSTRAP)/`, `/persona@project(?!-)/`) re-read and confirmed to defeat the substring/overlap vacuity they were written for.

**Rule 3 (real-runtime evidence) — execution-proof verified GENUINE (not hollow):**
- Reviewer mutation probe: changed Step-3's `expect(sc.handle).toBe(DEFAULT_HANDLE)` to a sentinel string → RED, AssertionError showed the assertion received the REAL `'amelia-dev@taskflow'` from the live `register` tool's `structuredContent` over the real `Client`↔`createBoardServer`↔`createDataAccess` (SQLite) path. The test drives the live tools, observes real session/ledger state (`session.handle`, `eventsByType('identity.registered')`), and asserts all three doc branches (register / login+`LOGIN_UNKNOWN` / `HANDLE_TAKEN`→`-2`). Restored byte-identical.

**Rule 1 — verified N/A correctly:** the story introduces NO service/module/shared component — it ships one agent-executed Markdown asset + two tests + one README cross-link. The "integration" evidence is the QA execution-proof. Judgment sound.
**Rule 5 / Rule 6 — N/A:** no NFR code (NFR7 is a stated property, not a worked-around unmeasurable NFR); no `docs/adr/` registry exists.

---

### MED-1 (auto-resolved) — content-guard phantom-tool scan had a blind spot for the `` `tool{ args }` `` CALL-FORM this asset uses prominently

**Source:** Blind + Edge. **Location:** `packages/mcp-server/src/identity-bootstrap-doc.test.ts` (the `no phantom tools` case, candidate regex).

**Issue:** The phantom-tool candidate regex was `` /`([a-z][a-z_]{2,})`/g `` — it matches only a token wrapped by a *closing backtick*. This asset presents its tool invocations primarily in the CALL form `` `register{ handle, current_focus }` `` / `` `login{ handle }` `` (a `{` follows the token, not a backtick), so those forms were never candidates. Reviewer proof: mutating `` `register{ … }` `` → `` `signup{ … }` `` left the guard GREEN (9/9) — a phantom introduced ONLY in call-form would have slipped, despite a standalone-`` `subscribe` `` phantom being caught. The blind spot was inherited verbatim from the Story 7.3 snippet guard, but it matters more here because the call-form is this asset's dominant invocation style.

**Fix (applied):** Broadened the candidate regex to `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` — capture the leading token whether followed by a closing backtick (bare reference) OR a `{` (call form). Re-verified: (a) clean asset still 9/9 green (no false positives — `register`/`login` call-forms resolve to real tools, `current_focus` allowlisted); (b) call-form phantom `` `provision{ … }` `` now → RED (`["provision"]`); (c) standalone phantom still → RED. Asset SHA256 unchanged (only the test changed). Comment added explaining the call-form rationale and that it goes one step beyond the snippet guard.

**Reconciliation with the Story 7.3 dismissal (project-rules Rule 8 — do not silently contradict an earlier ratified decision):** the Story 7.3 code review DISMISSED broadening this same regex family (`deferred-work.md`, "Story 7.3 · LOW · Phantom-tool regex…") as a "theoretical hardening nit … against an unrealistic phantom shape." That dismissal was CORRECT *for the snippet*, whose inlined block uses NO `` `tool{ args }` `` call-form (verified: a `grep` of the `AGENTBBS-PROMPT-SNIPPET` block for backticked call-forms returns empty) — so its blind spot is purely LATENT. For THIS asset the call-form is the DOMINANT, actually-present invocation style, so the same blind spot is LIVE and empirically exploitable (proven: `signup{…}` slipped GREEN pre-fix). This is therefore a context-specific reconciliation, not a contradiction: the fix is strictly additive (it still catches every shape the 7.3 regex caught) and is applied here because the fact pattern differs. The 7.3 snippet guard is left as-is (its dismissal still holds while it uses no call-form); a one-line note was added to `deferred-work.md` so that if the snippet ever adopts a call-form, the same broadening is applied there.

### LOW-2 (auto-resolved) — story Dev Agent Record recorded the DEV gate count (654/95), not the post-QA count (657/96)

**Source:** Auditor. **Location:** this story file — Completion Notes, Change Log, File List.

**Issue:** The dev wrote "test 654 (95 files) = 645 + 9" and a File List omitting the QA-authored `identity-bootstrap-workflow.integration.test.ts`. QA then added that 3-test file (654→657, 95→96 files) but did not reconcile the dev-written count/list. The recorded gate count therefore lagged reality.

**Fix (applied):** Reconciled below — File List now includes the QA execution-proof test; the authoritative post-CR count is **657 (96 files)** as recorded in this Review Findings header and the Change Log entry. (The dev's inline "654" prose is left as the dev's-stage record; this header is the source of truth for the final count.)

## Tasks / Subtasks

- [x] Task 1: Author `integration/bmad/identity-bootstrap.md` (AC: #1, #2, #3)
  - [x] A self-contained, agent-executed Markdown workflow (sentinel-delimited inlinable block, mirroring Story 7.3's snippet convention so 8.4 can inline it). The steps the agent follows:
    1. Look for a recorded AgentBBS handle in the project's `AGENTS.md` (a sentinel-bounded `AGENTBBS-IDENTITY` block — name it so 8.4's kit owns/updates only that block).
    2. **Recorded** → `login` with it. (If `login` is rejected `LOGIN_UNKNOWN` — recorded but never registered, e.g. a fresh DB — fall through to register-and-record using the recorded handle.)
    3. **Not recorded** → derive a default handle from persona/role + project scope (e.g. `<persona-or-role>@<project-slug>`, lowercased to the handle charset `[a-z0-9._@-]`); `register` it.
       - On `HANDLE_TAKEN` → append a short discriminator (`-2`, `-3`, …; bounded retries) and re-`register` until it succeeds, then record the FINAL handle.
    4. Record ONLY the plain handle (no secret/token) in the `AGENTS.md` sentinel block (safe to commit — NFR7 claim-based auth).
  - [x] State explicitly: V1 auth is claim-based (the handle is the credential; there is no secret); the recorded handle is safe to commit; the block is sentinel-bounded so re-running / the 8.4 kit updates only it (idempotent). Reference the `docs/mcp-tool-contract.md` for `register`/`login` shapes.
- [x] Task 2: Content-guard test + cross-links (AC: #4)
  - [x] Add a content-guard test (e.g. `packages/mcp-server/src/identity-bootstrap-doc.test.ts`, mirroring the Story 7.1/7.3 guards) reading `integration/bmad/identity-bootstrap.md` and asserting: the three identity cases (no-handle→register, recorded→login, taken→disambiguate); the tools it names (`register`, `login`) are REAL (pin to the live tool set / `docs/mcp-tool-contract.md` §6, transitively drift-guarded — Rule 10, scoped to the inlined block, mutation-tested); the plain-handle-no-secret rule; the `AGENTS.md` sentinel block name. Cross-link from `integration/bmad/README.md`.
- [x] Task 3: Full gate (AC: #4)
  - [x] Run lint → build → typecheck → test → format (`--check`). All green. Note the final count (Epic 8 at 645 after Story 8.0).

## Dev Notes

This story ships the agent-executed identity-bootstrap WORKFLOW (`integration/bmad/identity-bootstrap.md`, FR37–39) — the canonical asset the Story 8.4 installation kit inlines, operationalizing the identity bootstrap the Story 7.3 snippet recommends. DOCUMENTATION/ASSET ONLY (no board code); a content-guard test keeps it from drifting from the shipped `register`/`login` surface (Rule 10).

**Rule 1 (Integration ACs):** N/A — an agent-executed asset (no new service). The content-guard test is the verification.
**Rule 3 (real-runtime evidence):** N/A for a workflow asset (the bootstrap uses the already-proven `register`/`login` tools — Epic 2; the content-guard pins the references).
**Rule 4 (verify source-facts):** `register`/`login` are the shipped tools (`docs/mcp-tool-contract.md` §6, Epic 2) — `register{handle, current_focus}` → `HANDLE_TAKEN` on a taken handle; `login{handle}` → `LOGIN_UNKNOWN` on an unknown handle. Verify before referencing.
**Rule 5 / Rule 6:** N/A (no NFR code; no `docs/adr/`). NFR7 (claim-based auth, handle-is-credential) is the basis for "plain handle, no secret, safe to commit."
**Rule 8:** the bootstrap references `AGENTS.md` (a BMad project file) + persona/role scoping as INTENT — forward-compatible with the 8.4 kit; no dependency on non-existent code.
**Rule 10 (NEW, Epic 7 retro):** the content-guard pins the asset's tool references to the live tool set (the asset is agent-consumed — a wrong tool name is a runtime failure an agent hits).

### Source facts (verified at story creation, baseline `6536d58`)

- **`register`/`login`** (Epic 2, `docs/mcp-tool-contract.md` §6): `register{handle, current_focus}` (claim-based; `HANDLE_TAKEN` if the handle is claimed); `login{handle}` (`LOGIN_UNKNOWN` if unregistered). The handle charset is `[a-z0-9._@-]` (supports `persona@project`, FR39). NFR7: the handle is the credential; no secret token.
- **`integration/bmad/`** holds `README.md` + `agent-prompt-snippet.md` (Story 7.3). Add `identity-bootstrap.md`; cross-link from the README.
- **Content-guard pattern:** `packages/mcp-server/src/agent-prompt-snippet-doc.test.ts` (Story 7.3) — sentinel-block parse + tool-references-pinned-to-the-live-set ("no phantom tools") + mutation-tested. Mirror it (the bootstrap names `register`/`login`).
- **`AGENTS.md`** is a BMad project file (the per-project agent identity record, FR38) — the bootstrap writes a sentinel-bounded `AGENTBBS-IDENTITY` block there (the 8.4 kit owns/updates only that block). The full kit (detect/backup/idempotent sentinel edits) is Story 8.4; 8.1 defines the bootstrap workflow + the block format it writes.
- Toolchain (Epics 1–7): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers).

### Project Structure Notes

- New `integration/bmad/identity-bootstrap.md` + a cross-link from `integration/bmad/README.md`; one content-guard test. NO board code, NO new tool/event/error code.
- This is the FIRST of the four Epic-8 asset stories (8.1 bootstrap → 8.2 cadence hook → 8.3 .toml + skill-rules registry → 8.4 the self-contained kit that inlines all of them).

## Dev Agent Record

### Context Reference

- Baseline commit `6536d58` (branch `AGENTBBS-1-epic8`); frontmatter `baseline_commit` preserved as authored.
- Asset-only story: NO board code, NO new tool/event/error code. Ships one agent-executed Markdown workflow + one content-guard test + one README cross-link.

### Implementation Plan (as executed)

1. **Rule 4 — verified source-facts before coding.** Confirmed `register{handle, current_focus}` → `HANDLE_TAKEN` and `login{handle}` → `LOGIN_UNKNOWN` against BOTH `docs/mcp-tool-contract.md` §3/§4 AND the live tool registrations (`packages/mcp-server/src/tools/register.ts` lines 40–43, 86; `login.ts` lines 35–37, 79). Handle charset `[a-z0-9._@-]` (register.ts comment + contract §3) supports `persona@project` (FR39). NFR7 claim-based, no token (login.ts:79, contract §3). The canonical §6 tool-name block sentinels are `# AGENTBBS-TOOL-CONTRACT:BEGIN/END`. Confirmed the existing guard `agent-prompt-snippet-doc.test.ts` enumerates the live tool set by parsing that §6 block (`readCanonicalToolNames()`) and allowlists non-tool tokens (`current_focus`, `seq`) — mirrored that exact source-of-truth.
2. **Rule 6 — ADR registry:** no `docs/adr/` directory exists; this story references no ADR. N/A confirmed by inspection.
3. **Task 1** — authored `integration/bmad/identity-bootstrap.md`: operator-facing intro + a sentinel-delimited inlinable block (`AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END`, mirroring the snippet's `AGENTBBS-PROMPT-SNIPPET:BEGIN/END`) with the four steps — look for recorded handle in `AGENTS.md` `AGENTBBS-IDENTITY` block; recorded → `login` (with `LOGIN_UNKNOWN` fall-through to register-and-record the recorded handle); not recorded → derive `persona@project` lowercased to charset → `register`, on `HANDLE_TAKEN` append a bounded discriminator (`-2`…`-9`, then surface) → record the FINAL plain handle. States claim-based/NFR7, plain-handle-no-secret, safe-to-commit, sentinel-bounded idempotent block, documentation-only/board-enforces-none.
4. **Task 2** — authored `packages/mcp-server/src/identity-bootstrap-doc.test.ts` mirroring `agent-prompt-snippet-doc.test.ts` exactly (same imports, `import.meta.url` path-resolution, `readCanonicalToolNames()` pin to contract §6, `readInlinedBlock` scoping). Cross-linked the new file from `integration/bmad/README.md` under `## Contents`.
5. **Task 3** — full honest gate, in order: lint → build → typecheck → test → format `--check`.

### Completion Notes

- **Asset shipped:** `integration/bmad/identity-bootstrap.md` — the agent-executed identity-bootstrap workflow (FR37–39), the canonical text the Story 8.4 kit inlines. Inlinable block delimited by `AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END`; records the handle into a sentinel-bounded `AGENTBBS-IDENTITY` block in the project's `AGENTS.md` (the block 8.4 owns/updates). All three identity cases covered: no-handle→`register`; recorded→`login` (with `LOGIN_UNKNOWN`→register-and-record fall-through); `HANDLE_TAKEN`→bounded-discriminator disambiguation. States claim-based auth (NFR7 — handle IS the credential, no secret), plain-handle-only, safe-to-commit, idempotent block, documentation-only.
- **Content-guard (Rule 10):** `packages/mcp-server/src/identity-bootstrap-doc.test.ts` — 9 tests pinning, against the INLINED block, (a) the three identity cases, (b) every backticked snake_case tool token is a REAL advertised tool (pinned to the live set via the contract §6 canonical list, transitively bound to the live `McpServer` by `tool-contract.drift.test.ts`; non-tool params `current_focus`/`handle` allowlisted), (c) the plain-handle-no-secret/claim-based + safe-to-commit rule, (d) the `AGENTBBS-IDENTITY` block name, (e) the inlinable-block markers. Mirrors `agent-prompt-snippet-doc.test.ts`.
- **Rule 7 / Rule 10 mutation-test (10 isolated mutations, each restored byte-identical):** every load-bearing pin proven non-vacuous — phantom-tool injection, login→signin, register→enroll, drop-`HANDLE_TAKEN`, rewrite-base-`persona@project`, drop-all-`safe to commit`, drop-all-`claim-based`, rename-all-`AGENTBBS-IDENTITY`, break-`BEGIN`-marker, drop-`documentation only` → ALL go RED; doc restored byte-identical (SHA256 verified) and GREEN after each. **The mutation test caught two real guard defects before they shipped and they were fixed:** (1) the block-name pin was VACUOUS — `AGENTBBS-IDENTITY` is a substring of the `AGENTBBS-IDENTITY-BOOTSTRAP` marker, so a plain `includes` could never fail; changed to `/AGENTBBS-IDENTITY(?!-BOOTSTRAP)/`. (2) the `persona@project` pin was satisfied by the `persona@project-2` disambiguation example alone; tightened to `/persona@project(?!-)/` (base form). Both strengthened regexes re-confirmed RED after prettier reflow.
- **Honest gate GREEN end-to-end:** lint 0 / build 7-7 / typecheck 0 / **test 654 (95 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`)** = 645 (post-8.0 baseline) + 9 new / format `--check` clean (after `prettier --write` on the new test file; full suite + format re-run green on the formatted tree).
- **NO board code; NO new tool/event/error code.** EVENT_TYPES and BOARD_ERROR_CODES untouched; THE APPEND INVARIANT not implicated (nothing appends). Rules 1 & 3 N/A (agent-executed asset, no service — the content-guard IS the verification); Rule 5 N/A (no NFR code); Rule 6 N/A (no `docs/adr/`); Rule 8 satisfied (the new `*.test.ts` is default-suite-discovered — confirmed RUN, file 95/95).
- **Note for the lead:** left UNCOMMITTED for the post-CR smoke gate. The `AGENTS.md` referenced by the workflow does not yet exist in this repo — intentional (Rule 8: forward-compatible INTENT; the Story 8.4 kit creates/owns the `AGENTBBS-IDENTITY` block). The sprint-status `8-1` entry was `backlog` at stage start (stale after 8.0); reconciled to `in-progress` then `review` consistent with the story file's `ready-for-dev` status and the epic-cycle handoff.

### File List

- `integration/bmad/identity-bootstrap.md` (new) — the agent-executed identity-bootstrap workflow asset.
- `packages/mcp-server/src/identity-bootstrap-doc.test.ts` (new) — the content-guard test (9 tests, Rule 10). _(Code-review broadened the phantom-tool candidate regex to also catch the `` `tool{ args }` `` call-form — MED-1.)_
- `packages/mcp-server/src/tools/identity-bootstrap-workflow.integration.test.ts` (new — QA stage) — the real-runtime EXECUTION proof (3 tests; drives the live `register`/`login` over a real `Client`↔`createBoardServer`↔SQLite; Rule 3).
- `integration/bmad/README.md` (modified) — added the `identity-bootstrap.md` bullet under `## Contents`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — `8-1` `backlog`→`in-progress`→`review`; `last_updated` note.
- `_bmad-output/implementation-artifacts/8-1-identity-bootstrap-workflow.md` (modified) — task checkboxes, Dev Agent Record, Change Log, Status (this file).

### Change Log

| Date | Change |
|---|---|
| 2026-05-31 | Authored `integration/bmad/identity-bootstrap.md` (agent-executed identity-bootstrap workflow, FR37–39; sentinel-delimited inlinable block; three identity cases; claim-based/NFR7 plain-handle-no-secret/safe-to-commit). |
| 2026-05-31 | Added content-guard test `packages/mcp-server/src/identity-bootstrap-doc.test.ts` (9 tests, Rule 10; pins identity cases, no-phantom-tools to live §6 set, claim-based rule, `AGENTBBS-IDENTITY` block name, inlinable markers). Mutation-tested non-vacuous (10 mutations RED, byte-identical restore); caught + fixed two vacuous-pin defects (block-name substring, `persona@project-2` overlap). |
| 2026-05-31 | Cross-linked the new workflow from `integration/bmad/README.md`. |
| 2026-05-31 | Honest gate green: lint 0 / build 7-7 / typecheck 0 / test 654 (95 files) / format `--check` clean. Status → review. |
| 2026-05-31 | QA stage added `packages/mcp-server/src/tools/identity-bootstrap-workflow.integration.test.ts` (3 tests, real-runtime execution proof; Rule 3). Gate → 657 (96 files). |
| 2026-05-31 | Code-review (APPROVED): MED-1 auto-resolved — broadened the content-guard phantom-tool candidate regex to `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` so a phantom in the `` `tool{ args }` `` call-form is caught (was a blind spot inherited from the snippet guard; this asset uses the call-form prominently). Re-verified non-vacuous: clean 9/9 green, call-form `provision{…}` → RED, standalone `subscribe` → RED. LOW-2 auto-resolved — reconciled File List + final count (657/96). Independently re-verified Rule 4 source-facts, Rule 10 non-vacuity, and Rule 3 execution-proof genuineness (mutation probes RED, all restored byte-identical). Gate re-run GREEN: lint 0 / build 7-7 / typecheck 0 / test 657 (96 files) / format `--check` clean. |
