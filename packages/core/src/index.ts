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

// --- Message body-size cap (Story 5.1) — the formal 256 KB `BODY_TOO_LARGE` (NFR6/AR7) the
// body-bearing ops (`reply`, `postAnnouncement`) enforce before appending. A CORE check on
// UTF-8 BYTE length returning the closed code (NOT a Zod `.max`, which carries no code). ---
export { assertBodyWithinCap, MAX_BODY_BYTES } from './rooms/body-cap.js';

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

// --- Per-(identity, room) JOIN-CURSOR projection (Story 4.6) — the per-room FLOOR Story 6.1's
// `check` uses so a newly-joined / newly-added participant is NOT flooded with a room's
// back-history. `roomJoinSeq` derives the `seq` of a handle's EARLIEST participating event for a
// room (MIN over their `room.replied` ∪ the `room.participant_added` naming them; `undefined` if
// not a participant) — DERIVED, never stored (THE APPEND INVARIANT — no cursor table/mutation;
// the join-event `seq` IS the ledger position at the instant of join). `roomMessagesSince` filters
// `roomMessages` (4.4) to `seq > sinceSeq` (STRICT — your own join not re-surfaced), expressing
// that floor. The FIRST consumer is Story 6.1 (`check`), which combines this per-room floor with
// the stored per-identity high-water-mark as `seq > max(checkCursor, roomJoinSeq)` (Rule 1 escape
// clause — no Epic-4 consumer, NO new MCP tool/event/error code/stored cursor here). ---
export { roomJoinSeq, roomMessagesSince } from './rooms/join-cursor.js';

// --- Reactions projection + react/unreact ops (Story 5.2) — LIVE 👍 state DERIVED by
// latest-react-wins per actor (an actor is live iff their latest message.reacted/unreacted for a
// messageSeq is a react), NEVER stored (THE APPEND INVARIANT). `liveReactors`/`hasLiveReaction`
// project the live set; `findMessage` resolves the event at a `seq` to a message (its roomId) or
// undefined (→ MESSAGE_NOT_FOUND). `react`/`unreact` resolve the message (MESSAGE_NOT_FOUND),
// gate the actor on participating in its room (NOT_A_MEMBER — reacting REQUIRES participation, it
// does NOT grant it: only reply/add_participant are "acting = joining"), then PLAIN-append a
// message.reacted / message.unreacted { messageSeq } (idempotent no-op if already live / not
// live). Cannot-retract-another is INHERENT (unreact appends only the actor's own event; liveness
// is per-actor). This is the message-reaction surface Story 5.3's current-contract computes from. ---
export {
  findMessage,
  hasLiveReaction,
  liveReactors,
} from './rooms/reactions.js';
export type { ResolvedMessage } from './rooms/reactions.js';
export { react, unreact } from './rooms/react.js';
export type { ReactResult } from './rooms/react.js';

// --- Current-agreed-contract projection (Story 5.3) — FR21, the marquee Epic 5 capability.
// `currentContract(events, roomId)` is the room's CURRENT CONTRACT: of its messages (roomMessages,
// each carrying its live 👍 reactions via liveReactors), the HIGHEST-`seq` one holding ≥1 live 👍;
// `null` if none ("no contract yet"). COMPUTED by query every call, NEVER stored (THE APPEND
// INVARIANT) — so reversion-on-retract needs NO special logic (a fresh query yields the
// next-highest live-👍'd message, or null). Reuses roomMessages (does NOT re-fold reactions); the
// announcement (message #1) can be the contract. An OPEN read (FR9 — "computed by ANY reader");
// the read_contract tool (Story 5.3) gates only on NO_IDENTITY + resolves findRoom → ROOM_NOT_FOUND
// (existence) so an unknown room is DISTINCT from a known room with contract:null.
// `currentContract(events, roomId)` is the PURE projection (existence-agnostic — null for an
// unknown/empty room); `readContract(dataAccess, roomId)` is the thin read op the read_contract
// tool delegates to — it layers the findRoom → ROOM_NOT_FOUND existence check (mirroring readRoom)
// over a single stream read, so an unknown room (throws) is DISTINCT from a known room with no live
// reaction yet (returns null). ---
export { currentContract } from './rooms/contract.js';
export { readContract } from './rooms/read-contract.js';
