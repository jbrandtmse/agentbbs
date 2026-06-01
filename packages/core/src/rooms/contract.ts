// The current-agreed-contract projection (Story 5.3, Task 1 / AC #1, #2, #3) — FR21, the
// marquee Epic 5 capability.
//
// `currentContract(events, roomId)` is the CURRENT AGREED CONTRACT of one room: of that room's
// messages (`roomMessages`, Story 4.4 — each carrying its LIVE 👍 `reactions` via Story 5.2's
// `liveReactors`), the one with the HIGHEST `seq` that CURRENTLY holds at least one live 👍;
// `null` if no message in the room holds one. This is the message the board has most-recently
// agreed on (a 👍 is the ratification signal) — "show me the agreed text", returned as the whole
// message (incl. `body`), NOT a pointer.
//
// COMPUTED, NEVER STORED (THE APPEND INVARIANT / FR21): every call is a FRESH query over the
// current live-👍 state. There is NO stored `contract` flag, column, or event. Consequently
// reversion-on-retract (AC #2) needs NO special logic: when the top message's last live 👍 is
// retracted, the very next `currentContract` call recomputes and naturally yields the
// next-highest live-👍'd message (or `null`) — because nothing was stored to "revert". The whole
// revert behaviour is an emergent property of recomputing from `roomMessages` (whose `reactions`
// are themselves derived latest-react-wins), not a code path.
//
// Reuse, don't re-fold: `roomMessages` ALREADY computes each message's live `reactions`
// (via `liveReactors`). `currentContract` filters those to the non-empty ones and takes the max
// `seq` — it does NOT re-implement reaction folding (Design decision 2).
//
// Pure: no I/O, deterministic for a given input; derived state, NEVER stored. Session-agnostic
// (no `actor` param) — the contract is "computed by ANY reader" (FR9): the only identity
// precondition (an established identity; an OPEN read, NO membership) is enforced at the MCP
// tool, not here. Existence is NOT asserted here either: an unknown/empty room simply has no
// messages, hence `null`; the `read_contract` tool does the `findRoom` → ROOM_NOT_FOUND check so
// "room doesn't exist" is DISTINCT from "room exists but no contract yet" (Design decision 3).
// `core` imports only the room-history projection (which imports only the `Event` type) — the
// lint-enforced module boundary.

import { roomMessages } from './room-history.js';

import type { Event } from '../events/event.js';
import type { RoomMessage } from './room-history.js';

/**
 * Compute the CURRENT AGREED CONTRACT of room `roomId`: the message with the HIGHEST `seq`
 * that currently holds at least one LIVE 👍, or `null` if no message in the room does (FR21).
 *
 * The contract is DERIVED by query every call (THE APPEND INVARIANT) — never stored. It reverts
 * automatically on retraction (AC #2): because the live `reactions` of each message are
 * themselves recomputed (latest-react-wins) and this is a fresh max-`seq` filter over them, a
 * retraction that empties the top message's 👍 simply makes the next-highest live-👍'd message
 * (or `null`) the answer the next call returns. The seeding announcement (message #1) CAN be the
 * contract when it is the highest-`seq` live-👍'd message (e.g. a proto-room whose only message
 * holds a live 👍). Cross-room isolation is inherited from `roomMessages`: only THIS room's
 * messages are considered, so another room's reactions can never become this room's contract.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc. The result does
 *   not depend on the input ordering (`roomMessages` sorts by `seq`; the live-react fold compares
 *   `seq`), but every `DataAccess` read supplies it `seq`-ordered.
 * @param roomId The slug id of the room whose current contract to compute.
 * @returns The highest-`seq` {@link RoomMessage} (incl. its `body`/`actor`/`kind`/live
 *   `reactions`) currently holding a live 👍, or `null` if none — "no contract yet".
 */
export function currentContract(
  events: Event[],
  roomId: string,
): RoomMessage | null {
  // The room's COMPLETE ordered history, each message annotated with its LIVE 👍 reactors
  // (Story 5.2). Already sorted ascending by `seq` and already cross-room-isolated — so the
  // current contract is the LAST message in this list that still holds a live 👍.
  const messages = roomMessages(events, roomId);

  // Walk from the highest `seq` down; the first message with a non-empty live-reactor set IS the
  // current contract (most-recent agreement wins). No live 👍 anywhere → `null` ("no contract
  // yet"). This is the whole of FR21 — a derived max-`seq` filter, no stored state, no special
  // revert logic.
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.reactions.length > 0) {
      return message;
    }
  }
  return null;
}
