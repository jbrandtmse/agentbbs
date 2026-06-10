// Tests for the `agentbbs` CLI dispatch + the Story-11.1 export/import scaffold.
//
// `dispatch(argv, write)` is injectable via its `write` sink (no process spawn). The
// scaffold handlers set `process.exitCode` as a side effect, so each case that exercises
// an exit code captures + RESETS `process.exitCode` to avoid bleeding into sibling cases
// (and into the rest of the suite). Nothing is mocked beyond the injected sinks.

import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Shared test-only temp-dir helper (Story 13.1). Relative import — NOT a published barrel
// export, so nothing ships in any package's public dist/exports (Rule 13). The robust
// retry/swallow removal (vs the prior naive `rmSync` with no maxRetries) is the
// `E12-postmerge` Windows temp-dir teardown-flake fix.
import { makeTempDir, removeTempDir } from '../../../test/support/temp-dir.js';

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
    const dir = makeTempDir('agentbbs-export-dispatch-');
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
      removeTempDir(dir);
    }
  });

  it('import is recognized (NOT "Unknown command") — routes to importCommand + exits 1 on a bad in-path', async () => {
    // `import` is dispatch-reachable: it routes to importCommand (NOT the unknown-command path).
    // We point it at a NON-EXISTENT archive file (in a fresh temp dir) so it fails cleanly
    // (clear error to its stderr sink + exit 1) WITHOUT reading the real stdin or touching the
    // repo's ledger. The real replay/round-trip behavior is covered in import.test.ts; this only
    // asserts dispatch routing + the error contract. Note: importCommand writes to its own
    // stderr default (process.stderr), so the dispatch `write` sink stays empty here — the
    // routing proof is that the unknown-command path was NOT taken and exitCode is 1.
    const dir = makeTempDir('agentbbs-import-dispatch-');
    try {
      const sink = makeSink();
      await dispatch(
        [
          'import',
          join(dir, 'no-such-archive.ndjson'),
          '--db',
          join(dir, 'agentbbs.db'),
        ],
        sink.write,
      );
      // The dispatch sink (stdout) must NOT carry the unknown-command path.
      expect(sink.lines.join('\n')).not.toContain('Unknown command');
      expect(process.exitCode).toBe(1);
    } finally {
      removeTempDir(dir);
    }
  });

  it('exportCommand writes a header-first NDJSON archive (empty board) + exits 0', async () => {
    const dir = makeTempDir('agentbbs-export-empty-');
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
      removeTempDir(dir);
    }
  });

  it('exportCommand reports a clear error + non-zero exit when the out-path is unwritable', async () => {
    const dir = makeTempDir('agentbbs-export-badpath-');
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
      removeTempDir(dir);
    }
  });

  it('importCommand reports a clear error + non-zero exit on a malformed archive (nothing appended)', async () => {
    // Feed a malformed archive (not a valid header) via the injected stdin reader so the parse
    // gate rejects BEFORE any ledger work. The error contract: a clear "failed" message on the
    // (injected) log sink + exitCode 1. The DB is a fresh temp path that is never created
    // because the parse fails first.
    const dir = makeTempDir('agentbbs-import-malformed-');
    try {
      const log: string[] = [];
      await importCommand(['-', '--db', join(dir, 'agentbbs.db')], {
        log: (line) => log.push(line),
        readStdin: () => 'this is not a valid NDJSON archive\n',
      });
      expect(process.exitCode).toBe(1);
      expect(log.join('\n')).toMatch(/failed/i);
    } finally {
      removeTempDir(dir);
    }
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
