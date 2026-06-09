// Content-guard for the board-behavior skill-rules registry + the per-skill overlay templates
// (Story 8.3, AC #1 / AC #2).
//
// `integration/bmad/skill-rules.md` is the canonical BOARD-behavior registry — the standing facts
// a CONSUMING project's BMad skills load (via `persistent_facts`) so every relevant skill adopts
// the AgentBBS board UNPROMPTED: the post-step board-review obligation (FR35) + the four-move
// Negotiation Protocol convention (Propose → Counter → Ratify → Frozen). The per-skill overlay
// templates under `integration/bmad/custom-templates/*.toml` are REAL, resolvable BMad `[workflow]`
// fragments the install kit (Story 8.4) copies to a consuming project's `_bmad/custom/<skill>.toml`;
// each loads the installed registry via `persistent_facts = ["file:{project-root}/_bmad/custom/
// skill-rules.md"]` and sets `on_complete` to a final board review. Both the registry and the
// templates are consumed by TWO machines: the real `_bmad/scripts/resolve_customization.py` (which
// merges the template) and the AGENT that then carries the resolved facts — so a malformed
// `[workflow]` table, a missing key, or a tool name the registry invents is a real failure (a
// resolver mis-merge, or an agent instructed to call a tool that does not exist), not just a doc
// typo.
//
// Like the cadence-hook guard (`cadence-hook-doc.test.ts`), the negotiation-protocol guard
// (`negotiation-protocol-doc.test.ts`), and the agent-prompt-snippet guard
// (`agent-prompt-snippet-doc.test.ts`), this is a DOCUMENTATION/CONFIG content guard, NOT a code
// drift guard (that is `tool-contract.drift.test.ts`, which pins the live tool/error/event surface).
// There is no runtime "registry" object in the code to compare against — the registry is a recipe
// over the already-shipped `check`/`read_room`/`reply`/`react`/`read_contract` tools. So this test
// asserts the registry CONTAINS, by simple presence check, the load-bearing things AC #1 requires it
// to keep (the five-step review obligation, the four protocol moves, `read_contract`), that every
// backticked tool token it names is a REAL registered tool (Rule 10 — no phantom tools, pinned to
// the SAME canonical §6 list the cadence-hook guard uses, transitively bound to the live `McpServer`
// by `tool-contract.drift.test.ts`), that EACH overlay template is a well-formed `[workflow]`
// fragment that loads the registry + sets `on_complete`, AND — the Rule-8 reconciliation this story
// discharges — that the registry and the cadence hook name the SAME review tools (no drift between
// the two assets describing the same cadence). Presence checks (not exact-text matches) are
// deliberate: the prose may be reworded freely; only the load-bearing tokens are pinned, so the
// guard does not fight ordinary editing while still failing loudly if a review step, a protocol
// move, a tool reference, or a template key disappears.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The integration assets live at the repo root under `integration/bmad/`. This test file is at
// `packages/mcp-server/src/`, so three levels up from its directory is the repo root. Resolving
// relative to `import.meta.url` (not `process.cwd()`) keeps the test correct regardless of where the
// suite is launched from — same convention as `cadence-hook-doc.test.ts`.
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const BMAD_DIR = join(REPO_ROOT, 'integration', 'bmad');
const REGISTRY_PATH = join(BMAD_DIR, 'skill-rules.md');
const CADENCE_HOOK_PATH = join(BMAD_DIR, 'cadence-hook.toml');
const TEMPLATES_DIR = join(BMAD_DIR, 'custom-templates');

// The four standard BMad dev-cycle skills the templates overlay (mirror the live `_bmad/custom/`
// set). Each must ship a `<skill>.toml` template under `custom-templates/`.
const TEMPLATE_SKILLS = [
  'bmad-dev-story',
  'bmad-create-story',
  'bmad-qa-generate-e2e-tests',
  'bmad-code-review',
] as const;

// The ratified tool contract (doc §6 carries the machine-readable canonical tool-name list). The
// registry's facts reach a real agent (via the BMad resolver and the Story 8.4 install kit), so a
// tool name it invents would propagate into real agent behaviour. The `no-phantom-tools` case parses
// this list as the source of truth. It lives three levels up under `docs/`, same as the assets —
// same resolution convention as `cadence-hook-doc.test.ts` / `tool-contract.drift.test.ts`.
const CONTRACT_DOC_PATH = join(REPO_ROOT, 'docs', 'mcp-tool-contract.md');

// Sentinels delimiting the machine-readable canonical tool-name list in the contract doc (§6). Kept
// in lockstep with the markers in `docs/mcp-tool-contract.md` (and with `tool-contract.drift.test
// .ts`, which pins that same block to the live `McpServer` registration — so this list is
// transitively bound to the real registered surface without this doc-only test needing to boot a
// server). SAME sentinels the cadence-hook guard uses.
const TOOL_LIST_BEGIN = '# AGENTBBS-TOOL-CONTRACT:BEGIN';
const TOOL_LIST_END = '# AGENTBBS-TOOL-CONTRACT:END';

/**
 * Read the registry from disk. A separate helper so a missing/renamed file fails loudly with a clear
 * message rather than an opaque ENOENT mid-assertion.
 */
function readRegistry(): string {
  try {
    return readFileSync(REGISTRY_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the skill-rules registry at ${REGISTRY_PATH}. Story 8.3 requires ` +
        `integration/bmad/skill-rules.md to exist (it is the canonical board-behavior registry ` +
        `the per-skill overlays load via persistent_facts, AR24 / FR35–36).`,
      { cause },
    );
  }
}

/**
 * Read one overlay template from disk. Fails loudly if a required template is missing/renamed.
 */
function readTemplate(skill: string): string {
  const path = join(TEMPLATES_DIR, `${skill}.toml`);
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the overlay template at ${path}. Story 8.3 requires a ` +
        `custom-templates/${skill}.toml template (one per standard BMad dev-cycle skill).`,
      { cause },
    );
  }
}

/**
 * Parse the canonical registered-tool names from the contract doc's sentinel-delimited §6 block (one
 * bare tool name per line). This is the SAME block `tool-contract.drift.test.ts` asserts equals the
 * live `McpServer` tool set, so it is the authoritative answer to "is this a real tool?". Fails
 * loudly if the block is missing/renamed rather than silently yielding an empty set (which would make
 * the phantom-tool guard vacuously pass).
 */
function readCanonicalToolNames(): ReadonlySet<string> {
  const doc = readFileSync(CONTRACT_DOC_PATH, 'utf8');
  const begin = doc.indexOf(TOOL_LIST_BEGIN);
  const end = doc.indexOf(TOOL_LIST_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `Could not locate the canonical tool-name block (${TOOL_LIST_BEGIN} … ${TOOL_LIST_END}) in ` +
        `${CONTRACT_DOC_PATH}. The registry phantom-tool guard parses this block as the source of ` +
        `truth for which tools exist.`,
    );
  }
  return new Set(
    doc
      .slice(begin + TOOL_LIST_BEGIN.length, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

/**
 * The set of backticked `snake_case` identifiers a piece of text presents as a callable name. Reuse
 * the cadence-hook guard's CALL-form-aware pattern (a backtick, the snake token ≥ 3 chars, then
 * EITHER a closing backtick OR a `{`): the assets name their tools bare (`` `check` ``) today, but
 * matching the call form too means a phantom introduced only as `` `subscribe{ … }` `` would still
 * become a candidate rather than slip the scan.
 */
function backtickedTokens(text: string): string[] {
  return [...text.matchAll(/`([a-z][a-z_]{2,})(?:`|\{)/g)].map((m) => m[1]);
}

describe('integration/bmad/skill-rules.md registry content guard', () => {
  // The five shipped tools the board review drives through. (`read_contract` is the protocol's
  // Frozen move; the other four are the review steps — the same four the cadence hook names.)
  const REGISTRY_TOOLS = [
    'check',
    'read_room',
    'reply',
    'react',
    'read_contract',
  ] as const;

  // The tools the Story-12.3 cross-project integration play (Rule C, FR42) names ON TOP of the
  // review/protocol set above: discover (`list_projects`), read context (`list_members`), post the
  // need (`post_announcement`), and escalate (`add_participant`). (`read_room`/`reply`/`react`/
  // `read_contract` are already covered by REGISTRY_TOOLS.) Pinning these as REQUIRED, real tools
  // means a future edit that drops a play step's tool — or renames it to a phantom — turns the
  // presence/phantom checks RED.
  const PLAY_TOOLS = [
    'list_projects',
    'list_members',
    'join_board',
    'post_announcement',
    'add_participant',
  ] as const;

  // The four moves of the Negotiation Protocol convention (AC #1). Dropping any name means the
  // registry silently lost a move.
  const FOUR_MOVES = ['Propose', 'Counter', 'Ratify', 'Frozen'] as const;

  // (a) THE BOARD-REVIEW OBLIGATION (FR35) — the post-step PULL review the registry tells every
  // relevant skill to adopt. Each leg of the review must survive a reword: the `check` heartbeat, the
  // announcement scan, the `read_room` investigate, the `reply` respond (scoped to rooms you
  // participate in), and the `react` 👍 ratify. Dropping a leg would silently narrow the review the
  // agent adopts.
  it('states the post-step board-review obligation — check / scan announcements / read_room / reply / react', () => {
    const registry = readRegistry();

    // The `check` heartbeat — the bounded pull-only delta (Epic 6 / NFR5).
    expect(
      registry.includes('check'),
      'the registry must name the `check` tool — the heartbeat of the post-step review (AC #1)',
    ).toBe(true);

    // The review is a POST-STEP obligation (after each workflow step) — what makes it a cadence
    // rather than a one-off. Accept "step" in any casing.
    expect(
      /step/i.test(registry),
      'the registry must tie the review to workflow STEP boundaries (a review per step) — AC #1',
    ).toBe(true);

    // SCAN ANNOUNCEMENTS — read new needs in the agent's sub-board(s).
    expect(
      /announcement/i.test(registry),
      'the review must include SCANNING new announcements in the agent’s sub-board(s) (AC #1)',
    ).toBe(true);

    // INVESTIGATE — read_room rooms of interest.
    expect(
      registry.includes('read_room'),
      'the review must `read_room` rooms of interest to INVESTIGATE new activity (AC #1)',
    ).toBe(true);

    // RESPOND — reply to new messages in rooms you PARTICIPATE in (pin the participation scope so a
    // reword cannot broaden it into "reply everywhere").
    expect(
      registry.includes('reply'),
      'the review must `reply` to new messages in rooms the agent participates in (AC #1)',
    ).toBe(true);
    expect(
      /participate/i.test(registry),
      'the `reply` step must be scoped to rooms the agent PARTICIPATES in (AC #1)',
    ).toBe(true);

    // RATIFY — react 👍 to ratify agreements (pin "ratif" so the step stays bound to its meaning, not
    // just the bare tool name).
    expect(
      registry.includes('react'),
      'the review must `react` 👍 to RATIFY agreements the agent accepts (AC #1)',
    ).toBe(true);
    expect(
      /ratif/i.test(registry),
      'the `react` step must be framed as RATIFYING agreements (the 👍 contract) — AC #1',
    ).toBe(true);
  });

  // (b) THE PULL-ONLY / NO-PUSH INVARIANT — the load-bearing delivery semantic the whole board rests
  // on (NFR5 / FR35). The agent INITIATES every review; the board NEVER pushes. Both ideas must
  // survive a reword — a "pull" framing AND an explicit "the board never pushes" statement.
  it('states the PULL-ONLY / no-push invariant (the agent initiates; the board never pushes)', () => {
    const registry = readRegistry();
    expect(
      /pull[\s-]?only|pull review|pure pull|purely a pull/i.test(registry),
      'the registry must frame the review as PULL-ONLY (the agent dials in; the board never ' +
        'pushes) — NFR5 / AC #1',
    ).toBe(true);
    expect(
      /never\s+pushes|no\s+push|introduces?\s+no\s+push|without\s+(a\s+)?push/i.test(
        registry,
      ),
      'the registry must state EXPLICITLY that the board introduces NO push — the board never ' +
        'pushes to an agent (NFR5) — AC #1',
    ).toBe(true);
  });

  // (c) THE NEGOTIATION PROTOCOL CONVENTION (AC #1) — the four moves, each named, plus the
  // `read_contract` tool the Frozen move maps to. Same four-move set the negotiation-protocol doc
  // pins; dropping a move here means the registry silently lost it.
  it('names all four Negotiation Protocol moves (Propose, Counter, Ratify, Frozen)', () => {
    const registry = readRegistry();
    for (const move of FOUR_MOVES) {
      expect(
        registry.includes(move),
        `the registry must name the "${move}" Negotiation Protocol move — a future edit must not ` +
          `silently drop a move (AC #1)`,
      ).toBe(true);
    }
  });

  it('names `read_contract` — the Frozen move (the highest-`seq` live-👍’d message, FR21)', () => {
    const registry = readRegistry();
    expect(
      registry.includes('read_contract'),
      'the registry must name `read_contract` — the Frozen move that computes the current agreed ' +
        'contract (AC #1)',
    ).toBe(true);
  });

  // (c2) THE CROSS-PROJECT INTEGRATION PLAY (Story 12.3, FR42) — Rule C: how an agent reaches
  // ANOTHER project's agent to negotiate a shared boundary, composing the shipped surface. Pin the
  // rule header is present AND each of the play's distinctive tools (discover → read context → post
  // the need → escalate) is named, so a future edit cannot silently drop the play or one of its
  // steps. The four moves it delegates to (Rule B) are covered by the FOUR_MOVES / read_contract
  // checks above; here we pin the play-specific verbs.
  it('states the cross-project integration play (Rule C) — list_projects → list_members/read_room → post_announcement/reply → four moves → add_participant', () => {
    const registry = readRegistry();

    // The rule must be present as a named rule (Rule C), tied to reaching ANOTHER project.
    expect(
      /Rule C/.test(registry),
      'the registry must carry the "Rule C" cross-project integration play (Story 12.3, FR42)',
    ).toBe(true);
    expect(
      /another project|other project|peer project/i.test(registry),
      'the Rule C play must frame itself as reaching ANOTHER project’s agent to negotiate a shared ' +
        'boundary (FR42)',
    ).toBe(true);

    // Each distinctive play tool must be named (the review/protocol tools are pinned elsewhere).
    for (const tool of PLAY_TOOLS) {
      expect(
        registry.includes(tool),
        `the Rule C play must name the \`${tool}\` tool — a future edit must not silently drop a ` +
          `play step (Story 12.3 AC1)`,
      ).toBe(true);
    }
  });

  // (d) THE DISAMBIGUATION HEADER (Rule 8) — the registry MUST state it is a DIFFERENT file from this
  // repo's own `_bmad/custom/skill-rules.md` (same basename, unrelated rules). Without this, a reader
  // (or a future dev) could conflate the board-behavior registry with AgentBBS's internal
  // dev-pipeline rules. Pin that the header references the OTHER file's path.
  it('disambiguates itself from this repo’s OWN _bmad/custom/skill-rules.md (different file, same basename)', () => {
    const registry = readRegistry();
    expect(
      registry.includes('_bmad/custom/skill-rules.md'),
      'the registry must reference `_bmad/custom/skill-rules.md` to DISAMBIGUATE itself from this ' +
        'repo’s own dev-pipeline rules file of the same basename (Rule 8) — AC #1',
    ).toBe(true);
  });

  // (e) DOCUMENTATION/CONFIG ONLY — the board enforces NONE of it (mirrors the sibling guards). Both
  // ideas must be present: an explicit "documentation/config only" framing AND an "enforce(s) none /
  // not enforced" statement.
  it('states EXPLICITLY that it is documentation/config only — the board enforces none of it', () => {
    const registry = readRegistry().toLowerCase();
    expect(
      registry.includes('documentation') &&
        (registry.includes('only') || registry.includes('config only')),
      'the registry must state it is DOCUMENTATION / CONFIG ONLY (an agent adopts it; not enforced ' +
        'code)',
    ).toBe(true);
    expect(
      /enforces?\s+none|not\s+enforced|enforces?\s+nothing|no\s+enforcement/.test(
        registry,
      ),
      'the registry must state EXPLICITLY that the board does NOT enforce any of it (e.g. ' +
        '"enforces none of it", "not enforced", "no enforcement")',
    ).toBe(true);
  });

  it('names all five registry tools (check, read_room, reply, react, read_contract)', () => {
    const registry = readRegistry();
    for (const tool of REGISTRY_TOOLS) {
      expect(
        registry.includes(tool),
        `the registry must name the \`${tool}\` tool — the board review / protocol drives through ` +
          `it (AC #1)`,
      ).toBe(true);
    }
  });

  // NO PHANTOM TOOLS (Rule 10) — every tool the registry tells an agent to CALL must be a real,
  // registered tool. The presence checks above are necessary but not sufficient: they pin that the
  // REQUIRED tools are NAMED, but a future edit could ADD a sentence inventing a tool that does not
  // exist (e.g. `subscribe` to get pushed updates — doubly wrong, since the board is pull-only) and
  // every assertion above would still pass. Because the BMad resolver feeds this registry's facts to
  // a real agent (and the Story 8.4 install kit copies it in), a phantom tool here becomes a real
  // instruction an agent tries to call — a runtime failure. This scans the backticked `snake_case`
  // tokens across the whole registry and asserts each is either a real tool (from the contract's
  // canonical §6 list) or one of a small, explicit allowlist of known NON-tool tokens.
  it('names no phantom tools — every backticked tool token in the registry is a real registered tool', () => {
    const registry = readRegistry();
    const realTools = readCanonicalToolNames();

    // Sanity: the source of truth is non-empty (a bad parse would make this guard vacuous).
    expect(
      realTools.size,
      'expected the contract §6 canonical tool list to parse to a non-empty set',
    ).toBeGreaterThan(0);

    // Tokens the registry backticks that are NOT tool calls: the two `[workflow]` SCHEMA KEYS it
    // documents when explaining how the overlays load it (`persistent_facts`, `on_complete`), and
    // `seq` — the message SEQUENCE NUMBER (the wire field `message_seq`) the registry names when
    // stating the FR21 Frozen semantic ("the highest-`seq` message currently holding a live 👍").
    // `seq` is a field, not a tool — the same way the negotiation-protocol / agent-prompt-snippet
    // docs backtick it. Anything else backticked is treated as a tool claim. Keep this list minimal
    // and explicit — growing it should be a deliberate act (mirrors the cadence-hook guard's
    // NON_TOOL_TOKENS).
    // `project_id` (Story 12.3 Rule C) is a `list_members`/`join_board`/`post_announcement`
    // PARAMETER the play backticks (`list_members{ project_id }`, `post_announcement{ project_id }`),
    // not a tool — same status as `seq`. (The `@operator` in `add_participant{ @operator }` is not a
    // backticked snake token, so it is not a candidate.) Keep this list minimal and explicit.
    const NON_TOOL_TOKENS = new Set([
      'persistent_facts',
      'on_complete',
      'seq',
      'project_id',
    ]);

    const candidates = backtickedTokens(registry);
    const phantom = candidates.filter(
      (tok) => !realTools.has(tok) && !NON_TOOL_TOKENS.has(tok),
    );
    expect(
      phantom,
      `the registry references tool-looking token(s) that are NOT registered tools and are not ` +
        `allowlisted non-tool tokens: ${JSON.stringify([...new Set(phantom)])}. A registry whose ` +
        `facts reach a real agent (via the BMad resolver and the install kit) must not instruct it ` +
        `to call a tool that does not exist (AC #1, Rule 10). If a token is a real new tool, it ` +
        `will be in docs/mcp-tool-contract.md §6; if it is a non-tool identifier, add it to ` +
        `NON_TOOL_TOKENS.`,
    ).toEqual([]);

    // Converse sanity: all five registry tools AND the four Rule-C play tools must actually appear
    // as backticked tokens (so a future reword that strips ALL backticks — making the phantom scan
    // vacuously pass on an empty candidate set — is caught here too).
    for (const tool of [...REGISTRY_TOOLS, ...PLAY_TOOLS]) {
      expect(
        candidates.includes(tool),
        `the registry must backtick the \`${tool}\` tool name (AC #1) — its absence would also ` +
          `make the phantom-tool scan vacuous`,
      ).toBe(true);
    }
  });
});

describe('integration/bmad/custom-templates/*.toml overlay templates content guard', () => {
  // Each standard-skill template must exist and be a well-formed `[workflow]` fragment that (1)
  // declares the `[workflow]` table, (2) loads the installed registry via a `persistent_facts`
  // `file:` ref to `skill-rules.md`, and (3) sets `on_complete` to the post-step final review. The
  // resolver merges this fragment onto the skill base; if the table header or either key is
  // renamed/dropped, the resolver silently merges nothing useful and the cadence/registry never
  // reaches the agent — so pin all three by presence. (The authoritative "is it valid TOML" proof is
  // the `tomllib`/resolver lead smoke; this guard pins the load-bearing CONTENT claims, the same way
  // the cadence-hook guard pins the hook's `[workflow]`/keys via regex.)
  it.each(TEMPLATE_SKILLS)(
    'custom-templates/%s.toml is a [workflow] fragment that loads skill-rules.md + sets on_complete',
    (skill) => {
      const template = readTemplate(skill);

      expect(
        /^\s*\[workflow\]\s*$/m.test(template),
        `${skill}.toml must declare the \`[workflow]\` table header — it is the team-layer fragment ` +
          `the BMad resolver merges onto the skill’s base customize.toml (AC #1)`,
      ).toBe(true);

      // `persistent_facts` must be set AND carry the `file:` ref to the installed registry — that is
      // the whole point of the template (load the board-behavior registry as a standing fact). Pin
      // both the key assignment and the specific `file:.../skill-rules.md` ref.
      expect(
        /^\s*persistent_facts\s*=/m.test(template),
        `${skill}.toml must set \`persistent_facts\` — the standing fact that loads the registry ` +
          `(AC #1)`,
      ).toBe(true);
      expect(
        /file:\{project-root\}\/_bmad\/custom\/skill-rules\.md/.test(template),
        `${skill}.toml must load the installed registry via ` +
          `\`file:{project-root}/_bmad/custom/skill-rules.md\` in persistent_facts — the ` +
          `{project-root} resolves in the CONSUMING project where the kit installs the registry ` +
          `(AC #1)`,
      ).toBe(true);

      // `on_complete` must be set — the post-step review's end-of-workflow final review (AC #1's
      // "and/or on_complete").
      expect(
        /^\s*on_complete\s*=/m.test(template),
        `${skill}.toml must set \`on_complete\` — the one final board review fired at the ` +
          `workflow’s last step (AC #1)`,
      ).toBe(true);
    },
  );

  // The `on_complete` final-review instruction in each template names tools the agent CALLS — so it
  // is subject to the same no-phantom-tools discipline (Rule 10). Scan its backticked tokens and
  // assert each is a real tool (the templates' `on_complete` describes the same pull-only review the
  // registry does: `check` / `read_room` / `reply` / `react`).
  it.each(TEMPLATE_SKILLS)(
    'custom-templates/%s.toml names no phantom tools in its on_complete review',
    (skill) => {
      const template = readTemplate(skill);
      const realTools = readCanonicalToolNames();
      const NON_TOOL_TOKENS = new Set(['persistent_facts', 'on_complete']);
      const candidates = backtickedTokens(template);
      const phantom = candidates.filter(
        (tok) => !realTools.has(tok) && !NON_TOOL_TOKENS.has(tok),
      );
      expect(
        phantom,
        `${skill}.toml references tool-looking token(s) that are NOT registered tools: ` +
          `${JSON.stringify([...new Set(phantom)])}. The template's on_complete reaches a real ` +
          `agent via the resolver — it must not name a tool that does not exist (AC #1, Rule 10).`,
      ).toEqual([]);
    },
  );
});

describe('skill-rules.md ↔ cadence-hook.toml consistency (Rule 8 — no drift)', () => {
  // The Rule-8 reconciliation this story discharges: `cadence-hook.toml` (Story 8.2) stays the
  // standalone focused hook; `skill-rules.md` is the fuller registry. Both describe the SAME
  // post-step board review, so they MUST name the SAME review tools — a drift (one asset adds/drops a
  // review tool the other does not) would mean an agent gets two inconsistent descriptions of the
  // cadence depending on which asset it loaded. This pins that the four review tools appear in BOTH
  // assets (and, conversely, that the cadence hook does not name a review tool the registry omits).
  const REVIEW_TOOLS = ['check', 'read_room', 'reply', 'react'] as const;

  it('the registry and the cadence hook name the same review tools (no drift)', () => {
    const registry = readRegistry();
    const hook = readFileSync(CADENCE_HOOK_PATH, 'utf8');

    for (const tool of REVIEW_TOOLS) {
      expect(
        registry.includes(tool),
        `the registry must name the \`${tool}\` review tool — it must stay consistent with the ` +
          `cadence hook (Rule 8, no drift)`,
      ).toBe(true);
      expect(
        hook.includes(tool),
        `the cadence hook must name the \`${tool}\` review tool — it must stay consistent with the ` +
          `registry (Rule 8, no drift)`,
      ).toBe(true);
    }

    // Converse: the set of review tools the cadence hook backticks must be a SUBSET of the tools the
    // registry backticks — so the hook cannot quietly introduce a review tool the registry does not
    // also carry (that would be exactly the drift Rule 8 forbids). (The registry is the fuller
    // asset, so it legitimately names MORE — e.g. `read_contract` for the protocol — but every
    // review tool the hook names must be in the registry too.)
    const registryTokens = new Set(backtickedTokens(registry));
    const hookReviewTokens = backtickedTokens(hook).filter((t) =>
      (REVIEW_TOOLS as readonly string[]).includes(t),
    );
    for (const tok of hookReviewTokens) {
      expect(
        registryTokens.has(tok),
        `the cadence hook backticks the \`${tok}\` review tool, but the registry does not — the ` +
          `two assets describing the same cadence have DRIFTED (Rule 8)`,
      ).toBe(true);
    }
  });

  // The registry must explicitly STATE its relationship to the cadence hook (the Rule-8 resolution in
  // writing, not a silent coexistence): it references `cadence-hook.toml` by name and frames itself
  // as the fuller registry the hook pairs with. This is the "reconcile explicitly, in writing" half
  // of Rule 8.
  it('the registry states its relationship to the cadence hook in writing (Rule 8 reconciliation)', () => {
    const registry = readRegistry();
    expect(
      /cadence-hook\.toml/.test(registry),
      'the registry must reference `cadence-hook.toml` by name and state how the two relate (the ' +
        'registry is the rules; the cadence-hook is the focused wiring) — the Rule-8 reconciliation ' +
        'in writing (AC #1)',
    ).toBe(true);
  });
});
