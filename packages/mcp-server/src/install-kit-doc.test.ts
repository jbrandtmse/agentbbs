// Content-guard for the single self-contained installation kit
// (`integration/bmad/install-agentbbs.md`, Story 8.4, AC #1 / AC #2 / AC #3).
//
// `integration/bmad/install-agentbbs.md` is the operator ENTRYPOINT (AR27 / FR40): ONE
// self-contained, agent-executed Markdown kit an operator copies into a target BMad project
// and runs once. It is the FIRST and ONLY asset that INLINES all of the prior integration
// assets (Stories 7.3 / 8.1 / 8.2 / 8.3) so the operator ships a single file — no sibling
// files fetched. Because the kit's inlined copies are hand-maintained duplicates of the
// canonical sources, they can DRIFT the moment a source changes; and because the kit is the
// highest-stakes agent-CONSUMED asset (it WRITES files in a stranger's project), a phantom
// tool or a dropped safety statement becomes a real failure an agent hits. So this guard pins
// the kit to its canonical sources and to the live tool surface.
//
// Like the sibling doc-guards (`skill-rules-registry-doc.test.ts`, `cadence-hook-doc.test.ts`,
// `agent-prompt-snippet-doc.test.ts`, `identity-bootstrap-doc.test.ts`), this is a
// DOCUMENTATION/CONFIG content guard, NOT a code drift guard (that is
// `tool-contract.drift.test.ts`, which pins the live tool/error/event surface). There is no
// runtime "kit" object in the code to compare against — the kit is a recipe over the
// already-shipped tools. The COMPLEMENTARY real-runtime proof — that the kit's OWN file-surgery
// helper is idempotent / backup-safe / foreign-safe — is the executable safety-property test
// `packages/mcp-server/src/tools/install-kit-safety.integration.test.ts` (Rule 3 / Epic 7 retro
// Action A). Together they are "says-the-right-words" (here) vs. "the-words-actually-work"
// (there).
//
// This guard asserts, per the story's Task 3:
//   (a) DRIFT PINS — the kit INLINES each canonical artifact and the inlined text MATCHES the
//       source read AT TEST TIME (the skill-rules body, the agent-prompt-snippet sentinel
//       block, each of the four custom-templates TOMLs, the cadence-hook body, and the
//       identity-bootstrap sentinel block + the AGENTBBS-IDENTITY record block). So the kit
//       cannot silently drift from the assets it duplicates.
//   (b) SELF-CONTAINED — the kit carries the content INLINE; it issues NO network/sibling-file
//       FETCH for content (no `curl`/`wget`/`fetch(http…)` and no instruction to read a sibling
//       asset for its content). (Relative markdown LINK refs inside the inlined bodies — e.g.
//       `../../docs/...` — are content the kit copied verbatim, not fetch instructions, so they
//       are not forbidden.)
//   (c) NO PHANTOM TOOLS (Rule 10) — every backticked tool token the kit names is a REAL
//       registered tool, pinned to the SAME canonical §6 list the sibling guards use
//       (transitively bound to the live `McpServer` by `tool-contract.drift.test.ts`),
//       call-form-aware so a phantom introduced only as `tool{ … }` is still caught.
//   (d) SAFETY PROPERTIES + PREREQUISITE STATED — the kit STATES the three safety properties
//       (idempotent sentinel blocks, timestamped backup-before-overwrite, never-touch-foreign
//       incl. the `epic-cycle` kit) AND the AC #3 MCP-server prerequisite check (verify the
//       server first; if absent, REPORT and STOP — do not install the server).
//
// Where practical, the drift pins compare the canonical source's machine-relevant inner content
// (a sentinel block, or the source file's body) so ordinary rewording of the kit's surrounding
// prose does not fight the guard — only an actual drift from a pinned source, a phantom tool, or
// a dropped safety/prerequisite statement turns it RED.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The integration assets live at the repo root under `integration/bmad/`. This test file is at
// `packages/mcp-server/src/`, so three levels up from its directory is the repo root. Resolving
// relative to `import.meta.url` (not `process.cwd()`) keeps the test correct regardless of where
// the suite is launched from — same convention as `skill-rules-registry-doc.test.ts`.
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const BMAD_DIR = join(REPO_ROOT, 'integration', 'bmad');
const KIT_PATH = join(BMAD_DIR, 'install-agentbbs.md');
const REGISTRY_PATH = join(BMAD_DIR, 'skill-rules.md');
const CADENCE_HOOK_PATH = join(BMAD_DIR, 'cadence-hook.toml');
const SNIPPET_PATH = join(BMAD_DIR, 'agent-prompt-snippet.md');
const IDENTITY_BOOTSTRAP_PATH = join(BMAD_DIR, 'identity-bootstrap.md');
const TEMPLATES_DIR = join(BMAD_DIR, 'custom-templates');

// The four standard BMad dev-cycle skill overlay templates the kit inlines (mirror the live
// `_bmad/custom/` set + the Story 8.3 `custom-templates/`).
const TEMPLATE_SKILLS = [
  'bmad-dev-story',
  'bmad-create-story',
  'bmad-qa-generate-e2e-tests',
  'bmad-code-review',
] as const;

// The canonical registered-tool list lives in the contract doc's sentinel-delimited §6 block
// (one bare tool name per line). `tool-contract.drift.test.ts` asserts this SAME block equals the
// live `McpServer` tool set, so it is the authoritative answer to "is this a real tool?".
const CONTRACT_DOC_PATH = join(REPO_ROOT, 'docs', 'mcp-tool-contract.md');
const TOOL_LIST_BEGIN = '# AGENTBBS-TOOL-CONTRACT:BEGIN';
const TOOL_LIST_END = '# AGENTBBS-TOOL-CONTRACT:END';

/** Read the kit from disk. A separate helper so a missing/renamed file fails loudly. */
function readKit(): string {
  try {
    return readFileSync(KIT_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the installation kit at ${KIT_PATH}. Story 8.4 requires ` +
        `integration/bmad/install-agentbbs.md to exist (the single self-contained kit, AR27 / ` +
        `FR40).`,
      { cause },
    );
  }
}

/** Read a canonical source asset from disk, failing loudly if missing/renamed. */
function readSource(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the canonical source ${label} at ${path}. The install kit inlines it; the ` +
        `drift pin needs the source to compare against.`,
      { cause },
    );
  }
}

/**
 * Extract the inclusive text between a BEGIN/END sentinel pair (markers included), or throw if the
 * pair is absent — so a renamed/removed sentinel fails loudly rather than yielding undefined.
 */
function sentinelBlock(
  text: string,
  begin: string,
  end: string,
  where: string,
): string {
  const b = text.indexOf(begin);
  const e = text.indexOf(end);
  if (b === -1 || e === -1 || e < b) {
    throw new Error(
      `Could not locate the sentinel block ${begin} … ${end} in ${where}. It is the ` +
        `machine-relevant block the kit inlines / pins.`,
    );
  }
  return text.slice(b, e + end.length);
}

/**
 * Parse the canonical registered-tool names from the contract doc's sentinel-delimited §6 block
 * (one bare tool name per line). SAME source of truth the sibling guards use. Fails loudly if the
 * block is missing rather than vacuously yielding an empty set.
 */
function readCanonicalToolNames(): ReadonlySet<string> {
  const doc = readFileSync(CONTRACT_DOC_PATH, 'utf8');
  const begin = doc.indexOf(TOOL_LIST_BEGIN);
  const end = doc.indexOf(TOOL_LIST_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `Could not locate the canonical tool-name block (${TOOL_LIST_BEGIN} … ${TOOL_LIST_END}) in ` +
        `${CONTRACT_DOC_PATH}. The kit phantom-tool guard parses this block as the source of truth.`,
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
 * Backticked `snake_case` identifiers a piece of text presents as a callable name. SAME call-form
 * aware pattern the sibling guards use (a backtick, the snake token ≥ 3 chars, then EITHER a
 * closing backtick OR a `{`): the kit names tools bare (`` `check` ``) and in call form
 * (`` `login{ handle } ``), so matching both means a phantom introduced either way is caught.
 */
function backtickedTokens(text: string): string[] {
  return [...text.matchAll(/`([a-z][a-z_]{2,})(?:`|\{)/g)].map((m) => m[1]);
}

describe('integration/bmad/install-agentbbs.md kit content guard', () => {
  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (a) DRIFT PINS — the kit inlines each canonical artifact, MATCHING the source read at test
  // time. Each pin compares the source's machine-relevant content (a sentinel block, or the
  // source body) so the kit cannot silently drift from the asset it duplicates.
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it('inlines the agent-prompt-snippet sentinel block VERBATIM (drift pin → agent-prompt-snippet.md)', () => {
    const kit = readKit();
    const snippetSource = readSource(SNIPPET_PATH, 'agent-prompt-snippet.md');
    const snippetBlock = sentinelBlock(
      snippetSource,
      '<!-- AGENTBBS-PROMPT-SNIPPET:BEGIN -->',
      '<!-- AGENTBBS-PROMPT-SNIPPET:END -->',
      'agent-prompt-snippet.md',
    );
    expect(
      kit.includes(snippetBlock),
      'the kit must inline the agent-prompt-snippet sentinel block VERBATIM (Story 7.3). If the ' +
        'snippet changed, re-copy it into install-agentbbs.md so the kit does not drift (AC #1).',
    ).toBe(true);
  });

  it('inlines the identity-bootstrap sentinel block VERBATIM (drift pin → identity-bootstrap.md)', () => {
    const kit = readKit();
    const bootstrapSource = readSource(
      IDENTITY_BOOTSTRAP_PATH,
      'identity-bootstrap.md',
    );
    const bootstrapBlock = sentinelBlock(
      bootstrapSource,
      '<!-- AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN -->',
      '<!-- AGENTBBS-IDENTITY-BOOTSTRAP:END -->',
      'identity-bootstrap.md',
    );
    expect(
      kit.includes(bootstrapBlock),
      'the kit must inline the identity-bootstrap sentinel block VERBATIM (Story 8.1) and RUN it ' +
        'so the project ends with a stored handle. If the bootstrap changed, re-copy it (AC #1).',
    ).toBe(true);
  });

  it('inlines the AGENTBBS-IDENTITY record block the kit writes into AGENTS.md', () => {
    const kit = readKit();
    // The kit owns the `AGENTBBS-IDENTITY` block in the consuming project's AGENTS.md. It must
    // show both sentinels so the agent knows the exact markers to pass to applyBlock.
    expect(
      kit.includes('<!-- AGENTBBS-IDENTITY:BEGIN -->') &&
        kit.includes('<!-- AGENTBBS-IDENTITY:END -->'),
      'the kit must show the AGENTBBS-IDENTITY sentinel markers — the block it records the handle ' +
        'into (AC #1).',
    ).toBe(true);
    // And the recorded line is the plain handle only (claim-based auth, no secret).
    expect(
      /agentbbs_handle:/.test(kit),
      'the kit must record the plain `agentbbs_handle:` line in the AGENTBBS-IDENTITY block — only ' +
        'the handle, no secret (AC #1).',
    ).toBe(true);
  });

  it('inlines the skill-rules registry BODY (drift pin → skill-rules.md)', () => {
    const kit = readKit();
    const registry = readSource(REGISTRY_PATH, 'skill-rules.md');
    // The registry has no internal sentinel; the kit inlines the whole file body inside a fenced
    // block. Pin a substantial, load-bearing slice of the source (the two Rule headers through the
    // four protocol moves) so a drift in the registry's machine-relevant content turns this RED.
    // Using the source's own text (read at test time) means a reworded registry must be re-copied.
    const ruleA = registry.indexOf(
      '## Rule A — The post-step board-review obligation',
    );
    const ruleBEnd = registry.indexOf('## How this registry relates');
    expect(
      ruleA !== -1 && ruleBEnd !== -1 && ruleBEnd > ruleA,
      'expected to locate Rule A … "How this registry relates" in the canonical skill-rules.md ' +
        '(the slice the drift pin compares).',
    ).toBe(true);
    const registrySlice = registry.slice(ruleA, ruleBEnd).trimEnd();
    expect(
      kit.includes(registrySlice),
      'the kit must inline the skill-rules registry body VERBATIM (Story 8.3). If the registry ' +
        'changed, re-copy it into install-agentbbs.md so the kit does not drift (AC #1).',
    ).toBe(true);
  });

  it('inlines the cadence-hook BODY (drift pin → cadence-hook.toml)', () => {
    const kit = readKit();
    const hook = readSource(CADENCE_HOOK_PATH, 'cadence-hook.toml');
    // Pin the hook's machine-relevant core: the `[workflow]` table with the per-step
    // `persistent_facts` literal fact through the `on_complete` scalar. Comparing the source's own
    // text (read at test time) means a reworded hook must be re-copied into the kit.
    const wf = hook.indexOf('[workflow]');
    expect(
      wf !== -1,
      'expected `[workflow]` in the canonical cadence-hook.toml',
    ).toBe(true);
    const hookCore = hook.slice(wf).trimEnd();
    expect(
      kit.includes(hookCore),
      'the kit must inline the cadence-hook `[workflow]` body VERBATIM (Story 8.2). If the hook ' +
        'changed, re-copy it into install-agentbbs.md so the kit does not drift (AC #1).',
    ).toBe(true);
  });

  it.each(TEMPLATE_SKILLS)(
    'inlines the %s.toml overlay template VERBATIM (drift pin → custom-templates/%s.toml)',
    (skill) => {
      const kit = readKit();
      const template = readSource(
        join(TEMPLATES_DIR, `${skill}.toml`),
        `custom-templates/${skill}.toml`,
      );
      // Pin the template's `[workflow]` body (the resolvable fragment) — the part the resolver
      // merges and the part that must not drift. Comparing the source text read at test time means
      // a changed template must be re-copied into the kit.
      const wf = template.indexOf('[workflow]');
      expect(
        wf !== -1,
        `expected \`[workflow]\` in the canonical custom-templates/${skill}.toml`,
      ).toBe(true);
      const body = template.slice(wf).trimEnd();
      expect(
        kit.includes(body),
        `the kit must inline custom-templates/${skill}.toml's [workflow] body VERBATIM (Story ` +
          `8.3). If the template changed, re-copy it into install-agentbbs.md (AC #1).`,
      ).toBe(true);
    },
  );

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (b) SELF-CONTAINED — the kit carries the content inline; it issues NO fetch for content.
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it('is SELF-CONTAINED — no network fetch / sibling-file read for content', () => {
    const kit = readKit();
    // No network fetch tooling. (The kit configures an MCP server but never fetches its own
    // content over the network.) These are FETCH instructions, distinct from the relative markdown
    // LINK refs the kit legitimately copies verbatim inside the inlined bodies.
    expect(
      /\bcurl\b/i.test(kit),
      'the kit must NOT instruct a `curl` fetch — it carries every artifact INLINE (AC #1).',
    ).toBe(false);
    expect(
      /\bwget\b/i.test(kit),
      'the kit must NOT instruct a `wget` fetch — it carries every artifact INLINE (AC #1).',
    ).toBe(false);
    expect(
      /fetch\s*\(\s*['"`]?https?:/i.test(kit),
      'the kit must NOT `fetch()` content over the network — every artifact is INLINE (AC #1).',
    ).toBe(false);
    // It must not tell the agent to READ a sibling integration asset for its content (the whole
    // point of "self-contained" is that nothing sibling is needed). A read instruction would name
    // the sibling and a read verb in the same breath.
    expect(
      /\b(read|open|load|fetch|copy)\b[^.\n]{0,40}\bintegration\/bmad\/(skill-rules|cadence-hook|agent-prompt-snippet|identity-bootstrap)/i.test(
        kit,
      ),
      'the kit must NOT instruct reading a sibling integration/bmad asset for its content — it ' +
        'inlines them all (AC #1).',
    ).toBe(false);

    // CONVERSE (so the above is not vacuously true on a stripped kit): the kit must actually CARRY
    // each artifact's content inline. The drift-pin tests already assert verbatim matches; here we
    // re-assert presence at a coarse grain so "self-contained" means "content is here", not
    // "content is absent".
    const registry = readSource(REGISTRY_PATH, 'skill-rules.md');
    expect(
      kit.includes('# AgentBBS skill-rules registry (board behavior)') &&
        kit.includes(
          registry.slice(
            registry.indexOf('## Rule A'),
            registry.indexOf('## Rule B'),
          ),
        ),
      'the kit must CARRY the skill-rules registry inline (self-contained means content present).',
    ).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (c) NO PHANTOM TOOLS (Rule 10) — every backticked tool token is a real registered tool.
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it('names no phantom tools — every backticked tool token in the kit is a real registered tool', () => {
    const kit = readKit();
    const realTools = readCanonicalToolNames();

    // Sanity: the source of truth is non-empty (a bad parse would make this guard vacuous).
    expect(
      realTools.size,
      'expected the contract §6 canonical tool list to parse to a non-empty set',
    ).toBeGreaterThan(0);

    // Backticked tokens in the kit that are NOT tool calls. These mirror the sibling guards'
    // allowlists, plus the kit-specific non-tool identifiers it backticks: `seq` (the message
    // SEQUENCE NUMBER named in the FR21 Frozen semantic), the two `[workflow]` SCHEMA KEYS the
    // inlined templates document (`persistent_facts`, `on_complete`), `current_focus` (a
    // `register` PARAM, not a tool), `agentbbs_handle` (the recorded AGENTS.md key), and
    // `agentbbs` (the MCP-SERVER NAME / the owned `.mcp.json` key — emphatically not a tool; the
    // tools are `register`/`check`/… which it advertises). Keep this list minimal and explicit —
    // growing it should be a deliberate act (a phantom hides only behind an entry added here).
    const NON_TOOL_TOKENS = new Set([
      'seq',
      'persistent_facts',
      'on_complete',
      'current_focus',
      'agentbbs_handle',
      'agentbbs',
    ]);

    const candidates = backtickedTokens(kit);
    const phantom = candidates.filter(
      (tok) => !realTools.has(tok) && !NON_TOOL_TOKENS.has(tok),
    );
    expect(
      phantom,
      `the kit references tool-looking token(s) that are NOT registered tools and are not ` +
        `allowlisted non-tool tokens: ${JSON.stringify([...new Set(phantom)])}. The kit is the ` +
        `highest-stakes agent-consumed asset — a phantom tool here becomes an instruction an agent ` +
        `tries to call against a stranger's project (AC #1, Rule 10). If a token is a real new ` +
        `tool, it will be in docs/mcp-tool-contract.md §6; if it is a non-tool identifier, add it ` +
        `to NON_TOOL_TOKENS.`,
    ).toEqual([]);

    // Converse sanity: the kit's headline tools must actually appear as backticked tokens, so a
    // future reword that strips ALL backticks (making the phantom scan vacuously pass on an empty
    // candidate set) is caught here too.
    for (const tool of [
      'register',
      'login',
      'check',
      'read_room',
      'reply',
      'react',
      'read_contract',
    ] as const) {
      expect(
        candidates.includes(tool),
        `the kit must backtick the \`${tool}\` tool name (AC #1) — its absence would also make ` +
          `the phantom-tool scan vacuous`,
      ).toBe(true);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (d) SAFETY PROPERTIES + PREREQUISITE STATED.
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it('STATES the three safety properties — idempotent / backup-before-overwrite / never-touch-foreign (incl. epic-cycle)', () => {
    const kit = readKit();

    // 1. Idempotent sentinel blocks (a re-run with no change is a no-op).
    expect(
      /idempotent/i.test(kit) &&
        /(no-?op|byte-?level no-?op|no diff)/i.test(kit),
      'the kit must STATE that its edits are IDEMPOTENT — a re-run with identical content is a ' +
        'no-op (AC #2).',
    ).toBe(true);

    // 2. Timestamped backup BEFORE overwrite.
    expect(
      /backup/i.test(kit) &&
        /(timestamp|UTC|agentbbs-bak)/i.test(kit) &&
        /before/i.test(kit),
      'the kit must STATE that it writes a TIMESTAMPED BACKUP BEFORE any overwrite (AC #2).',
    ).toBe(true);

    // 3. Never touch foreign assets — explicitly naming the epic-cycle kit as off-limits.
    expect(
      /epic-cycle/i.test(kit),
      'the kit must STATE the never-touch-foreign rule and NAME the `epic-cycle` installation kit ' +
        'as off-limits (AC #2, Rule 8 foreign-asset boundary).',
    ).toBe(true);
    expect(
      /never\s+touch|does not touch|do(es)? not (modify|touch)|foreign-?safe|left\s+byte-?identical/i.test(
        kit,
      ),
      'the kit must STATE that it never touches assets it does not own (foreign-safe) — AC #2.',
    ).toBe(true);
    // And the JSON analogue: only the owned `agentbbs` key in `.mcp.json` is touched.
    expect(
      /\.mcp\.json/.test(kit) && /\bagentbbs\b/.test(kit),
      'the kit must STATE the `.mcp.json` key-scoped merge — only the owned `agentbbs` server key ' +
        'is touched, foreign servers preserved (AC #2).',
    ).toBe(true);
  });

  it('STATES the AC #3 MCP-server prerequisite — verify the server first; if absent, REPORT and STOP (do not install it)', () => {
    const kit = readKit();

    // It frames the server as a PREREQUISITE.
    expect(
      /prerequisite/i.test(kit),
      'the kit must frame the AgentBBS MCP server as a PREREQUISITE (AC #3).',
    ).toBe(true);

    // It must do the check FIRST and STOP if not met.
    expect(
      /\bstop\b|\bhalt\b/i.test(kit),
      'the kit must STOP/HALT when the prerequisite is not met (AC #3).',
    ).toBe(true);

    // It must explicitly NOT install the server itself.
    expect(
      /(does\s+not|do\s+not|never)[^.\n]{0,40}install[^.\n]{0,30}server|not\s+install\s+the\s+(agentbbs\s+)?(mcp\s+)?server/i.test(
        kit,
      ),
      'the kit must STATE it does NOT install the MCP server itself — it only reports the ' +
        'prerequisite (AC #3).',
    ).toBe(true);

    // The connection record it writes names the server binary/entrypoint + the AGENTBBS_DB env.
    expect(
      /agentbbs-mcp-server/.test(kit) &&
        /dist\/main\.js/.test(kit) &&
        /AGENTBBS_DB/.test(kit),
      'the kit must record the MCP-server connection (binary `agentbbs-mcp-server` / ' +
        '`node <path>/dist/main.js`, env `AGENTBBS_DB`) — AC #1 / AC #3.',
    ).toBe(true);
  });
});
