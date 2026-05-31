// The `list_projects` MCP tool (Story 3.2, Task 2 / AC #1, #2, #4).
//
// The first BOARD READ tool. SESSION-REQUIRED (an established identity is the only
// precondition — NO membership), like `update_focus`/`announce_project`: it takes NO
// params (it lists the WHOLE main board). THIN — the only logic here is (1) the EMPTY
// Zod input schema at the wire boundary, (2) the session precondition (read the
// per-connection holder; if no identity is established, throw
// `BoardError('NO_IDENTITY')` — routed to the `{ code, message }` isError result by
// `error-map.ts` via `registerCoreTool`), and (3) delegating to `core.listProjects`
// + mapping each `Project` to the snake_case wire via the shared `projectToWire`.
//
// Board-wide-open read (FR9): browsing the directory requires an established identity
// but NOT membership — a non-member identity sees the full sub-board listing. The
// membership gate is what reads remove (Story 3.5), not the identity gate; every
// existing session-aware tool gates on identity, and this stays consistent.
//
// The session precondition is a SERVER concern (which handle this connection acts
// as), so it lives in the delegate — NOT in core. The read+fold is board logic and
// lives in core. core stays session-agnostic; this handler adds no board logic.

import { BoardError, listProjects } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { projectToWire } from './project-shared.js';

import type { ProjectWire } from './project-shared.js';
import type { SessionIdentity } from '../session.js';
import type { DataAccess, Project } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `list_projects` tool input schema — EMPTY. `list_projects` lists the whole
 * main board and takes no params (no filter, no handle: the acting identity comes
 * from the session holder). The SDK advertises a no-required-params object schema.
 */
const LIST_PROJECTS_INPUT_SCHEMA = {} as const;

/**
 * Build the success {@link CallToolResult} for the projects directory. `structuredContent`
 * MUST be a JSON object per the MCP spec (verified against
 * @modelcontextprotocol/sdk@1.29.0 types.d.ts: `structuredContent` is typed
 * `ZodObject<{}>`/`ZodRecord<string, unknown>` — an object, not a bare array), so the
 * array is wrapped as `{ projects: [...] }`. The JSON `text` block carries the SAME
 * `{ projects: [...] }` shape, so a client reading either view sees identical data.
 */
function successResult(projects: Project[]): CallToolResult {
  const wire: ProjectWire[] = projects.map(projectToWire);
  const envelope = { projects: wire };
  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Register the `list_projects` tool on the given board server, closing over the
 * injected `DataAccess` and the per-connection {@link SessionIdentity} holder.
 * Follows the thin-tool pattern via `registerCoreTool`: validate (Zod, empty schema)
 * → check the session precondition → delegate to `core.listProjects` → map each
 * `Project` (camelCase) to the snake_case wire and wrap as `{ projects: [...] }`. A
 * thrown `BoardError('NO_IDENTITY')` is routed through `error-map.ts` by the helper
 * to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.listProjects`.
 * @param session The per-connection session-identity holder read for the precondition.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerListProjectsTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'list_projects',
    {
      description:
        'List the projects (sub-boards) available on the main board — each with its title, project_id (slug), description, and announcer — ordered by announcement. Browsing requires an established identity (register or login first, else NO_IDENTITY) but NOT membership: you can see the full directory before joining any board.',
      inputSchema: LIST_PROJECTS_INPUT_SCHEMA,
    },
    async (): Promise<CallToolResult> => {
      // Session precondition: an established identity is required to browse (NO
      // membership). With no identity there is no registered actor — reject with
      // NO_IDENTITY (mapped by registerCoreTool). No event is appended (this is a read).
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the read+fold to core, map the records to the wire envelope.
      const projects = await listProjects(dataAccess);
      return successResult(projects);
    },
  );
}
