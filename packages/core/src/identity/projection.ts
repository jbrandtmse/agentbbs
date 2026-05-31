// The identity directory projection (Story 2.2, Task 2 / AC #1).
//
// Folds the event stream into the identity directory: every `identity.registered`
// becomes one identity record. Derived state, NEVER stored (THE APPEND INVARIANT
// + the Story 2.5 contract that `last_seen` is computed from the stream, not a
// column): callers re-fold (or fold a filtered read) every time they need the
// directory; there is no `identities` table and no `last_seen` column anywhere.
//
// Ordering: the fold consumes events in `seq` order — the authoritative total
// order (`seq`, NEVER `createdAt`). The caller passes events already `seq`-ordered
// (every `DataAccess` read returns them so). Because `seq` is monotonic and
// `createdAt` is stamped at append, the LAST event (by `seq`) for an identity also
// carries the latest `createdAt` — so `lastSeen` is taken from that last event's
// `createdAt` without ever COMPARING timestamps (which the append invariant
// forbids as an ordering key).
//
// ADDITIVE-by-design (Stories 2.4 / 2.5): the fold has three extension seams the
// later identity events slot into without reshaping anything:
//   - `IDENTITY_EVENT_TYPES` — the set of event types whose `actor` is the
//     subject identity (so a folded event advances that identity's `lastSeen`).
//     Story 2.5 adds `identity.seen`; Story 2.4 adds `identity.focus_updated`.
//   - the per-event reducer's `switch (event.type)` — `identity.focus_updated`
//     (2.4) adds a branch that overwrites `currentFocus`; `identity.seen` (2.5)
//     adds a branch that only advances `lastSeen`.
//   - `lastSeen` advancement is applied to EVERY in-directory identity event, so
//     once 2.4/2.5 add their types to `IDENTITY_EVENT_TYPES`, presence tracking
//     works with no further change here.
// This story folds ONLY `identity.registered`, for which `lastSeen === createdAt`.

import type { Event } from '../events/event.js';
import type { EventType } from '../events/types.js';

/**
 * One row of the identity directory — the folded identity record. All camelCase
 * (the internal contract); the snake_case wire mapping lives at the MCP boundary.
 *
 * `lastSeen` is DERIVED from the event stream (the `createdAt` of the identity's
 * latest event by `seq`); at registration it equals `createdAt`. It is never a
 * stored column (Story 2.5 AC, honored now).
 */
export interface Identity {
  /** The registered handle (lowercased canonical form) — the directory key. */
  handle: string;
  /** The identity's current focus statement (latest value folded so far). */
  currentFocus: string;
  /** `createdAt` of this identity's `identity.registered` event (display-only ISO-8601). */
  createdAt: string;
  /**
   * Derived presence: the `createdAt` of the identity's latest event by `seq`.
   * Equals `createdAt` at registration; advances as `identity.seen` /
   * `identity.focus_updated` fold in (Stories 2.5 / 2.4). Never stored.
   */
  lastSeen: string;
}

/**
 * Event types whose top-level `actor` IS the subject identity, so folding one
 * advances that identity's `lastSeen`. This story: only `identity.registered`.
 * Stories 2.4 / 2.5 ADD `identity.focus_updated` / `identity.seen` here (and a
 * matching reducer branch below) — the only edits presence tracking needs.
 *
 * NB: `room.participant_added` also has a payload `handle`, but its top-level
 * `actor` is the ADDER, not the added identity, so it is deliberately NOT here —
 * the directory is keyed on `actor` for these types.
 */
const IDENTITY_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'identity.registered',
  // Story 2.4: a focus update's actor IS the subject identity, so folding one
  // advances that identity's lastSeen (and the reducer branch below overwrites
  // currentFocus). Story 2.5 adds 'identity.seen' here next.
  'identity.focus_updated',
]);

/** True for an event whose `actor` is the subject identity (see the set above). */
function isIdentityEvent(event: Event): boolean {
  return IDENTITY_EVENT_TYPES.has(event.type);
}

/**
 * Fold a `seq`-ordered event stream into the identity directory, keyed by handle
 * (the canonical lowercased form). Pure: no I/O, deterministic for a given input.
 *
 * Contract: `events` MUST be ordered by `seq` ascending (every `DataAccess` read
 * guarantees this). A `Map` preserves first-registration insertion order, so
 * iterating the result yields identities in registration order.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @returns A `Map<handle, Identity>` — the identity directory.
 */
export function foldIdentities(events: Event[]): Map<string, Identity> {
  const directory = new Map<string, Identity>();

  for (const event of events) {
    if (!isIdentityEvent(event)) continue;
    // For identity events the actor IS the subject identity (the directory key).
    const handle = event.actor;

    switch (event.type) {
      case 'identity.registered': {
        // First registration wins the record. A duplicate `identity.registered`
        // for the same handle cannot occur (appendGuarded's uniqueness guard
        // forbids it), but we defensively keep the earliest as canonical rather
        // than letting a later one clobber `createdAt`.
        if (!directory.has(handle)) {
          directory.set(handle, {
            handle,
            currentFocus: event.payload.currentFocus,
            createdAt: event.createdAt,
            lastSeen: event.createdAt,
          });
        }
        break;
      }
      case 'identity.focus_updated': {
        // Story 2.4: overwrite the existing identity's currentFocus with the new
        // value. No-op if the record is absent (a focus update with no preceding
        // registration — not reachable in V1 since update_focus requires an
        // established/registered session; defensive only, mints no phantom). The
        // shared lastSeen advancement below carries this event's createdAt.
        const existing = directory.get(handle);
        if (existing) existing.currentFocus = event.payload.currentFocus;
        break;
      }
      // Story 2.5 (identity.seen → presence-only) adds its branch here. It must add
      // its type to IDENTITY_EVENT_TYPES above for this switch to receive it.
      default:
        break;
    }

    // Advance presence for any folded identity event. Because events arrive in
    // `seq` order (the authoritative order) the last one for a handle carries the
    // latest `createdAt`, so this assignment leaves `lastSeen` at that latest
    // value without comparing timestamps (the append invariant forbids ordering
    // by createdAt). No-op if the record is absent (e.g. an identity event with
    // no preceding registration — not reachable in V1, defensive only).
    const record = directory.get(handle);
    if (record) record.lastSeen = event.createdAt;
  }

  return directory;
}

/**
 * Look up a single identity by its canonical handle from a `seq`-ordered event
 * stream. Convenience over {@link foldIdentities} for the common "read one
 * identity back" case (e.g. `register` reading the just-appended record to obtain
 * the data-access-assigned `createdAt`). Returns `undefined` if unregistered.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param handle The canonical lowercased handle to resolve.
 */
export function findIdentity(
  events: Event[],
  handle: string,
): Identity | undefined {
  return foldIdentities(events).get(handle);
}
