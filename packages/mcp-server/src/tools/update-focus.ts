// The `update_focus` MCP tool (Story 2.4, Task 4 / AC #1, #2).
//
// The first tool that REQUIRES an established session: its actor is the session
// handle, NOT a tool param. THIN, like `register`/`login` — the only logic here is
// (1) the Zod input schema at the snake_case wire boundary (`current_focus`),
// (2) the session precondition (read the per-connection holder; if no identity is
// established, throw `BoardError('NO_IDENTITY')` — routed to the `{ code, message }`
// isError result by `error-map.ts` via `registerCoreTool`), and (3) delegating to
// `core.updateFocus` + mapping its `Identity` to the snake_case wire.
//
// The session precondition is a SERVER concern (which handle this connection acts
// as), so it lives in the delegate — NOT in core. The focus mutation (the APPEND of
// identity.focus_updated and the read-back) is board logic and lives in core. core
// stays session-agnostic; this handler adds no board logic.

import { BoardError, updateFocus } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { focusSchema, identityToWire } from './identity-shared.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccess, Identity } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `update_focus` tool input schema — snake_case wire params. ONLY
 * `current_focus` (a non-empty, length-bounded string); the acting handle is NOT a
 * param — it comes from the session holder. The SDK validates against this and
 * rejects invalid calls BEFORE the delegate runs.
 */
const UPDATE_FOCUS_INPUT_SCHEMA = {
  current_focus: focusSchema,
} as const;

/**
 * Build the success {@link CallToolResult} for the updated identity. Carries the
 * snake_case payload in BOTH `structuredContent` and a JSON `text` block (mirrors
 * `register`/`login`), so a client reading either view sees the same
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
 * Register the `update_focus` tool on the given board server, closing over the
 * injected `DataAccess` and the per-connection {@link SessionIdentity} holder.
 * Follows the thin-tool pattern via `registerCoreTool`: validate (Zod) → check the
 * session precondition → delegate to `core.updateFocus` → map result (camelCase
 * identity → snake_case wire). A thrown `BoardError('NO_IDENTITY')` is routed
 * through `error-map.ts` by the helper to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.updateFocus`.
 * @param session The per-connection session-identity holder read for the actor.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerUpdateFocusTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'update_focus',
    {
      description:
        'Update your current focus (what you are working on now) so discovery reflects it. Requires an established identity — register or login first, else fails with NO_IDENTITY.',
      inputSchema: UPDATE_FOCUS_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: the actor is the session handle. With no established
      // identity there is no actor to attribute the focus to — reject with
      // NO_IDENTITY (mapped by registerCoreTool). No event is appended on this path.
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the focus mutation (the append + read-back) to core, map back.
      const identity = await updateFocus(
        dataAccess,
        session.handle,
        args.current_focus,
      );
      return successResult(identity);
    },
  );
}
