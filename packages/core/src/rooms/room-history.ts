// The room message-history projection (Story 4.4, Task 1 / AC #1, #4, #5).
//
// `roomMessages(events, roomId)` folds the `seq`-ordered event stream into ONE room's
// COMPLETE, ordered message history — the read `read_room` (Story 4.4) renders and the
// react / current-contract ops (Epic 5) consume by `seq`. A "message" in a room is:
//   - MESSAGE #1: the room's seeding `announcement.posted` (`kind: 'announcement'`), and
//   - then every `room.replied` for that room (`kind: 'reply'`),
// each carrying its `seq` (the message identity Epic 5's `message.reacted.messageSeq`
// targets), its `actor`, and its `body`. There is NO separate `message.posted` event type
// in the closed vocabulary — posting a message to a room IS `room.replied` (Story 4.3); so
// the history folds exactly `announcement.posted` (msg #1) + the `room.replied`(s).
//
// Ordering: ascending by `seq` — the authoritative total order (`seq`, NEVER `createdAt`).
// The announcement that MINTS a room always has a strictly lower `seq` than any reply to it
// (a reply targets an already-folded announcement), so message #1 is naturally the
// announcement; the fold sorts explicitly so the contract does not depend on the input
// stream's ordering (mirrors `list-rooms.ts`'s explicit `.sort`).
//
// NO TRUNCATION (AC #4): the history is a pure fold of an append-only ledger — nothing is
// ever `UPDATE`/`DELETE`d, so a later fold is a `seq`-superset of an earlier one (every
// earlier message still present, in the same order, with the same body; new ones appended).
//
// Pure: no I/O, deterministic for a given input; derived state, NEVER stored (THE APPEND
// INVARIANT — there is no `messages`/`history` table). The room `subject` is room-level
// metadata returned ONCE on the `Room` record (NOT duplicated per message); message #1's
// `body` is the announcement body. Session-agnostic (no `actor` param) — the only identity
// precondition (an established identity; this is an OPEN read, FR9 — NO membership) is
// enforced at the MCP tool, not here.

import type { Event } from '../events/event.js';

/** The `kind` discriminator of a {@link RoomMessage}: the seeding announcement vs a reply. */
export type RoomMessageKind = 'announcement' | 'reply';

/**
 * One message in a room's ordered history — the folded read shape. All camelCase (the
 * internal contract); the snake_case wire mapping lives at the MCP boundary
 * (`messageToWire`).
 *
 * A message is identified by its `seq` (the same `seq` Epic 5's `message.reacted` targets
 * as `messageSeq`). `kind` distinguishes the room's seeding announcement (message #1, its
 * `body` the announcement body) from a `room.replied`. `actor` is the event's actor (the
 * announcement's poster, or the replier). The room `subject` is NOT carried here — it is
 * room-level metadata returned once on the `Room` record.
 */
export interface RoomMessage {
  /** `seq` of the underlying event — the message's identity + ordering key (never `createdAt`). */
  seq: number;
  /** The handle that authored the message (the announcer for #1, else the replier). */
  actor: string;
  /** The message body, verbatim (untrusted markdown): the announcement body, or the reply body. */
  body: string;
  /** Whether this message is the seeding announcement (#1) or a reply. */
  kind: RoomMessageKind;
}

/**
 * Fold a `seq`-ordered event stream into ONE room's COMPLETE, ordered message history:
 * the room's `announcement.posted` as message #1 (`kind: 'announcement'`), followed by
 * every `room.replied` for that `roomId` (`kind: 'reply'`), all sorted ascending by `seq`.
 * Pure: no I/O, deterministic for a given input.
 *
 * Only events for THIS `roomId` contribute (cross-room isolation): an `announcement.posted`
 * whose payload `roomId` matches, and each `room.replied` whose payload `roomId` matches.
 * Every other event type and every other room is ignored. An unknown `roomId` (no matching
 * announcement) yields an EMPTY list — the op layer (`readRoom`) turns "no such room" into
 * `ROOM_NOT_FOUND`; this pure fold does not (it has no room directory to assert existence).
 *
 * Contract: `events` SHOULD be the `seq`-ordered stream (every `DataAccess` read guarantees
 * this), but the result is sorted by `seq` regardless, so correctness does not depend on the
 * input ordering. A room can have at most one `announcement.posted` (the post op's `room_id`
 * uniqueness guard forbids a duplicate), so there is exactly one `kind: 'announcement'`
 * message when the room exists.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param roomId The slug id of the room whose message history to project.
 * @returns The room's messages as a `RoomMessage[]` sorted by `seq` asc — `[]` if no
 *   `announcement.posted` for `roomId` exists in the stream.
 */
export function roomMessages(events: Event[], roomId: string): RoomMessage[] {
  const messages: RoomMessage[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'announcement.posted': {
        // Message #1: the seeding announcement (its body is the message body; the subject is
        // room metadata, NOT a message). Only this room's announcement contributes.
        if (event.payload.roomId === roomId) {
          messages.push({
            seq: event.seq,
            actor: event.actor,
            body: event.payload.body,
            kind: 'announcement',
          });
        }
        break;
      }
      case 'room.replied': {
        // A reply IS a message (there is no separate message.posted type — posting = replying,
        // Story 4.3). Only this room's replies contribute.
        if (event.payload.roomId === roomId) {
          messages.push({
            seq: event.seq,
            actor: event.actor,
            body: event.payload.body,
            kind: 'reply',
          });
        }
        break;
      }
      default:
        break;
    }
  }

  // Order by `seq` ascending — the authoritative total order. The announcement is naturally
  // the lowest `seq` (it mints the room before any reply), so message #1 is the announcement;
  // sort explicitly so the contract holds for any input ordering (NEVER order by `createdAt`).
  return messages.sort((a, b) => a.seq - b.seq);
}
