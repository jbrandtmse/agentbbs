// The `agentbbs export` subcommand (Story 11.2) — dump the whole LOGICAL event ledger to a
// portable, human-inspectable NDJSON archive.
//
// `export` opens the shared SQLite ledger via @agentbbs/data-access (honoring
// AGENTBBS_DB / the project-root walk-up — the same discovery the MCP server + `ui` use),
// reads ALL events through the `DataAccess` port (`eventsSince(0)` — the seq-ordered total
// order), captures each identity's stored read-state cursor (AC3), serializes them to NDJSON
// via the shared archive codec (`archive.ts`), and writes the result to the output path (or
// stdout). It carries NO board logic (NFR2 / Rule 13): it reads through the port + serializes.
//
// Operator-only: `export` is NEVER exposed as an MCP tool (architecture.md:294). The archive
// describes the LOGICAL event model (the closed EVENT_TYPES vocabulary), not the SQLite file,
// so it survives the V1-SQLite → V2-HTTP-daemon backend swap (FR34 / NFR2).
//
// AC3 DESIGN DECISION (cursors / read-state) — see the long note in `archive.ts`: the
// per-identity `check` cursor is the append-invariant CARVE-OUT (a separate mutable table,
// NOT an event) and is NOT derivable from the event stream alone, so the archive CAPTURES it
// as a delimited read-state section. This makes the FR34 round-trip (Story 11.4 compares
// `cursors`) achievable and supersedes the ports.ts "NOT part of the FR32 export" sentence
// (a non-breaking, additive format choice; core stays byte-identical).

import { writeFileSync } from 'node:fs';

import { createDataAccess, resolveDbPath } from '@agentbbs/data-access';

import { serializeArchive } from './archive.js';

import type { ReadStateEntry } from './archive.js';
import type { DataAccessHandle } from '@agentbbs/data-access';

/** Parsed `agentbbs export` options. */
export interface ExportOptions {
  /** Explicit DB path (else AGENTBBS_DB / project-root discovery — see `resolveDbPath`). */
  dbPath?: string;
  /** Output archive path (positional; `-` / undefined → stdout). */
  outPath?: string;
}

/**
 * Parse `agentbbs export` args: `--db <path>` / `--db=<path>` and an optional output-path
 * positional. Minimal hand-rolled parsing (no CLI-framework dependency — mirrors
 * `parseUiArgs`). Unknown flags are ignored (forward-compatible). DB discovery is delegated
 * to `resolveDbPath` by the handler, exactly as `ui.ts` does.
 *
 * @param argv The args AFTER the `export` subcommand token.
 * @returns The parsed {@link ExportOptions}.
 */
export function parseExportArgs(argv: readonly string[]): ExportOptions {
  const options: ExportOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (inline: string | undefined): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        i++;
        return next;
      }
      return undefined;
    };
    if (arg === '--db' || arg.startsWith('--db=')) {
      const raw = takeValue(arg.startsWith('--db=') ? arg.slice(5) : undefined);
      if (raw !== undefined) options.dbPath = raw;
    } else if (!arg.startsWith('-')) {
      // The first bare token is the output-path positional.
      if (options.outPath === undefined) options.outPath = arg;
    }
  }
  return options;
}

/**
 * Read each identity's stored read-state cursor through the `DataAccess` port (AC3). The set
 * of handles is derived from the `identity.registered` events in the stream (every identity
 * appears exactly once); `getCursor` then reads each one. A cursor of `0` (the unset
 * sentinel — never `check`ed) is OMITTED: it is byte-equivalent to having no stored cursor,
 * so omitting it is lossless and keeps the archive lean. Reads through the port only — no SQL
 * (NFR2 / Rule 13).
 *
 * @param dataAccess The open ledger handle.
 * @returns The non-zero stored cursors, in registration (`seq`) order.
 */
async function collectReadState(
  dataAccess: DataAccessHandle,
): Promise<ReadStateEntry[]> {
  const registrations = await dataAccess.eventsByType('identity.registered');
  const readState: ReadStateEntry[] = [];
  for (const event of registrations) {
    const handle = event.actor;
    const cursor = await dataAccess.getCursor(handle);
    if (cursor > 0) {
      readState.push({ handle, cursor });
    }
  }
  return readState;
}

/** Injection seam for {@link runExport} (testable without real stdio/files). */
export interface RunExportDeps {
  /** Where to print the success/diagnostic summary (defaults to process.stderr). */
  log?: (line: string) => void;
  /** Where to write the archive when no out-path is given (defaults to process.stdout). */
  out?: (text: string) => void;
  /** The export timestamp (ISO-8601 UTC). Injectable for deterministic tests. */
  exportedAt?: string;
}

/** The outcome of an {@link runExport}: where it wrote + the counts (for the summary/tests). */
export interface ExportResult {
  /** The output destination: the resolved out-path, or `'-'` for stdout. */
  destination: string;
  /** The number of events written. */
  eventCount: number;
  /** The number of read-state cursors written. */
  cursorCount: number;
}

/**
 * Run the export: open the ledger, read all events + read-state, serialize to NDJSON, and
 * write to the out-path (or stdout when omitted / `-`). Closes the ledger before returning.
 *
 * The DB path is resolved the same way the MCP server resolves it: an explicit `--db` wins,
 * else AGENTBBS_DB, else the project-root `.agentbbs/agentbbs.db` walk-up (`resolveDbPath`).
 *
 * An EMPTY board produces a valid header-only archive (zero events, zero cursors) — NOT an
 * error.
 *
 * @param options Parsed {@link ExportOptions}.
 * @param deps Injection seam (logger / stdout sink / timestamp).
 * @returns The {@link ExportResult} (destination + counts).
 */
export async function runExport(
  options: ExportOptions,
  deps: RunExportDeps = {},
): Promise<ExportResult> {
  const out = deps.out ?? ((text: string) => process.stdout.write(text));

  const dbPath = options.dbPath ?? resolveDbPath();
  const dataAccess: DataAccessHandle = createDataAccess({ dbPath });
  try {
    // Read through the port: the whole seq-ordered ledger + the stored read-state (AC3).
    const events = await dataAccess.eventsSince(0);
    const readState = await collectReadState(dataAccess);
    const text = serializeArchive({ events, readState }, deps.exportedAt);

    const outPath = options.outPath;
    if (outPath === undefined || outPath === '-') {
      out(text);
      return {
        destination: '-',
        eventCount: events.length,
        cursorCount: readState.length,
      };
    }
    writeFileSync(outPath, text, 'utf8');
    return {
      destination: outPath,
      eventCount: events.length,
      cursorCount: readState.length,
    };
  } finally {
    dataAccess.close();
  }
}

/**
 * The `agentbbs export` CLI entry: parse args, run the export, and print a one-line summary
 * (path + event count) to STDERR on success (exit 0). On failure (DB cannot be opened / the
 * out-path is unwritable) it reports a clear error to STDERR and sets a non-zero exit code.
 *
 * The summary goes to STDERR so that, when the archive is written to STDOUT (no out-path),
 * the summary does not corrupt the NDJSON on STDOUT.
 *
 * @param argv The args AFTER the `export` subcommand token.
 * @param deps Injection seam (logger / stdout sink / timestamp); defaults to real stdio.
 */
export async function exportCommand(
  argv: readonly string[],
  deps: RunExportDeps = {},
): Promise<void> {
  const log = deps.log ?? ((line: string) => process.stderr.write(line + '\n'));
  const options = parseExportArgs(argv);
  try {
    const result = await runExport(options, deps);
    const where = result.destination === '-' ? 'stdout' : result.destination;
    log(
      `agentbbs export: wrote ${result.eventCount} event(s) + ` +
        `${result.cursorCount} read-state cursor(s) to ${where}.`,
    );
  } catch (error: unknown) {
    log(
      `agentbbs export: failed — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
