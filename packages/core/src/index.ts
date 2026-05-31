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

// --- Rooms projection + room-id derivation (Story 4.1; activation read-model Story 4.2)
// — proto-rooms folded from `announcement.posted`; `active` derives from `room.replied`
// (existence-of-reply). ---
export { findRoom, foldRooms } from './rooms/projection.js';
export type { Room } from './rooms/projection.js';
export { roomIdBase } from './rooms/room-id.js';

// --- Announcement / room board operations (Story 4.1) — the first consumer of the
// Story 3.5 membership write-gate; opens a globally-unique proto-room. ---
export { postAnnouncement } from './rooms/post-announcement.js';
export type { PostAnnouncementInput } from './rooms/post-announcement.js';

// --- Room browse read operations (Story 4.2) — split the rooms projection for a board
// into proto-rooms (listAnnouncements, active=false) vs activated rooms (listRooms,
// active=true), both `seq`-ordered; BOARD_NOT_FOUND for an unknown board. Open reads. ---
export { listAnnouncements, listRooms } from './rooms/list-rooms.js';

// --- Reply room operation (Story 4.3) — the keystone: a reply activates a proto-room into
// a live room. Plain append of `room.replied` ALWAYS + a conditional `board.joined`
// (idempotent auto-join — "acting = joining", FR10) in ONE transaction; ROOM_NOT_FOUND for
// an unknown room. The activator is the read-side min-`seq` derivation (rooms projection). ---
export { reply } from './rooms/reply.js';
export type { ReplyInput } from './rooms/reply.js';

// --- Room message-history projection + read op (Story 4.4) — a room's COMPLETE ordered
// history: the seeding `announcement.posted` as message #1 (kind='announcement'), then every
// `room.replied` by `seq` (kind='reply'); a "message" is identified by its `seq` (Epic 5's
// react/current-contract consume these by seq). `readRoom` resolves the room (ROOM_NOT_FOUND
// for an unknown one) + returns `{ room, messages }` (RoomHistory). An OPEN read (FR9 — no
// membership). Pure fold; derived, never stored; ordered by `seq`, never `createdAt`. ---
export { roomMessages } from './rooms/room-history.js';
export type { RoomMessage, RoomMessageKind } from './rooms/room-history.js';
export { readRoom } from './rooms/read-room.js';
export type { RoomHistory } from './rooms/read-room.js';

// --- Room-participants projection + add-participant op (Story 4.5) — a participant pulls a
// registered peer into a room mid-negotiation. `roomParticipants`/`isParticipant` derive a
// room's participants (actors of `room.replied` ∪ handles of `room.participant_added`, de-duped
// in seq order; the announcer-who-never-replied is NOT one). `addParticipant` gates the actor
// as a participant (NOT_A_MEMBER), resolves the target (HANDLE_NOT_FOUND if unregistered),
// then PLAIN-appends `room.participant_added` (actor=adder) + a conditional `board.joined`
// (actor=TARGET — the pulled-in peer joins the board, mirroring reply's auto-join) in ONE
// transaction; idempotent if the target already participates. ROOM_NOT_FOUND for an unknown
// room. This projection is also Story 4.6's join-cursor input. ---
export { roomParticipants, isParticipant } from './rooms/participants.js';
export { addParticipant } from './rooms/add-participant.js';
export type {
  AddParticipantInput,
  AddParticipantResult,
} from './rooms/add-participant.js';
