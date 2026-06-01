// The `read_contract` MCP tool (Story 5.3, Task 2 / AC #1, #4, #5) — FR21, the marquee Epic 5
// capability.
//
// A ROOM READ tool for the room's CURRENT AGREED CONTRACT — the highest-`seq` message currently
// holding a live 👍 (the message the board has most-recently ratified), or `null` ("no contract
// yet"). SESSION-REQUIRED like the other read tools (`read_room`/`list_rooms`/`list_members`):
// an established identity is the ONLY precondition; there is NO membership check (an OPEN,
// board-wide read, FR9 — the contract is "computed by ANY reader", even a non-participant, even
// before they join). THIN: the only logic here is (1) the snake_case Zod input schema (`room_id`,
// reusing the shared `roomIdSchema`), (2) the session precondition (read the per-connection
// holder; no identity → `BoardError('NO_IDENTITY')`, routed to the `{ code, message }` isError
// result by `error-map.ts` via `registerCoreTool`), and (3) delegating to `core.readContract` +
// mapping the result to the wire: `{ room_id, contract: messageToWire(msg) | null }`.
//
// The contract computation, the room-existence (`ROOM_NOT_FOUND`) check, and the
// existence-vs-emptiness distinction are core's concern (`readContract` → `findRoom` +
// `currentContract`); core stays session-agnostic. This handler adds no board logic — it only
// enforces the session gate and maps the wire. `ROOM_NOT_FOUND` propagates through `error-map.ts`
// (already in the closed set — NO new code); a known room with no live 👍 yet is `contract: null`
// (NOT an error) — DISTINCT from the unknown-room `ROOM_NOT_FOUND`. THE APPEND INVARIANT: the
// contract is DERIVED by query every call, never stored — so it reverts automatically on
// retraction (a re-read recomputes the next-highest live-👍'd message, or `null`). NO new event
// type, NO new error code.

import { BoardError, readContract } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { messageToWire, roomIdSchema } from './room-shared.js';

import type { MessageWire } from './room-shared.js';
import type { SessionIdentity } from '../session.js';
import type { DataAccess, RoomMessage } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `read_contract` tool input schema — snake_case wire params. `room_id` is a non-empty,
 * slug-charset string (the room whose current contract to compute); the acting identity is NOT a
 * param — it comes from the session holder. The SDK validates against this and rejects an invalid
 * call (missing/empty/non-slug room_id) BEFORE the delegate runs, so core only ever sees a
 * well-formed id — an unknown-but-well-formed id is the ROOM_NOT_FOUND case core owns.
 */
const READ_CONTRACT_INPUT_SCHEMA = {
  room_id: roomIdSchema,
} as const;

/**
 * Build the success {@link CallToolResult} for a room's current contract. `structuredContent`
 * MUST be a JSON object per the MCP spec, so the result is the `{ room_id, contract }` envelope —
 * the room id echoed back plus the contract MESSAGE (`messageToWire`: seq/actor/body/kind/
 * reactions) or `null` for "no contract yet" (the JSON `null` absence convention, NOT an empty
 * object). The JSON `text` block carries the SAME shape, so a client reading either view sees
 * identical data. The envelope is an inferred object literal (mirrors `read-room.ts`) so it
 * structurally satisfies the SDK's `structuredContent` index-signature constraint.
 */
function successResult(
  roomId: string,
  contract: RoomMessage | null,
): CallToolResult {
  const wire: MessageWire | null =
    contract === null ? null : messageToWire(contract);
  const envelope = { room_id: roomId, contract: wire };
  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Register the `read_contract` tool on the given board server, closing over the injected
 * `DataAccess` and the per-connection {@link SessionIdentity} holder. Follows the thin-tool
 * pattern via `registerCoreTool`: validate (Zod) → check the session precondition (established
 * identity, NO membership — open read) → delegate to `core.readContract` → map the
 * `RoomMessage | null` to the `{ room_id, contract }` wire envelope. A thrown `BoardError`
 * (`NO_IDENTITY` for no session, `ROOM_NOT_FOUND` for an unknown room) is routed through
 * `error-map.ts` by the helper to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.readContract`.
 * @param session The per-connection session-identity holder read for the precondition.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerReadContractTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'read_contract',
    {
      description:
        "Read a room's CURRENT AGREED CONTRACT — the message that currently holds the agreement, computed (never stored) as the message with the HIGHEST seq that currently has at least one live 👍 (a 👍 is the ratification signal; the most-recent ratified message wins). Returns the room_id plus the contract message (seq, actor, body, kind, reactions) — \"show me the agreed text\" — or contract: null when no message holds a live 👍 yet (\"no contract yet\"). The contract reverts automatically when the agreed message's last 👍 is retracted (a re-read yields the next-highest live-👍'd message, or null) — nothing is stored to revert. The seeding announcement (message #1) can itself be the contract if it is the highest-seq live-👍'd message. Reading requires an established identity (register or login first, else NO_IDENTITY) but NOT membership or participation: any identity can compute any room's contract on demand. Fails with ROOM_NOT_FOUND if no room with that room_id was ever announced (distinct from contract: null, which means the room exists but has no live 👍 yet).",
      inputSchema: READ_CONTRACT_INPUT_SCHEMA,
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
      // Thin: delegate the existence check (ROOM_NOT_FOUND) + contract computation to core, map
      // the RoomMessage | null result to the { room_id, contract } wire envelope.
      const contract = await readContract(dataAccess, args.room_id);
      return successResult(args.room_id, contract);
    },
  );
}
