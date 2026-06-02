// The `recordSeen` presence primitive (Story 2.5, Task 2 / AC #1, #2).
//
// A presence ping is an APPEND, never a mutation: it appends ONE `identity.seen`
// event for the (already-established) handle and reads the identity back through
// the projection so the returned `lastSeen` is the just-appended event's
// `createdAt` (advanced — data-access stamps it; core never fabricates a
// timestamp), while `currentFocus` and `createdAt` are the unchanged folded
// values. The prior `identity.registered` / `identity.focus_updated` / earlier
// `identity.seen` rows REMAIN in the ledger — `last_seen` is the DERIVED latest
// identity-event `createdAt` (the append invariant). An `UPDATE identities SET
// last_seen = …` is the explicit anti-pattern the architecture forbids; presence
// MUST be an appended `identity.seen` event.
//
// No uniqueness guard: a presence ping is not unique-constrained (unlike
// register's handle claim), so it uses plain `append`, not `appendGuarded` — every
// ping is a distinct event (this is exactly what makes lastSeen advance).
//
// This is board LOGIC, so it lives in core (not a thin client) and depends ONLY on
// the DataAccess port. This story adds NO MCP tool: the first consumers are Story
// 6.1 (`check` — a read that must still mark presence) and the Epic 4 post tools.
// They will supply the acting handle; core just appends + reads back. (Do NOT wire
// this into `login` — Story 2.3 committed login-writes-nothing.)

import { appendIdentityEventOrThrow } from './append-identity-event.js';

import type { DataAccess } from '../ports.js';
import type { Identity } from './projection.js';

/**
 * Record an identity's presence — mark it as just-seen (AC #1).
 *
 * GUARDS EXISTENCE BEFORE APPENDING (Story 3.0): confirms a prior
 * `identity.registered` for `handle` FIRST, then appends one `identity.seen` event
 * (`actor: handle`, payload `{ handle }`) via plain {@link DataAccess.append} — no
 * uniqueness guard — and reads the identity back through the projection so the
 * returned record reflects the append: `lastSeen` is the new event's `createdAt`
 * (advanced) while `currentFocus` and `createdAt` are the unchanged folded values.
 * The prior events are retained (append-only); `createdAt` stays pinned to the
 * identity's `identity.registered`.
 *
 * For an UNREGISTERED handle it throws WITHOUT appending — no orphan `identity.seen`
 * is written (the ledger is unchanged on that path). The shared helper also retains
 * the broken-seam fail-loud guard (append succeeded but the read-back still misses).
 *
 * The caller (a future `check` / post tool) guarantees an established identity and
 * passes its canonical handle; this op does not re-check the session (that is a
 * server concern).
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param handle The (canonical) handle whose presence is being recorded — the actor.
 * @returns The updated {@link Identity} (`handle`, `currentFocus`, `createdAt`,
 *   `lastSeen`), with `lastSeen` advanced to the appended ping's `createdAt`.
 */
export async function recordSeen(
  dataAccess: DataAccess,
  handle: string,
): Promise<Identity> {
  // Guard-before-append + read-back is the shared identity-event shape. This op
  // supplies its event: a plain identity.seen (presence pings are not
  // unique-constrained, so no guard — each distinct ping advances lastSeen).
  return appendIdentityEventOrThrow(dataAccess, handle, 'recordSeen', () => ({
    type: 'identity.seen',
    actor: handle,
    payload: { handle },
  }));
}
