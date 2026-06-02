// The `agentbbs ui` subcommand (Story 9.3, Task 3 / AC #1).
//
// Launches the on-demand web control room (NFR4): opens the shared SQLite ledger via
// @agentbbs/data-access (honoring AGENTBBS_DB / the project-root walk-up — the same
// discovery the MCP server uses), starts the HTTP host (JSON API + SSE + the built
// apps/web client), prints the local URL, and runs until interrupted (Ctrl-C → graceful
// shutdown: close the host, then the DB connection). This is NOT a daemon — it lives
// only as long as the operator's `agentbbs ui` process.
//
// Agents are unaffected by whether this runs: they keep their own stdio MCP processes
// over the same SQLite file. The host is a SEPARATE, operator-launched process.

import { createDataAccess, resolveDbPath } from '@agentbbs/data-access';

import { startHost } from './host/index.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

/** Parsed `agentbbs ui` options. */
export interface UiOptions {
  /** Port to bind (0/undefined → ephemeral). */
  port?: number;
  /** Explicit DB path (else AGENTBBS_DB / project-root discovery). */
  dbPath?: string;
  /**
   * The operator handle to view the board AS (Story 9.4) — `--as <handle>`. Personalizes
   * the `(you)` marker + the NEEDS YOU escalation queue. Omitted → falls back to the
   * `AGENTBBS_OPERATOR` env, else `null` (watching-only; global read still works). The
   * board has no special "operator" type — this is just a claimed handle (the operator
   * reuses an existing one; the UI does NOT register it).
   */
  operatorHandle?: string;
}

/**
 * Canonicalize an operator handle to the form stored in the ledger: lowercased + trimmed
 * (the same case-folding core applies on registration — `register.ts#canonicalize`). The
 * `room.participant_added` payload `handle` is stored canonical, so the operator handle
 * must be canonical for the NEEDS YOU match to land. An empty/whitespace-only value yields
 * `null` (watching-only). This is thin-client normalization, NOT board logic.
 *
 * @param raw The raw handle from `--as` / `AGENTBBS_OPERATOR`, or `undefined`.
 * @returns The canonical handle, or `null` if none/blank.
 */
export function resolveOperatorHandle(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const canonical = raw.trim().toLowerCase();
  return canonical === '' ? null : canonical;
}

/**
 * Parse `agentbbs ui` args: `--port <n>` / `--port=<n>` and `--db <path>` /
 * `--db=<path>`. Minimal hand-rolled parsing (no CLI-framework dependency — the
 * surface is two flags). Unknown flags are ignored (forward-compatible). An invalid
 * `--port` (non-integer / out of range) throws so the operator gets a clear error.
 *
 * @param argv The args AFTER the `ui` subcommand token.
 * @returns The parsed {@link UiOptions}.
 */
export function parseUiArgs(argv: readonly string[]): UiOptions {
  const options: UiOptions = {};
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
    if (arg === '--port' || arg.startsWith('--port=')) {
      const raw = takeValue(
        arg.startsWith('--port=') ? arg.slice(7) : undefined,
      );
      if (raw === undefined) continue;
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(
          `Invalid --port "${raw}": expected an integer 0–65535.`,
        );
      }
      options.port = port;
    } else if (arg === '--db' || arg.startsWith('--db=')) {
      const raw = takeValue(arg.startsWith('--db=') ? arg.slice(5) : undefined);
      if (raw !== undefined) options.dbPath = raw;
    } else if (arg === '--as' || arg.startsWith('--as=')) {
      const raw = takeValue(arg.startsWith('--as=') ? arg.slice(5) : undefined);
      if (raw !== undefined) options.operatorHandle = raw;
    }
  }
  return options;
}

/** Injection seam for {@link runUi} (testable without real stdio/signals). */
export interface RunUiDeps {
  /** Where to print the URL/diagnostics (defaults to process.stdout). */
  log?: (line: string) => void;
}

/**
 * Run the `agentbbs ui` command: open the ledger, start the host, print the URL, and
 * keep running until interrupted. Returns a stop function the signal handler (or a
 * test) calls to tear everything down gracefully.
 *
 * The DB path is resolved the same way the MCP server resolves it: an explicit `--db`
 * wins, else AGENTBBS_DB, else the project-root `.agentbbs/agentbbs.db` walk-up
 * (`resolveDbPath`). The host serves the built apps/web client by runtime path
 * resolution (no workspace import).
 *
 * @param options Parsed {@link UiOptions}.
 * @param deps Injection seam (logger).
 * @returns The running host's URL + a `stop()` for graceful shutdown.
 */
export async function runUi(
  options: UiOptions,
  deps: RunUiDeps = {},
): Promise<{ url: string; port: number; stop: () => Promise<void> }> {
  const log = deps.log ?? ((line: string) => process.stdout.write(line + '\n'));

  const dbPath = options.dbPath ?? resolveDbPath();
  const dataAccess: DataAccessHandle = createDataAccess({ dbPath });

  // Resolve the operator handle: an explicit `--as` wins, else AGENTBBS_OPERATOR, else
  // null (watching-only — global read still works, NEEDS YOU is empty). Story 9.4.
  const operatorHandle = resolveOperatorHandle(
    options.operatorHandle ?? process.env.AGENTBBS_OPERATOR,
  );

  const host = await startHost({
    dataAccess,
    port: options.port,
    operatorHandle,
  });
  log(`AgentBBS web control room: ${host.url}`);
  log(
    operatorHandle === null
      ? 'Operator: (none) — watching-only; pass --as <handle> or set AGENTBBS_OPERATOR to personalize NEEDS YOU.'
      : `Operator: @${operatorHandle}`,
  );
  log('On-demand host (NFR4) — not a daemon. Press Ctrl-C to stop.');

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await host.close();
    dataAccess.close();
  };

  return { url: host.url, port: host.port, stop };
}

/**
 * The `agentbbs ui` CLI entry: parse args, run the host, and wire SIGINT/SIGTERM →
 * graceful shutdown so Ctrl-C stops the on-demand host cleanly. Resolves only when the
 * process is asked to stop (the returned promise is the "run until interrupted" lifetime).
 *
 * @param argv The args AFTER the `ui` subcommand token.
 */
export async function uiCommand(argv: readonly string[]): Promise<void> {
  const options = parseUiArgs(argv);
  const { stop } = await runUi(options);

  await new Promise<void>((resolvePromise) => {
    const shutdown = (): void => {
      void stop().then(() => resolvePromise());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
