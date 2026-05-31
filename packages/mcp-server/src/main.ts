#!/usr/bin/env node
// The stdio entrypoint (Story 2.1, Task 4 / AC #1).
//
// Wires the production server to a real stdio transport: obtain the DataAccess
// port via `createDataAccess()` (better-sqlite3 behind the NFR2 seam; WAL +
// busy_timeout + bounded retry; DB path discovery), build the server with
// `createBoardServer`, and connect over `StdioServerTransport`. An MCP client
// (e.g. an agent host) launches this binary and speaks the protocol over
// stdin/stdout.
//
// stdout is RESERVED for the MCP JSON-RPC stream — all diagnostics go to stderr so
// they never corrupt the protocol framing.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDataAccess } from '@agentbbs/data-access';

import { createBoardServer } from './server.js';

/**
 * Start the stdio MCP server: open the ledger, build the board server, and connect
 * it to the process's stdin/stdout. Resolves once the transport is connected and
 * listening; the process then stays alive serving tool calls until stdin closes.
 */
export async function main(): Promise<void> {
  const dataAccess = createDataAccess();
  const server = createBoardServer({ dataAccess });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  // Never write diagnostics to stdout (reserved for the JSON-RPC stream).
  process.stderr.write(
    `[agentbbs mcp-server] fatal: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
