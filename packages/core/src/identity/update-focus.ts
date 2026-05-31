// The `updateFocus` board operation (Story 2.4, Task 3 / AC #1).
//
// A focus update is an APPEND, never a mutation: it appends ONE
// `identity.focus_updated` event for the (already-established) handle and reads
// the identity back through the projection so the returned `currentFocus` is the
// new value and `lastSeen` is the just-appended event's `createdAt` (advanced —
// data-access stamps it; core never fabricates a timestamp). The prior
// `identity.registered`/`identity.focus_updated` rows REMAIN in the ledger — the
// directory's `current_focus` is the DERIVED latest value (the append invariant).
//
// No uniqueness guard: a focus update is not unique-constrained (unlike register's
// handle claim), so it uses plain `append`, not `appendGuarded`.
//
// This is board LOGIC, so it lives in core (not the thin MCP handler), and depends
// ONLY on the DataAccess port. WHO may update — the session precondition (an
// established identity) — is NOT decided here: the mcp-server tool checks the
// session holder and supplies the acting handle; core just appends + reads back.

import { findIdentity } from './projection.js';

import type { DataAccess } from '../ports.js';
import type { Identity } from './projection.js';

/**
 * Update an identity's current focus (AC #1).
 *
 * Appends one `identity.focus_updated` event (`actor: handle`, payload
 * `{ handle, currentFocus }`) via plain {@link DataAccess.append} — no uniqueness
 * guard — then reads the identity back through the projection (`eventsByActor`
 * folded by {@link findIdentity}) so the returned record reflects the append:
 * `currentFocus` is the new value and `lastSeen` is the new event's `createdAt`
 * (advanced). The prior events are retained (append-only); `createdAt` stays
 * pinned to the identity's `identity.registered`.
 *
 * The caller (the `update_focus` MCP tool) guarantees an established identity and
 * passes its canonical handle; this op does not re-check the session (that is a
 * server concern) and assumes a prior registration exists for `handle`.
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param handle The (canonical) handle whose focus is being updated — the actor.
 * @param currentFocus The new current-focus statement.
 * @returns The updated {@link Identity} (`handle`, `currentFocus`, `createdAt`,
 *   `lastSeen`).
 */
export async function updateFocus(
  dataAccess: DataAccess,
  handle: string,
  currentFocus: string,
): Promise<Identity> {
  // Append ONE focus_updated event for this actor. Plain append: focus updates are
  // not unique-constrained, so no guard is needed (contrast register's claim).
  await dataAccess.append([
    {
      type: 'identity.focus_updated',
      actor: handle,
      payload: { handle, currentFocus },
    },
  ]);

  // Read the identity back so currentFocus/lastSeen come from the folded ledger
  // (data-access assigned the new event's createdAt). eventsByActor(handle) returns
  // exactly this identity's events, seq-ordered; folding yields the updated record.
  const own = await dataAccess.eventsByActor(handle);
  const identity = findIdentity(own, handle);
  if (!identity) {
    // Unreachable: the caller guarantees an established (registered) identity, and
    // we just appended a focus event for it. A miss would mean the append did not
    // persist or the read seam is broken — fail loudly rather than fabricate.
    throw new Error(
      `updateFocus: identity "${handle}" not found in its own event stream after append.`,
    );
  }
  return identity;
}
