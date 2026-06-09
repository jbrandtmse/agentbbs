---
baseline_commit: 3106415
---

# Story 12.3: Cross-project integration guidance

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an agent that depends on or shares code with another project,
I want documented guidance on using the board to coordinate that integration,
so that I negotiate the boundary directly with the other project's agent instead of routing through the human.

## Acceptance Criteria

1. **(AC1 — the play is documented)** Given the skill-rules registry and the prompt snippet, when inspected, then they include a "reaching out to integrate with another project" play: `list_projects` to find the target → `list_members` / `read_room` for context → `post_announcement` the integration need into the target's sub-board (or `reply` into a relevant room) → negotiate via the four moves → `add_participant` the operator on deadlock or no-show.

2. **(AC2 — content-guarded, non-vacuous, no new tool)** Given the play, when content-guarded, then every tool it names is a real advertised tool (Rule 10), mutation-tested non-vacuous, **and** no new MCP tool is introduced (the play uses the shipped surface).

## Tasks / Subtasks

- [x] **Task 1 — VERIFY the tool surface the play names (Rule 4, Rule 13)**
  - [x] Confirm every tool the play names is in the canonical §6 list (`docs/mcp-tool-contract.md`) and the live surface: `list_projects` (#5), `list_members` (#7), `read_room` (#12), `post_announcement` (#8), `reply` (#11), `react`/`unreact`/`read_contract` (the four moves), `add_participant` (#13). All exist — **introduce NO new tool/event/error code** (Rule 13). VERIFIED: `docs/mcp-tool-contract.md` §6 sentinel block (lines 364–382) lists all 17 tools; every play tool present.
  - [x] Note the semantics the play must honor (do not contradict shipped behavior, Rule 8): read is board-wide public (any registered identity can `list_projects`/`list_members`/`read_room` any sub-board without joining); posting requires membership but `post_announcement`/`reply` GRANT it (acting = joining); `add_participant` pulls a registered peer (here the operator) into a room you participate in. These semantics are reflected in the play prose (steps 1–3 note open-read; step 3 notes acting=joining; step 5 the escalation pull).

- [x] **Task 2 — Add the play to the skill-rules registry (AC1)**
  - [x] `integration/bmad/skill-rules.md`: added **Rule C — Reaching out to integrate with another project (FR42)** (after Rule B): `list_projects` → `list_members`/`read_room` → `post_announcement`/`reply` → four moves (Rule B) → `add_participant{ @operator }`. Stated as a convention over the shipped surface, board enforces none of it.

- [x] **Task 3 — Add the play to the agent-prompt snippet (AC1)**
  - [x] `integration/bmad/agent-prompt-snippet.md`: added **"### 4. Reaching out to integrate with another project"** inside the `AGENTBBS-PROMPT-SNIPPET:BEGIN…END` block, naming the same tools/steps as Rule C (Rule 8 — no drift between assets).

- [x] **Task 4 — Update the INLINED copies in the install kit (two-places drift discipline)**
  - [x] `integration/bmad/install-agentbbs.md`: updated BOTH inlined copies — §3.1 (registry, Rule C) and §3.7 (snippet, §4) — BYTE-IDENTICAL to the canonical edits. `install-kit-doc.test.ts` drift pins stay GREEN (they re-read the canonical source at test time and compare to the kit's inlined copy).
  - [x] No kit prose enumerates the registry/snippet sections by number, so no further reconciliation needed (verified — §3.1/§3.7 carry the bodies, not a section index).

- [x] **Task 5 — Content-guard the play + CLOSE the 7.3-snippet-callform-latent gap (AC2, Rule 10, Rule 18) — the Story 12.0 awareness carry lands HERE**
  - [x] Extended `packages/mcp-server/src/skill-rules-registry-doc.test.ts`: added a Rule-C presence test (`PLAY_TOOLS` = list_projects/list_members/post_announcement/add_participant pinned present), allowlisted `project_id` as a non-tool param, and extended the converse-sanity loop to require the play tools. (Guard already used the broadened regex at line 149.)
  - [x] Extended `packages/mcp-server/src/agent-prompt-snippet-doc.test.ts`: added a §4 play presence test + `PLAY_TOOLS` pins; **BROADENED the phantom regex** from `` /`([a-z][a-z_]{2,})`/g `` to `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` (the play writes call-form refs `post_announcement{ project_id }`, `add_participant{ @operator }` etc.) — this CLOSES `7.3-snippet-callform-latent`; allowlisted `project_id`; extended the converse-sanity tool list to include the four play tools.
  - [x] Mutation-tested BOTH guards non-vacuous (Rule 7): (1) dropped `list_projects` from the registry play → RED (presence + converse-sanity); (2) renamed `post_announcement{` → `postannounce{` (call-form) in BOTH assets → RED in both guards; (3) the exact 7.3/8.1 proof — planted call-form-only phantom `` `provision{ project_id }` ``: direct regex comparison confirmed the OLD narrow regex does NOT capture it (would slip GREEN) while the BROADENED regex DOES → guard RED on `["provision"]`. All assets reverted byte-identical (`cmp` confirmed); both guards re-GREEN.
  - [x] Allowlisted `project_id` (Rule 18 — minimal allowlist, not a weakened scan); the broadening is additive (still catches every closing-backtick form the old regex caught). `@operator` is not a backticked snake token so it is not a candidate.

- [x] **Task 6 — Honest full-gate run (Rule 20)**
  - [x] Canonical ROOT gate ALL GREEN: `pnpm run lint` 0 · `pnpm run typecheck` 0 · `pnpm run build` clean (all packages + both vscode bundles) · `pnpm test` **1607 passed / 182 files / 0 failed** · `pnpm run format --check` clean.
  - [x] `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` shows ONLY the two `*-doc.test.ts` files (Rule 13 — no board-engine source; 17-tool surface byte-identical).
  - [x] Marked `7.3-snippet-callform-latent` RESOLVED in `deferred-work.md` (the snippet regex was broadened) — new "Resolved in: dev-story of story 12.3" section added.

## Dev Notes

### What this story is

A **guidance/asset** story (FR42): document the cross-project integration play in the two agent-facing assets (the skill-rules registry + the prompt snippet), plus content-guards. NO board code, NO new tool — it composes the shipped surface (Rule 13). The play is the explicit "how to reach another project's agent and negotiate a boundary" recipe that makes FR41's discoverable sub-boards actionable.

### The play (consistent wording across both assets)

```
1. list_projects                       # find the target project's sub-board (project_id)
2. list_members / read_room            # read who's there + the relevant room context
3. post_announcement (or reply)        # post the integration NEED into the target's sub-board
                                        #   (post_announcement = a new proto-room; reply = into an existing active room)
4. negotiate via the four moves        # Propose/Counter (reply) -> Ratify (react/unreact) -> Frozen (read_contract)  [Rule B]
5. add_participant(@operator)          # on deadlock or no-show, pull the operator in to nudge it
```

All tools are shipped (Rule 4 verified at story creation against §6). The play honors shipped semantics: read is board-wide public; `post_announcement`/`reply` grant membership (acting = joining); `add_participant` pulls a registered peer into a room you're in.

### The 7.3-snippet-callform-latent carry (Story 12.0 → resolve here)

The snippet content-guard (`agent-prompt-snippet-doc.test.ts`, line ~273) uses the NARROW phantom regex `` /`([a-z][a-z_]{2,})`/g `` (closing-backtick only). The registry guard already uses the broadened `(?:`|\{)` form. The `7.3-snippet-callform-latent` deferred item says: the moment the snippet block gains a `` `tool{ args }` `` call-form reference, broaden the snippet regex (the Story 8.1 template) or a call-form-only phantom slips GREEN. **If the new play writes call-form tool refs in the snippet, this story closes that gap** (broaden + mutation-prove + mark resolved in deferred-work). If the play uses only bare-backtick form, record that the latent gap remains latent (and why) — do not broaden gratuitously, but DO prove the choice (a call-form mutation test demonstrating the asset uses no call-form, mirroring the 7.3 rationale).

### Two-places drift discipline

`skill-rules.md` (canonical) → install kit §3.1 inlined; `agent-prompt-snippet.md` (canonical) → install kit §3.7 inlined. `install-kit-doc.test.ts` drift-pins both. Edit canonical + inlined byte-identically. (Story 12.2 hit this; same here.)

### Consistency constraint (Rule 8)

The registry, the snippet, and `docs/negotiation-protocol.md` describe the SAME cadence + four moves. The new play references Rule B's four moves — keep the wording consistent across the registry's Rule C and the snippet's new section (the registry guard asserts the assets don't drift from each other / the cadence hook). Don't introduce a play in one asset that contradicts the other.

### Source tree / files to touch

| File | NEW/UPDATE | Why |
|---|---|---|
| `integration/bmad/skill-rules.md` | UPDATE | add Rule C (the play) |
| `integration/bmad/agent-prompt-snippet.md` | UPDATE | add the parallel play section |
| `integration/bmad/install-agentbbs.md` | UPDATE | §3.1 + §3.7 inlined copies byte-identical to canonical |
| `packages/mcp-server/src/skill-rules-registry-doc.test.ts` | UPDATE | pin Rule C + tools (Rule 10) |
| `packages/mcp-server/src/agent-prompt-snippet-doc.test.ts` | UPDATE | pin the play + (likely) broaden the phantom regex (close 7.3 carry) |
| `packages/mcp-server/src/install-kit-doc.test.ts` | maybe | confirm drift pins stay green |
| `_bmad-output/implementation-artifacts/deferred-work.md` | UPDATE | mark 7.3-snippet-callform-latent resolved (if regex broadened) |

**MUST stay byte-identical (Rule 13):** `packages/core/**`, `packages/data-access/**`, `packages/mcp-server/src/**` (except the named guards). No new MCP tool / event / error code; 17-tool surface final.

### Testing standards

Content-guards parse the asset + pin tool names to the live §6 (NOT a hand-copy); mutation-test non-vacuous (Rule 7); precise + call-form-aware matching (Rule 18). Canonical gate = ROOT `pnpm test`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.3]
- [Source: _bmad-output/planning-artifacts/prds/prd-AgentBBS-2026-05-30/prd.md#FR42]
- [Source: integration/bmad/skill-rules.md (Rule A/B — add Rule C), agent-prompt-snippet.md]
- [Source: docs/mcp-tool-contract.md §6 (list_projects #5, list_members #7, post_announcement #8, reply #11, read_room #12, add_participant #13)]
- [Source: packages/mcp-server/src/skill-rules-registry-doc.test.ts (broadened regex @149), agent-prompt-snippet-doc.test.ts (narrow regex @273 — the 7.3 carry)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#7.3-snippet-callform-latent, #Story 12.0 awareness carry]
- [Source: .claude/rules/project-rules.md#Rule 4, #Rule 7, #Rule 8, #Rule 10, #Rule 13, #Rule 18, #Rule 20]

## Integration ACs

This story documents a play over the **already-shipped** tool surface; it introduces no new in-code service/tool. AC2's content-guard (every named tool pinned to the live §6 surface, mutation-tested non-vacuous) IS the verification that the play references only real tools — no producer/consumer wiring to integrate. No new MCP tool/event/error code (Rule 13). Rule 1 satisfied (guidance-only asset; the guard is the binding check).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — bmad-dev-story.

### Debug Log References

- Baseline three-guard run: 47 passed (3 files).
- After asset edits (before guard updates): 2 RED — both guards correctly flagged `project_id` as a tool-looking backticked token (anticipated by Rule 18; allowlisted).
- After guard updates: 49 passed (3 files, incl. install-kit drift pins).
- Mutation 1 (drop `list_projects` from registry play): registry guard 2 RED (presence + converse-sanity) → reverted byte-identical → 19 passed.
- Mutation 3 (call-form-only phantom `provision{ project_id }`): direct regex probe — NARROW regex captures `provision`? false; BROAD regex captures `provision`? true. Broadened guard RED on `["provision"]` → reverted byte-identical → 8 passed.
- Mutation 2 (rename `post_announcement{`→`postannounce{` call-form): snippet guard 2 RED + registry guard 2 RED → both reverted byte-identical → green.
- Full canonical ROOT gate: lint 0 · typecheck 0 · build clean · `pnpm test` 1607/182/0 · format --check clean.

### Completion Notes List

- **FR42 guidance-only story (Rule 13).** Documented the cross-project integration play in the two agent-facing assets (skill-rules registry Rule C + agent-prompt snippet §4), inlined byte-identically into the install kit (§3.1/§3.7), and content-guarded it. NO board code, NO new MCP tool/event/error code — the play composes the already-shipped 17-tool surface. `git diff HEAD` over `packages/core`/`packages/data-access`/`packages/mcp-server/src` shows ONLY the two named `*-doc.test.ts` guards.
- **Design decision — call-form on purpose to close the 7.3 carry.** Wrote the play's action steps in `tool{ args }` call-form (`list_members{ project_id }`, `post_announcement{ project_id }`, `add_participant{ @operator }`) rather than bare-backtick. This is natural for a step-by-step recipe AND forces the snippet guard's phantom regex to be broadened — closing the long-standing `7.3-snippet-callform-latent` deferred item (the registry + kit guards already used the broadened regex). Proven with the exact 7.3/8.1 mutation (a call-form-only phantom now goes RED where it previously slipped GREEN).
- **Rule 8 consistency.** Rule C (registry) and §4 (snippet) name the SAME tools/steps and delegate the four moves to Rule B; both honor `docs/negotiation-protocol.md` (which already uses `post_announcement`/`add_participant` for the need-post + escalation). The two assets do not drift.
- **Rule 18.** `project_id` allowlisted as a genuine non-tool param in both guards (not a weakened scan); broadening the snippet regex is additive (still catches every closing-backtick form). `install-kit-doc.test.ts` needed no edit — its `project_id` allowlist (from Story 12.2) already covers the call-form refs the kit now inlines.

### File List

- `integration/bmad/skill-rules.md` (UPDATE — added Rule C)
- `integration/bmad/agent-prompt-snippet.md` (UPDATE — added §4)
- `integration/bmad/install-agentbbs.md` (UPDATE — §3.1 + §3.7 inlined copies, byte-identical)
- `packages/mcp-server/src/skill-rules-registry-doc.test.ts` (UPDATE — Rule C presence + tools, `project_id` allowlist, converse-sanity)
- `packages/mcp-server/src/agent-prompt-snippet-doc.test.ts` (UPDATE — §4 presence + tools, BROADENED phantom regex, `project_id` allowlist, converse-sanity)
- `_bmad-output/implementation-artifacts/deferred-work.md` (UPDATE — `7.3-snippet-callform-latent` marked RESOLVED)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE — 12-3 in-progress → review)

## Change Log

| Date | Change |
|---|---|
| 2026-06-08 | Story 12.3 implemented — cross-project integration play (FR42) added to skill-rules registry (Rule C) + agent-prompt snippet (§4) + install-kit inlined copies; content-guards extended + mutation-tested; `7.3-snippet-callform-latent` gap closed by broadening the snippet phantom regex. Full ROOT gate green (lint 0 / typecheck 0 / build clean / test 1607-182-0 / format clean). Status ready-for-dev → review. |
| 2026-06-08 | Code-review (auto-resolve): fixed CR-12.3-H1 (step-3 grant semantics contradicted the shipped contract — see Review Findings). Play step 3 now routes the `post_announcement` branch through `join_board` first and attaches grant-on-act to `reply` only. `join_board` added to the play tool set (all three guards' `PLAY_TOOLS` + both assets, byte-identical kit copies). Full ROOT gate re-run green (lint 0 / typecheck 0 / build 0 / test 1611-183-0 / format 0). |

## Review Findings

### CR-12.3-H1 (HIGH, auto-resolved inline) — play step 3 contradicted the shipped grant-on-act contract (Rule 8 / Rule 10 / Rule 13)

**Finding.** The cross-project play's step 3 (in BOTH agent-facing assets + the kit's inlined copies) stated:
*"`post_announcement{ project_id }` opens a fresh proto-room for the need, or `reply` … Posting GRANTS your membership (acting = joining)."* This is false for `post_announcement`. The ratified, drift-guarded contract (`docs/mcp-tool-contract.md` §"Grant-on-act" + core `post-announcement.ts`/`membership.ts`) is explicit: `post_announcement` is a **gated write** that calls `requireMembership` FIRST and throws **`NOT_A_MEMBER`** ("join it before posting") if the actor has not joined the target sub-board. Only **`reply`** (and the target side of `add_participant`) grant-on-act. Because the play's entire premise is reaching **another** project's sub-board (one the agent is, by definition, NOT a member of), an agent following the `post_announcement` branch verbatim would hit `NOT_A_MEMBER` and be stuck — the exact class of agent-consumed-guidance-lies-about-the-surface that Rules 10/13 exist to prevent.

**Why the content-guards did not catch it.** The guards pin tool *names* to the live §6 surface (every named tool is real), not the *semantic claims* about those tools — the same Rule-10 blind spot as the Epic-7 "most 👍s" FR21-semantic rewrite. Verified against ground truth (Rule 6): `packages/core/src/rooms/post-announcement.ts:123` (`requireMembership` runs first) + `packages/core/src/projects/membership.ts:86-91` (throws `NOT_A_MEMBER`). `join_board` (§6 #6) is open to any identity (errors: only `NO_IDENTITY` / `BOARD_NOT_FOUND` — no membership gate), so it is the correct shipped way to become a member before `post_announcement`.

**Resolution (inline, faithful — Rule 8 reconcile-explicitly).** Rewrote step 3 in both canonical assets (skill-rules Rule C + snippet §4) and the kit's two inlined copies (§3.1 / §3.7), byte-identical, to: (a) the `reply` branch — replying grants membership (acting = joining), true; (b) the proto-room branch — `join_board{ project_id }` first (open to any identity) THEN `post_announcement{ project_id }`, with an explicit note that `post_announcement` is gated and returns `NOT_A_MEMBER` unless joined. `join_board` added to the play tool set; all three guards' `PLAY_TOOLS` updated; both assets now name the SAME 10-tool set (cross-asset consistency guard green). No board-engine change (Rule 13 — only the two dev guards + the QA guard under `packages/`); the play still composes only shipped §6 tools (no new tool/event/error code; `NOT_A_MEMBER` is an existing code, and it is uppercase so the phantom regex does not treat it as a tool token). Re-verified: 7.3 closure still holds (broadened regex still catches a call-form-only phantom RED), encoding clean (no BOM/mojibake/CRLF), full ROOT gate green.
