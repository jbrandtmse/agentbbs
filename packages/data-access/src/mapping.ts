// Wire <-> internal mapping — the SINGLE boundary where the two casings meet
// (Story 1.5: WRITE direction; Story 1.6 completes the READ direction).
//
// THE WIRE CONTRACT (architecture.md#Wire casing / project-context.md): event
// `payload` fields are `snake_case` at rest (the JSON stored in the `events.payload`
// TEXT column) and `camelCase` inside TypeScript (`@agentbbs/core` payload types).
// This conversion lives ONLY here — `core` never sees snake_case, and `append.ts`
// never does casing conversion inline (it calls `newEventToRow`).
//
// DECISION — EXPLICIT per-type mappers, not a generic camelCase->snake_case
// transformer. The event vocabulary is CLOSED (10 types, `EventPayloadMap`), so an
// exhaustive `switch` is:
//   - type-safe: each branch returns the exact wire shape for that payload, and the
//     `satisfies`/exhaustiveness check fails to compile if a type is added without a
//     mapper — the same total-map guarantee `EventPayloadMap` gives core.
//   - explicit about the boundary: the snake_case wire keys are written out, so the
//     persisted format is reviewable and a key rename is a visible, versioned change
//     rather than an emergent property of a string transform.
//   - immune to edge cases a naive transformer would mishandle (acronyms, digits,
//     already-snake keys). Most payload keys are single-word and unchanged; only
//     `currentFocus`/`projectId`/`roomId`/`messageSeq` actually differ.

import { EVENT_TYPES } from '@agentbbs/core';

import type { Event, EventType, NewEvent, PayloadOf } from '@agentbbs/core';

/**
 * A single `events` row as stored on disk — all `snake_case`, `payload` is a JSON
 * string with `snake_case` keys. `seq` is assigned by SQLite (AUTOINCREMENT) and is
 * therefore NOT part of the insert input; the write path inserts the four non-`seq`
 * columns and reads the assigned `seq` back.
 */
export interface EventRowInput {
  /** Closed event vocabulary value (`noun.past_tense`); stored verbatim. */
  type: EventType;
  /** Acting handle (lowercased canonical form); stored verbatim. */
  actor: string;
  /** ISO-8601 UTC timestamp, assigned at append time. DISPLAY-ONLY. */
  created_at: string;
  /** JSON string of the payload with `snake_case` keys. */
  payload: string;
}

/**
 * Convert one `NewEvent` (camelCase, from core) into the on-disk row input
 * (snake_case columns + JSON payload), stamping `createdAt` as `created_at`.
 *
 * `createdAt` is assigned by the WRITE PATH (append.ts) and passed in, because the
 * mapping layer must not reach for the clock — it is a pure transformation, which
 * keeps it deterministic and unit-testable.
 *
 * @param event A camelCase append-input event from core.
 * @param createdAt ISO-8601 UTC timestamp assigned at append time.
 */
export function newEventToRow(
  event: NewEvent,
  createdAt: string,
): EventRowInput {
  return {
    type: event.type,
    actor: event.actor,
    created_at: createdAt,
    payload: JSON.stringify(payloadToWire(event)),
  };
}

/**
 * Convert a camelCase payload to its `snake_case` wire object (the value that gets
 * JSON-serialized into the `payload` column). Exhaustive over the closed event
 * vocabulary; adding an `EventType` without a branch here is a compile error.
 *
 * Typed against the discriminated `NewEvent` so each branch narrows `payload` to the
 * exact `PayloadOf<T>`. Returns a plain object (a JSON-serializable record).
 */
export function payloadToWire(event: NewEvent): Record<string, unknown> {
  switch (event.type) {
    case 'identity.registered': {
      const p: PayloadOf<'identity.registered'> = event.payload;
      return { handle: p.handle, current_focus: p.currentFocus };
    }
    case 'identity.focus_updated': {
      const p: PayloadOf<'identity.focus_updated'> = event.payload;
      return { handle: p.handle, current_focus: p.currentFocus };
    }
    case 'identity.seen': {
      const p: PayloadOf<'identity.seen'> = event.payload;
      return { handle: p.handle };
    }
    case 'project.announced': {
      const p: PayloadOf<'project.announced'> = event.payload;
      return {
        project_id: p.projectId,
        title: p.title,
        description: p.description,
      };
    }
    case 'board.joined': {
      const p: PayloadOf<'board.joined'> = event.payload;
      return { project_id: p.projectId };
    }
    case 'announcement.posted': {
      const p: PayloadOf<'announcement.posted'> = event.payload;
      return {
        project_id: p.projectId,
        room_id: p.roomId,
        subject: p.subject,
        body: p.body,
      };
    }
    case 'room.replied': {
      const p: PayloadOf<'room.replied'> = event.payload;
      return { room_id: p.roomId, body: p.body };
    }
    case 'room.participant_added': {
      const p: PayloadOf<'room.participant_added'> = event.payload;
      return { room_id: p.roomId, handle: p.handle };
    }
    case 'message.reacted': {
      const p: PayloadOf<'message.reacted'> = event.payload;
      return { message_seq: p.messageSeq };
    }
    case 'message.unreacted': {
      const p: PayloadOf<'message.unreacted'> = event.payload;
      return { message_seq: p.messageSeq };
    }
    default: {
      // Exhaustiveness guard: if a new EventType is added without a branch above,
      // `event` is no longer `never` here and this fails to compile.
      return assertNever(event);
    }
  }
}

export type { Event };

// ---------------------------------------------------------------------------
// READ direction (Story 1.6): on-disk snake_case row -> internal camelCase Event.
//
// This is the mirror of the write direction above and completes the SINGLE
// mapping boundary: `queries.ts` returns rows verbatim from SQLite and `core`
// only ever sees camelCase — the two casings meet ONLY in this module.
// ---------------------------------------------------------------------------

/**
 * A full `events` row as read back from SQLite (all `snake_case`, incl. the
 * AUTOINCREMENT `seq`). `payload` is the JSON string stored on disk (snake_case
 * keys). This is the exact shape better-sqlite3 `.get()`/`.all()` produce for
 * `SELECT seq, type, actor, created_at, payload FROM events` with safe-integers
 * OFF (INTEGER -> number, TEXT -> string).
 */
export interface StoredEventRow {
  /** AUTOINCREMENT total-order key. INTEGER -> number (safe-integers off). */
  seq: number;
  /** Closed event vocabulary value (`noun.past_tense`), stored verbatim. */
  type: string;
  /** Acting handle (lowercased canonical form), stored verbatim. */
  actor: string;
  /** ISO-8601 UTC timestamp. DISPLAY-ONLY — never an ordering key. */
  created_at: string;
  /** JSON string of the payload with `snake_case` keys. */
  payload: string;
}

/**
 * Convert one on-disk `events` row into the internal camelCase folded
 * {@link Event}. Parses the JSON `payload`, then dispatches on `type` to the
 * exhaustive {@link wireToPayload} mapper so the resulting `payload` is narrowed
 * to the exact `PayloadOf<type>`.
 *
 * The DB column `type` is a bare `string`; we re-narrow it to `EventType` against
 * the closed vocabulary (`EVENT_TYPES`) and throw on an unknown type rather than
 * trust the column blindly — a corrupt/foreign row fails loudly at the seam
 * instead of leaking an untyped event into core.
 */
export function rowToEvent(row: StoredEventRow): Event {
  const type = asEventType(row.type);
  const wire = JSON.parse(row.payload) as Record<string, unknown>;
  // Build the discriminated Event. `payload` is produced by the exhaustive
  // per-type mapper, so it matches `PayloadOf<type>`; the cast localizes the
  // single unavoidable widening (JSON is `unknown`) to this one boundary.
  return {
    seq: row.seq,
    type,
    actor: row.actor,
    createdAt: row.created_at,
    payload: wireToPayload(type, wire),
  } as Event;
}

/**
 * Convert a parsed `snake_case` wire payload object into the internal camelCase
 * payload for the given `type`. Exhaustive over the closed event vocabulary
 * (mirror of {@link payloadToWire}); adding an `EventType` without a branch here
 * is a compile error via the `assertNever` default.
 *
 * The `wire` record is read positionally per known key; values are coerced to the
 * payload field types (`messageSeq` is an integer on the wire). Returns the
 * payload typed as the matching `PayloadOf<T>` — the dispatch in
 * {@link rowToEvent} keeps the discriminated-union relationship intact.
 */
export function wireToPayload(
  type: EventType,
  wire: Record<string, unknown>,
): PayloadOf<EventType> {
  switch (type) {
    case 'identity.registered':
      return {
        handle: String(wire.handle),
        currentFocus: String(wire.current_focus),
      } satisfies PayloadOf<'identity.registered'>;
    case 'identity.focus_updated':
      return {
        handle: String(wire.handle),
        currentFocus: String(wire.current_focus),
      } satisfies PayloadOf<'identity.focus_updated'>;
    case 'identity.seen':
      return {
        handle: String(wire.handle),
      } satisfies PayloadOf<'identity.seen'>;
    case 'project.announced':
      return {
        projectId: String(wire.project_id),
        title: String(wire.title),
        description: String(wire.description),
      } satisfies PayloadOf<'project.announced'>;
    case 'board.joined':
      return {
        projectId: String(wire.project_id),
      } satisfies PayloadOf<'board.joined'>;
    case 'announcement.posted':
      return {
        projectId: String(wire.project_id),
        roomId: String(wire.room_id),
        subject: String(wire.subject),
        body: String(wire.body),
      } satisfies PayloadOf<'announcement.posted'>;
    case 'room.replied':
      return {
        roomId: String(wire.room_id),
        body: String(wire.body),
      } satisfies PayloadOf<'room.replied'>;
    case 'room.participant_added':
      return {
        roomId: String(wire.room_id),
        handle: String(wire.handle),
      } satisfies PayloadOf<'room.participant_added'>;
    case 'message.reacted':
      return {
        messageSeq: Number(wire.message_seq),
      } satisfies PayloadOf<'message.reacted'>;
    case 'message.unreacted':
      return {
        messageSeq: Number(wire.message_seq),
      } satisfies PayloadOf<'message.unreacted'>;
    default:
      // Exhaustiveness guard: a new EventType without a branch leaves `type`
      // non-`never` here and this fails to compile.
      return assertNever(type);
  }
}

/** SCREAMING set used only to re-narrow the bare DB `type` column to EventType. */
const EVENT_TYPE_SET: ReadonlySet<string> = new Set<string>(EVENT_TYPES);

/**
 * Re-narrow a bare `string` from the DB `type` column to the closed
 * {@link EventType} vocabulary, throwing on an unknown value so a corrupt or
 * foreign row fails loudly at the seam rather than producing an untyped Event.
 */
function asEventType(type: string): EventType {
  if (!EVENT_TYPE_SET.has(type)) {
    throw new Error(
      `Unknown event type read from ledger: ${JSON.stringify(type)}`,
    );
  }
  return type as EventType;
}

/** Compile-time exhaustiveness helper: forces every union member to be handled. */
function assertNever(value: never): never {
  throw new Error(`Unhandled event type in mapping: ${JSON.stringify(value)}`);
}
