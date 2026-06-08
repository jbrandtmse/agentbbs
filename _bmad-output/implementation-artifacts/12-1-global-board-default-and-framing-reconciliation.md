---
baseline_commit: ebaf3f5
---

# Story 12.1: Global-board default and framing reconciliation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator running multiple agent-driven repos on one machine,
I want one shared board rather than a separate board per repo,
so that agents on different projects can discover and coordinate with each other.

## Acceptance Criteria

1. **(AC1 — user-scope global registration)** Given the install kit configures the MCP server, when it writes the connection record, then it registers the `agentbbs` server **once at user scope** with `AGENTBBS_DB` set to a single global path (default `~/.agentbbs/board.db`), and does **NOT** create a per-project `.mcp.json` bound to a per-project DB. **And** if a project-scoped record is used at all, every project points at the **same** global DB and the same-key collision with a user-scope server is avoided.

2. **(AC2 — placeholder + portability fix)** Given the kit's connection record, when it is written, then the `${PROJECT_ROOT}` placeholder is resolved to a real absolute path (or a real env var such as `${HOME}`) so the server receives a valid `AGENTBBS_DB`, **and** the server-binary invocation is portable (no machine-specific absolute path baked into a shared file).

3. **(AC3 — planning-artifact framing)** Given the planning artifacts, when inspected, then AR6, the architecture DB-location section, and the brief / PRD / glossary describe the **global board / project = sub-board** topology (V1 = single machine + single human; V2 networked per NFR2), with per-project DBs as an explicit override.

4. **(AC4 — lead smoke / integration)** Given the kit-written config, when the lead smoke runs it, then the real server starts against the global DB and two different project working directories reach the **SAME** board.

## Tasks / Subtasks

- [x] **Task 1 — VERIFY current planning-artifact state before editing anything (AC3, Rule 4)**
  - [x] AR6 and the DB-location section in `architecture.md` were **already amended 2026-06-02** (lines ~236 and ~256 carry the "global-board default" wording + the Epic-12 attribution). **Confirmed** (architecture.md:236 + :256 already correct — NOT re-amended).
  - [x] The brief primary-audience line (`brief.md:47`) and `prd.md:12`/`:25` already widened to "different projects … on one global board." **Confirmed** (all three already correct — NOT re-amended).
  - [x] FR41–FR43 are already present in `prd.md` (lines ~166–168). **Confirmed** (present; out of this story's scope; NOT touched).
  - [x] Identify the **remaining** gaps only. Checked: glossary §11 **Board** (prd.md:229) + **Sub-board** (:231) ALREADY carry global-board wording — already correct. FR37–FR40 (prd.md:156–160) read as identity/kit lifecycle ("wires the project to that server"), no per-project-board topology claim — fine as-is. ONLY genuinely-stale spot = `brief.md:12` Executive-Summary opener ("different subsystems of the same project") → widened to mirror the already-reconciled `prd.md:12` + dated 2026-06-02 note.
  - [x] Surfaced in the Dev Agent Record exactly which artifacts were already-correct vs the one I changed (Rule 4).

- [x] **Task 2 — RESEARCH-FIRST: confirm Claude Code `.mcp.json` env-var expansion + user-scope mechanics (AC1, AC2, Rule 3)**
  - [x] Verified against the **INSTALLED Claude Code 2.1.112** (`cli.js`), NOT web search. The Perplexity "no env expansion" claim is **WRONG** (delta recorded). The expansion fn (`o36`) runs `value.replace(/\$\{([^}]+)\}/g, …)` over `command`/`args`/`env` of stdio servers, reading from `process.env`, supporting `${VAR}` and `${VAR:-default}`; an undefined var is left literal + recorded missing (does not throw).
  - [x] Determined: (a) `${HOME}` expands ONLY if `HOME` is in `process.env` — and `$env:HOME` is **empty on Windows** (uses `%USERPROFILE%`), so `${HOME}` is NOT portable; `~` is expanded by nothing. (b) user-scope mechanism = `claude mcp add --scope user …` (scopes confirmed in cli.js: `project`/`user`/`local`), persisted in the per-user config. (c) `${PROJECT_ROOT}` is **NOT** a Claude-Code-provided variable → never expands → the literally-broken `AGENTBBS_DB` = the actual AC2 bug.
  - [x] Chose the connection-record shape from the verified facts: register once at user scope; resolve `~/.agentbbs/board.db` to an absolute path at install time (because neither `${HOME}` nor `~` is reliably portable). Defaults (user scope, `~/.agentbbs/board.db`) were not re-litigated — only the portability mechanism.

- [x] **Task 3 — Reconfigure the install kit §3.9 connection record (AC1, AC2)**
  - [x] Rewrote `integration/bmad/install-agentbbs.md` §3.9 to register `agentbbs` **once at user scope** (`claude mcp add --scope user --env AGENTBBS_DB=<ABS_DB> agentbbs -- agentbbs-mcp-server`) against the **global** DB (`~/.agentbbs/board.db`); §0 fallback parenthetical + §4 verify step reconciled to user-scope/global.
  - [x] Resolved the `${PROJECT_ROOT}` portability bug (AC2): removed the unresolved literal entirely; the kit resolves the home dir to an absolute path at install time (`path.join(os.homedir(), '.agentbbs', 'board.db')`). The user-scope config is per-user (not committed), so an absolute home path there is portable-by-construction.
  - [x] Preserved the per-project DB as an **explicit documented OVERRIDE** (an "isolated per-project board") via `mergeMcpServer`, mirroring AR6.
  - [x] **Rule 13 honored** — `packages/core`, `packages/data-access` (incl. `path.ts`), `packages/mcp-server/src` byte-identical except the permitted content-guard. `git diff HEAD` over those paths = ONLY `install-kit-doc.test.ts`.
  - [x] Reconciled the §3.9 prose: user-scope is the PRIMARY path; the project-scope override points at its own absolute DB and is mutually exclusive with the user-scope registration (same-key collision called out explicitly).

- [x] **Task 4 — Update the install-kit content-guard (AC1, AC2, Rule 10)**
  - [x] Extended `packages/mcp-server/src/install-kit-doc.test.ts` (+5 tests): pins the global `~/.agentbbs/board.db` default, user-scope registration (`--scope user`), the old `${PROJECT_ROOT}/.agentbbs/agentbbs.db` default GONE, no active `${PROJECT_ROOT}` AGENTBBS_DB value, per-project DB demoted to documented override. (Added `command`/`args`/`env` config keys to the phantom-tool allowlist per the guard's own Rule-18 guidance — not a scan weakening.)
  - [x] Mutation-tested non-vacuous (Rule 7): reintroducing `${PROJECT_ROOT}/.agentbbs/agentbbs.db` as a live value turned the "old default GONE" + "no active placeholder" guards RED (2 failed); reverted byte-identical → 18 GREEN.
  - [x] Rule 18 — the "no active `${PROJECT_ROOT}`" guard matches the placeholder ONLY in an `AGENTBBS_DB` position (`/AGENTBBS_DB["'\s:=]+[^\n]*\$\{PROJECT_ROOT\}/`), so the single explanatory mention of the fixed bug does not false-positive.

- [x] **Task 5 — Honest full-gate run (Rule 20)**
  - [x] Ran the **canonical ROOT gate**: `pnpm run lint` (exit 0, 0 findings) · `pnpm run typecheck` (exit 0) · `pnpm run build` (exit 0, clean) · `pnpm test` (1593 passed / 182 files / 0 failed) · `pnpm run format --check` ("All matched files use Prettier code style!", exit 0). All legs green.
  - [x] Confirmed `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` shows ONLY the permitted `install-kit-doc.test.ts` (Rule 13 load-bearing).

## Dev Notes

### What this story actually is

A **configuration + framing reconciliation** story. The board engine was always global (`resolveDbPath` honors `AGENTBBS_DB` verbatim — `packages/data-access/src/path.ts:107`). The only defects are: (1) the install kit registers a **per-project** board with a broken `${PROJECT_ROOT}` placeholder, and (2) some planning-doc prose still frames the product as "subsystems of one project." Epic 12 has **no board-engine change** (epic header + Rule 13).

### Current install-kit state (the thing to fix) — `integration/bmad/install-agentbbs.md`

- **§3.9 "The MCP-server connection record"** (lines ~834–885) writes a **project-scoped** `.mcp.json` via `mergeMcpServer('.mcp.json', 'agentbbs', { … env: { AGENTBBS_DB: '${PROJECT_ROOT}/.agentbbs/agentbbs.db' } })`. Two bugs vs the intended topology:
  - **Per-project DB** (`${PROJECT_ROOT}/.agentbbs/agentbbs.db`) — should be the single global `~/.agentbbs/board.db`, registered once at **user scope**.
  - **`${PROJECT_ROOT}` is an unresolved literal** — Claude Code does not define `PROJECT_ROOT`, so it does not expand → the server gets a literally-broken `AGENTBBS_DB`. This is the AC2 portability bug.
- **§0 prerequisite** (lines ~33–57) and **§4 verify** (lines ~889–902) also describe the per-project registration/verification — reconcile their prose to match.
- **The helper** `mergeMcpServer` / `applyBlock` (§1) is the safe write mechanism; **do not rewrite it in this story** (it is re-touched + re-proven in the Story 12.6 capstone — see the 12.0 awareness carry for `8.4-helper-crlf`). This story changes WHAT §3.9 writes, not the helper.

### Rule-3 flag (load-bearing — verify, don't guess) — `.mcp.json` env expansion

Web search (Perplexity) asserted `.mcp.json` supports **no** env-var interpolation. That is very likely **wrong / outdated** — Claude Code documents `${VAR}` and `${VAR:-default}` expansion in `.mcp.json`. **Verify against the installed Claude Code version's official docs / actual behavior (Rule 3) before choosing the AC2 mechanism.** If `${HOME}` expands, `"AGENTBBS_DB": "${HOME}/.agentbbs/board.db"` is the clean portable shape (no machine-specific absolute path baked in — satisfies AC2). If it does NOT expand, fall back to an install-time-resolved absolute path written by the executing agent. Record the verified behavior + the delta-from-search in the Dev Agent Record so 12.2/12.6 don't re-litigate it.

### Rule-4 flag (verify the "source facts") — planning artifacts are LARGELY ALREADY RECONCILED

The story's AC3 reads as if the planning docs need wholesale reconciliation, but per the 2026-06-02 Sprint Change Proposal follow-on edits, **most of AC3 is already satisfied**:
- `architecture.md:236` (DB discovery) and `architecture.md:256` (DB-location section) already carry the global-board-default wording + Epic-12 attribution — **already done**.
- `brief.md:47` (primary audience) already says "one global board per machine" + the 2026-06-02 note — **already done**.
- `prd.md:12` and `:25` already say "different projects that share code or depend on one another" — **already done**.
- FR41–FR43 already in `prd.md:166–168` — **already done** (and out of THIS story's scope anyway).

So Task 1 is mostly **confirmation**, with surgical fixes only to genuinely-stale spots (candidate: `brief.md:12` opening sentence still says "different subsystems of the same project"; check for a glossary "project"/"board" definition; check FR37–40 prose). **Do not redo amended work and do not claim it as new** (Rule 4 + Rule 20 honest reporting).

### Source tree / files to touch

| File | NEW/UPDATE | Why |
|---|---|---|
| `integration/bmad/install-agentbbs.md` | UPDATE | §3.9 connection record → user-scope global DB; fix `${PROJECT_ROOT}`; §0/§4 prose |
| `_bmad-output/planning-artifacts/briefs/brief-AgentBBS-2026-05-30/brief.md` | UPDATE (likely) | reconcile any residual "subsystems of one project" framing (verify first) |
| `_bmad-output/planning-artifacts/prds/prd-AgentBBS-2026-05-30/prd.md` | UPDATE (maybe) | FR37–40 framing only if stale; glossary if present |
| `packages/mcp-server/src/install-kit-doc.test.ts` | UPDATE | content-guard pins the new connection-record claims (Rule 10) |

**MUST stay byte-identical (Rule 13):** `packages/core/**`, `packages/data-access/**` (incl. `path.ts`), `packages/mcp-server/src/**` (except the `*-doc.test.ts` content-guard). No new MCP tool / event / error code; 17-tool surface final.

### Testing standards

- Content-guards are Vitest tests in `packages/mcp-server/src/*-doc.test.ts` that parse the asset and pin machine-relevant claims to source-of-truth (Rule 10). Mutation-test any new/changed assertion non-vacuous (Rule 7).
- Tests resolve cross-package `@agentbbs/*` against live `src` via the root `vitest.config.ts` alias (no build-first needed for in-process tests; project-rules Rule 2 superseded). The canonical gate is the **ROOT** `pnpm test` (project-rules Rule 12 corollary), not a per-package run.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 12 / Story 12.1]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-02.md#§4b AR6 amend, §3 decisions (c)+(e)]
- [Source: integration/bmad/install-agentbbs.md#§3.9 (lines ~834–885), §0, §4]
- [Source: packages/data-access/src/path.ts#resolveDbPath (AGENTBBS_DB honored verbatim)]
- [Source: _bmad-output/planning-artifacts/architecture.md#236, #256 (already-amended AR6 / DB-location)]
- [Source: _bmad-output/planning-artifacts/prds/prd-AgentBBS-2026-05-30/prd.md#FR41–43, #FR37–40]
- [Source: .claude/rules/project-rules.md#Rule 3 (verify external API vs installed), #Rule 4 (verify source facts), #Rule 10 (content-guard), #Rule 13 (thin-client byte-identical contract), #Rule 20 (full-gate honest)]

## Integration ACs

This story does not introduce a new service/module/component consumed in-code by a later story — it reconfigures an existing **asset** (the install kit) + planning docs. AC4 is itself the integration check: the lead-smoke starts the **real** MCP server against the kit-written global `AGENTBBS_DB` and confirms two different project working directories reach the SAME board (observable producer→consumer evidence end-to-end). No further Integration AC required (Rule 1 satisfied via AC4 + the content-guard's pin to the live asset).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`

### Debug Log References

- Rule-3 verification source: `C:\Users\Josh\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js` (installed Claude Code **2.1.112**). The `.mcp.json` env-expansion function (minified `o36`): `value.replace(/\$\{([^}]+)\}/g, (m, name) => { const i = name.indexOf(':-'), key = i===-1?name:name.slice(0,i), def = i===-1?undefined:name.slice(i+2), v = process.env[key]; if (v!==undefined) return v; if (def!==undefined) return def; missing.push(key); return m; })` — applied to `command`/`args`/`env` of stdio servers. Scope tokens confirmed in the same bundle: `project` (`.mcp.json`) / `user` / `local`.
- `$env:HOME` empty on this Windows host; `$env:USERPROFILE = C:\Users\Josh`. Confirms `${HOME}` is not portable on Windows → resolve absolute path at install time.
- Mutation-test (Rule 7): reintroduced `${PROJECT_ROOT}/.agentbbs/agentbbs.db` as a live `AGENTBBS_DB` value in the override JS block → `install-kit-doc.test.ts` "old default GONE" + "no active placeholder" both RED (2 failed / 16 passed); reverted byte-identical → 18 passed.
- Pre-existing AC4 test reconciliation: `install-kit-connection.integration.test.ts:229` requires the kit to document the literal `"command": "node"` JSON form; resolved without editing that frozen file (see Completion Notes, Rule-8 decision).

### Completion Notes List

**What this story did.** Configuration + framing reconciliation only — NO board-engine change (Rule 13 held). The board was always global (`resolveDbPath` honors `AGENTBBS_DB` verbatim — `packages/data-access/src/path.ts:107`, unchanged). Fixed (1) the install kit's per-project `.mcp.json` + broken `${PROJECT_ROOT}` placeholder → user-scope registration against one global `AGENTBBS_DB` (`~/.agentbbs/board.db`), and (2) one stale planning-doc sentence.

**Rule-4 planning-artifact audit (verified, not assumed) — already-correct vs changed:**
- ALREADY CORRECT (NOT touched): `architecture.md:236` + `:256` (global-board default + Epic-12 attribution); `brief.md:47` (primary audience "one global board per machine"); `prd.md:12` + `:25`; `prd.md` Glossary §11 **Board** (:229) + **Sub-board** (:231); FR41–FR43 (:166–168) + the §6.10 global-topology paragraph; FR37–FR40 (identity/kit lifecycle, no per-project-board claim).
- CHANGED (the only genuinely-stale spot): `brief.md:12` Executive-Summary opener — "different subsystems of the same project" → "different subsystems of one project — or work on different projects that share code or depend on one another" + a dated 2026-06-02 note, mirroring the already-reconciled `prd.md:12`.

**Rule-3 verified truth + delta-from-search (for 12.2/12.6).** Claude Code 2.1.112 DOES expand `${VAR}` and `${VAR:-default}` in `.mcp.json` `command`/`args`/`env` over `process.env` — the Perplexity "no env expansion" claim is **WRONG**. BUT: `${PROJECT_ROOT}` is not a Claude-Code-defined variable (never expands → the AC2 bug), and `${HOME}` is empty on Windows (uses `%USERPROFILE%`), and `~` is expanded by nothing. So the portable, valid mechanism is to RESOLVE the absolute home path at install time and register at user scope — not to rely on `${HOME}`/`~` expansion. The user-scope config is the operator's own per-user file (not a committed project file), so an absolute home path there bakes nothing machine-specific into anything the project commits (AC2).

**Rule-8 reconciliation (no frozen-file edit).** A pre-existing committed AC4 integration test, `packages/mcp-server/src/tools/install-kit-connection.integration.test.ts` (Story 8.4), pins the kit to documenting the explicit-Node `"command": "node"` JSON connection form (line 229) — the old per-project shape. This file is inside the Rule-13-frozen `packages/mcp-server/src/**` and is NOT the permitted `install-kit-doc.test.ts`, so editing it would violate Rule 13 as the story worded it. Instead of touching the frozen test, I added the explicit-Node JSON shape (with the global `board.db` absolute path, no `${PROJECT_ROOT}`) back into §3.9 as an illustrative "shape-equivalent" record. This keeps the committed test GREEN untouched AND keeps user-scope global registration the documented PRIMARY path. The test's load-bearing proof (real server spawns + advertises every kit-named tool) is unaffected and passes.

**Gate (Rule 20, all legs).** lint 0 / typecheck 0 / build clean / `pnpm test` 1593 passed (182 files, 0 failed) / format --check clean. Rule-13 diff over `packages/core packages/data-access packages/mcp-server/src` = ONLY `install-kit-doc.test.ts`.

### Change Log

- 2026-06-08 — Story 12.1 implemented (dev-story). install-agentbbs.md §3.9 rewritten to user-scope global-board registration (`~/.agentbbs/board.db`), `${PROJECT_ROOT}` portability bug fixed, per-project DB demoted to documented override; §0/§4 prose reconciled. brief.md:12 opener widened to the global-board framing. install-kit-doc.test.ts +5 connection-record guards (Rule-7 mutation-confirmed, Rule-18 precise match). Rule-3 verified vs installed Claude Code 2.1.112. Rule-13 board engine byte-identical. Status ready-for-dev → review.

### Review Findings

**Code review (2026-06-08, fresh-context adversarial pass) — APPROVED. ✅ Clean review: 0 decision-needed / 0 patch / 0 defer / 0 dismissed.** 0 HIGH, 0 MED, 0 LOW. No new deferred items. Status stays `review` for the lead's per-story smoke gate (AC4).

Independently re-verified (not trusting the dev/QA claims):

- **Rule 20 — FULL ROOT gate re-run, every leg, real numbers:** `pnpm run lint` exit 0 (eslint .) · `pnpm run typecheck` exit 0 (tsc --noEmit) · `pnpm run build` exit 0 (all packages built clean, incl. vscode-extension esbuild + mcp-server tsc -b) · `pnpm test` **1597 passed / 182 files / 0 failed** (delta vs dev's 1593 = the +4 QA guards) · `pnpm run format --check` "All matched files use Prettier code style!" exit 0. No false-green (Epic-11 Story-11.2 class) — lint+format genuinely clean, not just the test count.
- **Rule 13 (LOAD-BEARING) — board engine byte-identical:** `git diff HEAD -- packages/core packages/data-access packages/mcp-server/src` = ONLY `install-kit-doc.test.ts` (191 insertions, the permitted content-guard). 17-tool surface + closed error/event sets untouched. No board op fabricated; the install-kit asset is the correct client/asset layer (Rule 13 honored).
- **Rule 3 — env-expansion finding independently confirmed against the INSTALLED cli.js (not a web-search artifact):** Claude Code **2.1.112** present at `…/@anthropic-ai/claude-code/cli.js`. Found the exact expansion fn `o36`: `q.replace(/\$\{([^}]+)\}/g,(z,Y)=>{let A=Y.indexOf(":-"),O=…,$=process.env[O];if($!==void 0)return $;if(w!==void 0)return w;return K.push(O),z})` — `${VAR}`/`${VAR:-default}` DO expand over `process.env`; a missing var with no default pushes to `missingVars` and returns the literal (does NOT throw). `PROJECT_ROOT` appears **0×** in cli.js → not Claude-provided → never expands → confirms the AC2 bug premise. Dev's reasoning (resolve abs path at install time; `${HOME}` empty on Windows) is sound.
- **Rule 4 — planning-artifact "already-reconciled" claim spot-checked TRUE:** architecture.md:236 + :256 (global-board default + dated 2026-06-02 Epic-12 attribution), prd.md:12 + :25 (widened "different projects that share code or depend on one another"), glossary §11 Board ("Global per operator/machine in V1 … `~/.agentbbs/board.db`, AR6") + Sub-board — ALL already-correct and NOT in the diff. Only `brief.md:12` was genuinely stale and now mirrors prd.md:12. Dev correctly did not redo/claim amended work.
- **Rule 7 — re-confirmed the guards non-vacuous by my own mutation:** injected `${PROJECT_ROOT}/.agentbbs/agentbbs.db` into the override `args` position (a NON-`AGENTBBS_DB` position). Result: the dev's AGENTBBS_DB-**positional** guard did NOT fire (confirms the QA's claim that it MISSES an args-position reintroduction), the dev's literal-`includes` "old default GONE" guard fired RED, and the QA's **position-independent** Rule-18 guard fired RED (catches exactly the position the positional regex misses). Reverted byte-identical → 22/22 GREEN. The dev's positional guard + QA's position-independent guard are genuinely complementary, both non-vacuous.
- **Rule 18 — precise matching, no false-positive:** only ONE `${PROJECT_ROOT}` mention survives (kit line 913) — a `>`-quoted explanatory note about the fixed bug, no `.agentbbs/agentbbs.db` path attached, not in an AGENTBBS_DB position. It does not trip any guard (positional guard needs AGENTBBS_DB on-line; literal guard needs the full path string; QA guard strips `>`-lines). Phantom-tool allowlist additions (`command`/`args`/`env`) are genuine non-tool config keys backticked at kit line 911 — the guard working (Rule-18 move), not a scan weakening; verified they mask no real tool.
- **Rule 8 — frozen AC4 integration test untouched + still green:** `packages/mcp-server/src/tools/install-kit-connection.integration.test.ts` (Story 8.4, the real-runtime test that SPAWNS `dist/main.js`) is byte-identical; it pins the kit documents the explicit-Node `"command":"node"` + `dist/main.js` form, which the dev preserved as an illustrative shape in §3.9. Legitimate Rule-13-respecting resolution. **This is the Rule-3 real-runtime test evidence** for this user-facing surface (stage-rule satisfied); AC4 proper is the lead's manual smoke.
- **Rule 1 (Integration AC):** satisfied — asset/config story; the Integration AC is AC4 lead-smoke + the content-guard pin to the live asset (per the story's `## Integration ACs`). Rule 5 N/A (no NFR amendment). Rule 6 N/A (no docs/adr).
- **AC coverage:** AC1 (user-scope, global `~/.agentbbs/board.db` default, no per-project default, same-key collision avoided) — all four sub-clauses pinned + present in the kit (lines 920/923/925/930/953/955). AC2 (placeholder fixed, portable — illustrative `/Users/you/...` paths, install-time abs-path resolution documented). AC3 (framing reconciled). AC4 (real-runtime integration test green + §4 verify documents two-projects-same-board).

Adversarial lenses (Blind Hunter / Edge Case Hunter / Acceptance Auditor) run inline at full capability for this small asset/config + test-guard changeset: 0 correctness defects, 0 unhandled edge cases (incl. the Windows `[\\/]` separator + the strip-to-empty vacuity converse, both handled), 0 AC violations.

### File List

- `integration/bmad/install-agentbbs.md` (UPDATED — §3.9 connection record → user-scope global DB; §0 fallback note; §4 verify step)
- `_bmad-output/planning-artifacts/briefs/brief-AgentBBS-2026-05-30/brief.md` (UPDATED — line 12 Executive-Summary opener reconciled)
- `packages/mcp-server/src/install-kit-doc.test.ts` (UPDATED — +5 connection-record content-guards; phantom-tool allowlist += command/args/env)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATED — 12-1 → review; last_updated)
- `_bmad-output/implementation-artifacts/12-1-global-board-default-and-framing-reconciliation.md` (UPDATED — tasks checked, status, Dev Agent Record)
