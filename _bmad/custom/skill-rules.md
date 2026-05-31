# BMAD Skill Rules

Loaded as `persistent_facts` by every BMAD skill on activation. Project-specific rules can be appended below Rule 7.

## Rule 1 — Integration ACs (`bmad-create-story`)

Every story that introduces a service, module, or shared component MUST include at least one Integration AC of the form:

> *Consumer `X` reads from this service/module and produces observable effect `Y`.*

The integration AC must be testable by the consumer's automation tier (unit, integration, E2E, browser-MCP, API smoke), not by inspecting the introducing module's internal state.

A story that introduces a service without naming any consumers must explicitly say so in an "Integration ACs" section ("No consumers in this story; the first consumer will be Story X.Y."). Silence is not acceptable.

## Rule 2 — Consumed-by linkage (`bmad-create-story`)

Every service-introducing story includes a `## Consumed-by` section listing downstream consumer stories by ID and purpose.

Every consumer story lists the service in its `## Consumes` section, and its Integration ACs exercise the consumer against a real instance — not a mock.

## Rule 3 — Real-runtime test evidence (`bmad-code-review`)

A code review MUST NOT approve a story whose code touches a user-facing surface unless the QA-generated test suite includes at least one test that exercises the deliverable against its real target runtime:

- UI / browser-deployed — browser-MCP or Playwright test asserting on observable DOM / render state.
- CLI / library — actual invocation with stdout / stderr / exit-code / produced-file assertions.
- Service / API — a real HTTP request with status code + response body + side-effect assertions.

This is distinct from the lead's manual per-story smoke, which runs *after* code review as a separate workflow gate. Rule 3 governs the *test artifacts* code review can inspect; the manual smoke is a later, independent check.

Pure non-user-facing stories (build pipeline, internal tooling, refactor) are exempt; note the exemption in the review. Missing real-runtime test evidence on a user-facing story is a HIGH finding.

## Rule 4 — Closing summary in the final message (all skills, under `/epic-cycle`)

When invoked under `/epic-cycle`, the skill MUST end its final assistant message with these sections in order:

```markdown
## Files Modified
- <full path from repo root>
(or "(none)")

## Tests Added
- <full path from repo root>
(or "(none)")

## Decisions
- <one-line summary>
(or "(none)")

## Issues Encountered
- <one-line summary>
(or "(none)")
```

The closing summary is part of the agent's normal output. If the agent forgets the sections, the lead reconstructs the file list from `git status --short` — normal extraction.

If the skill cannot make confident progress for ANY reason — ambiguous ACs, missing prerequisite, a user-preference choice, an environment failure, or anything risking a stated constraint — halt BEFORE the closing summary and end with a `## Clarification Needed` section instead. State the question, what was tried, and what's blocking, in one paragraph.

Outside `/epic-cycle`, this rule does not apply — emit a normal completion summary.

## Rule 5 — NFR tripwire response (`bmad-dev-story`, `bmad-code-review`)

If an NFR is found to be unmeasurable, mathematically impossible, internally contradictory, or otherwise un-implementable as worded:

1. Halt the story implementation at the affected task.
2. Amend the relevant planning artifact (`prd.md`, `architecture.md`, or `epics.md`) in place.
3. Document original-vs-amended wording with rationale in the story's Dev Agent Record.
4. Continue against the amended NFR.

Do NOT work around with code comments + `deferred-work.md`.

## Rule 6 — ADR violations are HIGH severity (`bmad-dev-story`, `bmad-code-review`)

An AC implementation that violates an Accepted ADR (Architecture Decision Record — a short, numbered document under `docs/adr/` capturing a single committed architectural or technical decision and its rationale) — wrong tool stack, wrong architectural pattern, contradicts a committed methodology — is a HIGH-severity finding, not a LOW deferrable.

`bmad-dev-story` must consult the ADR registry (typically `docs/adr/`) for any architectural or methodology decisions referenced in the story's ACs / Dev Notes, and match implementation to ADR commitments.

`bmad-code-review` must:

1. Cross-check each AC against the project's ADR registry.
2. Verify that ADR-constrained implementations match the ADR's commitment.
3. File mismatches as HIGH. Auto-resolve inline where reasonable; otherwise pause for the lead.

## Rule 7 — Sub-agent tool inventory is harness-inherited (all skills)

Sub-agents spawned by `/epic-cycle` inherit whatever MCP namespaces and tools are mounted on the harness running the lead. There is no project-local mechanism to add a tool just for sub-agents.

**Implication:** ADR-tooled AC verifications (browser-MCP smokes, performance traces, audits) are placed on the **lead**, not on sub-agents. Sub-agent MCP propagation is best-effort defense-in-depth, not the primary gate.

## Rule 8 — Test discoverability (`bmad-qa-generate-e2e-tests`)

Generated tests MUST be discoverable by the project's default test suite — (a) correct naming convention, (b) not excluded by ignore files, (c) not tagged in a way that opts them out of the default run.

A test that exists but does not run in the default suite is invisible to CI and to the next story's regression check. Undiscoverable tests are a HIGH finding on subsequent code review.

## Project-specific rules (add below as retros surface them)

> Add additional rules here as retrospectives identify durable patterns. Number sequentially after Rule 8. Each rule should state what it applies to, the obligation, and (briefly) why.
