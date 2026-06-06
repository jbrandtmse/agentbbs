// Tests for the `agentbbs` CLI dispatch + the Story-11.1 export/import scaffold.
//
// `dispatch(argv, write)` is injectable via its `write` sink (no process spawn). The
// scaffold handlers set `process.exitCode` as a side effect, so each case that exercises
// an exit code captures + RESETS `process.exitCode` to avoid bleeding into sibling cases
// (and into the rest of the suite). Nothing is mocked beyond the injected sinks.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

describe('dispatch — export/import scaffold (recognized subcommands, inert)', () => {
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  it('export is recognized (NOT "Unknown command") and sets exitCode 1', async () => {
    const sink = makeSink();
    await dispatch(['export'], sink.write);
    // The dispatch sink (stdout) must NOT carry the unknown-command path.
    expect(sink.lines.join('\n')).not.toContain('Unknown command');
    expect(process.exitCode).toBe(1);
  });

  it('import is recognized (NOT "Unknown command") and sets exitCode 1', async () => {
    const sink = makeSink();
    await dispatch(['import'], sink.write);
    expect(sink.lines.join('\n')).not.toContain('Unknown command');
    expect(process.exitCode).toBe(1);
  });

  it('exportCommand writes the inert Story-11.2 message to its (stderr) sink + exitCode 1', async () => {
    const sink = makeSink();
    await exportCommand([], sink.write);
    const out = sink.lines.join('\n');
    expect(out).toMatch(/not yet implemented/i);
    expect(out).toContain('Story 11.2');
    expect(process.exitCode).toBe(1);
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
