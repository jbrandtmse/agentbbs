// The `post_announcement` MCP tool (Story 4.1, Task 5 / AC #1, #2, #3, #6).
//
// The first Epic 4 ROOM tool. SESSION-REQUIRED, like `announce_project`: its actor is
// the session handle, NOT a tool param. THIN — the only logic here is (1) the Zod input
// schema at the snake_case wire boundary (`project_id`, `subject`, `body`), (2) the
// session precondition (read the per-connection holder; if no identity is established,
// throw `BoardError('NO_IDENTITY')` — routed to the `{ code, message }` isError result by
// `error-map.ts` via `registerCoreTool`), and (3) delegating to `core.postAnnouncement` +
// mapping its `Room` to the snake_case wire.
//
// The MEMBERSHIP gate (NOT_A_MEMBER / BOARD_NOT_FOUND) lives in core (postAnnouncement
// calls requireMembership first) — NOT here; this handler adds no board logic. The
// session precondition is the only SERVER concern (which handle this connection acts as),
// so it lives in the delegate. core stays session-agnostic.
//
// No NEW error code: NOT_A_MEMBER + BOARD_NOT_FOUND are already in the closed set (Epic 3)
// and any thrown BoardError is mapped by registerCoreTool. The announcement `body` is
// validated non-empty at the Zod boundary (`announcementBodySchema`, `.min(1)`); the formal
// 256 KB `BODY_TOO_LARGE` size cap (Story 5.1) is enforced in CORE (`assertBodyWithinCap`, on
// UTF-8 byte length) AFTER the membership gate and before any append — so a non-member's
// over-cap post is rejected NOT_A_MEMBER first, and an over-cap body otherwise surfaces the
// closed `BODY_TOO_LARGE` code; this thin tool adds no body-size logic of its own.

import { BoardError, postAnnouncement } from '@agentbbs/core';

import { registerCoreTool } from '../register-tool.js';
import { projectIdSchema } from './project-shared.js';
import {
  announcementBodySchema,
  announcementSubjectSchema,
  roomToWire,
} from './room-shared.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccess, Room } from '@agentbbs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The `post_announcement` tool input schema — snake_case wire params. `project_id` is a
 * slug (reused from `project-shared.ts`), `subject`/`body` are non-empty, length-bounded
 * strings; the acting handle is NOT a param — it comes from the session holder. The SDK
 * validates against this and rejects invalid calls (missing/empty field, malformed
 * project_id) BEFORE the delegate runs, so no event is appended on an invalid call.
 */
const POST_ANNOUNCEMENT_INPUT_SCHEMA = {
  project_id: projectIdSchema,
  subject: announcementSubjectSchema,
  body: announcementBodySchema,
} as const;

/**
 * Build the success {@link CallToolResult} for a posted proto-room. Carries the room
 * under a `{ room }` envelope in BOTH `structuredContent` (an object, as MCP requires)
 * and a JSON `text` block (mirrors the other tools), so a client reading either view sees
 * the same `{ room_id, project_id, subject, body, posted_by, seq, active }`.
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
 * Register the `post_announcement` tool on the given board server, closing over the
 * injected `DataAccess` and the per-connection {@link SessionIdentity} holder. Follows
 * the thin-tool pattern via `registerCoreTool`: validate (Zod) → check the session
 * precondition → delegate to `core.postAnnouncement` → map result (camelCase room →
 * snake_case wire). A thrown `BoardError` (`NO_IDENTITY` for no session, `NOT_A_MEMBER`
 * for a non-member of the board, `BOARD_NOT_FOUND` for an unknown board) is routed
 * through `error-map.ts` by the helper to the closed `{ code, message }` contract.
 *
 * @param server The board `McpServer` to register on.
 * @param dataAccess The persistence port the delegate hands to `core.postAnnouncement`.
 * @param session The per-connection session-identity holder read for the actor.
 * @returns The SDK's `RegisteredTool` handle.
 */
export function registerPostAnnouncementTool(
  server: McpServer,
  dataAccess: DataAccess,
  session: SessionIdentity,
): ReturnType<McpServer['registerTool']> {
  return registerCoreTool(
    server,
    'post_announcement',
    {
      description:
        'Post an announcement (subject + body) to a sub-board you are a member of, opening a proto-room peers can discover and reply to. Requires an established identity — register or login first, else fails with NO_IDENTITY. Fails with BOARD_NOT_FOUND if the project_id does not exist, or NOT_A_MEMBER if you have not joined that sub-board. The room id is the subject slug with a short disambiguator on collision; a same-subject post never fails — it gets a distinct id.',
      inputSchema: POST_ANNOUNCEMENT_INPUT_SCHEMA,
    },
    async (args): Promise<CallToolResult> => {
      // Session precondition: the actor is the session handle. With no established
      // identity there is no actor to attribute the announcement to — reject with
      // NO_IDENTITY (mapped by registerCoreTool). No event is appended on this path.
      if (session.handle === null) {
        throw new BoardError(
          'NO_IDENTITY',
          'No established identity for this session — register or login first.',
        );
      }
      // Thin: delegate the membership gate + room-id allocation + append + read-back to
      // core, map the returned Room back to the wire shape.
      const room = await postAnnouncement(dataAccess, session.handle, {
        projectId: args.project_id,
        subject: args.subject,
        body: args.body,
      });
      return successResult(room);
    },
  );
}
