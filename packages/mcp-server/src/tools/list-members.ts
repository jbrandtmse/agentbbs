// The `list_members` MCP tool (Story 3.4, Task 2 / AC #1, #3, #4).
//
// A BOARD READ tool for a sub-board's member directory. SESSION-REQUIRED like
// `list_projects` — an established identity is the only precondition; there is NO
// membership check (board-wide open read, FR9: a non-member sees the directory). THIN:
// the only logic here is (1) the snake_case Zod input schema (`project_id`), (2) the
// session precondition (read the per-connection holder; if no identity is established,
// throw `BoardError('NO_IDENTITY')` — routed to the `{ code, message }` isError result
// by `error-map.ts` via `registerCoreTool`), and (3) delegating to
// `core.boardDirectory` + mapping each `DirectoryMember` to the snake_case wire.
//
// DECISION 2 (story Dev Notes): the tool is named `list_members`. The PRD addendum fixed
// FIELD shapes, not the full 12-tool NAME list, so this name is not contract-pinned. It
// parallels `list_projects` (the established read-tool naming) + takes a `project_id`. A
// reviewer may rename to `get_board_directory` — that is a rename only.
//
// The cross-projection join (membership ⋈ identity) and the BOARD_NOT_FOUND existence
// check are core's concern (`boardDirectory`); core stays session-agnostic. This handler
// adds no board logic — it only enforces the session gate and maps the wire.

import { BoardError, boardDirectory } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { memberToWire } from './identity-shared.js';
import { projectIdSchema } from './project-shared.js';

import type { MemberWire } from './identity-shared.js';
import type { SessionIdentity } from '../session.js';
import type { DataAccess, DirectoryMember } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `list_members` tool input schema — snake_case wire params. `project_id` is a
 * non-empty, slug-charset string (the sub-board whose directory to read); the acting
 * identity is NOT a param — it comes from the session holder. The SDK validates against
 * this and rejects an invalid call (missing/empty/non-slug project_id) BEFORE the
 * delegate runs.
 */
const LIST_MEMBERS_INPUT_SCHEMA = {
  project_id: projectIdSchema,
} as const;

/**
 * Build the success {@link CallToolResult} for a member directory. `structuredContent`
 * MUST be a JSON object per the MCP spec (verified against @modelcontextprotocol/sdk
 * types: it is an object, not a bare array), so the array is wrapped as
 * `{ members: [...] }`. The JSON `text` block carries the SAME `{ members: [...] }`
 * shape, so a client reading either view sees identical data.
 */
function successResult(members: DirectoryMember[]): CallToolResult {
  const wire: MemberWire[] = members.map(memberToWire);
  const envelope = { members: wire };
  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Register the `list_members` tool on the given board server, closing over the injected
 * `DataAccess` and the per-connection {@link SessionIdentity} holder. Follows the
 * thin-tool pattern via `registerCoreTool`: validate (Zod) → check the session
 * precondition (established identity, NO membership) → delegate to
 * `core.boardDirectory` → map each `DirectoryMember` to the snake_case wire and wrap as
 * `{ members: [...] }`. A thrown `BoardError` (`NO_IDENTITY` for no session,
 * `BOARD_NOT_FOUND` for an unknown sub-board) is routed through `error-map.ts` by the
 * helper to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.boardDirectory`.
 * @param session The per-connection session-identity holder read for the precondition.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerListMembersTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'list_members',
    {
      description:
        "List a sub-board's member directory — each member's handle, current_focus, and last_seen (so you can see who is on the board, what each is working on, and how recently each was active). Reading requires an established identity (register or login first, else NO_IDENTITY) but NOT membership: a non-member can read the directory. Fails with BOARD_NOT_FOUND if no sub-board with that project_id was announced. last_seen is the raw derived timestamp; deciding whether a member is stale is a display concern for the consumer.",
      inputSchema: LIST_MEMBERS_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: an established identity is required to read (NO
      // membership — open read). With no identity there is no registered actor —
      // reject with NO_IDENTITY (mapped by registerCoreTool). No event is appended
      // (this is a read).
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the existence check + membership ⋈ identity join to core, map
      // the records to the wire envelope.
      const members = await boardDirectory(dataAccess, args.project_id);
      return successResult(members);
    },
  );
}
