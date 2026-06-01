---
baseline_commit: 6cfad76
---

# Story 8.2: Post-step board-review cadence hook

Status: review

## Story

As an operator,
I want a configurable hook that makes each agent review the board after every skill execution,
So that agents adopt the board unprompted and stay aware of work that affects them (SM4).

## Acceptance Criteria

1. **Given** the cadence hook is installed and enabled for a workflow,
   **When** an agent completes a workflow step,
   **Then** as a post-condition the agent performs a board review — at minimum a `check`, scanning its sub-board's announcements, investigating rooms of interest, and responding to new messages in rooms it participates in — then returns to its task.

2. **Given** the hook configuration,
   **When** the operator tunes cadence and review depth,
   **Then** the behavior changes accordingly (default: one review at each step end),
   **And** the hook introduces no push — it is purely a pull review wired as a post-condition.

3. **Given** the cadence hook is a canonical BMad-integration ASSET (AR24 `cadence-hook.toml`, FR35/FR36),
   **When** it is published in `integration/bmad/`,
   **Then** it is a REAL, resolvable BMad `[workflow]` customization (the actual `_bmad/scripts/resolve_customization.py` merges it and the cadence obligation + post-step trigger surface in the resolved `workflow` block), it is COPY/INLINE-ready for the Story 8.4 installation kit, uses ONLY the shipped tools (`check`, `read_room`, `reply`, `react` — verified against `docs/mcp-tool-contract.md`), and a CONTENT-GUARD test pins its claims to the code's source of truth (Rule 10).

## Review Findings

**Code-review stage (2026-05-31, baseline `6cfad76`, branch `AGENTBBS-1-epic8`) — verdict: APPROVED.**

Reviewed the cadence-hook asset + both new tests adversarially against the 3 ACs and the skill-rules stage rules (1, 3, 5, 6, 10) and the project-context append-invariant/pull-only rules. Independently re-ran the integration-style evidence rather than trusting the dev/QA claims.

**Verifications performed (all PASS):**

- **AC #3 — the hook is a GENUINELY resolvable BMad customization (Rule 1 integration evidence).** Independently re-ran the REAL `_bmad/scripts/resolve_customization.py` (exit 0) against a temp project (`<tmp>/_bmad/skills/<skill>/customize.toml` = a minimal base carrying one pre-existing fact; `<tmp>/_bmad/custom/<skill>.toml` = the hook copied verbatim; `.git` marker for the root walk-up). Resolved `[workflow]` block: base fact + cadence fact BOTH present, in **APPEND order** (base first, cadence appended after — `persistent_facts` array append proven), the cadence fact carries all four backticked tools, and `on_complete` **OVERRIDE-won** (344-char scalar, contains `` `check` ``). The hook also PARSES under `tomllib` (`[workflow]` keys = `on_complete`, `persistent_facts`; 1 fact entry). → the dev's "it resolves through the real resolver" claim is TRUE.

- **Rule 10 — content-guard is NON-VACUOUS and pins to the LIVE tool set (spot-checked, not taken on faith).** Mutated the real `.toml` (`` `read_room` `` → `` `subscribe` ``, a phantom tool) → the `no-phantom-tools` guard went RED with the exact expected assertion (`expected [ 'subscribe' ] to deeply equal []`); restored byte-identically (blob hash back to pristine `422c5a9a7ba386f96f8bf27ba696dfbdaababbfc`), guard GREEN again (12/12). The guard parses the contract §6 `AGENTBBS-TOOL-CONTRACT` canonical list as its source of truth (transitively bound to the live `McpServer` by `tool-contract.drift.test.ts`), NOT a hardcoded list — so it tracks real drift. Includes a converse vacuity guard (all four tools must appear as backticked candidates). Confirmed non-vacuous.

- **Rule 3 — QA's `check.cadence-post-condition.integration.test.ts` is GENUINE real-runtime evidence, not a hollow pass.** Confirmed it drives a live `check` over a real `Client` ↔ `createBoardServer`-built `McpServer` (SDK `InMemoryTransport`) backed by the REAL `createDataAccess` (better-sqlite3) against a tmpdir SQLite file — identical harness to `check.integration.test.ts`, nothing mocked. It asserts the three properties the hook PROMISES: (A.1) the post-step `check` returns the new delta from a step's activity in BOTH the board-member announcement scope AND the participation message scope; (A.2) the immediately-following review is empty with the cursor UNCHANGED (no re-flood + cursor advanced); (B) **pull-only/no-push** — the bounded-delta envelope `{ announcements, messages, cursor }` is RETURNED (request→response) and the server delivers ZERO notifications across the whole exchange. The no-push counter is sound: it routes through the SDK's `fallbackNotificationHandler` (JSDoc: "invoke for ANY notification types that do not have their own handler installed"), and the test installs no per-type handler, so a 0 count is a real zero-push proof. Cross-checked against production `check.ts` / `core/discovery/check.ts` — the envelope shape, cursor-advance-to-`maxReturned`, and "pushes nothing" are exactly as asserted. The `protocol` first-check field is omitted here (temp DB unseeded), so the `deltaOf` cast is unaffected.

- **Rule 5 (NFR tripwire):** NOT triggered — NFR5 "bounded polling / no push" is the hook's basis and is both stated in the asset AND asserted by the QA push-counter; no unmeasurable-NFR workaround.

- **Rule 6 (ADR):** N/A — `docs/adr/` is absent and this asset story references no ADR.

- **Rule 8 (8.2→8.3 boundary):** the hook is SELF-CONTAINED — no `file:` array entry (the guard pins `["']file:` is absent; only `file:` mentions are inside COMMENTS explaining the 8.3 forward note). The comment correctly defers the canonical `skill-rules.md` registry + per-skill templates to Story 8.3 as a forward reconciliation, NOT a dependency. No dangling forward reference.

- **Tunability (AC #2):** BOTH operator knobs are documented and actionable — CADENCE (default per-step; how to switch to end-of-workflow-only by deleting the per-step fact + keeping `on_complete`, or every-N-steps) and REVIEW DEPTH (default full scan→investigate→respond; how to dial to a bare `check`). NO-push under any setting stated AND asserted by the QA push-counter.

- **Consistency:** the README `## Contents` cross-link is accurate (names the four tools, post-step pull review, two knobs, pull-only/NFR5, doc/config-only, resolver merges it, kit inlines it, links the tool contract). The hook agrees with `integration/bmad/agent-prompt-snippet.md` (§"Post-step board-review cadence" + "Where the cadence comes from in BMad — Epic 8 wires the post-step `check` … via a `.toml` post-condition hook") and `docs/pull-only-delivery.md` (which already references this exact cadence hook). No drift.

**Full honest gate (repo root, pnpm; build before test):** lint clean → build clean (7 packages) → typecheck clean → **test 670 passed / 98 files** → format `--check` "All matched files use Prettier code style!".

**Findings triaged:**

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | LOW | Stale suite count in the story's Dev Notes / Completion Notes / Change Log (says "657 → 669"); QA subsequently added the integration test (+1 → **670**). Doc-tracking only — the cycle-log `qa_complete` already records 670, and the gate confirms 670. | **RESOLVED inline** — corrected the Completion Notes + File List + Change Log below to reflect the QA-added test and the 670 count. |

No HIGH or MED findings. No deferred items.

## Tasks / Subtasks

- [x] Task 1: Author `integration/bmad/cadence-hook.toml` (AC: #1, #2)
  - [x] A valid BMad `[workflow]` customization FRAGMENT (the shape the resolver merges as the team layer — see Source facts for the exact merge semantics). It wires the post-step board review onto the two resolvable hook surfaces:
    - `persistent_facts` — a rich literal fact stating the **per-step** board-review obligation the agent carries for the whole run (the post-condition the agent applies at every `<step>` boundary): after completing each workflow step, before starting the next, dial in and (1) `check` your delta since last dial-in; (2) scan new announcements in your sub-board(s); (3) `read_room` rooms of interest; (4) `reply` to new messages in rooms you participate in; (5) `react` 👍 to ratify agreements; then return to the task. State the pull-only invariant (the board never pushes — this is a review you initiate) and "keep it light: a quiet board needs no action."
    - `on_complete` — a terminal instruction that fires one final board review when the workflow reaches its last step (belt-and-suspenders end-of-workflow review).
  - [x] **Tunability (AC #2):** document, in TOML comments, the two operator knobs — **cadence** (default one review per step end; how to change to end-of-workflow-only by removing the per-step fact and keeping `on_complete`, or to every-N-steps) and **review depth** (default the full scan→investigate→respond; how to dial down to a bare `check`). State explicitly the hook introduces NO push — it is purely a pull review wired as a post-condition (NFR5/FR35).
  - [x] Self-contained — NO `file:` ref to a not-yet-existing asset (the cadence content is inline literal facts). Note in a comment that Story 8.3 ships the canonical `skill-rules.md` registry (cadence + Negotiation Protocol convention) and the per-skill `_bmad/custom/*.toml` templates, and MAY refactor this hook to load the registry via a `file:` ref (single-source-of-truth) — a forward reconciliation, NOT a dependency this story has.
- [x] Task 2: Cross-link + content-guard (AC: #3)
  - [x] Cross-link `integration/bmad/cadence-hook.toml` from `integration/bmad/README.md` (a `## Contents` bullet, mirroring the existing asset bullets; name the tools, note the kit inlines it, note pull-only).
  - [x] Add a content-guard test (e.g. `packages/mcp-server/src/cadence-hook-doc.test.ts`, mirroring `agent-prompt-snippet-doc.test.ts` / `identity-bootstrap-doc.test.ts`) asserting: the `[workflow]` table + `persistent_facts` + `on_complete` keys are present; the review steps (scan announcements, investigate/`read_room` rooms, respond/`reply` in joined rooms, ratify/`react`) and the `check` cadence are stated; the pull-only / no-push invariant is stated; the tunable cadence + depth knobs are documented; **every backticked tool token it names (`check`, `read_room`, `reply`, `react`) is a REAL advertised tool** (pin to the live set the same way the sibling guards do — call-form-aware regex per the Story 8.1 CR fix; allowlist non-tool params). Mutation-test it non-vacuous (Rule 10).
- [x] Task 3: Full gate (AC: #3)
  - [x] Run lint → build → typecheck → test → format `--check`. All green. Report the final count (657 after Story 8.1).

## Dev Notes

This story ships the canonical cadence-hook ASSET (`integration/bmad/cadence-hook.toml`, AR24 / FR35 / FR36) — the `.toml` post-condition hook that fires an agent's board review after each workflow step. DOCUMENTATION/CONFIG ASSET (no board code); a content-guard pins its claims (Rule 10), and the lead smoke proves it is a GENUINELY resolvable BMad customization via the real Python resolver.

**Rule 1 (Integration ACs):** N/A — a config asset (no new service). AC #3's "the real resolver merges it" is the integration-style evidence (lead smoke).
**Rule 3 (real-runtime evidence):** the QA tier proves the cadence's heartbeat tool `check` is genuinely callable + yields the bounded pull-only delta the hook promises (over real `Client`↔`McpServer`); the lead smoke proves the hook RESOLVES through the actual `resolve_customization.py`.
**Rule 4 (verify source-facts):** the hook names `check`/`read_room`/`reply`/`react` — all shipped (Epics 2/4/5, `docs/mcp-tool-contract.md` §6). The BMad `[workflow]` keys (`persistent_facts`, `on_complete`, `activation_steps_*`) are REAL — verified against `.claude/skills/bmad-dev-story/customize.toml` and the live `_bmad/custom/bmad-dev-story.toml` (which loads `skill-rules.md` via exactly this `persistent_facts` `file:`-ref mechanism). Verify before authoring.
**Rule 5:** N/A (FR35/36 are functional, not an unmeasurable NFR). NFR5 (bounded polling) is the basis for "pull-only, no push."
**Rule 8 (reconcile contradictions):** explicitly flag the 8.2→8.3 boundary — 8.2 ships the self-contained hook; 8.3 ships `skill-rules.md` + the per-skill templates and may consolidate. 8.2 carries NO forward dependency (inline facts; resolvable standalone).
**Rule 10 (content-guard for agent-consumed asset):** the hook is consumed by the BMad resolver + the agent — a wrong tool name or malformed table is a real failure. The content-guard pins it; the lead smoke proves it resolves.

### Source facts (verified at story creation, baseline `6cfad76`)

- **BMad customization resolver** (`_bmad/scripts/resolve_customization.py`, 238 lines, Python 3.11+ `tomllib`): three-layer structural merge — skill `customize.toml` (base) → `{project-root}/_bmad/custom/{skill-name}.toml` (team, committed) → `{skill-name}.user.toml` (user, gitignored). `find_project_root` walks UP from the skill dir for `_bmad`/`.git`. `persistent_facts` is a plain array → **appends** across layers (no `code`/`id` keying). `--key workflow` (or `--key workflow.persistent_facts`) extracts a sub-tree. Scalars (`on_complete`) override-win. **The cadence-hook.toml is a team-layer fragment** — its `[workflow]` table merges onto the skill's base.
- **The `[workflow]` schema** (`.claude/skills/bmad-dev-story/customize.toml`): `activation_steps_prepend = []`, `activation_steps_append = []`, `persistent_facts = [...]` (literal sentences OR `file:`-prefixed refs, loaded as facts on activation; append), `on_complete = ""` (scalar; runs at the workflow's final step). There is NO per-`<step>` post-condition key — "after every step" is realized as a standing `persistent_facts` obligation; `on_complete` covers the final step. This is the faithful mapping of FR35's "workflow-step post-condition" onto the resolvable surface.
- **Live precedent** (`_bmad/custom/bmad-dev-story.toml`): already `[workflow]` + `persistent_facts = ["file:{project-root}/_bmad/custom/skill-rules.md"]` — proves the exact mechanism the cadence hook uses (a standing fact carried for the run). Only `*.user.toml` is gitignored (`_bmad/custom/.gitignore`); the team `.toml` overlays are tracked.
- **Tools named** (all shipped; `docs/mcp-tool-contract.md` §6): `check` (Epic 6 — per-identity cursor, bounded pull-only delta, NFR5), `read_room` (Epic 4), `reply` (Epic 4), `react` (Epic 5). No phantom tools.
- **Content-guard pattern:** `packages/mcp-server/src/agent-prompt-snippet-doc.test.ts` + the Story 8.1 `identity-bootstrap-doc.test.ts` (note its CR-hardened call-form-aware regex `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` — reuse it; the hook names tools in `` `check` `` bare form). Pin tool tokens to the live set; mutation-test.
- **Lead smoke (8.2 real-runtime proof):** run the REAL `python _bmad/scripts/resolve_customization.py` against a temp project (`<tmp>/_bmad/custom/<skill>.toml` = the hook; `<tmp>/_bmad/skills/<skill>/customize.toml` = a minimal base) and assert the resolved `workflow` block carries the cadence `persistent_facts` entry + the `on_complete` trigger (BMad genuinely consumes the hook). Python 3.13.7 + `tomllib` confirmed present.
- Toolchain (Epics 1–8.1): Node v24.16.0, pnpm 11.3.0; Python 3.13.7 (`python`, NOT `python3`, on PATH). Build before the full suite (forked workers). Suite at 657 after Story 8.1.

### Project Structure Notes

- New `integration/bmad/cadence-hook.toml` + a cross-link from `integration/bmad/README.md`; one content-guard test. NO board code, NO new tool/event/error code.
- SECOND of the four Epic-8 asset stories (8.1 bootstrap → **8.2 cadence hook** → 8.3 skill-rules registry + per-skill templates → 8.4 the self-contained kit that inlines all of them).
- 8.3 will author `integration/bmad/skill-rules.md` (the board-review obligation + Negotiation Protocol convention) and the `_bmad/custom/*.toml` templates that load it; it owns any consolidation of this hook to a `file:`-ref. Do NOT pre-create those here.

## Dev Agent Record

### Context Reference

- Story file (this doc), baseline `6cfad76` (matches frontmatter; preserved unchanged).
- Persistent facts loaded on activation: `project-context.md` + `_bmad/custom/skill-rules.md` (Rules 1–9). Rule 5 (NFR tripwire) and Rule 6 (ADR registry) noted as relevant to this stage; neither triggered (no NFR contradiction; `docs/adr/` does not exist and this story references no ADR).

### Source-fact verification (Rule 4 — verified all asserted facts against the repo BEFORE authoring)

- **Tools `check`/`read_room`/`reply`/`react` are all real, advertised tools.** Confirmed in `docs/mcp-tool-contract.md` §6 (the `AGENTBBS-TOOL-CONTRACT:BEGIN…END` canonical list carries all four) AND their live registration source files exist: `packages/mcp-server/src/tools/check.ts`, `read-room.ts`, `reply.ts`, `react.ts`. No phantom tools.
- **The `[workflow]` schema keys (`persistent_facts`, `on_complete`) are REAL.** Confirmed against `.claude/skills/bmad-dev-story/customize.toml` (base: `activation_steps_prepend/append`, `persistent_facts` [array, literal-or-`file:`, appends], `on_complete` [scalar, override-wins]) and the live precedent `_bmad/custom/bmad-dev-story.toml` (`[workflow]` + `persistent_facts = ["file:…/skill-rules.md"]`).
- **Resolver merge semantics confirmed** by reading `_bmad/scripts/resolve_customization.py` (238 lines): team-layer `.toml` deep-merges onto skill base; `persistent_facts` (plain array, no `code`/`id` key) APPENDS; `on_complete` (scalar) OVERRIDE-wins. The cadence-hook is authored as the team-layer `[workflow]` fragment.
- **Sibling-guard live-tool source confirmed**: `identity-bootstrap-doc.test.ts` pins phantom-tool candidates to the contract §6 `AGENTBBS-TOOL-CONTRACT` block (transitively bound to the live `McpServer` by `tool-contract.drift.test.ts`). The new guard pins to the SAME source and reuses the CR-hardened call-form-aware regex `` /`([a-z][a-z_]{2,})(?:`|\{)/g ``.

### Implementation Plan / Notes

**Task 1 — `integration/bmad/cadence-hook.toml`** (new). A real `[workflow]` team-layer fragment:
- `persistent_facts` = one rich LITERAL multi-line fact (TOML `'''…'''` literal string — verbatim, emoji-safe, no escaping) stating the per-step board-review post-condition: at each workflow step boundary run the pull review — (1) `check` delta, (2) scan sub-board announcements, (3) `read_room` rooms of interest, (4) `reply` in rooms you participate in, (5) `react` 👍 to ratify — then return. States the pull-only invariant ("the board never pushes — YOU initiate") and "keep it light: a quiet board needs no action." Authored as a single array entry so the resolver's APPEND semantics add it after a skill's base facts.
- `on_complete` = scalar terminal instruction firing ONE final pull review at the workflow's last step.
- TOML comments document the two AC #2 knobs: **CADENCE** (default per-step; how to switch to end-of-workflow-only by deleting the per-step fact + keeping `on_complete`, or every-N-steps) and **REVIEW DEPTH** (default full scan→investigate→respond; how to dial to a bare `check`). Explicitly states NO push under any setting (pure pull, FR35/NFR5).
- Self-contained (inline literal facts, NO `file:` array entry). A comment records the Story 8.3 forward reconciliation (8.3 ships `skill-rules.md` + per-skill templates and MAY later load this hook's content via a `file:` ref — forward, not a dependency).
- **Validated it PARSES** (`python -c "import tomllib; tomllib.load(...)"` → `toml-ok`; `[workflow]` with `persistent_facts` [1 entry] + `on_complete` [344-char scalar]).
- **Real-resolver smoke (AC #3 integration evidence)**: ran the ACTUAL `_bmad/scripts/resolve_customization.py` against a temp project (`<tmp>/_bmad/skills/<skill>/customize.toml` = a minimal base with one pre-existing fact; `<tmp>/_bmad/custom/<skill>.toml` = the hook copied verbatim) and asserted the resolved `workflow` block: base fact + cadence fact BOTH present in append order (append proven), the cadence fact carries all four backticked tools + `PULL-ONLY` + `POST-CONDITION` + "every workflow step", and the `on_complete` override surfaced with its content. → `RESOLVER SMOKE OK`. (The lead re-runs this as the per-story smoke gate.)

**Task 2 — cross-link + content-guard**:
- `integration/bmad/README.md` (modified): added a `## Contents` bullet for `cadence-hook.toml` mirroring the `identity-bootstrap.md`/`agent-prompt-snippet.md` bullets — names the four tools, the post-step pull review, the two knobs, pull-only (NFR5), documentation/config-only, that the real resolver merges it and the install kit inlines it, and links the tool contract.
- `packages/mcp-server/src/cadence-hook-doc.test.ts` (new, 12 tests) — mirrors `identity-bootstrap-doc.test.ts`: same `import.meta.url` path resolution, the SAME §6 canonical-tool-list parser as the source of truth, and the SAME call-form-aware phantom-tool regex. Asserts: (a) the `[workflow]` table header + `persistent_facts`/`on_complete` keys present (assigned, not just mentioned); (b) the five review steps each anchored to their tool (`check` cadence + post-condition framing + step-boundary; scan announcements; `read_room` investigate; `reply` scoped to rooms you participate in; `react` ratify) ; (c) pull-only + explicit no-push invariant; (d) both tunable knobs (cadence + ≥1 alternative setting; depth + the bare-`check` dial-down); (e) self-contained (NO `"file:` array entry) + the Story 8.3 forward note; documentation/config-only + enforces-none disclaimer; all four tools named; and the no-phantom-tools scan (every backticked snake token is a real §6 tool or an allowlisted non-tool token — allowlist = the two `[workflow]` schema keys `persistent_facts`/`on_complete`), with a converse vacuity guard (all four tools must appear as backticked candidates).

**Mutation testing (Rule 7 + Rule 10) — two high-stakes pins, each confirmed RED then restored byte-identical** (pre/post blob hash `422c5a9a7ba386f96f8bf27ba696dfbdaababbfc` identical both times):
1. No-phantom-tools pin: injected `` `subscribe` `` into `on_complete` → guard RED (`expected [ 'subscribe' ] to deeply equal []`). Restored → hash pristine.
2. `[workflow]` table-header pin: renamed `[workflow]` → `[wokflow]` → guard RED (`expected false to be true`; this also breaks the real resolver — a genuine defect). Restored → hash pristine.

### Decisions

- **Mapped FR35's "workflow-step post-condition" onto the resolvable `[workflow]` surface as a standing `persistent_facts` obligation + `on_complete` final-step trigger.** The `[workflow]` schema has NO per-`<step>` post-condition key (verified in `customize.toml`); "after every step" is faithfully realized as a fact the agent carries for the whole run, with `on_complete` covering the final step. This is the same mechanism the live `bmad-dev-story.toml` uses (a standing fact), so it is a proven shape, not a novel one. (Per Source facts; recorded here as the load-bearing modeling choice.)
- **TOML `'''…'''` literal string for the multi-line fact** (not `"""…"""` basic): the fact contains the 👍 emoji and apostrophes; a literal string is verbatim/emoji-safe with no escaping, and contains no `'''` sequence. Confirmed it parses.
- **Phantom-tool scan covers the WHOLE `.toml`** (not an inner sentinel block, unlike the Markdown siblings): the BMad resolver and agent consume the entire `[workflow]` table, and the TOML comments document the same four tools — so the whole file is the agent-/resolver-consumed surface. Allowlisted exactly the two backticked `[workflow]` schema keys (`persistent_facts`, `on_complete`); the only other backticked snake tokens are the four real tools (enumerated before authoring the allowlist).

### Completion Notes

- All 3 tasks + subtasks complete; all 3 ACs satisfied. AC #1 (per-step `persistent_facts` + `on_complete` final review, pull-only post-condition), AC #2 (two tunable knobs documented, no push), AC #3 (real resolvable `[workflow]` customization — proven by the real-resolver smoke; only shipped tools; content-guard pins claims to the §6 source of truth, mutation-verified non-vacuous).
- Full gate (honest order, repo root, pnpm) at DEV stage: **lint** clean → **build** clean (7 packages) → **typecheck** clean → **test 669 passed / 97 files** (was 657 after Story 8.1; +12 = the new content-guard, no regressions) → **format `--check`** "All matched files use Prettier code style!". (The QA stage subsequently added `check.cadence-post-condition.integration.test.ts` (+1), and the code-review-stage gate re-ran green at **670 passed / 98 files** — see Review Findings.)
- Asset hash pristine (`422c5a9…`) after all mutation tests. NO board code, NO new tool/event/error code. NOT committed (lead commits after the per-story smoke gate); sprint-status not modified by the dev stage.
- Rule 5: not triggered (no NFR contradiction). Rule 6: N/A (`docs/adr/` absent; story references no ADR).

### File List

- `integration/bmad/cadence-hook.toml` (new) — the resolvable `[workflow]` cadence-hook asset.
- `integration/bmad/README.md` (modified) — `## Contents` cross-link bullet for the hook.
- `packages/mcp-server/src/cadence-hook-doc.test.ts` (new, dev stage) — content-guard test (12 tests).
- `packages/mcp-server/src/tools/check.cadence-post-condition.integration.test.ts` (new, QA stage) — real-runtime proof of the cadence heartbeat (pull-only bounded delta + cursor-advance + zero-pushes over a real `Client`↔`McpServer`).

### Change Log

- 2026-05-31 — Story 8.2 implemented (dev): authored `integration/bmad/cadence-hook.toml` (real BMad `[workflow]` post-step board-review cadence hook — per-step `persistent_facts` pull-review obligation + `on_complete` final review, two tunable knobs, self-contained, pull-only/no-push); cross-linked it from `integration/bmad/README.md`; added the `cadence-hook-doc.test.ts` content-guard (12 tests, 2 high-stakes pins mutation-verified non-vacuous, restored byte-identical). Verified the hook PARSES (`tomllib`) and RESOLVES through the real `resolve_customization.py` (team-layer merge; both keys surface; append + override proven). Dev-stage gate green; suite 657 → 669.
- 2026-05-31 — QA: added `packages/mcp-server/src/tools/check.cadence-post-condition.integration.test.ts` (+1 → 670) — real-runtime proof of the cadence heartbeat (pull-only bounded delta + cursor-advance + zero server pushes over a real `Client`↔`McpServer`; cursor-advance mutation-verified red, core restored byte-identical).
- 2026-05-31 — Code review: APPROVED. Independently re-ran the real-resolver smoke (resolves as team layer, append + override proven), spot-checked the content-guard non-vacuous (phantom-tool mutation → RED, restored to pristine hash `422c5a9a…`), and confirmed the QA integration test is genuine real-runtime evidence (no mocks; the no-push counter routes through the SDK `fallbackNotificationHandler`). One LOW finding (stale 669 count) resolved inline → reconciled to 670. Full gate re-run green at **670 passed / 98 files**.
