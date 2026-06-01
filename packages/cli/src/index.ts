#!/usr/bin/env node
// @agentbbs/cli — the `agentbbs` operator binary. A thin client over @agentbbs/core +
// @agentbbs/data-access (NFR2): it carries no board logic, it dispatches subcommands
// that open the ledger and delegate to core.
//
// Story 9.3 establishes the subcommand dispatch + the FIRST subcommand, `ui` (launch the
// on-demand web control room — the HTTP host serving the JSON API + SSE + the built
// apps/web client). The dispatch table is the extension seam for the FR32–34 operator
// tools (`export`/`import`, Epic 11) — they slot in as new entries here later; this story
// does NOT build them.
//
// As a barrel, this module re-exports the subcommand entry points (so they are importable
// + testable). As the `agentbbs` bin, the `main()` at the bottom runs when the file is
// executed directly (the shebang + the package `bin` mapping point here).

import { pathToFileURL } from 'node:url';

import { uiCommand } from './ui.js';

/** Package name marker; retained as a stable barrel anchor. */
export const CLI_PACKAGE = '@agentbbs/cli';

export { uiCommand, parseUiArgs, runUi } from './ui.js';
export type { UiOptions, RunUiDeps } from './ui.js';

/** A registered subcommand: a name + its handler over the post-name argv. */
interface Subcommand {
  name: string;
  describe: string;
  run: (argv: readonly string[]) => Promise<void>;
}

/** The subcommand table — the extension seam (Epic 11 export/import slot in here). */
const SUBCOMMANDS: Subcommand[] = [
  {
    name: 'ui',
    describe:
      'Launch the on-demand web control room (JSON API + SSE + web client).',
    run: uiCommand,
  },
];

/** Print the top-level usage (no/unknown subcommand). */
function usage(write: (line: string) => void): void {
  write('Usage: agentbbs <command> [options]');
  write('');
  write('Commands:');
  for (const cmd of SUBCOMMANDS) {
    write(`  ${cmd.name.padEnd(10)} ${cmd.describe}`);
  }
}

/**
 * Dispatch `argv` (the raw `process.argv.slice(2)`) to a subcommand. With no command or
 * an unknown one, prints usage. Resolves when the chosen subcommand completes (the `ui`
 * command runs until interrupted).
 *
 * @param argv The CLI args after the node + script tokens.
 * @param write Diagnostics sink (defaults to stdout; injectable for tests).
 */
export async function dispatch(
  argv: readonly string[],
  write: (line: string) => void = (line) => process.stdout.write(line + '\n'),
): Promise<void> {
  const [name, ...rest] = argv;
  if (name === undefined || name === '--help' || name === '-h') {
    usage(write);
    return;
  }
  const command = SUBCOMMANDS.find((c) => c.name === name);
  if (command === undefined) {
    write(`Unknown command: ${name}`);
    write('');
    usage(write);
    process.exitCode = 1;
    return;
  }
  await command.run(rest);
}

// --- bin entry ---------------------------------------------------------------
// Run only when executed directly as the `agentbbs` binary (not when imported as a
// barrel for tests). Compares the resolved module URL against the invoked script path.
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  dispatch(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `[agentbbs] fatal: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
