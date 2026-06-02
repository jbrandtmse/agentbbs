// The `check` discovery operation (Story 6.1) — the pull-only dial-in that closes the
// zero-relay loop (SM1, NFR5). `check(dataAccess, actor)` returns what is NEW for `actor`
// since their last dial-in — new ANNOUNCEMENTS in the sub-boards they are a MEMBER of and new
// MESSAGES in the rooms they PARTICIPATE in — scoped to them and ordered by `seq`, then
// ADVANCES their stored per-identity cursor to the max `seq` it RETURNED and marks their
// presence (`recordSeen`). It PUSHES nothing: the agent-facing contract is pull-only (NFR5);
// `check` is a cheap cursor query, never a notification source.
//
// The delta combines THREE position concepts:
//   1. the STORED per-identity cursor (the `cursors` table, getCursor/setCursor) — "since my
//      last check" — prevents re-showing SEEN items;
//   2. the per-BOARD join floor (`boardJoinSeq`, this story) — prevents an announcement flood
//      for a newly-joined board member;
//   3. the per-ROOM join floor (`roomJoinSeq`, Story 4.6) — prevents a message flood for a
//      newly-joined room participant.
// An item surfaces only if `seq > max(cursor, joinFloor)` — so a brand-new member/participant
// is NOT flooded with pre-join back-history (they browse it on demand via
// `list_announcements`/`read_room`), and an already-seen item is not re-shown. `check` computes
// the actor's per-board + per-room floors in ONE pass over the stream (the batched equivalent of
// `boardJoinSeq`/`roomJoinSeq`, which stay the canonical single-scope primitives) so it does not
// re-scan the full stream once per board and once per room (Story 6.1 Task 6 perf measurement).
//
// CURSOR ADVANCE — to `maxReturned`, NOT `maxSeq()` (AC #3, design decision 3): the cursor
// advances to the highest `seq` ACTUALLY RETURNED by this call (or stays put if the delta is
// empty). It is deliberately NOT advanced to the global ledger `maxSeq()`: a message that
// lands concurrently with (or after the fold of) this `check` and gets a higher `seq` than
// anything returned is then NOT swallowed — the cursor sits at `maxReturned < its seq`, so it
// surfaces on the NEXT `check`. Using `maxSeq()` would skip it.
//
// SCOPE (design decision 5): announcements by sub-board MEMBERSHIP (`isMember`); room messages
// by room PARTICIPATION (`roomParticipants`). A non-member sees neither that board's
// announcements nor its rooms' messages in `check` (they can still OPEN-read via
// `list_*`/`read_room`/`read_contract` — `check` is the SCOPED pull; the open reads are
// unscoped). A non-member board → no `boardJoinSeq` → skipped; a non-participant room → no
// `roomJoinSeq` → skipped (gate on `!== undefined`, NEVER `?? 0` — a `0` floor would flood;
// the Story 4.6 forward-note).
//
// recordSeen IS this op's first consumer (Story 2.5 forward-declared it): every dial-in
// advances `last_seen` (presence). Its guard-before-append double-read (deferred-work 3.0-b)
// is now on this hot path — measured at Story 6.1 (Task 6).
//
// Session-agnostic: `actor` is a PARAMETER (the MCP tool resolves the session handle and
// passes it). core stays storage- AND session-agnostic; this op depends ONLY on the DataAccess
// port (the cursor methods + `eventsSince`) and the core projections.

import { recordSeen } from '../identity/record-seen.js';
import { foldProjects } from '../projects/projection.js';
import { findRoom, foldRooms } from '../rooms/projection.js';
import { roomMessages } from '../rooms/room-history.js';
import { PROTOCOL_ROOM_ID } from '../seed/protocol-announcement.js';

import type { DataAccess } from '../ports.js';
import type { Room } from '../rooms/projection.js';
import type { RoomMessage } from '../rooms/room-history.js';

/**
 * One message in a `check` delta — a {@link RoomMessage} annotated with its `roomId`, so the
 * agent knows WHICH room each returned message belongs to (a bare `RoomMessage` carries only
 * `seq`/`actor`/`body`/`kind`/`reactions`). `check` returns messages across SEVERAL rooms the
 * actor participates in, so the `roomId` is essential context.
 */
export interface CheckMessage extends RoomMessage {
  /** The slug id of the room this message belongs to. */
  roomId: string;
}

/**
 * The result of a {@link check} dial-in: the actor's scoped delta + their advanced cursor.
 *
 * `announcements` are NEW proto-room announcements (folded {@link Room} records) in the
 * sub-boards the actor is a MEMBER of — each with `seq > max(cursor, boardJoinSeq)` — in `seq`
 * order. `messages` are NEW messages ({@link CheckMessage}, each carrying its `roomId`) in the
 * rooms the actor PARTICIPATES in — each with `seq > max(cursor, roomJoinSeq)` — in `seq`
 * order. `cursor` is the high-water-mark this call advanced to: the max `seq` RETURNED across
 * `announcements ∪ messages`, or the unchanged prior cursor if the delta is empty.
 */
export interface CheckResult {
  /** NEW announcements (proto-rooms) in the actor's member sub-boards, `seq`-ordered. */
  announcements: Room[];
  /** NEW messages in the actor's participated rooms (each with its `roomId`), `seq`-ordered. */
  messages: CheckMessage[];
  /** The advanced per-identity cursor — `maxReturned` (NOT `maxSeq()`), or unchanged if empty. */
  cursor: number;
  /**
   * The seeded main-board protocol announcement (Story 7.2), surfaced ONLY on the actor's
   * FIRST-EVER check (when they have no prior `identity.seen`) so a new agent MEETS the protocol
   * without being told out-of-band (FR26). It is surfaced REGARDLESS of the per-scope floors/
   * cursor — it is main-board-global and predates a late identity's join floor, so it would never
   * surface via the normal scoped delta. Present ONLY on a first-check surface:
   *   - `Room` — the protocol proto-room, on the actor's first check, when the board is seeded;
   *   - `undefined` (the field is OMITTED) — on every SUBSEQUENT check (the actor's `identity.seen`
   *     now exists), or on a first check of an UNSEEDED board (no protocol announcement to surface).
   * Additive: it does not change `announcements`/`messages`/`cursor` (the protocol is NOT injected
   * into the scoped delta and does NOT advance the cursor).
   */
  protocol?: Room;
}

/**
 * Return `actor`'s scoped delta since their last dial-in, advance their cursor, and mark their
 * presence (Story 6.1). PUSHES nothing (NFR5 pull-only).
 *
 * Steps:
 *   1. read the stored per-identity cursor (`getCursor`; `0` if never checked);
 *   2. read the whole `seq`-ordered stream once (`eventsSince(0)`) — the basis for the
 *      membership/participation/floor folds (the per-call full-stream fold the deferred-work
 *      3.0-b/4.6-a items measure);
 *   3. compute the actor's member sub-boards (`foldProjects` → `isMember`) and participated
 *      rooms (`roomParticipants` via the rooms fold);
 *   4. ANNOUNCEMENTS = proto-rooms in member boards with `seq > max(cursor, boardJoinSeq)`;
 *      MESSAGES = room messages in participated rooms with `seq > max(cursor, roomJoinSeq)`;
 *      both `seq`-ordered;
 *   5. `maxReturned` = the highest `seq` across `announcements ∪ messages` (or `cursor` if both
 *      empty) — NOT `maxSeq()` (AC #3);
 *   6. `setCursor(actor, maxReturned)`;
 *   7. FIRST-CHECK protocol surface (Story 7.2): if the actor has NO prior `identity.seen` (their
 *      first-ever check, detected at step 2's pre-recordSeen stream), surface the seeded protocol
 *      announcement (`findRoom(PROTOCOL_ROOM_ID)`) regardless of floors — additive, robust to an
 *      unseeded board (surfaces nothing);
 *   8. `recordSeen(actor)` (presence — its first consumer; this is what makes the NEXT check no
 *      longer a first-check);
 *   9. return `{ announcements, messages, cursor: maxReturned, protocol? }`.
 *
 * @param dataAccess The persistence port (the only dependency): the cursor methods +
 *   `eventsSince(0)` (ALL events `seq`-ordered) + the `recordSeen` append.
 * @param actor The canonical handle of the dialing-in identity (the MCP tool supplies the
 *   session handle; core stays session-agnostic).
 * @returns A {@link CheckResult}: the scoped, `seq`-ordered delta + the advanced cursor.
 */
export async function check(
  dataAccess: DataAccess,
  actor: string,
): Promise<CheckResult> {
  // (1) The stored per-identity high-water-mark — "since my last check" (0 if never checked).
  const cursor = await dataAccess.getCursor(actor);

  // (2) The whole `seq`-ordered stream — needed to fold the actor's memberships / participations
  // / floors. This is the per-call full-stream fold the deferred-work 3.0-b/4.6-a items measure.
  const events = await dataAccess.eventsSince(0);

  // (3a) The actor's MEMBER sub-boards (announcement scope) — folded projects whose `members`
  // include the actor. Reuses the Story 3.1 projection (single source of truth for membership).
  const projects = foldProjects(events);
  const memberBoardIds = new Set<string>();
  for (const project of projects.values()) {
    if (project.members.includes(actor)) {
      memberBoardIds.add(project.projectId);
    }
  }

  // (3b) The rooms directory (proto-rooms folded from `announcement.posted`). Used for the
  // announcement scope (rooms in member boards). The message scope iterates only the actor's
  // PARTICIPATED rooms (computed below), not this whole directory.
  const rooms = foldRooms(events);

  // (3c) The actor's per-board + per-room JOIN FLOORS, in ONE pass over the stream. This is the
  // SAME MIN-`seq` derivation `boardJoinSeq` (Story 6.1) and `roomJoinSeq` (Story 4.6) compute
  // for a single board/room — folded inline here for the WHOLE actor at once so `check` does not
  // re-scan the full stream once per board and once per room (the per-call-fold cost the
  // deferred-work 3.0-b/4.6-a items flagged; measured at Story 6.1 Task 6). `boardJoinSeq`/
  // `roomJoinSeq` stay the canonical single-scope primitives; this is their batched equivalent.
  //   - boardFloors: actor's earliest `board.joined` per board (their member-board floor);
  //   - roomFloors:  actor's earliest participating event per room (reply actor ∪ added handle)
  //                  — a room key present here ⇔ the actor participates in it (the `!== undefined`
  //                  gate from the Story 4.6 forward-note, as Map membership).
  const boardFloors = new Map<string, number>();
  const roomFloors = new Map<string, number>();
  // FIRST-CHECK detection (Story 7.2): the actor's FIRST-EVER check is the one where they have NO
  // prior `identity.seen` — `recordSeen` is `check`'s first consumer (step 7 below), so an
  // `identity.seen` by the actor exists iff they have checked before. We detect it from THIS
  // (pre-recordSeen) stream read, folded inline in the same pass as the floors so no extra scan.
  let hasPriorSeen = false;
  const considerMin = (
    map: Map<string, number>,
    key: string,
    seq: number,
  ): void => {
    const prior = map.get(key);
    if (prior === undefined || seq < prior) map.set(key, seq);
  };
  for (const event of events) {
    switch (event.type) {
      case 'board.joined':
        if (event.actor === actor) {
          considerMin(boardFloors, event.payload.projectId, event.seq);
        }
        break;
      case 'room.replied':
        if (event.actor === actor) {
          considerMin(roomFloors, event.payload.roomId, event.seq);
        }
        break;
      case 'room.participant_added':
        if (event.payload.handle === actor) {
          considerMin(roomFloors, event.payload.roomId, event.seq);
        }
        break;
      case 'identity.seen':
        // The actor's own presence ping from a PRIOR check ⇒ this is NOT their first check.
        if (event.actor === actor) {
          hasPriorSeen = true;
        }
        break;
      default:
        break;
    }
  }

  // (4a) ANNOUNCEMENTS — proto-rooms in the actor's MEMBER boards, surfacing only above the
  // per-board floor: `seq > max(cursor, boardFloor)`. A member always has a board floor (they
  // joined); `Math.max` with the stored cursor composes "since my last check" with "since I
  // joined this board" (no pre-join flood, no re-show). A non-member board is not in
  // `memberBoardIds` and is skipped entirely.
  const announcements: Room[] = [];
  for (const room of rooms.values()) {
    if (!memberBoardIds.has(room.projectId)) continue;
    // Defensive: a member always has a board floor; if somehow absent, fall back to the cursor
    // (never `?? 0`, which would flood pre-join back-history).
    const floor = Math.max(cursor, boardFloors.get(room.projectId) ?? cursor);
    if (room.seq > floor) {
      announcements.push(room);
    }
  }
  // `seq`-ordered (the authoritative total order; never `createdAt`).
  announcements.sort((a, b) => a.seq - b.seq);

  // (4b) MESSAGES — for each room the actor PARTICIPATES in (a key in `roomFloors`), the room's
  // messages above the per-room floor: `seq > max(cursor, roomFloor)`. Iterating only the
  // participated rooms (NOT every room) is the contained optimization: a non-participant room is
  // never folded. Each surfaced message is annotated with its `roomId` so the agent knows which
  // room it belongs to. (A participant's own joining message sits AT the floor and is excluded by
  // the strict `>`; the seeding announcement, below the floor, is not double-surfaced here.)
  const messages: CheckMessage[] = [];
  for (const [roomId, roomFloorSeq] of roomFloors) {
    const floor = Math.max(cursor, roomFloorSeq);
    for (const message of roomMessages(events, roomId)) {
      if (message.seq > floor) {
        messages.push({ ...message, roomId });
      }
    }
  }
  // `seq`-ordered across all participated rooms (a single combined, seq-sorted delta).
  messages.sort((a, b) => a.seq - b.seq);

  // (5) `maxReturned` = the highest `seq` ACTUALLY RETURNED (announcements ∪ messages), or the
  // unchanged prior cursor if the delta is empty (AC #2). NOT `maxSeq()` — so a concurrent /
  // out-of-scope higher-`seq` event is not swallowed and surfaces on the next check (AC #3).
  let maxReturned = cursor;
  for (const room of announcements) {
    if (room.seq > maxReturned) maxReturned = room.seq;
  }
  for (const message of messages) {
    if (message.seq > maxReturned) maxReturned = message.seq;
  }

  // (6) Advance (UPSERT) the stored per-identity cursor to `maxReturned`. On an empty delta this
  // re-writes the same value (cursor unchanged — AC #2).
  await dataAccess.setCursor(actor, maxReturned);

  // (7) FIRST-CHECK protocol surface (Story 7.2 / AC #3): on the actor's FIRST-EVER check
  // (no prior `identity.seen`, detected above BEFORE recordSeen appends one), surface the seeded
  // main-board protocol announcement REGARDLESS of the floors/cursor — it is main-board-global and
  // predates a late identity's join floor, so it would never surface via the scoped delta. Robust
  // to an UNSEEDED board: `findRoom` returns undefined → surface nothing. ADDITIVE — it is NOT
  // injected into `announcements` and does NOT advance the cursor. On a subsequent check
  // (`hasPriorSeen`) it is not re-surfaced.
  const protocol = hasPriorSeen
    ? undefined
    : findRoom(events, PROTOCOL_ROOM_ID);

  // (8) Mark presence — `check` is `recordSeen`'s FIRST consumer (Story 2.5): every dial-in
  // advances `last_seen`. The actor is an established identity (the MCP tool gated the session),
  // so the guard-before-append finds the registration and appends one `identity.seen`. (This is
  // what makes a LATER check no longer a first-check — its `identity.seen` is now in the stream.)
  await recordSeen(dataAccess, actor);

  // (9) The scoped, `seq`-ordered delta + the advanced cursor + (first-check only) the protocol.
  // Build the result WITHOUT a `protocol` key when there is nothing to surface (subsequent check
  // or unseeded board), so the field is OMITTED rather than carried as `undefined`.
  const result: CheckResult = { announcements, messages, cursor: maxReturned };
  if (protocol !== undefined) {
    result.protocol = protocol;
  }
  return result;
}
