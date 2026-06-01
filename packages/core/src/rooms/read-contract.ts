// The `readContract` board READ operation (Story 5.3, Task 2 / AC #1, #4) — FR21.
//
// `readContract(dataAccess, roomId)` is the read surface the `read_contract` tool (Story 5.3)
// consumes: the room's CURRENT AGREED CONTRACT — the highest-`seq` message currently holding a
// live 👍 — or `null` ("no contract yet"). It is the FR9 "computed by ANY reader" guarantee — an
// OPEN read gated only on an established identity (enforced at the tool, NOT here), NEVER on
// membership or participation.
//
// Steps (THIN read, no append) — mirrors `readRoom` (Story 4.4):
//   1. Read the whole `seq`-ordered stream once via the DataAccess port (`eventsSince(0)`).
//   2. Resolve the room via the Story 4.1 `findRoom`. An unknown `roomId` (never announced) throws
//      `BoardError('ROOM_NOT_FOUND')` — the SAME closed code `readRoom`/`reply` use; NO new code.
//      This is the existence check that keeps "room doesn't exist" (throws) DISTINCT from "room
//      exists but no message holds a live 👍 yet" (returns `null`) — Design decision 3.
//   3. Otherwise compute the current contract via the pure `currentContract` projection (the
//      highest-`seq` live-👍'd message of `roomMessages`, or `null`) and return it.
//
// WHY a `readContract` op (not the tool calling `findRoom` + `currentContract` itself): the tool
// layer is a THIN client — it must NOT read `dataAccess` or hold board logic (the existence-vs-
// emptiness distinction). So existence resolution + the ROOM_NOT_FOUND throw live HERE, exactly
// as `readRoom` wraps `findRoom` + `roomMessages`. The pure `currentContract(events, roomId)`
// stays a pure, existence-agnostic projection (null for unknown/empty); this op layers the
// ROOM_NOT_FOUND existence check over it from a single stream read.
//
// Derived state, NEVER stored (THE APPEND INVARIANT / FR21): the contract is recomputed from
// events every call; there is no `contract`/`current_contract` table, column, flag, or event.
// Reversion-on-retract is automatic (a fresh query yields the next-highest live-👍'd message, or
// `null`). Ordered by `seq`, never `createdAt`. Session-agnostic: NO `actor` param — the only
// identity precondition (an established identity; an OPEN read, NO membership) is at the MCP tool.

import { BoardError } from '../errors.js';
import { currentContract } from './contract.js';
import { findRoom } from './projection.js';

import type { DataAccess } from '../ports.js';
import type { RoomMessage } from './room-history.js';

/**
 * Read a room's CURRENT AGREED CONTRACT — the highest-`seq` message currently holding a live 👍,
 * or `null` if none ("no contract yet") (AC #1, FR21).
 *
 * Resolves the room from the full `seq`-ordered stream; an unknown `roomId` →
 * `BoardError('ROOM_NOT_FOUND')` (the same closed code `readRoom` raises; NO new code). For an
 * existing room — including a PROTO-room (its announcement is message #1; it CAN be the contract
 * if 👍'd) — returns the current contract message (incl. its `body`/`actor`/`kind`/live
 * `reactions`) or `null`. An OPEN read (FR9): no membership is consulted — the only precondition
 * (an established identity) is enforced by the MCP tool, not core.
 *
 * The contract is DERIVED by query every call (THE APPEND INVARIANT) — never stored; it reverts
 * automatically on retraction because the next call recomputes from the live-👍 state.
 *
 * @param dataAccess The persistence port (the only dependency); `eventsSince(0)` returns ALL
 *   events `seq`-ordered.
 * @param roomId The slug id of the room whose current contract to read.
 * @returns The current contract {@link RoomMessage}, or `null` if no message holds a live 👍.
 * @throws {BoardError} `ROOM_NOT_FOUND` if no room with `roomId` was ever announced.
 */
export async function readContract(
  dataAccess: DataAccess,
  roomId: string,
): Promise<RoomMessage | null> {
  const events = await dataAccess.eventsSince(0);

  // Resolve the room FIRST (Design decision 3): an unknown room is ROOM_NOT_FOUND — the same
  // closed code `readRoom` raises; NO new code. This keeps "room doesn't exist" DISTINCT from the
  // `null` below ("room exists, no contract yet"). Reuses the Story 4.1 rooms projection.
  const room = findRoom(events, roomId);
  if (room === undefined) {
    throw new BoardError(
      'ROOM_NOT_FOUND',
      `No such room: "${roomId}". It was never announced.`,
    );
  }

  // The room exists → compute its current contract from the SAME stream. `null` here means
  // "no message in the room holds a live 👍 yet" — a known room with no contract (NOT an error).
  return currentContract(events, roomId);
}
