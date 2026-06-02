// The NEEDS YOU derivation (Story 9.4, Task 1 / AC #3).
//
// NEEDS YOU is the operator's escalation queue: the set of rooms where the operator was
// EXPLICITLY pulled into the negotiation via `add_participant(@operator)` — i.e. a
// `room.participant_added` event whose payload `handle` is the operator's handle. This is
// DETERMINISTIC, append-derived board state — the literal inverse of the old time-based
// FR30: agents FLAG when they truly need a human, rather than the system inferring need
// from inactivity. EXPERIENCE.md is explicit — "quiet/idle room = healthy, never a
// warning"; a room the operator was never added to does NOT appear here, no matter how
// old or quiet.
//
// NEVER time-based (the load-bearing AC3 semantic): there is no clock, age, or
// last-activity input anywhere in this derivation. The ONLY signal is the explicit
// `room.participant_added` escalation. A self-initiated `room.replied` by the operator
// does NOT enrol the room in NEEDS YOU — replying is the operator choosing to engage, not
// an agent pulling them in. (Both make the operator a `roomParticipants` participant, but
// only the ADD is the escalation; we scan `room.participant_added` directly so a
// self-reply never counts.)
//
// "Handled" leaving-the-queue is a documented V1 simplification (Story 9.4 Dev Notes):
// presence in NEEDS YOU = the operator is currently an explicitly-added participant. The
// richer "handled" semantics can be refined/deferred later. Because participation is
// append-only (an add is never retracted), the queue is monotonic in V1 — acceptable for
// the explicit-escalation contract.
//
// THIN read (mirrors listRooms): one `eventsSince(0)` read, fold the rooms directory once
// via `foldRooms`, then keep the rooms the operator was added into, `seq`-ordered. Derived
// state, NEVER stored (THE APPEND INVARIANT). Session-agnostic at the core layer; the host
// resolves WHICH handle is the operator. A null/empty operator (the watching-only posture —
// no resolved handle) yields `[]` (nothing can be escalated to "nobody").

import { foldRooms } from './projection.js';

import type { DataAccess } from '../ports.js';
import type { Room } from './projection.js';

/**
 * The rooms the `operator` was EXPLICITLY pulled into via `add_participant(@operator)` —
 * the NEEDS YOU escalation queue (AC #3). Deterministic, append-derived, NEVER time-based:
 * the only signal is a `room.participant_added` event naming the operator handle. A room
 * the operator was never added to is absent regardless of age/quietness.
 *
 * @param dataAccess The persistence port; `eventsSince(0)` returns ALL events `seq`-ordered.
 * @param operator The resolved operator handle, or `null` for the watching-only posture.
 * @returns The escalated rooms as a `Room[]` sorted by `seq` ascending — `[]` if the
 *   operator has no escalations or no handle is resolved.
 */
export async function needsYouRooms(
  dataAccess: DataAccess,
  operator: string | null,
): Promise<Room[]> {
  // No resolved operator handle → nothing can be escalated to "nobody" (watching-only).
  if (operator === null || operator === '') {
    return [];
  }

  const events = await dataAccess.eventsSince(0);

  // The explicit-escalation signal is `room.participant_added` naming the operator. Collect
  // the room ids it was emitted for (a Set dedups repeated/idempotent adds into one room).
  // This is the ONLY input — no clock, age, or last-activity is consulted (AC3).
  const escalatedRoomIds = new Set<string>();
  for (const event of events) {
    if (
      event.type === 'room.participant_added' &&
      event.payload.handle === operator
    ) {
      escalatedRoomIds.add(event.payload.roomId);
    }
  }

  if (escalatedRoomIds.size === 0) {
    return [];
  }

  // Resolve each escalated room id to its full record via the rooms projection (the one
  // source of truth for room shape), and return them `seq`-ordered. A room id present in
  // an add event always has a folded announcement (the add targets an existing room), so
  // every id resolves; defensively skip any that does not.
  const directory = foldRooms(events);
  return [...escalatedRoomIds]
    .map((roomId) => directory.get(roomId))
    .filter((room): room is Room => room !== undefined)
    .sort((a, b) => a.seq - b.seq);
}
