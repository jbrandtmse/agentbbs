// @agentbbs/core — board logic, event vocabulary, the DataAccess port, and the
// error model. This barrel is the package's ONLY public surface; consumers import
// from "@agentbbs/core", never deep paths. No default exports (lint).
//
// Story 1.3 populates the contract surface: the closed event vocabulary + payload
// types, the folded/append event shapes, the DataAccess port (the NFR2 seam), and
// the BoardError + closed code set.

// --- Event vocabulary (AC1) ---
export { EVENT_TYPES } from './events/types.js';
export type { EventType } from './events/types.js';

// --- Event payloads (AC1) ---
export type {
  AnnouncementPostedPayload,
  BoardJoinedPayload,
  EventPayloadMap,
  IdentityFocusUpdatedPayload,
  IdentityRegisteredPayload,
  IdentitySeenPayload,
  MessageReactedPayload,
  MessageUnreactedPayload,
  PayloadOf,
  ProjectAnnouncedPayload,
  RoomParticipantAddedPayload,
  RoomRepliedPayload,
} from './events/payloads.js';

// --- Event shapes (AC1) ---
export type { Event, EventOf, NewEvent, NewEventOf } from './events/event.js';

// --- DataAccess port — the NFR2 seam (AC2) ---
export type { DataAccess, UniquenessGuard } from './ports.js';

// --- Error model (AC3) ---
export { BOARD_ERROR_CODES, BoardError } from './errors.js';
export type { BoardErrorCode } from './errors.js';

// --- Identity directory projection (Story 2.2) ---
export { findIdentity, foldIdentities } from './identity/projection.js';
export type { Identity } from './identity/projection.js';

// --- Identity board operations (Story 2.2 / 2.3 / 2.4 / 2.5) ---
export { register } from './identity/register.js';
export type { RegisterInput } from './identity/register.js';
export { login } from './identity/login.js';
export { updateFocus } from './identity/update-focus.js';
export { recordSeen } from './identity/record-seen.js';

// --- Projects directory projection (Story 3.1) ---
export { findProject, foldProjects } from './projects/projection.js';
export type { Project } from './projects/projection.js';

// --- Sub-board member directory (Story 3.4) ---
export { boardDirectory } from './projects/board-directory.js';
export type { DirectoryMember } from './projects/board-directory.js';

// --- Membership write-gate primitive (Story 3.5) — read is open board-wide; posting
// requires membership. Pure authorization (no append); the first consumers are the
// Epic 4 post tools (4.1 / 4.3 / 4.5), per the Rule 1 escape clause. ---
export { isMember, requireMembership } from './projects/membership.js';

// --- Project board operations (Story 3.1 / 3.2) ---
export { announceProject } from './projects/announce-project.js';
export type { AnnounceProjectInput } from './projects/announce-project.js';
export { listProjects } from './projects/list-projects.js';
export { joinBoard } from './projects/join-board.js';

// --- Rooms projection + room-id derivation (Story 4.1) — proto-rooms folded from
// `announcement.posted`; `active` derives in Story 4.3. ---
export { findRoom, foldRooms } from './rooms/projection.js';
export type { Room } from './rooms/projection.js';
export { roomIdBase } from './rooms/room-id.js';

// --- Announcement / room board operations (Story 4.1) — the first consumer of the
// Story 3.5 membership write-gate; opens a globally-unique proto-room. ---
export { postAnnouncement } from './rooms/post-announcement.js';
export type { PostAnnouncementInput } from './rooms/post-announcement.js';
