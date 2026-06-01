// The `join_board` MCP tool (Story 3.3, Task 3 / AC #1, #2, #4, #5).
//
// A BOARD tool, SESSION-REQUIRED like `announce_project`: its actor is the session
// handle, NOT a tool param. THIN — the only logic here is (1) the Zod input schema at
// the snake_case wire boundary (`project_id`), (2) the session precondition (read the
// per-connection holder; if no identity is established, throw `BoardError('NO_IDENTITY')`
// — routed to the `{ code, message }` isError result by `error-map.ts` via
// `registerCoreTool`), and (3) delegating to `core.joinBoard` + mapping its returned
// `Project` to the snake_case wire (surfacing `members` so the caller sees they joined).
//
// The board logic — the existence check, the idempotent-no-op short-circuit, and the
// `board.joined` append + read-back — lives in `core.joinBoard`. core stays session-
// agnostic; this handler adds no board logic.

import {
  BoardError,
  joinBoard,
  readProtocolAnnouncement,
} from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { projectIdSchema, projectToWire } from './project-shared.js';
import { roomToWire } from './room-shared.js';

import type { RoomWire } from './room-shared.js';
import type { SessionIdentity } from '../session.js';
import type { DataAccess, Project, Room } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `join_board` tool input schema — snake_case wire params. `project_id` is a
 * non-empty, slug-charset string (the id of the sub-board to join); the acting handle
 * is NOT a param — it comes from the session holder. The SDK validates against this
 * and rejects an invalid call (missing/empty/non-slug project_id) BEFORE the delegate
 * runs, so no event is appended on an invalid call.
 */
const JOIN_BOARD_INPUT_SCHEMA = {
  project_id: projectIdSchema,
} as const;

/**
 * The snake_case `join_board` wire envelope: the joined project's fields (incl. `members`, so the
 * caller sees their membership), plus the additive `protocol` (Story 7.2 / AC #4) — the seeded
 * main-board protocol announcement, so a new member MEETS the protocol on join too. `protocol` is
 * present whenever the board is SEEDED (the read is unconditional on join, mirroring the doc's
 * "meet the protocol on join"); it is OMITTED on an unseeded board (robust). It extends the
 * project wire shape, so the envelope keeps the project fields at the top level (back-compat).
 *
 * Build the success {@link CallToolResult} for a joined board. Carries the snake_case project
 * payload (including `members`) plus the additive `protocol` (when seeded — Story 7.2) in BOTH
 * `structuredContent` and a JSON `text` block (mirrors the other project tools). The `protocol`
 * is spread in ONLY when present, so the envelope stays an INFERRED object literal — required to
 * satisfy the SDK's `structuredContent` index-signature constraint (a NAMED type would not; the
 * Story 5.3 `structuredContent` gotcha). An unseeded board omits it (pre-7.2 envelope unchanged).
 *
 * @param project The joined project (from `core.joinBoard`).
 * @param protocol The seeded protocol room (from `core.readProtocolAnnouncement`), or `undefined`
 *   when the board is unseeded.
 */
function successResult(
  project: Project,
  protocol: Room | undefined,
): CallToolResult {
  const protocolField: { protocol: RoomWire } | Record<string, never> =
    protocol !== undefined ? { protocol: roomToWire(protocol) } : {};
  const envelope = { ...projectToWire(project), ...protocolField };
  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Register the `join_board` tool on the given board server, closing over the injected
 * `DataAccess` and the per-connection {@link SessionIdentity} holder. Follows the
 * thin-tool pattern via `registerCoreTool`: validate (Zod) → check the session
 * precondition → delegate to `core.joinBoard` → map result (camelCase project →
 * snake_case wire). A thrown `BoardError` (`NO_IDENTITY` for no session,
 * `BOARD_NOT_FOUND` for an unknown sub-board) is routed through `error-map.ts` by the
 * helper to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.joinBoard`.
 * @param session The per-connection session-identity holder read for the actor.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerJoinBoardTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'join_board',
    {
      description:
        'Join a sub-board by its project_id, becoming a member able to post in it and appear in its directory. You can be a member of multiple sub-boards at once. The result also includes a "protocol" field — the main-board "How This Board Works" announcement explaining the negotiation protocol and etiquette — so you meet the protocol on join. Requires an established identity — register or login first, else fails with NO_IDENTITY. Fails with BOARD_NOT_FOUND if no sub-board with that project_id was announced. Re-joining a board you already belong to is a harmless no-op.',
      inputSchema: JOIN_BOARD_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: the actor is the session handle. With no established
      // identity there is no actor to join as — reject with NO_IDENTITY (mapped by
      // registerCoreTool). No event is appended on this path.
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the existence check + idempotent join (append + read-back) to
      // core, map the returned Project back to the wire shape (members surfaced).
      const project = await joinBoard(
        dataAccess,
        session.handle,
        args.project_id,
      );
      // Surface the seeded protocol announcement so a new member MEETS the protocol on
      // join too (Story 7.2 / AC #4). A core READ (readProtocolAnnouncement) — the tool
      // stays thin; an idempotent re-join still surfaces it (the read is unconditional).
      // Robust to an unseeded board: `undefined` → the additive field is omitted.
      const protocol = await readProtocolAnnouncement(dataAccess);
      return successResult(project, protocol);
    },
  );
}
