# Per-skill board-review overlay templates

These are the canonical `_bmad/custom/<skill>.toml` **overlay templates** the AgentBBS
installation kit ([`../install-agentbbs.md`](../install-agentbbs.md), Story 8.4) copies into
a consuming project so its standard BMad dev-cycle skills adopt the board-review cadence +
the Negotiation Protocol convention (AR24 · FR35 / FR36 · NFR5).

One template per standard BMad dev-cycle skill, mirroring the four live overlays in this
repo's own `_bmad/custom/`:

| Template | Overlays the skill |
|---|---|
| [`bmad-dev-story.toml`](bmad-dev-story.toml) | `bmad-dev-story` |
| [`bmad-create-story.toml`](bmad-create-story.toml) | `bmad-create-story` |
| [`bmad-qa-generate-e2e-tests.toml`](bmad-qa-generate-e2e-tests.toml) | `bmad-qa-generate-e2e-tests` |
| [`bmad-code-review.toml`](bmad-code-review.toml) | `bmad-code-review` |

## What the kit does with them

The installation kit copies, into the **consuming** project:

1. each template → `_bmad/custom/<skill>.toml` (the committed **team layer** the BMad
   resolver merges onto that skill's base `customize.toml`); and
2. the board-behavior registry ([`../skill-rules.md`](../skill-rules.md)) →
   `_bmad/custom/skill-rules.md`.

Each template is a `[workflow]` fragment with two keys:

- **`persistent_facts = ["file:{project-root}/_bmad/custom/skill-rules.md"]`** — loads the
  installed registry as a standing fact the agent carries for the whole run (the post-step
  board-review obligation + the Negotiation Protocol convention). This mirrors the live
  overlay precedent **exactly**.
- **`on_complete = "…"`** — a scalar terminal instruction that fires ONE final board review
  when the workflow reaches its last step.

## How the merge + the `{project-root}` ref resolve

`_bmad/scripts/resolve_customization.py` performs a three-layer structural merge (skill base
→ team `.toml` → personal `.user.toml`): `persistent_facts` arrays **append**, and the
`on_complete` scalar **override-wins**. So dropping a template at
`_bmad/custom/<skill>.toml` adds the registry fact and the final-review trigger **without
discarding** anything the skill's base `customize.toml` already declared.

The `{project-root}` in the `file:` reference is resolved **by the skill at runtime,
relative to the project that contains it** — i.e. the **consuming** project's root, which is
exactly where the kit installs `skill-rules.md`. (It does **not** point back at this
AgentBBS repo.)

> **Note — two files, same basename.** The registry these templates load,
> `_bmad/custom/skill-rules.md`, is the **board-behavior** registry shipped by AgentBBS — it
> is **not** this repo's own `_bmad/custom/skill-rules.md` (AgentBBS's internal dev-pipeline
> rules). See the disambiguation header in [`../skill-rules.md`](../skill-rules.md).

## These are templates, not active overlays

This `custom-templates/` directory is a source-of-truth **staging area**, deliberately kept
separate from this repo's live `_bmad/custom/`. Copying a template here does **not** change
AgentBBS's own skills; only the kit installing it into a consuming project's `_bmad/custom/`
activates it there.
