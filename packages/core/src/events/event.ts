// The internal Event shapes (Story 1.3, AC1).
//
// `Event` is the FOLDED / read form (carries the authoritative `seq`). `NewEvent`
// is the APPEND INPUT form (no `seq`, no `createdAt` — both are assigned by the
// data-access layer at append time). Both are camelCase and are discriminated
// unions over `type`, so narrowing on `type` narrows `payload` to the exact
// `EventPayloadMap[type]`.
//
// Ordering contract: events are a total order by `seq` (the authoritative,
// monotonic sequence assigned at append). `createdAt` is ISO-8601 UTC TEXT and
// is DISPLAY-ONLY — never order by it (THE APPEND INVARIANT).

import type { EventPayloadMap, PayloadOf } from './payloads.js';
import type { EventType } from './types.js';

/**
 * A single folded/read event for one specific event type `T`.
 *
 * Distributed over the `EventType` union (see {@link Event}) to form a
 * discriminated union: narrowing on `type` narrows `payload`.
 */
export interface EventOf<T extends EventType> {
  /**
   * Authoritative monotonic sequence assigned at append time. The single total
   * order — read queries return events ordered by `seq`, never `createdAt`.
   */
  seq: number;
  /** The event type (discriminant). */
  type: T;
  /** The acting handle (lowercased canonical form). */
  actor: string;
  /**
   * Append timestamp, ISO-8601 UTC TEXT. DISPLAY-ONLY — never used for ordering.
   * Assigned by the data-access layer at append time.
   */
  createdAt: string;
  /** The payload for this event type. */
  payload: PayloadOf<T>;
}

/**
 * A folded/read event. Discriminated union over the closed {@link EventType}
 * vocabulary: `switch (event.type)` narrows `event.payload` to the exact payload.
 */
export type Event = { [T in EventType]: EventOf<T> }[EventType];

/**
 * The append-input shape for one specific event type `T`. Carries no `seq` and
 * no `createdAt` — both are assigned by the data-access layer inside the append
 * transaction (`seq` is the authoritative sequence; `createdAt` is set at append
 * time). The caller supplies only the intent: who did what, with what payload.
 */
export interface NewEventOf<T extends EventType> {
  /** The event type (discriminant). */
  type: T;
  /** The acting handle (lowercased canonical form). */
  actor: string;
  /** The payload for this event type. */
  payload: PayloadOf<T>;
}

/**
 * The append-input form. Discriminated union over {@link EventType}; `seq` and
 * `createdAt` are assigned at append time and are therefore absent here.
 */
export type NewEvent = { [T in EventType]: NewEventOf<T> }[EventType];

export type { EventPayloadMap, PayloadOf };
