// REAL-RUNTIME (Rule 3) evidence for the `agentbbs` operator binary — the Story-11.1
// deliverable. The dispatch-level unit tests (`index.test.ts`) inject a `write` sink and
// capture `process.exitCode` in-process: correct + fast, but they STRUCTURALLY cannot
// prove three load-bearing facts about the real CLI surface:
//
//   (1) the REAL process exit code (a `process.exitCode = 1` side effect only becomes an
//       actual non-zero exit when the real `node` process drains and exits — the unit test
//       reads the variable, not the exit status the operator's shell sees);
//   (2) STREAM ROUTING — the AC2 unknown-command path writes usage to STDOUT, while the
//       AC3 export/import inert scaffold writes its "not yet implemented" message to
//       STDERR. The unit tests inject ONE sink per call, so they cannot witness that these
//       two recognized-vs-unknown paths land on DIFFERENT real streams (the honest-scaffold
//       contract: a deferred op signals on stderr + non-zero exit, distinct from a usage
//       dump on stdout);
//   (3) the shebang + `bin` mapping actually run `dispatch(process.argv.slice(2))` when the
//       file is executed directly as the binary.
//
// So this file SPAWNS the BUILT bin (`packages/cli/dist/index.js`, the `agentbbs` bin per
// packages/cli/package.json) as a real `node` child process and asserts on real stdout,
// stderr, and exit code — mirroring the spawn-the-real-binary pattern the mcp-server
// connection test uses. The bin is resolved from `import.meta.url` (NOT process.cwd()) so
// it is correct regardless of where the root `pnpm test` runs the suite.
//
// Build dependency: the bin is `dist/index.js`; the canonical root gate runs `pnpm run
// build` before `pnpm test`, so the dist is present. If the dist is missing the spawn
// fails loudly (a clear ENOENT / non-launch) rather than silently passing.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// This file is at `packages/cli/src/`, so the built bin is `../dist/index.js`.
const BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'index.js',
);

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn the built `agentbbs` bin with `args`, collect real stdout/stderr + exit code. */
function runBin(args: readonly string[]): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      // No env that would point the CLI at a real ledger; export/import are inert here.
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('agentbbs bin (real spawn) — Rule 3 real-runtime evidence', () => {
  it('the built bin exists (root gate builds dist before test)', () => {
    expect(existsSync(BIN)).toBe(true);
  });

  it('`--help` prints usage listing export/import/ui to STDOUT and exits 0', async () => {
    const { code, stdout, stderr } = await runBin(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: agentbbs');
    expect(stdout).toContain('export');
    expect(stdout).toContain('import');
    expect(stdout).toContain('ui');
    // Help is not an error → nothing on stderr.
    expect(stderr).toBe('');
  });

  it('no args prints usage to STDOUT and exits 0', async () => {
    const { code, stdout, stderr } = await runBin([]);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: agentbbs');
    expect(stderr).toBe('');
  });

  it('unknown command writes "Unknown command" + usage to STDOUT and exits 1', async () => {
    const { code, stdout, stderr } = await runBin(['frobnicate']);
    expect(code).toBe(1);
    // AC2 path lands on STDOUT (the dispatch `write` default), NOT stderr.
    expect(stdout).toContain('Unknown command: frobnicate');
    expect(stdout).toContain('Usage: agentbbs');
    expect(stderr).toBe('');
  });

  // The marquee real-runtime assertion: the AC3 honest-scaffold contract. `export`/`import`
  // are RECOGNIZED (no "Unknown command"), their inert message lands on STDERR (NOT stdout —
  // distinguishing them from the AC2 unknown-command usage dump), and the REAL process exit
  // code is non-zero.
  it('`export` is recognized: inert message on STDERR (stdout empty), real exit code 1', async () => {
    const { code, stdout, stderr } = await runBin(['export']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/not yet implemented/i);
    expect(stderr).toContain('Story 11.2');
    // Honest-scaffold contract: the message is on STDERR, and stdout carries NOTHING
    // (in particular NOT the unknown-command usage — export is a recognized subcommand).
    expect(stdout).toBe('');
    expect(stderr).not.toContain('Unknown command');
  });

  it('`import` is recognized: inert message on STDERR (stdout empty), real exit code 1', async () => {
    const { code, stdout, stderr } = await runBin(['import']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/not yet implemented/i);
    expect(stderr).toContain('Story 11.3');
    expect(stdout).toBe('');
    expect(stderr).not.toContain('Unknown command');
  });

  // The arg-parse seam does not change the inert outcome (Story 11.2/11.3 consume the seam).
  it('`export --db <path> out.ndjson` still exits 1 on STDERR (seam parsed, body inert)', async () => {
    const { code, stdout, stderr } = await runBin([
      'export',
      '--db',
      '/tmp/nonexistent.db',
      'out.ndjson',
    ]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/not yet implemented/i);
    expect(stdout).toBe('');
  });
});
