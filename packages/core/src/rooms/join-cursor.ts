// The per-(identity, room) JOIN-CURSOR projection (Story 4.6, Task 1/2 / AC #1–#5).
//
// `roomJoinSeq(events, roomId, handle)` derives ONE participant's per-room JOIN FLOOR — the
// `seq` of the EARLIEST event by which `handle` became a participant of `roomId`. That event
// is either:
//   - one of `handle`'s `room.replied` for the room (actor = `handle`), or
//   - a `room.participant_added` naming `handle` (payload `handle` = `handle`, actor = the adder),
// and the floor is the MINIMUM `seq` across all of those — the moment they FIRST joined. A
// handle that is NOT a participant (never replied, never added) has NO floor → `undefined`.
//
// WHY a DERIVED per-room floor (not a stored cursor): this is the floor Story 6.1's `check`
// uses so a newly-joined / newly-added participant is NOT flooded with a room's back-history.
// A joining event (`room.replied` / `room.participant_added`) is assigned the NEWEST `seq` at
// append, so the join-event `seq` IS the ledger position at the instant of join — "set the room
// cursor to the current max `seq` on join" (architecture.md) is satisfied by DERIVING that
// `seq` rather than storing it. This keeps the ledger append-only-pure (THE APPEND INVARIANT —
// no cursor table, no mutation, no new event type) and needs no change to `reply`/`add_participant`
// (the floor derives from their already-appended events).
//
// WHY per-(identity, room), not a single per-identity position advanced on join: the architecture's
// stored per-identity high-water-mark (Story 6.1) prevents re-showing SEEN messages; this per-room
// floor prevents back-history FLOOD. They are DISTINCT. A single per-identity cursor advanced to
// `maxSeq` on every room-join would skip UNREAD deltas in the identity's OTHER rooms (a real
// defect). So `check` (6.1) returns, per room, messages with `seq > max(perIdentityCheckCursor,
// roomJoinSeq)`: the high-water-mark is the stored per-identity position (6.1's concern); the
// per-room floor is THIS story's derived value. Neither causes the other's loss.
//
// EARLIEST wins (AC #4): a participant who was ADDED then later also REPLIED (or vice-versa) has
// their floor at the EARLIEST of those events — the moment they FIRST became a participant — so
// nothing between (e.g. messages posted between their add and their first reply) is lost. This is
// the exact dual of `roomParticipants` recording a handle at its first-seen `seq`.
//
// STRICT `seq > floor` (AC #3, see `roomMessagesSince`): the floor is the join EVENT's own `seq`,
// so "new for me" is `seq > floor` (strict) — your OWN joining message is not re-surfaced to you,
// while every LATER participant's message is.
//
// Pure: no I/O, deterministic for a given input; derived state, NEVER stored. Cross-room isolated:
// only events whose payload `roomId` matches contribute (a join in room A sets NO floor in room B).
// `core` imports only the `DataAccess` port (here: only the `Event` type) — the lint-enforced
// module boundary. Reuses the SAME participant-event filtering as `participants.ts` (the actors of
// `room.replied` ∪ the payload `handle`s of `room.participant_added`).

import { roomMessages } from './room-history.js';

import type { Event } from '../events/event.js';
import type { RoomMessage } from './room-history.js';

/**
 * The per-(identity, room) JOIN CURSOR: the `seq` of the EARLIEST event that made `handle` a
 * participant of `roomId` — i.e. their per-room FLOOR for `check` (Story 6.1). Pure fold over a
 * `seq`-ordered event stream; DERIVED, never stored (THE APPEND INVARIANT).
 *
 * The earliest participating event is the MIN `seq` over:
 *   - each `room.replied` for `roomId` whose actor is `handle` (they posted in the room), and
 *   - each `room.participant_added` for `roomId` whose payload `handle` is `handle` (they were
 *     pulled in).
 * If `handle` participated via BOTH (in either order), the EARLIEST wins (AC #4) — nothing
 * between their first and second participating event is lost. The same events `roomParticipants`
 * (`participants.ts`) folds; this returns the join `seq` rather than the membership set.
 *
 * A handle that is NOT a participant of `roomId` (never replied to it, never added to it —
 * including the announcer-who-never-replied, and any handle for an unknown / proto-room) has no
 * join position → `undefined` (AC #5): `check` (6.1) surfaces a room's messages ONLY to its
 * participants, so a non-participant is simply not in that room's `check` scope.
 *
 * Only events for THIS `roomId` contribute (cross-room isolation): a join in room A does NOT set
 * a floor in room B. The handle is matched verbatim (callers pass the already-canonical lowercased
 * handle, as `actor`/payload handles are stored canonical).
 *
 * Contract: `events` SHOULD be the `seq`-ordered stream (every `DataAccess` read guarantees this),
 * but the result is the MIN over matching `seq`s regardless, so correctness does not depend on the
 * input ordering. The join-event `seq` equals `maxSeq()` at the instant of that append, so this
 * derived value IS the "room cursor set to current max `seq` on join" — without a stored cursor.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param roomId The slug id of the room whose join cursor (for `handle`) to derive.
 * @param handle The canonical handle whose per-room join `seq` to compute.
 * @returns The `seq` of `handle`'s earliest participating event for `roomId`, or `undefined`
 *   if `handle` is not a participant of the room.
 */
export function roomJoinSeq(
  events: Event[],
  roomId: string,
  handle: string,
): number | undefined {
  let earliest: number | undefined;

  // Track the MIN `seq` across every event that makes `handle` a participant of `roomId`.
  // Order-independent (we take the minimum), so this holds even if `events` were not seq-sorted.
  const consider = (seq: number): void => {
    if (earliest === undefined || seq < earliest) {
      earliest = seq;
    }
  };

  for (const event of events) {
    switch (event.type) {
      case 'room.replied': {
        // `handle` posted in the room → a participating event. Only this room's replies count.
        if (event.payload.roomId === roomId && event.actor === handle) {
          consider(event.seq);
        }
        break;
      }
      case 'room.participant_added': {
        // `handle` was pulled into the room (payload.handle, distinct from the actor who added
        // them) → a participating event. Only this room's adds count.
        if (
          event.payload.roomId === roomId &&
          event.payload.handle === handle
        ) {
          consider(event.seq);
        }
        break;
      }
      default:
        break;
    }
  }

  // `undefined` iff no participating event was seen — `handle` is not a participant of `roomId`.
  return earliest;
}

/**
 * The "what is NEW for me in this room" floor helper: a room's messages
 * ({@link roomMessages}, Story 4.4) filtered to `seq > sinceSeq` (STRICT). Pure: no I/O,
 * deterministic for a given input.
 *
 * This expresses the per-room FLOOR that Story 6.1's `check` applies. The strict `>` means the
 * message AT `sinceSeq` (your own joining `room.replied`, when `sinceSeq` is your
 * {@link roomJoinSeq}) is EXCLUDED, while every later participant's message is INCLUDED (AC #3).
 * Passing a participant's `roomJoinSeq` as `sinceSeq` therefore EXCLUDES the room's pre-join
 * back-history (the seeding announcement + replies before they joined) — no flood (AC #2). The
 * full prior history remains available on demand via `read_room` (Story 4.4 is NEVER
 * cursor-scoped); this helper does NOT replace it.
 *
 * NOTE — Story 6.1 (`check`) does NOT use this floor alone: it combines this per-room floor with
 * the stored per-identity high-water-mark as `seq > max(perIdentityCheckCursor, roomJoinSeq)`.
 * This story builds ONLY the per-room floor (the derived value); the stored cursor + the `max`
 * combination + the `check` tool are Story 6.1's concern. Do NOT add a stored cursor here.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param roomId The slug id of the room whose post-`sinceSeq` messages to project.
 * @param sinceSeq The EXCLUSIVE lower bound `seq`; only messages with `seq > sinceSeq` are
 *   returned. Pass a participant's {@link roomJoinSeq} to get their "new since I joined".
 * @returns The room's {@link RoomMessage}s with `seq > sinceSeq`, in `seq` asc order — `[]` if
 *   none (e.g. a participant added after the last message: all history is back-history).
 */
export function roomMessagesSince(
  events: Event[],
  roomId: string,
  sinceSeq: number,
): RoomMessage[] {
  return roomMessages(events, roomId).filter(
    (message) => message.seq > sinceSeq,
  );
}
