// Shared "guard-before-append" helper for identity presence/focus ops (Story 3.0,
// Task 3 / AC #3).
//
// `recordSeen` (identity.seen) and `updateFocus` (identity.focus_updated) share the
// identical shape: append ONE identity event for an already-established handle, then
// read the identity back through the projection so the returned record reflects the
// append (advanced `lastSeen`, and the new `currentFocus` for focus updates).
//
// THE ORDERING FIX (was append-then-throw, now GUARD-BEFORE-APPEND): originally both
// ops appended FIRST and only then read back + threw if the fold yielded nothing — so
// calling either op for an UNREGISTERED handle left a dangling ORPHAN event in the
// ledger (deferred-work 2.5). This helper reorders so the existence/registration
// check precedes the append:
//
//   1) Read the handle's stream and fold it. If NO prior identity exists (no
//      `identity.registered`), THROW immediately — WITHOUT appending. The ledger is
//      unchanged on the unregistered path (no orphan).
//   2) Only once a prior registration is confirmed, append the ONE event.
//   3) Read the stream back and re-fold. If the record is STILL missing after a
//      successful append, the read/append seam is genuinely broken — THROW (fail
//      loud) rather than fabricate an `Identity`. This defensive branch is retained.
//
// Both ops delegate here so the class-level fix is symmetric — neither op can drift
// back to the orphan-append shape. The per-op event shape is supplied by the caller
// via `buildEvent`, so the helper does not obscure what each op writes.

import { findIdentity } from './projection.js';

import type { Identity } from './projection.js';
import type { NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * Append one identity event for an ALREADY-REGISTERED handle, guarding existence
 * BEFORE the append, then read the updated identity back.
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param handle The (canonical) handle the event is for — the actor/subject.
 * @param opName A short op name for clear error messages (e.g. `"recordSeen"`).
 * @param buildEvent Produces the single {@link NewEvent} to append (the per-op
 *   event shape: type + actor + payload). Called only AFTER existence is confirmed.
 * @returns The updated {@link Identity}, folded from the post-append stream.
 * @throws If `handle` has no prior `identity.registered` (NOTHING is appended), or
 *   if the post-append read-back still misses (the broken-seam fail-loud guard).
 */
export async function appendIdentityEventOrThrow(
  dataAccess: DataAccess,
  handle: string,
  opName: string,
  buildEvent: () => NewEvent,
): Promise<Identity> {
  // (1) GUARD FIRST — confirm a prior registration exists BEFORE appending. The
  // projection mints a record only for an identity.registered, so a missing fold
  // means the handle was never registered. Throw WITHOUT appending: no orphan event
  // is written on the unregistered path (the ledger is unchanged).
  const before = await dataAccess.eventsByActor(handle);
  if (!findIdentity(before, handle)) {
    throw new Error(
      `${opName}: identity "${handle}" is not registered — refusing to append for an unregistered handle.`,
    );
  }

  // (2) Append the ONE event now that the identity is confirmed. Plain append:
  // presence pings / focus updates are not unique-constrained (contrast register's
  // claim), and each distinct event is what advances the derived lastSeen.
  await dataAccess.append([buildEvent()]);

  // (3) Read the identity back so lastSeen/currentFocus come from the folded ledger
  // (data-access assigned the new event's createdAt). eventsByActor(handle) returns
  // exactly this identity's events, seq-ordered; folding yields the updated record.
  const after = await dataAccess.eventsByActor(handle);
  const identity = findIdentity(after, handle);
  if (!identity) {
    // The pre-append guard already confirmed the identity existed, so a miss HERE
    // means the append did not persist or the read seam is broken (a genuinely
    // broken seam) — fail loudly rather than fabricate an Identity.
    throw new Error(
      `${opName}: identity "${handle}" not found in its own event stream after a successful append (broken read/append seam).`,
    );
  }
  return identity;
}
