// The DataAccess port — the single NFR2 swap seam (Story 1.3, AC2).
//
// This is the ONLY interface `core` depends on for persistence. It references no
// `better-sqlite3` type and no SQL — the storage technology lives entirely
// behind this seam. The V1 implementation (Story 1.4+) is better-sqlite3 (synchronous
// internally); a future V2 HTTP daemon slots in behind this IDENTICAL interface.
//
// DECISION — the interface is ASYNC (Promise-returning). Rationale: the V2
// HTTP-daemon implementation must conform to the identical interface
// (architecture.md#The Data-Access Seam), and an HTTP backend is inherently
// async; a synchronous interface could not survive that swap without changing
// the contract. The synchronous V1 (better-sqlite3) conforms trivially by
// returning already-resolved Promises. (Story 1.3 Task 2 DECISION.)
//
// Ordering contract: every method that returns events returns them ordered by
// `seq` ascending — the authoritative total order. Never `createdAt`.

import type { Event, NewEvent } from './events/event.js';
import type { EventType } from './events/types.js';

/**
 * A data-described uniqueness predicate for {@link DataAccess.appendGuarded}:
 * "no existing event of `type` has json payload field `field` equal to `value`".
 *
 * It is expressed as DATA (not a closure) on purpose — so the predicate is
 * portable across the V2 HTTP backend (NFR2): a closure could not cross the
 * process/transport boundary, but `{ type, field, value }` serializes trivially.
 * The adapter translates it into a storage-native existence check that runs
 * INSIDE the same append transaction (V1: a `SELECT … json_extract(payload,
 * '$.' + field) …` inside the `BEGIN IMMEDIATE` write transaction), so the
 * check-then-insert is atomic across processes (FR1).
 *
 * `field` is the payload key in the layer's stored casing — at-rest payloads are
 * `snake_case` (the wire contract), so a guard on the registered-handle field is
 * `{ type: 'identity.registered', field: 'handle', value: canonicalHandle }`
 * (the key `handle` is already single-word, hence identical in both casings).
 */
export interface UniquenessGuard {
  /** The event type whose payloads are scanned for a collision. */
  type: EventType;
  /** The payload field (stored/at-rest casing) the predicate inspects. */
  field: string;
  /** The value that must NOT already be present for that `type`/`field`. */
  value: string;
}

/**
 * The persistence seam. All appends and reads flow through this interface; core
 * never constructs SQL and never imports a storage driver. The method set below
 * is minimal-but-sufficient for Epic 1; it is ADDITIVE — later projection
 * stories add read methods without altering existing signatures.
 */
export interface DataAccess {
  /**
   * Append one or more events in a SINGLE transaction and return the assigned
   * monotonic `seq` values, in the same order as the input events (NFR10:
   * one-call atomic multi-event append). Either all events are appended or none
   * are. Each returned `seq` is strictly greater than any previously assigned
   * `seq`.
   *
   * @param events One or more append-input events (no `seq`/`createdAt`).
   * @returns The assigned `seq` for each input event, in input order.
   */
  append(events: NewEvent[]): Promise<number[]>;

  /**
   * Append `events` in a SINGLE transaction, but FIRST assert every uniqueness
   * `guard` holds — the atomic check-then-insert that uniqueness constraints
   * (FR1) require. The guard existence checks and the inserts run inside the
   * SAME write transaction (V1: `BEGIN IMMEDIATE`, the mechanism Story 1.7 proved
   * serializes writers across processes), so no other process can commit between
   * a check and its insert: two concurrent guarded appends for the same value
   * cannot both succeed.
   *
   * If ANY guard is violated, NOTHING is appended (the transaction rolls back)
   * and the call REJECTS with a typed conflict error carrying which guard tripped
   * (the adapter's `UniquenessConflictError`); core maps that to the appropriate
   * `BoardError`. Like {@link append}, on success the returned `seq` values are
   * monotonic and in input order.
   *
   * This is ADDITIVE: it does not change {@link append}. Use plain `append` when
   * no uniqueness precondition applies; use `appendGuarded` when the append must
   * be conditional on a value being unclaimed (registration handle, project id,
   * room id, …) — the predicate is the same primitive for all of them.
   *
   * @param events One or more append-input events (no `seq`/`createdAt`).
   * @param guards Uniqueness predicates that must ALL hold for the append to
   *   proceed; an empty array makes this behave exactly like {@link append}.
   * @returns The assigned `seq` for each input event, in input order.
   */
  appendGuarded(
    events: NewEvent[],
    guards: UniquenessGuard[],
  ): Promise<number[]>;

  /**
   * All events with `seq` strictly greater than `cursor`, ordered by `seq`
   * ascending. The basis for the pull-only `check` delta — pass the last seen
   * `seq` as the cursor.
   *
   * @param cursor Exclusive lower bound; pass `0` to read from the beginning.
   */
  eventsSince(cursor: number): Promise<Event[]>;

  /**
   * All events of a given type, ordered by `seq` ascending.
   */
  eventsByType(type: EventType): Promise<Event[]>;

  /**
   * All events whose `actor` matches the given handle, ordered by `seq`
   * ascending.
   */
  eventsByActor(actor: string): Promise<Event[]>;

  /**
   * The highest `seq` currently in the ledger, or `0` if the ledger is empty.
   * Used to set a fresh cursor (e.g. joining a room sets the room cursor to the
   * current max `seq`).
   */
  maxSeq(): Promise<number>;
}
