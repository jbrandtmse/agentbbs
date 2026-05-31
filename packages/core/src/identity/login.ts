// The `login` board operation (Story 2.3, Task 1 / AC #1, #2).
//
// Claim-based identity, the read half of "register-or-login" (FR2/FR37): the handle
// IS the credential (no secret token). `login` does NOT write — it RESOLVES an
// existing handle against the identity directory and returns the record, or throws
// `LOGIN_UNKNOWN` if the handle was never registered. It appends NOTHING (no event,
// no token); re-establishing a session is a read, not a ledger mutation.
//
// This is board LOGIC, so it lives in core (not the thin MCP handler), and depends
// ONLY on the DataAccess port. Session state — which handle a connection is acting
// as — is NOT decided here: `login` just returns the resolved identity; the
// mcp-server layer owns the per-connection session holder it sets from this result.

import { BoardError } from '../errors.js';
import { findIdentity } from './projection.js';

import type { DataAccess } from '../ports.js';
import type { Identity } from './projection.js';

/**
 * Canonicalize a handle to its lowercased form — the same defensive normalization
 * `register` applies, so a login resolves against the canonical key the directory
 * is stored under. The MCP boundary's Zod schema already rejects non-lowercase /
 * out-of-charset input before this runs (AC #3); core re-derives the canonical form
 * defensively (case-insensitive resolution) but does NOT re-emit the user-facing
 * validation message (that contract belongs to the boundary).
 */
function canonicalize(handle: string): string {
  return handle.toLowerCase();
}

/**
 * Re-establish an existing identity for a session (AC #1/#2).
 *
 * Resolves the canonical handle against its own event stream (the indexed
 * `eventsByActor` read folded by {@link findIdentity}) and returns the
 * {@link Identity}. Performs NO append — login is claim-based and read-only.
 *
 * @param dataAccess The persistence port (the only dependency; read-only here).
 * @param handle The handle to resume. Canonicalized (lowercased) before resolution.
 * @returns The resolved {@link Identity} (`handle`, `currentFocus`, `createdAt`,
 *   `lastSeen`).
 * @throws BoardError `LOGIN_UNKNOWN` if the canonical handle was never registered.
 */
export async function login(
  dataAccess: DataAccess,
  handle: string,
): Promise<Identity> {
  const canonical = canonicalize(handle);

  // eventsByActor(canonical) returns exactly this handle's events, seq-ordered;
  // findIdentity folds that slice to the one record (or undefined if unregistered).
  const own = await dataAccess.eventsByActor(canonical);
  const identity = findIdentity(own, canonical);

  if (!identity) {
    throw new BoardError(
      'LOGIN_UNKNOWN',
      `Handle "${canonical}" is not registered.`,
    );
  }
  return identity;
}
