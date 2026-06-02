// The `readRoom` board READ operation (Story 4.4, Task 2 / AC #1, #2, #3, #5).
//
// `readRoom(dataAccess, roomId)` is the read surface the `read_room` tool (Story 4.4)
// consumes: a room's metadata + its COMPLETE, ordered message history (the announcement as
// message #1, then every reply by `seq`). It is the FR9 "read a room's full history on
// demand, even before you join" guarantee — an OPEN read gated only on an established
// identity (enforced at the tool, NOT here), NEVER on membership or participation.
//
// Steps (THIN read, no append):
//   1. Read the whole `seq`-ordered stream once via the DataAccess port (`eventsSince(0)`).
//   2. Resolve the room via the Story 4.1 `findRoom` (the rooms projection). An unknown
//      `roomId` (never announced) throws `BoardError('ROOM_NOT_FOUND')` (AC #3) — the same
//      closed code `reply` uses; NO new error code.
//   3. Otherwise project the room's ordered message history via `roomMessages` (Story 4.4's
//      message-history fold) and return `{ room, messages }` (a {@link RoomHistory}).
//
// Derived state, NEVER stored (THE APPEND INVARIANT): both the room record and the message
// list are recomputed from events every call; there is no `rooms`/`messages`/`history`
// table. Ordered by `seq`, never `createdAt`. NO TRUNCATION (AC #4) is inherent — the fold
// of an append-only ledger is monotonic, so a later read is a `seq`-superset of an earlier.
//
// Session-agnostic: NO `actor` param — the only identity precondition (an established
// identity; this is an OPEN read, NO membership) is enforced at the MCP tool, mirroring
// `listRooms`/`boardDirectory`. core stays session-agnostic.

import { BoardError } from '../errors.js';
import { findRoom } from './projection.js';
import { roomMessages } from './room-history.js';

import type { DataAccess } from '../ports.js';
import type { Room } from './projection.js';
import type { RoomMessage } from './room-history.js';

/**
 * A room's full ordered history: its metadata + the complete `seq`-ordered message list.
 * The return shape of {@link readRoom} (the `read_room` tool maps it to the wire).
 *
 * `room` is the folded {@link Room} record (its `roomId`/`projectId`/`subject`/`active`/the
 * derived activator — the room-level metadata, including `subject`, carried ONCE here, not
 * per message). `messages` is the room's ordered history from {@link roomMessages}: message
 * #1 is the seeding announcement (`kind: 'announcement'`), then every reply (`kind: 'reply'`)
 * by `seq`.
 */
export interface RoomHistory {
  /** The room metadata (folded record) — `subject` + activation + the derived activator. */
  room: Room;
  /** The room's COMPLETE ordered message history — announcement #1, then replies by `seq`. */
  messages: RoomMessage[];
}

/**
 * Read a room's COMPLETE ordered history — its metadata + every message by `seq` (AC #1).
 *
 * Resolves the room from the full `seq`-ordered stream; an unknown `roomId` →
 * `BoardError('ROOM_NOT_FOUND')` (AC #3). For an existing room (including a PROTO-room with
 * no reply yet — AC #5: a single-message history, `active=false`) returns the room record
 * plus its ordered messages (the announcement as #1, then replies by `seq`). An OPEN read
 * (FR9): no membership is consulted — the only precondition (an established identity) is
 * enforced by the MCP tool, not core.
 *
 * @param dataAccess The persistence port (the only dependency); `eventsSince(0)` returns ALL
 *   events `seq`-ordered.
 * @param roomId The slug id of the room whose history to read.
 * @returns A {@link RoomHistory}: the room metadata + its `seq`-ordered message list.
 * @throws {BoardError} `ROOM_NOT_FOUND` if no room with `roomId` was ever announced.
 */
export async function readRoom(
  dataAccess: DataAccess,
  roomId: string,
): Promise<RoomHistory> {
  const events = await dataAccess.eventsSince(0);

  // Resolve the room FIRST (AC #3): an unknown room is ROOM_NOT_FOUND — the same closed code
  // `reply` raises; NO new code. Reuses the Story 4.1 rooms projection (findRoom/foldRooms).
  const room = findRoom(events, roomId);
  if (room === undefined) {
    throw new BoardError(
      'ROOM_NOT_FOUND',
      `No such room: "${roomId}". It was never announced.`,
    );
  }

  // The room exists → project its COMPLETE ordered history (announcement #1, then replies by
  // `seq`) from the SAME stream. A proto-room yields exactly one message (the announcement);
  // an active room yields the announcement + every reply (AC #1, #5). No truncation (AC #4):
  // the fold of an append-only ledger is monotonic.
  const messages = roomMessages(events, roomId);
  return { room, messages };
}
