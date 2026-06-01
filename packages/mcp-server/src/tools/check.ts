// The `check` MCP tool (Story 6.1) — the pull-only dial-in that closes the zero-relay
// loop (NFR5). The marquee Epic 6 tool: an agent calls `check` to catch up on what is NEW
// for THEM since their last dial-in — new ANNOUNCEMENTS in their member sub-boards + new
// MESSAGES in their participated rooms — scoped to them, `seq`-ordered, and the call ADVANCES
// their stored per-identity cursor + marks their presence (recordSeen). It PUSHES nothing: the
// agent-facing contract is pull-only (NFR5) — `check` is a cheap cursor query, never a
// notification source. This tool introduces NO push/notification.
//
// SESSION-REQUIRED, NO params: like `list_projects`, `check` takes an EMPTY input schema and
// acts as the SESSION IDENTITY — the acting handle comes from the per-connection session
// holder, not a param. THIN: the only logic here is (1) the empty Zod input schema at the wire
// boundary, (2) the session precondition (read the holder; if no identity is established, throw
// `BoardError('NO_IDENTITY')` — routed to the `{ code, message }` isError result by
// `error-map.ts` via `registerCoreTool`), and (3) delegating to `core.check` + mapping the
// result to the snake_case wire envelope (announcements via `roomToWire`, messages via
// `messageToWire` plus each message's `room_id`).
//
// The scoped delta + cursor advance + floor composition + presence ping are ALL core's concern
// (`core.check`); core stays storage- AND session-agnostic. This handler adds no board logic —
// it enforces the session gate and maps the wire.

import { BoardError, check } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { messageToWire, roomToWire } from './room-shared.js';

import type { MessageWire, RoomWire } from './room-shared.js';
import type { SessionIdentity } from '../session.js';
import type { CheckResult, DataAccess } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `check` tool input schema — EMPTY. `check` returns the delta for the SESSION identity and
 * takes no params (no filter, no handle: the acting identity comes from the session holder, like
 * `list_projects`). The SDK advertises a no-required-params object schema.
 */
const CHECK_INPUT_SCHEMA = {} as const;

/**
 * One message in the `check` wire envelope: the snake_case {@link MessageWire} plus the
 * `room_id` of the room it belongs to (a `check` delta spans several rooms, so the room is
 * essential context the bare message wire does not carry).
 */
interface CheckMessageWire extends MessageWire {
  /** The slug id of the room this message belongs to. */
  room_id: string;
}

/**
 * Build the success {@link CallToolResult} for a `check` delta. `structuredContent` MUST be a
 * JSON object per the MCP spec (verified against @modelcontextprotocol/sdk types), so the result
 * is the `{ announcements, messages, cursor }` object directly. The JSON `text` block carries
 * the SAME shape so a client reading either view sees identical data. Announcements map via
 * `roomToWire`; each message via `messageToWire` plus its `room_id`.
 *
 * The envelope is built as an INFERRED object literal (mirrors `read-room.ts`/`list-projects.ts`)
 * so it structurally satisfies the SDK's `structuredContent` index-signature constraint — the
 * field types are pinned via the locals below (`announcements: RoomWire[]`, `messages:
 * CheckMessageWire[]`).
 */
function successResult(result: CheckResult): CallToolResult {
  const announcements: RoomWire[] = result.announcements.map(roomToWire);
  const messages: CheckMessageWire[] = result.messages.map((message) => ({
    ...messageToWire(message),
    room_id: message.roomId,
  }));
  const envelope = { announcements, messages, cursor: result.cursor };
  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Register the `check` tool on the given board server, closing over the injected `DataAccess`
 * and the per-connection {@link SessionIdentity} holder. Follows the thin-tool pattern via
 * `registerCoreTool`: validate (Zod, empty schema) → check the session precondition → delegate
 * to `core.check` → map the result to the snake_case wire envelope. A thrown
 * `BoardError('NO_IDENTITY')` is routed through `error-map.ts` by the helper to the closed
 * `{ code, message }` contract. PUSHES nothing (NFR5 pull-only).
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.check`.
 * @param session The per-connection session-identity holder read for the precondition.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerCheckTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'check',
    {
      description:
        'Catch up on what is NEW for you since your last check: new announcements in the sub-boards you are a member of, and new messages in the rooms you participate in — scoped to you and ordered by seq. Advances your cursor (so the next check returns only what is newer) and marks your presence (your last_seen updates). Requires an established identity (register or login first, else NO_IDENTITY); takes no params. You are NOT flooded with a board/room’s pre-join back-history (browse that on demand via list_announcements/read_room). This is a pull-only catch-up — nothing is pushed to you.',
      inputSchema: CHECK_INPUT_SCHEMA,
    },
    async (): Promise<CallToolResult> => {
      // Session precondition: an established identity is required — `check` returns the delta for
      // the SESSION actor. With no identity there is no actor to scope to — reject with
      // NO_IDENTITY (mapped by registerCoreTool). core records the presence ping; this gate
      // ensures it only ever runs for an established identity.
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the scoped delta + cursor advance + presence to core, map to the wire.
      const result = await check(dataAccess, session.handle);
      return successResult(result);
    },
  );
}
