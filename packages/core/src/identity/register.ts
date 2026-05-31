// The `register` board operation (Story 2.2, Task 3 / AC #1, #2).
//
// Claim-based identity: the handle IS the credential (no secret token). `register`
// appends an `identity.registered` event IFF the canonical handle is unclaimed,
// and the uniqueness check + the insert are ATOMIC across processes — they share
// the one `appendGuarded` transaction (see ports.ts#appendGuarded / the Story 2.2
// atomicity crux). Two concurrent registrations of the same handle therefore
// cannot both succeed: one wins, the other gets HANDLE_TAKEN.
//
// This is board LOGIC, so it lives in core (not the thin MCP handler). It depends
// ONLY on the DataAccess port — never on the storage adapter — so the conflict
// signal is detected by its stable `code` discriminant (duck-typed) rather than an
// `instanceof` against a data-access class core is (correctly) forbidden to import.

import { BoardError } from '../errors.js';
import { findIdentity } from './projection.js';

import type { DataAccess } from '../ports.js';
import type { Identity } from './projection.js';

/** The stable discriminant the data-access adapter stamps on a uniqueness conflict. */
const UNIQUENESS_CONFLICT_CODE = 'UNIQUENESS_CONFLICT';

/** Input to {@link register} (camelCase; the MCP boundary maps snake_case → this). */
export interface RegisterInput {
  /**
   * The desired handle. The MCP boundary's Zod schema has already enforced the
   * charset (`[a-z0-9._@-]`) and canonical-lowercase form (AC #3) before this
   * runs; core re-derives the canonical form defensively but does NOT re-emit the
   * user-facing validation message (that contract belongs to the boundary).
   */
  handle: string;
  /** The identity's initial current focus statement. */
  currentFocus: string;
}

/**
 * True when a value rejected by the DataAccess port is the adapter's uniqueness
 * conflict, identified by its stable `code` (the same way clients discriminate a
 * `BoardError`). Duck-typed on purpose: core must not import the data-access
 * package to get the concrete error class (the lint-enforced module boundary), so
 * it matches the documented public discriminant instead.
 */
function isUniquenessConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === UNIQUENESS_CONFLICT_CODE
  );
}

/**
 * Canonicalize a handle to its lowercased form. The boundary already validated the
 * charset; this is the defensive normalization core applies before it builds the
 * event + guard, so the stored `actor`/payload and the uniqueness predicate all
 * use the one canonical form (case-folding collapses here, satisfying AC #2's
 * "case-insensitively on the canonical lowercased form").
 */
function canonicalize(handle: string): string {
  return handle.toLowerCase();
}

/**
 * Register a new durable identity (AC #1/#2).
 *
 * Appends `identity.registered` for the canonical handle IFF unclaimed — the
 * uniqueness check and the insert are atomic within the single `appendGuarded`
 * transaction (AC #2). Then reads the just-appended identity back through the
 * projection so the returned `createdAt` is the value DATA-ACCESS assigned at
 * append (core never fabricates a timestamp); `lastSeen === createdAt` at
 * registration.
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param input The desired `handle` + initial `currentFocus`.
 * @returns The registered {@link Identity} (`handle`, `currentFocus`, `createdAt`,
 *   `lastSeen`).
 * @throws BoardError `HANDLE_TAKEN` if the canonical handle is already registered.
 */
export async function register(
  dataAccess: DataAccess,
  input: RegisterInput,
): Promise<Identity> {
  const handle = canonicalize(input.handle);
  const { currentFocus } = input;

  try {
    await dataAccess.appendGuarded(
      [
        {
          type: 'identity.registered',
          actor: handle,
          payload: { handle, currentFocus },
        },
      ],
      // Uniqueness on the canonical handle, scoped to identity.registered. The
      // payload is stored snake_case-keyed, but `handle` is single-word so the
      // field name is identical in both casings.
      [{ type: 'identity.registered', field: 'handle', value: handle }],
    );
  } catch (err) {
    // The atomic guard tripped → the handle was claimed; surface the domain error.
    if (isUniquenessConflict(err)) {
      throw new BoardError(
        'HANDLE_TAKEN',
        `Handle "${handle}" is already registered.`,
      );
    }
    // Anything else (e.g. StoreBusyError, an unexpected fault) propagates as-is.
    throw err;
  }

  // Read the just-appended identity back so createdAt/lastSeen come from the
  // ledger (data-access assigned createdAt at append). eventsByActor(handle)
  // returns exactly this identity's events (seq-ordered); folding yields the record.
  const own = await dataAccess.eventsByActor(handle);
  const identity = findIdentity(own, handle);
  if (!identity) {
    // Unreachable: we just appended the registration for this actor. A miss would
    // mean the append did not persist or the read seam is broken — fail loudly
    // rather than return a fabricated record.
    throw new Error(
      `register: just-appended identity "${handle}" not found in its own event stream.`,
    );
  }
  return identity;
}
