// The `addParticipant` board operation (Story 4.5, Task 2 / AC #1–#5).
//
// Pulling a registered peer into a room mid-negotiation — the OTHER "acting = joining"
// consumer (alongside `reply` 4.3): adding a participant makes the TARGET a sub-board member
// if not already (FR10). It appends ONE `room.participant_added` ({ roomId, handle: target },
// actor = the ADDER) and — IFF the target is not already a sub-board member — a `board.joined`
// ({ projectId }) whose ACTOR is the TARGET (the pulled-in peer joins the board), ATOMICALLY
// in one transaction.
//
// Shape vs. the other ops:
//   - vs. `reply` (the conditional-auto-join template): SAME pattern — a primary room event
//     PLUS a conditional `board.joined` (skip if already a member), bundled in ONE `append`.
//     The DIFFERENCE: `reply`'s auto-join is for the ACTOR (the replier joins); here the
//     auto-join is for the TARGET (the pulled-in peer joins) — the `board.joined`'s ACTOR is
//     the target, NOT the adder. And unlike `reply` (which GRANTS membership to any established
//     identity), `addParticipant` GATES on the actor being a room PARTICIPANT first.
//   - vs. `joinBoard` (the idempotent-skip template): if the target is already a participant,
//     it is a no-op — NO redundant `room.participant_added`/`board.joined`. Mirrors
//     `joinBoard`'s idempotent re-join exactly.
//   - vs. `requireMembership` (the gate template): the actor-must-be-a-participant gate reuses
//     `NOT_A_MEMBER` (room-level participation reuses the membership code per the closed error
//     set's architecture model) — but the predicate is room PARTICIPATION (`roomParticipants`),
//     not board membership.
//
// PLAIN append (NOT appendGuarded) — participation is NOT uniqueness-constrained: a benign
// concurrent double-add lands two `room.participant_added` for the same target, deduped by the
// participants projection (and the target's two `board.joined` deduped by the members
// projection). No atomic claim, no lock needed — same rationale as `reply`/`joinBoard`.
//
// The GATE (the actor is a participant) means a proto-room (no reply yet → no participants)
// has no one who can `add_participant` to it, naturally enforcing "an active room I participate
// in" WITHOUT a separate proto check. And `room.participant_added` does NOT activate a room
// (activation is ≥1 `room.replied`, Story 4.2) — moot here since the gate already implies a
// reply exists.
//
// `actor` is supplied by the caller (the MCP tool passes the session handle); core stays
// session-agnostic, mirroring `reply`/`joinBoard`/`postAnnouncement`.

import { BoardError } from '../errors.js';
import { findIdentity } from '../identity/projection.js';
import { findProject } from '../projects/projection.js';
import { isMember } from '../projects/membership.js';
import { isParticipant, roomParticipants } from './participants.js';
import { findRoom } from './projection.js';

import type { DataAccess } from '../ports.js';
import type { NewEvent } from '../events/event.js';
import type { Room } from './projection.js';

/** Input to {@link addParticipant} (camelCase; the MCP boundary maps snake_case → this). */
export interface AddParticipantInput {
  /**
   * The room slug id to add the participant to. Must reference an existing room; an unknown
   * id is `ROOM_NOT_FOUND`.
   */
  roomId: string;
  /**
   * The handle of the TARGET identity to pull into the room. Canonicalized (lowercased)
   * before lookup; must reference a registered identity, else `HANDLE_NOT_FOUND`.
   */
  handle: string;
}

/**
 * The result of {@link addParticipant}: the room + its participants after the add. The
 * `add_participant` tool maps this to the wire (`{ room, participants }`).
 */
export interface AddParticipantResult {
  /** The folded {@link Room} record (read back from the ledger). */
  room: Room;
  /** The room's participants after the add, de-duped in first-seen `seq` order. */
  participants: string[];
}

/**
 * Add the registered identity `handle` as a participant of room `roomId`, on behalf of
 * `actor` (AC #1–#5).
 *
 * Steps:
 *   1. Read the whole `seq`-ordered stream and resolve the room via {@link findRoom}. An
 *      unknown `roomId` throws `BoardError('ROOM_NOT_FOUND')` and appends NOTHING (AC #3).
 *   2. Gate: `actor` MUST be a participant of the room (has replied or been added — see
 *      {@link roomParticipants}); otherwise throw `BoardError('NOT_A_MEMBER')` (AC #4). A
 *      proto-room has no participants, so no one can add to it.
 *   3. Canonicalize the target `handle` (lowercase) and resolve it via {@link findIdentity}.
 *      An unregistered handle throws `BoardError('HANDLE_NOT_FOUND')` and appends NOTHING
 *      (AC #2).
 *   4. Idempotency: if the (canonical) target is ALREADY a participant, return unchanged with
 *      NO append (AC #5) — mirrors `joinBoard`'s idempotent re-join.
 *   5. Otherwise build the append list: ALWAYS one `room.participant_added`
 *      ({ roomId, handle: <canonical target> }) whose actor is `actor` (the adder), PLUS one
 *      `board.joined` ({ projectId }) whose ACTOR is the TARGET, IFF the target is not already
 *      a member of the room's sub-board (the pulled-in peer joins the board — mirror `reply`'s
 *      auto-join, but for the target). PLAIN `append` the list in ONE transaction (AC #1: the
 *      add-and-join is atomic). NOT `appendGuarded`: participation is not uniqueness-
 *      constrained; a benign concurrent double-add is de-duped by the projections.
 *   6. Read the room + participants back from the ledger and return them (fail loud on a miss).
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param actor The adding handle — MUST be a room participant (the MCP tool supplies the
 *   session handle).
 * @param input The target `roomId` + the target `handle` (boundary-validated).
 * @returns The {@link AddParticipantResult}: the room + its participants after the add.
 * @throws BoardError `ROOM_NOT_FOUND` if no such room (nothing appended); `NOT_A_MEMBER` if
 *   `actor` is not a participant of the room (nothing appended); `HANDLE_NOT_FOUND` if the
 *   target handle is not a registered identity (nothing appended).
 */
export async function addParticipant(
  dataAccess: DataAccess,
  actor: string,
  input: AddParticipantInput,
): Promise<AddParticipantResult> {
  const { roomId } = input;

  // Step 1 — resolve the room. Read the full stream and fold it. An unknown room throws
  // ROOM_NOT_FOUND and appends nothing (AC #3). A room never disappears (append-only), so its
  // existence here holds through the later append — no transaction spanning the check and the
  // append is needed (the participant_added is a plain append, like reply/joinBoard).
  const events = await dataAccess.eventsSince(0);
  const room = findRoom(events, roomId);
  if (!room) {
    throw new BoardError(
      'ROOM_NOT_FOUND',
      `No such room: "${roomId}". It was never announced.`,
    );
  }

  // Step 2 — gate: the ACTOR must be a participant of THIS room (replied or previously added).
  // You can only pull a peer into a negotiation you are part of. Room-level participation
  // reuses NOT_A_MEMBER per the closed error set's architecture model (AC #4). A proto-room
  // has no participants, so this naturally rejects adding to a room no one has engaged with.
  if (!isParticipant(events, roomId, actor)) {
    throw new BoardError(
      'NOT_A_MEMBER',
      `Handle "${actor}" is not a participant of room "${roomId}"; you can only add a peer to a negotiation you are part of.`,
    );
  }

  // Step 3 — resolve the TARGET. Canonicalize the handle (lowercase, consistent with
  // register/login) and resolve via findIdentity. An unregistered handle throws
  // HANDLE_NOT_FOUND and appends nothing (AC #2).
  const target = input.handle.toLowerCase();
  if (findIdentity(events, target) === undefined) {
    throw new BoardError(
      'HANDLE_NOT_FOUND',
      `No registered identity with handle "${target}".`,
    );
  }

  // Step 4 — idempotent re-add: the target is ALREADY a participant → return unchanged, NO
  // append (AC #5). Participation is a state, not a repeatable action (mirror joinBoard).
  if (isParticipant(events, roomId, target)) {
    return { room, participants: roomParticipants(events, roomId) };
  }

  // Step 5 — build the append list. room.participant_added ALWAYS (actor = the adder, handle =
  // the canonical target). board.joined IFF the target is not already a member of the room's
  // sub-board — and its ACTOR is the TARGET (the pulled-in peer joins the board; mirror reply's
  // auto-join but for the target). The room record carries its projectId; the project always
  // exists (the announcement that minted the room was posted to it).
  const { projectId } = room;
  const project = findProject(events, projectId);
  const targetAlreadyMember =
    project !== undefined && isMember(project, target);

  const toAppend: NewEvent[] = [
    {
      type: 'room.participant_added',
      actor,
      payload: { roomId, handle: target },
    },
  ];
  if (!targetAlreadyMember) {
    toAppend.push({
      type: 'board.joined',
      actor: target,
      payload: { projectId },
    });
  }

  // PLAIN append (not appendGuarded) — participation is not uniqueness-constrained: a benign
  // concurrent double-add both lands, and the participants/members projections de-dup. The
  // participant_added + the target's board.joined go in ONE append so the add-and-join is
  // atomic (AC #1).
  await dataAccess.append(toAppend);

  // Step 6 — read the room + participants back from the ledger so the returned record reflects
  // the just-appended add. Fail loud on a miss rather than fabricate.
  const after = await dataAccess.eventsSince(0);
  const updated = findRoom(after, roomId);
  if (!updated) {
    // Unreachable on the success path: the room existed at Step 1, append-only means it still
    // exists, and we just appended a room.participant_added for it. A miss means the append did
    // not persist or the read seam is broken — fail loud rather than fabricate.
    throw new Error(
      `addParticipant: room "${roomId}" not found after appending room.participant_added for target "${target}".`,
    );
  }
  return { room: updated, participants: roomParticipants(after, roomId) };
}
