// The `list_rooms` MCP tool (Story 4.2, Task 3 / AC #1, #2, #3, #4).
//
// A BOARD READ tool for a sub-board's ACTIVATED rooms — the rooms with ≥1 reply (active
// conversations). SESSION-REQUIRED like `list_members`/`list_projects` — an established
// identity is the only precondition; there is NO membership check (board-wide open read,
// FR9: a non-member sees the listing). THIN: the only logic here is (1) the snake_case Zod
// input schema (`project_id`), (2) the session precondition (read the per-connection
// holder; if no identity is established, throw `BoardError('NO_IDENTITY')` — routed to the
// `{ code, message }` isError result by `error-map.ts` via `registerCoreTool`), and (3)
// delegating to `core.listRooms` + mapping each `Room` to the snake_case wire via the
// shared `roomToWire`.
//
// The proto-vs-activated split + the BOARD_NOT_FOUND existence check are core's concern
// (`listRooms`); core stays session-agnostic. This handler adds no board logic — it only
// enforces the session gate and maps the wire. The companion `list_announcements` tool
// returns the still-PROTO rooms (the same shape, the complementary `active` filter).

import { BoardError, listRooms } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { projectIdSchema } from './project-shared.js';
import { roomToWire } from './room-shared.js';

import type { RoomWire } from './room-shared.js';
import type { SessionIdentity } from '../session.js';
import type { DataAccess, Room } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `list_rooms` tool input schema — snake_case wire params. `project_id` is a non-empty,
 * slug-charset string (the sub-board whose activated rooms to read); the acting identity is
 * NOT a param — it comes from the session holder. The SDK validates against this and rejects
 * an invalid call (missing/empty/non-slug project_id) BEFORE the delegate runs.
 */
const LIST_ROOMS_INPUT_SCHEMA = {
  project_id: projectIdSchema,
} as const;

/**
 * Build the success {@link CallToolResult} for the rooms listing. `structuredContent` MUST
 * be a JSON object per the MCP spec (an object, not a bare array), so the array is wrapped
 * as `{ rooms: [...] }`. The JSON `text` block carries the SAME `{ rooms: [...] }` shape, so
 * a client reading either view sees identical data.
 */
function successResult(rooms: Room[]): CallToolResult {
  const wire: RoomWire[] = rooms.map(roomToWire);
  const envelope = { rooms: wire };
  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Register the `list_rooms` tool on the given board server, closing over the injected
 * `DataAccess` and the per-connection {@link SessionIdentity} holder. Follows the thin-tool
 * pattern via `registerCoreTool`: validate (Zod) → check the session precondition
 * (established identity, NO membership) → delegate to `core.listRooms` → map each `Room` to
 * the snake_case wire and wrap as `{ rooms: [...] }`. A thrown `BoardError` (`NO_IDENTITY`
 * for no session, `BOARD_NOT_FOUND` for an unknown sub-board) is routed through
 * `error-map.ts` by the helper to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.listRooms`.
 * @param session The per-connection session-identity holder read for the precondition.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerListRoomsTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'list_rooms',
    {
      description:
        "List a sub-board's active rooms — the conversations that have at least one reply (a proto-room becomes a room when someone replies to it), each with its room_id, subject, body, posted_by, and seq, ordered by seq. Reading requires an established identity (register or login first, else NO_IDENTITY) but NOT membership: a non-member can browse the listing. Fails with BOARD_NOT_FOUND if no sub-board with that project_id was announced. Use list_announcements for the still-open announcements (those with no reply yet).",
      inputSchema: LIST_ROOMS_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: an established identity is required to read (NO membership —
      // open read). With no identity there is no registered actor — reject with NO_IDENTITY
      // (mapped by registerCoreTool). No event is appended (this is a read).
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the existence check + activated-room filter to core, map to the wire.
      const rooms = await listRooms(dataAccess, args.project_id);
      return successResult(rooms);
    },
  );
}
