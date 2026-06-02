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

/**
 * The `/api/me` envelope — the resolved operator handle, or null (watching-only), PLUS the
 * host-layer DISPLAY/host-surface fields `focus` + `registered` (Story 9.13). `focus` is the
 * operator's OWN current focus (folded from the ledger by the host; `null` when watching-only OR
 * unregistered) — surfaced on the `@operator (you)` row. `registered` is whether the configured
 * `--as` handle has a prior `identity.registered` — it (with `handle !== null`) gates the
 * set-focus affordance (watching-only OR unregistered → disabled inline). These are HOST-LAYER
 * additive fields (like Story 9.5's `created_at`); the agent-facing MCP wire is untouched (Rule 13).
 */
export interface MeResponse {
  handle: string | null;
  focus: string | null;
  registered: boolean;
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

/** The live transport status surfaced to the connection footer (Story 9.10). */
export type ConnectionStatus = 'connected' | 'reconnecting';

/** Optional connection-status hooks for {@link openEventStream} (Story 9.10, the footer LED). */
export interface EventStreamOptions {
  /**
   * Called with the live transport status whenever it changes: `connected` on the
   * `EventSource` `onopen` (the channel is live), `reconnecting` on `onerror` (the browser's
   * built-in `EventSource` auto-reconnect is in flight — `readyState` is CONNECTING). This is
   * the prop the calm inline ConnectionFooter renders (NEVER a modal — AC1/DESIGN). The 9.9
   * live fold resumes automatically on the next `onopen` (the SSE redelivery is de-duped by
   * `foldRoomDelta`'s idempotent-by-seq append; no double-apply).
   */
  onStatus?: (status: ConnectionStatus) => void;
}

/**
 * Open an SSE connection to the host's event channel and invoke `onDelta` for each
 * delta frame. Returns a disposer that closes the `EventSource`. Uses the browser-global
 * `EventSource` (the web client runs in a real browser; the host serves
 * `text/event-stream`). NFR5: this is the operator browser's OWN live view — not an
 * agent push.
 *
 * CONNECTION STATUS (Story 9.10): the web `EventSource` exposes `onopen` (the channel is
 * OPEN/live → `connected`) and `onerror` (the connection dropped; the browser auto-reconnects,
 * `readyState` CONNECTING → `reconnecting`). When `options.onStatus` is supplied, those events
 * are mapped to the calm footer status. EventSource auto-reconnects on its own — the host is
 * never modal-alerted; the operator's already-loaded content stays readable while reconnecting.
 *
 * @param onDelta Called with each decoded {@link EventWire}.
 * @param baseUrl The host origin (defaults to current origin).
 * @param options Optional connection-status hooks (the footer LED).
 * @returns A function that closes the connection.
 */
export function openEventStream(
  onDelta: (event: EventWire) => void,
  baseUrl = '',
  options: EventStreamOptions = {},
): () => void {
  const source = new EventSource(`${baseUrl}/api/events`);
  source.addEventListener('message', (ev: MessageEvent<string>) => {
    try {
      onDelta(JSON.parse(ev.data) as EventWire);
    } catch {
      // A malformed frame is ignored — the operator's view degrades gracefully.
    }
  });
  if (options.onStatus) {
    const { onStatus } = options;
    // onopen: the channel is live (initial open AND every successful auto-reconnect) → connected.
    source.addEventListener('open', () => onStatus('connected'));
    // onerror: the connection dropped; the browser EventSource auto-reconnects (readyState
    // CONNECTING). A calm inline `reconnecting…`, never a modal — already-loaded content stays.
    source.addEventListener('error', () => onStatus('reconnecting'));
  }
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
      // Story 9.14 — build the project's room rows from BOTH the ACTIVE rooms
      // (`/api/projects/:id/rooms`) AND the PROTO-ROOMS (`/api/projects/:id/announcements`,
      // `active:false` — announced negotiations no one has replied to yet). A proto-room is a
      // navigable PENDING row (the operator can open it, read the announcement, and reply to
      // ACTIVATE it via the EXISTING core `reply` — the Epic-4 min-seq activator; no new op).
      // The two sets are disjoint by `active`, but we dedupe by `roomId` DEFENSIVELY so an
      // active room can never also appear as a stale proto-row. Active rooms render first, then
      // pending rooms — a stable order. The `announcements (N)` bucket (which opens the
      // post-compose, Story 9.11) keeps its OWN count; proto-rooms are SIBLING rows, not the
      // bucket (Design decision).
      const seenRoomIds = new Set<string>();
      const activeRows = rooms.rooms.map((room) => {
        seenRoomIds.add(room.room_id);
        return {
          roomId: room.room_id,
          subject: room.subject,
          unread: false,
          activityCount: 0,
          needsYou: needsYouRoomIds.has(room.room_id),
          pending: false,
        };
      });
      const pendingRows = announcements.announcements
        .filter((room) => !seenRoomIds.has(room.room_id))
        .map((room) => {
          seenRoomIds.add(room.room_id);
          return {
            roomId: room.room_id,
            subject: room.subject,
            unread: false,
            activityCount: 0,
            needsYou: needsYouRoomIds.has(room.room_id),
            pending: true,
          };
        });
      return {
        projectId: project.project_id,
        title: project.title,
        announcementCount: announcements.announcements.length,
        rooms: [...activeRows, ...pendingRows],
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
 * A typed error carrying the host's uniform `{ code, message }` error envelope (Story 9.11).
 * The host maps every BoardError / host-surface condition to `{ code: SCREAMING_SNAKE, message }`
 * at the right HTTP status; a bare `Error('… HTTP <status>')` LOSES that code, but the operator
 * compose affordances must BRANCH on it — `PROJECT_EXISTS` (duplicate title, inline calm error),
 * `NOT_A_MEMBER` (post into a non-member project → the join-first handoff), `BODY_TOO_LARGE`
 * (over-cap body, inline calm error). `postJsonBody` parses the JSON error body on a non-2xx and
 * throws THIS so callers can read `.code`. Backward-compatible: existing callers that only catch
 * `Error` (postReply/postJoin/postAddParticipant) still work — `ApiError extends Error`, so its
 * `.message` is the host message and they may ignore `.code`. CLIENT-LAYER ONLY: this mirrors the
 * host wire's closed-contract codes for the UI; it adds nothing to core's `BOARD_ERROR_CODES`.
 */
export class ApiError extends Error {
  constructor(
    /** The host error code (`PROJECT_EXISTS`, `NOT_A_MEMBER`, `BODY_TOO_LARGE`, `NO_OPERATOR`, …). */
    readonly code: string,
    message: string,
    /** The HTTP status the host returned (for diagnostics). */
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * POST a typed JSON write CARRYING a body to `path` (Story 9.7 reply/add_participant; Story 9.11
 * announce_project/post_announcement). Sends `Content-Type: application/json` + the serialized
 * `body`. On a non-2xx it parses the host's `{ code, message }` error envelope and throws an
 * {@link ApiError} carrying `.code` (so a compose affordance can branch on `PROJECT_EXISTS` /
 * `NOT_A_MEMBER` / `BODY_TOO_LARGE` for the calm inline/handoff surfaces — Story 9.11). A response
 * whose body is not the expected envelope falls back to a synthetic `HTTP_<status>` code so the
 * caller still gets an `ApiError` (never a silent failure).
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
    // Parse the host's uniform { code, message } error envelope so the caller can branch on the
    // code (the calm inline error / join-first handoff). A non-JSON / non-envelope body degrades
    // to a synthetic code keyed on the status — still an ApiError, never a lost failure.
    let code = `HTTP_${response.status}`;
    let message = `POST ${path} failed: HTTP ${response.status}`;
    try {
      const parsed = (await response.json()) as {
        code?: unknown;
        message?: unknown;
      };
      if (typeof parsed.code === 'string') code = parsed.code;
      if (typeof parsed.message === 'string') message = parsed.message;
    } catch {
      // Body was not JSON (or already consumed) — keep the synthetic code/message.
    }
    throw new ApiError(code, message, response.status);
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

/** The `POST /api/projects` envelope (Story 9.11) — the announced project (operator first member). */
export interface AnnounceProjectResponse {
  project: ProjectWire;
}

/** The `POST /api/projects/:id/announcements` envelope (Story 9.11) — the opened proto-room. */
export interface PostAnnouncementResponse {
  room: RoomWire;
}

/**
 * START A NEGOTIATION — announce a new project as the operator (`POST /api/projects`, Story 9.11).
 * The SAME core `announceProject` an agent uses (no operator backdoor): the operator becomes the
 * new sub-board's first member. Body-carrying (`{ title, description }`). Throws an {@link ApiError}
 * on a non-2xx — the caller branches on `.code === 'PROJECT_EXISTS'` (duplicate title/slug → 409,
 * calm inline error) or `NO_OPERATOR` (watching-only host → 403).
 */
export async function announceProject(
  title: string,
  description: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<AnnounceProjectResponse> {
  return postJsonBody<AnnounceProjectResponse>(
    '/api/projects',
    { title, description },
    baseUrl,
    fetchImpl,
  );
}

/**
 * OPEN A ROOM — post a new announcement into a project as the operator
 * (`POST /api/projects/:id/announcements`, Story 9.11). The SAME core `postAnnouncement` an agent
 * uses. Body-carrying (`{ subject, body }`). Throws an {@link ApiError} on a non-2xx — the caller
 * branches on `.code === 'NOT_A_MEMBER'` (the operator is not a member → 403, the join-first
 * handoff, NEVER a silent failure), `BODY_TOO_LARGE` (over-cap body → 413, calm inline error),
 * `BOARD_NOT_FOUND` (404), or `NO_OPERATOR` (403).
 */
export async function postAnnouncement(
  projectId: string,
  subject: string,
  body: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<PostAnnouncementResponse> {
  return postJsonBody<PostAnnouncementResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/announcements`,
    { subject, body },
    baseUrl,
    fetchImpl,
  );
}

/** The `POST /api/me/focus` envelope (Story 9.13) — the operator's handle + its new current focus. */
export interface FocusResponse {
  handle: string;
  focus: string;
}

/**
 * SET MY FOCUS — set the operator's OWN current focus (`POST /api/me/focus`, Story 9.13). The SAME
 * core `updateFocus` an agent uses (no operator backdoor): a real `identity.focus_updated` lands in
 * the ledger. Body-carrying (`{ focus }`). Throws an {@link ApiError} on a non-2xx — the caller
 * branches on `.code === 'NO_OPERATOR'` (watching-only host → 403) or `OPERATOR_NOT_REGISTERED`
 * (the configured handle was never registered → 403, the defensive host backstop; the affordance is
 * also proactively disabled client-side). CLIENT-LAYER ONLY — adds nothing to core's contract.
 */
export async function postFocus(
  focus: string,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<FocusResponse> {
  return postJsonBody<FocusResponse>(
    '/api/me/focus',
    { focus },
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

// =============================================================================
// Story 9.9 — LIVE updates + OPTIMISTIC posting + reconciliation, ALL on the OPEN room
// thread (Mode A watch-live). The open RoomViewModel folds SSE deltas IMMUTABLY (a NEW model
// — the 9.3 `foldDelta`/9.4 `foldTreeDelta` discipline, extended to the thread itself), the
// operator's post echoes PENDING then reconciles to confirmed, and failures revert inline.
//
// NFR5 (re-affirmed, do NOT blur): every helper below derives the OPERATOR'S OWN open view
// from the host→browser SSE deltas. There is NO agent push surface here — agents stay strictly
// pull-only via `check`. These are pure client-side reducers over deltas the operator's chosen
// kept-open view receives; nothing here pushes anything to any agent.
// =============================================================================

/**
 * The base `seq` for a PENDING optimistic echo (Story 9.9). A pending post is given a synthetic
 * seq AT OR ABOVE this base so it sorts to the BOTTOM of the seq-ordered thread (after every
 * real ledger message, whose seqs are far below) until it reconciles to its real seq. Chosen
 * well above any plausible real `seq` but safely inside `Number.MAX_SAFE_INTEGER`.
 */
export const PENDING_SEQ_BASE = 1e15;

/** Monotonic counter so concurrent pending echoes get distinct (ordered) synthetic seqs. */
let pendingSeqCounter = 0;

/**
 * Mint a unique client-side token for an optimistic echo (Story 9.9) — correlates the pending
 * post to its confirmation (for reconciliation) and to a retry. Opaque; never sent to the host.
 */
export function newClientToken(): string {
  pendingSeqCounter += 1;
  return `pending-${Date.now()}-${pendingSeqCounter}`;
}

/**
 * Build a PENDING optimistic echo post for the operator's just-sent `body` (Story 9.9, AC2).
 * Dimmed "sending…" in the thread; a synthetic seq (≥ {@link PENDING_SEQ_BASE}) sorts it last;
 * the `clientToken` correlates it to its confirmation / retry. No `createdAt` (it is in flight).
 */
export function makePendingPost(
  actor: string,
  body: string,
  clientToken: string,
): MessagePostModel {
  pendingSeqCounter += 1;
  return {
    seq: PENDING_SEQ_BASE + pendingSeqCounter,
    actor,
    body,
    kind: 'reply',
    reactions: [],
    pending: true,
    clientToken,
  };
}

/**
 * Append a PENDING optimistic echo to a room model IMMUTABLY (Story 9.9, AC2). Returns a NEW
 * model with the echo added to the end of the thread; the prior model + its `messages` array
 * are untouched (the 9.3 immutability discipline).
 */
export function appendPendingPost(
  model: RoomViewModel,
  post: MessagePostModel,
): RoomViewModel {
  return { ...model, messages: [...model.messages, post] };
}

/**
 * Mark a pending echo (by `clientToken`) as FAILED IMMUTABLY (Story 9.9, AC2 failure). The post
 * keeps its body (the draft is PRESERVED — the inline `post failed — retry` re-sends it) and
 * flips `pending → failed`. A NEW model; no in-place mutation. A no-op if the token is gone
 * (e.g. already reconciled).
 */
export function markPendingPostFailed(
  model: RoomViewModel,
  clientToken: string,
): RoomViewModel {
  let changed = false;
  const messages = model.messages.map((m) => {
    if (m.clientToken !== clientToken) return m;
    changed = true;
    return { ...m, pending: false, failed: true };
  });
  return changed ? { ...model, messages } : model;
}

/**
 * Remove a pending/failed echo (by `clientToken`) from a room model IMMUTABLY (Story 9.9). Used
 * on reconciliation — once the confirmed message is present (via a refetch that already includes
 * it, or an SSE delta), the optimistic echo for that token is dropped so there is NO DUPLICATE.
 * A NEW model; no in-place mutation.
 */
export function removePendingPost(
  model: RoomViewModel,
  clientToken: string,
): RoomViewModel {
  const messages = model.messages.filter((m) => m.clientToken !== clientToken);
  return messages.length === model.messages.length
    ? model
    : { ...model, messages };
}

/**
 * Derive the CONTRACT seq — the highest-`seq` message currently holding a live 👍 (FR21) — from
 * a model's messages (Story 9.9). The model's per-post `reactions` array IS the net live-reactor
 * set (the host computes react-minus-later-unreact), so the converged message is the
 * highest-`seq` post with a non-empty `reactions`. `null` when no message holds a live 👍.
 * OPTIMISTIC echoes (no real seq, empty reactions) never qualify. Mirrors the host's
 * `/api/rooms/:id/contract` derivation so the live ✓ agreed mark MOVES/DISAPPEARS on a reaction
 * delta without a refetch.
 */
export function deriveAgreedSeq(messages: MessagePostModel[]): number | null {
  let agreed: number | null = null;
  for (const m of messages) {
    if (m.pending === true || m.failed === true) continue;
    if (m.reactions.length > 0 && (agreed === null || m.seq > agreed)) {
      agreed = m.seq;
    }
  }
  return agreed;
}

/**
 * Fold ONE SSE delta into the OPEN room's {@link RoomViewModel} IMMUTABLY (Story 9.9, AC1 — the
 * open thread updates live, Mode A watch-live). Returns a NEW model (no in-place mutation),
 * mirroring `foldDelta`/`foldTreeDelta`:
 *
 *   - `room.replied` for THIS room → APPEND the post (seq = the event's own seq; body from the
 *     payload). IDEMPOTENT by seq: a delta whose seq is already present is dropped (so an SSE
 *     redelivery across a reconnect does not double-append). DE-DUP vs. an OPTIMISTIC echo by
 *     THIS operator: if a pending/failed echo matches (same actor + same body), it is REPLACED
 *     by the confirmed post (the reconciliation path) rather than appended alongside.
 *   - `message.reacted` / `message.unreacted` → ADD/REMOVE the event's `actor` from the target
 *     message's `reactions` (the delta carries only `message_seq`, not the post-state reactors,
 *     so the fold re-derives), then RE-DERIVE the agreed mark ({@link deriveAgreedSeq}).
 *
 * A delta for a DIFFERENT room, or any other type, returns the model unchanged. `operatorHandle`
 * lets the de-dup recognize the operator's OWN reply (the reconciliation case); pass the model's
 * own `operatorHandle`. Never throws.
 *
 * @param model The current OPEN room model.
 * @param event The decoded SSE delta (snake_case payload).
 * @returns A NEW model with the delta folded (or the same reference on a no-op).
 */
export function foldRoomDelta(
  model: RoomViewModel,
  event: EventWire,
): RoomViewModel {
  const payloadRoomId = event.payload['room_id'];
  if (typeof payloadRoomId === 'string' && payloadRoomId !== model.roomId) {
    return model;
  }

  if (event.type === 'room.replied') {
    return foldReplied(model, event);
  }
  if (event.type === 'message.reacted' || event.type === 'message.unreacted') {
    return foldReaction(model, event);
  }
  return model;
}

/** Fold a `room.replied` delta: idempotent append, with optimistic-echo de-dup (reconcile). */
function foldReplied(model: RoomViewModel, event: EventWire): RoomViewModel {
  // Idempotent by seq: the confirmed message is already in the thread (e.g. a refetch landed it
  // first, or an SSE redelivery) → no double-append.
  if (model.messages.some((m) => m.seq === event.seq && m.pending !== true)) {
    return model;
  }
  const body =
    typeof event.payload['body'] === 'string'
      ? (event.payload['body'] as string)
      : '';
  const confirmed: MessagePostModel = {
    seq: event.seq,
    actor: event.actor,
    body,
    kind: 'reply',
    reactions: [],
    createdAt: event.created_at,
  };

  // De-dup vs. THIS operator's optimistic echo: a pending/failed echo with the same actor + body
  // is the same post arriving over SSE → REPLACE it (reconcile) instead of appending a duplicate.
  const echoIndex = model.messages.findIndex(
    (m) =>
      (m.pending === true || m.failed === true) &&
      m.actor === event.actor &&
      m.body === body,
  );
  if (echoIndex !== -1) {
    const messages = model.messages.map((m, i) =>
      i === echoIndex ? confirmed : m,
    );
    return { ...model, messages };
  }

  return { ...model, messages: [...model.messages, confirmed] };
}

/** Fold a `message.reacted`/`message.unreacted` delta: add/remove the actor + re-derive agreed. */
function foldReaction(model: RoomViewModel, event: EventWire): RoomViewModel {
  const targetSeq = event.payload['message_seq'];
  if (typeof targetSeq !== 'number') return model;
  const add = event.type === 'message.reacted';
  let changed = false;
  const messages = model.messages.map((m) => {
    if (m.seq !== targetSeq) return m;
    const has = m.reactions.includes(event.actor);
    if (add && !has) {
      changed = true;
      return { ...m, reactions: [...m.reactions, event.actor] };
    }
    if (!add && has) {
      changed = true;
      return { ...m, reactions: m.reactions.filter((r) => r !== event.actor) };
    }
    return m;
  });
  if (!changed) return model;
  return { ...model, messages, agreedSeq: deriveAgreedSeq(messages) };
}
