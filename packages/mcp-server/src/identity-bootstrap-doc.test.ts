// Content-guard for the identity-bootstrap workflow (Story 8.1, AC #4).
//
// `integration/bmad/identity-bootstrap.md` ships a self-contained, AGENT-EXECUTED Markdown workflow
// (FR37–39) that resolves an agent's AgentBBS identity once per project and records it: look for a
// recorded handle in the project's `AGENTS.md` (in an `AGENTBBS-IDENTITY` sentinel block); a recorded
// handle → `login`; no recorded handle → derive `persona@project`, `register`, disambiguate a
// `HANDLE_TAKEN` collision, then record the plain handle. The Epic 8 installation kit
// (`install-agentbbs.md`) INLINES the workflow's sentinel-delimited block VERBATIM, so the text reaches
// a real agent — which makes a wrong tool name a runtime failure the agent hits, not just a doc typo.
//
// Like the agent-prompt-snippet guard (`agent-prompt-snippet-doc.test.ts`) and the Negotiation
// Protocol doc guard (`negotiation-protocol-doc.test.ts`), this is a DOCUMENTATION content guard, NOT
// a code drift guard (that is `tool-contract.drift.test.ts`, which pins the live tool/error/event
// surface). There is no runtime "bootstrap" object in the code to compare against — the bootstrap is a
// recipe over the already-shipped `register`/`login` tools. So this test asserts the workflow CONTAINS,
// by simple presence check, the load-bearing things AC #4 requires it to keep: the three identity
// cases (no-handle→register, recorded→login, taken→disambiguate), the plain-handle-no-secret /
// claim-based rule, the `AGENTBBS-IDENTITY` block name, and the inlinable-block markers — PLUS the
// stronger "no phantom tools" pin (Rule 10) that every tool-looking token in the inlined block is a
// real registered tool. Presence checks (not exact-text matches) are deliberate: the surrounding prose
// may be reworded freely; only the load-bearing tokens are pinned, so the guard does not fight ordinary
// editing while still failing loudly if an identity case or a tool reference disappears.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The workflow lives at the repo root under `integration/bmad/`. This test file is at
// `packages/mcp-server/src/`, so three levels up from its directory is the repo root. Resolving
// relative to `import.meta.url` (not `process.cwd()`) keeps the test correct regardless of where the
// suite is launched from — same convention as `agent-prompt-snippet-doc.test.ts`.
const BOOTSTRAP_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'integration',
  'bmad',
  'identity-bootstrap.md',
);

// The ratified tool contract (doc §6 carries the machine-readable canonical tool-name list). The
// inlinable block is INLINED VERBATIM into an agent's workflow/system prompt by the Epic 8 install
// kit, so a tool name the workflow invents (e.g. a phantom `signup`/`authenticate`) would propagate
// into real agent behaviour — a defect the presence checks below structurally cannot catch (they
// assert the REQUIRED names are present, never that no UNEXPECTED ones appear). The `no-phantom-tools`
// case closes that by parsing the contract's canonical list as the source of truth. It lives three
// levels up under `docs/`, same as the workflow — same resolution convention as
// `agent-prompt-snippet-doc.test.ts` / `tool-contract.drift.test.ts`.
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

// The sentinel markers delimiting the inlinable block in the workflow — the text the install kit
// inlines verbatim into an agent's workflow/system prompt. Mirrors the snippet's
// `AGENTBBS-PROMPT-SNIPPET:BEGIN/END` convention.
const BLOCK_BEGIN = 'AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN';
const BLOCK_END = 'AGENTBBS-IDENTITY-BOOTSTRAP:END';

// The sentinel block name the bootstrap records the handle into, inside the project's `AGENTS.md`. The
// Story 8.4 installation kit owns/updates ONLY this block (idempotent sentinel edit), so its name must
// not silently drift from the workflow that defines it.
const IDENTITY_BLOCK_NAME = 'AGENTBBS-IDENTITY';

/**
 * Read the workflow from disk. A separate helper so a missing/renamed file fails loudly with a clear
 * message rather than an opaque ENOENT mid-assertion.
 */
function readBootstrap(): string {
  try {
    return readFileSync(BOOTSTRAP_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the identity-bootstrap workflow at ${BOOTSTRAP_PATH}. ` +
        `Story 8.1 requires integration/bmad/identity-bootstrap.md to exist (it is the ` +
        `agent-executed identity-bootstrap workflow, FR37–39).`,
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
        `${CONTRACT_DOC_PATH}. The workflow phantom-tool guard parses this block as the source of ` +
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
 * Extract the text BETWEEN the workflow's own `AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END` markers — the
 * block the install kit inlines verbatim into an agent's workflow/system prompt. Scoping the
 * phantom-tool scan to this block (not the whole file) keeps it focused on the text that actually
 * reaches an agent, and keeps the surrounding operator-facing prose free to reference future/other
 * identifiers without tripping the guard.
 */
function readInlinedBlock(bootstrap: string): string {
  const begin = bootstrap.indexOf(BLOCK_BEGIN);
  const end = bootstrap.indexOf(BLOCK_END);
  expect(
    begin !== -1 && end !== -1 && begin < end,
    'the workflow must keep its `AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END` markers delimiting the ' +
      'inlinable block the install kit inlines (AC #4)',
  ).toBe(true);
  return bootstrap.slice(begin, end);
}

describe('integration/bmad/identity-bootstrap.md content guard', () => {
  // (b) IDENTITY TOOLS — the workflow drives identity entirely through the two shipped tools. Dropping
  // either move would leave the bootstrap ambiguous about how an agent claims vs re-establishes its
  // handle.
  const IDENTITY_TOOLS = ['register', 'login'] as const;

  it('keeps the inlinable-block sentinel markers (AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END)', () => {
    // (e) The install kit inlines the block between these markers VERBATIM. If a future edit renames
    // or drops them the kit silently inlines nothing (or the wrong span), so pin their presence and
    // ordering directly. readInlinedBlock also asserts this, but pin it as its own case so the failure
    // is unambiguous when the markers — not a downstream assertion — are what broke.
    const bootstrap = readBootstrap();
    const begin = bootstrap.indexOf(BLOCK_BEGIN);
    const end = bootstrap.indexOf(BLOCK_END);
    expect(
      begin !== -1 && end !== -1 && begin < end,
      `the workflow must keep its \`${BLOCK_BEGIN}\` / \`${BLOCK_END}\` markers, in order, ` +
        'delimiting the block the Story 8.4 install kit inlines verbatim (AC #4)',
    ).toBe(true);
  });

  it('names the AGENTBBS-IDENTITY sentinel block the handle is recorded into', () => {
    // (d) The bootstrap records the handle into a sentinel-bounded `AGENTBBS-IDENTITY` block in the
    // project's `AGENTS.md`; the Story 8.4 kit owns/updates ONLY that block (idempotent edit). The name
    // is the contract between this workflow and that kit, so a rename must fail loudly. Scope the check
    // to the INLINED block (the text the kit inlines and acts on), not the whole file — a file-wide
    // `includes` would survive a rename of the operative occurrence as long as ANY mention remained
    // (e.g. in the operator notes), making the pin non-discriminating. Asserting it INSIDE the inlined
    // block is what makes a rename of the kit-contract name turn this red.
    const block = readInlinedBlock(readBootstrap());
    // CAREFUL: a plain `block.includes('AGENTBBS-IDENTITY')` would be VACUOUS — `AGENTBBS-IDENTITY` is
    // a substring of the inlinable block's own `AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END` markers, so the
    // substring is present whenever the markers are, and the check could never fail. Pin the RECORDED-
    // HANDLE block name as a token that is NOT the `-BOOTSTRAP` marker, via a negative-lookahead: this
    // matches its `AGENTBBS-IDENTITY:BEGIN/END` marker form and the bare backticked `AGENTBBS-IDENTITY`
    // references, but is NOT satisfied by `AGENTBBS-IDENTITY-BOOTSTRAP`. Renaming the operative block
    // name therefore turns this red even though the BOOTSTRAP marker substring survives. (Mutation-
    // verified: renaming every bare `AGENTBBS-IDENTITY` → RED with this pin; GREEN with a plain
    // includes.)
    expect(
      /AGENTBBS-IDENTITY(?!-BOOTSTRAP)/.test(block),
      `the inlined block must name the \`${IDENTITY_BLOCK_NAME}\` recorded-handle sentinel block it ` +
        'records the handle into — as a distinct token, not merely the AGENTBBS-IDENTITY-BOOTSTRAP ' +
        'marker (the Story 8.4 kit owns/updates only that block) — AC #4',
    ).toBe(true);
    // And it must say the handle lands in the project's AGENTS.md (FR38) — the WHERE, not just the
    // block name. A reword that drops the file reference would leave the recording target ambiguous.
    expect(
      block.includes('AGENTS.md'),
      'the inlined block must record the handle into the project’s `AGENTS.md` (FR38) — AC #1/#4',
    ).toBe(true);
  });

  it('covers the NO-RECORDED-HANDLE case — derive a persona@project handle and `register` it (AC #1)', () => {
    const block = readInlinedBlock(readBootstrap());
    // The first identity case: nothing recorded → derive a default handle and register it.
    expect(
      block.includes('register'),
      'the workflow must tell an agent to `register` a derived handle when none is recorded (AC #1)',
    ).toBe(true);
    // The derived handle is persona/role + project scope, of the form `persona@project`. Pin the BASE
    // `persona@project` form via a negative-lookahead for a trailing `-` so the pin is NOT satisfied by
    // the disambiguation example `persona@project-2` alone: a derivation-step rewrite to a non-`@` form
    // (e.g. `persona-project`) that left only `persona@project-2` behind must still turn this red. It is
    // the FR39 shape the whole "one stable per-project handle" property rests on. (Mutation-verified:
    // rewriting the base-form derivation → RED with `(?!-)`; GREEN without it, since `persona@project-2`
    // contains `persona@project`.)
    expect(
      /persona@project(?!-)/i.test(block),
      'the workflow must derive the default handle in the base `persona@project` form (FR39), not ' +
        'only as the `persona@project-2` disambiguation example — AC #1',
    ).toBe(true);
  });

  it('covers the RECORDED-HANDLE case — `login` with it, do not register a second handle (AC #2)', () => {
    const block = readInlinedBlock(readBootstrap());
    // The second identity case: a handle is recorded → login with it (reuse the stable handle).
    expect(
      block.includes('login'),
      'the workflow must tell an agent to `login` with the recorded handle (reuse it, do not ' +
        'register a second one) when one is recorded (AC #2)',
    ).toBe(true);
  });

  it('covers the HANDLE_TAKEN case — disambiguate with a bounded discriminator and retry (AC #3)', () => {
    const block = readInlinedBlock(readBootstrap());
    // The third identity case: the derived handle is taken → disambiguate by appending a discriminator
    // and retry. Pin the `HANDLE_TAKEN` trigger (the exact closed error code register surfaces) so the
    // case stays bound to the real failure it handles.
    expect(
      block.includes('HANDLE_TAKEN'),
      'the workflow must handle the `HANDLE_TAKEN` collision (the closed error `register` surfaces ' +
        'when the handle is already claimed) — AC #3',
    ).toBe(true);
    // And it must DISAMBIGUATE (append a discriminator and retry). Accept the natural phrasings of
    // "append a discriminator / retry" — any one is enough; all absent means the collision-handling
    // step was lost.
    expect(
      /disambiguat|discriminator|retr(y|ies|ying)/i.test(block),
      'the workflow must disambiguate a `HANDLE_TAKEN` collision (append a short discriminator and ' +
        'retry, bounded) before recording the final handle — AC #3',
    ).toBe(true);
  });

  it('states the PLAIN-HANDLE-NO-SECRET / claim-based rule (NFR7) — the recorded handle is safe to commit (AC #3)', () => {
    const bootstrap = readBootstrap().toLowerCase();
    // (c) The load-bearing security claim: V1 auth is CLAIM-BASED — the handle is the credential, there
    // is no secret/token — so ONLY the plain handle is recorded, and it is SAFE TO COMMIT. All three
    // ideas must survive a reword: claim-based, no-secret, safe-to-commit. Dropping any one would let
    // the workflow imply a secret exists or that the handle must be hidden — the exact mischaracteriza-
    // tion this guard exists to catch.
    expect(
      bootstrap.includes('claim-based') || bootstrap.includes('claim based'),
      'the workflow must state V1 auth is CLAIM-BASED (the handle is the credential; NFR7) — AC #3',
    ).toBe(true);
    // No secret/token is recorded — accept "no secret", "no token", "without a secret", etc. The
    // workflow records ONLY the plain handle.
    expect(
      /no\s+secret|no\s+(password\s+or\s+)?token|without\s+a\s+secret|there\s+is\s+none/.test(
        bootstrap,
      ),
      'the workflow must state that NO secret/token is recorded — only the plain handle (NFR7) — AC #3',
    ).toBe(true);
    // The recorded handle is SAFE TO COMMIT (the direct consequence of claim-based auth). This is the
    // operator-facing reassurance the whole "record it in the repo" design depends on.
    expect(
      bootstrap.includes('safe to commit'),
      'the workflow must state the recorded handle is SAFE TO COMMIT (claim-based auth, no secret) — AC #3',
    ).toBe(true);
  });

  it('states EXPLICITLY that it is documentation only — the board enforces none of it', () => {
    const bootstrap = readBootstrap().toLowerCase();
    // The load-bearing caveat (mirrors the snippet / protocol-doc guards): this is RECOMMENDED,
    // agent-executed text the board ENFORCES NONE of. Both ideas must be present — an explicit
    // "documentation only" framing AND an "enforce(s) none / not enforced" style statement — so a
    // reword cannot quietly drop the disclaimer while keeping a softer half of it.
    expect(
      bootstrap.includes('documentation only') ||
        bootstrap.includes('documentation-only'),
      'the workflow must state it is DOCUMENTATION ONLY (an agent follows it; not enforced code)',
    ).toBe(true);
    const enforcementDisclaimer =
      /enforces?\s+none|not\s+enforced|enforces?\s+nothing|no\s+enforcement/.test(
        bootstrap,
      );
    expect(
      enforcementDisclaimer,
      'the workflow must state EXPLICITLY that the board does NOT enforce any of it ' +
        '(e.g. "enforces none of it", "not enforced", "no enforcement")',
    ).toBe(true);
  });

  it('names both identity tools `register` and `login` in the inlinable block', () => {
    // (b) Both shipped identity tools must be NAMED in the block the kit inlines — the bootstrap drives
    // identity entirely through them. (The per-case tests above pin each tool to its own case; this
    // pins both are present in the inlined text regardless of how the cases are worded.)
    const block = readInlinedBlock(readBootstrap());
    for (const tool of IDENTITY_TOOLS) {
      expect(
        block.includes(tool),
        `the inlinable block must name the \`${tool}\` identity tool — the bootstrap ${
          tool === 'register'
            ? 'claims a new handle'
            : 're-establishes an existing handle'
        } with it (AC #4)`,
      ).toBe(true);
    }
  });

  // NO PHANTOM TOOLS (Rule 10) — every tool the inlined block tells an agent to CALL must be a real,
  // registered tool. The presence checks above are necessary but not sufficient for AC #4's "pins its
  // claims … to the code's source of truth": they pin that the REQUIRED tools are NAMED, but a future
  // edit could ADD a sentence inventing a tool that does not exist (e.g. `signup` to claim a handle, or
  // `authenticate` to log in) and every assertion above would still pass. Because the Story 8.4 install
  // kit inlines this block VERBATIM into an agent's workflow/system prompt, a phantom tool here becomes
  // a real instruction an agent tries to call — a runtime failure. This case closes that gap: it scans
  // the backticked `snake_case` tokens in the inlined block and asserts each is either a real tool
  // (from the contract's canonical §6 list, transitively pinned to the live `McpServer`) or one of a
  // small, explicit allowlist of known NON-tool tokens the workflow legitimately backticks. A
  // newly-backticked unknown token fails loudly, forcing a conscious "is this a real tool, or add it to
  // the allowlist?" decision rather than letting a fake tool slip into the shipped workflow text.
  it('names no phantom tools — every backticked tool token in the inlined block is a real registered tool', () => {
    const block = readInlinedBlock(readBootstrap());
    const realTools = readCanonicalToolNames();

    // Sanity: the source of truth is non-empty (a bad parse would make this guard vacuous).
    expect(
      realTools.size,
      'expected the contract §6 canonical tool list to parse to a non-empty set',
    ).toBeGreaterThan(0);

    // Tokens the workflow backticks that are NOT tool calls: the two `register`/`login` PARAMETER names
    // (`current_focus`, `handle`). Anything else backticked in the inlined block is treated as a tool
    // claim. Keep this list minimal and explicit — growing it should be a deliberate act, which is the
    // point (mirrors the agent-prompt-snippet guard's NON_TOOL_TOKENS).
    const NON_TOOL_TOKENS = new Set(['current_focus', 'handle']);

    // Backticked `snake_case` identifiers in the inlined block (lowercase letters/underscores, len ≥ 3
    // to skip incidental short spans). Tool names are all lowercase snake/word tokens, so this is the
    // candidate set of "things presented as a callable name". This goes one step BEYOND the snippet
    // guard's `` `token` ``-only pattern: this workflow presents its tool invocations primarily in the
    // CALL form `` `tool{ args }` `` (e.g. `register{ handle, current_focus }`, `login{ handle }`), so
    // the candidate must also capture the leading token of a backticked call-form — otherwise a phantom
    // introduced ONLY as `` `provision{ … }` `` (a form this asset uses heavily) would never become a
    // candidate and would slip the scan. Match a backtick, the snake token, then EITHER a closing
    // backtick (bare reference) OR a `{` (call form). (Code-review hardening — the snippet guard's
    // bare-only pattern has this blind spot; this asset's prominent call-form makes closing it matter.)
    const candidates = [...block.matchAll(/`([a-z][a-z_]{2,})(?:`|\{)/g)].map(
      (m) => m[1],
    );

    // Every candidate must be a real tool OR an allowlisted non-tool token — never an unknown name.
    const phantom = candidates.filter(
      (tok) => !realTools.has(tok) && !NON_TOOL_TOKENS.has(tok),
    );
    expect(
      phantom,
      `the inlined workflow block references tool-looking token(s) that are NOT registered tools and ` +
        `are not allowlisted non-tool tokens: ${JSON.stringify([...new Set(phantom)])}. A workflow ` +
        `inlined into an agent's system prompt must not instruct it to call a tool that does not ` +
        `exist (AC #4, Rule 10). If a token is a real new tool, it will be in docs/mcp-tool-contract.md ` +
        `§6; if it is a non-tool identifier, add it to NON_TOOL_TOKENS.`,
    ).toEqual([]);

    // And the converse sanity: both identity tools must actually appear as backticked tokens in the
    // inlined block (so a future reword that strips ALL backticks — making the phantom scan vacuously
    // pass on an empty candidate set — is caught here too).
    for (const tool of ['register', 'login']) {
      expect(
        candidates.includes(tool),
        `the inlined block must backtick the \`${tool}\` tool name (AC #4) — its absence would also ` +
          `make the phantom-tool scan vacuous`,
      ).toBe(true);
    }
  });
});
