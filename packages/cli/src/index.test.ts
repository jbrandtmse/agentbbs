// Tests for the `agentbbs` CLI dispatch + the Story-11.1 export/import scaffold.
//
// `dispatch(argv, write)` is injectable via its `write` sink (no process spawn). The
// scaffold handlers set `process.exitCode` as a side effect, so each case that exercises
// an exit code captures + RESETS `process.exitCode` to avoid bleeding into sibling cases
// (and into the rest of the suite). Nothing is mocked beyond the injected sinks.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseArchive } from './archive.js';
import { dispatch } from './index.js';
import { exportCommand, parseExportArgs } from './export.js';
import { importCommand, parseImportArgs } from './import.js';

/** Capture lines a sink receives; pair with `dispatch`/command `write` injection. */
function makeSink(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

describe('dispatch — usage + help', () => {
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  it('lists export, import, and ui (in that order) for no command, exit code unset', async () => {
    const sink = makeSink();
    await dispatch([], sink.write);
    const out = sink.lines.join('\n');
    expect(out).toContain('export');
    expect(out).toContain('import');
    expect(out).toContain('ui');
    // Ordered sensibly: export, then import, then ui.
    expect(out.indexOf('export')).toBeLessThan(out.indexOf('import'));
    expect(out.indexOf('import')).toBeLessThan(out.indexOf('ui'));
    // No command (not an error) → no non-zero exit code set.
    expect(process.exitCode).toBeUndefined();
  });

  it('prints usage for --help and -h with exit code 0 (unset)', async () => {
    for (const flag of ['--help', '-h']) {
      const sink = makeSink();
      await dispatch([flag], sink.write);
      const out = sink.lines.join('\n');
      expect(out).toContain('export');
      expect(out).toContain('import');
      expect(out).toContain('ui');
      expect(process.exitCode).toBeUndefined();
    }
  });

  it('each command appears in usage with a one-line describe', async () => {
    const sink = makeSink();
    await dispatch(['--help'], sink.write);
    const out = sink.lines.join('\n');
    expect(out).toMatch(/export\s+.+/);
    expect(out).toMatch(/import\s+.+/);
    expect(out).toMatch(/ui\s+.+/);
  });
});

describe('dispatch — unknown command', () => {
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  it('writes "Unknown command: <name>" + usage and sets exitCode 1', async () => {
    const sink = makeSink();
    await dispatch(['frobnicate'], sink.write);
    const out = sink.lines.join('\n');
    expect(out).toContain('Unknown command: frobnicate');
    // Usage still follows.
    expect(out).toContain('export');
    expect(out).toContain('ui');
    expect(process.exitCode).toBe(1);
  });
});

describe('dispatch — export (real, Story 11.2) / import scaffold (recognized subcommands)', () => {
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  it('export is recognized (NOT "Unknown command")', async () => {
    // Point at a fresh temp DB (an empty board → header-only archive) so the dispatch test
    // never touches the repo's real ledger; capture the NDJSON via an injected `out` sink.
    const dir = mkdtempSync(join(tmpdir(), 'agentbbs-export-dispatch-'));
    try {
      const sink = makeSink();
      // `export` is dispatch-reachable: it routes to exportCommand (NOT the unknown-command
      // path). Pointed at a fresh temp DB so it never touches the repo's real ledger. The
      // real archive/round-trip behavior is covered in export.test.ts; this only asserts
      // dispatch routing.
      await dispatch(['export', '--db', join(dir, 'agentbbs.db')], sink.write);
      // The dispatch sink (stdout) must NOT carry the unknown-command path.
      expect(sink.lines.join('\n')).not.toContain('Unknown command');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('import is recognized (NOT "Unknown command") and sets exitCode 1', async () => {
    const sink = makeSink();
    await dispatch(['import'], sink.write);
    expect(sink.lines.join('\n')).not.toContain('Unknown command');
    expect(process.exitCode).toBe(1);
  });

  it('exportCommand writes a header-first NDJSON archive (empty board) + exits 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentbbs-export-empty-'));
    try {
      const log: string[] = [];
      const out: string[] = [];
      await exportCommand(['--db', join(dir, 'agentbbs.db')], {
        log: (line) => log.push(line),
        out: (text) => out.push(text),
        exportedAt: '2026-06-05T00:00:00.000Z',
      });
      // Empty board → a valid header-only archive (NOT an error), success summary on stderr.
      expect(process.exitCode).toBeUndefined();
      const archive = parseArchive(out.join(''));
      expect(archive.header.agentbbs_archive).toBe(1);
      expect(archive.events).toEqual([]);
      expect(archive.readState).toEqual([]);
      expect(log.join('\n')).toMatch(/wrote 0 event/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exportCommand reports a clear error + non-zero exit when the out-path is unwritable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentbbs-export-badpath-'));
    try {
      const log: string[] = [];
      // An out-path inside a non-existent directory → writeFileSync fails (ENOENT).
      await exportCommand(
        [
          join(dir, 'no-such-subdir', 'out.ndjson'),
          '--db',
          join(dir, 'agentbbs.db'),
        ],
        { log: (line) => log.push(line) },
      );
      expect(process.exitCode).toBe(1);
      expect(log.join('\n')).toMatch(/failed/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('importCommand writes the inert Story-11.3 message to its (stderr) sink + exitCode 1', async () => {
    const sink = makeSink();
    await importCommand([], sink.write);
    const out = sink.lines.join('\n');
    expect(out).toMatch(/not yet implemented/i);
    expect(out).toContain('Story 11.3');
    expect(process.exitCode).toBe(1);
  });
});

describe('export/import arg-parse seam (mirrors parseUiArgs)', () => {
  it('parseExportArgs parses --db (spaced + inline) and an output positional', () => {
    expect(parseExportArgs(['--db', '/tmp/x.db'])).toEqual({
      dbPath: '/tmp/x.db',
    });
    expect(parseExportArgs(['--db=/tmp/y.db'])).toEqual({
      dbPath: '/tmp/y.db',
    });
    expect(parseExportArgs(['out.ndjson', '--db=/tmp/y.db'])).toEqual({
      dbPath: '/tmp/y.db',
      outPath: 'out.ndjson',
    });
  });

  it('parseExportArgs ignores unknown flags (forward-compatible)', () => {
    // An unknown flag is dropped; a following bare token is still the positional.
    expect(parseExportArgs(['--future'])).toEqual({});
    expect(parseExportArgs(['--db=/tmp/x.db', '--future'])).toEqual({
      dbPath: '/tmp/x.db',
    });
  });

  it('parseImportArgs parses --db (spaced + inline) and an input positional', () => {
    expect(parseImportArgs(['--db', '/tmp/x.db'])).toEqual({
      dbPath: '/tmp/x.db',
    });
    expect(parseImportArgs(['--db=/tmp/y.db'])).toEqual({
      dbPath: '/tmp/y.db',
    });
    expect(parseImportArgs(['in.ndjson', '--db=/tmp/y.db'])).toEqual({
      dbPath: '/tmp/y.db',
      inPath: 'in.ndjson',
    });
  });

  it('parseImportArgs ignores unknown flags (forward-compatible)', () => {
    // An unknown flag is dropped; a following bare token is still the positional.
    expect(parseImportArgs(['--future'])).toEqual({});
    expect(parseImportArgs(['--db=/tmp/x.db', '--future'])).toEqual({
      dbPath: '/tmp/x.db',
    });
  });
});
