// The rooms projection (Story 4.1, Task 4 / AC #1, #6).
//
// Folds the event stream into the rooms directory: every `announcement.posted` becomes
// one proto-room record, keyed by its globally-unique `roomId`. Derived state, NEVER
// stored (THE APPEND INVARIANT): callers re-fold (or fold a relevant read) every time
// they need a room; there is no `rooms` table and no `active`/`status` column anywhere.
// Mirrors `projects/projection.ts`.
//
// Ordering: the fold consumes events in `seq` order — the authoritative total order
// (`seq`, NEVER `createdAt`). Every `DataAccess` read returns events `seq`-ordered. The
// room record carries the announcing event's `seq` so Story 4.2 can list rooms "ordered
// by seq" deterministically, and so `postAnnouncement` returns it to the caller.
//
// ADDITIVE-by-design (Stories 4.3 / 4.4 / 4.5): the fold has extension seams the later
// room events slot into without reshaping the record:
//   - `active` is `false` here. Story 4.3 (the FIRST reply activates the room — message
//     #1 IS the announcement) flips it to `true` when the MIN-`seq` `room.replied` for
//     the room exists. That is a SEPARATE fold branch added in 4.3; this story folds
//     ONLY `announcement.posted` (no `room.replied` branch yet), so `active` stays
//     `false` for every proto-room. The field is present now so 4.3 extends the shape
//     rather than reshaping it, and 4.1's read-back has a stable record.
//   - participants (4.5) and the message history (4.4) layer on as their own folds/reads
//     against the same `roomId` key; they do not reshape this record.

import type { Event } from '../events/event.js';

/**
 * One row of the rooms directory — the folded proto-room record. All camelCase (the
 * internal contract); the snake_case wire mapping lives at the MCP boundary.
 *
 * `roomId` is the globally-unique slug the op allocates (subject slug + disambiguator).
 * `projectId` is the sub-board the announcement was posted to (the board scope, added to
 * the payload in Story 4.1). `postedBy` is the actor of the `announcement.posted` event.
 * `seq` is that event's `seq` — the deterministic ordering key (Story 4.2) and the value
 * `postAnnouncement` returns. `active` is DERIVED (`false` until Story 4.3 folds the
 * activating reply); it is NOT a stored column.
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
   * Whether the room is ACTIVE — derived, never stored. A proto-room (announcement
   * with no reply yet) is INACTIVE. Story 4.3 flips this to `true` once the room's
   * activating (min-`seq`) `room.replied` is folded; this story folds only
   * `announcement.posted`, so it is `false` for every record here.
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
 * Only `announcement.posted` mints a record (Story 4.1); later room events are folded
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
