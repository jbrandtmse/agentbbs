// Tests for the `agentbbs ui` subcommand (Story 9.3, Task 4 / AC #1).
//
// Covers the arg parser (port/db, inline + spaced forms, validation) and the runUi
// lifecycle against a REAL createDataAccess SQLite temp ledger: it opens the ledger,
// starts the host on an ephemeral port, serves the JSON API over real HTTP, and stops
// cleanly (no leaked server/DB). Nothing mocked.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addParticipant,
  announceProject,
  postAnnouncement,
  register,
  reply,
} from '@agentbbs/core';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseUiArgs, resolveOperatorHandle, runUi } from './ui.js';

describe('parseUiArgs', () => {
  it('parses --port and --db in spaced + inline forms', () => {
    expect(parseUiArgs(['--port', '3000'])).toEqual({ port: 3000 });
    expect(parseUiArgs(['--port=4100'])).toEqual({ port: 4100 });
    expect(parseUiArgs(['--db', '/tmp/x.db'])).toEqual({ dbPath: '/tmp/x.db' });
    expect(parseUiArgs(['--db=/tmp/y.db', '--port=0'])).toEqual({
      dbPath: '/tmp/y.db',
      port: 0,
    });
  });

  it('parses --as (operator handle) in spaced + inline forms', () => {
    expect(parseUiArgs(['--as', 'ops'])).toEqual({ operatorHandle: 'ops' });
    expect(parseUiArgs(['--as=ops'])).toEqual({ operatorHandle: 'ops' });
    expect(parseUiArgs(['--port=0', '--as', 'jordan'])).toEqual({
      port: 0,
      operatorHandle: 'jordan',
    });
  });

  it('throws on an invalid --port', () => {
    expect(() => parseUiArgs(['--port', 'abc'])).toThrow(/Invalid --port/);
    expect(() => parseUiArgs(['--port=99999'])).toThrow(/Invalid --port/);
  });

  it('ignores unknown flags (forward-compatible)', () => {
    expect(parseUiArgs(['--future', 'x'])).toEqual({});
  });
});

describe('resolveOperatorHandle', () => {
  it('canonicalizes to lowercase + trims', () => {
    expect(resolveOperatorHandle('Ops')).toBe('ops');
    expect(resolveOperatorHandle('  Jordan  ')).toBe('jordan');
  });

  it('returns null for undefined / blank (watching-only)', () => {
    expect(resolveOperatorHandle(undefined)).toBeNull();
    expect(resolveOperatorHandle('')).toBeNull();
    expect(resolveOperatorHandle('   ')).toBeNull();
  });
});

// QA equivalence matrix (Story 13.5) — the cli wrapper (`resolveOperatorHandle(raw)`) is a thin
// delegate to the shared `@agentbbs/core` `canonicalizeOperatorHandle`. This asserts the cli
// surface reproduces the DOCUMENTED pre-refactor operator-handle behavior across the canonical
// + edge cases, so the refactor introduced no drift on the web-host side. The table is the same
// behavior spec pinned in `packages/core/src/identity/operator-handle.test.ts`
// (OPERATOR_HANDLE_EQUIVALENCE_MATRIX) and in the extension's operator-handle test — duplicated
// as a SPEC, not imported, because the eslint leaf-app boundary forbids one file importing all
// three wrappers. Keep the copies identical. The cli wrapper's signature is `string | undefined`
// (it takes a single raw already merged from `--as ?? AGENTBBS_OPERATOR` at the call site); the
// `null` input row of the core matrix is therefore not part of the cli wrapper's contract and is
// omitted here.
const CLI_OPERATOR_HANDLE_MATRIX: ReadonlyArray<
  readonly [input: string | undefined, expected: string | null]
> = [
  ['alice', 'alice'], // already-canonical passthrough
  ['BOB', 'bob'], // mixed/upper → lowercased
  ['  Alice ', 'alice'], // leading + trailing space trimmed, lowercased
  ['\tAlice\n', 'alice'], // tab + newline whitespace trimmed
  [' \t \n MixedCase \r\n ', 'mixedcase'], // assorted whitespace trimmed, lowercased
  ['  Two Words  ', 'two words'], // internal whitespace PRESERVED
  ['a\tb', 'a\tb'], // internal tab preserved
  ['', null], // empty
  ['   ', null], // spaces-only
  ['\t\n\r ', null], // mixed-whitespace-only
  [undefined, null], // undefined
];

describe('resolveOperatorHandle — pre-refactor equivalence matrix (cli surface)', () => {
  it.each(CLI_OPERATOR_HANDLE_MATRIX)(
    'resolveOperatorHandle(%o) === %o',
    (input, expected) => {
      expect(resolveOperatorHandle(input)).toBe(expected);
    },
  );

  it('preserves internal whitespace (trims ends only)', () => {
    expect(resolveOperatorHandle('  Two   Words  ')).toBe('two   words');
  });
});

describe('runUi — lifecycle against a real ledger', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentbbs-ui-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts the host on an ephemeral port, serves the API, and stops cleanly', async () => {
    const logs: string[] = [];
    const { url, port, stop } = await runUi(
      { port: 0, dbPath: join(dir, 'agentbbs.db') },
      { log: (line) => logs.push(line) },
    );
    try {
      expect(port).toBeGreaterThan(0);
      expect(url).toContain(`:${port}`);
      // The URL + the on-demand notice are printed.
      expect(logs.join('\n')).toContain(url);
      expect(logs.join('\n')).toMatch(/on-demand/i);

      // The JSON API serves real (empty) board state over HTTP.
      const res = await fetch(`${url}/api/directory`);
      expect(res.status).toBe(200);
      expect((await res.json()) as { projects: unknown[] }).toEqual({
        projects: [],
      });
    } finally {
      await stop();
    }

    // After stop, the port is released — a follow-up fetch fails to connect.
    await expect(fetch(`${url}/api/directory`)).rejects.toBeDefined();
  });

  it('serves /api/me + NEEDS YOU for the configured operator over real HTTP (Story 9.4)', async () => {
    const dbPath = join(dir, 'agentbbs.db');
    // Seed a real ledger: ops is pulled into one room; another room stays quiet.
    const seed = createDataAccess({ dbPath });
    try {
      await register(seed, { handle: 'alice', currentFocus: 'init' });
      await register(seed, { handle: 'ops', currentFocus: 'watching' });
      await announceProject(seed, 'alice', {
        title: 'Calling Interface',
        description: 'How agents dial in.',
      });
      const room = await postAnnouncement(seed, 'alice', {
        projectId: 'calling-interface',
        subject: 'Need ops',
        body: 'pulling ops in',
      });
      await reply(seed, 'alice', { roomId: room.roomId, body: 'starting' });
      await addParticipant(seed, 'alice', {
        roomId: room.roomId,
        handle: 'ops',
      });
      // A quiet room ops was never added to.
      await postAnnouncement(seed, 'alice', {
        projectId: 'calling-interface',
        subject: 'Quiet',
        body: 'nobody pulls ops in',
      });
    } finally {
      seed.close();
    }

    const { url, stop } = await runUi(
      { port: 0, dbPath, operatorHandle: 'OPS' },
      { log: () => {} },
    );
    try {
      const me = (await (await fetch(`${url}/api/me`)).json()) as {
        handle: string | null;
      };
      expect(me.handle).toBe('ops'); // canonicalized from "OPS"

      const needsYou = (await (await fetch(`${url}/api/needs-you`)).json()) as {
        rooms: { subject: string }[];
      };
      expect(needsYou.rooms).toHaveLength(1);
      expect(needsYou.rooms[0].subject).toBe('Need ops');
    } finally {
      await stop();
    }
  });
});
