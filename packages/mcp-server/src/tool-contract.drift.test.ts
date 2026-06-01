// Drift-guard for the agent-facing MCP tool contract (Story 7.0, AC #2).
//
// `docs/mcp-tool-contract.md` is the ratified, versioned description of the tool surface — the
// tool names, params, result envelopes, and the closed error-code / event vocabularies. A doc can
// rot the instant the code moves: a new or renamed tool, or a new error code, that ships without a
// matching doc edit makes the contract silently lie. This test makes the contract SELF-ENFORCING.
//
// It pins THREE things against the REAL code (not a hand-copy):
//   (1) The canonical tool-name list in the doc (the fenced AGENTBBS-TOOL-CONTRACT block, §6) EQUALS
//       the set of tools the REAL `McpServer` registers — derived at runtime by connecting a real
//       `Client` and calling `listTools()` (skill-rules Rule 3: real-runtime evidence, mirroring
//       `server.bootstrap.test.ts`'s exhaustive assertion, NOT a constant copied into the test).
//   (2) The error codes documented in the doc's closed-set table (§4) EQUAL `BOARD_ERROR_CODES`
//       (the single runtime source of truth in `@agentbbs/core`).
//   (3) The event types documented in the doc's closed-vocabulary table (§5) EQUAL `EVENT_TYPES`
//       (the single runtime source of truth in `@agentbbs/core`). The event vocabulary is a CLOSED,
//       versioned wire/export contract just like the error set — a renamed/added/removed type that
//       ships without a §5 doc edit makes the contract silently lie (QA addition, Story 7.0).
//
// So adding / removing / renaming a tool, an error code, or an event type without updating
// `docs/mcp-tool-contract.md` FAILS this gate. The parse targets are deliberately simple +
// clearly-delimited: tool names live one-per-line between sentinel markers; error codes / event
// types are the first backticked cell of each row in the §4 / §5 table respectively.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BOARD_ERROR_CODES, EVENT_TYPES } from '@agentbbs/core';
import type { DataAccess } from '@agentbbs/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createBoardServer } from './server.js';

// The contract doc lives at the repo root under `docs/`. This test file is at
// `packages/mcp-server/src/`, so three levels up from its directory is the repo root. Resolving
// relative to `import.meta.url` (not `process.cwd()`) keeps the test correct regardless of where
// the suite is launched from.
const CONTRACT_DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'mcp-tool-contract.md',
);

// The sentinels delimiting the machine-readable canonical tool-name list (doc §6). Kept in lockstep
// with the markers written in `docs/mcp-tool-contract.md`.
const TOOL_LIST_BEGIN = '# AGENTBBS-TOOL-CONTRACT:BEGIN';
const TOOL_LIST_END = '# AGENTBBS-TOOL-CONTRACT:END';

/**
 * Read the contract doc from disk. A separate helper so a missing/renamed doc fails loudly with a
 * clear message rather than an opaque ENOENT mid-assertion.
 */
function readContractDoc(): string {
  try {
    return readFileSync(CONTRACT_DOC_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the MCP tool contract at ${CONTRACT_DOC_PATH}. ` +
        `Story 7.0 requires docs/mcp-tool-contract.md to exist (it is the ratified, drift-guarded ` +
        `tool contract).`,
      { cause },
    );
  }
}

/**
 * Parse the canonical tool-name list out of the doc: every non-blank line strictly BETWEEN the
 * BEGIN/END sentinels, with the sentinel lines themselves excluded. The block holds one bare tool
 * name per line, so the parse is a trim + drop-blanks — robust to surrounding prose moving.
 */
function parseDocumentedToolNames(doc: string): string[] {
  const begin = doc.indexOf(TOOL_LIST_BEGIN);
  const end = doc.indexOf(TOOL_LIST_END);
  expect(
    begin,
    `the contract doc must contain the ${TOOL_LIST_BEGIN} marker`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    end,
    `the contract doc must contain the ${TOOL_LIST_END} marker`,
  ).toBeGreaterThan(begin);

  const between = doc.slice(begin + TOOL_LIST_BEGIN.length, end);
  return between
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Parse the documented closed error-code set out of the §4 table: the FIRST backticked SCREAMING
 * _SNAKE token of each row in the section between the `## 4.` heading and the next `## ` heading.
 * Scoping to that section avoids picking up the inline `\`NO_IDENTITY\`` etc. mentioned in prose
 * elsewhere (§3 per-tool error lines), so the assertion is exactly "the §4 closed-set table".
 */
function parseDocumentedErrorCodes(doc: string): string[] {
  const lines = doc.split('\n');
  const startIndex = lines.findIndex((line) => /^##\s+4\.\s/.test(line.trim()));
  expect(
    startIndex,
    'the contract doc must contain a "## 4." closed-error-code section',
  ).toBeGreaterThanOrEqual(0);

  const codes: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    // Stop at the next level-2 heading — the §4 section has ended.
    if (/^##\s/.test(line.trim())) {
      break;
    }
    // A closed-set table row: the first cell is a single backticked SCREAMING_SNAKE code.
    const match = /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/.exec(line.trim());
    if (match) {
      codes.push(match[1]);
    }
  }
  return codes;
}

/**
 * Parse the documented closed event vocabulary out of the §5 table: the FIRST backticked
 * `noun.past_tense` token (dotted, lowercase) of each row in the section between the `## 5.`
 * heading and the next `## ` heading. Scoping to that section (and anchoring on a table-row `|`)
 * avoids the backticked event names mentioned in the §5 "Appended by" cells and the surrounding
 * prose / blockquote — so the assertion is exactly "the §5 closed-vocabulary table". Mirrors
 * {@link parseDocumentedErrorCodes}; the only difference is the token shape (dotted lowercase, not
 * SCREAMING_SNAKE).
 */
function parseDocumentedEventTypes(doc: string): string[] {
  const lines = doc.split('\n');
  const startIndex = lines.findIndex((line) => /^##\s+5\.\s/.test(line.trim()));
  expect(
    startIndex,
    'the contract doc must contain a "## 5." closed-event-vocabulary section',
  ).toBeGreaterThanOrEqual(0);

  const types: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    // Stop at the next level-2 heading — the §5 section has ended.
    if (/^##\s/.test(line.trim())) {
      break;
    }
    // A closed-vocabulary table row: the first cell is a single backticked noun.past_tense type.
    const match = /^\|\s*`([a-z]+\.[a-z_]+)`\s*\|/.exec(line.trim());
    if (match) {
      types.push(match[1]);
    }
  }
  return types;
}

// A fake DataAccess whose methods throw if touched — `listTools()` is a pure discovery call that
// never reads persistence, so any call here would signal an unintended coupling (mirrors the
// bootstrap test's fake). The contract surface is discoverable without a real ledger.
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

describe('docs/mcp-tool-contract.md drift guard', () => {
  const disposers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (disposers.length > 0) {
      await disposers.pop()?.();
    }
  });

  /**
   * Connect a real `Client` to a freshly-built `createBoardServer` over the SDK's in-memory
   * transport and return the live registered tool-name set via `listTools()`. This is the REAL
   * runtime surface (Rule 3), not a constant — the same production factory `main()` connects over
   * stdio.
   */
  async function registeredToolNames(): Promise<string[]> {
    const server = createBoardServer({ dataAccess: fakeDataAccess() });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'contract-drift-test',
      version: '0.0.0',
    });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    disposers.push(async () => {
      await client.close();
      await server.close();
    });
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name);
  }

  it('the documented canonical tool list (§6) equals the tools the real server registers', async () => {
    const documented = parseDocumentedToolNames(readContractDoc());
    const registered = await registeredToolNames();

    // Sorted-array equality pins the EXACT set both ways: a tool the server registers but the doc
    // omits (or vice versa) fails here. This is the contract-can't-silently-drift guarantee.
    expect([...documented].sort()).toEqual([...registered].sort());

    // Defensive: the doc list must have no duplicate names (a copy-paste slip would otherwise pass
    // the set comparison only by luck).
    expect(new Set(documented).size).toBe(documented.length);

    // Sanity floor: the ratified surface is the 17-tool Epic 2–6 surface. A drop below that is a
    // regression in either the doc or the server, not a benign edit.
    expect(registered.length).toBe(17);
  });

  it('the documented closed error-code set (§4) equals BOARD_ERROR_CODES', () => {
    const documented = parseDocumentedErrorCodes(readContractDoc());

    // Exact set equality against the single runtime source of truth — a new/renamed code without a
    // doc edit (or a documented code that no longer exists) fails here.
    expect([...documented].sort()).toEqual([...BOARD_ERROR_CODES].sort());

    // No duplicate rows in the table.
    expect(new Set(documented).size).toBe(documented.length);
  });

  it('the documented closed event vocabulary (§5) equals EVENT_TYPES', () => {
    const documented = parseDocumentedEventTypes(readContractDoc());

    // Exact set equality against the single runtime source of truth — a new/renamed event type
    // without a §5 doc edit (or a documented type that no longer exists) fails here. The event
    // vocabulary is a closed, versioned wire/export contract; this guard keeps §5 honest the same
    // way the §4 guard keeps the error set honest.
    expect([...documented].sort()).toEqual([...EVENT_TYPES].sort());

    // No duplicate rows in the table.
    expect(new Set(documented).size).toBe(documented.length);

    // Sanity floor: the ratified vocabulary is the closed 10-event set. Parsing far fewer would
    // mean the §5 table shape changed under the parser (a vacuous pass), not a benign edit.
    expect(documented.length).toBe(10);
  });
});
