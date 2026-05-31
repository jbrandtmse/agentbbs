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

// --- Project board operations (Story 3.1 / 3.2) ---
export { announceProject } from './projects/announce-project.js';
export type { AnnounceProjectInput } from './projects/announce-project.js';
export { listProjects } from './projects/list-projects.js';
export { joinBoard } from './projects/join-board.js';

// --- Cross-package Vitest `src`-alias proof fixture (Story 3.0, AC #1) ---
// Test-only sentinel: proves cross-package specifiers resolve to `src` via the
// root vitest `resolve.alias` (not stale `dist`). See cross-package-alias-proof.ts.
export {
  CROSS_PACKAGE_ALIAS_PROOF,
  crossPackageAliasProof,
} from './cross-package-alias-proof.js';
