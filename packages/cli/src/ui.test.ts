// Tests for the `agentbbs ui` subcommand (Story 9.3, Task 4 / AC #1).
//
// Covers the arg parser (port/db, inline + spaced forms, validation) and the runUi
// lifecycle against a REAL createDataAccess SQLite temp ledger: it opens the ledger,
// starts the host on an ephemeral port, serves the JSON API over real HTTP, and stops
// cleanly (no leaked server/DB). Nothing mocked.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseUiArgs, runUi } from './ui.js';

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

  it('throws on an invalid --port', () => {
    expect(() => parseUiArgs(['--port', 'abc'])).toThrow(/Invalid --port/);
    expect(() => parseUiArgs(['--port=99999'])).toThrow(/Invalid --port/);
  });

  it('ignores unknown flags (forward-compatible)', () => {
    expect(parseUiArgs(['--future', 'x'])).toEqual({});
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
});
