// The `agentbbs import` subcommand — SCAFFOLD ONLY (Story 11.1).
//
// This story registers `import` as a recognized operator subcommand and establishes the
// command module + a minimal hand-rolled arg-parse seam (mirroring `parseUiArgs` in
// `ui.ts`). The actual NDJSON replay-into-an-empty-board is Story 11.3 — the handler here
// is an HONEST, explicitly-inert scaffold: it writes a clear "not yet implemented
// (Story 11.3)" message to STDERR and sets a non-zero `process.exitCode` (1). The inert
// stub is recorded in deferred-work.md with Story 11.3 as the named consumer (Rule 13).
//
// Operator-only: `import` is NEVER exposed as an MCP tool (architecture.md:294). No board
// logic lives here — when Story 11.3 fills the body it opens the ledger via @agentbbs/
// data-access (resolveDbPath) and replays the NDJSON archive into an empty board via core.

/** Parsed `agentbbs import` options. Grows as Story 11.3 fills the real surface. */
export interface ImportOptions {
  /** Explicit DB path (else AGENTBBS_DB / project-root discovery — see `resolveDbPath`). */
  dbPath?: string;
  /** Input archive path (positional; `-` / undefined → stdin once Story 11.3 lands). */
  inPath?: string;
}

/**
 * Parse `agentbbs import` args: `--db <path>` / `--db=<path>` and an optional input-path
 * positional. Minimal hand-rolled parsing (no CLI-framework dependency — mirrors
 * `parseUiArgs`). Unknown flags are ignored (forward-compatible) so Story 11.3 can add
 * flags without breaking older invocations. DB discovery is delegated to `resolveDbPath`
 * by the (future) handler, exactly as `ui.ts` does.
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
      // The first bare token is the input-path positional (Story 11.3 consumes it).
      if (options.inPath === undefined) options.inPath = arg;
    }
  }
  return options;
}

/**
 * The `agentbbs import` CLI entry — INERT SCAFFOLD (Story 11.1). Parses args (so the seam
 * is exercised) then reports that the real import is not yet implemented and sets a
 * non-zero exit code. Story 11.3 replaces the body below with the NDJSON replay, reusing
 * `parseImportArgs` + `resolveDbPath`.
 *
 * @param argv The args AFTER the `import` subcommand token.
 * @param write Diagnostics sink to STDERR (injectable for tests; defaults to process.stderr).
 */
export async function importCommand(
  argv: readonly string[],
  write: (line: string) => void = (line) => process.stderr.write(line + '\n'),
): Promise<void> {
  // Exercise the arg-parse seam now so the scaffold proves the shape Story 11.3 fills.
  parseImportArgs(argv);
  write(
    'agentbbs import: not yet implemented — arriving in Story 11.3 (import by replaying an NDJSON archive into an empty board).',
  );
  process.exitCode = 1;
  return Promise.resolve();
}
