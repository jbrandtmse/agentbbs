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
