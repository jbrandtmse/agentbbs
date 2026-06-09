---
baseline_commit: b8b530e
---

# Story 12.6: Install-kit integration and safety re-proof (capstone)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want the single install kit to set up the global board, announce-on-onboard, the integration guidance, and the operator skills in one run,
so that everything installs idempotently and safely.

## Acceptance Criteria

1. **(AC1 — one kit installs everything)** Given `install-agentbbs.md`, when an agent runs it, then it inlines + installs all of: the global-board config (12.1), the announce-on-onboard bootstrap (12.2), the cross-project guidance (12.3), and the four operator skills (12.4 / 12.5) — into their correct user-scope vs project-scope targets.

2. **(AC2 — idempotent, backup-before-overwrite, never-touch-foreign over the EXPANDED set)** Given a re-run, when it executes, then it is idempotent (a byte no-op when nothing changed), backs up before any overwrite (timestamped), and never touches foreign assets — including the project's `epic-cycle` kit, unrelated `.mcp.json` / `.toml` keys, and the operator's other skills — so the Epic-8 safety properties hold over the expanded install set.

3. **(AC3 — content-guards + executable safety proof + lead smoke)** Given the kit, when tested, then the content-guards (Rule 10) pin every inlined asset to its canonical source, the executable safety test (Rule 11) runs the kit's OWN helper over real fixtures covering the new targets, and a lead smoke installs end-to-end into a temp project and confirms the global-board connection + that the operator skills resolve.

## Tasks / Subtasks

- [x] **Task 1 — VERIFY what the kit already carries vs what 12.6 adds (Rule 4)**
  - [x] CONFIRM the kit already inlines: §3.9 global-board user-scope registration (12.1); §2 announce-or-join bootstrap (12.2); §3.1 Rule C + §3.7 §4 cross-project play (12.3). These are DONE — do NOT re-author them.
  - [x] CONFIRM the FOUR operator skills (`agentbbs-check`/`-projects`/`-read`/`-post`) are NOT yet inlined/installed by the kit (they live only as canonical sources under `integration/bmad/skills/<name>/SKILL.md`). **This is the principal capstone gap.**

- [x] **Task 2 — Add a whole-owned-file write path to the helper (the 8.4-helper-crlf carry lands HERE)**
  - [x] The operator skills are WHOLE files (`.claude/skills/<name>/SKILL.md`) whose YAML frontmatter must be at the very top — they CANNOT be wrapped in `applyBlock`'s sentinel markers (that would push frontmatter below a comment, breaking the skill). Add a new helper to the §1 inline block, e.g. `writeOwnedFile(targetPath, content)`: idempotent (identical bytes → no-op, no backup), timestamped-backup-before-overwrite, for a file the kit OWNS ENTIRELY (the `agentbbs-<name>/SKILL.md` files live in kit-created dirs with no foreign content). Foreign-safety at the directory level: the kit writes ONLY its own `agentbbs-*` skill dirs/files; it must never clobber a foreign `.claude/skills/<other>/` or a foreign file in `.claude/skills/`.
  - [x] **8.4-helper-crlf (Story 12.0 awareness carry → resolve here):** RESOLVED via the documented-LF approach — added a "Line endings (LF)" note in the kit's §1 prose stating both `applyBlock` and `writeOwnedFile` write LF, that this is cosmetic-only on a CRLF target, and that all three safety properties hold regardless. EOL-detection deliberately NOT added (would complicate the re-proof for a non-safety cosmetic nit; the deferral explicitly sanctioned the documented-LF branch). Marked RESOLVED in `deferred-work.md`.
  - [x] If you add `writeOwnedFile`, the safety test's helper-extraction (`extractHelperSource` finds the block exporting `applyBlock` + `mergeMcpServer`) must still locate it — kept all helpers in the SAME `js` block and updated the extraction predicate to ALSO require `export function writeOwnedFile` + added a `typeof writeOwnedFile === 'function'` assertion in `beforeAll`.

- [x] **Task 3 — Add the operator-skills install section to the kit (AC1)**
  - [x] Added **§3.10 — The operator board skills (Stories 12.4 / 12.5, inlined)** inlining the four canonical SKILL.md bodies VERBATIM and instructing the agent to install each to USER scope `~/.claude/skills/<name>/SKILL.md` via `writeOwnedFile` (mirroring §3.9's user-scope home-dir resolution). States read-only (check/projects/read) + the one write skill (post), all resolving identity per-repo from `AGENTS.md`.
  - [x] Reconciled §4 verify to confirm the four operator skills install at user scope and resolve (the operator can run `/agentbbs-check` etc.).
  - [x] Kept §0/§3.x/§4 prose coherent — §0 "what this wires in" + tools-referenced list updated; §1 helper-block intro names the three exported functions; "What this kit does NOT do" boundary names the owned `agentbbs-*` skill files.

- [x] **Task 4 — Content-guard: drift-pin the inlined skills to canonical (AC3, Rule 10)**
  - [x] Extended `packages/mcp-server/src/install-kit-doc.test.ts`: added per-skill DRIFT PINS (`it.each(OPERATOR_SKILLS)`) comparing each inlined §3.10 operator-skill body to its canonical `integration/bmad/skills/<name>/SKILL.md` source, a USER-scope install pin (writeOwnedFile + `~/.claude/skills/<name>/SKILL.md` targets), and a `writeOwnedFile`-exported-from-the-helper pin. Extended `NON_TOOL_TOKENS` for the skills' response-shape fields. Mutation-tested (Rule 7): drifting the `agentbbs-check` body → drift pin RED; reverted byte-identical → GREEN.

- [x] **Task 5 — Rule-11 executable safety re-proof over the EXPANDED set (AC2, AC3)**
  - [x] Extended `packages/mcp-server/src/tools/install-kit-safety.integration.test.ts` to EXTRACT + IMPORT + EXECUTE the kit's OWN helper (incl. `writeOwnedFile`) against real temp fixtures covering the NEW targets: (v) idempotency — create + identical re-write = byte no-op, no backup, creates the kit-owned parent dir; (vi) backup-before-overwrite — change → timestamped backup (prior bytes) FIRST; (vii) never-touch-foreign — a planted foreign `.claude/skills/<other>/SKILL.md` + a foreign top-level file survive byte-identical after all four `agentbbs-*` skills written; (viii) reaffirm `epic-cycle`/`.mcp.json`/identity-block foreign-safety holds with the expanded set.
  - [x] Mutation-tested non-vacuous (Rule 7): defeated `writeOwnedFile`'s idempotency short-circuit → (v) RED; defeated its backup-before-overwrite → (vi) RED; made it clobber a sibling foreign skill → (vii) RED. Reverted byte-identical each time → 8/8 GREEN.

- [x] **Task 6 — Honest full-gate run (Rule 20)**
  - [x] Canonical ROOT gate INDEPENDENTLY re-run every leg: `pnpm run lint` 0 · `pnpm run typecheck` 0 · `pnpm run build` OK · `pnpm test` 1659 passed (184 files, 0 failed) · `pnpm run format` (prettier --check) clean. NOTE: `prettier --check` initially flagged the safety test (Rule-20 false-green class) — fixed via `prettier --write`, then re-ran lint/typecheck/format all green.
  - [x] Confirmed `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` shows ONLY the two test files (`install-kit-doc.test.ts`, `tools/install-kit-safety.integration.test.ts`) — the kit + helper live in the asset (`integration/bmad/`), NOT a frozen path (Rule 13). No new MCP tool/event/error code; 17-tool surface byte-identical.
  - [x] **Rule 21 (encoding):** verified out-of-band — no BOM / mojibake / CRLF in the kit OR the four canonical skill sources; intended glyphs intact (👍×18, em-dash×290, arrow×21, ≥×1 in the kit).

## Review Findings

Code review (`bmad-code-review`, 2026-06-08, capstone). **CLEAN — 0 decision-needed, 0 patch, 0 defer, 2 dismissed as noise.** Every marquee verification independently re-run (not trusting dev/QA claims):

- [x] **[Review][Rule 11 — marquee, executable safety] CONFIRMED non-vacuous.** Independently confirmed the safety test EXTRACTS + IMPORTS + EXECUTES the kit's OWN `writeOwnedFile` (predicate requires all three exported helpers; written to a temp `.mjs` and dynamically `import()`-ed — not a re-implementation). Mutation-tested by editing the kit's live helper: (a) defeat `writeOwnedFile` idempotency short-circuit → cases (v)+(ix) RED; (b) skip backup-before-overwrite → (vi)+(ix) RED; (c) clobber a foreign sibling skill → (vii)+(x) RED. Kit reverted byte-identical each time (md5 + `cmp` confirmed); all 10 cases GREEN after revert.
- [x] **[Review][Rule 10 — drift pins] CONFIRMED byte-exact + non-vacuous.** All four inlined §3.10 operator-skill bodies are byte-verbatim to their canonical `integration/bmad/skills/<name>/SKILL.md` (independent node byte-compare: check/projects/read/post all `verbatim-in-kit: true`). Mutated one inlined body (`agentbbs-check`) → its drift pin RED (exactly one failing test); reverted byte-identical → GREEN.
- [x] **[Review][Rule 13 — LOAD-BEARING] CONFIRMED.** `git diff HEAD -- packages/core packages/data-access` empty; `packages/mcp-server/src` shows ONLY the two named test files. 17-tool surface intact (verified against the §6 contract block). The kit fabricates no board op — §3.10 composes existing tools (`login`/`check`/`list_*`/`read_room`/`reply`/`post_announcement`/`join_board`) + the inline `writeOwnedFile`.
- [x] **[Review][Rule 18 — allowlist hygiene] CONFIRMED.** None of the 24 `NON_TOOL_TOKENS` allowlist entries is one of the 17 real registered tools — the allowlist masks no real tool; the added entries (`content`, `announcements`, `messages`, `protocol`, `room_id`, `projects`, `members`, `room`, `subject`, `body`) are genuine response-shape fields / the `writeOwnedFile` param.
- [x] **[Review][Rule 21 — encoding] CONFIRMED out-of-band.** Raw-byte scan of the kit + all four skill sources: no BOM, no CRLF, no mojibake lead-bytes (`0xC3 0xA2` / `0xC3 0xB0`); glyphs intact (kit 👍×18, em-dash×290, arrow×21). The QA's automated byte-level guard re-confirms this in-suite.
- [x] **[Review][8.4-helper-crlf] CONFIRMED RESOLVED.** `deferred-work.md` marks it RESOLVED via the documented-LF approach (§1 "Line endings (LF)" note); case (ix) turns the prose resolution into a regression guard and is non-vacuous (went RED on both the idempotency and backup mutations).
- [x] **[Review][Rule 20 — full gate] INDEPENDENTLY RE-RUN, every leg.** lint = 0 · typecheck = 0 · build = OK · `pnpm test` = 1663 passed / 184 files / 0 failed · `prettier --check` = clean. (Note: the actual current count is 1663, four above the dev's 1659 — the QA added 2 doc + 2 safety cases after the dev recorded that number; consistent with the test-summary.)

**Dismissed (noise):**
- The §3.10 illustrative install snippet uses default imports (`import os from 'node:os'`) while the §1 helper uses named imports — both valid ESM; the §3.10 snippet is prose, not the extracted-and-executed helper. No defect.
- The `(i)` idempotency case accepts a never-returned `'inserted'` action in an `||` alongside the real `'created'`/`'replaced'`; the subsequent content-change assertions are load-bearing. Cosmetic, pre-existing (Story 8.4), not introduced by 12.6.

## Dev Notes

### What this story is — the capstone

Wire the FOUR operator skills (12.4 read trio + 12.5 post) into the single `install-agentbbs.md` kit (inline + install to user-scope `.claude/skills/`), then RE-PROVE the Epic-8 safety properties (Rule 11) over the now-expanded install set, plus the Rule-10 drift-pins. The global-board config (12.1), announce-on-onboard (12.2), and cross-project guidance (12.3) are ALREADY in the kit (verify, don't redo). NO board code, NO new tool (Rule 13).

### The whole-owned-file problem (Task 2 — the key design point)

`applyBlock` wraps content in `BEGIN`/`END` sentinels — correct for AGENTS.md / skill-rules.md / .toml overlays (files with foreign content where the kit owns only a block). But an operator skill is a STANDALONE file whose YAML frontmatter (`---\nname: …\n---`) MUST be line 1 — sentinel-wrapping breaks it. So add `writeOwnedFile(path, content)`: the kit owns the WHOLE file (in its own `.claude/skills/agentbbs-<name>/` dir), so idempotency = whole-file byte-compare, backup-before-overwrite as usual, and foreign-safety = "only write the kit's own `agentbbs-*` dirs; never touch a foreign `.claude/skills/<other>/`". This is the clean shape; do NOT abuse `applyBlock` for whole files.

### The 8.4-helper-crlf carry (Story 12.0 → resolve here)

This story TOUCHES + RE-PROVES the helper — the exact "future helper hardening" trigger the deferred `8.4-helper-crlf` item named. Resolve it: either match the target's prevailing EOL, or document the LF assumption in the kit prose (idempotency/backup/foreign-safety already hold under CRLF empirically — verified at the 8.4 review). Mark it RESOLVED in `deferred-work.md`. Keep it proportionate — a documented LF note is an acceptable resolution if EOL-detection would complicate the re-proof.

### Install-target map (the kit's full surface after 12.6)

| Artifact | Scope | Target | Mechanism |
|---|---|---|---|
| MCP server registration | USER | user-scope MCP config (`claude mcp add --scope user`) | §3.9 (12.1) |
| identity + sub-board bootstrap | per-repo | `AGENTS.md` AGENTBBS-IDENTITY block | applyBlock (§2/§3.6) |
| skill-rules registry (+ Rule C) | project | `_bmad/custom/skill-rules.md` | applyBlock (§3.1) |
| 4 `.toml` overlays | project | `_bmad/custom/<skill>.toml` | applyBlock (§3.2–3.5) |
| agent-prompt snippet (+ §4 play) | (prompt) | agent system prompt | §3.7 |
| **4 operator skills (NEW)** | **USER** | **`.claude/skills/<name>/SKILL.md`** | **writeOwnedFile (§3.10)** |

### Existing safety-test harness (extend, don't rewrite)

`install-kit-safety.integration.test.ts` already EXTRACTS the kit's `js` helper block (predicate: exports `applyBlock` + `mergeMcpServer`), imports it as a real ESM module, and runs idempotency/backup/foreign-safety over temp files. Extend the extraction predicate if you add `writeOwnedFile` to the same block, and add the new-target cases. The `install-kit-doc.test.ts` carries the drift-pins; the `install-kit-connection.integration.test.ts` proves the real-server connection (the lead smoke also covers end-to-end install).

### Source tree / files to touch

| File | NEW/UPDATE | Why |
|---|---|---|
| `integration/bmad/install-agentbbs.md` | UPDATE | add `writeOwnedFile` to §1; add §3.10 operator-skills install; §4 verify; (CRLF note) |
| `packages/mcp-server/src/install-kit-doc.test.ts` | UPDATE | drift-pin the 4 inlined skills to canonical + user-scope (Rule 10) |
| `packages/mcp-server/src/tools/install-kit-safety.integration.test.ts` | UPDATE | Rule-11 proof over the new whole-owned-file targets |
| `_bmad-output/implementation-artifacts/deferred-work.md` | UPDATE | mark 8.4-helper-crlf RESOLVED |

**MUST stay byte-identical (Rule 13):** `packages/core/**`, `packages/data-access/**`, `packages/mcp-server/src/**` (except the two named test files). The kit + helper are ASSET files (`integration/bmad/`), not frozen. No new MCP tool / event / error code; 17-tool surface final.

### Testing standards

Content-guards drift-pin inlined copies to canonical (Rule 10), mutation-tested (Rule 7). The Rule-11 safety test EXTRACTS + EXECUTES the kit's OWN helper against real temp fixtures (never a re-implementation), mutation-tested non-vacuous. Canonical gate = ROOT `pnpm test`. AC3 lead smoke (lead-side) installs end-to-end into a temp project + confirms global-board connection + operator skills resolve.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.6]
- [Source: integration/bmad/install-agentbbs.md (§1 helper, §2, §3.1/3.7/3.9, §4); integration/bmad/skills/<name>/SKILL.md (the 4 canonical sources to inline)]
- [Source: packages/mcp-server/src/install-kit-doc.test.ts (drift pins), tools/install-kit-safety.integration.test.ts (Rule-11 harness), tools/install-kit-connection.integration.test.ts]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#8.4-helper-crlf (resolve here), #Story 12.0 awareness carry]
- [Source: .claude/rules/project-rules.md#Rule 4, #Rule 7, #Rule 10, #Rule 11, #Rule 13, #Rule 18, #Rule 20, #Rule 21]

## Integration ACs

This capstone wires the operator-skill ASSETS into the install kit (composing the shipped helper + tools); no new in-code service. AC3 is the Integration AC: the Rule-11 executable safety proof (runs the kit's OWN helper over real fixtures incl. the new whole-owned-file targets) + the `install-kit-connection.integration.test.ts` real-server connection + the lead smoke (end-to-end install into a temp project, global-board connection + operator skills resolve) ARE the observable end-to-end evidence. No new MCP tool/event/error code (Rule 13). Rule 1 satisfied.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

- Phantom-token scan of the kit after inlining the skills surfaced 10 new backticked non-tool tokens (`content`, `announcements`, `messages`, `protocol`, `room_id`, `projects`, `members`, `room`, `subject`, `body`) — all genuine response-shape field names / the `writeOwnedFile` param, none masking a real §6 tool; allowlisted in `NON_TOOL_TOKENS`.
- Rule-7 mutation runs: drift `agentbbs-check` body → drift-pin RED; defeat `writeOwnedFile` idempotency short-circuit → (v) RED; defeat backup → (vi) RED; clobber a sibling foreign skill → (vii) RED. All reverted byte-identical (kit confirmed `diff`-identical to the pre-mutation backup) → green.
- Rule-20 catch: `prettier --check` flagged the safety test after my edits (a false-green if trusted on test-count alone); fixed with `prettier --write`, re-ran lint/typecheck/format → all clean.

### Completion Notes List

- **Capstone wired the four operator skills into the single kit + re-proved Epic-8 safety over the expanded set.** No board-engine change, no new tool (Rule 13): the kit + helper are assets under `integration/bmad/`; `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` is ONLY the two named test files. 17-tool surface byte-identical.
- **`writeOwnedFile(targetPath, content)`** added to the §1 helper block (same block as `applyBlock`/`mergeMcpServer`): whole-owned-file write — idempotent (identical bytes → no-op, no backup), timestamped-backup-before-overwrite, creates the kit's own `agentbbs-<name>/` parent dir, never touches a foreign path. Used because an operator skill's YAML frontmatter must be line 1, so it cannot be sentinel-wrapped (the `applyBlock` design point).
- **§3.10** inlines the four canonical SKILL.md bodies VERBATIM (drift-pinned to `integration/bmad/skills/<name>/SKILL.md`) and installs each to USER scope `~/.claude/skills/<name>/SKILL.md` (one install serves every repo; identity resolved per-repo from `AGENTS.md` at run time).
- **8.4-helper-crlf RESOLVED** via the documented-LF branch (a "Line endings (LF)" §1 note); EOL-detection deliberately not added (non-safety cosmetic; would add risk to the re-proof). Marked RESOLVED in `deferred-work.md`.
- **Rule-11 re-proof** extends the existing safety harness with cases (v)–(viii) running the kit's OWN extracted `writeOwnedFile` over real temp fixtures; mutation-tested non-vacuous. **Rule-10 drift-pins** compare each inlined skill body to its canonical source, mutation-tested non-vacuous.
- Full ROOT gate green: lint 0 / typecheck 0 / build OK / `pnpm test` 1659 passed (184 files, 0 failed; +10 over the 1649 baseline = 6 doc + 4 safety cases) / `prettier --check` clean. Rule 21 clean (no BOM/mojibake/CRLF; glyphs intact).
- Left UNCOMMITTED for the lead's post-CR AC3 smoke gate.

### File List

- `integration/bmad/install-agentbbs.md` (UPDATE — `writeOwnedFile` helper + §1 LF note; §3.10 operator-skills install; §0/§4/boundary prose reconciliation)
- `packages/mcp-server/src/install-kit-doc.test.ts` (UPDATE — operator-skill drift pins, user-scope install pin, writeOwnedFile-export pin, NON_TOOL_TOKENS extension)
- `packages/mcp-server/src/tools/install-kit-safety.integration.test.ts` (UPDATE — extractHelperSource predicate + writeOwnedFile load; Rule-11 cases v–viii)
- `_bmad-output/implementation-artifacts/deferred-work.md` (UPDATE — 8.4-helper-crlf marked RESOLVED)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE — 12-6 status)
- `_bmad-output/implementation-artifacts/12-6-install-kit-integration-and-safety-re-proof.md` (UPDATE — tasks, Dev Agent Record, status)

## Change Log

- 2026-06-08 — Story 12.6 dev-story → review. Wired the four operator skills (12.4 read trio + 12.5 post) into the single `install-agentbbs.md` kit: added `writeOwnedFile` to the §1 helper block (whole-owned-file: idempotent / backup-before-overwrite / foreign-safe), added §3.10 inlining the four canonical SKILL.md bodies + installing them to user scope, reconciled §0/§4/boundary prose, and resolved 8.4-helper-crlf (documented-LF). Re-proved the Epic-8 safety properties over the expanded set (Rule 11, cases v–viii, mutation-tested) and drift-pinned each inlined skill (Rule 10, mutation-tested). ASSET + TESTS only — Rule 13 holds (core/data-access/mcp-server src byte-identical except the two named test files; 17-tool surface final). Full ROOT gate green: lint 0 / typecheck 0 / build OK / test 1659 passed (184 files) / format clean. Rule 21 clean.
