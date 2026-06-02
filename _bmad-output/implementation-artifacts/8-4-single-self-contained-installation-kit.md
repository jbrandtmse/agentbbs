---
baseline_commit: 2a5c248
---

# Story 8.4: Single self-contained installation kit

Status: review

## Story

As an operator onboarding a new project,
I want one Markdown file I copy in and run once,
So that every AgentBBS integration artifact is generated without shipping sibling files.

## Acceptance Criteria

1. **Given** the AgentBBS MCP server is already installed/available and I copy `install-agentbbs.md` into a target BMAD project and point an agent at it,
   **When** the agent executes it,
   **Then** it generates ALL integration artifacts from content carried INLINE (no sibling files fetched): the `_bmad/custom/*.toml` customizations, the skill-rules registry, the prompt snippet, the `AGENTS.md` identity block, and the MCP-server registration/connection record,
   **And** it runs the identity bootstrap (Story 8.1) so the project has a stored handle.

2. **Given** a project where a prior install (or conflicting files) already exists,
   **When** I run the kit again,
   **Then** it detects prior state, backs up before overwriting (timestamped), and updates ONLY the sentinel-bounded blocks it owns (idempotent — a second run with no changes is a no-op),
   **And** it never modifies assets it does not own — in particular it does not touch the project's `epic-cycle` installation kit or unrelated keys in any `.toml`/settings file it edits.

3. **Given** the kit presupposes the MCP server,
   **When** the server is not yet available,
   **Then** the kit clearly reports the prerequisite rather than attempting to install the server itself.

## Review Findings

**Verdict: APPROVED** — 0 HIGH / 0 MED / 1 LOW auto-resolved inline + 1 LOW deferred + 2 dismissed. (Code review, 2026-05-31, baseline `2a5c248`; this is the Epic 8 + AgentBBS-MVP CAPSTONE.)

**Authoritative post-CR gate: lint 0 / build 7-7 / typecheck 0 / test 709 (103 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`) / format `--check` clean.** (Count 709 = 706 dev + 3 QA connection-test + 0 net from the reviewer's LOW-1 doc fix. The dev's Dev Agent Record recorded the pre-QA count 706; the QA stage added `install-kit-connection.integration.test.ts` (3 tests) → 709. No reconciliation edit to the Dev Agent Record was needed beyond this note.)

### What was verified (the capstone runs in strangers' projects — reviewed thoroughly)

- **AC #1 (self-contained + complete):** the kit inlines ALL prior assets with NO sibling fetch — the skill-rules registry (§3.1), the four `custom-templates/*.toml` overlays (§3.2–§3.5), the `AGENTBBS-IDENTITY` record block (§3.6), the agent-prompt snippet (§3.7), the cadence hook (§3.8), and the `.mcp.json` connection record (§3.9) — and RUNS the inlined 8.1 identity bootstrap (§2). Read end-to-end as an executing agent: every step is performable + unambiguous (prerequisite → save helper → bootstrap → write each artifact via the helper → verify).
- **AC #2 (three safety properties are REAL):** the inline `applyBlock`/`mergeMcpServer` helper was read as code AND executed. Idempotent (byte no-op on unchanged content), timestamped backup BEFORE overwrite + ONLY on change, replace-only-between-sentinels / owned-`.mcp.json`-key-only. **Independently mutation-tested non-vacuous** (not on faith): (1) idempotency short-circuit defeated → safety (i) RED; (2) `mergeMcpServer` foreign-server drop → safety (iv) RED. Both restored byte-identical.
- **AC #3 (prerequisite check):** §0 verifies the `agentbbs` server FIRST, prints a clear prerequisite message + STOPS when absent, and explicitly does NOT install the server (content-guard case (d) pins this).
- **Self-containment + drift:** the content-guard's drift-pins are GENUINE — drifting the canonical snippet source turned the guard RED (mutation #3), so the inlined copies cannot silently diverge. The kit names only real tools (all in live contract §6, transitively pinned to the live `McpServer`). The kit issues ZERO write-instruction to any `epic-cycle` file (all `epic-cycle` mentions are negative never-touch statements) — foreign boundary respected.
- **Tests are real, not hollow:** the safety test EXTRACTS + dynamically imports + EXECUTES the kit's OWN helper (not a reimplementation) against real temp files; the QA connection test genuinely SPAWNS the real shipped `dist/main.js` over `StdioClientTransport` from the kit's connection record and asserts the live `listTools()` advertises all 8 kit-referenced tools. `dist/main.js` confirmed present. All three tests discoverable by default `pnpm test`, no skip/only.
- **Rule 4 source-facts** re-confirmed TRUE (four canonical assets exist; bin `agentbbs-mcp-server`→`./dist/main.js`; env `AGENTBBS_DB`). **Rule 5** NFR5 pull-only stated, not worked around. **Rule 6** N/A (asset story). **Rule 10** both guards present + reviewer-mutation-tested.

### Findings

1. **LOW — `applyBlock` JSDoc advertised an `'inserted'` return action the code never produces (insert-into-existing reports `'replaced'`). RESOLVED inline.** Aligned the `@returns` JSDoc to reality (dropped `'inserted'`, added a plain-prose gloss) — the conservative fix (doc-only, no behavior change). The first attempt backtick-quoted the action words and the kit's OWN `no-phantom-tools` content-guard correctly went RED (caught `["created","replaced","noop"]` as tool-looking tokens) — a live proof the guard works; reworded to plain prose. Kit SHA256 `7b6892…` → `1084da…` (the only reviewer change to the kit). Gate re-run GREEN (709); both integration tests already accept `'replaced'`/`'created'`. (deferred-work.md → Story 8.4)
2. **LOW — `applyBlock` appends an LF-terminated block to a CRLF target → mixed line endings in that file. DEFERRED (cosmetic, no safety impact).** Empirically confirmed idempotency/backup/foreign-safety all hold under CRLF (marker re-detection is EOL-agnostic). Fold an optional EOL-detection into any future helper hardening. (deferred-work.md → Story 8.4, item `8.4-helper-crlf`)
3. **DISMISSED — `mergeMcpServer` reformats `.mcp.json` to 2-space on first touch.** Foreign *values* preserved exactly (proven by test (iv)); only whitespace normalizes, once; kit scopes the promise to "as much as practical". Not a foreign-safety violation.
4. **DISMISSED — sub-millisecond same-file double-overwrite could clobber a prior backup.** Not realistic in the install flow (each helper call targets a distinct owned file; backup only on actual change). Theoretical only.

No HIGH/MED. Nothing blocking carried forward; the Epic 8 retrospective triage inherits the unchanged OPEN set (1.5, 1.6, 5.1-roomid-cap-edge) plus the new cosmetic `8.4-helper-crlf` LOW. Left UNCOMMITTED for the lead's post-CR smoke gate.

## Tasks / Subtasks

- [x] Task 1: Author the self-contained kit `integration/bmad/install-agentbbs.md` (AC: #1, #3)
  - [x] A single, self-contained agent-executed Markdown file that carries INLINE (no sibling-file fetch, no relative include) the FULL content of every artifact it writes, each in a clearly-fenced block:
    - the per-skill `_bmad/custom/*.toml` customizations (the four Story 8.3 templates),
    - the skill-rules registry (`skill-rules.md`, Story 8.3) → installed to `_bmad/custom/skill-rules.md`,
    - the agent-prompt snippet (`agent-prompt-snippet.md`, Story 7.3),
    - the cadence hook (`cadence-hook.toml`, Story 8.2) — as applicable to the install model,
    - the `AGENTS.md` identity block (the `AGENTBBS-IDENTITY` sentinel block, Story 8.1),
    - the MCP-server registration/connection record (the `agentbbs` server entry for the project's MCP config, e.g. `.mcp.json` — command `agentbbs-mcp-server` / `node <path>/dist/main.js`, env `AGENTBBS_DB`).
  - [x] It RUNS the Story 8.1 identity bootstrap (inlined) so the project ends with a stored handle in the `AGENTS.md` `AGENTBBS-IDENTITY` block.
  - [x] **Prerequisite check (AC #3):** the kit FIRST verifies the AgentBBS MCP server is available; if NOT, it clearly REPORTS the prerequisite (how to install/point at the server) and STOPS — it does NOT attempt to install the server itself.
- [x] Task 2: Idempotent, backup-safe, foreign-safe install mechanics — as an EXECUTABLE inline helper (AC: #2)
  - [x] The kit carries an INLINE, self-contained helper (a Node snippet in a fenced ```` ```js ```` block — Node is a given in a BMad project; cross-platform) implementing the safety-critical file surgery the agent invokes for each artifact: `applyBlock(targetPath, sentinelBegin, sentinelEnd, blockContent)` that —
    - **inserts** the sentinel-bounded block if the pair is ABSENT (append, or at a documented anchor),
    - **replaces** only the bytes BETWEEN the sentinel pair if PRESENT (never touching anything outside),
    - **backs up** the target (timestamped copy, e.g. `<file>.agentbbs-bak-<UTC>`) BEFORE any overwrite, and ONLY when the content actually changes,
    - is **idempotent**: re-applying identical content is a byte-level no-op (no spurious backup, no diff),
    - for the JSON MCP-config case (`.mcp.json`): updates ONLY the kit's owned `agentbbs` server key, preserving all foreign servers + unrelated keys + formatting as much as practical (a key-scoped merge, the JSON analogue of a sentinel block). _(Implemented as a companion `mergeMcpServer(targetPath, serverName, serverConfig)` export — the JSON analogue of `applyBlock`.)_
  - [x] The kit instructs the agent to use this helper for EVERY file it writes, so idempotency / backup / foreign-safety are DETERMINISTIC (not hand-rolled per run). State the never-touch-foreign rule explicitly, naming the project's `epic-cycle` kit + unrelated `.toml`/settings keys as off-limits.
- [x] Task 3: Content-guard — inlined content pinned to the canonical sources (AC: #1, Rule 10)
  - [x] A content-guard test (`packages/mcp-server/src/install-kit-doc.test.ts`, mirroring the sibling doc-guards + call-form-aware tool-regex) asserting:
    - the kit INLINES each artifact and its inlined block MATCHES the canonical source (the kit's inlined skill-rules block ⊇/== `integration/bmad/skill-rules.md`; the inlined snippet block contains the `agent-prompt-snippet.md` sentinel block; the inlined cadence/template content matches `cadence-hook.toml` / `custom-templates/*.toml`; the inlined identity-bootstrap matches `identity-bootstrap.md`'s block) — so the kit cannot silently drift from the canonical assets,
    - the kit is SELF-CONTAINED: NO instruction to fetch/read a sibling file for content (no `fetch`/`curl`/relative-path include of the other integration assets),
    - every backticked tool token the kit names is a REAL advertised tool (pin to the live set),
    - the kit STATES the three safety properties (idempotent sentinel blocks, timestamped backup-before-overwrite, never-touch-foreign incl. the `epic-cycle` kit) AND the AC #3 MCP-server prerequisite check.
  - [x] Mutation-test ≥2 high-stakes pins RED (e.g. corrupt an inlined tool name; break the drift-pin by asserting against a deliberately-mismatched source), restore byte-identical (Rule 10 + Rule 7).
- [x] Task 4: Safety-property proof — execute the kit's OWN helper (AC: #2, Epic 7 retro Action A)
  - [x] A real-runtime test (`packages/mcp-server/src/tools/install-kit-safety.integration.test.ts` or a `*.test.ts` under `packages/mcp-server/src/`) that EXTRACTS the kit's inline helper (the ```` ```js ```` block) and EXECUTES it against a temp project, proving on the KIT'S ACTUAL CODE:
    - **idempotency:** first `applyBlock` inserts; an immediate second with identical content is a byte-level no-op (target unchanged; no new backup),
    - **backup-before-overwrite:** changing the block content produces a timestamped backup AND replaces only between the sentinels,
    - **never-touch-foreign:** plant a fake `epic-cycle` kit file + an unrelated key in the same `.toml`/`.mcp.json` the kit edits; after the install they survive BYTE-IDENTICAL (only the owned block/key changed),
    - **JSON key-scoping:** a `.mcp.json` with a pre-existing foreign server keeps that server untouched while the `agentbbs` key is added/updated.
  - [x] Discoverable by default `pnpm test` (Rule 8). Mutation-test the idempotency assertion non-vacuous (Rule 7).
- [x] Task 5: Cross-link + full gate (AC: #1)
  - [x] Cross-link `install-agentbbs.md` from `integration/bmad/README.md` (the kit is the operator entrypoint that inlines all four canonical assets). Update the README's "Populated by Epics 7 and 8" note to reflect Epic 8 complete.
  - [x] Run lint → build → typecheck → test → format `--check`. All green. Final count: 706 (689 after Story 8.3 + 17 new).

## Dev Notes

This is the CAPSTONE of Epic 8 (and of the AgentBBS MVP feature set) — the single self-contained `integration/bmad/install-agentbbs.md` (AR27 / FR40) that an operator copies into a target BMAD project and an agent executes once to wire in EVERYTHING: identity + MCP connection + the per-skill board-review cadence + the Negotiation Protocol rules. It INLINES the canonical assets from Stories 7.3 / 8.1 / 8.2 / 8.3 (no sibling files), runs the 8.1 bootstrap, and is idempotent + backup-safe + foreign-safe. DOCUMENTATION/CONFIG ASSET + one inline helper script (no board code).

**Rule 1:** N/A (no new service). The safety-property test (Task 4) + the lead smoke are the integration-style evidence.
**Rule 3 (real-runtime evidence):** Task 4 executes the kit's OWN extracted helper against a temp project (idempotency/backup/foreign-safety on real files) — not a description, the actual code. The lead smoke additionally proves the MCP-server connection the kit records actually connects to the real binary + the kit's tools are advertised.
**Rule 4 (verify source-facts):** the kit names the shipped tools (verify vs `docs/mcp-tool-contract.md` §6) + the server bin `agentbbs-mcp-server` → `./dist/main.js` (`packages/mcp-server/package.json` `bin`) + env `AGENTBBS_DB`. The four canonical assets it inlines EXIST (`integration/bmad/{skill-rules.md,cadence-hook.toml,agent-prompt-snippet.md,identity-bootstrap.md,custom-templates/*.toml}`). Verify before authoring.
**Rule 5:** N/A. NFR5 (pull-only) underlies the cadence it installs.
**Rule 8:** the kit is the FIRST consumer that inlines ALL prior assets — keep the inlined copies pinned to the sources (Task 3 guard) so they can't drift. The kit and the `epic-cycle` kit are SEPARATE installation kits in the same `integration/` space — the kit must NOT touch `epic-cycle` (AC #2); this is a foreign-asset boundary, not a contradiction.
**Rule 10 (Epic 7 retro Action A — the reason this story is heavy on guards):** the kit is the highest-stakes agent-CONSUMED asset (it WRITES files in a stranger's project). Both the content-guard (inlined-content drift pin + self-contained + tools-real + safety-properties-stated) AND the executable safety-property test (idempotency + backup + foreign-safety on the kit's own helper) are REQUIRED, mutation-tested. This is exactly the "test the kit's idempotency + never-touch-foreign-assets + backup-before-overwrite safety" the Epic 7 retro asked for and the Story 8.0 triage carried here.

### Source facts (verified at story creation, baseline `2a5c248`)

- **The four canonical assets to inline** (all present): `integration/bmad/skill-rules.md` (8.3), `integration/bmad/custom-templates/{bmad-dev-story,bmad-create-story,bmad-qa-generate-e2e-tests,bmad-code-review}.toml` (8.3), `integration/bmad/agent-prompt-snippet.md` (7.3, sentinel `AGENTBBS-PROMPT-SNIPPET:BEGIN/END`), `integration/bmad/cadence-hook.toml` (8.2), `integration/bmad/identity-bootstrap.md` (8.1, sentinels `AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END` + the `AGENTBBS-IDENTITY` record block).
- **MCP-server connection record:** `packages/mcp-server/package.json` → `"name": "@agentbbs/mcp-server"`, `"bin": { "agentbbs-mcp-server": "./dist/main.js" }`, `"start": "node ./dist/main.js"`. The stdio server reads the DB path from env `AGENTBBS_DB` (see the lead smokes + `main.ts`). The consuming Claude Code project records MCP servers in `.mcp.json` (`mcpServers.<name> = { command, args, env }`) — the kit owns ONLY the `agentbbs` key. (This repo has NO `.mcp.json` — it is the producer; the kit targets a consumer.)
- **Tools the kit references** (all shipped, `docs/mcp-tool-contract.md` §6): the identity (`register`/`login`), cadence (`check`/`read_room`/`reply`/`react`), and protocol (`read_contract`/`unreact`) tools. No phantom tools.
- **Sentinel convention** (established 7.3 / 8.1): `AGENTBBS-<NAME>:BEGIN` … `:END` for Markdown; choose a TOML-comment sentinel (e.g. `# >>> AGENTBBS:<name> >>>` … `# <<< AGENTBBS:<name> <<<`) for `.toml`; a key-scoped merge for `.mcp.json`. The helper must treat each generically (begin/end markers passed in).
- **Content-guard pattern:** `packages/mcp-server/src/skill-rules-registry-doc.test.ts` / `cadence-hook-doc.test.ts` (call-form-aware regex; live-tool-set pinning via contract §6 bound by `tool-contract.drift.test.ts`). Mirror it; ADD the inlined-content drift pins (read the source files at test time, assert the kit embeds them).
- **Lead smoke (8.4 real-runtime proof):** (a) run the kit's extracted helper end-to-end against a temp project — idempotency (2nd run no-op) + timestamped backup + planted-foreign-asset survives byte-identical + `.mcp.json` foreign-server untouched; (b) drive the real stdio binary using the connection record the kit writes (`node dist/main.js`, `AGENTBBS_DB`) — it connects + advertises the kit's referenced tools (the prerequisite + connection record are real). Python not required for this story; Node only.
- Toolchain (Epics 1–8.3): Node v24.16.0, pnpm 11.3.0 (`python` only if needed — not here). Build before the full suite (forked workers). Suite at 689 after Story 8.3.

### Project Structure Notes

- New `integration/bmad/install-agentbbs.md` (the kit, with an inline Node helper) + a cross-link from `integration/bmad/README.md`; TWO tests (the content-guard + the executable safety-property test). NO board code, NO new tool/event/error code.
- FOURTH and FINAL Epic-8 asset story (8.1 → 8.2 → 8.3 → **8.4 the self-contained kit**). Completing it closes Epic 8 and the AgentBBS MVP feature set (Epics 1–8); Epic 9 (Operator UI) is the next epic but OUT OF SCOPE here.
- After 8.4: the Epic 8 retrospective (silent, lead-judged) + merge `AGENTBBS-1-epic8` → feature.

## Dev Agent Record

### Context & approach

CAPSTONE of Epic 8 (and the AgentBBS MVP feature set). Shipped the single self-contained
`integration/bmad/install-agentbbs.md` (AR27 / FR40) — ONE agent-executed Markdown kit that inlines
every prior integration asset (Stories 7.3 / 8.1 / 8.2 / 8.3, no sibling files) and carries an inline,
self-contained Node helper for all file surgery. DOCUMENTATION/CONFIG asset + one inline helper
script; NO board code, NO new tool/event/error code (`EVENT_TYPES` / `BOARD_ERROR_CODES` untouched;
the APPEND INVARIANT is not implicated).

### What the kit does (the artifact)

- **§0 Prerequisite check FIRST (AC #3):** verifies the AgentBBS MCP server is available (already-
  connected `agentbbs` server, OR a resolvable `agentbbs-mcp-server` / `dist/main.js` binary); if
  neither holds it prints a clear prerequisite message and **STOPS** — it does NOT install the server.
- **§1 The inline helper (AC #2):** a fenced ```` ```js ```` block (`apply-agentbbs.mjs`, ESM, zero
  deps) the agent uses for EVERY write. `applyBlock(targetPath, beginMarker, endMarker, blockContent)`
  = insert-if-absent / replace-only-between-sentinels-if-present / timestamped backup
  (`<file>.agentbbs-bak-<UTC>`) BEFORE any real overwrite / byte-level no-op when content is unchanged.
  A companion `mergeMcpServer(targetPath, serverName, serverConfig)` does the `.mcp.json` KEY-SCOPED
  merge (updates only the owned `agentbbs` key, preserves all foreign servers + unrelated top-level
  keys). The kit states the three safety properties and the never-touch-foreign rule explicitly,
  **naming the `epic-cycle` kit + unrelated `.toml`/`.json` keys as off-limits**.
- **§2 + §3.6:** runs the inlined Story 8.1 identity bootstrap and records the final handle into the
  consuming project's `AGENTS.md` `AGENTBBS-IDENTITY` block via `applyBlock` (plain handle only,
  claim-based NFR7, safe to commit) — so the project ends with a stored handle.
- **§3.1–§3.9:** inlines VERBATIM the skill-rules registry, the four `custom-templates/*.toml`
  overlays, the agent-prompt-snippet sentinel block, the cadence hook (`[workflow]` body), the
  `AGENTBBS-IDENTITY` record block, and the MCP-server connection record (`agentbbs` entry: command
  `agentbbs-mcp-server` / `node <path>/dist/main.js`, env `AGENTBBS_DB`).
- **§ boundaries:** explicitly states what the kit does NOT do (install the server; touch foreign
  assets incl. `epic-cycle`; enforce anything).

### Two test tiers (both mutation-tested, Rules 7 / 10 / Epic 7 retro Action A)

- **(A) Content-guard `packages/mcp-server/src/install-kit-doc.test.ts`** (13 tests; mirrors
  `skill-rules-registry-doc.test.ts`): DRIFT PINS comparing the kit's inlined blocks to the canonical
  sources READ AT TEST TIME (snippet sentinel block, identity-bootstrap sentinel block + the
  `AGENTBBS-IDENTITY` record markers, the skill-rules registry body slice, the cadence-hook
  `[workflow]` body, each of the four template `[workflow]` bodies); SELF-CONTAINED (no
  `curl`/`wget`/`fetch(http…)`, no sibling-read-for-content instruction, + converse presence check);
  NO PHANTOM TOOLS via the call-form-aware regex pinned to the contract §6 list (transitively bound to
  the live `McpServer` by `tool-contract.drift.test.ts`); STATES the three safety properties (incl.
  `epic-cycle`) + the AC #3 prerequisite (verify-first / STOP / does-not-install / connection record).
- **(B) Executable safety-property `packages/mcp-server/src/tools/install-kit-safety.integration.test.ts`**
  (4 tests, Rule 3): EXTRACTS the kit's inline ```` ```js ```` helper (by locating the block that
  exports `applyBlock` + `mergeMcpServer`), writes it to a temp `.mjs`, dynamically imports it, and
  EXECUTES the KIT'S ACTUAL CODE against throwaway temp projects to prove (i) idempotency (insert →
  byte no-op + no new backup), (ii) backup-before-overwrite (timestamped backup + replace only between
  sentinels + unrelated tail intact), (iii) never-touch-foreign (planted `epic-cycle` file + an
  unrelated sentinel block survive byte-identical; the foreign file gets no backup), (iv) `.mcp.json`
  key-scoping (pre-existing foreign server + unrelated top-level key preserved across add AND update;
  identical re-merge is a no-op). Hermetic (all temp under `os.tmpdir()`, removed in `afterEach`);
  discoverable by default `pnpm test` (Rule 8); no `.only`/`.skip`.

### Mutation tests (non-vacuous, restored byte-identical — Rules 7 / 10)

Kit SHA256 baseline `7b6892…` captured; restored + re-verified `7b6892…` after EACH mutation.
1. **Phantom-tool pin → RED:** changed an inlined `` `check` `` to `` `subscribe` `` in the kit's intro
   → the no-phantom-tools test failed on `["subscribe"]`. Restored.
2. **Snippet drift-pin → RED:** changed "shared bulletin board" → "shared MESSAGE board" inside the
   inlined `AGENTBBS-PROMPT-SNIPPET` block → the snippet VERBATIM drift-pin failed (`expected false to
   be true`). Restored.
3. **Idempotency assertion non-vacuous → RED:** defeated the helper's no-op short-circuit
   (`if (existed && next === original && false)`) → safety test (i) failed (`expected 'replaced' to be
   'noop'`). Restored.
All three confirmed the pins discriminate; the kit ended byte-identical to its tested state.

### Rules applied

- **Rule 1:** N/A (no new service). The executable safety-property test (Task 4) + the lead smoke are
  the integration-style evidence.
- **Rule 3:** satisfied — Task 4 executes the kit's OWN extracted helper against real temp files.
- **Rule 4 (verify source-facts):** re-verified before authoring — the four canonical assets exist at
  the cited paths; `agentbbs-mcp-server` → `./dist/main.js` (`packages/mcp-server/package.json` `bin`),
  `start` = `node ./dist/main.js`, env `AGENTBBS_DB`; the contract §6 tool list is at
  `docs/mcp-tool-contract.md` lines 364–382 (`# AGENTBBS-TOOL-CONTRACT:BEGIN/END`); the snippet /
  identity-bootstrap sentinels are as cited. No phantom tools.
- **Rule 5 / 6:** N/A (no NFR amendment; no `docs/adr` decision referenced by this asset story).
- **Rule 8 (foreign-asset boundary):** the kit and `epic-cycle` are separate kits in the same
  `integration/` space; the kit never touches `epic-cycle` (stated in the kit + proven in safety test
  (iii)). The inlined copies are pinned to source by the content-guard so they cannot drift.
- **Rule 10:** both guards present + mutation-tested (the Epic 7 retro Action A pairing).

### Design decisions

- The `.mcp.json` JSON merge is a **separate `mergeMcpServer` export** rather than overloading
  `applyBlock` — JSON key-scoping is not a sentinel-block operation, so a dedicated function is the
  clean analogue (sentinel block ↔ owned JSON key). The content-guard and safety test both reference
  it by name.
- The helper is authored as an **ESM module with `export function …`** so the safety test can extract
  it to a temp `.mjs` and `import()` it directly (the repo is `"type": "module"`); the kit also tells
  the operator to save it as `apply-agentbbs.mjs`.
- The self-contained guard forbids the literal words `curl`/`wget`; the kit's intro therefore says
  "no network fetch" (not "no curl") so the guard stays a simple, honest ban without an allowlist that
  could mask a real fetch instruction.

### Honest gate (from repo root, pnpm; Node v24.16.0 / pnpm 11.3.0)

`lint` 0 → `build` 7/7 → `typecheck` 0 → `test` **706** (102 files, 0 failed / 0 skipped, no
`.only`/`.skip`/`.todo`) = 689 baseline + 17 new (13 content-guard + 4 safety-property) → `format
--check` clean. Build precedes test (forked workers resolve `@agentbbs/core` via `dist`). Left
UNCOMMITTED (incl. no commit of `dist`) for the lead's post-CR smoke gate.

### File List

**New**

- `integration/bmad/install-agentbbs.md` — the single self-contained installation kit (AR27 / FR40).
- `packages/mcp-server/src/install-kit-doc.test.ts` — content-guard (13 tests).
- `packages/mcp-server/src/tools/install-kit-safety.integration.test.ts` — executable safety-property
  proof (4 tests).

**Modified**

- `integration/bmad/README.md` — cross-linked the kit as the operator entrypoint; updated the
  "Populated by Epics 7 and 8" note to reflect Epic 8 complete.

### Change Log

- Authored `integration/bmad/install-agentbbs.md`: a single self-contained agent-executed kit
  (prerequisite check → inline idempotent/backup-safe/foreign-safe helper → inlined canonical assets →
  identity bootstrap), AR27 / FR40.
- Added the content-guard (`install-kit-doc.test.ts`) + the executable safety-property test
  (`install-kit-safety.integration.test.ts`); both mutation-tested non-vacuous and restored
  byte-identical.
- Cross-linked the kit from `integration/bmad/README.md` and marked Epic 8 complete there.
- Gate green end-to-end; suite 689 → 706. No board code; no new tool/event/error code.
