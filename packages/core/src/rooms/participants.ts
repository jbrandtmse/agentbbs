// The room-participants projection (Story 4.5, Task 1 / AC #1, #4, #5).
//
// `roomParticipants(events, roomId)` folds the `seq`-ordered event stream into ONE room's
// PARTICIPANTS — the set of handles that are "in" the negotiation. A participant is:
//   - the ACTOR of any `room.replied` for that room (you posted in it), UNION
//   - the payload `handle` of any `room.participant_added` for that room (you were pulled in),
// de-duplicated, in FIRST-SEEN (`seq`) order. Participation = posted-in OR pulled-in.
//
// The ANNOUNCER is NOT a participant by virtue of announcing: posting an announcement opens
// a proto-room (Story 4.1) but does not, by itself, make the announcer a participant — they
// become one only if they later reply (or are added). So a proto-room (an announcement with
// no reply yet) has ZERO participants, which is exactly what makes the `add_participant` gate
// (Story 4.5: the actor must be a participant) naturally reject pulling a peer into a room no
// one has engaged with yet. This is the read-model the `addParticipant` op's gate (Story 4.5)
// AND Story 4.6's join-cursor (the cursor is set for a newly-added / newly-replying
// participant) consume.
//
// Ordering: the fold consumes events in `seq` order — the authoritative total order (`seq`,
// NEVER `createdAt`). The result is a `string[]` in first-appearance order: a handle that
// both replied and was added (in either order) appears ONCE, at the LOWER (first) `seq`. A
// `Set` preserves insertion order, so iterating it yields the first-seen ordering directly.
//
// Pure: no I/O, deterministic for a given input; derived state, NEVER stored (THE APPEND
// INVARIANT — there is no `participants` table/column). Cross-room isolated: only events
// whose payload `roomId` matches contribute. An unknown room yields an EMPTY list (this pure
// fold has no room directory to assert existence — the op layer turns "no such room" into
// `ROOM_NOT_FOUND`).

import type { Event } from '../events/event.js';

/**
 * Fold a `seq`-ordered event stream into ONE room's participants — the actors of its
 * `room.replied` events UNION the payload `handle`s of its `room.participant_added` events,
 * de-duplicated, in first-seen (`seq`) order. Pure: no I/O, deterministic for a given input.
 *
 * The ANNOUNCER is NOT included unless they also replied (or were added): announcing opens
 * the room but does not enrol the announcer as a participant. So a proto-room (no reply yet)
 * yields `[]`.
 *
 * Only events for THIS `roomId` contribute (cross-room isolation): each `room.replied` whose
 * payload `roomId` matches contributes its `actor`; each `room.participant_added` whose
 * payload `roomId` matches contributes its payload `handle`. Every other event type and every
 * other room is ignored. An unknown `roomId` yields an EMPTY array.
 *
 * Contract: `events` MUST be ordered by `seq` ascending (every `DataAccess` read guarantees
 * this). A `Set` preserves first-insertion order, so the returned array is in first-seen
 * `seq` order and a handle that appears via BOTH a reply and an add (in either order) is
 * present once, at its earliest `seq`.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param roomId The slug id of the room whose participants to project.
 * @returns The participant handles as a `string[]` in first-seen `seq` order — `[]` if the
 *   room has no reply and no added participant (including an unknown / proto-room).
 */
export function roomParticipants(events: Event[], roomId: string): string[] {
  // A Set both de-duplicates and preserves first-insertion (= first-seen `seq`) order, so a
  // handle that replies AND is added (either order) lands once at its earliest occurrence.
  const participants = new Set<string>();

  for (const event of events) {
    switch (event.type) {
      case 'room.replied': {
        // The replier is a participant (posted-in). Only this room's replies contribute.
        if (event.payload.roomId === roomId) {
          participants.add(event.actor);
        }
        break;
      }
      case 'room.participant_added': {
        // The ADDED handle (payload.handle, distinct from the actor who added them) is a
        // participant (pulled-in). Only this room's adds contribute.
        if (event.payload.roomId === roomId) {
          participants.add(event.payload.handle);
        }
        break;
      }
      default:
        break;
    }
  }

  return [...participants];
}

/**
 * Is `handle` a participant of room `roomId`? Convenience over {@link roomParticipants} for
 * the common single-membership check (e.g. the `addParticipant` gate: the actor must be a
 * participant; the idempotent re-add skip: the target already is one).
 *
 * The announcer-who-never-replied is NOT a participant (see {@link roomParticipants}); an
 * unknown room has no participants, so any handle is `false`.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param roomId The slug id of the room to test against.
 * @param handle The canonical handle to test for participation.
 * @returns `true` iff `handle` has replied to or been added to `roomId`.
 */
export function isParticipant(
  events: Event[],
  roomId: string,
  handle: string,
): boolean {
  return roomParticipants(events, roomId).includes(handle);
}
