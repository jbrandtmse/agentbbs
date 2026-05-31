// The MCP server factory (Story 2.1, Task 4 / AC #1).
//
// `createBoardServer(deps)` builds and returns a configured `McpServer` with the
// injected dependencies (the `DataAccess` port) in scope. This is the bootstrap
// shell: it wires identity, registers the V1 tool surface through the production
// `registerCoreTool` helper, and is connected to a transport by the caller
// (`main()` for stdio, or the integration test over an in-memory transport).
//
// V1 tool surface: the identity tools (`register`, `login`, `update_focus`, seen)
// are added in Stories 2.2–2.5 by calling `registerCoreTool(server, …)` inside this
// factory, each closing over `deps.dataAccess` (and, from Story 2.3, the
// per-connection session-identity holder). As of Story 2.4 `register`, `login`, and
// `update_focus` are wired here; `identity.seen` follows in Story 2.5.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DataAccess } from '@agentbbs/core';

import { createSessionIdentity } from './session.js';
import { registerAnnounceProjectTool } from './tools/announce-project.js';
import { registerListProjectsTool } from './tools/list-projects.js';
import { registerLoginTool } from './tools/login.js';
import { registerRegisterTool } from './tools/register.js';
import { registerUpdateFocusTool } from './tools/update-focus.js';

import type { SessionIdentity } from './session.js';

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
  /**
   * The per-connection session-identity holder (Story 2.3). OPTIONAL: omitted in
   * production (`main()`), where the factory creates a fresh one per server — one
   * server == one agent == one session. A caller MAY inject its own holder to
   * observe the session the tools establish; the AC #3 integration test passes one
   * in and asserts the tools set its `handle`. This is the construction seam that
   * makes the session observable WITHOUT a user-facing "who am I" tool. The same
   * holder instance is threaded to every tool closure on this server.
   */
  readonly sessionIdentity?: SessionIdentity;
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
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // The per-connection session-identity holder (Story 2.3). Use the injected one if
  // a caller provided it (the AC #3 test observes the session this way); otherwise
  // create a fresh holder for this server (one server == one agent == one session).
  // The SAME instance is threaded to every tool closure below, so a handle set by
  // one tool (register/login) is the actor read by the others (Stories 2.4/2.5).
  const sessionIdentity = deps.sessionIdentity ?? createSessionIdentity();

  // V1 tool surface. Each tool registers through `registerCoreTool` and closes over
  // `deps.dataAccess` (+ the session holder), delegating to core (no board logic here).
  // Identity tools (Epic 2):
  //   - register (Story 2.2): claim a unique handle → durable identity; also
  //     establishes the session (a fresh agent is "established" too — FR2/FR37).
  //   - login (Story 2.3): re-establish an existing identity for the session.
  //   - update_focus (Story 2.4): the first SESSION-REQUIRED tool — its actor is
  //     the session handle (NO handle param); rejects with NO_IDENTITY if none set.
  // Project / sub-board tools (Epic 3):
  //   - announce_project (Story 3.1): the first BOARD tool — SESSION-REQUIRED (actor
  //     = session handle, rejects NO_IDENTITY if unset). Creates a project sub-board
  //     (project.announced + the announcer's board.joined, atomically) with the
  //     caller as first member; rejects a duplicate title/id with PROJECT_EXISTS.
  //     Consumed by Stories 3.2–3.4 (list_projects, join_board, sub-board directory).
  //   - list_projects (Story 3.2): the first BOARD READ tool — SESSION-REQUIRED
  //     (established identity required, rejects NO_IDENTITY if unset) but NO
  //     membership: a non-member sees the full main-board directory (FR9 board-wide
  //     open read). Takes no params; returns the projects directory ordered by seq.
  registerRegisterTool(server, deps.dataAccess, sessionIdentity);
  registerLoginTool(server, deps.dataAccess, sessionIdentity);
  registerUpdateFocusTool(server, deps.dataAccess, sessionIdentity);
  registerAnnounceProjectTool(server, deps.dataAccess, sessionIdentity);
  registerListProjectsTool(server, deps.dataAccess, sessionIdentity);

  return server;
}
