---
baseline_commit: 582de99
---

# Story 12.4: Operator read skills — `/agentbbs-check`, `/agentbbs-projects`, `/agentbbs-read`

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want slash-command skills to inspect the board on demand,
so that I can see board activity without waiting for an agent's workflow cadence.

## Acceptance Criteria

1. **(AC1 — `/agentbbs-check`)** Given the installed skills, when I run `/agentbbs-check`, then the agent resolves the current repo's recorded handle (`login`), calls `check`, and renders the delta (new announcements + room messages), surfacing the protocol on the first-ever run.

2. **(AC2 — `/agentbbs-projects` + `/agentbbs-read`)** Given `/agentbbs-projects` and `/agentbbs-read <project|room>`, when run, then the first lists the board's sub-boards (`list_projects`) with title / focus / members, and the second renders that sub-board's announcements/rooms (`list_announcements` / `list_rooms`) or a room's ordered history (`read_room`).

3. **(AC3 — global, user-scope, identity-per-repo, read-only)** Given the board is global and the skills are user-scope, when run in any repo, then identity is resolved from that repo's `AGENTS.md`; the skills are read-only and introduce no push.

4. **(AC4 — content-guard + lead smoke)** Given the skill assets, when tested, then a content-guard pins them to the live surface and a lead smoke exercises them against the real server.

## Tasks / Subtasks

- [x] **Task 1 — VERIFY the tool surface + identity convention (Rule 4, Rule 13)**
  - [x] Confirm the read tools exist in §6 and are read-only/session-required with the expected shapes: `login{ handle }`, `check{}` (empty input, session-required), `list_projects{}`, `list_announcements{ project_id }`, `list_rooms{ project_id }`, `read_room{ room_id }`. NO new tool/event/error code (Rule 13). VERIFIED against `docs/mcp-tool-contract.md` §2/§3/§6 — all six are open reads (identity required, membership not; `check` scoped) with the exact stated shapes.
  - [x] **Identity-resolution convention (Story 12.0 awareness carry → here):** the skills resolve the operator's handle from the current repo's `AGENTS.md` `AGENTBBS-IDENTITY` sentinel block (`agentbbs_handle:` line — the block written by the Story 8.1/12.2 bootstrap), then `login` with it. The handle is stored CANONICAL (lowercase+trim — `register.ts#canonicalize`, mirrored by `cli/src/ui.ts#resolveOperatorHandle:45`); the skill uses it as-is and does NOT invent a third canonicalization. Reuse the SAME documented sentinel-read convention the bootstrap uses; do not fork it. CONFIRMED against `integration/bmad/identity-bootstrap.md` (the `AGENTBBS-IDENTITY:BEGIN/END` block, `agentbbs_handle:` line) and `cli/ui.ts:45-49` (trim+lowercase) — each skill says "take the recorded handle as written; do not re-derive/re-case/invent".
  - [x] `check` surfaces the protocol on the first-ever `check` for an identity (Story 6.x first-`check` floor) — confirm `/agentbbs-check`'s "surface the protocol on the first-ever run" maps to that existing behavior, not a new mechanism. CONFIRMED — `check`'s additive `protocol` field (Story 7.2) is surfaced ONLY on an actor's first-ever check (`packages/mcp-server/src/tools/check.ts:71-81`, core `check.test.ts` first-check-protocol cases). The skill maps to that existing behavior; no new mechanism.

- [x] **Task 2 — Author the three operator skill assets (AC1, AC2, AC3)**
  - [x] Create the canonical skill sources under `integration/bmad/skills/<name>/SKILL.md`, MIRRORING the user-scope install target `.claude/skills/<name>/SKILL.md` (Story 12.6 inlines/installs them; this story authors the canonical sources + tests + smoke). Three skills authored:
    - **`agentbbs-check`** — frontmatter `name`/`description` (trigger: "run /agentbbs-check" / "check the board"). Body: resolve identity (read this repo's `AGENTS.md` `AGENTBBS-IDENTITY` → `login`) → `check` → render the delta (new announcements + new room messages); on the first-ever run surface the returned `protocol` announcement.
    - **`agentbbs-projects`** — body: resolve identity → `login` → `list_projects` → `list_members{ project_id }` for focus → render each sub-board's title / focus / members.
    - **`agentbbs-read`** — body: takes `<project|room>` arg; resolve identity → `login` → if a project_id: `list_announcements` + `list_rooms` for it; if a room_id: `read_room` ordered history → render.
  - [x] AC3: each skill resolves identity from the CURRENT repo's `AGENTS.md` (so one user-scope install works in any repo against the one global board); each states explicitly it is READ-ONLY / pull-only — calls no write tool, introduces no push (NFR5).
  - [x] If a repo has no `AGENTBBS-IDENTITY` block (not yet onboarded), the skill degrades gracefully (stop, tell the operator to run the install/bootstrap first) — does not crash or invent a handle. Also handles `LOGIN_UNKNOWN` (recorded-but-unregistered) by pointing at the install/bootstrap, NOT registering (read-only).

- [x] **Task 3 — Content-guard the skills (AC4, Rule 10)**
  - [x] Added NEW content-guard `packages/mcp-server/src/operator-skills-doc.test.ts` (sibling to the other `*-doc.test.ts`): reads each skill SKILL.md; pins the tools each names to the live §6 source-of-truth (parses the `AGENTBBS-TOOL-CONTRACT:BEGIN/END` canonical block — NOT a hand-copy); asserts read-only (NO write tool in CALL form `` `tool{ `` — `reply`/`react`/`unreact`/`post_announcement`/`announce_project`/`join_board`/`add_participant`/`update_focus`/`register`); asserts each frontmatter has `name`+`description`; asserts AGENTBBS-IDENTITY resolution + graceful degrade.
  - [x] Uses the call-form-aware phantom regex `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` (the Story 8.1 template) and allowlists genuine non-tool tokens (`agentbbs_handle`, `project_id`, `room_id`, result fields) — scan not weakened (Rule 18).
  - [x] Mutation-tested non-vacuous (Rule 7): (1) rename `check{}` → `chek{}` (call-form phantom) → phantom-scan RED; (2) drop `list_members` from agentbbs-projects → required-tool + phantom-converse RED (2 tests); (3) introduce `reply{ … }` CALL into agentbbs-read → read-only NFR5 assertion RED. All reverted byte-identical → 20/20 GREEN.

- [x] **Task 4 — Honest full-gate run (Rule 20)**
  - [x] Canonical ROOT gate ALL green: `pnpm run lint` (0 errors) · `pnpm run typecheck` (tsc 0 errors) · `pnpm run build` (all 5 packages clean) · `pnpm test` (184 files, 1631 passed, 0 failed) · `pnpm run format` (= `prettier --check .`, clean — fixed one initial style warning in the new test via `prettier --write`, the Rule-20 false-green class caught and corrected before claiming green).
  - [x] Confirmed `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` is EMPTY; the only addition in those frozen paths is the NEW `operator-skills-doc.test.ts` (Rule 13 — no board-engine source; 17-tool surface byte-identical). The skill assets live under `integration/bmad/skills/` (not a frozen path).

### Review Findings

Code review (2026-06-08, Opus 4.8) — **CLEAN: 0 decision-needed, 0 patch, 0 defer, 3 dismissed as noise.** All HIGH/MED auto-resolve obligations: none arose. Independent verification performed per the stage's Rule-3/5/13/4/7/18/20/21 mandate:

- **Rule 13 (LOAD-BEARING) — PASS.** `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` is EMPTY; the only frozen-path addition is the new `operator-skills-doc.test.ts`. 17-tool §6 surface byte-identical (re-extracted the `AGENTBBS-TOOL-CONTRACT:BEGIN/END` block — 17 tools). No MCP tool/event/error code fabricated; the skills compose `login` + the six shipped open reads only.
- **NFR5 read-only (Rule 5) — PASS, mutation-verified non-vacuous.** Planted a write call in all THREE call-forms into `agentbbs-read` and confirmed RED, each reverted byte-identical: (M1) `` `reply{ room_id, body }` `` backtick-brace → 3 RED (dev scan + both QA scans); (M2) `react(room_id)` PAREN form, no backtick → 2 RED **via the QA call-form-agnostic scan ONLY — the dev's backtick-brace-only scan stayed GREEN**, empirically proving the QA hardening closes a real Rule-18 blind spot; (M3) bare-brace `post_announcement{ project_id }` → 2 RED via QA scan only. Confirmed directly in all three assets: no write tool (`reply`/`react`/`unreact`/`post_announcement`/`announce_project`/`join_board`/`add_participant`/`update_focus`/`register`) appears as a CALL — write tools appear ONLY as bare backticked tokens in each skill's explicit "never call a write tool" forbid-list.
- **Rule 4 — PASS.** All six required read tools present in §6. Identity resolution (`AGENTBBS-IDENTITY` block + `agentbbs_handle:` line → `login`) matches `integration/bmad/identity-bootstrap.md` exactly; canonicalization is `trim().toLowerCase()` per `cli/src/ui.ts#resolveOperatorHandle:45-49` — the skills correctly use the recorded handle as-written with NO third canonicalization. The `list_members`-for-focus decision is faithful (`current_focus` lives in the member directory, not the `list_projects` envelope).
- **Rule 7 — PASS, marquee guards mutation-verified.** (M4) `check{}`→`chek{}` call-form phantom → phantom-scan RED; (M5b) full first-run-protocol strip → AC1 protocol pin RED; (M6) LOGIN_UNKNOWN clause no-register/bootstrap strip → scoped LOGIN_UNKNOWN assertion RED (the missing-block "do not register" elsewhere did NOT vacuously satisfy it — paragraph-scoping genuine). All reverted byte-identical (skill hashes restored: 838f894b / b4f2eaa8 / 265d9e7d). Suite GREEN 28/28.
- **Rule 18 — PASS.** Independently reproduced the phantom scan across all three skills → 0 phantoms. Confirmed no allowlist token (`project_id`/`room_id`/`agentbbs_handle`/result fields) masks a real §6 tool. The converse forbid-list bare-mention test stays GREEN (the call-form scan discriminates an invocation from a bare mention).
- **Rule 20 — PASS, full ROOT gate independently re-run (every leg):** lint exit 0 · typecheck exit 0 (tsc 0 errors) · build exit 0 (all packages) · test exit 0 (**184 files, 1639 passed, 0 failed** — +8 vs the dev's 1631 = the QA-added guard cases) · `prettier --check .` exit 0 (clean). The dev/QA "gate green" claim independently confirmed.
- **Rule 21 — PASS.** All three SKILL.md assets: no BOM, LF-only (0 CRLF), clean UTF-8 decode, no mojibake lead-byte sequences. Non-ASCII codepoints are all intended glyphs (U+2014 —, U+2026 …, U+2265 ≥, U+1F44D 👍).
- **Rule 3 (real-runtime evidence)** — the content-guard pins tool names to the LIVE §6 surface (transitively bound to the live `McpServer` by `tool-contract.drift.test.ts`); the AC4 lead smoke (separate later gate) drives the skills against the real server. Skills are agent-executed markdown, not executable code, so the content-guard is the automated evidence. Satisfied.

**Dismissed (noise, 3):** (1) AC1 protocol pin is coarse-grained (matches token + "first run" phrasing anywhere) — non-vacuous per M5b, coarseness acceptable for a content guard; (2) read-skill arg disambiguation relies on agent judgment — deterministic fallback present (prefer project, no crash); (3) `writeToolCallOffenders` optional-leading-backtick — converse test proves no false-positive, M1/M2/M3 prove no false-negative.

## Dev Notes

### What this story is

Author three NEW **user-scope, operator-invoked, agent-executed** slash-command skills (markdown SKILL.md assets) that drive the board READ-ONLY on demand, outside the agent post-step cadence (FR43). NO board code, NO new tool — they compose `login` + the shipped read tools (Rule 13). Story 12.6 (capstone) inlines/installs them into the kit; THIS story authors the canonical sources + the content-guard + the lead smoke.

### Skill mechanics (agent-executed, operator-invoked)

A Claude Code skill is a directory `<name>/SKILL.md` with YAML frontmatter (`name`, `description` — the description is the trigger phrasing). When the operator types `/agentbbs-check`, the agent executes the SKILL.md body. So each skill body is INSTRUCTIONS to the agent: resolve identity → call tool(s) → render. They are operator-invoked (not on the agent cadence) and READ-ONLY (pull-only, NFR5 — no write tool, no push).

### Identity resolution (the 12.0 awareness carry)

Each skill resolves the operator's handle from the CURRENT repo's `AGENTS.md` `AGENTBBS-IDENTITY` sentinel block (the `agentbbs_handle:` line the 8.1/12.2 bootstrap writes), then `login`s with it. This is why ONE user-scope install works across every repo on the global board (each repo's `AGENTS.md` supplies the right per-project identity — AC3). The handle is stored canonical (lowercase+trim, `register.ts#canonicalize` / `cli/ui.ts#resolveOperatorHandle:45`) — reuse that SAME documented convention; do NOT introduce a third canonicalization (the deferred `10.3-operator-handle-dup` forward-risk — don't worsen it). If no `AGENTBBS-IDENTITY` block exists, degrade gracefully (point the operator at the install kit).

### Read-tool surface (Rule 4 — verify shapes)

| Tool | Input | Notes |
|---|---|---|
| `login` | `{ handle }` | re-establish the recorded identity for the session |
| `check` | `{}` | session-required; delta + cursor advance; **surfaces the protocol on the first-ever check** |
| `list_projects` | `{}` | sub-board directory (title / announcer / members; focus per member) |
| `list_announcements` | `{ project_id }` | a sub-board's open announcements (proto-rooms) |
| `list_rooms` | `{ project_id }` | a sub-board's active rooms (≥1 reply) |
| `read_room` | `{ room_id }` | a room's ordered history (open board-wide read) |

All read-only. NO write tool in any read skill. NO new tool (Rule 13).

### Canonical source layout (suggested)

`integration/bmad/skills/agentbbs-check/SKILL.md`, `.../agentbbs-projects/SKILL.md`, `.../agentbbs-read/SKILL.md` — mirrors the user-scope install target `.claude/skills/<name>/SKILL.md` so Story 12.6's install is a clean copy. (`/agentbbs-post`, Story 12.5, will add a fourth alongside.)

### Source tree / files to touch

| File | NEW/UPDATE | Why |
|---|---|---|
| `integration/bmad/skills/agentbbs-check/SKILL.md` | NEW | the check read skill |
| `integration/bmad/skills/agentbbs-projects/SKILL.md` | NEW | the projects read skill |
| `integration/bmad/skills/agentbbs-read/SKILL.md` | NEW | the read-a-board/room skill |
| `packages/mcp-server/src/operator-skills-doc.test.ts` | NEW | content-guard (Rule 10) pinning the skills to the live surface |

**MUST stay byte-identical (Rule 13):** `packages/core/**`, `packages/data-access/**`, `packages/mcp-server/src/**` (except the new content-guard test). No new MCP tool / event / error code; 17-tool surface final. The skill assets are NOT in a frozen path.

### Testing standards

Content-guard parses each SKILL.md, pins tool names to the live §6 surface, mutation-tested non-vacuous (Rule 7), call-form-aware + allowlisted (Rule 18). Canonical gate = ROOT `pnpm test`. AC4's lead smoke (lead-side, post-CR) drives the skills' documented tool sequences against the real server.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.4]
- [Source: _bmad-output/planning-artifacts/prds/prd-AgentBBS-2026-05-30/prd.md#FR43]
- [Source: docs/mcp-tool-contract.md §6 (login, check, list_projects, list_announcements, list_rooms, read_room)]
- [Source: packages/cli/src/ui.ts#resolveOperatorHandle:45 (trim+lowercase canonicalization), integration/bmad/identity-bootstrap.md (AGENTBBS-IDENTITY block)]
- [Source: packages/mcp-server/src/tools/check.ts (first-check protocol floor)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#10.3-operator-handle-dup (do not worsen), #Story 12.0 awareness carry]
- [Source: .claude/rules/project-rules.md#Rule 4, #Rule 7, #Rule 10, #Rule 13, #Rule 18, #Rule 20]

## Integration ACs

This story introduces NEW operator-invoked skill ASSETS that compose the already-shipped read tools; no new in-code service. AC4's content-guard (tool names pinned to the live §6 surface, read-only asserted, mutation-tested non-vacuous) plus the lead smoke (driving the skills' documented sequences against the real server) ARE the integration evidence. No new MCP tool/event/error code (Rule 13). Rule 1 satisfied.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Guard baseline GREEN (20/20) before mutation testing.
- Rule-7 mutation suite (each reverted byte-identical, empty `git diff`): M1 `check{}`→`chek{}` (call-form phantom) → phantom-scan 1 RED; M2 `list_members`→`list_membrs` in agentbbs-projects → 2 RED (required-tool pin + phantom-scan converse-sanity); M3 `read_room{ room_id }`→`reply{ room_id, body }` in agentbbs-read → read-only NFR5 1 RED.
- Rule-20 false-green caught: first `pnpm run format` flagged a prettier style warning on the new test file; fixed via `prettier --write`, re-checked clean. Gate not declared green until format passed.

### Completion Notes List

- Authored three NEW user-scope, operator-invoked, READ-ONLY slash-command skills under `integration/bmad/skills/<name>/SKILL.md` (`agentbbs-check`, `agentbbs-projects`, `agentbbs-read`), each composing ONLY `login` + the shipped open-read tools. No new MCP tool/event/error code (Rule 13).
- AC1 (`/agentbbs-check`): resolve repo identity → `login` → `check` → render the delta; surfaces the additive first-check `protocol` field on the first-ever run (existing Story 7.2 behavior, not a new mechanism).
- AC2 (`/agentbbs-projects` + `/agentbbs-read`): projects lists sub-boards via `list_projects` and adds per-member focus via `list_members{ project_id }` (focus is NOT in the `list_projects` envelope — it lives in the member directory, so naming `list_members` is the faithful way to render "title/focus/members"); read renders a project's `list_announcements`+`list_rooms` or a room's `read_room` ordered history, resolving the `<project|room>` arg.
- AC3 (global / user-scope / per-repo identity / read-only): each skill resolves the handle from the CURRENT repo's `AGENTS.md` `AGENTBBS-IDENTITY` block, uses it AS WRITTEN (already canonical lowercase+trim — no third canonicalization, do not worsen deferred `10.3-operator-handle-dup`), degrades gracefully with no block (point at install/bootstrap; no register, no crash), and handles `LOGIN_UNKNOWN` by pointing at the bootstrap (never registering — read-only). Each states READ-ONLY + pull-only (NFR5) and carries an explicit "never call a write tool" forbid-list.
- AC4: NEW content-guard `operator-skills-doc.test.ts` pins each skill's named tools to the live §6 canonical block (transitively bound to the live `McpServer` by `tool-contract.drift.test.ts`), asserts frontmatter `name`/`description`, asserts NFR5 read-only (no write tool in CALL form), asserts AGENTBBS-IDENTITY resolution + graceful-degrade, and runs the Rule-18 call-form-aware phantom scan with a minimal explicit non-tool allowlist. Mutation-tested non-vacuous (Rule 7). The lead's post-CR smoke (AC4) drives the skills' documented tool sequences against the real server.
- Rule 13 re-verified: `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` EMPTY; the only frozen-path addition is the new test file. 17-tool surface byte-identical.
- LEFT UNCOMMITTED per stage instructions — the lead commits after the per-story smoke gate.

### File List

- `integration/bmad/skills/agentbbs-check/SKILL.md` (NEW) — the check read skill
- `integration/bmad/skills/agentbbs-projects/SKILL.md` (NEW) — the projects read skill
- `integration/bmad/skills/agentbbs-read/SKILL.md` (NEW) — the read-a-board/room skill
- `packages/mcp-server/src/operator-skills-doc.test.ts` (NEW) — content-guard pinning the skills to the live §6 surface (Rule 10/18, Rule 7 non-vacuous)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE) — story status ready-for-dev → in-progress → review
- `_bmad-output/implementation-artifacts/12-4-operator-read-skills.md` (UPDATE) — this story file (tasks, Dev Agent Record, Change Log, Status)

## Change Log

- 2026-06-08 — Story 12.4 implemented: authored three operator READ skills (`agentbbs-check`, `agentbbs-projects`, `agentbbs-read`) as canonical SKILL.md sources under `integration/bmad/skills/` + a Rule-10/18 content-guard (`operator-skills-doc.test.ts`), mutation-tested non-vacuous (Rule 7). No board-engine change (Rule 13 — frozen-path diff empty; 17-tool surface byte-identical). Full ROOT gate green (lint 0 / typecheck 0 / build clean / test 1631 passed / format clean). Status → review.
