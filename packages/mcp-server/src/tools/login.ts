// The `login` MCP tool (Story 2.3, Task 3 / AC #1, #2, #3).
//
// The read half of "register-or-login": re-establish an EXISTING identity for the
// session. THIN, like `register` — the only logic here is (1) the Zod `handle`
// schema at the snake_case wire boundary (the SAME canonical charset/length as
// register, shared via identity-shared.ts, so invalid input is rejected by the SDK
// BEFORE core) and (2) delegating to `core.login` + mapping its `Identity` to the
// snake_case wire. All board logic — resolving the handle against the identity
// directory, the LOGIN_UNKNOWN signal — lives in core; this handler delegates and
// maps. A thrown `BoardError('LOGIN_UNKNOWN')` is routed by `registerCoreTool`
// through `error-map.ts` to the closed `{ code, message }` contract with no work
// here.
//
// On success it ALSO records the resolved handle as the session identity (the
// per-connection holder), so the identity-scoped tools that follow (`update_focus`
// 2.4, `identity.seen` 2.5) act as the logged-in handle. login appends NOTHING (it
// is claim-based, no token) — the only state it writes is that server-layer session
// handle, never a ledger event.

import { login } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { handleSchema, identityToWire } from './identity-shared.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccess, Identity } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `login` tool input schema — snake_case wire params. `handle` enforces the
 * canonical charset/form (shared with `register`); the SDK validates against this
 * and rejects invalid calls BEFORE the delegate runs (AC #3 boundary rejection).
 */
const LOGIN_INPUT_SCHEMA = {
  handle: handleSchema,
} as const;

/**
 * Build the success {@link CallToolResult} for a resolved identity. Carries the
 * snake_case payload in BOTH `structuredContent` and a JSON `text` block (mirrors
 * `register`), so a client reading either view sees the same
 * `{ handle, current_focus, created_at, last_seen }`.
 */
function successResult(identity: Identity): CallToolResult {
  const wire = identityToWire(identity);
  return {
    structuredContent: { ...wire },
    content: [{ type: 'text', text: JSON.stringify(wire) }],
  };
}

/**
 * Register the `login` tool on the given board server, closing over the injected
 * `DataAccess` and the per-connection {@link SessionIdentity} holder. Follows the
 * thin-tool pattern via `registerCoreTool`: validate (Zod) → delegate to
 * `core.login` → map result (camelCase identity → snake_case wire); a thrown
 * `BoardError('LOGIN_UNKNOWN')` is routed through `error-map.ts` by the helper.
 *
 * On success it records the resolved handle as the session identity (Story 2.3) so
 * later identity-scoped tools (2.4/2.5) act as it. This is a session-state write in
 * the SERVER layer — `core.login` itself appends nothing.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.login`.
 * @param session The per-connection session-identity holder to set on success.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerLoginTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'login',
    {
      description:
        'Re-establish an existing identity for this session by its handle (claim-based — no secret token). Returns the identity. Fails with LOGIN_UNKNOWN if the handle was never registered.',
      inputSchema: LOGIN_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Thin: resolve via core, set the session, map back. No board logic. A
      // BoardError('LOGIN_UNKNOWN') thrown by core is caught + mapped by
      // registerCoreTool (this delegate never builds an error result).
      const identity = await login(dataAccess, args.handle);
      // Establish the session as the resolved identity (Story 2.3). Only reached on
      // success — an unknown handle throws above and is mapped instead.
      session.handle = identity.handle;
      return successResult(identity);
    },
  );
}
