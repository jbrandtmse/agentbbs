// Rule-10 content-guard for the README stand-up guide (Story 11.5, AC6).
//
// The README is now an agent/operator-CONSUMED asset: it names the bins an MCP client / operator
// invokes (`agentbbs-mcp-server`, `agentbbs`), the env var that points every client at the ledger
// (`AGENTBBS_DB`), the operator subcommands (`ui`/`export`/`import`), and the MCP tool count. A doc
// that silently lies about any of these sends an outside developer to a bin that doesn't exist or a
// command that isn't recognized. This test pins each machine-relevant claim to its SOURCE OF TRUTH:
//   - bin names      → the packages' `bin` fields (mcp-server + cli package.json)
//   - db env var     → `DB_PATH_ENV` exported from @agentbbs/data-access
//   - subcommands    → `SUBCOMMAND_NAMES` derived from the cli dispatch table (@agentbbs/cli)
//   - tool count     → the live `Client.listTools()` set the real MCP server registers
//
// It lives in the mcp-server package (NOT cli) because pinning the tool count requires the MCP SDK +
// `createBoardServer`, which are mcp-server's dependencies — cli must not reach the SDK (the NFR2
// boundary). The cross-package `@agentbbs/cli` / `@agentbbs/data-access` symbols resolve through the
// root vitest `resolve.alias` (Rule 2 / Story 3.0), so no package dependency is implied.
//
// The claims are parsed from a CLEARLY-DELIMITED sentinel block (AGENTBBS-README:BEGIN/END) so the
// README's prose — which mentions every tool name and command in passing — cannot false-positive
// (Rule 10). The block is an HTML comment, so it does not render in the README; it is the
// machine-readable mirror of the human-facing instructions right above it.
//
// Mutation-tested non-vacuous (Rule 7): drifting any pinned value in the sentinel block (a wrong bin
// name, `AGENTBBS_DB` → `AGENTBBS_DATABASE`, tool-count 17 → 16, dropping `ui`) turns the matching
// assertion RED; reverting restores green.
//
// QA hardening (Rule 18 / the Epic-8 call-form blind spot): the sentinel block is the machine-readable
// MIRROR of the instructions — but an outside developer COPY-PASTES the VISIBLE prose/code-fences, not
// the HTML comment. A drift in only the visible surface (e.g. the MCP-client config fence's
// `"command": "agentbbs-mcp-server"` renamed to a bin that does not exist, while the sentinel stays
// correct) would send the developer to a non-existent bin yet leave the sentinel-only guard GREEN
// (empirically proven by the QA stage). So in ADDITION to pinning the sentinel values to the code, we
// assert the VISIBLE README (everything OUTSIDE the sentinel comment) actually USES each machine token
// in the form a reader invokes it: the bins, the db env var, and every subcommand as `agentbbs <sub>`.
// This closes the call-form gap — a prose-only rename now turns the guard RED.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DB_PATH_ENV } from '@agentbbs/data-access';
import { SUBCOMMAND_NAMES } from '@agentbbs/cli';
import type { DataAccess } from '@agentbbs/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createBoardServer } from './server.js';

// This test file is at `packages/mcp-server/src/`; three levels up is the repo root.
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const README_PATH = join(REPO_ROOT, 'README.md');

const BLOCK_BEGIN = 'AGENTBBS-README:BEGIN';
const BLOCK_END = 'AGENTBBS-README:END';

/** Read a `bin` field from a package's package.json. */
function readBin(relPkgDir: string): Record<string, string> {
  const m = JSON.parse(
    readFileSync(join(REPO_ROOT, relPkgDir, 'package.json'), 'utf8'),
  ) as { bin?: Record<string, string> };
  return m.bin ?? {};
}

/**
 * Parse the README's sentinel-delimited machine-relevant block into a map of `key → value`.
 * Each interior line is `- key: value`; the surrounding prose / comment framing is ignored. A
 * comma-separated value (the subcommands) is returned verbatim — callers split it.
 */
function parseReadmeClaims(readme: string): Map<string, string> {
  const begin = readme.indexOf(BLOCK_BEGIN);
  const end = readme.indexOf(BLOCK_END);
  expect(
    begin,
    `README must contain the ${BLOCK_BEGIN} sentinel`,
  ).toBeGreaterThanOrEqual(0);
  expect(end, `README must contain the ${BLOCK_END} sentinel`).toBeGreaterThan(
    begin,
  );

  const between = readme.slice(begin + BLOCK_BEGIN.length, end);
  const claims = new Map<string, string>();
  for (const raw of between.split('\n')) {
    const match = /^\s*-\s*([a-z][a-z-]*)\s*:\s*(.+?)\s*$/.exec(raw);
    if (match) {
      claims.set(match[1], match[2]);
    }
  }
  return claims;
}

/**
 * The VISIBLE README: the document with the machine-readable sentinel comment removed. This is the
 * copy-paste surface an outside developer reads (prose + code fences) — the assertions that the
 * machine tokens are actually USED here (not just mirrored in the comment) run against this, so a
 * prose-only drift cannot hide behind a correct sentinel block.
 */
function visibleReadme(readme: string): string {
  const begin = readme.indexOf(BLOCK_BEGIN);
  const end = readme.indexOf(BLOCK_END);
  if (begin < 0 || end < 0) return readme;
  // Drop from the opening `<!--` of the sentinel comment through its closing `-->`.
  const commentStart = readme.lastIndexOf('<!--', begin);
  const commentEnd = readme.indexOf('-->', end);
  const from = commentStart >= 0 ? commentStart : begin;
  const to =
    commentEnd >= 0 ? commentEnd + '-->'.length : end + BLOCK_END.length;
  return readme.slice(0, from) + readme.slice(to);
}

/** Escape a string for safe embedding in a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A fake DataAccess whose methods throw if touched — `listTools()` is a pure discovery call that
// never reads persistence (mirrors tool-contract.drift.test.ts).
function fakeDataAccess(): DataAccess {
  const unused = (name: string) => (): never => {
    throw new Error(
      `fakeDataAccess.${name} should not be called by listTools()`,
    );
  };
  return {
    append: unused('append'),
    appendGuarded: unused('appendGuarded'),
    eventsSince: unused('eventsSince'),
    eventsByType: unused('eventsByType'),
    eventsByActor: unused('eventsByActor'),
    maxSeq: unused('maxSeq'),
    getCursor: unused('getCursor'),
    setCursor: unused('setCursor'),
  };
}

describe('README content-guard (AC6, Rule 10)', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const claims = parseReadmeClaims(readme);

  const disposers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (disposers.length > 0) {
      await disposers.pop()?.();
    }
  });

  async function registeredToolCount(): Promise<number> {
    const server = createBoardServer({ dataAccess: fakeDataAccess() });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'readme-guard-test', version: '0.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    disposers.push(async () => {
      await client.close();
      await server.close();
    });
    const { tools } = await client.listTools();
    return tools.length;
  }

  it('the mcp-server bin name matches the mcp-server package `bin` field', () => {
    const documented = claims.get('mcp-server-bin');
    expect(
      documented,
      'sentinel block must declare mcp-server-bin',
    ).toBeDefined();
    const binNames = Object.keys(readBin('packages/mcp-server'));
    expect(binNames).toContain(documented);
    expect(documented).toBe('agentbbs-mcp-server');
  });

  it('the cli bin name matches the cli package `bin` field', () => {
    const documented = claims.get('cli-bin');
    expect(documented, 'sentinel block must declare cli-bin').toBeDefined();
    const binNames = Object.keys(readBin('packages/cli'));
    expect(binNames).toContain(documented);
    expect(documented).toBe('agentbbs');
  });

  it('the db env var matches DB_PATH_ENV from @agentbbs/data-access', () => {
    const documented = claims.get('db-env');
    expect(documented).toBe(DB_PATH_ENV);
  });

  it('the documented subcommands equal the cli dispatch table (SUBCOMMAND_NAMES)', () => {
    const documented = (claims.get('cli-subcommands') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect([...documented].sort()).toEqual([...SUBCOMMAND_NAMES].sort());
  });

  it('the documented MCP tool count equals the live registered tool set', async () => {
    const documented = Number(claims.get('mcp-tool-count'));
    const live = await registeredToolCount();
    expect(documented).toBe(live);
    // Sanity floor: the ratified surface is 17 tools (same pin as tool-contract.drift.test.ts).
    expect(live).toBe(17);
  });

  // --- Rule-18 / call-form: the VISIBLE copy-paste surface must USE the pinned tokens, not just
  // mirror them in the sentinel comment. A prose-only drift (wrong bin in the config fence, a renamed
  // subcommand in a code fence) must turn the guard RED. ---
  const visible = visibleReadme(readme);

  it('the MCP-client config fence `"command"` value IS the mcp-server bin (the literal copy-pasted invocation)', () => {
    const bin = claims.get('mcp-server-bin');
    expect(bin).toBeDefined();
    // The README ships a ready-to-paste MCP-client config: `"command": "<bin>"`. THAT string is what
    // a reader's client actually executes — it must be the real bin. Extract every `"command": "..."`
    // value from the visible body and assert at least one is the mcp-server bin AND none names a
    // different `agentbbs-*` server bin (a prose-only rename here, with a correct sentinel, would
    // otherwise point the client at a non-existent binary yet pass — proven at the QA stage).
    const commands = [...visible.matchAll(/"command"\s*:\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(
      commands.length,
      'visible README must carry an MCP-client `"command"` config example',
    ).toBeGreaterThan(0);
    expect(commands).toContain(bin);
    // No `agentbbs-*` command value may be anything OTHER than the real bin (catches a typo'd rename).
    for (const cmd of commands) {
      if (/^agentbbs/.test(cmd)) {
        expect(
          cmd,
          `MCP-client \`command\` "${cmd}" must be the real bin`,
        ).toBe(bin);
      }
    }
  });

  it('the visible README actually invokes the cli bin (`agentbbs`)', () => {
    const bin = claims.get('cli-bin');
    expect(bin).toBeDefined();
    // `agentbbs` is a substring of `agentbbs-mcp-server`, so require a call/word boundary form the
    // README uses (`agentbbs ui`, `agentbbs export`, …) — a bare token-boundary match would also be
    // satisfied by the mcp-server bin. Require `agentbbs` followed by a space + a subcommand.
    expect(visible).toMatch(
      new RegExp(`\\b${escapeRe(bin as string)}\\s+[a-z]`),
    );
  });

  it('the visible README actually shows the db env var (AGENTBBS_DB)', () => {
    const env = claims.get('db-env');
    expect(env).toBeDefined();
    expect(visible).toMatch(new RegExp(`\\b${escapeRe(env as string)}\\b`));
  });

  it('the visible README invokes EVERY cli subcommand as `agentbbs <sub>` (drift in any one → RED)', () => {
    const bin = claims.get('cli-bin') ?? 'agentbbs';
    for (const sub of SUBCOMMAND_NAMES) {
      // Each subcommand must appear as an actual `agentbbs <sub>` invocation in the visible body
      // (the run-the-UI / export / import fences). A subcommand renamed or dropped from the visible
      // instructions — while the dispatch table still carries it — turns this RED.
      expect(visible, `visible README must show \`${bin} ${sub}\``).toMatch(
        new RegExp(`\\b${escapeRe(bin)}\\s+${escapeRe(sub)}\\b`),
      );
    }
  });

  it('the README prose must NOT reintroduce the stale "12 tools" claim (reconciliation #2)', () => {
    // The headline drift this story exists to prevent. A bare "12 tools"/"12-tool" anywhere in the
    // README is the Epic-7-class regression; the surface is 17.
    expect(readme).not.toMatch(/\b12[\s-]tools?\b/i);
    expect(readme).not.toMatch(/\b12-tool\b/i);
  });
});
