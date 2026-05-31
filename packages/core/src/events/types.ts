// The closed event vocabulary (Story 1.3, AC1).
//
// `type` is `noun.past_tense`. This set is CLOSED and FIXED: exactly the ten
// strings below — no more, no fewer. The `EVENT_TYPES` tuple is the single
// runtime source of truth; `EventType` is derived from it so the type and the
// runtime list can never drift apart.
//
// Versioning contract:
//   - Adding a new type is ADDITIVE (append to the tuple) and backward-safe.
//   - RENAMING or REMOVING a type is a BREAKING export-format change and MUST be
//     versioned (it changes the wire/export vocabulary downstream modules and
//     archives depend on). Never invent a type ad hoc.
//
// The internal payload shape per type lives in `./payloads.ts`; the snake_case
// wire mapping is Story 1.6 (`data-access/mapping.ts`), NOT here — core is
// camelCase-only.

/**
 * The closed event-type vocabulary, in canonical declaration order.
 *
 * Frozen `as const` so it is both the runtime membership set (used by the
 * "exactly 10" guard test and any future runtime validation) and the source the
 * {@link EventType} union is derived from.
 */
export const EVENT_TYPES = [
  'identity.registered',
  'identity.focus_updated',
  'identity.seen',
  'project.announced',
  'board.joined',
  'announcement.posted',
  'room.replied',
  'room.participant_added',
  'message.reacted',
  'message.unreacted',
] as const;

/**
 * The closed union of every valid event `type`. Derived from {@link EVENT_TYPES}
 * so the union and the runtime tuple are guaranteed identical.
 */
export type EventType = (typeof EVENT_TYPES)[number];
