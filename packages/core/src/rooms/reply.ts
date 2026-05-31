// The `reply` board operation (Story 4.3, Task 2 / AC #1, #2, #3, #4).
//
// Replying to a room is the KEYSTONE of Epic 4: a posted need (a proto-room) becomes a
// live multi-party room. It appends ONE `room.replied` ({ roomId, body }) for the actor
// and — IFF the actor is not already a sub-board member — a `board.joined` for the room's
// `projectId`, ATOMICALLY in one transaction. The room ACTIVATES (derived: ≥1 reply) and
// the replier becomes a participant (their `room.replied` makes them one) and a sub-board
// member ("acting = joining", FR10).
//
// Shape vs. the other ops:
//   - vs. `postAnnouncement` (the room WRITE template): SAME read → append → read-back →
//     return-Room structure, but `reply` does NOT gate on membership and does NOT use
//     `appendGuarded`. `postAnnouncement` GATES on membership (requireMembership first) and
//     atomically CLAIMS a unique room id; `reply` GRANTS membership and is a plain append.
//   - vs. `joinBoard` (the idempotent-auto-join template): the conditional `board.joined`
//     mirrors `joinBoard` exactly — skip it if the actor is already a member, append it
//     (plain, the projection de-dups a benign concurrent double-join) otherwise. The
//     difference is that `reply` BUNDLES the `board.joined` with the `room.replied` in ONE
//     `append` call, so a non-member's reply-and-join is all-or-nothing.
//
// PLAIN append (NOT appendGuarded) — DECISION (story Design decision 2): replies are NOT
// uniqueness-constrained. Concurrent replies to a proto-room must BOTH land with sequential
// `seq`s and no error (AC #4); the "exactly one activator" is a pure READ-side min-`seq`
// derivation (rooms projection, Story 4.3), needing no write coordination, no lock. The
// op never branches on proto-vs-active (Design decision 6): it always appends
// `room.replied`; activation + the activator are the projection's job.
//
// `actor` is supplied by the caller (the MCP tool passes the session handle); core stays
// session-agnostic, mirroring `postAnnouncement`/`joinBoard`/`announceProject`.

import { BoardError } from '../errors.js';
import { findProject } from '../projects/projection.js';
import { isMember } from '../projects/membership.js';
import { assertBodyWithinCap } from './body-cap.js';
import { findRoom } from './projection.js';

import type { DataAccess } from '../ports.js';
import type { NewEvent } from '../events/event.js';
import type { Room } from './projection.js';

/** Input to {@link reply} (camelCase; the MCP boundary maps snake_case → this). */
export interface ReplyInput {
  /**
   * The room slug id to reply to. Must reference an existing room (an announcement was
   * posted with this `roomId`); an unknown id is `ROOM_NOT_FOUND`.
   */
  roomId: string;
  /** The reply body (boundary-validated non-empty + length-capped; stored verbatim). */
  body: string;
}

/**
 * Reply to a room — activating a proto-room into a live room (AC #1–#4).
 *
 * Steps:
 *   1. Read the whole `seq`-ordered stream and resolve the room via {@link findRoom}. An
 *      unknown `roomId` throws `BoardError('ROOM_NOT_FOUND')` and appends NOTHING (AC #3).
 *   2. Resolve the room's `projectId` (from the room record) and whether `actor` is
 *      already a member of that sub-board (via {@link findProject} + {@link isMember}).
 *   3. Build the append list: ALWAYS one `room.replied` ({ roomId, body }) for `actor`,
 *      PLUS one `board.joined` ({ projectId }) for `actor` IFF not already a member
 *      (idempotent auto-join, mirroring `joinBoard`; "acting = joining", FR10).
 *   4. PLAIN `append` the list in ONE transaction (AC #2: the reply-and-join is
 *      all-or-nothing). NOT `appendGuarded`: replies are not uniqueness-constrained, so
 *      concurrent replies both land with sequential `seq`s (AC #4) and a benign concurrent
 *      double-join is de-duplicated by the members projection.
 *   5. Read the now-active room back through the rooms projection and return it, failing
 *      loud on a miss (never fabricates a record). The returned `Room` carries the derived
 *      `active=true` + the min-`seq` activator.
 *
 * A reply to an ALREADY-active room is an ordinary message (no proto-vs-active branch); the
 * activation + activator are derived read-side, so a later reply never disturbs them.
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param actor The replying handle (the MCP tool supplies the session handle).
 * @param input The target `roomId` + reply `body` (boundary-validated).
 * @returns The now-active {@link Room} (its `active` is `true`; `activatedBy`/
 *   `activatedAtSeq` are the min-`seq` reply — `actor`/this reply iff it is the first).
 * @throws BoardError `ROOM_NOT_FOUND` if no room with `roomId` exists (nothing appended).
 */
export async function reply(
  dataAccess: DataAccess,
  actor: string,
  input: ReplyInput,
): Promise<Room> {
  const { roomId, body } = input;

  // Step 1 — resolve the room. Read the full stream and fold it. An unknown room throws
  // ROOM_NOT_FOUND and appends nothing (AC #3). A room never disappears (append-only), so
  // its existence here holds through the later append — no transaction spanning the check
  // and the append is needed (the room.replied is a plain append, like joinBoard).
  const events = await dataAccess.eventsSince(0);
  const room = findRoom(events, roomId);
  if (!room) {
    throw new BoardError(
      'ROOM_NOT_FOUND',
      `No such room: "${roomId}". It was never announced.`,
    );
  }

  // Step 2 — resolve the room's sub-board + the actor's membership of it. The room record
  // carries its `projectId`; the project always exists (the announcement that minted the
  // room was posted to it). `isMember` reuses the Story 3.1 membership derivation.
  const { projectId } = room;
  const project = findProject(events, projectId);
  const alreadyMember = project !== undefined && isMember(project, actor);

  // Step 3 — build the append list: room.replied ALWAYS; board.joined IFF not a member
  // (idempotent auto-join, "acting = joining"). Both go in ONE append (Step 4) so a
  // non-member's reply-and-join is atomic (AC #2).
  const toAppend: NewEvent[] = [
    { type: 'room.replied', actor, payload: { roomId, body } },
  ];
  if (!alreadyMember) {
    toAppend.push({ type: 'board.joined', actor, payload: { projectId } });
  }

  // Body-size cap (Story 5.1 / AC #2) — throw BODY_TOO_LARGE for an over-cap body BEFORE the
  // append, so NOTHING lands (neither room.replied NOR the conditional board.joined). The
  // cap is on UTF-8 BYTE length; it is the closed core code (not a Zod .max). Placed after
  // room resolution so a reply to a real room with an over-cap body is rejected for size.
  assertBodyWithinCap(body);

  // Step 4 — PLAIN append (not appendGuarded). Replies are not uniqueness-constrained:
  // concurrent replies both land with sequential `seq`s (AC #4), and a benign concurrent
  // double-join is de-duplicated by the members projection (same as joinBoard).
  await dataAccess.append(toAppend);

  // Step 5 — read the now-active room back so the returned record (active + the min-`seq`
  // activator) comes from the ledger, including this just-appended reply.
  const after = await dataAccess.eventsSince(0);
  const activated = findRoom(after, roomId);
  if (!activated) {
    // Unreachable on the success path: the room existed at Step 1, append-only means it
    // still exists, and we just appended a room.replied for it. A miss means the append
    // did not persist or the read seam is broken — fail loud rather than fabricate.
    throw new Error(
      `reply: just-replied room "${roomId}" not found after appending room.replied for "${actor}".`,
    );
  }
  return activated;
}
