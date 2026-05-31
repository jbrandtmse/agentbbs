// The `announce_project` MCP tool (Story 3.1, Task 4 / AC #1, #2, #3, #4).
//
// The first BOARD (non-identity) tool. SESSION-REQUIRED, like `update_focus`: its
// actor is the session handle, NOT a tool param. THIN — the only logic here is
// (1) the Zod input schema at the snake_case wire boundary (`title`, `description`),
// (2) the session precondition (read the per-connection holder; if no identity is
// established, throw `BoardError('NO_IDENTITY')` — routed to the `{ code, message }`
// isError result by `error-map.ts` via `registerCoreTool`), and (3) delegating to
// `core.announceProject` + mapping its `Project` to the snake_case wire.
//
// The session precondition is a SERVER concern (which handle this connection acts
// as), so it lives in the delegate — NOT in core. The project creation (the atomic
// two-event append + read-back) is board logic and lives in core. core stays
// session-agnostic; this handler adds no board logic.

import { announceProject, BoardError } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import {
  projectDescriptionSchema,
  projectTitleSchema,
  projectToWire,
} from './project-shared.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccess, Project } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `announce_project` tool input schema — snake_case wire params. `title` and
 * `description` are non-empty, length-bounded strings; the acting handle is NOT a
 * param — it comes from the session holder. The SDK validates against this and
 * rejects invalid calls (missing/empty title or description) BEFORE the delegate
 * runs (AC #4), so no event is appended on an invalid call.
 */
const ANNOUNCE_PROJECT_INPUT_SCHEMA = {
  title: projectTitleSchema,
  description: projectDescriptionSchema,
} as const;

/**
 * Build the success {@link CallToolResult} for an announced project. Carries the
 * snake_case payload in BOTH `structuredContent` and a JSON `text` block (mirrors
 * the identity tools), so a client reading either view sees the same
 * `{ project_id, title, description, announcer, members }`.
 */
function successResult(project: Project): CallToolResult {
  const wire = projectToWire(project);
  return {
    structuredContent: { ...wire },
    content: [{ type: 'text', text: JSON.stringify(wire) }],
  };
}

/**
 * Register the `announce_project` tool on the given board server, closing over the
 * injected `DataAccess` and the per-connection {@link SessionIdentity} holder.
 * Follows the thin-tool pattern via `registerCoreTool`: validate (Zod) → check the
 * session precondition → delegate to `core.announceProject` → map result (camelCase
 * project → snake_case wire). A thrown `BoardError` (`NO_IDENTITY` for no session,
 * `PROJECT_EXISTS` for a duplicate title/id) is routed through `error-map.ts` by the
 * helper to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.announceProject`.
 * @param session The per-connection session-identity holder read for the actor.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerAnnounceProjectTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'announce_project',
    {
      description:
        'Announce a project with a title and description, creating a new sub-board for coordination with you as its first member. Requires an established identity — register or login first, else fails with NO_IDENTITY. Fails with PROJECT_EXISTS if the title (or its derived id) is already taken.',
      inputSchema: ANNOUNCE_PROJECT_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: the actor is the session handle. With no established
      // identity there is no actor to attribute the project to — reject with
      // NO_IDENTITY (mapped by registerCoreTool). No event is appended on this path.
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the project creation (the atomic two-event append +
      // read-back) to core, map the returned Project back to the wire shape.
      const project = await announceProject(dataAccess, session.handle, {
        title: args.title,
        description: args.description,
      });
      return successResult(project);
    },
  );
}
