// The `react` / `unreact` board operations (Story 5.2, Task 3 / AC #1, #2, #3, #4).
//
// Placing or retracting a 👍 on a specific message — both APPEND-only, both gated on the actor
// PARTICIPATING in the message's room. A 👍 is a ratification signal within a negotiation you
// are already in: reacting REQUIRES participation (→ NOT_A_MEMBER) and does NOT grant it (only
// `reply`/`add_participant` are "acting = joining", Epic 3) — so `react`/`unreact` gate on
// `roomParticipants(roomId)` of the MESSAGE's room, mirroring `addParticipant`'s adder-gate.
//
// LIVE 👍 state is DERIVED, never stored (THE APPEND INVARIANT): an actor's 👍 on a message is
// live iff their LATEST `message.reacted`/`message.unreacted` for that `messageSeq` is a react
// (see `reactions.ts`). So the ops only ever APPEND a fact; the live set is a query.
//
// Shape vs. the other ops:
//   - vs. `addParticipant` (the gate template): SAME participation gate (`roomParticipants` ∋
//     actor, else NOT_A_MEMBER) — but reacting does NOT grant membership, so there is NO
//     conditional `board.joined`. It resolves the MESSAGE (via `findMessage` → MESSAGE_NOT_FOUND)
//     rather than a room id, then gates on the message's room.
//   - vs. `joinBoard`/`addParticipant` (the idempotent-skip template): re-`react` when already
//     live, or `unreact` when not live, is a NO-OP — no redundant event.
//
// Cannot-retract-another is INHERENT (AC #2): `unreact` appends only the ACTOR's own
// `message.unreacted`, and liveness is scoped per actor (`reactions.ts`), so an unreact can only
// flip the actor's OWN entry — never another's. No special guard needed.
//
// PLAIN `append` (NOT `appendGuarded`) — reactions are not uniqueness-constrained: a benign
// concurrent double-react lands two `message.reacted`, deduped by the latest-wins projection. No
// atomic claim, no lock — same rationale as `reply`/`addParticipant`.
//
// `actor` is supplied by the caller (the MCP tool passes the session handle); core stays
// session-agnostic, mirroring `reply`/`addParticipant`/`postAnnouncement`. core imports only the
// `DataAccess` port.

import { BoardError } from '../errors.js';
import { roomParticipants } from './participants.js';
import { findMessage, hasLiveReaction, liveReactors } from './reactions.js';

import type { DataAccess } from '../ports.js';
import type { Event } from '../events/event.js';

/**
 * The result of {@link react} / {@link unreact}: the message's `seq` + its LIVE 👍 reactors
 * AFTER the op (read back from the ledger). The `react`/`unreact` MCP tools map this to the wire
 * (`{ message_seq, reactions }`), consistent with the room tools' read-back envelopes.
 */
export interface ReactResult {
  /** The `seq` identifying the message that was reacted / unreacted. */
  messageSeq: number;
  /** The message's LIVE 👍 reactors after the op, ordered by each one's current react `seq`. */
  reactions: string[];
}

/**
 * Resolve the message at `messageSeq` and gate the actor on participating in its room — the
 * shared precondition of {@link react} and {@link unreact}. Returns the relevant slice (the read
 * `events` stream + the message's `roomId`) so the caller can decide the idempotent no-op /
 * append without re-reading.
 *
 * @throws BoardError `MESSAGE_NOT_FOUND` if `messageSeq` is not a message (nothing appended,
 *   AC #3); `NOT_A_MEMBER` if `actor` is not a participant of the message's room (nothing
 *   appended, AC #4). The message is resolved BEFORE the participation gate, so a non-message
 *   seq is MESSAGE_NOT_FOUND even for a non-participant.
 */
async function resolveAndGate(
  dataAccess: DataAccess,
  actor: string,
  messageSeq: number,
): Promise<{ events: Event[]; roomId: string }> {
  // Read the whole `seq`-ordered stream once. A message never disappears (append-only), so its
  // existence here holds through the later append — no transaction spanning the check + the
  // append is needed (the reaction is a plain append, like reply/addParticipant).
  const events = await dataAccess.eventsSince(0);

  // Resolve the MESSAGE first (AC #3): the event at messageSeq must be a message
  // (announcement.posted / room.replied). A non-message seq → MESSAGE_NOT_FOUND, nothing appended.
  const message = findMessage(events, messageSeq);
  if (message === undefined) {
    throw new BoardError(
      'MESSAGE_NOT_FOUND',
      `No message at seq ${messageSeq}: it is not an announcement or a reply.`,
    );
  }

  // Gate (AC #4): the ACTOR must PARTICIPATE in the message's room (replied or been added).
  // Reacting ratifies a negotiation you are in; it does NOT grant participation (only
  // reply/add_participant do). Room-level participation reuses NOT_A_MEMBER (the closed error
  // set's architecture model, as in addParticipant).
  if (!roomParticipants(events, message.roomId).includes(actor)) {
    throw new BoardError(
      'NOT_A_MEMBER',
      `Handle "${actor}" is not a participant of room "${message.roomId}"; you can only react to a message in a negotiation you are part of.`,
    );
  }

  return { events, roomId: message.roomId };
}

/**
 * Place a 👍 on the message at `messageSeq`, on behalf of `actor` (AC #1).
 *
 * Steps:
 *   1. Resolve the message + gate the actor on participating in its room (see
 *      {@link resolveAndGate}) — MESSAGE_NOT_FOUND / NOT_A_MEMBER, nothing appended.
 *   2. Idempotency: if `actor` already holds a LIVE 👍 on the message, return unchanged with NO
 *      append (AC #1) — a 👍 is a state, not a repeatable action (mirror joinBoard).
 *   3. Otherwise PLAIN-`append` one `message.reacted` ({ messageSeq }, actor = `actor`).
 *   4. Read the live reactors back from the ledger and return `{ messageSeq, reactions }`.
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param actor The reacting handle — MUST participate in the message's room (the MCP tool
 *   supplies the session handle).
 * @param messageSeq The `seq` of the message to react to.
 * @returns The {@link ReactResult}: the message seq + its live reactors after the react.
 * @throws BoardError `MESSAGE_NOT_FOUND` (not a message) / `NOT_A_MEMBER` (not a participant) —
 *   nothing appended in either case.
 */
export async function react(
  dataAccess: DataAccess,
  actor: string,
  messageSeq: number,
): Promise<ReactResult> {
  const { events } = await resolveAndGate(dataAccess, actor, messageSeq);

  // Idempotent re-react: already live → no-op, NO redundant message.reacted (AC #1).
  if (hasLiveReaction(events, messageSeq, actor)) {
    return { messageSeq, reactions: liveReactors(events, messageSeq) };
  }

  // Plain append (not appendGuarded) — reactions are not uniqueness-constrained; a benign
  // concurrent double-react both lands and the latest-wins projection dedups.
  await dataAccess.append([
    { type: 'message.reacted', actor, payload: { messageSeq } },
  ]);

  // Read the live reactors back so the returned set reflects the just-appended react.
  const after = await dataAccess.eventsSince(0);
  return { messageSeq, reactions: liveReactors(after, messageSeq) };
}

/**
 * Retract `actor`'s 👍 from the message at `messageSeq` (AC #2).
 *
 * Steps:
 *   1. Resolve the message + gate the actor on participating in its room (see
 *      {@link resolveAndGate}) — MESSAGE_NOT_FOUND / NOT_A_MEMBER, nothing appended.
 *   2. Idempotency: if `actor` holds NO live 👍 on the message, return unchanged with NO append
 *      (AC #2) — nothing to retract (mirror joinBoard's idempotent skip).
 *   3. Otherwise PLAIN-`append` one `message.unreacted` ({ messageSeq }, actor = `actor`). Only
 *      the actor's OWN event is appended, and liveness is per-actor, so this flips ONLY the
 *      actor's entry — another identity's live 👍 is untouched (AC #2, structurally).
 *   4. Read the live reactors back from the ledger and return `{ messageSeq, reactions }`.
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param actor The retracting handle — MUST participate in the message's room (the MCP tool
 *   supplies the session handle).
 * @param messageSeq The `seq` of the message to unreact.
 * @returns The {@link ReactResult}: the message seq + its live reactors after the unreact.
 * @throws BoardError `MESSAGE_NOT_FOUND` (not a message) / `NOT_A_MEMBER` (not a participant) —
 *   nothing appended in either case.
 */
export async function unreact(
  dataAccess: DataAccess,
  actor: string,
  messageSeq: number,
): Promise<ReactResult> {
  const { events } = await resolveAndGate(dataAccess, actor, messageSeq);

  // Idempotent no-op: the actor holds no live 👍 → nothing to retract, NO redundant
  // message.unreacted (AC #2).
  if (!hasLiveReaction(events, messageSeq, actor)) {
    return { messageSeq, reactions: liveReactors(events, messageSeq) };
  }

  // Plain append of the actor's OWN message.unreacted — flips only the actor's entry (liveness
  // is per-actor), so another identity's live 👍 is unchanged (AC #2, inherent).
  await dataAccess.append([
    { type: 'message.unreacted', actor, payload: { messageSeq } },
  ]);

  // Read the live reactors back so the returned set reflects the just-appended unreact.
  const after = await dataAccess.eventsSince(0);
  return { messageSeq, reactions: liveReactors(after, messageSeq) };
}
