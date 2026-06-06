// REAL-RUNTIME (Rule 3) evidence for the `agentbbs` operator binary — the Story-11.1
// deliverable. The dispatch-level unit tests (`index.test.ts`) inject a `write` sink and
// capture `process.exitCode` in-process: correct + fast, but they STRUCTURALLY cannot
// prove three load-bearing facts about the real CLI surface:
//
//   (1) the REAL process exit code (a `process.exitCode = 1` side effect only becomes an
//       actual non-zero exit when the real `node` process drains and exits — the unit test
//       reads the variable, not the exit status the operator's shell sees);
//   (2) STREAM ROUTING — the AC2 unknown-command path writes usage to STDOUT; the Story-11.2
//       `export` writes the NDJSON archive to STDOUT and its summary to STDERR (so the summary
//       never corrupts the STDOUT NDJSON); the still-inert `import` scaffold writes its "not
//       yet implemented" message to STDERR. The unit tests inject ONE sink per call, so they
//       cannot witness that these paths land on the correct real streams;
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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  announceProject,
  check,
  postAnnouncement,
  reply,
  register,
} from '@agentbbs/core';
import { createDataAccess } from '@agentbbs/data-access';
import { describe, expect, it } from 'vitest';

import { parseArchive } from './archive.js';

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

  // The marquee Story-11.2 real-runtime assertion: `export` (no out-path) writes the NDJSON
  // archive to STDOUT, its one-line SUMMARY to STDERR (so the summary never corrupts the
  // STDOUT NDJSON), and exits 0. Pointed at a FRESH temp DB (an empty board → header-only
  // archive) so the spawn never touches the repo's real ledger.
  it('`export --db <fresh>` writes a header-first NDJSON archive to STDOUT, summary to STDERR, exit 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentbbs-export-spawn-'));
    try {
      const { code, stdout, stderr } = await runBin([
        'export',
        '--db',
        join(dir, 'agentbbs.db'),
      ]);
      expect(code).toBe(0);
      // STDOUT carries the NDJSON archive; its first line is the agentbbs_archive header.
      const firstLine = stdout.split('\n')[0]!;
      const header: unknown = JSON.parse(firstLine);
      expect((header as { agentbbs_archive?: number }).agentbbs_archive).toBe(
        1,
      );
      expect(stdout).not.toContain('Unknown command');
      // The one-line summary lands on STDERR (not STDOUT — it must not corrupt the NDJSON).
      expect(stderr).toMatch(/agentbbs export: wrote/i);
      expect(stderr).toMatch(/0 event/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // POPULATED real-runtime export (Rule 3 / QA goal 1): seed a REAL on-disk ledger with several
  // event types + a stored cursor, then SPAWN the built bin to export it to a FILE, and parse
  // that file back. This exercises the full real-process path against a non-empty board (the
  // empty-board spawn above only proves the header), proving the operator binary produces a
  // round-trippable archive of actual board data.
  it('`export <file> --db <seeded>` writes a populated archive a parser round-trips, exit 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentbbs-export-spawn-full-'));
    try {
      const dbPath = join(dir, 'agentbbs.db');
      // Seed a real ledger in-process, then CLOSE it so the spawned bin opens its own handle.
      const da = createDataAccess({ dbPath });
      let expectedSeqs: number[];
      try {
        await register(da, { handle: 'alice', currentFocus: 'kickoff' });
        await register(da, { handle: 'bob', currentFocus: 'helping' });
        const project = await announceProject(da, 'alice', {
          title: 'Calling Interface',
          description: 'Design it.',
        });
        const room = await postAnnouncement(da, 'alice', {
          projectId: project.projectId,
          subject: 'Need help',
          body: 'Who can help?',
        });
        await reply(da, 'bob', { roomId: room.roomId, body: 'I can.' });
        // alice replies AFTER bob so bob's check sees a message past his join floor → his stored
        // cursor is non-zero (a 0 cursor is the unset sentinel and would be omitted).
        await reply(da, 'alice', { roomId: room.roomId, body: 'thanks bob' });
        await check(da, 'bob'); // stores bob's read-state cursor
        expectedSeqs = (await da.eventsSince(0)).map((e) => e.seq);
      } finally {
        da.close();
      }
      expect(expectedSeqs.length).toBeGreaterThan(4);

      const outPath = join(dir, 'archive.ndjson');
      const { code, stderr } = await runBin([
        'export',
        outPath,
        '--db',
        dbPath,
      ]);
      expect(code).toBe(0);
      expect(stderr).toMatch(/agentbbs export: wrote/i);

      // Parse the file the REAL spawned process wrote and assert it carries the seeded ledger.
      const parsed = parseArchive(readFileSync(outPath, 'utf8'));
      expect(parsed.events.map((e) => e.seq)).toEqual(expectedSeqs);
      expect(parsed.header.event_count).toBe(expectedSeqs.length);
      // bob's stored cursor was captured as a read-state line.
      expect(parsed.readState).toEqual([
        { handle: 'bob', cursor: expect.any(Number) },
      ]);
      expect(parsed.readState[0]!.cursor).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Story 11.3 real-runtime (Rule 3): SPAWN the built bin to EXPORT a seeded ledger to a file,
  // then SPAWN it again to IMPORT that file into a FRESH empty board — a real-process export →
  // import round-trip across two `node` children. Asserts the imported board's events match the
  // source seq-for-seq (read back via a fresh in-process handle), the summary lands on STDERR,
  // exit 0. This exercises the whole replay path through the real binary, not just the unit seam.
  it('`import <file> --db <fresh>` replays an exported archive into an empty board, exit 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentbbs-import-spawn-'));
    try {
      const srcDb = join(dir, 'source.db');
      const destDb = join(dir, 'restored.db');
      const archivePath = join(dir, 'archive.ndjson');

      // Seed a real source ledger in-process, then CLOSE it so the spawned bins open their own.
      const da = createDataAccess({ dbPath: srcDb });
      let sourceEvents: { seq: number; type: string; actor: string }[];
      try {
        await register(da, { handle: 'alice', currentFocus: 'kickoff' });
        await register(da, { handle: 'bob', currentFocus: 'helping' });
        const project = await announceProject(da, 'alice', {
          title: 'Calling Interface',
          description: 'Design it.',
        });
        const room = await postAnnouncement(da, 'alice', {
          projectId: project.projectId,
          subject: 'Need help',
          body: 'Who can help?',
        });
        await reply(da, 'bob', { roomId: room.roomId, body: 'I can.' });
        await reply(da, 'alice', { roomId: room.roomId, body: 'thanks bob' });
        await check(da, 'bob'); // stores bob's read-state cursor
        sourceEvents = (await da.eventsSince(0)).map((e) => ({
          seq: e.seq,
          type: e.type,
          actor: e.actor,
        }));
      } finally {
        da.close();
      }

      // EXPORT the source to a file (real spawn).
      const exp = await runBin(['export', archivePath, '--db', srcDb]);
      expect(exp.code).toBe(0);

      // IMPORT the file into a FRESH empty board (real spawn).
      const imp = await runBin(['import', archivePath, '--db', destDb]);
      expect(imp.code).toBe(0);
      expect(imp.stderr).toMatch(/agentbbs import: replayed/i);
      expect(imp.stderr).toMatch(/restored 1 read-state cursor/i);
      expect(imp.stdout).toBe('');
      expect(imp.stderr).not.toContain('Unknown command');

      // Read the restored board back and assert it matches the source seq-for-seq.
      const restored = createDataAccess({ dbPath: destDb });
      try {
        const restoredEvents = (await restored.eventsSince(0)).map((e) => ({
          seq: e.seq,
          type: e.type,
          actor: e.actor,
        }));
        expect(restoredEvents).toEqual(sourceEvents);
        // The read-state cursor was restored.
        expect(await restored.getCursor('bob')).toBeGreaterThan(0);
      } finally {
        restored.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A non-empty target board is rejected by the real binary (AC2): clear error on STDERR, exit 1.
  it('`import <file> --db <non-empty>` is rejected (clear error on STDERR, exit 1)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentbbs-import-spawn-nonempty-'));
    try {
      const db = join(dir, 'agentbbs.db');
      const archivePath = join(dir, 'archive.ndjson');

      // Seed a board, export it to a file.
      const da = createDataAccess({ dbPath: db });
      try {
        await register(da, { handle: 'alice', currentFocus: 'kickoff' });
      } finally {
        da.close();
      }
      const exp = await runBin(['export', archivePath, '--db', db]);
      expect(exp.code).toBe(0);

      // Now import INTO THE SAME (non-empty) board → rejected.
      const { code, stdout, stderr } = await runBin([
        'import',
        archivePath,
        '--db',
        db,
      ]);
      expect(code).toBe(1);
      expect(stderr).toMatch(/agentbbs import: failed/i);
      expect(stderr).toMatch(/not empty/i);
      expect(stdout).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A failing export (an out-path inside a non-existent directory → unwritable) reports a
  // clear error on STDERR and exits non-zero (AC5).
  it('`export <unwritable-path>` reports a clear error on STDERR and exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentbbs-export-spawn-err-'));
    try {
      const { code, stdout, stderr } = await runBin([
        'export',
        join(dir, 'no-such-subdir', 'out.ndjson'),
        '--db',
        join(dir, 'agentbbs.db'),
      ]);
      expect(code).toBe(1);
      expect(stderr).toMatch(/agentbbs export: failed/i);
      expect(stdout).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
