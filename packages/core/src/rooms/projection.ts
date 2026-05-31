// The rooms projection (Story 4.1, Task 4 / AC #1, #6; activation read-model: Story 4.2).
//
// Folds the event stream into the rooms directory: every `announcement.posted` becomes
// one proto-room record, keyed by its globally-unique `roomId`, and every `room.replied`
// for a known room flips that record `active = true`. Derived state, NEVER stored (THE
// APPEND INVARIANT): callers re-fold (or fold a relevant read) every time they need a
// room; there is no `rooms` table and no `active`/`status` column anywhere. Mirrors
// `projects/projection.ts`.
//
// Ordering: the fold consumes events in `seq` order — the authoritative total order
// (`seq`, NEVER `createdAt`). Every `DataAccess` read returns events `seq`-ordered. The
// room record carries the announcing event's `seq` so Story 4.2 lists rooms "ordered by
// seq" deterministically, and so `postAnnouncement` returns it to the caller.
//
// ACTIVATION READ-MODEL (Story 4.2): `active` is DERIVED as existence-of-reply — a room
// is ACTIVE iff ≥1 `room.replied` for it has been folded (architecture.md line 251). The
// `room.replied` branch sets the flag idempotently (a second reply keeps it active). This
// is the read-model `list_rooms` (activated) vs `list_announcements` (still-proto)
// consume. It is a BOOLEAN existence derivation ONLY: WHICH reply is the activator (the
// MIN-`seq` one) and the announcement-as-message-#1 seeding are Story 4.3 (the reply
// WRITE-op, which appends `room.replied` + auto-joins the replier) / 4.4 (the ordered
// read) concerns — NOT computed here.
//
// ADDITIVE-by-design (Stories 4.3 / 4.4 / 4.5): the fold has extension seams the later
// room events slot into without reshaping the record — participants (4.5) and the message
// history (4.4) layer on as their own folds/reads against the same `roomId` key; they do
// not reshape this record.

import type { Event } from '../events/event.js';

/**
 * One row of the rooms directory — the folded proto-room record. All camelCase (the
 * internal contract); the snake_case wire mapping lives at the MCP boundary.
 *
 * `roomId` is the globally-unique slug the op allocates (subject slug + disambiguator).
 * `projectId` is the sub-board the announcement was posted to (the board scope, added to
 * the payload in Story 4.1). `postedBy` is the actor of the `announcement.posted` event.
 * `seq` is that event's `seq` — the deterministic ordering key (Story 4.2) and the value
 * `postAnnouncement` returns. `active` is DERIVED (existence-of-reply, Story 4.2); it is
 * NOT a stored column.
 */
export interface Room {
  /** Globally-unique slug id of the room (subject slug + disambiguator) — directory key. */
  roomId: string;
  /** Slug id of the sub-board (project) this announcement/room belongs to. */
  projectId: string;
  /** The announcement subject line (verbatim). */
  subject: string;
  /** The announcement body (verbatim, untrusted markdown). */
  body: string;
  /** The handle that posted the announcement (actor of `announcement.posted`). */
  postedBy: string;
  /** `seq` of this room's `announcement.posted` event — deterministic order key. */
  seq: number;
  /**
   * Whether the room is ACTIVE — derived (existence-of-reply), never stored. A
   * proto-room (announcement with no reply yet) is INACTIVE (`false`); folding any
   * `room.replied` for the room flips it to `true` (Story 4.2's activation read-model;
   * idempotent — a second reply keeps it active). It is a boolean derivation, NOT the
   * activator identity (the min-`seq` activator + message-#1 read are Story 4.3/4.4).
   */
  active: boolean;
}

/**
 * Fold a `seq`-ordered event stream into the rooms directory, keyed by `roomId`. Pure:
 * no I/O, deterministic for a given input.
 *
 * Contract: `events` MUST be ordered by `seq` ascending (every `DataAccess` read
 * guarantees this). A `Map` preserves first-announcement insertion order, so iterating
 * the result yields rooms in announcement order (which equals `seq` order; `Room.seq`
 * is also carried for explicit sorting).
 *
 * A duplicate `announcement.posted` for the same `roomId` cannot occur (the op's
 * `room_id` `appendGuarded` uniqueness guard forbids it); defensively, the FIRST
 * announcement wins the record so a stray later one cannot clobber subject/body/seq.
 * Only `announcement.posted` MINTS a record (Story 4.1); `room.replied` does not mint —
 * it only flips an existing record's `active` (Story 4.2's activation read-model). A
 * `room.replied` for a `roomId` with no folded announcement is defensively IGNORED
 * (unreachable on the happy path — a reply targets an existing room whose
 * lower-`seq` announcement was already folded). Later room events (4.4 / 4.5) are folded
 * by the stories that introduce them.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @returns A `Map<roomId, Room>` — the rooms directory.
 */
export function foldRooms(events: Event[]): Map<string, Room> {
  const directory = new Map<string, Room>();

  for (const event of events) {
    switch (event.type) {
      case 'announcement.posted': {
        const { projectId, roomId, subject, body } = event.payload;
        // First announcement wins the record (the room_id guard forbids a duplicate;
        // this is defensive so a stray later one cannot clobber subject/body/seq).
        if (!directory.has(roomId)) {
          directory.set(roomId, {
            roomId,
            projectId,
            subject,
            body,
            postedBy: event.actor,
            seq: event.seq,
            active: false,
          });
        }
        break;
      }
      case 'room.replied': {
        // Activation read-model (Story 4.2): a room is ACTIVE iff ≥1 reply exists for
        // it. Flip the existing record's `active` to `true` (idempotent — a second
        // reply re-asserts the same flag). Existence-of-reply ONLY: the activator
        // identity (min-`seq`) is a Story 4.3/4.4 concern, not derived here. A reply for
        // an unknown room (no minted announcement) is defensively ignored — it never
        // mints a phantom room (unreachable: a reply targets an existing announcement
        // with a lower `seq`, already folded).
        const { roomId } = event.payload;
        const room = directory.get(roomId);
        if (room) {
          room.active = true;
        }
        break;
      }
      default:
        break;
    }
  }

  return directory;
}

/**
 * Look up a single room by its slug id from a `seq`-ordered event stream. Convenience
 * over {@link foldRooms} for the common "read one room back" case (e.g.
 * `postAnnouncement` reading the just-posted proto-room). Returns `undefined` if no
 * such room was posted.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param roomId The slug id to resolve.
 */
export function findRoom(events: Event[], roomId: string): Room | undefined {
  return foldRooms(events).get(roomId);
}
