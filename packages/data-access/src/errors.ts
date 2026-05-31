// data-access typed errors (Story 1.4, AC2).
//
// DECISION — exhaustion error type: a data-access-LOCAL typed error class
// (`StoreBusyError`), NOT an additive `BoardError` code in core.
//
// Rationale:
//   - `BoardError`'s closed code set is a versioned PUBLIC WIRE contract of
//     board-DOMAIN semantics (HANDLE_TAKEN, ROOM_NOT_FOUND, …). Store-busy is an
//     INFRASTRUCTURE/operational condition — "sustained SQLite write contention
//     past the bounded retry", the documented signal to graduate to the V2 HTTP
//     backend (NFR2) — not a board-domain validation result. Freezing it into the
//     public domain code set would conflate the storage substrate's operational
//     signal with the board's semantic vocabulary.
//   - core throws `BoardError`; data-access sits BELOW core behind the DataAccess
//     seam. A data-access-local error keeps the layering clean: callers (core /
//     clients) catch `StoreBusyError` at their boundary and map it as they see fit
//     without the V1-only signal leaking into the public closed code set.
//   - It still satisfies the contract: a CLEAR, TYPED error (reliable
//     `instanceof`, a stable `code`) — never a raw better-sqlite3 `SqliteError`
//     past the seam.

/** Stable discriminant on {@link StoreBusyError} (SCREAMING_SNAKE, like core). */
export const STORE_BUSY = 'STORE_BUSY';

/**
 * Thrown when a write still hits `SQLITE_BUSY` after the bounded retry within the
 * `busy_timeout` window is exhausted — sustained contention. This is the
 * documented signal to graduate to the V2 HTTP backend (NFR2); callers should
 * surface it, not swallow it.
 *
 * `instanceof StoreBusyError` is reliable: native `class extends Error` under the
 * project's ES2023 target wires the prototype chain, and the explicit
 * `Object.setPrototypeOf` is a defensive guard mirroring core's `BoardError`.
 */
export class StoreBusyError extends Error {
  /** Stable discriminant for callers mapping at their boundary. */
  readonly code: typeof STORE_BUSY;
  /** The number of attempts made before giving up. */
  readonly attempts: number;
  /** The underlying better-sqlite3 error (cause), for diagnostics. */
  override readonly cause: unknown;

  constructor(message: string, attempts: number, cause: unknown) {
    super(message);
    Object.setPrototypeOf(this, StoreBusyError.prototype);
    this.name = 'StoreBusyError';
    this.code = STORE_BUSY;
    this.attempts = attempts;
    this.cause = cause;
  }
}

/** Stable discriminant on {@link UniquenessConflictError} (SCREAMING_SNAKE). */
export const UNIQUENESS_CONFLICT = 'UNIQUENESS_CONFLICT';

/**
 * Thrown by `appendGuarded` when a uniqueness guard is violated: an existing
 * event of the guard's `type` already carries the guarded `value` in its payload
 * `field`, so the conditional append must NOT proceed. The guarded transaction
 * rolls back (nothing is inserted) and this typed error surfaces instead.
 *
 * DECISION — like {@link StoreBusyError}, this is a data-access-LOCAL typed error,
 * NOT a `BoardError` code. The data-access seam owns storage outcomes, not board
 * vocabulary: it knows a uniqueness predicate tripped but not whether that maps
 * to `HANDLE_TAKEN`, `PROJECT_EXISTS`, or `ROOM_NOT_FOUND` — that DOMAIN mapping
 * is `core`'s job (the SAME guard primitive serves all of them). `core` catches
 * this at its boundary and throws the right `BoardError`; the closed public code
 * set stays free of a storage-layer signal, and a raw SQLite error never escapes
 * the seam. The carried {@link guard} lets the catcher see exactly which
 * predicate failed when an append declares more than one.
 *
 * `instanceof UniquenessConflictError` is reliable: native `class extends Error`
 * under the project's ES2023 target wires the prototype chain, and the explicit
 * `Object.setPrototypeOf` is a defensive guard mirroring {@link StoreBusyError}.
 */
export class UniquenessConflictError extends Error {
  /** Stable discriminant for callers mapping at their boundary. */
  readonly code: typeof UNIQUENESS_CONFLICT;
  /**
   * The guard that tripped (the `{ type, field, value }` predicate), so a caller
   * with multiple guards on one append can tell which precondition failed.
   */
  readonly guard: { type: string; field: string; value: string };

  constructor(
    message: string,
    guard: { type: string; field: string; value: string },
  ) {
    super(message);
    Object.setPrototypeOf(this, UniquenessConflictError.prototype);
    this.name = 'UniquenessConflictError';
    this.code = UNIQUENESS_CONFLICT;
    this.guard = guard;
  }
}
