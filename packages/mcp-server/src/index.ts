// @agentbbs/mcp-server — thin stdio MCP client over @agentbbs/core. Tool handlers
// validate (Zod v4) -> call core -> return; no board logic lives here. This barrel
// is the package's ONLY public surface; consumers (later identity-tool stories and
// tests) import from "@agentbbs/mcp-server", never deep paths. No default exports.
//
// Story 2.1 populates the bootstrap: the server factory, the reusable
// validate->delegate->map-error registration helper, and the boundary error
// mapper. The stdio entrypoint (`main.ts`) is the executable bin (it self-runs on
// import) and is intentionally NOT re-exported here.

// --- Server factory (Story 2.1, AC #1) ---
export { createBoardServer, SERVER_NAME, SERVER_VERSION } from './server.js';
export type { BoardServerDeps } from './server.js';

// --- Session-identity holder: per-connection acting handle (Story 2.3) ---
export { createSessionIdentity } from './session.js';
export type { SessionIdentity } from './session.js';

// --- Tool-registration helper: validate -> delegate -> map (Story 2.1, AC #1/#2) ---
export { registerCoreTool } from './register-tool.js';
export type {
  CoreToolConfig,
  CoreToolDelegate,
  ToolExtra,
} from './register-tool.js';

// --- Boundary error mapper: BoardError -> CallToolResult (Story 2.1, AC #2) ---
export {
  INTERNAL_ERROR,
  mapErrorToResult,
  readErrorPayload,
} from './error-map.js';
export type { ErrorPayload } from './error-map.js';
