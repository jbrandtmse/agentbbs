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

import { appendIdentityEventOrThrow } from './append-identity-event.js';

import type { DataAccess } from '../ports.js';
import type { Identity } from './projection.js';

/**
 * Update an identity's current focus (AC #1).
 *
 * GUARDS EXISTENCE BEFORE APPENDING (Story 3.0): confirms a prior
 * `identity.registered` for `handle` FIRST, then appends one
 * `identity.focus_updated` event (`actor: handle`, payload
 * `{ handle, currentFocus }`) via plain {@link DataAccess.append} — no uniqueness
 * guard — and reads the identity back through the projection so the returned record
 * reflects the append: `currentFocus` is the new value and `lastSeen` is the new
 * event's `createdAt` (advanced). The prior events are retained (append-only);
 * `createdAt` stays pinned to the identity's `identity.registered`.
 *
 * For an UNREGISTERED handle it throws WITHOUT appending — no orphan
 * `identity.focus_updated` is written (the ledger is unchanged on that path). The
 * shared helper also retains the broken-seam fail-loud guard (append succeeded but
 * the read-back still misses).
 *
 * The caller (the `update_focus` MCP tool) guarantees an established identity and
 * passes its canonical handle; this op does not re-check the session (that is a
 * server concern).
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
  // Guard-before-append + read-back is the shared identity-event shape. This op
  // supplies its event: a plain identity.focus_updated (focus updates are not
  // unique-constrained, so no guard — contrast register's claim).
  return appendIdentityEventOrThrow(dataAccess, handle, 'updateFocus', () => ({
    type: 'identity.focus_updated',
    actor: handle,
    payload: { handle, currentFocus },
  }));
}
