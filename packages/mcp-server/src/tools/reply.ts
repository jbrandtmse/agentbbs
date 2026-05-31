// The `reply` MCP tool (Story 4.3, Task 3 / AC #1, #2, #3, #5).
//
// The keystone Epic 4 ROOM tool — a reply activates a proto-room into a live multi-party
// room. SESSION-REQUIRED like `post_announcement`: its actor is the session handle, NOT a
// tool param. THIN — the only logic here is (1) the Zod input schema at the snake_case wire
// boundary (`room_id`, `body`), (2) the session precondition (read the per-connection
// holder; if no identity is established, throw `BoardError('NO_IDENTITY')` — routed to the
// `{ code, message }` isError result by `error-map.ts` via `registerCoreTool`), and (3)
// delegating to `core.reply` + mapping its `Room` to the snake_case wire.
//
// CONTRAST with `post_announcement`: `reply` does NOT gate on membership — it GRANTS it.
// `post_announcement` requires membership of the target sub-board (NOT_A_MEMBER); `reply`
// lets ANY established identity reply to a room it discovered via open read (FR9), and the
// act of replying AUTO-JOINS them to the room's sub-board ("acting = joining", FR10). That
// auto-join + the activation are core's concern (`reply` appends room.replied + a
// conditional board.joined); this handler adds no board logic. The session precondition is
// the only SERVER concern (which handle this connection acts as), so it lives in the delegate.
// core stays session-agnostic.
//
// No NEW error code: ROOM_NOT_FOUND + NO_IDENTITY are already in the closed set (Epics 3/2)
// and any thrown BoardError is mapped by registerCoreTool. The 256 KB body cap /
// BODY_TOO_LARGE is Epic 5 Story 5.1 — `room-shared.ts` uses a sane interim cap (shared with
// post_announcement) and explicitly defers the formal cap; this story introduces no
// body-size code.

import { BoardError, reply } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import {
  announcementBodySchema,
  roomIdSchema,
  roomToWire,
} from './room-shared.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccess, Room } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `reply` tool input schema — snake_case wire params. `room_id` is a non-empty,
 * slug-charset string (the room to reply to); `body` is a non-empty, length-bounded string
 * (the reply body, the same interim cap as post_announcement). The acting handle is NOT a
 * param — it comes from the session holder. The SDK validates against this and rejects an
 * invalid call (missing/empty/non-slug room_id, missing/empty body) BEFORE the delegate
 * runs, so no event is appended on an invalid call.
 */
const REPLY_INPUT_SCHEMA = {
  room_id: roomIdSchema,
  body: announcementBodySchema,
} as const;

/**
 * Build the success {@link CallToolResult} for the now-active room. Carries the room under
 * a `{ room }` envelope in BOTH `structuredContent` (an object, as MCP requires) and a JSON
 * `text` block (mirrors the other tools), so a client reading either view sees the same
 * `{ room_id, project_id, subject, body, posted_by, seq, active, activated_by,
 * activated_at_seq }` (the activator fields present now that the room is active).
 */
function successResult(room: Room): CallToolResult {
  const wire = roomToWire(room);
  const envelope = { room: wire };
  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Register the `reply` tool on the given board server, closing over the injected
 * `DataAccess` and the per-connection {@link SessionIdentity} holder. Follows the thin-tool
 * pattern via `registerCoreTool`: validate (Zod) → check the session precondition →
 * delegate to `core.reply` → map result (camelCase room → snake_case wire). A thrown
 * `BoardError` (`NO_IDENTITY` for no session, `ROOM_NOT_FOUND` for an unknown room) is
 * routed through `error-map.ts` by the helper to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.reply`.
 * @param session The per-connection session-identity holder read for the actor.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerReplyTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'reply',
    {
      description:
        "Reply to a room — a proto-room (an announcement with no reply yet) becomes a live, active room on its first reply. You do NOT need to be a member of the room's sub-board: replying auto-joins you to it (acting = joining), so any established identity can reply to a room it discovered. Requires an established identity — register or login first, else fails with NO_IDENTITY. Fails with ROOM_NOT_FOUND if the room_id does not exist. The first reply (lowest seq) activates the room and is recorded as its activator; concurrent replies all land with no collision.",
      inputSchema: REPLY_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: the actor is the session handle. With no established
      // identity there is no actor to attribute the reply to (and no one to auto-join) —
      // reject with NO_IDENTITY (mapped by registerCoreTool). No event is appended here.
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the room lookup + room.replied append + conditional auto-join +
      // read-back to core, map the now-active Room back to the wire shape.
      const room = await reply(dataAccess, session.handle, {
        roomId: args.room_id,
        body: args.body,
      });
      return successResult(room);
    },
  );
}
