// The `unreact` MCP tool (Story 5.2, Task 5 / AC #2, #3, #4, #5).
//
// An Epic 5 MESSAGE tool — RETRACTING a 👍 from a specific message (identified by its `seq`).
// The counterpart of `react`: SESSION-REQUIRED (actor = the session handle, NOT a tool param),
// THIN — (1) the Zod input schema at the snake_case wire boundary (`message_seq` via the shared
// `messageSeqSchema` — a positive int), (2) the session precondition (no identity →
// `BoardError('NO_IDENTITY')`, routed to the `{ code, message }` isError result by
// `error-map.ts` via `registerCoreTool`), and (3) delegating to `core.unreact` + mapping its
// `{ messageSeq, reactions }` result to the `{ message_seq, reactions }` wire envelope.
//
// `core.unreact` gates the actor on participating in the MESSAGE's room (→ NOT_A_MEMBER) and
// resolves the message (→ MESSAGE_NOT_FOUND). It appends ONLY the actor's own `message.unreacted`
// and liveness is scoped per actor, so an unreact can flip ONLY the actor's own 👍 — you CANNOT
// retract another identity's reaction (AC #2, INHERENT — no guard). Unreacting when you hold no
// live 👍 is an idempotent no-op (appends nothing). All board logic is core's; this handler adds
// only the session gate and the wire mapping. The live 👍 state is DERIVED (latest-react-wins);
// `read_room` surfaces each message's live reactors after the retraction.
//
// No NEW error code is introduced BY THE TOOL: NO_IDENTITY + NOT_A_MEMBER were already in the
// closed set; MESSAGE_NOT_FOUND was added to the closed set in core (Story 5.2). Any thrown
// BoardError is mapped by registerCoreTool, so this handler needs no per-code branching.

import { BoardError, unreact } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { messageSeqSchema } from './room-shared.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccess, ReactResult } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `unreact` tool input schema — snake_case wire params. `message_seq` is a positive integer
 * (the `seq` identifying the message whose 👍 to retract; reuses the shared `messageSeqSchema`).
 * The acting handle is NOT a param — it comes from the session holder. The SDK validates against
 * this and rejects an invalid call (missing / non-integer / zero / negative message_seq) BEFORE
 * the delegate runs, so no event is appended on an invalid call.
 */
const UNREACT_INPUT_SCHEMA = {
  message_seq: messageSeqSchema,
} as const;

/**
 * Build the success {@link CallToolResult} for an unreact. `structuredContent` MUST be a JSON
 * object per the MCP spec, so the result is the `{ message_seq, reactions }` envelope (the
 * message seq + its LIVE 👍 reactor handles after the op — the actor's own 👍 now absent, others
 * intact) — consistent with `react` and the room tools' read-back envelopes. The JSON `text`
 * block carries the SAME shape, so a client reading either view sees identical data.
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
 * Register the `unreact` tool on the given board server, closing over the injected `DataAccess`
 * and the per-connection {@link SessionIdentity} holder. Follows the thin-tool pattern via
 * `registerCoreTool`: validate (Zod) → check the session precondition → delegate to
 * `core.unreact` → map the `{ messageSeq, reactions }` result to the wire. A thrown `BoardError`
 * (`NO_IDENTITY` for no session, `MESSAGE_NOT_FOUND` for a non-message seq, `NOT_A_MEMBER` if the
 * actor does not participate in the message's room) is routed through `error-map.ts` by the
 * helper to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.unreact`.
 * @param session The per-connection session-identity holder read for the actor.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerUnreactTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'unreact',
    {
      description:
        "Retract a 👍 you previously placed on a specific message (by its seq) — unreact, to change your mind. You must be a PARTICIPANT of the message's room, else NOT_A_MEMBER. The message_seq must identify a message (an announcement or a reply), else MESSAGE_NOT_FOUND. Unreacting when you hold no live 👍 on the message is an idempotent no-op. You can only retract YOUR OWN 👍 — it never affects another identity's reaction. The live 👍 state is derived (latest react/unreact wins per actor); read_room shows each message's live reactors. Requires an established identity (register or login first, else NO_IDENTITY). Returns the message_seq plus its live reactor handles after the retraction.",
      inputSchema: UNREACT_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: the actor is the session handle. With no established identity there
      // is no actor to attribute the retraction to (and the participation gate cannot resolve) —
      // reject with NO_IDENTITY (mapped by registerCoreTool). No event is appended here.
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the message resolution + participation gate + idempotent
      // message.unreacted append + read-back to core, map { messageSeq, reactions } to the wire.
      const result = await unreact(
        dataAccess,
        session.handle,
        args.message_seq,
      );
      return successResult(result);
    },
  );
}
