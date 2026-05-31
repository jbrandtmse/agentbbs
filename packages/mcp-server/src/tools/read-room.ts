// The `read_room` MCP tool (Story 4.4, Task 3 / AC #1, #2, #3, #6).
//
// A ROOM READ tool for a room's COMPLETE, ordered history — the seeding announcement as
// message #1, then every reply by `seq` — plus the room metadata. SESSION-REQUIRED like the
// other read tools (`list_rooms`/`list_members`/`list_projects`): an established identity is
// the ONLY precondition; there is NO membership check (an OPEN, board-wide read, FR9 — a
// non-member, never-replied identity can read the full history on demand, even before they
// join). THIN: the only logic here is (1) the snake_case Zod input schema (`room_id`, reusing
// the shared `roomIdSchema`), (2) the session precondition (read the per-connection holder;
// no identity → `BoardError('NO_IDENTITY')`, routed to the `{ code, message }` isError result
// by `error-map.ts` via `registerCoreTool`), and (3) delegating to `core.readRoom` + mapping
// the result to the wire: `{ room: roomToWire(room), messages: messages.map(messageToWire) }`.
//
// The history projection + the ROOM_NOT_FOUND existence check are core's concern
// (`readRoom`/`roomMessages`); core stays session-agnostic. This handler adds no board logic
// — it only enforces the session gate and maps the wire. `ROOM_NOT_FOUND` propagates through
// `error-map.ts` (already in the closed set — NO new code).

import { BoardError, readRoom } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { messageToWire, roomIdSchema, roomToWire } from './room-shared.js';

import type { MessageWire, RoomWire } from './room-shared.js';
import type { SessionIdentity } from '../session.js';
import type { DataAccess, RoomHistory } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `read_room` tool input schema — snake_case wire params. `room_id` is a non-empty,
 * slug-charset string (the room whose history to read); the acting identity is NOT a param —
 * it comes from the session holder. The SDK validates against this and rejects an invalid
 * call (missing/empty/non-slug room_id) BEFORE the delegate runs, so core only ever sees a
 * well-formed id — an unknown-but-well-formed id is the ROOM_NOT_FOUND case core owns.
 */
const READ_ROOM_INPUT_SCHEMA = {
  room_id: roomIdSchema,
} as const;

/**
 * Build the success {@link CallToolResult} for a room's history. `structuredContent` MUST be
 * a JSON object per the MCP spec, so the result is the `{ room, messages }` envelope (the
 * room metadata once + the `seq`-ordered messages array). The JSON `text` block carries the
 * SAME shape, so a client reading either view sees identical data. The envelope is built as
 * an inferred object literal (mirrors `list-rooms.ts`/`reply.ts`) so it structurally
 * satisfies the SDK's `structuredContent` index-signature constraint.
 */
function successResult(history: RoomHistory): CallToolResult {
  const room: RoomWire = roomToWire(history.room);
  const messages: MessageWire[] = history.messages.map(messageToWire);
  const envelope = { room, messages };
  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Register the `read_room` tool on the given board server, closing over the injected
 * `DataAccess` and the per-connection {@link SessionIdentity} holder. Follows the thin-tool
 * pattern via `registerCoreTool`: validate (Zod) → check the session precondition
 * (established identity, NO membership — open read) → delegate to `core.readRoom` → map the
 * `RoomHistory` to the `{ room, messages }` wire envelope. A thrown `BoardError`
 * (`NO_IDENTITY` for no session, `ROOM_NOT_FOUND` for an unknown room) is routed through
 * `error-map.ts` by the helper to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.readRoom`.
 * @param session The per-connection session-identity holder read for the precondition.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerReadRoomTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'read_room',
    {
      description:
        "Read a room's complete, ordered message history — the seeding announcement is message #1 (its subject is the room's, returned as room metadata; its body is message #1's body), followed by every reply in seq order. Returns the room metadata (room_id, project_id, subject, body, posted_by, seq, active, and the activator when active) plus the messages array (each with seq, actor, body, and kind: announcement or reply). Reading requires an established identity (register or login first, else NO_IDENTITY) but NOT membership or participation: any identity can read any room's full history on demand, even before joining. The history is never truncated (append-only). Fails with ROOM_NOT_FOUND if no room with that room_id was ever announced.",
      inputSchema: READ_ROOM_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: an established identity is required to read (NO membership —
      // open read, FR9). With no identity there is no registered actor — reject with
      // NO_IDENTITY (mapped by registerCoreTool). No event is appended (this is a read).
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the existence check + history projection to core, map to the wire.
      const history = await readRoom(dataAccess, args.room_id);
      return successResult(history);
    },
  );
}
