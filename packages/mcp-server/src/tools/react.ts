// The `react` MCP tool (Story 5.2, Task 5 / AC #1, #3, #4, #5).
//
// An Epic 5 MESSAGE tool — placing a 👍 on a specific message (identified by its `seq`).
// SESSION-REQUIRED like `reply`/`add_participant`: its actor is the session handle, NOT a tool
// param. THIN — the only logic here is (1) the Zod input schema at the snake_case wire boundary
// (`message_seq` via the shared `messageSeqSchema` — a positive int), (2) the session
// precondition (read the per-connection holder; if no identity is established, throw
// `BoardError('NO_IDENTITY')` — routed to the `{ code, message }` isError result by
// `error-map.ts` via `registerCoreTool`), and (3) delegating to `core.react` + mapping its
// `{ messageSeq, reactions }` result to the `{ message_seq, reactions }` wire envelope.
//
// Reacting REQUIRES participation and does NOT grant it (CONTRAST `reply`, which grants): a 👍 is
// a ratification signal within a negotiation you are already in. So `core.react` gates the actor
// on participating in the MESSAGE's room (→ NOT_A_MEMBER otherwise) and resolves the message
// (→ MESSAGE_NOT_FOUND for a non-message `message_seq`). That gate + the idempotent no-op (a
// re-react when already live appends nothing) are core's concern; this handler adds no board
// logic — only the session gate and the wire mapping. The LIVE 👍 state is DERIVED (latest-react-
// wins), never stored — `read_room` surfaces each message's live reactors.
//
// No NEW error code is introduced BY THE TOOL: NO_IDENTITY + NOT_A_MEMBER were already in the
// closed set; MESSAGE_NOT_FOUND is added to the closed set in core (Story 5.2, additively — see
// core/errors.ts) for the non-message case AC #3 names. Any thrown BoardError is mapped by
// registerCoreTool, so this handler needs no per-code branching.

import { BoardError, react } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { messageSeqSchema } from './room-shared.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccess, ReactResult } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `react` tool input schema — snake_case wire params. `message_seq` is a positive integer
 * (the `seq` identifying the message to react to; reuses the shared `messageSeqSchema`). The
 * acting handle is NOT a param — it comes from the session holder. The SDK validates against this
 * and rejects an invalid call (missing / non-integer / zero / negative message_seq) BEFORE the
 * delegate runs, so no event is appended on an invalid call.
 */
const REACT_INPUT_SCHEMA = {
  message_seq: messageSeqSchema,
} as const;

/**
 * Build the success {@link CallToolResult} for a react. `structuredContent` MUST be a JSON object
 * per the MCP spec, so the result is the `{ message_seq, reactions }` envelope (the message seq +
 * its LIVE 👍 reactor handles after the op) — consistent with the room tools' read-back
 * envelopes. The JSON `text` block carries the SAME shape, so a client reading either view sees
 * identical data.
 */
function successResult(result: ReactResult): CallToolResult {
  const envelope = {
    message_seq: result.messageSeq,
    reactions: result.reactions,
  };
  return {
    structuredContent: envelope,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Register the `react` tool on the given board server, closing over the injected `DataAccess`
 * and the per-connection {@link SessionIdentity} holder. Follows the thin-tool pattern via
 * `registerCoreTool`: validate (Zod) → check the session precondition → delegate to `core.react`
 * → map the `{ messageSeq, reactions }` result to the wire. A thrown `BoardError` (`NO_IDENTITY`
 * for no session, `MESSAGE_NOT_FOUND` for a non-message seq, `NOT_A_MEMBER` if the actor does not
 * participate in the message's room) is routed through `error-map.ts` by the helper to the closed
 * `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.react`.
 * @param session The per-connection session-identity holder read for the actor.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerReactTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'react',
    {
      description:
        "Place a 👍 on a specific message (by its seq) to signal agreement — react. You must be a PARTICIPANT of the message's room (you have replied to it or were added), else it fails with NOT_A_MEMBER: reacting ratifies a negotiation you are in, it does NOT join you to it (only reply/add_participant do that). The message_seq must identify a message — the room's seeding announcement or a reply — else MESSAGE_NOT_FOUND. Re-reacting a message you already hold a live 👍 on is an idempotent no-op. The live 👍 state is derived (latest react/unreact wins per actor); read_room shows each message's live reactors. Requires an established identity (register or login first, else NO_IDENTITY). Returns the message_seq plus its live reactor handles after the react.",
      inputSchema: REACT_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: the actor is the session handle. With no established identity there
      // is no actor to attribute the 👍 to (and the participation gate cannot resolve) — reject
      // with NO_IDENTITY (mapped by registerCoreTool). No event is appended here.
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the message resolution + participation gate + idempotent message.reacted
      // append + read-back to core, map the { messageSeq, reactions } result to the wire envelope.
      const result = await react(dataAccess, session.handle, args.message_seq);
      return successResult(result);
    },
  );
}
