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

import type { Room } from '@agentbbs/core';

/**
 * Max announcement-subject length — a defensive upper bound so a pathologically long
 * subject is rejected at the boundary rather than stored (and rather than producing a
 * pathological room-id base). A sanity cap, not a product constraint.
 */
export const ANNOUNCEMENT_SUBJECT_MAX_LENGTH = 200;

/**
 * Max announcement-body length at THIS story's boundary — a sane defensive upper bound.
 *
 * DEFERRED: the FORMAL 256 KB body cap and its dedicated `BODY_TOO_LARGE` error code are
 * Epic 5 Story 5.1 (project-context.md "Body cap 256 KB … reject with BODY_TOO_LARGE"),
 * NOT this story. Until then this is a generous sanity cap that keeps an absurdly large
 * body out of the ledger; it is intentionally LARGER than a normal message yet well under
 * the eventual 256 KB formal cap, and it raises a plain Zod validation error (NOT a closed
 * board code). Do not conflate this with the Epic 5 cap — Story 5.1 replaces it.
 */
export const ANNOUNCEMENT_BODY_MAX_LENGTH = 16_000;

/**
 * The shared Zod validator for a `subject` wire param: a non-empty, length-bounded
 * string. Unlike a project title, the subject is NOT required to contain a slug-able
 * character — an all-punctuation subject is ACCEPTED and the room-id base falls back to
 * `room` (Story 4.1 AC #5; announcements disambiguate, they never reject on the slug). The
 * SDK validates against this and rejects a missing/empty subject BEFORE the delegate runs.
 */
export const announcementSubjectSchema = z
  .string()
  .min(1)
  .max(ANNOUNCEMENT_SUBJECT_MAX_LENGTH);

/**
 * The shared Zod validator for a `body` wire param: a non-empty, length-bounded string
 * (see {@link ANNOUNCEMENT_BODY_MAX_LENGTH} — the formal 256 KB cap is deferred to Epic 5).
 * The SDK validates against this and rejects a missing/empty body BEFORE the delegate runs.
 */
export const announcementBodySchema = z
  .string()
  .min(1)
  .max(ANNOUNCEMENT_BODY_MAX_LENGTH);

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
}

/** Map the camelCase core {@link Room} to its snake_case wire object. */
export function roomToWire(room: Room): RoomWire {
  return {
    room_id: room.roomId,
    project_id: room.projectId,
    subject: room.subject,
    body: room.body,
    posted_by: room.postedBy,
    seq: room.seq,
    active: room.active,
  };
}
