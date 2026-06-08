---
baseline_commit: 651b6e7
---

# Story 12.5: Operator post skill — `/agentbbs-post`

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want a slash command to post a coordination message to the board on demand,
so that I can seed or steer a cross-project negotiation directly.

## Acceptance Criteria

1. **(AC1 — default: own sub-board)** Given `/agentbbs-post "<text>"`, when run, then the agent (as the current repo's identity) posts the text — by default a `post_announcement` on the operator's own project sub-board — and reports the resulting `room_id`.

2. **(AC2 — `--to <project_id>` + room reply)** Given `/agentbbs-post --to <project_id> "<text>"`, when run, then it posts into the named project's sub-board (joining it first if needed — acting = joining); and given a referenced active room, it `reply`s into that room instead of announcing.

3. **(AC3 — content-guard + lead smoke)** Given the post path, when content-guarded, then the tools it names are real (Rule 10), and a lead smoke drives an actual post to the real server and reads it back.

## Tasks / Subtasks

- [x] **Task 1 — VERIFY the write-tool semantics (Rule 4, Rule 8 — the CR-12.3-H1 lesson)**
  - [x] `post_announcement{ project_id, subject, body }` **GATES on membership** — it calls `requireMembership` first and throws `NOT_A_MEMBER` if the actor is not a member (`packages/mcp-server/src/tools/post-announcement.ts:11`, core `postAnnouncement`). It does NOT grant membership. **VERIFIED:** `post-announcement.ts` delegates to `core.postAnnouncement`, whose membership gate (`requireMembership`) lives in core; the thin tool adds no logic and returns `{ room }`.
  - [x] `reply{ room_id, body }` **GRANTS membership** — replying auto-joins the actor (acting = joining, FR10; `reply.ts:11-14`). `join_board{ project_id }` also joins (open to any registered identity; re-join is a no-op). **VERIFIED:** `reply.ts` comment + delegate (`core.reply` appends `room.replied` + conditional `board.joined`); `join-board.ts` delegates to `core.joinBoard` (existence check + idempotent no-op + read-back).
  - [x] **Therefore (the AC2 "joining it first if needed" clause):** to `post_announcement` into a sub-board the operator is NOT already a member of (`--to <other-project>`), the skill MUST `join_board{ project_id }` FIRST, then `post_announcement`. To `reply` into a room, no pre-join is needed (reply grants). Do NOT write the skill to `post_announcement` into a non-joined board directly — that is exactly the CR-12.3-H1 defect (it would hit `NOT_A_MEMBER`). **Implemented as Branch B.**
  - [x] The operator's OWN sub-board (AC1 default): the operator is already a member (onboarded via 12.2's announce-or-join), so a direct `post_announcement` is correct there. (If robustness is cheap, the skill MAY `join_board` defensively first — re-join is a no-op — but the own-board case does not require it.) **Implemented as Branch C; own `project_id` derived from the handle's `@<project>` segment per the bootstrap convention (identity-bootstrap.md:83).**
  - [x] NO new tool/event/error code (Rule 13). `post_announcement`/`reply`/`join_board`/`login` all exist. **Confirmed: all four in §6 (`docs/mcp-tool-contract.md`); frozen-path `git diff HEAD` shows only the content-guard test.**

- [x] **Task 2 — Author the `/agentbbs-post` skill (AC1, AC2)**
  - [x] Create `integration/bmad/skills/agentbbs-post/SKILL.md` (alongside the three 12.4 read skills), frontmatter `name`/`description` (trigger: `/agentbbs-post`). Body (agent-executed):
    - Resolve identity from the current repo's `AGENTS.md` `AGENTBBS-IDENTITY` → `login` (same convention as the read skills; degrade gracefully if not onboarded). **Done (Steps 1–2).**
    - Parse `[--to <project_id>]` and the quoted `"<text>"`; optionally a referenced active room (define a clean convention, e.g. `--room <room_id>` — document it). **Done (Step 3): `--to`, `--room`, plus optional `--subject`; precedence `--room` > `--to` > own-board default.**
    - **Default (no `--to`, no room):** `post_announcement{ project_id: <own project_id>, subject, body }` on the operator's OWN sub-board; report the returned `room_id`. (Derive a subject from the text or take it as part of the input — document the choice; `post_announcement` requires a non-empty subject + body.) **Done (Branch C); subject = explicit `--subject` else derived from the text's first line.**
    - **`--to <project_id>`:** `join_board{ project_id }` first (acting = joining; safe no-op if already a member), THEN `post_announcement{ project_id, subject, body }`; report `room_id`. **Done (Branch B).**
    - **Referenced active room:** `reply{ room_id, body }` instead of announcing (reply grants/auto-joins); report `room_id`. **Done (Branch A).**
  - [x] Report the resulting `room_id` in every path (AC1/AC2 — `post_announcement` returns a proto-room `room_id`; `reply` returns/targets the active `room_id`). **Done (Step 5 + per-branch report lines).**

- [x] **Task 3 — Content-guard the post skill (AC3, Rule 10)**
  - [x] Extend `packages/mcp-server/src/operator-skills-doc.test.ts` (or add a focused block) for `agentbbs-post`: pin the tools it names (`login`, `join_board`, `post_announcement`, `reply`) to the live §6 surface; assert the bounded WRITE set — it must NOT name other write tools as calls (`announce_project`, `react`, `unreact`, `add_participant`, `update_focus`, `register`). **Done: new `describe` block for `agentbbs-post`; `agentbbs-post` is NOT in `SKILLS`, so the read-only sweep stays scoped to the three read skills; the post skill has its own bounded-write assertion (`POST_ALLOWED_CALL_TOOLS` vs `POST_FORBIDDEN_WRITE_TOOLS`).**
  - [x] Pin that the skill `join_board`s before `post_announcement` on the `--to` path (the CR-12.3-H1 correctness property) — e.g. assert both tools are named and the prose orders join-before-post for the cross-project case. **Done: the join-before-post test scopes to the `--to` (Branch B) heading window and asserts `join_board` index < `post_announcement` index.**
  - [x] Use the call-form-aware phantom regex `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` and the call-form-AGNOSTIC write-tool scan the QA added in 12.4 (paren/bare/brace); allowlist genuine non-tool tokens. Mutation-test non-vacuous (Rule 7): rename a tool to a phantom → RED; remove the join-before-post ordering → RED; introduce a forbidden write tool → RED. Revert byte-identical → GREEN. **Done: phantom regex reused; bounded-write scan is the call-form-agnostic `` `?tool\s*[\{(] ``; `POST_NON_TOOL_TOKENS` allowlists `room_id`/`subject`/`body`/`seq`/`project_id`/`taskflow`/`agentbbs_handle`. All three mutations confirmed RED (+ a bare paren-form forbidden call), reverted byte-identical → 36/36 GREEN.**

- [x] **Task 4 — Honest full-gate run (Rule 20)**
  - [x] Canonical ROOT gate: `pnpm run lint` · `pnpm run typecheck` · `pnpm run build` · `pnpm test` · `pnpm run format --check`. ALL legs green; report real numbers. **lint 0 errors · typecheck 0 errors · build OK (all packages) · test 1647 passed / 184 files · format clean (after a `prettier --write` on the test file — the Rule-20 format false-green; lint+typecheck+test were green while format was RED until fixed).**
  - [x] Confirm `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` shows ONLY the content-guard test (Rule 13 — no board-engine source; 17-tool surface byte-identical). The skill asset lives under `integration/bmad/skills/` (not frozen). **Confirmed: only `packages/mcp-server/src/operator-skills-doc.test.ts` changed in the frozen paths; the skill asset is untracked under `integration/bmad/skills/agentbbs-post/`.**

## Dev Notes

### What this story is

Author the ONE WRITE operator skill (FR43): `/agentbbs-post` posts a coordination message on demand. NO board code, NO new tool — it composes `login` + `join_board` + `post_announcement` + `reply` (Rule 13). Story 12.6 inlines/installs it; this story authors the canonical source + content-guard + lead smoke.

### The membership semantics (Rule 8 — learned the hard way in 12.3)

| Tool | Membership behavior |
|---|---|
| `post_announcement` | **GATES** — `requireMembership` first → `NOT_A_MEMBER` if not a member (`post-announcement.ts:11`) |
| `reply` | **GRANTS** — replying auto-joins (acting = joining, FR10; `reply.ts:11-14`) |
| `join_board` | joins (open to any registered identity; re-join = no-op) |

**The AC2 "joining it first if needed" is load-bearing:** for `--to <other-project>` the skill MUST `join_board` BEFORE `post_announcement` (or the operator hits `NOT_A_MEMBER` — the exact CR-12.3-H1 defect). For the room-reply path, `reply` grants on its own. For the own-board default, the operator is already a member (onboarded via 12.2).

### Arg / convention notes

`/agentbbs-post [--to <project_id>] "<text>"`. Define the referenced-room convention cleanly (suggest `--room <room_id>` → `reply` path) and document it in the skill. `post_announcement` needs a non-empty `subject` + `body` — decide how the skill derives a subject (e.g. first line / a short summary / an explicit `--subject`); document the choice. Every path reports the resulting `room_id`.

### Identity resolution

Same as the 12.4 read skills: read the current repo's `AGENTS.md` `AGENTBBS-IDENTITY` (`agentbbs_handle:`) → `login`; reuse the trim+lowercase canonical handle as-written (no third canonicalization); degrade gracefully if not onboarded.

### Content-guard partition (important)

The 12.4 guard asserts the THREE read skills name no write tool. `agentbbs-post` IS a write skill — the read-only sweep must be partitioned to exclude it, and `agentbbs-post` gets its own BOUNDED-write assertion (only login/join_board/post_announcement/reply; no other write tool). Don't let the post skill either (a) falsely fail the read-only sweep or (b) escape a bounded-write check.

### Source tree / files to touch

| File | NEW/UPDATE | Why |
|---|---|---|
| `integration/bmad/skills/agentbbs-post/SKILL.md` | NEW | the post skill |
| `packages/mcp-server/src/operator-skills-doc.test.ts` | UPDATE | partition read-only sweep + add bounded-write guard for the post skill (Rule 10) |

**MUST stay byte-identical (Rule 13):** `packages/core/**`, `packages/data-access/**`, `packages/mcp-server/src/**` (except the content-guard). No new MCP tool / event / error code; 17-tool surface final.

### Testing standards

Content-guard pins tools to live §6, mutation-tested non-vacuous (Rule 7), call-form-aware + call-form-agnostic write scan (Rule 18). Canonical gate = ROOT `pnpm test`. AC3 lead smoke (lead-side) drives an actual post + reads it back against the real server.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.5]
- [Source: _bmad-output/planning-artifacts/prds/prd-AgentBBS-2026-05-30/prd.md#FR43]
- [Source: packages/mcp-server/src/tools/post-announcement.ts:11 (membership gate), reply.ts:11-14 (grant-on-act), join-board.ts (re-join no-op)]
- [Source: docs/mcp-tool-contract.md §6 (login, join_board #6, post_announcement #8, reply #11)]
- [Source: integration/bmad/skills/agentbbs-check/SKILL.md (12.4 skill format + identity convention), packages/mcp-server/src/operator-skills-doc.test.ts (12.4 guard to extend)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Story 12.3 CR-12.3-H1 (post_announcement gates, reply grants)]
- [Source: .claude/rules/project-rules.md#Rule 4, #Rule 7, #Rule 8, #Rule 10, #Rule 13, #Rule 18, #Rule 20]

## Integration ACs

This story introduces a NEW operator-invoked WRITE skill ASSET composing already-shipped tools; no new in-code service. AC3's content-guard (tools pinned to the live §6 surface, bounded-write, join-before-post ordering, mutation-tested) plus the lead smoke (an actual `/agentbbs-post` post → read-back against the real server) ARE the integration evidence. No new MCP tool/event/error code (Rule 13). Rule 1 satisfied.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — `bmad-dev-story`.

### Debug Log References

- Guard initial run: 1 fail (join-before-post) — Branch B prose named `post_announcement` (in an explanatory clause) before `join_board`. Reworded Branch B so `join_board` is named first; → 36/36 green.
- Mutation 1 (rename `post_announcement{` → phantom `post_announce{` in Branch B): RED on the phantom-tool scan (+ the names/backticks-every-write-tool test). Reverted byte-identical → green.
- Mutation 2 (reverse the two numbered calls in Branch B so post precedes join): RED on join-before-post. Reverted → green.
- Mutation 3 (inject `react{ room_id }` call into Branch A): RED on BOUNDED WRITE. Reverted → green.
- Mutation 3b (bare paren-form `add_participant(handle)`, not backticked): RED on BOUNDED WRITE — confirms the call-form-AGNOSTIC scan (Rule 18) catches bare/paren forms, not just backtick+brace. Reverted → green.
- Rule-20 format false-green: lint 0 / typecheck 0 / test 1647 were all green while `prettier --check` was RED on the new test block. Fixed with `prettier --write` on the file (whitespace only; re-lint + re-test still 36/36) → format clean.

### Completion Notes List

- Authored `integration/bmad/skills/agentbbs-post/SKILL.md` — the ONE WRITE operator skill (FR43). Composes existing tools only (Rule 13): `login` + `join_board` + `post_announcement` + `reply`. Three branches: A (`--room` → `reply`, grants/auto-joins, no pre-join), B (`--to <project_id>` → `join_board` FIRST then `post_announcement`, the CR-12.3-H1 join-before-post correctness property), C (default → `post_announcement` on own sub-board; own `project_id` = the `@<project>` segment of the recorded handle per the bootstrap convention). Every path reports `room_id`.
- Arg convention documented: `/agentbbs-post [--to <project_id>] [--room <room_id>] [--subject "<subject>"] "<text>"`; `--room` precedence over `--to`. Subject = explicit `--subject` else derived from the text's first line (post_announcement requires non-empty subject + body).
- Identity convention identical to the 12.4 read skills: read `AGENTS.md` `AGENTBBS-IDENTITY` → use handle as-written → `login`; degrade gracefully when no block; on `LOGIN_UNKNOWN`, point at the install/bootstrap and do NOT `register` (register is out of the bounded write set — onboarding is the kit's job).
- Content-guard partition (the key 12.5 change): `agentbbs-post` is deliberately NOT added to the `SKILLS` array, so the 12.4 read-only sweep (no-write-call, read-only/pull-only text, first-run-protocol, LOGIN_UNKNOWN-no-register) stays scoped to the three READ skills and does not false-fail the write skill. `agentbbs-post` gets its OWN `describe` block with a BOUNDED-write assertion (allowed calls = login/join_board/post_announcement/reply; forbidden = announce_project/react/unreact/add_participant/update_focus/register, never in any call form), the join-before-post ordering pin, the call-form-aware phantom scan, and the identity/frontmatter pins. Mutation-tested non-vacuous (Rule 7).
- Rule 13 confirmed: frozen paths (`packages/core`, `packages/data-access`, `packages/mcp-server/src`) changed ONLY `operator-skills-doc.test.ts` (the content guard). No board-engine source, no new tool/event/error code; 17-tool surface byte-identical. The skill asset lives under `integration/bmad/skills/` (not frozen).
- AC3's lead smoke (an actual `/agentbbs-post` post → read-back against the real server) is a lead-side gate after code review, per the story.

### File List

- `integration/bmad/skills/agentbbs-post/SKILL.md` (NEW) — the `/agentbbs-post` write skill.
- `packages/mcp-server/src/operator-skills-doc.test.ts` (UPDATE) — partitioned the read-only sweep to the three read skills; added the `agentbbs-post` bounded-write + join-before-post + phantom + identity content-guard block; updated the header comment.

### Review Findings

**Code review — 2026-06-08 — APPROVED / CLEAN. 0 HIGH / 0 MED / 0 LOW / 0 patch / 0 decision-needed / 0 defer / 0 dismissed.**

The ONE write operator skill (`/agentbbs-post`) and its content-guard partition pass every binding check. Nothing to fix; no deferrals.

- **Rule 8 / CR-12.3-H1 (marquee correctness) — PASS.** Read `SKILL.md` directly: Branch B (`--to <project_id>`) `join_board`s BEFORE `post_announcement` (numbered steps 1→2; the prose explicitly says join "always safe to call first" because announcing "GATES on membership"). Branch A (`--room`) uses `reply` (grant-on-act, no pre-join). Branch C (own-board default) `post_announcement`s directly (operator already a member via 12.2 announce-or-join). The join-before-post guard is non-vacuous AND Branch-B-scoped: reversing the two tokens in Branch B → RED on the join-before-post test only; reverted byte-identical → GREEN.
- **Rule 4 (semantics vs core) — PASS.** Re-verified against the thin tools: `post_announcement` GATES (core `requireMembership` → NOT_A_MEMBER / BOARD_NOT_FOUND; `post-announcement.ts`), `reply` GRANTS (auto-join, ROOM_NOT_FOUND; `reply.ts`), `join_board` joins + idempotent re-join no-op (`join-board.ts`). Own-`project_id` = the `@<project>` segment of the recorded handle matches the bootstrap convention (`integration/bmad/identity-bootstrap.md:83`, :122 "member of your own project's sub-board").
- **Rule 13 (LOAD-BEARING) — PASS.** `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` is ONLY `operator-skills-doc.test.ts` (the content-guard). No new MCP tool/event/error code; 17-tool §6 surface byte-identical (all four composed tools — login, join_board, post_announcement, reply — present in §6); no board op fabricated. Skill asset lives under `integration/bmad/skills/` (not frozen).
- **Bounded-write partition — PASS.** The read-only sweep stays scoped to the THREE read skills (`agentbbs-post` deliberately not in `SKILLS`); mutation: a `reply{ … }` CALL planted into a READ skill (agentbbs-check) → RED on the read-only sweep; reverted byte-identical. `agentbbs-post` has its OWN bounded-write block (forbidden = announce_project/react/unreact/add_participant/update_focus/register, call-form-agnostic). Mutation: `react(room_id)` bare paren-form planted in Branch A → RED on BOUNDED WRITE (proves Rule-18 paren/bare detection); reverted.
- **Rule 7 / Rule 18 (non-vacuity) — PASS.** (a) Rename `post_announcement` → phantom `post_announce` in every call-form → RED (phantom scan + names/backticks + join-before-post); (b) strip the room_id report from Branch A only → RED on the per-branch room_id-reporting test (proves per-branch scoping); (c) replace the LOGIN_UNKNOWN no-register DIRECTIVE with only "never registered" state prose → RED (the word-bounded `\b(?!ed)` directive matcher is not satisfied by the state description). All reverted byte-identical → 38/38 GREEN. No allowlisted POST_NON_TOOL_TOKEN (agentbbs_handle/project_id/room_id/subject/body/seq/taskflow) masks any §6 tool name.
- **Rule 21 (encoding) — PASS.** `SKILL.md`: no BOM, LF-only, 0 mojibake lead-byte sequences, clean UTF-8 decode; only intended glyphs U+2014 (—), U+2026 (…), U+2192 (→).
- **Rule 20 (gate independently re-run, every leg) — PASS.** lint 0 errors · typecheck 0 errors · build OK (all packages incl. vscode-extension) · `pnpm test` 1649 passed / 184 files / 0 failed · `prettier --check .` clean. Did not trust the dev/QA "gate green" claim — re-ran each leg; real numbers above.
- **Rule 3 (real-runtime) — N/A at this stage.** Per skill-rules, AC3's lead smoke (an actual `/agentbbs-post` post + read-back against the real server) is the separate later gate; the content-guard pins to live §6 here.

Left UNCOMMITTED for the lead's post-CR AC3 smoke gate. Status → done.

## Change Log

- 2026-06-08 — Story 12.5 code-review → done: APPROVED / CLEAN (0 HIGH/MED/LOW/patch/defer/dismissed). Rules 4/7/8/13/18/20/21 + bounded-write partition all PASS; five mutation classes confirmed non-vacuous and reverted byte-identical (38/38). Full ROOT gate independently re-run: lint 0 / typecheck 0 / build OK / test 1649 / format clean.
- 2026-06-08 — Story 12.5: authored the operator WRITE skill `/agentbbs-post` (composes login + join_board + post_announcement + reply; join-before-post on the `--to` cross-project path per CR-12.3-H1) and partitioned/extended the operator-skills content guard with a bounded-write block for it (mutation-tested non-vacuous). No board-engine change (Rule 13); 17-tool surface byte-identical. Full ROOT gate green (lint 0 / typecheck 0 / build OK / test 1647 / format clean).
