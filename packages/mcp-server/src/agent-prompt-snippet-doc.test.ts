// Content-guard for the agent-prompt snippet (Story 7.3, AC #3).
//
// `integration/bmad/agent-prompt-snippet.md` ships COPY-PASTEABLE system-prompt text (FR27) an
// operator drops into an agent's system prompt so the agent (a) bootstraps a stable per-project
// identity, (b) runs the post-step board-review CADENCE, and (c) follows the four-move Negotiation
// Protocol — all over the shipped tool surface. The Epic 8 installation kit (`install-agentbbs.md`)
// inlines this content, so it must not silently drift from the tools it names.
//
// Like the Negotiation Protocol doc guard (`negotiation-protocol-doc.test.ts`), this is a
// DOCUMENTATION content guard, NOT a code drift guard (that is `tool-contract.drift.test.ts`, which
// pins the live tool/error/event surface). The snippet's recommendations are a convention the board
// enforces NONE of; there is no runtime "cadence" or "snippet" object in the code to compare against.
// So this test asserts the snippet CONTAINS, by simple presence check, the load-bearing things AC #3
// requires it to keep: the identity-bootstrap moves (`register`/`login`), the `check` cadence, the
// four protocol-move NAMES, the protocol tool references (`check`/`reply`/`react`/`read_contract`),
// and the "documentation only / not enforced" disclaimer. Presence checks (not exact-text matches)
// are deliberate: the surrounding prose may be reworded freely; only the load-bearing tokens are
// pinned, so the guard does not fight ordinary editing while still failing loudly if a section or a
// tool reference disappears.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The snippet lives at the repo root under `integration/bmad/`. This test file is at
// `packages/mcp-server/src/`, so three levels up from its directory is the repo root. Resolving
// relative to `import.meta.url` (not `process.cwd()`) keeps the test correct regardless of where the
// suite is launched from — same convention as `negotiation-protocol-doc.test.ts`.
const SNIPPET_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'integration',
  'bmad',
  'agent-prompt-snippet.md',
);

// The ratified tool contract (doc §6 carries the machine-readable canonical tool-name list). The
// snippet is INLINED VERBATIM into agents' system prompts by the Epic 8 install kit, so a tool name
// the snippet invents (e.g. a phantom `subscribe`/`watch`) would propagate into real agent behaviour
// — a defect the presence checks above structurally cannot catch (they assert the REQUIRED names are
// present, never that no UNEXPECTED ones appear). The `no-phantom-tools` case below closes that by
// parsing the contract's canonical list as the source of truth. It lives three levels up under
// `docs/`, same as the snippet — same resolution convention as `tool-contract.drift.test.ts`.
const CONTRACT_DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'mcp-tool-contract.md',
);

// Sentinels delimiting the machine-readable canonical tool-name list in the contract doc (§6). Kept
// in lockstep with the markers in `docs/mcp-tool-contract.md` (and with `tool-contract.drift.test.ts`,
// which pins that same block to the live `McpServer` registration — so this list is transitively
// bound to the real registered surface without this doc-only test needing to boot a server).
const TOOL_LIST_BEGIN = '# AGENTBBS-TOOL-CONTRACT:BEGIN';
const TOOL_LIST_END = '# AGENTBBS-TOOL-CONTRACT:END';

/**
 * Read the snippet from disk. A separate helper so a missing/renamed file fails loudly with a clear
 * message rather than an opaque ENOENT mid-assertion.
 */
function readSnippet(): string {
  try {
    return readFileSync(SNIPPET_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the agent-prompt snippet at ${SNIPPET_PATH}. ` +
        `Story 7.3 requires integration/bmad/agent-prompt-snippet.md to exist (it is the ` +
        `recommended agent system-prompt text, FR27).`,
      { cause },
    );
  }
}

/**
 * Parse the canonical registered-tool names from the contract doc's sentinel-delimited §6 block
 * (one bare tool name per line). This is the SAME block `tool-contract.drift.test.ts` asserts equals
 * the live `McpServer` tool set, so it is the authoritative answer to "is this a real tool?". Fails
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
        `${CONTRACT_DOC_PATH}. The snippet phantom-tool guard parses this block as the source of ` +
        `truth for which tools exist.`,
    );
  }
  const names = doc
    .slice(begin + TOOL_LIST_BEGIN.length, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return new Set(names);
}

/**
 * Extract the text BETWEEN the snippet's own `AGENTBBS-PROMPT-SNIPPET:BEGIN/END` markers — the block
 * the install kit inlines verbatim into an agent's system prompt. Scoping the phantom-tool scan to
 * this block (not the whole file) keeps it focused on the text that actually reaches an agent, and
 * keeps the surrounding operator-facing prose free to reference future/other identifiers without
 * tripping the guard.
 */
function readInlinedBlock(snippet: string): string {
  const begin = snippet.indexOf('AGENTBBS-PROMPT-SNIPPET:BEGIN');
  const end = snippet.indexOf('AGENTBBS-PROMPT-SNIPPET:END');
  expect(
    begin !== -1 && end !== -1 && begin < end,
    'the snippet must keep its `AGENTBBS-PROMPT-SNIPPET:BEGIN/END` markers delimiting the ' +
      'copy-pasteable block the install kit inlines (AC #1/#2)',
  ).toBe(true);
  return snippet.slice(begin, end);
}

describe('integration/bmad/agent-prompt-snippet.md content guard', () => {
  // (a) IDENTITY BOOTSTRAP — the snippet must tell the agent to establish a stable identity via the
  // shipped identity tools. Dropping either move would leave the bootstrap section ambiguous about
  // how an agent claims vs re-establishes its handle.
  const IDENTITY_TOOLS = ['register', 'login'] as const;

  // (c) The four moves of the Negotiation Protocol (mirrors the protocol-doc guard). Dropping any
  // name means the snippet silently lost a move.
  const FOUR_MOVES = ['Propose', 'Counter', 'Ratify', 'Frozen'] as const;

  // The protocol/cadence tool references AC #3 calls out explicitly. The snippet must name each by
  // its exact wire/tool name so the recommendation stays bound to the real surface.
  const PROTOCOL_TOOLS = [
    'check', // the cadence dial-in
    'reply', // Propose / Counter
    'react', // Ratify (👍)
    'read_contract', // Frozen (the computed contract)
  ] as const;

  it('covers identity bootstrap — names both `register` and `login`', () => {
    const snippet = readSnippet();
    for (const tool of IDENTITY_TOOLS) {
      expect(
        snippet.includes(tool),
        `the snippet must name the \`${tool}\` identity tool — the identity-bootstrap section must ` +
          `tell an agent to ${tool === 'register' ? 'claim a new handle' : 're-establish an existing handle'} (AC #1a)`,
      ).toBe(true);
    }
  });

  it('describes the post-step board-review CADENCE driven by `check`', () => {
    const snippet = readSnippet();

    // The cadence is a PULL review the agent runs after each workflow step, anchored on `check`.
    // `check` is asserted in PROTOCOL_TOOLS too, but pin the cadence framing here so the section
    // itself can't be reworded away while the bare token survives elsewhere.
    expect(
      snippet.includes('check'),
      'the snippet must name the `check` tool — the board-review cadence dials in via `check` (AC #1b)',
    ).toBe(true);

    // The cadence is a PULL (the agent dials in; the board never pushes). The word "pull" anchors
    // the load-bearing delivery semantic the whole board rests on (NFR5/NFR11).
    expect(
      /pull/i.test(snippet),
      'the snippet must frame the cadence as a PULL review (the agent dials in; the board never ' +
        'pushes) — AC #1b',
    ).toBe(true);

    // The cadence runs at workflow-STEP boundaries — the "after each step" framing is what makes it
    // a cadence rather than a one-off. Accept "step" in any casing.
    expect(
      /step/i.test(snippet),
      'the snippet must tie the review cadence to workflow STEP boundaries (a review per step end) — AC #1b',
    ).toBe(true);
  });

  it('names all four protocol moves (Propose, Counter, Ratify, Frozen)', () => {
    const snippet = readSnippet();
    for (const move of FOUR_MOVES) {
      expect(
        snippet.includes(move),
        `the snippet must name the "${move}" protocol move — a future edit must not silently drop a move (AC #1c)`,
      ).toBe(true);
    }
  });

  it('references the real protocol/cadence tools (check, reply, react, read_contract)', () => {
    const snippet = readSnippet();
    for (const tool of PROTOCOL_TOOLS) {
      expect(
        snippet.includes(tool),
        `the snippet must reference the \`${tool}\` tool — the cadence/protocol recommendation must ` +
          `not drift from the shipped surface (AC #3)`,
      ).toBe(true);
    }
  });

  it('points to the canonical Negotiation Protocol doc', () => {
    const snippet = readSnippet();

    // The snippet is the short recommendation; the full convention lives in
    // `docs/negotiation-protocol.md` (Story 7.1). The pointer must survive so a reader can find the
    // authoritative four-move convention rather than relying on the snippet's summary.
    expect(
      snippet.includes('docs/negotiation-protocol.md'),
      'the snippet must point to docs/negotiation-protocol.md for the full Negotiation Protocol ' +
        'convention (AC #1c)',
    ).toBe(true);
  });

  it('states EXPLICITLY that it is documentation only — the board enforces none of it (AC #2)', () => {
    const snippet = readSnippet().toLowerCase();

    // The load-bearing caveat (mirrors the protocol-doc guard): this is RECOMMENDED prompt text the
    // board ENFORCES NONE of. Both ideas must be present — an explicit "documentation only" framing
    // AND an "enforce(s) none / not enforced" style statement — so a reword cannot quietly drop the
    // disclaimer while keeping a softer half of it.
    expect(
      snippet.includes('documentation only') ||
        snippet.includes('documentation-only'),
      'the snippet must state it is DOCUMENTATION ONLY (recommended prompt text, not enforced code) — AC #2',
    ).toBe(true);

    // Accept the natural phrasings of "the board does not enforce this": "enforces none",
    // "enforce none", "not enforced", "enforces nothing", "no enforcement". Any one satisfies the
    // disclaimer; all absent means the not-enforced statement was lost.
    const enforcementDisclaimer =
      /enforces?\s+none|not\s+enforced|enforces?\s+nothing|no\s+enforcement/.test(
        snippet,
      );
    expect(
      enforcementDisclaimer,
      'the snippet must state EXPLICITLY that the board does NOT enforce any of it ' +
        '(e.g. "enforces none of it", "not enforced", "no enforcement") — AC #2',
    ).toBe(true);
  });

  // NO PHANTOM TOOLS — every tool the inlined block tells an agent to CALL must be a real, registered
  // tool. The presence checks above are necessary but not sufficient for AC #3's "can't silently drift
  // from the shipped surface": they pin that the REQUIRED tools are NAMED, but a future edit could
  // ADD a sentence inventing a tool that does not exist (e.g. `subscribe` to get pushed updates —
  // doubly wrong, since the board is pull-only) and every assertion above would still pass. Because
  // the Epic 8 install kit inlines this block VERBATIM into agents' system prompts, a phantom tool
  // here becomes a real instruction an agent tries to call. This case closes that gap: it scans the
  // backticked `snake_case` tokens in the inlined block and asserts each is either a real tool (from
  // the contract's canonical §6 list, transitively pinned to the live `McpServer`) or one of a small,
  // explicit allowlist of known NON-tool tokens the snippet legitimately backticks. A newly-backticked
  // unknown token fails loudly, forcing a conscious "is this a real tool, or add it to the allowlist?"
  // decision rather than letting a fake tool slip into the shipped prompt text.
  it('names no phantom tools — every backticked tool token in the inlined block is a real registered tool', () => {
    const inlined = readInlinedBlock(readSnippet());
    const realTools = readCanonicalToolNames();

    // Sanity: the source of truth is non-empty (a bad parse would make this guard vacuous).
    expect(
      realTools.size,
      'expected the contract §6 canonical tool list to parse to a non-empty set',
    ).toBeGreaterThan(0);

    // Tokens the snippet backticks that are NOT tool calls: a register/update_focus PARAMETER and the
    // message-ordering key. Anything else backticked in the inlined block is treated as a tool claim.
    // Keep this list minimal and explicit — growing it should be a deliberate act, which is the point.
    const NON_TOOL_TOKENS = new Set(['current_focus', 'seq']);

    // Backticked `snake_case` identifiers in the inlined block (lowercase letters/underscores, len ≥ 3
    // to skip incidental short spans). Tool names are all lowercase snake/word tokens, so this is the
    // candidate set of "things presented as a callable name".
    const candidates = [...inlined.matchAll(/`([a-z][a-z_]{2,})`/g)].map(
      (m) => m[1],
    );

    // Every candidate must be a real tool OR an allowlisted non-tool token — never an unknown name.
    const phantom = candidates.filter(
      (tok) => !realTools.has(tok) && !NON_TOOL_TOKENS.has(tok),
    );
    expect(
      phantom,
      `the inlined snippet block references tool-looking token(s) that are NOT registered tools and ` +
        `are not allowlisted non-tool tokens: ${JSON.stringify([...new Set(phantom)])}. A snippet ` +
        `inlined into an agent's system prompt must not instruct it to call a tool that does not ` +
        `exist (AC #3). If a token is a real new tool, it will be in docs/mcp-tool-contract.md §6; ` +
        `if it is a non-tool identifier, add it to NON_TOOL_TOKENS.`,
    ).toEqual([]);

    // And the converse sanity: at least the four protocol/cadence tools must actually appear as
    // backticked tokens in the inlined block (so a future reword that strips ALL backticks — making
    // the phantom scan vacuously pass on an empty candidate set — is caught here too).
    for (const tool of ['check', 'reply', 'react', 'read_contract']) {
      expect(
        candidates.includes(tool),
        `the inlined block must backtick the \`${tool}\` tool name (AC #3) — its absence would also ` +
          `make the phantom-tool scan vacuous`,
      ).toBe(true);
    }
  });
});
