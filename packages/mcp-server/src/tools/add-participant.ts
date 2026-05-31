// The `add_participant` MCP tool (Story 4.5, Task 3 / AC #1, #2, #3, #4) — the 12th (final
// V1) tool.
//
// An Epic 4 ROOM WRITE tool — pulling a registered peer into a room mid-negotiation.
// SESSION-REQUIRED like `reply`/`post_announcement`: its actor is the session handle, NOT a
// tool param. THIN — the only logic here is (1) the Zod input schema at the snake_case wire
// boundary (`room_id` via the shared `roomIdSchema`, `handle` via the shared `handleSchema`
// the register/login tools use — canonicalization happens in core), (2) the session
// precondition (read the per-connection holder; if no identity is established, throw
// `BoardError('NO_IDENTITY')` — routed to the `{ code, message }` isError result by
// `error-map.ts` via `registerCoreTool`), and (3) delegating to `core.addParticipant` +
// mapping its `{ room, participants }` result to the wire.
//
// CONTRAST with `reply`: `reply` GRANTS membership to ANY established identity (replying
// auto-joins the replier). `add_participant` GATES the ACTOR on room PARTICIPATION first (you
// can only pull a peer into a negotiation you are part of → NOT_A_MEMBER otherwise), and the
// auto-join it triggers is for the TARGET (the pulled-in peer joins the board), not the actor.
// That gate + the conditional target-join + the idempotent re-add are all core's concern; this
// handler adds no board logic — only the session gate and the wire mapping.
//
// No NEW error code is introduced BY THE TOOL: NOT_A_MEMBER + ROOM_NOT_FOUND + NO_IDENTITY were
// already in the closed set; HANDLE_NOT_FOUND is added to the closed set in core (Story 4.5,
// additively — see core/errors.ts) for the target-unknown case AC #2 names. Any thrown
// BoardError is mapped by registerCoreTool, so this handler needs no per-code branching.

import { BoardError, addParticipant } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { handleSchema } from './identity-shared.js';
import { roomIdSchema, roomToWire } from './room-shared.js';

import type { RoomWire } from './room-shared.js';
import type { SessionIdentity } from '../session.js';
import type { AddParticipantResult, DataAccess } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `add_participant` tool input schema — snake_case wire params. `room_id` is a non-empty,
 * slug-charset string (the room to pull the peer into); `handle` is the canonical-charset
 * handle of the TARGET identity to add (reuses the register/login `handleSchema` — non-empty,
 * lowercase `[a-z0-9._@-]`; canonicalization itself happens in core). The acting handle is NOT
 * a param — it comes from the session holder. The SDK validates against this and rejects an
 * invalid call (missing/empty/non-slug room_id, missing/empty/out-of-charset handle) BEFORE
 * the delegate runs, so no event is appended on an invalid call.
 */
const ADD_PARTICIPANT_INPUT_SCHEMA = {
  room_id: roomIdSchema,
  handle: handleSchema,
} as const;

/**
 * Build the success {@link CallToolResult} for an add. `structuredContent` MUST be a JSON
 * object per the MCP spec, so the result is the `{ room, participants }` envelope (the room
 * metadata once + the participant handle list) — consistent with the other room tools'
 * `{ room }` / `{ room, messages }` envelopes. The JSON `text` block carries the SAME shape,
 * so a client reading either view sees identical data.
 */
function successResult(result: AddParticipantResult): CallToolResult {
  const room: RoomWire = roomToWire(result.room);
  const envelope = { room, participants: result.participants };
  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Register the `add_participant` tool on the given board server, closing over the injected
 * `DataAccess` and the per-connection {@link SessionIdentity} holder. Follows the thin-tool
 * pattern via `registerCoreTool`: validate (Zod) → check the session precondition → delegate
 * to `core.addParticipant` → map the `{ room, participants }` result to the wire. A thrown
 * `BoardError` (`NO_IDENTITY` for no session, `ROOM_NOT_FOUND` for an unknown room,
 * `NOT_A_MEMBER` if the actor is not a participant, `HANDLE_NOT_FOUND` for an unregistered
 * target) is routed through `error-map.ts` by the helper to the closed `{ code, message }`
 * contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.addParticipant`.
 * @param session The per-connection session-identity holder read for the actor.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerAddParticipantTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'add_participant',
    {
      description:
        "Pull a registered peer into a room you are part of — add_participant by handle. You must be a PARTICIPANT of the room (you have replied to it or were previously added), else it fails with NOT_A_MEMBER: you can only bring a peer into a negotiation you are in. The target handle must be a registered identity, else HANDLE_NOT_FOUND. On success the target becomes a participant of the room AND a member of the room's sub-board if not already (a board.joined for the target — acting = joining, but for the pulled-in peer), so they can immediately read and participate. Re-adding an existing participant is an idempotent no-op. Requires an established identity (register or login first, else NO_IDENTITY). Fails with ROOM_NOT_FOUND if the room_id does not exist. Returns the room plus its current participant handles.",
      inputSchema: ADD_PARTICIPANT_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: the actor is the session handle. With no established identity
      // there is no actor to attribute the add to (and the participation gate cannot resolve) —
      // reject with NO_IDENTITY (mapped by registerCoreTool). No event is appended here.
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the room lookup + participation gate + target resolution +
      // participant_added append + conditional target auto-join + read-back to core, map the
      // { room, participants } result to the wire envelope.
      const result = await addParticipant(dataAccess, session.handle, {
        roomId: args.room_id,
        handle: args.handle,
      });
      return successResult(result);
    },
  );
}
