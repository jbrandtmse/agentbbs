---
baseline_commit: 77322ca
---

# Story 8.3: Skill customizations and skill-rules registry

Status: done

## Story

As an operator,
I want the BMAD `.toml` customizations and a skill-rules registry that encode the board-review behavior,
So that the cadence and protocol conventions load into every relevant BMAD skill.

## Acceptance Criteria

1. **Given** a target BMAD project,
   **When** the customizations are in place,
   **Then** the relevant `_bmad/custom/*.toml` files load the skill-rules registry via `persistent_facts` (and/or `on_complete` for the post-step review),
   **And** the skill-rules registry states the board-review obligation (scan announcements, investigate interesting rooms, respond in joined rooms) and the Negotiation Protocol convention.

2. **Given** these are source-of-truth assets,
   **When** I inspect `integration/bmad/`,
   **Then** the `.toml` templates, `skill-rules.md`, the cadence hook, and the prompt snippet exist as the canonical copies the installation kit inlines.

## Review Findings

**Verdict: APPROVED — clean review.** 0 HIGH, 0 MED, 0 LOW-actionable; 2 informational items dismissed as noise. Full honest gate green: lint ✓ → build ✓ (7 packages) → typecheck ✓ → test ✓ (**689** passed / 100 files) → `prettier --check` ✓. No files changed by the review stage.

### What was verified (adversarial review across Acceptance Auditor / Edge Case Hunter / Blind Hunter lenses + the story-specific focus)

- **AC #2 — all four canonical assets exist** in `integration/bmad/`: the `.toml` templates (`custom-templates/`), `skill-rules.md`, `cadence-hook.toml` (8.2), `agent-prompt-snippet.md` (7.3); `identity-bootstrap.md` (8.1) also present. The README `## Contents` lists all of them. ✓
- **AC #1 — templates are REAL, resolvable overlays.** All four parse with `tomllib`; each is `[workflow]` + `persistent_facts = ["file:{project-root}/_bmad/custom/skill-rules.md"]` + a non-empty `on_complete` (382 chars). Mirrors the four live `_bmad/custom/<skill>.toml` precedents exactly (the only addition is `on_complete`) — Rule-4 source-fact verified against the live overlays. ✓
- **AC #1 — the REAL resolver merges a template + loads the registry (integration-style evidence, Rule 1).** Ran `python _bmad/scripts/resolve_customization.py` against a temp CONSUMING project (installed template = `_bmad/custom/bmad-dev-story.toml`, installed registry = `_bmad/custom/skill-rules.md`, plus a skill-base `customize.toml` carrying a pre-existing fact + a placeholder `on_complete`). Resolved `workflow`: `persistent_facts` **APPENDED** the registry `file:` ref to the base's pre-existing fact (deep-merge composes, no clobber); `on_complete` **OVERRIDE-wins** (base placeholder replaced by the board-review instruction). ✓
- **Registry completeness + consistency.** States the post-step board-review obligation (`check` / scan announcements / `read_room` / `reply` in rooms you participate in / `react` 👍 ratify) AND the four moves (Propose/Counter via `reply` → Ratify via `react` → Frozen via `read_contract`). Backticked tokens = `check`, `read_room`, `reply`, `react`, `read_contract`, `register`, `login`, `unreact` — all REAL (contract §6); `seq`/`persistent_facts`/`on_complete` allowlisted. **No phantom tools.** ✓
- **Rule 5 (NFR5 tripwire) — stated, not worked around.** Registry Rule A explicitly states PULL-ONLY / "the board never pushes" (NFR5) and cross-refs `docs/pull-only-delivery.md`; the content-guard pins both the "pull-only" framing and the explicit "no push" statement. ✓
- **Rule 8 (reconcile contradictions) — DISCHARGED.** (a) `cadence-hook.toml` is **byte-identical** to its 8.2 commit — sha256 `ecef6918…` on both baseline `77322ca` and the working tree; `git diff` empty. The hook's own "Story 8.3 MAY later refactor" note is permissive, so leaving it standalone is a valid resolution. (b) The new `integration/bmad/skill-rules.md` is disambiguated from this repo's OWN `_bmad/custom/skill-rules.md` via a dedicated "⚠️ Not to be confused with" header + side-by-side table; the guard pins the disambiguation reference. (c) The content-guard's registry↔cadence-hook consistency assertion genuinely prevents drift (subset check on the four review tools). ✓
- **Rule 10 — content-guard NON-VACUOUS + pins to the LIVE tool set (verified independently, not on faith).** Mutation 1: registry `read_room` → phantom `peek_room` ⇒ no-phantom-tools guard RED (caught `peek_room`); restored byte-identical (sha256 `e03a14d2…`). Mutation 2: removed `read_contract` from the LIVE contract §6 block ⇒ guard RED treating the registry's `read_contract` as phantom — proving the guard reads `docs/mcp-tool-contract.md` §6 as its source of truth, NOT a hardcoded array; contract doc restored byte-identical (sha256 `c0ff7a3a…`, `git diff HEAD` empty). ✓
- **Rule 3 — QA integration test is genuine real-runtime, not a hollow pass.** `skill-rules-negotiation-protocol.integration.test.ts` drives `reply`/`react`/`unreact`/`read_room`/`read_contract` over a REAL `Client`↔`McpServer` (`InMemoryTransport`) backed by REAL `createDataAccess` (better-sqlite3) against a genuine temp-dir SQLite file — nothing mocked. Executes the full four-move convention: Propose/Counter (competing replies) → Ratify (live 👍) → Frozen (`read_contract` = highest-seq live-👍'd = M3, asserting NOT the also-👍'd lower-seq M2) → Revert (unreact ⇒ reverts to M2) → re-freeze a refinement (M4). Mutation 3: flipped `currentContract` (`packages/core/src/rooms/contract.ts`) to lowest-seq ⇒ integration test RED at the Frozen assertion (`expected 6 to be 8`, i.e. returned M2 not M3) — proving it discriminates the FR21 semantic; `contract.ts` restored byte-identical (sha256 `77f13842…`, `git diff HEAD` empty), core rebuilt. ✓
- **Test discoverability (Rule 8/QA).** Both new tests run in the default suite (689 ran; +1 over the dev-stage 688 = the QA integration test). ✓
- **Cross-links resolve.** Every relative link in `skill-rules.md`, `custom-templates/README.md`, and the updated `README.md` resolves, except the intentional `../install-agentbbs.md` (Story 8.4) forward reference — see dismissed item below.

### Dismissed (noise — not actionable)

- [Review][Dismiss] **`../install-agentbbs.md` forward reference unresolved.** `skill-rules.md` (header) and `custom-templates/README.md` reference the Story-8.4 install kit, which does not exist yet. This is an INTENTIONAL, documented forward reference consistent with the epic's already-shipped assets (`cadence-hook.toml` and `agent-prompt-snippet.md` already reference `install-agentbbs.md`); the story Dev Notes explicitly scope 8.4 as next and instruct "Do NOT pre-create the kit here." Resolves when 8.4 lands. Not a defect.
- [Review][Dismiss] **Stale "688 tests" in the dev-authored prose.** Task 4 and the Dev Agent Record state 688; the live authoritative count is 689 after QA added the integration test. The cycle-log already records `count=689` at `qa_complete`, and this Review Findings header records 689. Cosmetic intermediate count in dev prose that predates QA's addition — no code or behavior impact.

## Tasks / Subtasks

- [x] Task 1: Author `integration/bmad/skill-rules.md` — the canonical BOARD-behavior registry (AC: #1)
  - [x] A rich-Markdown registry (the board-rules a consuming project's BMad skills load as standing facts via `persistent_facts`). It states, for an agent:
    - **The board-review obligation** (FR35 review depth): after each workflow step, perform a board review — at minimum `check`, then scan your sub-board's announcements, investigate rooms of interest (`read_room`), and respond to new messages in rooms you participate in (`reply`); ratify agreements with `react` 👍. Pull-only (the board never pushes; cross-ref [`docs/pull-only-delivery.md`](../../docs/pull-only-delivery.md) and the cadence hook [`cadence-hook.toml`](cadence-hook.toml)).
    - **The Negotiation Protocol convention**: the four moves Propose (`reply`) → Counter (`reply`) → Ratify (`react` 👍) → Frozen (`read_contract`). Convention the board does NOT enforce; cross-ref [`docs/negotiation-protocol.md`](../../docs/negotiation-protocol.md).
  - [x] DISAMBIGUATE from this repo's OWN `_bmad/custom/skill-rules.md` (the AgentBBS dev-pipeline rules — a DIFFERENT file). The new `integration/bmad/skill-rules.md` is the CANONICAL board-behavior registry the kit installs into a CONSUMING project's `_bmad/custom/skill-rules.md`. State this in the file header so neither is mistaken for the other. → Done via a dedicated "⚠️ Not to be confused with …" header section + a side-by-side table.
- [x] Task 2: Author the per-skill `_bmad/custom/*.toml` overlay TEMPLATES (AC: #1, #2)
  - [x] Canonical templates under `integration/bmad/custom-templates/` (a NEW subdir — keep clearly separate from this repo's live `_bmad/custom/`), one per standard BMad dev-cycle skill, mirroring the live precedent shape (`_bmad/custom/<skill>.toml` = `[workflow]` + `persistent_facts = ["file:{project-root}/_bmad/custom/skill-rules.md"]`). Cover the standard set: `bmad-dev-story.toml`, `bmad-create-story.toml`, `bmad-qa-generate-e2e-tests.toml`, `bmad-code-review.toml` (matching the four in `_bmad/custom/`).
  - [x] Each template: `[workflow]` loading the installed registry via `persistent_facts = ["file:{project-root}/_bmad/custom/skill-rules.md"]` (the `{project-root}` is the CONSUMING project's root, resolved by the skill at runtime — that is where the kit installs the registry), AND set `on_complete` to the post-step board-review trigger (AC #1 "and/or on_complete for the post-step review"). Each MUST be valid TOML the real resolver merges (verify with `tomllib`). → All four verified with `tomllib`; the real resolver lead-smoke (below) merged a template against the base `customize.toml`.
  - [x] A short `integration/bmad/custom-templates/README.md` (or a section in the parent README) explaining: the kit (8.4) copies each template to the consuming project's `_bmad/custom/<skill>.toml` and the registry to `_bmad/custom/skill-rules.md`; the `{project-root}` ref resolves in the consuming project.
- [x] Task 3: Reconcile with the 8.2 cadence hook + cross-link (AC: #2, Rule 8)
  - [x] The cadence-hook.toml (8.2) stays the STANDALONE focused cadence hook (self-contained inline facts). `skill-rules.md` is the FULLER registry (cadence/board-review obligation + protocol convention). Keep them CONSISTENT (same tools, same review steps) — do NOT let them drift. State the relationship in `skill-rules.md` (the registry is the rules; the cadence-hook is the focused wiring; the per-skill templates load the registry). This discharges the Rule-8 forward note left in 8.2. → `cadence-hook.toml` left UNCHANGED (byte-identical to its 8.2 commit); the registry states the relationship in writing; a consistency assertion in the content-guard enforces no drift.
  - [x] Cross-link `skill-rules.md` + `custom-templates/` from `integration/bmad/README.md` (`## Contents` bullets). Confirm the README now lists all FOUR canonical assets (`.toml` templates, `skill-rules.md`, `cadence-hook.toml`, `agent-prompt-snippet.md`) per AC #2.
- [x] Task 4: Content-guard + full gate (AC: #1, #2)
  - [x] A content-guard test (e.g. `packages/mcp-server/src/skill-rules-registry-doc.test.ts`, mirroring the sibling doc-guards + the call-form-aware regex) asserting: `skill-rules.md` states the board-review obligation (scan announcements / investigate `read_room` rooms / respond `reply` in joined rooms / ratify `react`) AND the four protocol moves (Propose/Counter/Ratify/Frozen) AND names `read_contract`; every backticked tool token it names (`check`, `read_room`, `reply`, `react`, `read_contract`) is a REAL advertised tool (pin to the live set); each `custom-templates/*.toml` is parseable + loads `skill-rules.md` via `persistent_facts` + sets `on_complete`; AND a CONSISTENCY assertion that `skill-rules.md` and `cadence-hook.toml` name the same review tools (no drift). Mutation-test ≥2 high-stakes pins RED, restore byte-identical (Rule 10 + Rule 7). → 18 tests; 2 mutations (registry `read_contract`→`subscribe`; registry `read_room`→`list_rooms`) confirmed RED, restored byte-identical (sha256-verified).
  - [x] Run lint → build → typecheck → test → format `--check`. All green. Report the final count (670 after Story 8.2). → **688 tests** (670 + 18), 99 files, all green.

## Dev Notes

This story ships the canonical board-behavior REGISTRY (`integration/bmad/skill-rules.md`) + the per-skill `_bmad/custom/*.toml` overlay TEMPLATES (`integration/bmad/custom-templates/`) — the assets that load the board-review cadence + Negotiation Protocol convention into every relevant BMad skill (FR35/FR36, AR24). By this story's end, all FOUR canonical asset types AC #2 lists exist in `integration/bmad/`: the `.toml` templates (NEW), `skill-rules.md` (NEW), the cadence hook (`cadence-hook.toml`, Story 8.2), and the prompt snippet (`agent-prompt-snippet.md`, Story 7.3). DOCUMENTATION/CONFIG ASSETS (no board code).

**Rule 1:** N/A (no new service). AC #1's "the real resolver merges the template + loads the registry" is the integration-style evidence (lead smoke).
**Rule 3:** the registry names tools the agent executes; the content-guard pins them to the live set; the lead smoke proves a template resolves through the REAL resolver AND the registry's tools are advertised by the real binary.
**Rule 4 (verify source-facts):** the registry/templates name `check`/`read_room`/`reply`/`react`/`read_contract` — all shipped (Epics 2/4/5/6, `docs/mcp-tool-contract.md` §6). The `[workflow]`/`persistent_facts`/`on_complete` keys + the `_bmad/custom/<skill>.toml` `file:`-ref pattern are REAL — verified against the live `_bmad/custom/bmad-code-review.toml` (and siblings), which load `skill-rules.md` via exactly this mechanism. Verify before authoring.
**Rule 5:** N/A. NFR5 (bounded pull) underlies the pull-only stance.
**Rule 8 (reconcile contradictions — DISCHARGE the 8.2 forward note):** 8.2 left a Rule-8 note that 8.3 owns consolidation. Resolution: `cadence-hook.toml` stays the standalone focused hook; `skill-rules.md` is the fuller registry; the per-skill templates load the registry. Keep the cadence content CONSISTENT across both (content-guard enforces no drift). ALSO disambiguate the new `integration/bmad/skill-rules.md` (board rules, for consuming projects) from this repo's OWN `_bmad/custom/skill-rules.md` (AgentBBS dev-pipeline rules) — two different files, same basename; state it explicitly.
**Rule 10:** the registry + templates are agent-/resolver-CONSUMED — the content-guard pins every machine-relevant claim (tool names, the review steps, the four moves, the template wiring) to a source of truth, mutation-tested.

### Source facts (verified at story creation, baseline `77322ca`)

- **Live overlay precedent** (`_bmad/custom/bmad-code-review.toml`, `bmad-create-story.toml`, `bmad-qa-generate-e2e-tests.toml`, `bmad-dev-story.toml`): each is `[workflow]` + `persistent_facts = ["file:{project-root}/_bmad/custom/skill-rules.md"]`. This is EXACTLY the per-skill template shape — the new templates mirror it (and ADD `on_complete` for the post-step review). Only `*.user.toml` is gitignored; team `.toml` overlays are tracked.
- **Resolver** (`_bmad/scripts/resolve_customization.py`): three-layer structural merge; `persistent_facts` appends; `on_complete` scalar override-wins; `file:`-prefixed facts are loaded BY the skill at runtime (the resolver returns the string). `{project-root}` is resolved relative to the project that contains the skill (the CONSUMING project at install time). Python 3.13.7 + `tomllib` present (use `python`, NOT `python3` — the alias is a broken App-execution stub on this host).
- **Tools named** (all shipped; `docs/mcp-tool-contract.md` §6): `check` (Epic 6), `read_room`/`reply` (Epic 4), `react` (Epic 5), `read_contract` (Epic 5 — the Frozen move). No phantom tools.
- **Protocol + cadence docs to cross-ref:** `docs/negotiation-protocol.md` (7.1), `docs/pull-only-delivery.md` (6.2), `integration/bmad/cadence-hook.toml` (8.2), `integration/bmad/agent-prompt-snippet.md` (7.3, which describes the same cadence + protocol at the system-prompt level — keep the registry CONSISTENT with it).
- **Content-guard pattern:** `packages/mcp-server/src/cadence-hook-doc.test.ts` / `identity-bootstrap-doc.test.ts` (call-form-aware regex `` /`([a-z][a-z_]{2,})(?:`|\{)/g ``; pin tool tokens to the live set via the contract §6 source bound by `tool-contract.drift.test.ts`). Mirror it; add the cross-asset consistency assertion (skill-rules.md ↔ cadence-hook.toml same review tools).
- **Lead smoke (8.3 real-runtime proof):** run the REAL `python _bmad/scripts/resolve_customization.py` against a temp project where `_bmad/custom/<skill>.toml` = a template copy and `_bmad/custom/skill-rules.md` = the registry copy; assert the resolved `workflow` carries the `file:.../skill-rules.md` `persistent_facts` ref + the `on_complete` post-step trigger. Plus drive the real stdio binary to confirm every tool the registry names is advertised (no phantom). Python present.
- Toolchain (Epics 1–8.2): Node v24.16.0, pnpm 11.3.0, Python 3.13.7 (`python`). Build before the full suite (forked workers). Suite at 670 after Story 8.2.

### Project Structure Notes

- New `integration/bmad/skill-rules.md` + `integration/bmad/custom-templates/*.toml` (4 standard-skill templates) + a templates README/section + a cross-link from `integration/bmad/README.md`; one content-guard test. NO board code, NO new tool/event/error code.
- THIRD of the four Epic-8 asset stories (8.1 bootstrap → 8.2 cadence hook → **8.3 skill-rules registry + per-skill templates** → 8.4 the self-contained kit that inlines all of them).
- 8.4 (next) authors the SINGLE self-contained `integration/bmad/install-agentbbs.md` that inlines ALL of: the identity bootstrap (8.1), the cadence hook (8.2), this registry + templates (8.3), and the prompt snippet (7.3) — generating them in a target project idempotently, backing up, never touching foreign assets. Do NOT pre-create the kit here.

## Dev Agent Record

### Context Reference

- Story 8.3 — third of the four Epic-8 asset stories (8.1 bootstrap → 8.2 cadence hook → **8.3 skill-rules registry + per-skill templates** → 8.4 the self-contained kit). DOCUMENTATION/CONFIG assets only; NO board code, NO new tool/event/error code. Baseline `77322ca` (preserved in frontmatter).

### Source-fact verification (Rule 4 / Rule 3)

Confirmed every asserted source-fact against the repo BEFORE authoring:

- **Tools live (contract §6 canonical block, transitively pinned to `McpServer` by `tool-contract.drift.test.ts`):** `check`, `read_room`, `reply`, `react`, `read_contract` all present (also `unreact`). No phantom tools.
- **Live overlay precedent (`_bmad/custom/{bmad-dev-story,bmad-create-story,bmad-qa-generate-e2e-tests,bmad-code-review}.toml`):** each is exactly `[workflow]` + `persistent_facts = ["file:{project-root}/_bmad/custom/skill-rules.md"]`. The new templates mirror this shape and ADD `on_complete`.
- **Resolver (`_bmad/scripts/resolve_customization.py`):** confirmed `persistent_facts` arrays APPEND, `on_complete` scalar OVERRIDE-wins, `file:`-prefixed facts loaded by the skill at runtime, `{project-root}` resolved relative to the project containing the skill (the consuming project at install time).
- **Content-guard pattern (`cadence-hook-doc.test.ts`):** reused its call-form-aware regex `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` and its sentinel-parsed canonical tool list (`# AGENTBBS-TOOL-CONTRACT:BEGIN/END`) as the source of truth — same source the sibling guard pins to.

### Rule-8 discharge (the 8.2 forward note)

8.2's `cadence-hook.toml` left a forward note that 8.3 owns consolidation. Resolution implemented:

- `cadence-hook.toml` stays the **standalone focused** hook — left **byte-identical** to its 8.2 commit (no refactor to a `file:` ref; the inline literal fact remains authoritative and self-contained).
- `skill-rules.md` is the **fuller registry** (board-review obligation Rule A + Negotiation Protocol convention Rule B); the per-skill templates load it.
- The relationship is stated in writing in the registry's "How this registry relates to the other AgentBBS BMad assets" section, and a **consistency assertion** in the content-guard pins that the registry and the cadence hook name the **same review tools** (no drift) — so the two cannot silently diverge.
- The **second** Rule-8 obligation — disambiguating the new `integration/bmad/skill-rules.md` (board registry, for consuming projects) from this repo's OWN `_bmad/custom/skill-rules.md` (AgentBBS dev-pipeline rules) — is handled by a dedicated "⚠️ Not to be confused with …" header + a side-by-side table in the registry, and a guard assertion pinning the disambiguation reference.

### Lead-smoke proof (AC #1 real-runtime evidence)

Ran the **real** `python _bmad/scripts/resolve_customization.py` against a temp consuming project where `_bmad/custom/bmad-dev-story.toml` = a copy of the dev-story template and `_bmad/custom/skill-rules.md` = a copy of the registry. The resolved `workflow` carried BOTH the `file:{project-root}/_bmad/custom/skill-rules.md` `persistent_facts` ref (correctly APPENDED to the base's existing `project-context.md` fact — confirming the deep-merge composes) AND the `on_complete` post-step trigger naming `check`. All four templates also independently verified parseable with `tomllib`.

### Mutation tests (Rule 10 + Rule 7) — confirmed non-vacuous

- **Mutation 1** (registry `read_contract` → phantom `subscribe`): 3 assertions went RED — the no-phantom-tools guard (caught `subscribe`), the `read_contract`-names pin, and the five-registry-tools pin. Restored byte-identical (sha256 `e03a14d2…` matched).
- **Mutation 2** (registry `read_room` → `list_rooms`, a real tool, isolating the drift signal): 4 assertions went RED — including the **Rule-8 consistency pin** ("the registry and the cadence hook name the same review tools (no drift)"), plus the board-review-obligation, five-tools, and converse-sanity pins. Restored byte-identical.
- `cadence-hook.toml` and `bmad-dev-story.toml` also sha256-verified byte-identical after the mutation passes; `git diff --stat` on the tracked `cadence-hook.toml` is empty.

### Completion Notes

- Shipped the canonical board-behavior registry `integration/bmad/skill-rules.md` (Rule A: the post-step pull-only board review; Rule B: the four-move Negotiation Protocol convention; disambiguation header; relationship to the other assets; all cross-refs).
- Shipped four per-skill overlay templates under the NEW `integration/bmad/custom-templates/` (`bmad-dev-story`, `bmad-create-story`, `bmad-qa-generate-e2e-tests`, `bmad-code-review`), each `[workflow]` + `persistent_facts` `file:` ref to the registry + `on_complete`, plus a `custom-templates/README.md` explaining the kit's copy behavior and `{project-root}` resolution.
- Cross-linked `skill-rules.md` + `custom-templates/` from `integration/bmad/README.md`; the `## Contents` now lists all FOUR canonical asset types AC #2 requires (the `.toml` templates, `skill-rules.md`, `cadence-hook.toml`, `agent-prompt-snippet.md`).
- Content-guard `packages/mcp-server/src/skill-rules-registry-doc.test.ts` (18 tests): the board-review obligation, the four moves, `read_contract`, the no-phantom-tools pin, per-template `[workflow]`/`persistent_facts`-file-ref/`on_complete` checks, per-template `on_complete` no-phantom, and the registry↔cadence-hook consistency/Rule-8 pins.
- **Design decision:** the TS guard pins the templates' TOML *content claims* via regex presence (matching the sibling `cadence-hook-doc.test.ts` style) rather than parsing TOML in-process — no TOML parser is in the dependency tree and adding one is out of scope; the authoritative "is it valid TOML" proof is the Python `tomllib`/resolver lead-smoke. `seq` is allowlisted as a NON_TOOL token in the registry phantom scan (it is the `message_seq` wire field named in the FR21 Frozen semantic, not a tool — same way the protocol/snippet docs backtick it).
- **Gate (honest order):** lint ✓ → build ✓ → typecheck ✓ → test ✓ (**688** passed / 99 files; +18 over the 670 baseline) → `prettier --check` ✓.

### File List

- `integration/bmad/skill-rules.md` (new) — canonical board-behavior registry
- `integration/bmad/custom-templates/bmad-dev-story.toml` (new) — overlay template
- `integration/bmad/custom-templates/bmad-create-story.toml` (new) — overlay template
- `integration/bmad/custom-templates/bmad-qa-generate-e2e-tests.toml` (new) — overlay template
- `integration/bmad/custom-templates/bmad-code-review.toml` (new) — overlay template
- `integration/bmad/custom-templates/README.md` (new) — templates README (kit copy behavior + `{project-root}` resolution)
- `integration/bmad/README.md` (modified) — `## Contents` cross-links to `skill-rules.md` + `custom-templates/`
- `packages/mcp-server/src/skill-rules-registry-doc.test.ts` (new) — content guard (18 tests)

### Change Log

| Date | Change |
|---|---|
| 2026-05-31 | Story 8.3 implemented: board-behavior registry (`skill-rules.md`) + 4 per-skill overlay templates (`custom-templates/`) + templates README; cross-linked from `integration/bmad/README.md`; content-guard test (18 tests, 2 mutations verified). Discharged the 8.2 Rule-8 forward note (cadence-hook left byte-identical; consistency enforced by guard; registry disambiguated from this repo's own `_bmad/custom/skill-rules.md`). Gate green; suite 670 → 688. Status → review. |
