// The apps/web client's thin JSON-API + SSE access (Story 9.3, Task 1).
//
// The web client speaks ONLY the host's local JSON API + SSE channel (NFR2): it never
// imports @agentbbs/core / @agentbbs/data-access and never speaks MCP or SQL. These
// helpers are the entire data seam — `fetchDirectory` reads the board directory over
// HTTP; `foldDelta` accumulates the SSE event deltas the host pushes (host → THIS
// operator browser; NFR5 — never an agent push). Both are PURE/transport-thin and unit-
// testable without a real server (the AC3 integration test proves the real wiring).
//
// The wire shapes mirror the host's JSON API (snake_case), which mirrors the MCP tool
// contract envelopes. Story 9.4 adds the per-project room/announcement fetches, /api/me +
// /api/needs-you, and the NavTreeModel builder + the IMMUTABLE SSE tree fold (the live
// unread/activity decorations) — extending the 9.3 immutability discipline to the tree.

import type {
  MessagePostModel,
  NavTreeModel,
  NavTreeProject,
  RoomViewModel,
} from '@agentbbs/ui-shared';

/** A project (sub-board) as the JSON API returns it (snake_case). */
export interface ProjectWire {
  project_id: string;
  title: string;
  description: string;
  announcer: string;
  members: string[];
}

/** The `/api/directory` (and `/api/projects`) envelope. */
export interface DirectoryResponse {
  projects: ProjectWire[];
}

/** A room (or proto-room/announcement) as the JSON API returns it (snake_case). */
export interface RoomWire {
  room_id: string;
  project_id: string;
  subject: string;
  body: string;
  posted_by: string;
  seq: number;
  active: boolean;
  activated_by?: string;
  activated_at_seq?: number;
}

/** The `/api/projects/:id/rooms` envelope. */
export interface RoomsResponse {
  rooms: RoomWire[];
}

/** The `/api/projects/:id/announcements` envelope. */
export interface AnnouncementsResponse {
  announcements: RoomWire[];
}

/**
 * A room message as `/api/rooms/:id` returns it (snake_case). Mirrors the MCP `read_room`
 * message shape `{ seq, actor, body, kind, reactions }` PLUS the host-layer DISPLAY-ONLY
 * `created_at` (Story 9.5 — the host attaches it; core's RoomMessage stays seq-only). The
 * ORDER key is `seq`, never `created_at`.
 */
export interface MessageWire {
  seq: number;
  actor: string;
  body: string;
  kind: 'announcement' | 'reply';
  reactions: string[];
  created_at: string;
}

/** The `/api/rooms/:id` envelope — the room metadata, its messages, and its participants. */
export interface RoomResponse {
  room: RoomWire;
  messages: MessageWire[];
  participants: string[];
}

/** The `/api/me` envelope — the resolved operator handle, or null (watching-only). */
export interface MeResponse {
  handle: string | null;
}

/**
 * The `/api/rooms/:id/contract` envelope (Story 9.6). The CURRENT CONTRACT — the
 * highest-`seq` message currently holding a live 👍 (FR21) — or `null` ("no contract yet").
 * COMPUTED, never stored: the host re-derives it every call. The `seq` is what the UI marks
 * with `✓ agreed`.
 */
export interface ContractResponse {
  room_id: string;
  contract: MessageWire | null;
}

/** The react/unreact write envelope (Story 9.6) — the message seq + its live reactors after. */
export interface ReactResponse {
  message_seq: number;
  reactions: string[];
}

/** The `/api/needs-you` envelope — the deterministic escalation set. */
export interface NeedsYouResponse {
  rooms: RoomWire[];
}

/** One SSE delta frame's event payload (snake_case), as the host pushes it. */
export interface EventWire {
  seq: number;
  type: string;
  actor: string;
  created_at: string;
  payload: Record<string, unknown>;
}

/**
 * Fetch the board directory from the host's JSON API. Throws on a non-2xx response
 * (the caller surfaces a calm error state — Story 9.10 enriches it).
 *
 * @param baseUrl The host origin (defaults to the current page origin). Injectable so
 *   a test can point at a bound test host.
 * @param fetchImpl The fetch implementation (defaults to global `fetch`). Injectable.
 */
export async function fetchDirectory(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<DirectoryResponse> {
  const response = await fetchImpl(`${baseUrl}/api/directory`);
  if (!response.ok) {
    throw new Error(`Directory fetch failed: HTTP ${response.status}`);
  }
  return (await response.json()) as DirectoryResponse;
}

/** GET a typed JSON envelope from `path`; throws on a non-2xx (calm error state upstream). */
async function getJson<T>(
  path: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Fetch ${path} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Fetch the resolved operator handle (`/api/me`) — `{ handle: null }` when watching-only. */
export async function fetchMe(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<MeResponse> {
  return getJson<MeResponse>('/api/me', baseUrl, fetchImpl);
}

/** Fetch the NEEDS YOU escalation set (`/api/needs-you`) — deterministic, host-derived. */
export async function fetchNeedsYou(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<NeedsYouResponse> {
  return getJson<NeedsYouResponse>('/api/needs-you', baseUrl, fetchImpl);
}

/** Fetch a project's activated rooms (`/api/projects/:id/rooms`). */
export async function fetchProjectRooms(
  projectId: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<RoomsResponse> {
  return getJson<RoomsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/rooms`,
    baseUrl,
    fetchImpl,
  );
}

/** Fetch a project's announcements/proto-rooms (`/api/projects/:id/announcements`). */
export async function fetchProjectAnnouncements(
  projectId: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<AnnouncementsResponse> {
  return getJson<AnnouncementsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/announcements`,
    baseUrl,
    fetchImpl,
  );
}

/** The accumulated live state the SSE deltas fold into (minimal for 9.3). */
export interface LiveState {
  /** The highest event `seq` seen over SSE (the live high-water-mark). */
  lastSeq: number;
  /** The count of delta frames received (proves the pipe is live). */
  deltaCount: number;
  /** The most recent delta event (for the shell to display). */
  latest?: EventWire;
}

/** The initial (pre-SSE) live state. */
export const INITIAL_LIVE_STATE: LiveState = { lastSeq: 0, deltaCount: 0 };

/**
 * Fold one SSE delta event into the live state (PURE — the reducer the shell applies on
 * each `EventSource` message). Advances `lastSeq` to the max seen, increments the count,
 * and records the latest event. An out-of-order / already-seen `seq` does not regress
 * `lastSeq` (deltas are monotonic by construction, but the fold is defensive).
 *
 * @param state The current live state.
 * @param event The decoded delta event from an SSE `data:` frame.
 * @returns The next live state.
 */
export function foldDelta(state: LiveState, event: EventWire): LiveState {
  return {
    lastSeq: Math.max(state.lastSeq, event.seq),
    deltaCount: state.deltaCount + 1,
    latest: event,
  };
}

/**
 * Open an SSE connection to the host's event channel and invoke `onDelta` for each
 * delta frame. Returns a disposer that closes the `EventSource`. Uses the browser-global
 * `EventSource` (the web client runs in a real browser; the host serves
 * `text/event-stream`). NFR5: this is the operator browser's OWN live view — not an
 * agent push.
 *
 * @param onDelta Called with each decoded {@link EventWire}.
 * @param baseUrl The host origin (defaults to current origin).
 * @returns A function that closes the connection.
 */
export function openEventStream(
  onDelta: (event: EventWire) => void,
  baseUrl = '',
): () => void {
  const source = new EventSource(`${baseUrl}/api/events`);
  source.addEventListener('message', (ev: MessageEvent<string>) => {
    try {
      onDelta(JSON.parse(ev.data) as EventWire);
    } catch {
      // A malformed frame is ignored — the operator's view degrades gracefully.
    }
  });
  return () => source.close();
}

// =============================================================================
// Tree model (Story 9.4) — building the NavTreeModel from the JSON API + folding
// SSE deltas into it IMMUTABLY (the live unread/activity decorations).
// =============================================================================

/**
 * Load the full {@link NavTreeModel} from the host JSON API: the operator handle
 * (`/api/me`), the NEEDS YOU set (`/api/needs-you`), the directory (`/api/directory` —
 * EVERY project, global read FR28), and each project's rooms. Decorations start clean
 * (unread=false, count=0); SSE deltas bump them live via {@link foldTreeDelta}. The
 * `needsYou` flag on a room row is set iff that room is in the escalation set.
 *
 * @param baseUrl The host origin (defaults to current origin). Injectable for tests.
 * @param fetchImpl The fetch implementation (defaults to global `fetch`). Injectable.
 */
export async function loadTreeModel(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<NavTreeModel> {
  const [me, needsYou, directory] = await Promise.all([
    fetchMe(baseUrl, fetchImpl),
    fetchNeedsYou(baseUrl, fetchImpl),
    fetchDirectory(baseUrl, fetchImpl),
  ]);

  const needsYouRoomIds = new Set(needsYou.rooms.map((r) => r.room_id));

  const projects: NavTreeProject[] = await Promise.all(
    directory.projects.map(async (project) => {
      const [rooms, announcements] = await Promise.all([
        fetchProjectRooms(project.project_id, baseUrl, fetchImpl),
        fetchProjectAnnouncements(project.project_id, baseUrl, fetchImpl),
      ]);
      return {
        projectId: project.project_id,
        title: project.title,
        announcementCount: announcements.announcements.length,
        rooms: rooms.rooms.map((room) => ({
          roomId: room.room_id,
          subject: room.subject,
          unread: false,
          activityCount: 0,
          needsYou: needsYouRoomIds.has(room.room_id),
        })),
      };
    }),
  );

  return {
    operatorHandle: me.handle,
    activeRoomId: null,
    needsYou: needsYou.rooms.map((r) => ({
      roomId: r.room_id,
      projectId: r.project_id,
      subject: r.subject,
    })),
    projects,
  };
}

/** Which room id (if any) an SSE event affects — its decoration target. */
function eventRoomId(event: EventWire): string | undefined {
  const roomId = event.payload['room_id'];
  return typeof roomId === 'string' ? roomId : undefined;
}

/**
 * Fold one SSE delta event into the {@link NavTreeModel} IMMUTABLY (a NEW model object —
 * the 9.3 `foldDelta` immutability discipline, extended to the tree). AC2 live decorations:
 *   - a `room.replied` / `announcement.posted` in a room bumps that room row's unread `•`
 *     and increments its activity count (UNLESS the room is the active selection — the
 *     operator is looking at it, so it stays read; basic clear-on-select for 9.4, the rich
 *     tab-focus clear is 9.8/9.9).
 *   - a `room.participant_added` naming the operator adds the room to NEEDS YOU + flags its
 *     row (the live escalation; deterministic, never time-based — the host derivation, here
 *     mirrored for the live case so the operator sees an escalation arrive without a reload).
 * An event for a room not in the model (e.g. a brand-new room) is ignored for 9.4 (a full
 * re-fetch on new-room is 9.9's concern); the fold never throws.
 *
 * @param model The current tree model.
 * @param event The decoded SSE delta.
 * @returns A NEW tree model with the decoration applied (or the same shape if no-op).
 */
export function foldTreeDelta(
  model: NavTreeModel,
  event: EventWire,
): NavTreeModel {
  const roomId = eventRoomId(event);
  if (roomId === undefined) return model;

  // A live escalation naming the operator: add it to NEEDS YOU + flag the room row.
  if (
    event.type === 'room.participant_added' &&
    model.operatorHandle !== null &&
    event.payload['handle'] === model.operatorHandle
  ) {
    return applyEscalation(model, roomId);
  }

  // New room activity (a reply or a fresh announcement): bump unread + count, unless the
  // room is the active selection (the operator is reading it → it stays read).
  if (event.type === 'room.replied' || event.type === 'announcement.posted') {
    if (roomId === model.activeRoomId) return model;
    return bumpRoomActivity(model, roomId);
  }

  return model;
}

/** Immutably bump a room row's unread flag + activity count by one. */
function bumpRoomActivity(model: NavTreeModel, roomId: string): NavTreeModel {
  let changed = false;
  const projects = model.projects.map((project) => {
    if (!project.rooms.some((r) => r.roomId === roomId)) return project;
    return {
      ...project,
      rooms: project.rooms.map((room) => {
        if (room.roomId !== roomId) return room;
        changed = true;
        return {
          ...room,
          unread: true,
          activityCount: room.activityCount + 1,
        };
      }),
    };
  });
  return changed ? { ...model, projects } : model;
}

/** Immutably add a room to NEEDS YOU (if absent) + set its row's needs-you flag. */
function applyEscalation(model: NavTreeModel, roomId: string): NavTreeModel {
  const already = model.needsYou.some((r) => r.roomId === roomId);
  // Find the room's subject/project from the existing tree (best-effort for the label).
  let subject = roomId;
  let projectId = '';
  for (const project of model.projects) {
    const room = project.rooms.find((r) => r.roomId === roomId);
    if (room) {
      subject = room.subject;
      projectId = project.projectId;
      break;
    }
  }
  const needsYou = already
    ? model.needsYou
    : [...model.needsYou, { roomId, projectId, subject }];
  const projects = model.projects.map((project) => ({
    ...project,
    rooms: project.rooms.map((room) =>
      room.roomId === roomId ? { ...room, needsYou: true } : room,
    ),
  }));
  return { ...model, needsYou, projects };
}

/**
 * Mark `roomId` as the active selection and CLEAR its unread decoration (basic for 9.4 —
 * selecting a room clears its `•`/count; the rich tab-focus clear is 9.8/9.9). Immutable.
 *
 * @param model The current tree model.
 * @param roomId The room to select (its unread is cleared).
 * @returns A NEW tree model with the selection set and that room read.
 */
export function selectRoom(model: NavTreeModel, roomId: string): NavTreeModel {
  const projects = model.projects.map((project) => ({
    ...project,
    rooms: project.rooms.map((room) =>
      room.roomId === roomId
        ? { ...room, unread: false, activityCount: 0 }
        : room,
    ),
  }));
  return { ...model, activeRoomId: roomId, projects };
}

// =============================================================================
// Room thread (Story 9.5) — fetching ONE room's history + building the prop-driven
// RoomViewModel @agentbbs/ui-shared's RoomView renders. The operator POSTURE (AC2) is
// computed from /api/me + the room's participant list; the interactive join flip is 9.7.
// =============================================================================

/** Fetch ONE room's metadata + messages + participants (`/api/rooms/:id`). */
export async function fetchRoom(
  roomId: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<RoomResponse> {
  return getJson<RoomResponse>(
    `/api/rooms/${encodeURIComponent(roomId)}`,
    baseUrl,
    fetchImpl,
  );
}

/**
 * Fetch a room's CURRENT CONTRACT (`/api/rooms/:id/contract`) — the converged message (the
 * highest-`seq` live-👍'd one, FR21) or `{ contract: null }`. The UI marks the `contract.seq`
 * with `✓ agreed`. COMPUTED, never stored: re-fetch it after every 👍 toggle so the mark
 * MOVES/DISAPPEARS as the live-👍 state changes (Story 9.6).
 */
export async function fetchContract(
  roomId: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<ContractResponse> {
  return getJson<ContractResponse>(
    `/api/rooms/${encodeURIComponent(roomId)}/contract`,
    baseUrl,
    fetchImpl,
  );
}

/** POST a typed JSON body-less write to `path`; throws on a non-2xx (the toggle surfaces it). */
async function postJson<T>(
  path: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`POST ${path} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * POST a typed JSON write CARRYING a body to `path` (Story 9.7 reply/add_participant). Sends
 * `Content-Type: application/json` + the serialized `body`; throws on a non-2xx (the composer
 * surfaces a calm error — e.g. 413 BODY_TOO_LARGE, 403 NOT_A_MEMBER/NO_OPERATOR, 404).
 */
async function postJsonBody<T>(
  path: string,
  body: Record<string, unknown>,
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Place a 👍 on a message (`POST /api/rooms/:id/messages/:seq/react`, Story 9.6). PATH-ONLY
 * (no body); the host resolves the operator handle as the actor. Returns the message seq + its
 * live reactors after. Throws on a non-2xx (e.g. 403 NOT_A_MEMBER for a non-participant — the
 * caller surfaces the "join to react" hand-off, Story 9.7).
 */
export async function postReact(
  roomId: string,
  seq: number,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<ReactResponse> {
  return postJson<ReactResponse>(
    `/api/rooms/${encodeURIComponent(roomId)}/messages/${seq}/react`,
    baseUrl,
    fetchImpl,
  );
}

/** Retract a 👍 from a message (`POST /api/rooms/:id/messages/:seq/unreact`, Story 9.6). */
export async function postUnreact(
  roomId: string,
  seq: number,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<ReactResponse> {
  return postJson<ReactResponse>(
    `/api/rooms/${encodeURIComponent(roomId)}/messages/${seq}/unreact`,
    baseUrl,
    fetchImpl,
  );
}

/** The `POST /api/projects/:id/join` envelope (Story 9.7) — the joined sub-board. */
export interface JoinResponse {
  project: ProjectWire;
}

/** The `POST /api/rooms/:id/reply` envelope (Story 9.7) — the now-active room after the post. */
export interface ReplyResponse {
  room: RoomWire;
}

/** The `POST /api/rooms/:id/participants` envelope (Story 9.7) — the room + participants after. */
export interface AddParticipantResponse {
  room: RoomWire;
  participants: string[];
}

/**
 * Join the operator to a SUB-BOARD (`POST /api/projects/:id/join`, Story 9.7). This is the
 * `[ join room to post ]` handoff: the board has no standalone "join this room" op (Design
 * reconciliation) — `joinBoard` grants sub-board membership (the immediate `✓ you joined`);
 * full ROOM PARTICIPATION (enabling 👍/add_participant) is established by the first SEND
 * (`postReply` below, grant-on-act). Idempotent. Throws on a non-2xx (403 NO_OPERATOR, 404).
 */
export async function postJoin(
  projectId: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<JoinResponse> {
  return postJson<JoinResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/join`,
    baseUrl,
    fetchImpl,
  );
}

/**
 * Post a message to a room as the operator (`POST /api/rooms/:id/reply`, Story 9.7). The SAME
 * core `reply` the MCP clients use (no operator backdoor): grant-on-act makes the operator a
 * ROOM PARTICIPANT (and a sub-board member, idempotently), so after the first send the posture
 * flips to peer + 👍/add_participant light up. Body-carrying (`{ body }`). Throws on a non-2xx
 * (413 BODY_TOO_LARGE, 403 NO_OPERATOR, 404 ROOM_NOT_FOUND).
 */
export async function postReply(
  roomId: string,
  body: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<ReplyResponse> {
  return postJsonBody<ReplyResponse>(
    `/api/rooms/${encodeURIComponent(roomId)}/reply`,
    { body },
    baseUrl,
    fetchImpl,
  );
}

/**
 * Pull another peer into the room as the operator (`POST /api/rooms/:id/participants`, Story
 * 9.7). Gated on the operator already being a room participant (403 NOT_A_MEMBER otherwise —
 * lights up only after the operator's first reply). Body-carrying (`{ handle }`). Throws on a
 * non-2xx (403, 404 HANDLE_NOT_FOUND).
 */
export async function postAddParticipant(
  roomId: string,
  handle: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<AddParticipantResponse> {
  return postJsonBody<AddParticipantResponse>(
    `/api/rooms/${encodeURIComponent(roomId)}/participants`,
    { handle },
    baseUrl,
    fetchImpl,
  );
}

/**
 * Build the prop-driven {@link RoomViewModel} from the `/api/rooms/:id` envelope + the
 * resolved operator handle. The operator POSTURE (AC2, the Mode A→B signal): `peer` when
 * the operator handle is in the room's participant list, else `watching`. The message
 * order key stays `seq` (RoomView/MessageThread sort by it); `created_at` is mapped to the
 * post model's display `createdAt` only.
 *
 * @param room The room envelope from {@link fetchRoom}.
 * @param operatorHandle The resolved operator handle (`/api/me`), or `null` (watching-only).
 */
export function buildRoomViewModel(
  room: RoomResponse,
  operatorHandle: string | null,
  contract: ContractResponse | null = null,
): RoomViewModel {
  const isPeer =
    operatorHandle !== null && room.participants.includes(operatorHandle);
  const messages: MessagePostModel[] = room.messages.map((m) => ({
    seq: m.seq,
    actor: m.actor,
    body: m.body,
    kind: m.kind,
    createdAt: m.created_at,
    reactions: m.reactions,
  }));
  return {
    roomId: room.room.room_id,
    projectId: room.room.project_id,
    subject: room.room.subject,
    participants: room.participants,
    messages,
    operatorPosture:
      isPeer && operatorHandle !== null
        ? { kind: 'peer', handle: operatorHandle }
        : { kind: 'watching' },
    // The CONVERGED message seq (the ✓ agreed mark target) — the contract's seq, or null
    // ("no contract yet"). COMPUTED from /api/rooms/:id/contract, never stored (FR21); the
    // shell re-fetches the contract after every 👍 toggle so the mark MOVES/DISAPPEARS.
    agreedSeq: contract?.contract != null ? contract.contract.seq : null,
    // The operator handle drives each post's operator-👍'd chip state (operator ∈ reactions).
    operatorHandle,
  };
}

/**
 * Load + build a room's {@link RoomViewModel} in one call: fetch the room, `/api/me`, and the
 * room CONTRACT (the converged-message seq for the ✓ agreed mark), then compute the model
 * (incl. the operator posture + the agreed seq). The single seam apps/web's shell calls when
 * a tree room is selected — and re-calls after a 👍 toggle to re-derive the live count + the
 * agreed-mark position (Story 9.6; the rich optimistic echo is Story 9.9).
 */
export async function loadRoomViewModel(
  roomId: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<RoomViewModel> {
  const [room, me, contract] = await Promise.all([
    fetchRoom(roomId, baseUrl, fetchImpl),
    fetchMe(baseUrl, fetchImpl),
    fetchContract(roomId, baseUrl, fetchImpl),
  ]);
  return buildRoomViewModel(room, me.handle, contract);
}
