// The `agentbbs import` subcommand (Story 11.3) — restore a board by REPLAYING a portable
// NDJSON archive into an EMPTY board.
//
// `import` opens the shared SQLite ledger via @agentbbs/data-access (honoring AGENTBBS_DB /
// the project-root walk-up — the same discovery the MCP server + `ui` + `export` use), then:
//   1. GUARDS that the target board is EMPTY (`eventsSince(0)` length 0). A non-empty board is
//      REJECTED before anything is appended (avoids id collisions / double-replay; merge is out
//      of V1 scope — AC2). This is a CLI/OPERATOR-surface error, NOT a `BOARD_ERROR_CODE`: the
//      closed 10-code agent error set stays byte-identical (Rule 13; mirrors Epic-9's host-surface
//      `NO_OPERATOR`).
//   2. PARSES + VALIDATES the archive via the shared `archive.ts` codec
//      (`parseAndValidateArchive` — header version + every event `type` ∈ EVENT_TYPES +
//      read-state shape) BEFORE any append. Malformed → clear error + non-zero exit, nothing
//      appended (AC5; closes the Story-11.2-deferred "parse has no shape validation" item).
//   3. REPLAYS every event ATOMICALLY (Story 13.3) — three layers:
//        (a) PRE-REPLAY CONTIGUITY CHECK (the NOTHING-APPENDED phase, BEFORE opening the
//            ledger): after sorting by `seq`, assert the archived seqs are EXACTLY 1..N. A
//            mangled / non-contiguous archive is REJECTED here, before any append — so a corrupt
//            restore appends NOTHING (atomic). This is the LOAD-BEARING layer for atomicity: a
//            batched `append` COMMITS before any post-append seq check can run, so only a
//            pre-replay check guarantees nothing is written on a bad archive.
//        (b) SINGLE BATCHED APPEND: build the `NewEvent[]` (stripped to `type`/`actor`/`payload`)
//            and call `append(orderedNewEvents)` ONCE — the EXISTING `BEGIN IMMEDIATE`
//            transaction (ports.ts:55-64; proven atomic since Story 1.7) makes the WHOLE valid
//            replay all-or-nothing against any OTHER mid-batch failure (e.g. a DB error).
//        (c) POST-APPEND ASSERTION (defense-in-depth): assert each assigned `seq` reproduces the
//            archived `seq` 1:1. On a fresh empty board the AUTOINCREMENT yields 1..N, so the
//            pre-replay contiguity check already guarantees this — it is retained belt-and-braces
//            and fails loudly (AC4) if the invariant is ever violated.
//      An EMPTY archive (N=0) is valid (vacuously contiguous → header-only restore). A normal
//      `agentbbs export` archive is ALWAYS contiguous from seq 1, so the contiguity check is a
//      no-op on every real archive — only the corruption path changes (was: partial; now: empty).
//   4. RESTORES each read-state cursor via the EXISTING `DataAccess.setCursor(handle, seq)` (AC1).
//
// It carries NO board logic (NFR2 / Rule 13): it reads/writes through the `DataAccess` port
// (`eventsSince` / `append` / `setCursor`) + the shared CLI codec. NO new core method, MCP tool,
// event type, or error code — the 17-tool agent contract is byte-identical.
//
// AC4 DESIGN DECISION (`createdAt`) — see the Dev Notes "Design decision": replay via `append`
// RE-ASSIGNS each event's `createdAt` to import-time. This is the epics-AC-intended "re-run the
// same projections" behavior and is ACCEPTABLE because `createdAt` is DISPLAY-ONLY and is NOT
// part of the seq-based derived state Story 11.4 compares (identities / membership / rooms /
// messages / reactions / contracts / cursors — all keyed on `seq`, never `createdAt`). The
// import does NOT build a data-access restore primitive (no evidence it is needed); it defaults
// to the simple replay the epics AC intends.
//
// Operator-only: `import` is NEVER exposed as an MCP tool (architecture.md:294).

import { readFileSync } from 'node:fs';

import { createDataAccess, resolveDbPath } from '@agentbbs/data-access';

import { parseAndValidateArchive } from './archive.js';

import type { DataAccessHandle } from '@agentbbs/data-access';
import type { NewEvent } from '@agentbbs/core';

/** Parsed `agentbbs import` options. */
export interface ImportOptions {
  /** Explicit DB path (else AGENTBBS_DB / project-root discovery — see `resolveDbPath`). */
  dbPath?: string;
  /** Input archive path (positional; `-` / undefined → stdin). */
  inPath?: string;
}

/**
 * Parse `agentbbs import` args: `--db <path>` / `--db=<path>` and an optional input-path
 * positional. Minimal hand-rolled parsing (no CLI-framework dependency — mirrors
 * `parseUiArgs` / `parseExportArgs`). Unknown flags are ignored (forward-compatible). DB
 * discovery is delegated to `resolveDbPath` by the handler, exactly as `ui.ts` does.
 *
 * @param argv The args AFTER the `import` subcommand token.
 * @returns The parsed {@link ImportOptions}.
 */
export function parseImportArgs(argv: readonly string[]): ImportOptions {
  const options: ImportOptions = {};
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
      // The first bare token is the input-path positional.
      if (options.inPath === undefined) options.inPath = arg;
    }
  }
  return options;
}

/** Injection seam for {@link runImport} (testable without real stdio/files). */
export interface RunImportDeps {
  /** Where to print the success/diagnostic summary (defaults to process.stderr). */
  log?: (line: string) => void;
  /** Read the archive text from stdin when no in-path is given (defaults to reading process.stdin). */
  readStdin?: () => string;
}

/** The outcome of an {@link runImport}: the counts (for the summary/tests). */
export interface ImportResult {
  /** The number of events replayed into the empty board. */
  eventCount: number;
  /** The number of read-state cursors restored. */
  cursorCount: number;
}

/** Read the whole of STDIN synchronously as UTF-8 text (for `-` / omitted in-path). */
function readStdinSync(): string {
  return readFileSync(0, 'utf8');
}

/**
 * Run the import: parse + validate the archive, assert it is contiguous (1..N) BEFORE opening
 * the ledger, open the ledger, guard that it is empty, replay every event in ascending `seq`
 * order via a SINGLE batched atomic `append`, verify the reproduced `seq` matches the archive,
 * and restore each read-state cursor via `setCursor`. Closes the ledger before returning.
 *
 * The DB path is resolved the same way the MCP server resolves it: an explicit `--db` wins, else
 * AGENTBBS_DB, else the project-root `.agentbbs/agentbbs.db` walk-up (`resolveDbPath`).
 *
 * REJECTS (throws) — appending NOTHING — when: the archive is malformed / has an unknown event
 * `type` / an incompatible version (AC5) or is NON-CONTIGUOUS (Story 13.3 — seqs not exactly
 * 1..N), BOTH of which are caught BEFORE any append; or the target board is NON-EMPTY (AC2). The
 * valid replay runs as a single atomic transaction, so a mid-batch failure also leaves the board
 * untouched; the post-append `seq` assertion (AC4) is retained defense-in-depth. The caller
 * ({@link importCommand}) maps a rejection to a clear stderr message + a non-zero exit.
 *
 * @param options Parsed {@link ImportOptions}.
 * @param deps Injection seam (logger / stdin reader).
 * @returns The {@link ImportResult} (events replayed + cursors restored).
 */
export async function runImport(
  options: ImportOptions,
  deps: RunImportDeps = {},
): Promise<ImportResult> {
  const readStdin = deps.readStdin ?? readStdinSync;

  // Read the archive text BEFORE opening the ledger (a bad in-path should not create a DB).
  const inPath = options.inPath;
  const text =
    inPath === undefined || inPath === '-'
      ? readStdin()
      : readFileSync(inPath, 'utf8');

  // Parse + validate the archive BEFORE touching the ledger (AC5: malformed → nothing appended).
  const archive = parseAndValidateArchive(text);

  // Story 13.3 — PRE-REPLAY CONTIGUITY CHECK (the NOTHING-APPENDED phase, BEFORE opening the
  // ledger). Sort by `seq`, then assert the archived seqs are EXACTLY 1..N. A mangled /
  // non-contiguous archive is rejected HERE — before any append — so a corrupt restore writes
  // NOTHING. This is the load-bearing layer for atomicity: the batched `append` below COMMITS the
  // whole transaction before the post-append seq check can run, so only a pre-replay check makes
  // the bad-archive rejection atomic. An EMPTY archive (N=0) is vacuously contiguous (valid —
  // header-only restore). A normal `agentbbs export` archive is always contiguous from 1, so this
  // is a no-op on every real archive (only the corruption path changes: was partial, now empty).
  const ordered = [...archive.events].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].seq !== i + 1) {
      throw new Error(
        `archive is not contiguous: expected seq ${i + 1}, found ${ordered[i].seq} — a normal ` +
          `export is contiguous from 1; nothing was appended.`,
      );
    }
  }

  const dbPath = options.dbPath ?? resolveDbPath();
  const dataAccess: DataAccessHandle = createDataAccess({ dbPath });
  try {
    // AC2 — the target board MUST be empty. A non-empty board is rejected BEFORE any append
    // (avoids id collisions / double-replay; merge is out of V1 scope). CLI/operator-surface
    // error, NOT a BOARD_ERROR_CODE (Rule 13).
    const existing = await dataAccess.eventsSince(0);
    if (existing.length > 0) {
      throw new Error(
        `board is not empty (${existing.length} event(s)); import requires an empty board — ` +
          `merge is out of scope`,
      );
    }

    // AC1/AC4 (Story 13.3) — replay the WHOLE ordered stream in a SINGLE BATCHED atomic
    // `append`, stripped to the `NewEvent` shape (type/actor/payload). The existing
    // `BEGIN IMMEDIATE` transaction (ports.ts:55-64) makes the entire replay all-or-nothing: a
    // mid-batch failure rolls back, leaving the board untouched. `seq`/`createdAt` are re-assigned
    // at append; into a fresh empty board the AUTOINCREMENT reproduces `seq` 1..N.
    const orderedNewEvents: NewEvent[] = ordered.map(
      (event) =>
        ({
          type: event.type,
          actor: event.actor,
          payload: event.payload,
        }) as NewEvent,
    );
    const assignedSeqs = await dataAccess.append(orderedNewEvents);

    // AC4 — POST-APPEND defense-in-depth: verify each assigned `seq` reproduces the archived
    // `seq` 1:1. The pre-replay contiguity check (above) already guarantees this on a fresh empty
    // board, so this is belt-and-braces; if the invariant is ever violated it FAILS LOUDLY (the
    // restored board would no longer faithfully match the archive). The single batched append
    // having committed, this check runs AFTER the transaction — which is exactly why the
    // pre-replay contiguity check, not this one, is what makes a bad-archive rejection atomic.
    for (let i = 0; i < ordered.length; i++) {
      if (assignedSeqs[i] !== ordered[i].seq) {
        throw new Error(
          `import seq mismatch: archived event seq ${ordered[i].seq} replayed as seq ` +
            `${String(assignedSeqs[i])} — the target board was not empty/contiguous as required.`,
        );
      }
    }

    // AC1 — restore each read-state cursor via the EXISTING `setCursor` (the append-invariant
    // carve-out captured by the Story-11.2 archive; cursors are NOT event-derivable).
    for (const entry of archive.readState) {
      await dataAccess.setCursor(entry.handle, entry.cursor);
    }

    return {
      eventCount: ordered.length,
      cursorCount: archive.readState.length,
    };
  } finally {
    dataAccess.close();
  }
}

/**
 * The `agentbbs import` CLI entry: parse args, run the import, and print a one-line summary
 * (events replayed + cursors restored) to STDERR on success (exit 0). On ANY rejection
 * (non-empty board, malformed archive, seq mismatch, unreadable in-path / DB) it reports a clear
 * error to STDERR and sets a non-zero exit code — appending nothing in the rejection cases that
 * happen before replay.
 *
 * @param argv The args AFTER the `import` subcommand token.
 * @param deps Injection seam (logger / stdin reader); defaults to real stdio.
 */
export async function importCommand(
  argv: readonly string[],
  deps: RunImportDeps = {},
): Promise<void> {
  const log = deps.log ?? ((line: string) => process.stderr.write(line + '\n'));
  const options = parseImportArgs(argv);
  try {
    const result = await runImport(options, deps);
    log(
      `agentbbs import: replayed ${result.eventCount} event(s) + ` +
        `restored ${result.cursorCount} read-state cursor(s).`,
    );
  } catch (error: unknown) {
    log(
      `agentbbs import: failed — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
