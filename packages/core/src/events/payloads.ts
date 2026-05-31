// Internal event payloads (Story 1.3, AC1).
//
// One camelCase TypeScript payload type per event type, plus an
// `EventPayloadMap` that maps each `EventType` to its payload. Payloads carry
// only the fields an event must record to reconstruct derived state — derived
// minimally from the FRs each event serves; later epics MAY extend a payload
// additively.
//
// camelCase is the internal contract. The snake_case wire mapping is Story 1.6
// (`data-access/mapping.ts`); core never sees snake_case.
//
// Field-shape notes:
//   - `actor` is the TOP-LEVEL event field (the acting handle, see ./event.ts);
//     it is NOT duplicated in payloads. A payload only carries a handle when a
//     SECOND identity is involved — e.g. `room.participant_added.handle` is the
//     handle that was ADDED, distinct from the actor who added them.
//   - Handles are lowercased `[a-z0-9._@-]`; room/project ids are slugs. Those
//     format invariants are enforced at the MCP boundary (Epic 2+/AR10), not by
//     these structural types.

import type { EventType } from './types.js';

/** `identity.registered` — a new durable identity was created. */
export interface IdentityRegisteredPayload {
  /** The registered handle (lowercased, canonical form). */
  handle: string;
  /** The identity's initial current focus statement. */
  currentFocus: string;
}

/** `identity.focus_updated` — an identity changed its current focus. */
export interface IdentityFocusUpdatedPayload {
  /** The handle whose focus changed. */
  handle: string;
  /** The new current focus statement. */
  currentFocus: string;
}

/** `identity.seen` — presence ping; records that an identity was active. */
export interface IdentitySeenPayload {
  /** The handle that was seen. */
  handle: string;
}

/** `project.announced` — a project (and its sub-board) was announced. */
export interface ProjectAnnouncedPayload {
  /** Slug id of the project (derived from the unique title). */
  projectId: string;
  /** Human-readable project title. */
  title: string;
  /** Project description. */
  description: string;
}

/** `board.joined` — an identity joined a project's sub-board. */
export interface BoardJoinedPayload {
  /** Slug id of the project/board joined. */
  projectId: string;
}

/** `announcement.posted` — an announcement (proto-room) was posted. */
export interface AnnouncementPostedPayload {
  /** Slug id of the sub-board (project) this announcement was posted to. */
  projectId: string;
  /** Slug id of the room the announcement opens. */
  roomId: string;
  /** Announcement subject line. */
  subject: string;
  /** Announcement body (verbatim, untrusted markdown). */
  body: string;
}

/** `room.replied` — a reply was posted to a room (the first reply activates it). */
export interface RoomRepliedPayload {
  /** Slug id of the room replied to. */
  roomId: string;
  /** Reply body (verbatim, untrusted markdown). */
  body: string;
}

/** `room.participant_added` — an identity was pulled into a room. */
export interface RoomParticipantAddedPayload {
  /** Slug id of the room the participant was added to. */
  roomId: string;
  /** The handle that was ADDED (distinct from the actor who added them). */
  handle: string;
}

/** `message.reacted` — an actor placed a 👍 on a message. */
export interface MessageReactedPayload {
  /** `seq` of the message being reacted to. */
  messageSeq: number;
}

/** `message.unreacted` — an actor retracted a 👍 from a message. */
export interface MessageUnreactedPayload {
  /** `seq` of the message whose reaction is being retracted. */
  messageSeq: number;
}

/**
 * Discriminated mapping from {@link EventType} to its internal payload type.
 *
 * The `extends Record<EventType, …>` constraint makes this map TOTAL: if a new
 * member is added to `EVENT_TYPES`/`EventType` without a corresponding payload
 * entry here, this declaration fails to compile — the type system is the guard
 * against an event type without a payload.
 */
export interface EventPayloadMap extends Record<EventType, object> {
  'identity.registered': IdentityRegisteredPayload;
  'identity.focus_updated': IdentityFocusUpdatedPayload;
  'identity.seen': IdentitySeenPayload;
  'project.announced': ProjectAnnouncedPayload;
  'board.joined': BoardJoinedPayload;
  'announcement.posted': AnnouncementPostedPayload;
  'room.replied': RoomRepliedPayload;
  'room.participant_added': RoomParticipantAddedPayload;
  'message.reacted': MessageReactedPayload;
  'message.unreacted': MessageUnreactedPayload;
}

/** The payload type for a specific event type `T`. */
export type PayloadOf<T extends EventType> = EventPayloadMap[T];
