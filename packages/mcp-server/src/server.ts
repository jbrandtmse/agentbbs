// The MCP server factory (Story 2.1, Task 4 / AC #1).
//
// `createBoardServer(deps)` builds and returns a configured `McpServer` with the
// injected dependencies (the `DataAccess` port) in scope. This is the bootstrap
// shell: it wires identity, registers the V1 tool surface through the production
// `registerCoreTool` helper, and is connected to a transport by the caller
// (`main()` for stdio, or the integration test over an in-memory transport).
//
// V1 tool surface: the identity tools (`register`, `login`, focus, seen) are added
// in Stories 2.2–2.5 by calling `registerCoreTool(server, …)` inside this factory,
// each closing over `deps.dataAccess`. This story registers NO board tools — it is
// the bootstrap only (the representative tool that proves the pattern lives in the
// AC #3 integration test, not here).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DataAccess } from '@agentbbs/core';

/** The MCP server identity (mirrors `package.json` name/version). */
export const SERVER_NAME = 'agentbbs';
/** The server version reported to clients. Kept in sync with `package.json`. */
export const SERVER_VERSION = '0.0.0';

/**
 * Dependencies injected into the server factory. The `DataAccess` port is the sole
 * persistence seam (NFR2): the factory and the tools it registers depend ONLY on
 * this interface, never on a concrete storage driver. `main()` supplies the
 * better-sqlite3-backed handle; tests supply a fake.
 */
export interface BoardServerDeps {
  /** The persistence port that the identity tools (Stories 2.2–2.5) delegate to. */
  readonly dataAccess: DataAccess;
}

/**
 * Build a configured {@link McpServer} for the board.
 *
 * Registers the V1 tool surface via `registerCoreTool` (identity tools added by
 * later stories, each closing over `deps.dataAccess`) and returns the server ready
 * to `connect(transport)`. Does NOT connect a transport itself — the caller owns
 * transport choice and lifecycle.
 *
 * @param deps The injected dependencies (the `DataAccess` port).
 */
export function createBoardServer(deps: BoardServerDeps): McpServer {
  // Referenced so the seam is wired now; the identity tools (Stories 2.2–2.5)
  // close over this handle when they register through `registerCoreTool`.
  void deps.dataAccess;

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Identity tools are registered here by Stories 2.2–2.5, e.g.:
  //   registerCoreTool(server, 'register', { description, inputSchema }, delegate)
  // where each delegate calls core with deps.dataAccess. No board tools in 2.1.

  return server;
}
