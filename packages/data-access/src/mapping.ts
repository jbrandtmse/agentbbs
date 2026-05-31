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

import type {
  Event,
  EventType,
  NewEvent,
  PayloadOf,
} from '@agentbbs/core';

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
      return { room_id: p.roomId, subject: p.subject, body: p.body };
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

// Re-exported for the Story 1.6 READ direction; harmless to expose now and keeps the
// folded shape in this module's vocabulary so the read mapper lands cleanly.
export type { Event };

/** Compile-time exhaustiveness helper: forces every union member to be handled. */
function assertNever(value: never): never {
  throw new Error(
    `Unhandled event type in payloadToWire: ${JSON.stringify(value)}`,
  );
}
