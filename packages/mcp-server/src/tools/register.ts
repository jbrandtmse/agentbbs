// The `register` MCP tool (Story 2.2, Task 4 / AC #1, #3).
//
// The first real board tool on the bootstrap server (Story 2.1). It is THIN: the
// only logic here is (1) the Zod input schema at the snake_case wire boundary and
// (2) the camelCase↔snake_case mapping around a single `core.register` call. All
// board logic — uniqueness, atomicity, the identity record — lives in core; this
// handler delegates and maps. Errors are routed by `registerCoreTool` through
// `error-map.ts`, so a `BoardError('HANDLE_TAKEN')` reaches the client as the
// closed `{ code, message }` contract with no work here.
//
// AC #3 — handle validation (DECISION, documented): the schema accepts ONLY the
// already-canonical handle: lowercase and within the charset `[a-z0-9._@-]`,
// enforced by `HANDLE_PATTERN`. Anything else is rejected by the SDK's Zod
// validation BEFORE the core delegate runs — an uppercase handle ("Ada") fails
// the lowercase-only pattern, and an out-of-charset handle ("Ada!", "a b") fails
// the charset. This is the story's "simplest faithful reading" of AC #3 ("outside
// the charset OR not lowercaseable to it"): we accept only canonical handles and
// reject the rest at the boundary, rather than lowercasing-then-validating. AC
// #2's case-insensitive uniqueness still holds — core defensively lowercases and
// the data-access guard collapses to the canonical form — but in practice every
// handle that reaches core is already canonical.

import { register } from '@agentbbs/core';
import { z } from 'zod';

import { registerCoreTool } from '../register-tool.js';
import { handleSchema, identityToWire } from './identity-shared.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccess, Identity } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `register` tool input schema — snake_case wire params (the MCP boundary
 * casing). `handle` enforces the canonical charset/form (AC #3, shared with
 * `login`); `current_focus` is any non-empty string. The SDK validates against
 * this and rejects invalid calls BEFORE the delegate runs.
 */
const REGISTER_INPUT_SCHEMA = {
  handle: handleSchema,
  current_focus: z.string().min(1),
} as const;

/**
 * Build the success {@link CallToolResult} for a registered identity. Carries the
 * snake_case payload in BOTH `structuredContent` (machine-readable) and a JSON
 * `text` block, mirroring the error surface so a client reading either view sees
 * the same `{ handle, current_focus, created_at, last_seen }`.
 */
function successResult(identity: Identity): CallToolResult {
  const wire = identityToWire(identity);
  return {
    structuredContent: { ...wire },
    content: [{ type: 'text', text: JSON.stringify(wire) }],
  };
}

/**
 * Register the `register` tool on the given board server, closing over the
 * injected `DataAccess` and the per-connection {@link SessionIdentity} holder.
 * Follows the Story 2.1 thin-tool pattern via `registerCoreTool`: validate (Zod) →
 * delegate to `core.register` → map result (camelCase identity → snake_case wire);
 * a thrown `BoardError` is routed through `error-map.ts` by the helper.
 *
 * On success it ALSO records the new handle as the session identity (Story 2.3): a
 * freshly-registered agent is "established" for the session too (FR2/FR37
 * "register-or-login"). This is a minimal session-state write in the SERVER layer —
 * it does NOT change the tool's result shape and adds no board logic.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.register`.
 * @param session The per-connection session-identity holder to set on success.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerRegisterTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'register',
    {
      description:
        'Register a unique handle with a current focus, creating a durable identity that persists across sessions. Fails with HANDLE_TAKEN if the handle is already claimed.',
      inputSchema: REGISTER_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Thin: map snake_case wire → camelCase core call, await, map back. No board
      // logic. A BoardError thrown by core is caught + mapped by registerCoreTool.
      const identity = await register(dataAccess, {
        handle: args.handle,
        currentFocus: args.current_focus,
      });
      // Establish the session as the newly-registered identity (Story 2.3). Only
      // reached on success — a thrown BoardError skips this and is mapped instead.
      session.handle = identity.handle;
      return successResult(identity);
    },
  );
}
