// Shared room-tool boundary helpers (Story 4.1).
//
// The `post_announcement` (4.1) tool — and the room tools that follow in Epic 4
// (`reply` 4.3, `read_room` 4.4, `add_participant` 4.5) — share the same MCP boundary
// concerns: the announcement-field Zod validators (subject / body) and the camelCase →
// snake_case room wire mapping. Extracting them here keeps the thin tools to ONE source
// of truth so the room contract and wire shape cannot drift across the epic. The
// `project_id` validator is REUSED from `project-shared.ts` (a room is posted to a
// sub-board; the id shape is identical) — not re-declared here.
//
// This is boundary plumbing (Zod shapes + a field rename), NOT board logic — it stays in
// the mcp-server layer. core never sees snake_case (the wire rule); the room-id
// allocation + disambiguation is core's concern (rooms/post-announcement.ts), not here.

import { z } from 'zod';

import type { Room, RoomMessage } from '@agentbbs/core';

/**
 * Max announcement-subject length — a defensive upper bound so a pathologically long
 * subject is rejected at the boundary rather than stored (and rather than producing a
 * pathological room-id base). A sanity cap, not a product constraint.
 */
export const ANNOUNCEMENT_SUBJECT_MAX_LENGTH = 200;

/**
 * The shared Zod validator for a `subject` wire param: a non-empty, length-bounded
 * string. Unlike a project title, the subject is NOT required to contain a slug-able
 * character — an all-punctuation subject is ACCEPTED and the room-id base falls back to
 * `room` (Story 4.1 AC #5; announcements disambiguate, they never reject on the slug). The
 * SDK validates against this and rejects a missing/empty subject BEFORE the delegate runs.
 * The subject `.max` STAYS (Story 5.1): a subject is a short line, so a Zod boundary
 * rejection is the correct surface — only the BODY moves to the core byte-cap + closed code.
 */
export const announcementSubjectSchema = z
  .string()
  .min(1)
  .max(ANNOUNCEMENT_SUBJECT_MAX_LENGTH);

/**
 * The shared Zod validator for a `body` wire param: a non-empty string (`.min(1)` ONLY).
 *
 * Story 5.1 DROPPED the interim char `.max` cap (the retired `ANNOUNCEMENT_BODY_MAX_LENGTH =
 * 16_000`). The FORMAL body cap is now the 256 KB UTF-8 BYTE cap enforced in CORE
 * (`assertBodyWithinCap` / `MAX_BODY_BYTES`), which raises the closed `BODY_TOO_LARGE` code
 * for every client. A Zod `.max` would instead reject with a plain validation error carrying
 * NO closed code (Story 5.0 proved a Zod rejection yields `readErrorPayload === undefined`),
 * so the `.max` is removed so an over-cap body REACHES core and gets the proper code; only
 * the non-empty `.min(1)` boundary stays here. REUSED by `reply` (Story 4.3) for its reply
 * `body` — both room write tools share the one core cap.
 */
export const announcementBodySchema = z.string().min(1);

/**
 * Max room-id length — a defensive boundary so a pathologically long id is rejected at the
 * boundary rather than scanned against the ledger. Mirrors the project-id/subject caps.
 */
export const ROOM_ID_MAX_LENGTH = 200;

/**
 * The shared Zod validator for a `room_id` wire param (Story 4.3, `reply` is its first
 * consumer): a non-empty, length-bounded string in the slug charset. A `roomId` is a slug
 * the post op allocates (subject slug + disambiguator) — lowercase ASCII alphanumerics
 * joined by single hyphens — so it matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` (identical to the
 * `project_id` shape; a room id and a project id share the slug charset). The SDK validates
 * against this and rejects an invalid id (empty, uppercase, leading/trailing/double hyphen,
 * non-slug characters) BEFORE the delegate runs, so core only ever sees a well-formed id —
 * an unknown-but-well-formed id is the ROOM_NOT_FOUND case core owns.
 */
export const roomIdSchema = z
  .string()
  .min(1)
  .max(ROOM_ID_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'room_id must be a slug: lowercase alphanumerics separated by single hyphens',
  });

/** The snake_case room payload returned on the wire (camelCase mapped here). */
export interface RoomWire {
  room_id: string;
  project_id: string;
  subject: string;
  body: string;
  /** The handle that posted the announcement. */
  posted_by: string;
  /** `seq` of the announcement.posted event (deterministic order key). */
  seq: number;
  /**
   * Whether the room is active — `true` iff ≥1 reply exists (the Story 4.2 activation
   * read-model, derived in `foldRooms`); a still-proto room (no reply yet) is `false`.
   */
  active: boolean;
  /**
   * The handle that ACTIVATED the room — the actor of the MIN-`seq` reply (the Story 4.3
   * activator read-model, derived in `foldRooms`). OMITTED (absent) for a still-proto
   * room (no reply yet) rather than carried as `null`/`undefined`, so its presence on the
   * wire mirrors `active === true`.
   */
  activated_by?: string;
  /**
   * `seq` of the activating reply (the MIN-`seq` reply). Paired with {@link activated_by};
   * OMITTED for a still-proto room (no reply yet).
   */
  activated_at_seq?: number;
}

/**
 * Map the camelCase core {@link Room} to its snake_case wire object. The derived activator
 * fields (`activated_by`/`activated_at_seq`, Story 4.3) are OMITTED when the room is still
 * a proto-room (the core `Room` carries them as `undefined`), so a proto-room's wire object
 * does not carry empty activator keys — they appear exactly when the room is active.
 */
export function roomToWire(room: Room): RoomWire {
  const wire: RoomWire = {
    room_id: room.roomId,
    project_id: room.projectId,
    subject: room.subject,
    body: room.body,
    posted_by: room.postedBy,
    seq: room.seq,
    active: room.active,
  };
  if (room.activatedBy !== undefined) {
    wire.activated_by = room.activatedBy;
  }
  if (room.activatedAtSeq !== undefined) {
    wire.activated_at_seq = room.activatedAtSeq;
  }
  return wire;
}

/**
 * The snake_case message payload returned on the wire by `read_room` (Story 4.4). One entry
 * in a room's ordered history. The field names are all single-word (`seq`/`actor`/`body`/
 * `kind`), so the snake_case boundary is a no-op for them (no camel↔snake transform needed);
 * `kind` is the literal `'announcement'` (message #1) or `'reply'`. A message is identified
 * by its `seq` (the same `seq` Epic 5's react / current-contract target).
 */
export interface MessageWire {
  /** `seq` of the underlying event — the message's identity + ordering key. */
  seq: number;
  /** The handle that authored the message (the announcer for #1, else the replier). */
  actor: string;
  /** The message body, verbatim (the announcement body for #1, else the reply body). */
  body: string;
  /** `'announcement'` for the seeding message #1, `'reply'` for a reply. */
  kind: RoomMessage['kind'];
}

/**
 * Map a camelCase core {@link RoomMessage} to its snake_case wire object. A flat field
 * rename only (the field names happen to be single-word, so the values pass through
 * unchanged) — this is boundary plumbing, NOT board logic; the ordered history itself is
 * core's concern (`roomMessages`/`readRoom`).
 */
export function messageToWire(message: RoomMessage): MessageWire {
  return {
    seq: message.seq,
    actor: message.actor,
    body: message.body,
    kind: message.kind,
  };
}
