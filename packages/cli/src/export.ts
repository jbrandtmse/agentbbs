// The `agentbbs export` subcommand — SCAFFOLD ONLY (Story 11.1).
//
// This story registers `export` as a recognized operator subcommand and establishes the
// command module + a minimal hand-rolled arg-parse seam (mirroring `parseUiArgs` in
// `ui.ts`). The actual NDJSON ledger dump is Story 11.2 — the handler here is an HONEST,
// explicitly-inert scaffold: it writes a clear "not yet implemented (Story 11.2)" message
// to STDERR and sets a non-zero `process.exitCode` (1), so an operator who runs it today
// gets an unambiguous signal rather than a silent no-op. The inert stub is recorded in
// deferred-work.md with Story 11.2 as the named consumer (Rule 13).
//
// Operator-only: `export` is NEVER exposed as an MCP tool (architecture.md:294). No board
// logic lives here — when Story 11.2 fills the body it opens the ledger via @agentbbs/
// data-access (resolveDbPath) and dumps the logical NDJSON event stream from core.

/** Parsed `agentbbs export` options. Grows as Story 11.2 fills the real surface. */
export interface ExportOptions {
  /** Explicit DB path (else AGENTBBS_DB / project-root discovery — see `resolveDbPath`). */
  dbPath?: string;
  /** Output archive path (positional; `-` / undefined → stdout once Story 11.2 lands). */
  outPath?: string;
}

/**
 * Parse `agentbbs export` args: `--db <path>` / `--db=<path>` and an optional output-path
 * positional. Minimal hand-rolled parsing (no CLI-framework dependency — mirrors
 * `parseUiArgs`). Unknown flags are ignored (forward-compatible) so Story 11.2 can add
 * flags without breaking older invocations. DB discovery is delegated to `resolveDbPath`
 * by the (future) handler, exactly as `ui.ts` does.
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
      // The first bare token is the output-path positional (Story 11.2 consumes it).
      if (options.outPath === undefined) options.outPath = arg;
    }
  }
  return options;
}

/**
 * The `agentbbs export` CLI entry — INERT SCAFFOLD (Story 11.1). Parses args (so the seam
 * is exercised) then reports that the real export is not yet implemented and sets a
 * non-zero exit code. Story 11.2 replaces the body below with the NDJSON dump, reusing
 * `parseExportArgs` + `resolveDbPath`.
 *
 * @param argv The args AFTER the `export` subcommand token.
 * @param write Diagnostics sink to STDERR (injectable for tests; defaults to process.stderr).
 */
export async function exportCommand(
  argv: readonly string[],
  write: (line: string) => void = (line) => process.stderr.write(line + '\n'),
): Promise<void> {
  // Exercise the arg-parse seam now so the scaffold proves the shape Story 11.2 fills.
  parseExportArgs(argv);
  write(
    'agentbbs export: not yet implemented — arriving in Story 11.2 (export the ledger to a logical NDJSON archive).',
  );
  process.exitCode = 1;
  return Promise.resolve();
}
