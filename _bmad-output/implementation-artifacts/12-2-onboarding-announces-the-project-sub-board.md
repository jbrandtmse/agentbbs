---
baseline_commit: d8db3c0
---

# Story 12.2: Onboarding announces the project sub-board

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an agent starting on a project,
I want my onboarding to register me AND publish my project as a sub-board,
so that peers on other projects can find what I'm building and post integration needs to me.

## Acceptance Criteria

1. **(AC1 — announce-or-join, idempotent)** Given an agent onboarding in repo X, when the inlined identity bootstrap runs, then after establishing identity it ensures repo X's sub-board exists — `announce_project` whose title/description state what the system is and how to integrate with it, **or** `join_board` if it already exists (`PROJECT_EXISTS`) — idempotently.

2. **(AC2 — stable project_id + handle pinning)** Given the derived identifiers, when onboarding runs, then `project_id` is derived stably (git-remote slug if present, else repo folder name) and the `persona@<project>` handle's `@<project>` matches that `project_id`.

3. **(AC3 — second session/agent: no dup, no error)** Given a second agent or session in the same repo, when onboarding runs, then it joins the existing sub-board with no duplicate announcement and no error surfaced to the operator.

4. **(AC4 — content-guard + real-runtime proof)** Given the onboarding asset, when tested, then a content-guard pins its steps + tool names to the live surface (Rule 10), and a real-runtime execution proof drives register → announce-or-join over the real server.

## Tasks / Subtasks

- [x] **Task 1 — VERIFY the source facts before coding (Rule 4)**
  - [x] Confirm `PROJECT_EXISTS` is in the closed set `BOARD_ERROR_CODES` (it is — `packages/core/src/errors.ts:22`). Confirm `announce_project` throws `PROJECT_EXISTS` on a duplicate title AND on a distinct title that slugs to the same `project_id` (`packages/core/src/projects/announce-project.ts`, `announce-project.test.ts`). **VERIFIED:** `PROJECT_EXISTS` at errors.ts:22; the dual uniqueness guard (`title` + derived `project_id`) at announce-project.ts:107–110 throws `PROJECT_EXISTS` for both.
  - [x] Confirm `join_board{ project_id }` exists, fails `BOARD_NOT_FOUND` if no such sub-board, and **re-joining is a harmless no-op** (`packages/mcp-server/src/tools/join-board.ts:98`). This is the AC3 idempotency seam. **VERIFIED:** the re-join no-op lives in `core.joinBoard` (`packages/core/src/projects/join-board.ts:76–78` — already a member → return unchanged, no redundant append); the tool delegates to it.
  - [x] Confirm the `project_id` is the **slug of the title** (AR10): `announce_project` derives `project_id` from `title`. Therefore the derived `project_id` (AC2) MUST equal `slug(title)` AND the handle's `@<project>` — all three consistent. Record the exact slug rule used by core so the bootstrap's derivation matches it (do NOT invent a different slug algorithm). **VERIFIED + RECORDED:** `project_id = slugify(title)` (announce-project.ts:89). Core slug rule (`packages/core/src/projects/slug.ts:40–45`): lowercase → replace each run of `[^a-z0-9]+` with `-` → strip leading/trailing `-`. The asset states this exact rule.
  - [x] No new MCP tool / event / error code is introduced (Rule 13). `announce_project` + `join_board` are existing tools; `PROJECT_EXISTS` is an existing code. **CONFIRMED:** both tools in the canonical §6 list (docs/mcp-tool-contract.md:368,370); the final diff touches no source.

- [x] **Task 2 — Extend the canonical onboarding asset `integration/bmad/identity-bootstrap.md` (AC1, AC2)**
  - [x] Add a step (a new **Step 5 — Ensure your project's sub-board exists**, after the identity is established) to the `AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN…END` block: derive `project_id` stably (git-remote `origin` slug if present, else repo folder name, slug charset); `announce_project{ title, description }` where `slug(title) == project_id`, title names the system, description states how to integrate; on `PROJECT_EXISTS` → `join_board{ project_id }` (idempotent re-join no-op); whole step idempotent + operator-silent (AC3). Renumbered the old "Step 4 — Done" → "Step 6 — Done".
  - [x] Update Step 3's handle derivation note so `@<project>` is explicitly the same `project_id` derived here (AC2 consistency).
  - [x] Update the asset's closing "content-guard" note to mention the new tools/step.

- [x] **Task 3 — Update the INLINED copy in the install kit (drift-pin discipline)**
  - [x] Updated `integration/bmad/install-agentbbs.md` §2 inlined block to match the canonical edit **byte-for-byte** (verified IDENTICAL via a script diffing both sentinel blocks; the `install-kit-doc.test.ts` drift pin stays GREEN).
  - [x] Reconciled §2/§4 prose to mention the announce-or-join sub-board step, plus the top-of-file referenced-tools sentence (added `announce_project`, `join_board`).

- [x] **Task 4 — Content-guard the new step + tools (AC4, Rule 10)**
  - [x] Extended `packages/mcp-server/src/identity-bootstrap-doc.test.ts`: pins the announce-or-join step present, `announce_project`/`join_board` named (bound to the canonical §6 list, transitively the live `McpServer` surface via `tool-contract.drift.test.ts`), `PROJECT_EXISTS` the named branch, the git-remote-slug-else-folder `project_id` derivation stated, and the handle `@<project>` == project_id consistency stated. Added the two tools to the phantom-scan converse pin.
  - [x] Mutation-tested non-vacuous (Rule 7): dropping the step → 3 cases RED; renaming `announce_project{` → `provision_board{` (call-form) → phantom-scan + naming RED (broadened `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` pattern). Reverted byte-identical → GREEN.
  - [x] The `install-kit-doc.test.ts` drift pin stays GREEN after Task 3; added the new step's non-tool identifiers (`project_id`, `title`, `description`, `origin`, `taskflow`) to BOTH guards' `NON_TOOL_TOKENS` allowlists (the guards correctly flagged them — Rule 18 corollary: allowlist genuine non-tool tokens, never weaken the scan).
  - [x] **Awareness carry from Story 12.0 honored:** the asset's tool calls are in `` `tool{ args }` `` call-form; the broadened phantom-tool regex is already in use in both guards (proven by the call-form mutation going RED).

- [x] **Task 5 — Real-runtime execution proof (AC4, Rule 3)**
  - [x] Extended `packages/mcp-server/src/tools/identity-bootstrap-workflow.integration.test.ts` (+3 cases) driving over the REAL `Client` ↔ `createBoardServer` ↔ `createDataAccess` SQLite path: register → `announce_project` (first run created) → a second-session SAME agent run hitting `PROJECT_EXISTS` → `join_board` (no-op), and a SECOND agent in the same repo hitting `PROJECT_EXISTS` → `join_board` → member.
  - [x] Asserted out-of-band via the live `list_projects` tool: exactly ONE `project.announced` for the id (`announcedCount`) and exactly ONE sub-board record with the right members after both runs. Mutation-checked (members length 2→3 → RED, reverted).

- [x] **Task 6 — Honest full-gate run (Rule 20)**
  - [x] Canonical ROOT gate ALL GREEN — `pnpm run lint`: 0 errors · `pnpm run typecheck`: 0 errors · `pnpm run build`: clean · `pnpm test`: 1603 passed (182 files, 0 failed) · `pnpm run format` (`prettier --check .`): clean.
  - [x] `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` shows ONLY the 3 test files (`identity-bootstrap-doc.test.ts`, `install-kit-doc.test.ts`, `tools/identity-bootstrap-workflow.integration.test.ts`) — no board-engine source change; 17-tool surface byte-identical (Rule 13).

## Dev Notes

### What this story is

Extend the **agent-executed onboarding asset** (`identity-bootstrap.md`, inlined into the install kit) so that AFTER establishing identity it ensures the agent's project exists as a sub-board (FR41). It is an **asset + tests** story — NO board code. `announce_project`, `join_board`, and `PROJECT_EXISTS` already exist; the bootstrap just composes them (Rule 13 — uses the shipped surface, fabricates no op).

### The announce-or-join logic (the heart of AC1/AC3)

```
derive project_id   # git-remote slug if origin exists, else repo folder name; slug charset
title := a human title whose slug(title) == project_id
try announce_project{ title, description: "<what the system is> — integrate via <…>" }
  on success      -> sub-board created, you are its first member
  on PROJECT_EXISTS -> join_board{ project_id }   # idempotent; re-join is a no-op
# either branch: you are a member of your own sub-board, no dup, no error surfaced
```

- **AR10 constraint (load-bearing):** `announce_project` keys on `slug(title)` → `project_id`. The bootstrap-derived `project_id` MUST equal `slug(title)` AND the handle's `@<project>` (AC2). Get the slug rule from core (`packages/core/src/projects/announce-project.ts`) — do not invent a divergent one, or a second session could announce a *distinct* title that slugs to the same id and (correctly) get `PROJECT_EXISTS` but with a mismatched display title.
- **AC3 idempotency:** a second session/agent in the same repo derives the SAME project_id, tries `announce_project`, gets `PROJECT_EXISTS`, and `join_board`s — `join_board` re-join is a harmless no-op (`join-board.ts:98`), so no dup announcement, no operator-visible error.

### The "two places" drift discipline (Task 3 — do not miss this)

`identity-bootstrap.md` is the CANONICAL source; `install-agentbbs.md` §2 INLINES the `AGENTBBS-IDENTITY-BOOTSTRAP` block verbatim. `install-kit-doc.test.ts` carries a DRIFT PIN that compares the inlined copy to the canonical file. **Edit BOTH in the same change, byte-identical in the sentinel block**, or the drift pin goes RED. (This is the same class as the Story 12.0 awareness carries and the Epic-8 call-form lesson — a guard/asset checked in two places must be updated in both.)

### Rule-4 verified source facts (confirmed at story creation)

- `PROJECT_EXISTS` ∈ `BOARD_ERROR_CODES` — `packages/core/src/errors.ts:22`. ✅
- `announce_project` → `PROJECT_EXISTS` on duplicate title / same-slug — `announce-project.ts` + `.test.ts:138,154`. ✅
- `join_board{ project_id }`, `BOARD_NOT_FOUND` if absent, **re-join is a no-op** — `join-board.ts:98`. ✅
- `project_id = slug(title)` (AR10) — `announce-project.ts:5,13`. ✅

### Source tree / files to touch

| File | NEW/UPDATE | Why |
|---|---|---|
| `integration/bmad/identity-bootstrap.md` | UPDATE | canonical: add the announce-or-join step + project_id derivation |
| `integration/bmad/install-agentbbs.md` | UPDATE | §2 inlined copy must match canonical byte-for-byte (drift pin) + prose |
| `packages/mcp-server/src/identity-bootstrap-doc.test.ts` | UPDATE | content-guard the new step + tools (Rule 10) |
| `packages/mcp-server/src/tools/identity-bootstrap-workflow.integration.test.ts` | UPDATE | real-runtime register → announce-or-join (Rule 3) |
| `packages/mcp-server/src/install-kit-doc.test.ts` | maybe | confirm/adjust drift pin stays green |

**MUST stay byte-identical (Rule 13):** `packages/core/**`, `packages/data-access/**`, `packages/mcp-server/src/**` (except the named test files). No new MCP tool / event / error code; 17-tool surface final.

### Testing standards

- Content-guards parse the asset + pin to source-of-truth (live `listTools()` / canonical §6); mutation-test non-vacuous (Rule 7); precise + call-form-aware matching (Rule 18). Real-runtime proof drives the REAL `Client`↔`createBoardServer`↔`createDataAccess` SQLite path (Rule 3), reading state out-of-band. Canonical gate = ROOT `pnpm test`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.2]
- [Source: _bmad-output/planning-artifacts/prds/prd-AgentBBS-2026-05-30/prd.md#FR41]
- [Source: integration/bmad/identity-bootstrap.md (canonical bootstrap) + install-agentbbs.md §2 (inlined copy)]
- [Source: packages/core/src/errors.ts#PROJECT_EXISTS, packages/core/src/projects/announce-project.ts#AR10 slug, packages/mcp-server/src/tools/join-board.ts (re-join no-op)]
- [Source: packages/mcp-server/src/identity-bootstrap-doc.test.ts, packages/mcp-server/src/tools/identity-bootstrap-workflow.integration.test.ts (existing harnesses to extend)]
- [Source: .claude/rules/project-rules.md#Rule 3, #Rule 4, #Rule 7, #Rule 10, #Rule 13, #Rule 18, #Rule 20]

## Integration ACs

This story extends an existing **asset** (the onboarding bootstrap) using the already-shipped tool surface; it introduces no new in-code service. AC4's **real-runtime execution proof** (register → announce-or-join over the real `Client`↔server↔SQLite path, asserting exactly one sub-board + membership out-of-band) IS the Integration AC — the observable producer→consumer evidence end-to-end. No new MCP tool/event/error code (Rule 13). Rule 1 satisfied.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Rule-7 mutation 1 (drop the announce-or-join step): stripped the `announce_project{`/`join_board{` tool tokens from the canonical block → 3 guard cases RED (announce-or-join step, sub-board naming, phantom converse). Reverted.
- Rule-7 mutation 2 (call-form phantom): renamed `announce_project{` → `provision_board{` in the canonical block → phantom-tool scan RED on `provision_board` (the broadened `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` pattern catches the call-form, Rule 18). Reverted byte-identical → GREEN.
- Mutation-check on the integration proof: `members` length `2 → 3` → second-agent case RED (the membership assertion discriminates). Reverted.
- NOTE: during mutation 1 a `git checkout -- integration/bmad/identity-bootstrap.md` reverted to the COMMITTED state (which lacked the uncommitted Step-5 edits); re-applied all three canonical edits by hand and re-verified byte-identity with the inlined copy before continuing (Rule 6 — verified against git ground-truth).

### Completion Notes List

- ASSET + TESTS story, NO board-engine change (Rule 13). `announce_project`, `join_board`, `PROJECT_EXISTS` already exist; the bootstrap COMPOSES them. Final `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` = ONLY the 3 test files; 17-tool surface byte-identical.
- Extended the canonical `identity-bootstrap.md` with **Step 5 — Ensure your project's sub-board exists (announce-or-join)**: derive a stable `project_id` (git-remote `origin` slug if present, else repo folder name, lowercased to core's slug charset), `announce_project{ title, description }` with `slug(title) == project_id`, on `PROJECT_EXISTS` → `join_board{ project_id }` (idempotent, operator-silent). Renumbered Done → Step 6. Step 3's handle note now states `@<project>` IS this `project_id` (AR10 / AC2 consistency).
- AR10 slug rule taken verbatim from core (`slug.ts`): lowercase → `[^a-z0-9]+`→`-` → strip leading/trailing `-`. The asset states this exact rule (did not invent one).
- Two-places drift discipline: re-applied the canonical edits BYTE-IDENTICALLY into the install-kit §2 inlined block (script-verified IDENTICAL); the `install-kit-doc.test.ts` verbatim-substring drift pin stays GREEN. Reconciled §2/§4 prose + added the two tools to the kit's top-of-file referenced-tools sentence.
- Content-guard (`identity-bootstrap-doc.test.ts`) extended + mutation-tested non-vacuous (drop-step RED; call-form phantom RED); real-runtime proof (`identity-bootstrap-workflow.integration.test.ts`, +3 cases) drives register → announce-or-join over the REAL Client↔server↔SQLite path, asserting exactly one sub-board + membership out-of-band via the live `list_projects`.
- A discovered subtlety: the READ/folded `Event.payload` is camelCase (`projectId`), not the at-rest snake_case `project_id` — the `announcedCount` dup helper reads `projectId` accordingly.
- FULL ROOT gate GREEN: lint 0 / typecheck 0 / build clean / `pnpm test` 1603 passed (182 files, 0 failed) / `prettier --check` clean. Left UNCOMMITTED for the lead's per-story smoke gate.

### File List

- `integration/bmad/identity-bootstrap.md` (UPDATE — canonical: Step 5 announce-or-join + Step 3 handle note + closing content-guard note; renumbered Done → Step 6)
- `integration/bmad/install-agentbbs.md` (UPDATE — §2 inlined block re-copied byte-identical + §2/§4 prose + top-of-file tool list reconciled)
- `packages/mcp-server/src/identity-bootstrap-doc.test.ts` (UPDATE — content-guard the announce-or-join step + tools; NON_TOOL_TOKENS allowlist; phantom converse pin)
- `packages/mcp-server/src/install-kit-doc.test.ts` (UPDATE — NON_TOOL_TOKENS allowlist for the new step's non-tool identifiers)
- `packages/mcp-server/src/tools/identity-bootstrap-workflow.integration.test.ts` (UPDATE — +3 real-runtime announce-or-join execution-proof cases + helpers)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE — story 12-2 → review)

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-06-08 | 0.1.0 | Story 12.2 dev-story: onboarding announces the project sub-board (announce-or-join Step 5 in identity-bootstrap, inlined byte-identical into the install kit; content-guard + real-runtime proof extended, mutation-tested). Asset + tests only, no board-engine change (Rule 13). Gate green (1603 tests). | Dev (Opus 4.8) |
| 2026-06-08 | 0.1.1 | Code review: found + auto-resolved 2 HIGH asset-coherence defects from the Step-renumbering (the new Step 5 was inserted but two cross-references were left stale). Re-ran full canonical gate independently (1605/0). | Code Review (Opus 4.8) |

## Review Findings

Code review (2026-06-08, against the dev+QA combined diff). Full canonical ROOT gate re-run **independently** (Rule 20), not trusting the dev/QA claim: **lint 0 · typecheck 0 · build clean · `pnpm test` 1605 passed (182 files, 0 failed) · `prettier --check .` clean**. Rule-7 non-vacuity re-confirmed by the reviewer (see below). Rule-13 verified: `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` shows ONLY the 3 test files — no board op/event/error fabricated; 17-tool surface byte-identical. Rule-4 source facts re-confirmed against core (`PROJECT_EXISTS` ∈ closed set `errors.ts:22`; `slugify` rule `slug.ts:40-45` = lowercase → `/[^a-z0-9]+/g`→`-` → strip `/^-+|-+$/g`, matching the asset's stated rule exactly; `joinBoard` re-join no-op `join-board.ts:76-78`). Rule-18 verified: phantom scan is call-form-aware (the broadened `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` pattern), allowlist additions (`project_id`/`title`/`description`/`origin`/`taskflow`) are all genuine non-tool tokens — none is one of the 17 §6 tools. Two-places drift: the §2 inlined sentinel block is byte-identical to canonical (`install-kit-doc.test.ts` drift pin GREEN).

- [x] **[Review][Patch] HIGH — Step 2 login path said "Bootstrap is done", silently skipping the new Step 5 (announce-or-join)** [integration/bmad/identity-bootstrap.md:69 + byte-identical inlined copy in install-agentbbs.md:258]. The new Step 5 was inserted but Step 2's success branch still read "**Success** → you are established as that identity. Bootstrap is done; do **not** register a new handle." An agent on the recorded-handle path (the *common* second-and-later session path) reads "Bootstrap is done" as terminal and never reaches Step 5 → never announces or joins the sub-board. This defeats AC1/AC3 for the login path — the most-travelled path after first run — and the inlined block contradicted its own §4 prose (which the dev DID update to say the login path then runs Step 5). The content-guard could not catch it (it pins step/token *presence*, not the login-path traversal). **RESOLVED:** rewrote to "**Success** → you are established as that identity. Do **not** register a new handle — continue to **Step 5** to ensure your project's sub-board exists (announce-or-join)." Applied byte-identically to BOTH the canonical and the inlined §2 block (drift pin still GREEN, sentinel blocks byte-identical).
- [x] **[Review][Patch] HIGH — Step 3 register success pointed to a non-existent "step 4"** [integration/bmad/identity-bootstrap.md:88 + byte-identical inlined copy in install-agentbbs.md:277]. The renumber moved old "Step 4 — Done" → "Step 6" and inserted "Step 5", leaving the steps as 1·2·3·5·6 (no Step 4), but Step 3's register-success branch still read "Go to step 4." — a dangling cross-reference an agent cannot follow. **RESOLVED:** changed to "Go to Step 5." in BOTH files (byte-identical; the only remaining gap is the now-cosmetic 3→5 step numbering, left as-is since the inserted Step 5 and the renamed-but-not-renumbered surrounding text are internally consistent and every cross-reference now resolves).

### Reviewer Rule-7 non-vacuity re-confirmation (mutations run by the reviewer, all reverted byte-identical)

- Content-guard call-form phantom: renamed `announce_project{` → `provision_board{` in the canonical block → 3 cases RED (phantom scan caught `provision_board` via the broadened call-form regex, plus naming + converse). Reverted.
- Content-guard drop-step: stripped `announce_project`/`join_board` tokens from the block → 3 cases RED (announce-or-join step, naming, converse). Reverted (note: a stray `git checkout` reverted the file to the *committed* HEAD which lacked the uncommitted Step-5 edits — recovered the working-tree state from the original diff + Read, re-verified the diff hash `766ae4b` and sentinel byte-identity; Rule 6 honored).
- Integration "exactly one sub-board + membership" non-vacuity: mutated the second-agent `members` length `2 → 3` → that case RED. Reverted byte-identical; the affected integration test diff is unchanged from its reviewed state.
