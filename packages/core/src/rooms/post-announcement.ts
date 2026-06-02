// The `postAnnouncement` board operation (Story 4.1, Task 3 / AC #1–#5).
//
// Posting an announcement opens a PROTO-ROOM on a sub-board: it appends ONE
// `announcement.posted` event carrying the board scope `projectId`, the allocated
// globally-unique `roomId`, and the verbatim `subject`/`body`. It is the FIRST consumer
// of the Story 3.5 membership write-gate (the Rule-1 escape clause forward-declared
// Epic 4 4.1/4.3/4.5).
//
// Shape vs. `announceProject` (the structural template):
//   - SAME: depends ONLY on the DataAccess port; allocates an id via `appendGuarded`
//     with a uniqueness guard; detects the conflict by the duck-typed
//     `code === 'UNIQUENESS_CONFLICT'` discriminant (core must NOT import the
//     data-access error class — the lint-enforced boundary); reads the record back and
//     fails loud on a miss (never fabricates).
//   - DIFFERENT: a subject collision DISAMBIGUATES (retry `base`, `base-2`, …) instead
//     of throwing `PROJECT_EXISTS`. Many announcements may share a subject; each post
//     always creates a NEW proto-room. `roomId` is GLOBALLY unique (a single guard on
//     `room_id`, not scoped by project) because `read_room` (4.4) / `reply` (4.3)
//     reference a room by `roomId` alone.
//   - ADDED step: the membership gate runs FIRST (`requireMembership`), so a non-member
//     (AC #2) or unknown board (AC #3) is rejected BEFORE anything is appended.
//
// `actor` is supplied by the caller (the MCP tool passes the session handle); core stays
// session-agnostic, mirroring `announceProject`/`joinBoard`/`updateFocus`.

import { requireMembership } from '../projects/membership.js';
import { assertBodyWithinCap } from './body-cap.js';
import { roomIdBase } from './room-id.js';
import { findRoom } from './projection.js';

import type { DataAccess } from '../ports.js';
import type { Room } from './projection.js';

/** The stable discriminant the data-access adapter stamps on a uniqueness conflict. */
const UNIQUENESS_CONFLICT_CODE = 'UNIQUENESS_CONFLICT';

/**
 * Defensive upper bound on disambiguator attempts. Each conflict means that exact
 * `roomId` now exists and the suffix increases monotonically, so the loop converges in
 * (number of existing same-base rooms + 1) iterations — this bound is unreachable in
 * practice. Exceeding it signals a broken guard/port (e.g. `appendGuarded` rejecting a
 * value it then does not persist), which must fail LOUD rather than spin forever.
 */
const MAX_ROOM_ID_ATTEMPTS = 10_000;

/** Input to {@link postAnnouncement} (camelCase; the MCP boundary maps snake_case → this). */
export interface PostAnnouncementInput {
  /**
   * The sub-board (project) slug id to post into. The actor must be a member of THIS
   * board (the membership gate enforces it); an unknown id is `BOARD_NOT_FOUND`.
   */
  projectId: string;
  /**
   * The announcement subject. The MCP boundary's Zod schema has already enforced
   * non-empty + a length cap; the `roomId` base is derived from it (and falls back to
   * `room` when it slugs to empty — a proto-room is always created).
   */
  subject: string;
  /** The announcement body (boundary-validated non-empty + length-capped; verbatim). */
  body: string;
}

/**
 * True when a value rejected by the DataAccess port is the adapter's uniqueness
 * conflict, identified by its stable `code`. Duck-typed: core must not import the
 * data-access package to get the concrete error class (the lint-enforced module
 * boundary), so it matches the documented public discriminant instead — identical to
 * `announceProject`'s / `register`'s detector.
 */
function isUniquenessConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === UNIQUENESS_CONFLICT_CODE
  );
}

/**
 * Compose the disambiguated room id for a given attempt: the base for attempt 0, then
 * `base-2`, `base-3`, … (the disambiguator is the 1-based ordinal, so the SECOND room
 * for a base is `-2`, matching `calling-interface` → `calling-interface-2`).
 */
function roomIdForAttempt(base: string, attempt: number): string {
  return attempt === 0 ? base : `${base}-${attempt + 1}`;
}

/**
 * Post an announcement and open its proto-room (AC #1–#5).
 *
 * Steps:
 *   1. Membership gate (AC #2/#3): `requireMembership(dataAccess, actor, projectId)`
 *      FIRST — it throws `BOARD_NOT_FOUND` for an unknown board and `NOT_A_MEMBER` for a
 *      non-member, BEFORE anything is appended (nothing lands on either rejection).
 *   2. Allocate a globally-unique `roomId` (AC #1/#4/#5): derive `base = roomIdBase(subject)`
 *      (which falls back to `room` for an unsluggable subject), then `appendGuarded` the
 *      single `announcement.posted` event with a `room_id` uniqueness guard. On a
 *      uniqueness conflict, bump the disambiguator (`base`, `base-2`, …) and retry — the
 *      atomic guard makes concurrent same-subject posts converge to sequential unique ids
 *      with no lost write and no error.
 *   3. Read the just-posted proto-room back through the rooms projection and return it,
 *      failing loud on a miss (never fabricates a record).
 *
 * A non-uniqueness rejection from the port (e.g. a store-busy fault) propagates as-is.
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param actor The posting handle (the MCP tool supplies the session handle).
 * @param input The board `projectId` + `subject` + `body` (boundary-validated).
 * @returns The created proto-room {@link Room} (its `roomId`, `projectId`, `subject`,
 *   `body`, `postedBy`, `seq`).
 * @throws BoardError `BOARD_NOT_FOUND` if `projectId` was never announced; `NOT_A_MEMBER`
 *   if `actor` has not joined the board.
 */
export async function postAnnouncement(
  dataAccess: DataAccess,
  actor: string,
  input: PostAnnouncementInput,
): Promise<Room> {
  const { projectId, subject, body } = input;

  // Step 1 — membership gate. Owns BOARD_NOT_FOUND (unknown board) + NOT_A_MEMBER
  // (non-member); on either it throws and we append nothing. Runs FIRST.
  await requireMembership(dataAccess, actor, projectId);

  // Body-size cap (Story 5.1 / AC #2) — throw BODY_TOO_LARGE for an over-cap body BEFORE the
  // appendGuarded allocation loop, so NOTHING is appended on over-cap. The cap is on UTF-8
  // BYTE length and is the closed core code (not a Zod .max). Placed AFTER the membership
  // gate so a non-member's over-cap post is rejected NOT_A_MEMBER first (the gate runs first).
  assertBodyWithinCap(body);

  // Step 2 — allocate a globally-unique roomId via appendGuarded + disambiguator retry.
  const base = roomIdBase(subject);
  let roomId = base;

  for (let attempt = 0; attempt < MAX_ROOM_ID_ATTEMPTS; attempt += 1) {
    roomId = roomIdForAttempt(base, attempt);
    try {
      await dataAccess.appendGuarded(
        [
          {
            type: 'announcement.posted',
            actor,
            payload: { projectId, roomId, subject, body },
          },
        ],
        // The room id is GLOBALLY unique: a single guard on the at-rest `room_id`
        // (snake_case), NOT scoped by project — a room is addressed by roomId alone.
        [{ type: 'announcement.posted', field: 'room_id', value: roomId }],
      );
      // Appended — the roomId was unclaimed and is now ours. Break out and read back.
      break;
    } catch (err) {
      if (isUniquenessConflict(err)) {
        // That exact roomId is taken (another announcement holds it). Bump the
        // disambiguator and retry; the suffix increases monotonically, so the loop
        // converges to the first free id with no lost write and no error (AC #4).
        continue;
      }
      // Anything else (e.g. a store-busy fault) propagates as-is.
      throw err;
    }
  }

  // Step 3 — read the just-posted proto-room back so the record (postedBy/seq) comes
  // from the ledger. The actor's own stream contains the announcement just appended.
  const own = await dataAccess.eventsByActor(actor);
  const room = findRoom(own, roomId);
  if (!room) {
    // Unreachable on the success path: we just appended announcement.posted for this
    // actor with this roomId. A miss means either the disambiguator loop exhausted its
    // (unreachable) bound without ever appending, or the append did not persist / the
    // read seam is broken — fail loud rather than fabricate a record.
    throw new Error(
      `postAnnouncement: just-posted room "${roomId}" not found in actor "${actor}"'s event stream (board "${projectId}").`,
    );
  }
  return room;
}
