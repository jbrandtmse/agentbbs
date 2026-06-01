// The reactions projection + message resolver (Story 5.2, Task 2 / AC #1, #2, #3).
//
// LIVE 👍 state is DERIVED, never stored (THE APPEND INVARIANT): `message.reacted` /
// `message.unreacted` are appended facts; an actor's 👍 on a message is LIVE iff their LATEST
// such event (by `seq`) for that `messageSeq` is a `react`. There is no stored reaction column
// — the live set is recomputed from the event stream every read. This is the projection Story
// 5.3's current-contract computes over (the highest-`seq` message holding a live 👍).
//
// Three pure functions:
//   - `liveReactors(events, messageSeq)` — the handles whose latest react/unreact for the
//     message is a `react`, ordered by the `seq` of each live actor's CURRENT (live) react
//     (so A-reacts → [A], B-reacts → [A, B], A-unreacts → [B] — the AC #5 transitions).
//   - `hasLiveReaction(events, messageSeq, actor)` — the single-actor convenience over the same
//     latest-wins rule (the react/unreact ops' idempotency check).
//   - `findMessage(events, messageSeq)` — resolve the event at `messageSeq` to a MESSAGE: the
//     event IFF its type is `announcement.posted` (message #1) or `room.replied` (a reply),
//     returning its `roomId` (for the react/unreact participation gate) + actor + kind;
//     `undefined` otherwise (no event at that seq, or the event is not a message) — which the
//     react/unreact ops turn into `MESSAGE_NOT_FOUND`.
//
// Cannot-retract-another is INHERENT here (AC #2): liveness is scoped PER ACTOR (each actor's
// own latest event decides only their own membership), so an actor's `message.unreacted` can
// only flip THAT actor out of the live set — never another's. No special guard is needed.
//
// Pure: no I/O, deterministic for a given input; order-independent of the input array (computes
// by `seq`). `core` imports only the `Event` type — the lint-enforced module boundary. Mirrors
// the participants / room-history folds (same event-filtering shape).

import type { Event } from '../events/event.js';

/** A message resolved by {@link findMessage}: the event at `messageSeq`, IFF it is a message. */
export interface ResolvedMessage {
  /** The `seq` of the message's underlying event (the message's identity). */
  messageSeq: number;
  /** The slug id of the room the message belongs to (the react/unreact participation gate key). */
  roomId: string;
  /** The handle that authored the message (the announcer for #1, else the replier). */
  actor: string;
  /** Whether the message is the room's seeding announcement (#1) or a reply. */
  kind: 'announcement' | 'reply';
}

/**
 * The per-actor latest reaction state for ONE message — the `seq` of an actor's most recent
 * react/unreact, and whether that latest event was a `react` (→ the actor is currently live).
 */
interface LatestReaction {
  /** The `seq` of the actor's LATEST react/unreact for the message. */
  seq: number;
  /** `true` iff that latest event is a `message.reacted` (the actor's 👍 is live). */
  live: boolean;
}

/**
 * Fold a `seq`-ordered event stream into the per-actor latest react/unreact state for ONE
 * message (`messageSeq`). For each actor, keep the event with the HIGHEST `seq` among their
 * `message.reacted` / `message.unreacted` for that message; `live` is whether that latest event
 * is a react. Order-independent of the input array (compares `seq`), so it holds even if the
 * stream were not seq-sorted.
 *
 * Only the named `messageSeq`'s reactions contribute (cross-message isolation): a reaction on a
 * different message is ignored.
 */
function latestByActor(
  events: Event[],
  messageSeq: number,
): Map<string, LatestReaction> {
  const latest = new Map<string, LatestReaction>();

  for (const event of events) {
    if (
      event.type !== 'message.reacted' &&
      event.type !== 'message.unreacted'
    ) {
      continue;
    }
    // Only this message's reactions count.
    if (event.payload.messageSeq !== messageSeq) {
      continue;
    }
    const prior = latest.get(event.actor);
    // Keep the HIGHEST-seq event per actor (latest-wins). The `>=` is moot for a correct ledger
    // (seqs are unique) but makes "later in the stream at an equal seq wins" explicit/defensive.
    if (prior === undefined || event.seq >= prior.seq) {
      latest.set(event.actor, {
        seq: event.seq,
        live: event.type === 'message.reacted',
      });
    }
  }

  return latest;
}

/**
 * The LIVE 👍 reactors of the message at `messageSeq` — every actor whose LATEST react/unreact
 * for that message is a `react`, in the `seq` order of each live actor's current (live) react.
 *
 * Derived by latest-react-wins per actor (see {@link latestByActor}); DERIVED, never stored
 * (THE APPEND INVARIANT). The ordering is by the live react's `seq`, so the set grows in
 * reaction order (A then B → `[A, B]`) and a re-react re-orders the actor to its NEW react's
 * `seq`. A message with no live reactions → `[]`.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param messageSeq The `seq` identifying the message whose live reactors to project.
 * @returns The live-reactor handles, ordered by each one's current (live) react `seq`.
 */
export function liveReactors(events: Event[], messageSeq: number): string[] {
  const latest = latestByActor(events, messageSeq);

  return [...latest.entries()]
    .filter(([, state]) => state.live)
    .sort(([, a], [, b]) => a.seq - b.seq)
    .map(([actor]) => actor);
}

/**
 * Does `actor` hold a LIVE 👍 on the message at `messageSeq`? `true` iff the actor's LATEST
 * react/unreact for that message is a `react` (latest-wins). The single-actor convenience over
 * {@link liveReactors} — the react/unreact ops' idempotency check (re-react when already live, or
 * unreact when not live, is a no-op).
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param messageSeq The `seq` identifying the message.
 * @param actor The canonical handle whose live-reaction state to test.
 * @returns `true` iff `actor`'s latest reaction for the message is a live react.
 */
export function hasLiveReaction(
  events: Event[],
  messageSeq: number,
  actor: string,
): boolean {
  return latestByActor(events, messageSeq).get(actor)?.live ?? false;
}

/**
 * Resolve the event at `messageSeq` to a MESSAGE, or `undefined` if it is not one.
 *
 * The event at `messageSeq` is a message IFF its type is `announcement.posted` (the room's
 * seeding message #1) or `room.replied` (a reply) — those are the two event types `roomMessages`
 * (Story 4.4) folds into a room's history, and a "message" is identified by its `seq`. The
 * resolved record carries the message's `roomId` (the react/unreact participation gate key),
 * its `actor`, and its `kind`. Any other case → `undefined`:
 *   - no event has that `seq` (an out-of-range / never-allocated seq), or
 *   - the event at that `seq` is not a message (e.g. `identity.registered`, `board.joined`,
 *     `message.reacted`, …).
 * The react/unreact ops turn `undefined` into `BoardError('MESSAGE_NOT_FOUND')` (AC #3).
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param messageSeq The candidate message `seq` to resolve.
 * @returns The {@link ResolvedMessage} for that seq, or `undefined` if it is not a message.
 */
export function findMessage(
  events: Event[],
  messageSeq: number,
): ResolvedMessage | undefined {
  const event = events.find((e) => e.seq === messageSeq);
  if (event === undefined) {
    return undefined;
  }
  switch (event.type) {
    case 'announcement.posted':
      return {
        messageSeq: event.seq,
        roomId: event.payload.roomId,
        actor: event.actor,
        kind: 'announcement',
      };
    case 'room.replied':
      return {
        messageSeq: event.seq,
        roomId: event.payload.roomId,
        actor: event.actor,
        kind: 'reply',
      };
    default:
      // Not a message (some other event type happens to sit at this seq).
      return undefined;
  }
}
