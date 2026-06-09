// QA-strengthening content-guard for the Story-12.3 cross-project integration play (FR42), focused
// on the SEAM BETWEEN the two agent-facing assets that the dev's per-asset guards
// (`skill-rules-registry-doc.test.ts`, `agent-prompt-snippet-doc.test.ts`) do not pin: the
// CROSS-ASSET CONSISTENCY (Rule 8 — no drift between assets describing the same play).
//
// Why this is needed (the gap the per-asset guards leave):
//   - Each per-asset guard pins a hard-coded `PLAY_TOOLS` constant against ITS OWN asset
//     (registry Rule C; snippet §4). They are identical constants today, but nothing asserts the
//     two ASSETS name the SAME play tool set DERIVED FROM CONTENT. A future edit that adds a play
//     step+tool to Rule C (and that guard's constant) but forgets §4 — or vice-versa — would leave
//     BOTH per-asset guards green while the two assets have DRIFTED (an agent gets two different
//     recipes depending on which asset it loaded). This is exactly the Rule-8 "two assets describing
//     the same thing must not drift" failure the registry↔cadence-hook consistency block already
//     guards for the review cadence; this file extends that discipline to the Story-12.3 play.
//   - `read_room` is a NAMED step of the play in BOTH assets (step 2 "read its context") but is NOT
//     positively pinned as required-present in the snippet guard (it only appears in a comment
//     there). Pinning the FULL distinctive play tool set — derived from the play text in BOTH assets
//     — closes that, so a future edit cannot silently drop `read_room` (or any play step's tool) from
//     either asset.
//
// This is a DOCUMENTATION/CONFIG content guard (like its siblings), NOT a code drift guard
// (`tool-contract.drift.test.ts` pins the live tool surface). It (a) pins every distinctive play
// tool present in BOTH assets and real per §6, and (b) asserts the play tool set the registry's
// Rule C names EQUALS the set the snippet's §4 names (no cross-asset drift). The four-move /
// review tools the play DELEGATES to (Rule B / the cadence) are pinned by the per-asset guards and
// the negotiation-protocol guard; here we pin the cross-asset consistency of the play itself.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Same repo-root resolution convention as the sibling doc guards (three levels up from
// `packages/mcp-server/src/`), anchored on `import.meta.url` so the suite is launch-dir independent.
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const BMAD_DIR = join(REPO_ROOT, 'integration', 'bmad');
const REGISTRY_PATH = join(BMAD_DIR, 'skill-rules.md');
const SNIPPET_PATH = join(BMAD_DIR, 'agent-prompt-snippet.md');
const CONTRACT_DOC_PATH = join(REPO_ROOT, 'docs', 'mcp-tool-contract.md');

const TOOL_LIST_BEGIN = '# AGENTBBS-TOOL-CONTRACT:BEGIN';
const TOOL_LIST_END = '# AGENTBBS-TOOL-CONTRACT:END';

// The complete distinctive tool set the cross-project integration play NAMES across its five steps
// (Story 12.3 AC1): discover (`list_projects`), read context (`list_members` + `read_room`), post
// the need (`reply` to grant-on-act, OR `join_board` + `post_announcement` for the gated proto-room
// path), ratify-retract (`react` / `unreact`), Frozen (`read_contract`), escalate
// (`add_participant`). This is the FULL play surface — a superset of the
// per-asset guards' `PLAY_TOOLS` (which pin only the four DISTINCTIVE-to-the-play names). Pinning the
// full set here, required-present in BOTH assets, closes the per-asset gaps (notably `read_room`,
// which the snippet guard does not positively pin) without double-pinning vacuously: this is the
// ONLY guard that asserts these names appear in BOTH the registry Rule C AND the snippet §4.
const PLAY_TOOLS = [
  'list_projects',
  'list_members',
  'read_room',
  'join_board',
  'post_announcement',
  'reply',
  'react',
  'unreact',
  'read_contract',
  'add_participant',
] as const;

function read(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read ${label} at ${path}. The Story-12.3 cross-project play consistency guard ` +
        `pins it.`,
      { cause },
    );
  }
}

/**
 * Parse the canonical registered-tool names from the contract doc's sentinel §6 block — the SAME
 * source of truth the sibling guards use (transitively bound to the live `McpServer` by
 * `tool-contract.drift.test.ts`). Fails loudly on a missing block rather than vacuously yielding an
 * empty set.
 */
function readCanonicalToolNames(): ReadonlySet<string> {
  const doc = readFileSync(CONTRACT_DOC_PATH, 'utf8');
  const begin = doc.indexOf(TOOL_LIST_BEGIN);
  const end = doc.indexOf(TOOL_LIST_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `Could not locate the canonical tool-name block (${TOOL_LIST_BEGIN} … ${TOOL_LIST_END}) in ` +
        `${CONTRACT_DOC_PATH}.`,
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
 * Extract the registry's Rule C section (the cross-project integration play) — from the `## Rule C`
 * header to the next `## ` header (or EOF). Scoping the cross-asset comparison to JUST the play
 * section (not the whole file) means the comparison is about the PLAY's tool set, not incidental
 * mentions of a tool elsewhere in the registry (e.g. `read_room` in Rule A's cadence).
 */
function ruleCSection(registry: string): string {
  const start = registry.indexOf('## Rule C');
  expect(
    start !== -1,
    'the registry must carry a `## Rule C` cross-project integration play section (Story 12.3 AC1)',
  ).toBe(true);
  const rest = registry.slice(start + '## Rule C'.length);
  const nextHeader = rest.indexOf('\n## ');
  return nextHeader === -1 ? rest : rest.slice(0, nextHeader);
}

/**
 * Extract the snippet's §4 section ("### 4. Reaching out to integrate with another project") — from
 * that header to the next `### ` / `<!-- ...:END -->` marker (or EOF). Same scoping rationale as
 * `ruleCSection`: compare the PLAY's tool set, not incidental mentions elsewhere in the snippet
 * (e.g. `read_room` in the §2 cadence).
 */
function section4(snippet: string): string {
  const start = snippet.indexOf('### 4. Reaching out to integrate');
  expect(
    start !== -1,
    'the snippet must carry a "### 4. Reaching out to integrate with another project" section ' +
      '(Story 12.3 AC1)',
  ).toBe(true);
  const rest = snippet.slice(start + '### 4. Reaching out to integrate'.length);
  // The next section is the END marker of the inlined block (§4 is the last section in the block).
  const endMarker = rest.indexOf('AGENTBBS-PROMPT-SNIPPET:END');
  const nextHeader = rest.indexOf('\n### ');
  const cut = [endMarker, nextHeader].filter((i) => i !== -1);
  return cut.length === 0 ? rest : rest.slice(0, Math.min(...cut));
}

/** The set of distinctive play tools (from PLAY_TOOLS) a play SECTION names, as a sorted array. */
function playToolsNamedIn(section: string): string[] {
  return PLAY_TOOLS.filter((tool) => section.includes(tool)).sort();
}

describe('Story 12.3 cross-project play — cross-asset consistency (Rule 8, no drift)', () => {
  it('every distinctive play tool is a REAL registered §6 tool (Rule 10 — no phantom in the play set)', () => {
    const realTools = readCanonicalToolNames();
    expect(
      realTools.size,
      'expected the contract §6 canonical tool list to parse to a non-empty set',
    ).toBeGreaterThan(0);
    for (const tool of PLAY_TOOLS) {
      expect(
        realTools.has(tool),
        `the play names \`${tool}\`, which must be a real registered tool in ` +
          `docs/mcp-tool-contract.md §6 (Story 12.3 AC2, Rule 10) — the play composes the shipped ` +
          `surface and introduces no new tool (Rule 13)`,
      ).toBe(true);
    }
  });

  it('the registry Rule C names the FULL distinctive play tool set (closes the per-asset gaps, incl. read_room)', () => {
    const section = ruleCSection(read(REGISTRY_PATH, 'skill-rules.md'));
    for (const tool of PLAY_TOOLS) {
      expect(
        section.includes(tool),
        `the registry Rule C play must name the \`${tool}\` tool — a future edit must not silently ` +
          `drop a play step's tool (Story 12.3 AC1)`,
      ).toBe(true);
    }
  });

  it('the snippet §4 names the FULL distinctive play tool set (closes the per-asset gaps, incl. read_room)', () => {
    const section = section4(read(SNIPPET_PATH, 'agent-prompt-snippet.md'));
    for (const tool of PLAY_TOOLS) {
      expect(
        section.includes(tool),
        `the snippet §4 play must name the \`${tool}\` tool — a future edit must not silently drop ` +
          `a play step's tool (Story 12.3 AC1)`,
      ).toBe(true);
    }
  });

  it('the registry Rule C and the snippet §4 name the SAME play tool set (Rule 8 — assets do not drift)', () => {
    const ruleC = ruleCSection(read(REGISTRY_PATH, 'skill-rules.md'));
    const sec4 = section4(read(SNIPPET_PATH, 'agent-prompt-snippet.md'));

    const registrySet = playToolsNamedIn(ruleC);
    const snippetSet = playToolsNamedIn(sec4);

    // The two assets describe the SAME play, so the set of play tools each names must be IDENTICAL.
    // Deriving each set FROM THE ASSET CONTENT (not from a single shared constant) is what catches a
    // real cross-asset drift: if a future edit adds/removes a play tool in one asset but not the
    // other, the two derived sets diverge and this turns RED — the per-asset guards (which each pin
    // their own copy of the constant) would not.
    expect(
      snippetSet,
      `the registry Rule C and the snippet §4 name DIFFERENT play tool sets — the two assets ` +
        `describing the same cross-project play have DRIFTED (Rule 8). Registry: ` +
        `${JSON.stringify(registrySet)}; snippet: ${JSON.stringify(snippetSet)}. Reconcile them so ` +
        `an agent gets one coherent recipe regardless of which asset it loaded.`,
    ).toEqual(registrySet);

    // And both must equal the full pinned set (so a SYNCHRONISED drop of a tool from BOTH assets —
    // which would keep the two derived sets equal to each other while silently shrinking the play —
    // is also caught).
    expect(
      registrySet,
      'both assets must name the full distinctive play tool set (a tool dropped from BOTH assets ' +
        'in sync would keep them equal to each other but silently shrink the play — Story 12.3 AC1)',
    ).toEqual([...PLAY_TOOLS].sort());
  });
});
