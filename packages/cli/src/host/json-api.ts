// The on-demand web host's JSON API (Story 9.3, Task 2).
//
// A THIN, READ-FIRST HTTP/JSON surface that mirrors the core READ operations over the
// @agentbbs/data-access SQLite seam — the analogue of the stdio mcp-server's read
// tools, but speaking HTTP. The apps/web client speaks THIS API; it never speaks MCP
// or SQL (NFR2 / project-context.md#UI rendering). The host imports @agentbbs/core +
// @agentbbs/data-access ONLY; it carries no board logic of its own — it parses the
// request, delegates to a core read op, maps the result to the snake_case wire, and
// returns (same posture as a thin MCP tool).
//
// ROUTES (read-only for 9.3 — the seam every later UI story consumes):
//   GET /api/directory                  → { projects } (the main-board sub-board list)
//   GET /api/projects                   → { projects } (alias of directory; FR-friendly)
//   GET /api/projects/:projectId/members→ { members }
//   GET /api/projects/:projectId/announcements → { announcements }
//   GET /api/projects/:projectId/rooms  → { rooms }
//   GET /api/rooms/:roomId              → { room, messages, participants }
//     (each message additionally carries a DISPLAY-ONLY `created_at`; the host has the
//      events, core's RoomMessage + the ratified MCP message wire stay seq-only — Story 9.5)
//   GET /api/rooms/:roomId/contract     → { room_id, contract }
//
// WRITE endpoints:
//   POST /api/rooms/:roomId/messages/:seq/react   → { message_seq, reactions } (9.6)
//   POST /api/rooms/:roomId/messages/:seq/unreact → { message_seq, reactions } (9.6)
//   POST /api/projects/:projectId/join            → { project } (9.7, no body)
//   POST /api/rooms/:roomId/reply  (body { body })→ { room } (9.7, BODY-carrying)
//   POST /api/rooms/:roomId/participants (body { handle }) → { room, participants } (9.7)
//   POST /api/projects (body { title, description }) → { project } (9.11, BODY-carrying)
//   POST /api/projects/:projectId/announcements (body { subject, body }) → { room } (9.11)
// The dispatch table is the documented extension seam: a write route slots in as a new
// `{ method:'POST', pattern, handler }` entry — the SAME route-table shape as a read,
// distinguished only by `method`. The write handlers are THIN (mirroring the read ones):
// they resolve the operator handle the host already holds (Story 9.4 `--as`/
// AGENTBBS_OPERATOR) as the `actor`, call the core op, and map the result to the
// snake_case wire. The 9.6 react/unreact writes are PATH-ONLY (the message `seq` is in
// the path); the 9.7 reply/add_participant writes CARRY a JSON BODY (`{ body }` /
// `{ handle }`) — `server.ts` parses + size-bounds the request body and passes the parsed
// object in here (see {@link handleApiRequest}'s `body` param + the body-cap note below).
//
// 9.7 join semantics (Design reconciliation, project-rules Rule 8 — surfaced to review):
// the board (Epics 3–5) has NO standalone "join THIS ROOM as a participant" op. Room
// PARTICIPATION (what react/add_participant gate on) is GRANTED ONLY by ACTING — `reply`
// (grant-on-act: a non-member's reply bundles a board.joined + room.replied, "acting =
// joining", FR10) or being `add_participant`'d. `joinBoard` joins the SUB-BOARD
// (membership, needed for posting) but is NOT room participation. So the join-gate composer
// maps to: `[ join room to post ]` → `joinBoard(operator, projectId)` (immediate sub-board
// membership → ✓ you joined); SEND a message → `reply(operator, { roomId, body })` (the
// post AND the grant-on-act that makes the operator a ROOM PARTICIPANT, idempotently a
// member). After the first reply the operator is a room participant, so 👍/add_participant
// (which gate on participation) light up — EXACTLY the agent rule, no operator backdoor.
//
// WRITE error model: a write with NO operator handle (watching-only) cannot act → 403
// NO_OPERATOR (a host-surface code; core is never reached because there is no actor). A
// non-participant operator add_participant → core throws NOT_A_MEMBER → 403. An over-cap
// reply body → core throws BODY_TOO_LARGE → 413. An unknown room/project → ROOM_NOT_FOUND/
// BOARD_NOT_FOUND → 404. An unknown message `seq` (react/unreact) → MESSAGE_NOT_FOUND → 404.
//
// ERROR MODEL: core throws BoardError(code, message); the host maps each closed code to
// an HTTP status + the uniform `{ code, message }` body (the same closed contract the
// MCP surface exposes, mapped to a different transport). A *_NOT_FOUND code → 404; an
// unknown route → 404 with NOT_FOUND; anything unexpected → 500 INTERNAL_ERROR. Success
// returns the value directly (no { data } envelope), snake_case, real arrays/booleans,
// `null` for absence — the wire contract.

import {
  BoardError,
  addParticipant,
  announceProject,
  boardDirectory,
  findRoom,
  joinBoard,
  listAnnouncements,
  listProjects,
  listRooms,
  needsYouRooms,
  postAnnouncement,
  react,
  readContract,
  reply,
  roomMessages,
  roomParticipants,
  unreact,
} from '@agentbbs/core';

import {
  memberToWire,
  messageToWire,
  projectToWire,
  roomToWire,
} from './wire.js';

import type { DataAccess, Event } from '@agentbbs/core';

/** A slug param (project_id / room_id) — the shape core read ops expect. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A HOST-surface error — a condition the host detects BEFORE (or instead of) reaching
 * core, so it has no place in core's closed `BoardError` set. It carries its own HTTP
 * status + a SCREAMING_SNAKE code that lives in the HOST's vocabulary (e.g. `NO_OPERATOR`
 * for a write attempted by a watching-only host). `handleApiRequest` maps it straight to
 * the uniform `{ code, message }` body, exactly like a `BoardError` — the wire shape is
 * identical, only the origin differs. Keeping it OUT of `BoardError` preserves core's
 * closed error contract (the agent-facing surface) unchanged.
 */
class HostApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HostApiError';
  }
}

/** The JSON body + HTTP status a route handler resolves to. */
export interface JsonResponse {
  status: number;
  /** A JSON-serializable value (object). */
  body: unknown;
}

/**
 * The per-request context a route handler reads beyond the captured path params: the
 * persistence port plus the resolved operator handle (`null` for the watching-only
 * posture — no operator handle was configured). The operator handle is the host's
 * read-only answer to "who am I" — it personalizes `/api/me` + the NEEDS YOU queue;
 * global read works regardless (FR28).
 */
export interface ApiContext {
  /** The persistence port handlers delegate every read to. */
  dataAccess: DataAccess;
  /** The resolved operator handle, or `null` (watching-only). */
  operatorHandle: string | null;
  /**
   * The parsed JSON request body for a body-carrying WRITE (Story 9.7 reply/add_participant),
   * or `undefined` (a body-less GET or a PATH-only write). Read via {@link requireBodyString}.
   */
  body: RequestBody;
}

/**
 * The parsed JSON request body for a body-carrying WRITE (Story 9.7 reply/add_participant).
 * `server.ts` parses + size-bounds the raw request stream and passes the resulting object
 * (or `undefined` for a body-less request) into {@link handleApiRequest}. An unparseable
 * body surfaces as a 400 BEFORE reaching here (server-side); a missing-but-required field
 * is the handler's own 400 (`requireBodyString`).
 */
export type RequestBody = Record<string, unknown> | undefined;

/** A matched route handler: receives the captured path params + the request context. */
type RouteHandler = (
  params: Record<string, string>,
  ctx: ApiContext,
) => Promise<JsonResponse>;

/** One route in the dispatch table. `pattern` segments may be `:name` captures. */
interface Route {
  method: 'GET' | 'POST';
  /** Path template, e.g. `/api/rooms/:roomId/contract`. */
  pattern: string;
  handler: RouteHandler;
}

/**
 * Index every event's `createdAt` (ISO-8601 UTC string) by its `seq`. A {@link RoomMessage}'s
 * identity IS its underlying event `seq`, so this maps each message to its DISPLAY timestamp
 * (Story 9.5) without touching core. Used only to enrich the `/api/rooms/:id` envelope; the
 * ORDER key stays `seq` (this index is never sorted on).
 */
function createdAtIndex(events: Event[]): Map<number, string> {
  const index = new Map<number, string>();
  for (const event of events) {
    index.set(event.seq, event.createdAt);
  }
  return index;
}

/** Build a uniform `{ code, message }` error response at the given status. */
function errorResponse(
  status: number,
  code: string,
  message: string,
): JsonResponse {
  return { status, body: { code, message } };
}

/** Validate a captured slug param; throws BODY-style 400 if malformed. */
function requireSlug(value: string, name: string): string {
  if (!SLUG_RE.test(value)) {
    throw new BoardError(
      // Reuse the nearest closed code: a malformed id cannot match anything →
      // treat as a not-found-shaped client error. We surface 400 via the wire map
      // below (handled specially), keeping the closed code set unchanged.
      'BOARD_NOT_FOUND',
      `Malformed ${name}: "${value}" is not a valid slug.`,
    );
  }
  return value;
}

/**
 * Parse a captured `:seq` path param to a positive integer (a message `seq`). A
 * non-integer / non-positive value cannot identify any message → a malformed-shaped
 * client 400 (reuses MESSAGE_NOT_FOUND, surfaced as 400 via the `Malformed ` prefix the
 * wire map keys on, like {@link requireSlug}). The closed code set is unchanged.
 */
function requireSeq(value: string): number {
  const seq = Number(value);
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new BoardError(
      'MESSAGE_NOT_FOUND',
      `Malformed seq: "${value}" is not a positive integer.`,
    );
  }
  return seq;
}

/**
 * Resolve the acting operator handle for a WRITE, or throw. A watching-only host (no
 * `--as`/AGENTBBS_OPERATOR) has no actor — it can READ everything but cannot WRITE; the
 * react/unreact toggle is a participation action that needs an identity. The host stops
 * here BEFORE core (there is no actor to pass), with a host-surface `NO_OPERATOR` code →
 * 403. (Distinct from core's `NOT_A_MEMBER`, which a KNOWN operator who is not a room
 * participant gets — that one IS surfaced by core.)
 */
function requireOperator(operatorHandle: string | null): string {
  if (operatorHandle === null) {
    throw new HostApiError(
      403,
      'NO_OPERATOR',
      'No operator handle is configured (the UI is watching-only); start `agentbbs ui --as <handle>` to act.',
    );
  }
  return operatorHandle;
}

/**
 * Read a required string field from the parsed JSON request body of a body-carrying WRITE
 * (Story 9.7 reply `body` / add_participant `handle`). A missing body, a non-object body,
 * or a non-string / empty field is a host-surface 400 (`BAD_REQUEST`) — the handler never
 * reaches core with a malformed payload. The VALUE itself is NOT further validated here
 * (core enforces its own invariants: `reply` applies the `BODY_TOO_LARGE` cap;
 * `addParticipant` resolves the handle → `HANDLE_NOT_FOUND`). Distinct from the operator
 * gate (`requireOperator`) — this is about the payload shape, not the actor.
 */
function requireBodyString(body: RequestBody, field: string): string {
  const value = body === undefined ? undefined : body[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new HostApiError(
      400,
      'BAD_REQUEST',
      `Request body must carry a non-empty string "${field}".`,
    );
  }
  return value;
}

/**
 * The route table — read routes (mirroring the core read ops) plus the Story 9.6 write
 * routes (react/unreact). Each handler is THIN: it validates its params, resolves the
 * operator (writes), calls a core op, and maps to the snake_case wire envelope mirroring
 * the MCP contract. A write is distinguished only by `method: 'POST'`.
 */
const ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: '/api/me',
    handler: async (_params, { operatorHandle }) => {
      // The operator's "who am I": the resolved handle, or `null` (watching-only). Global
      // read works either way; this only personalizes `(you)` + the NEEDS YOU queue.
      return { status: 200, body: { handle: operatorHandle } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/needs-you',
    handler: async (_params, { dataAccess, operatorHandle }) => {
      // DETERMINISTIC, explicit-escalation-only (AC3): the rooms the operator was pulled
      // into via add_participant(@operator). NEVER time-based. A null operator → []
      // (nothing can be escalated to "nobody") — handled inside needsYouRooms.
      const rooms = await needsYouRooms(dataAccess, operatorHandle);
      return { status: 200, body: { rooms: rooms.map(roomToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/directory',
    handler: async (_params, { dataAccess }) => {
      const projects = await listProjects(dataAccess);
      return { status: 200, body: { projects: projects.map(projectToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects',
    handler: async (_params, { dataAccess }) => {
      const projects = await listProjects(dataAccess);
      return { status: 200, body: { projects: projects.map(projectToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:projectId/members',
    handler: async (params, { dataAccess }) => {
      const projectId = requireSlug(params.projectId, 'project_id');
      const members = await boardDirectory(dataAccess, projectId);
      return { status: 200, body: { members: members.map(memberToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:projectId/announcements',
    handler: async (params, { dataAccess }) => {
      const projectId = requireSlug(params.projectId, 'project_id');
      const rooms = await listAnnouncements(dataAccess, projectId);
      return { status: 200, body: { announcements: rooms.map(roomToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:projectId/rooms',
    handler: async (params, { dataAccess }) => {
      const projectId = requireSlug(params.projectId, 'project_id');
      const rooms = await listRooms(dataAccess, projectId);
      return { status: 200, body: { rooms: rooms.map(roomToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/rooms/:roomId',
    handler: async (params, { dataAccess }) => {
      const roomId = requireSlug(params.roomId, 'room_id');
      // Read the `seq`-ordered stream ONCE; resolve the room (ROOM_NOT_FOUND mirrors
      // readRoom), then derive its messages + participants + the per-message display
      // timestamp from the SAME events. Story 9.5: the core RoomMessage and the ratified
      // MCP message wire (`messageToWire`) are UNTOUCHED — `created_at` is a HOST-LAYER
      // DISPLAY-ONLY field attached here (the host has the events; core does not carry it
      // because `seq`, never `createdAt`, is the order key). Ordering stays by `seq`.
      const events = await dataAccess.eventsSince(0);
      const room = findRoom(events, roomId);
      if (room === undefined) {
        throw new BoardError(
          'ROOM_NOT_FOUND',
          `No such room: "${roomId}". It was never announced.`,
        );
      }
      const messages = roomMessages(events, roomId);
      // Map each message `seq` → its event `createdAt` (the message's identity IS its
      // event `seq`), so the display timestamp pairs with the right post.
      const createdAtBySeq = createdAtIndex(events);
      const participants = roomParticipants(events, roomId);
      return {
        status: 200,
        body: {
          room: roomToWire(room),
          // DISPLAY-ONLY `created_at` (ISO string) appended to the ratified message wire;
          // ordering is by `seq` (messageToWire + roomMessages keep that invariant).
          messages: messages.map((m) => ({
            ...messageToWire(m),
            created_at: createdAtBySeq.get(m.seq) ?? '',
          })),
          // The room's participants (posted-in ∪ pulled-in), seq-ordered — the joined-row
          // + operator-posture source. A pulled-in peer with no message still appears.
          participants,
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/rooms/:roomId/contract',
    handler: async (params, { dataAccess }) => {
      const roomId = requireSlug(params.roomId, 'room_id');
      const contract = await readContract(dataAccess, roomId);
      // Absence is JSON `null` (the wire contract), not an omitted key.
      return {
        status: 200,
        body: {
          room_id: roomId,
          contract: contract === null ? null : messageToWire(contract),
        },
      };
    },
  },
  {
    // Story 9.6 — the write seam's FIRST use. PATH-ONLY (the message `seq` is in the
    // path); no body is parsed. The acting `actor` is the operator handle the host holds.
    method: 'POST',
    pattern: '/api/rooms/:roomId/messages/:seq/react',
    handler: async (params, { dataAccess, operatorHandle }) => {
      // The `roomId` is validated for shape (consistency with the read routes) but core
      // resolves the message from its `seq` alone; the room in the path is the addressing
      // context the UI used. A malformed slug/seq is a 400 (the `Malformed ` guard).
      requireSlug(params.roomId, 'room_id');
      const seq = requireSeq(params.seq);
      const actor = requireOperator(operatorHandle);
      const result = await react(dataAccess, actor, seq);
      return {
        status: 200,
        body: { message_seq: result.messageSeq, reactions: result.reactions },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/rooms/:roomId/messages/:seq/unreact',
    handler: async (params, { dataAccess, operatorHandle }) => {
      requireSlug(params.roomId, 'room_id');
      const seq = requireSeq(params.seq);
      const actor = requireOperator(operatorHandle);
      const result = await unreact(dataAccess, actor, seq);
      return {
        status: 200,
        body: { message_seq: result.messageSeq, reactions: result.reactions },
      };
    },
  },
  {
    // Story 9.7 — `[ join room to post ]` → join the SUB-BOARD (membership). NOT room
    // participation (the board has no standalone "join this room" op — see the header's
    // Design reconciliation); room participation is GRANTED by the SEND (reply) below.
    // PATH-only (no body): the project id is in the path; the actor is the operator. An
    // unknown board → BOARD_NOT_FOUND → 404. Idempotent (joinBoard is a no-op re-join).
    method: 'POST',
    pattern: '/api/projects/:projectId/join',
    handler: async (params, { dataAccess, operatorHandle }) => {
      const projectId = requireSlug(params.projectId, 'project_id');
      const actor = requireOperator(operatorHandle);
      const project = await joinBoard(dataAccess, actor, projectId);
      return { status: 200, body: { project: projectToWire(project) } };
    },
  },
  {
    // Story 9.7 — SEND a message → core `reply` (the SAME op an agent uses; no operator
    // backdoor). Grant-on-act: the operator's reply makes them a ROOM PARTICIPANT (and a
    // sub-board member, idempotently), so after the first send 👍/add_participant light up.
    // BODY-carrying: `{ body }` (the reply text). The core 256 KB cap applies → BODY_TOO_LARGE
    // → 413. Unknown room → ROOM_NOT_FOUND → 404. Returns the (now-active) room.
    method: 'POST',
    pattern: '/api/rooms/:roomId/reply',
    handler: async (params, { dataAccess, operatorHandle, body }) => {
      const roomId = requireSlug(params.roomId, 'room_id');
      const actor = requireOperator(operatorHandle);
      const replyBody = requireBodyString(body, 'body');
      const room = await reply(dataAccess, actor, { roomId, body: replyBody });
      return { status: 200, body: { room: roomToWire(room) } };
    },
  },
  {
    // Story 9.7 — pull another peer into the room (`add_participant`). GATES on the operator
    // already being a ROOM PARTICIPANT (core throws NOT_A_MEMBER → 403 otherwise) — so this
    // lights up only AFTER the operator's first reply (or if they were add_participant'd).
    // BODY-carrying: `{ handle }` (the target). Unknown target → HANDLE_NOT_FOUND → 404.
    method: 'POST',
    pattern: '/api/rooms/:roomId/participants',
    handler: async (params, { dataAccess, operatorHandle, body }) => {
      const roomId = requireSlug(params.roomId, 'room_id');
      const actor = requireOperator(operatorHandle);
      const handle = requireBodyString(body, 'handle');
      const result = await addParticipant(dataAccess, actor, {
        roomId,
        handle,
      });
      return {
        status: 200,
        body: {
          room: roomToWire(result.room),
          participants: result.participants,
        },
      };
    },
  },
  {
    // Story 9.11 — START A NEGOTIATION (announce a project). The operator INITIATE surface,
    // over the SAME core `announceProject` an agent uses (no operator backdoor). BODY-carrying:
    // `{ title, description }`. Core appends `project.announced` + the operator's `board.joined`
    // ATOMICALLY (announcer = first member); a duplicate title OR derived slug → PROJECT_EXISTS
    // → 409 (nothing appended, atomic rollback). A watching-only host → 403 NO_OPERATOR.
    method: 'POST',
    pattern: '/api/projects',
    handler: async (_params, { dataAccess, operatorHandle, body }) => {
      const actor = requireOperator(operatorHandle);
      const title = requireBodyString(body, 'title');
      const description = requireBodyString(body, 'description');
      const project = await announceProject(dataAccess, actor, {
        title,
        description,
      });
      return { status: 200, body: { project: projectToWire(project) } };
    },
  },
  {
    // Story 9.11 — OPEN A ROOM (post an announcement into a member project). The SAME core
    // `postAnnouncement` an agent uses. BODY-carrying: `{ subject, body }`. Core runs the
    // membership gate FIRST → BOARD_NOT_FOUND (404) unknown board / NOT_A_MEMBER (403)
    // non-member (the AC2 join-first-handoff trigger — it does NOT auto-join), THEN the body
    // cap → BODY_TOO_LARGE (413) over-cap, THEN appends `announcement.posted`. A watching-only
    // host → 403 NO_OPERATOR. The host re-implements NONE of these gates.
    method: 'POST',
    pattern: '/api/projects/:projectId/announcements',
    handler: async (params, { dataAccess, operatorHandle, body }) => {
      const projectId = requireSlug(params.projectId, 'project_id');
      const actor = requireOperator(operatorHandle);
      const subject = requireBodyString(body, 'subject');
      const announcementBody = requireBodyString(body, 'body');
      const room = await postAnnouncement(dataAccess, actor, {
        projectId,
        subject,
        body: announcementBody,
      });
      return { status: 200, body: { room: roomToWire(room) } };
    },
  },
];

/** Map a closed BoardError code to its HTTP status. */
function statusForCode(code: string): number {
  switch (code) {
    case 'ROOM_NOT_FOUND':
    case 'BOARD_NOT_FOUND':
    case 'HANDLE_NOT_FOUND':
    case 'MESSAGE_NOT_FOUND':
    case 'LOGIN_UNKNOWN':
      return 404;
    case 'NO_IDENTITY':
      return 401;
    case 'NOT_A_MEMBER':
      return 403;
    case 'BODY_TOO_LARGE':
      return 413;
    case 'HANDLE_TAKEN':
    case 'PROJECT_EXISTS':
      return 409;
    default:
      return 400;
  }
}

/** Match a request path against a route pattern, capturing `:name` segments. */
function matchPattern(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter((p) => p.length > 0);
  const pathParts = path.split('/').filter((p) => p.length > 0);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [i, patternPart] of patternParts.entries()) {
    const pathPart = pathParts[i];
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
}

/**
 * Handle a JSON API request. Resolves the matching route, runs its handler, and maps
 * a thrown {@link BoardError} (or a malformed-slug rejection) to the uniform
 * `{ code, message }` body at the right HTTP status. Returns `null` if the path is not
 * an `/api/` route (the caller falls through to static serving / SPA fallback).
 *
 * @param method The request method (GET for reads; POST for the Story 9.6 react/unreact
 *   writes). A method that matches no route's `(method, pattern)` pair → 404 NOT_FOUND.
 * @param path The request URL pathname (query stripped by the caller).
 * @param dataAccess The persistence port handlers delegate to.
 * @param operatorHandle The resolved operator handle, or `null` (watching-only — the
 *   default). Personalizes `/api/me` + `/api/needs-you`; global read is unaffected.
 * @param body The parsed JSON request body for a body-carrying WRITE (Story 9.7 reply/
 *   add_participant), or `undefined` (a GET or a PATH-only write). `server.ts` parses +
 *   size-bounds the raw request stream and passes the result here; an unparseable body is a
 *   400 raised in `server.ts` BEFORE this is called. A required-but-missing field is the
 *   handler's own 400 (`requireBodyString`).
 * @returns A {@link JsonResponse}, or `null` when `path` is not an API route.
 */
export async function handleApiRequest(
  method: string,
  path: string,
  dataAccess: DataAccess,
  operatorHandle: string | null = null,
  body: RequestBody = undefined,
): Promise<JsonResponse | null> {
  if (!path.startsWith('/api/') && path !== '/api') {
    return null;
  }

  const ctx: ApiContext = { dataAccess, operatorHandle, body };

  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const params = matchPattern(route.pattern, path);
    if (params === null) continue;
    try {
      return await route.handler(params, ctx);
    } catch (error: unknown) {
      // A host-surface error (e.g. NO_OPERATOR on a write) carries its own status + code.
      if (error instanceof HostApiError) {
        return errorResponse(error.status, error.code, error.message);
      }
      if (error instanceof BoardError) {
        // A malformed-slug / malformed-seq guard reuses a closed code but is a client
        // 400; a real not-found is 404. Distinguish by the message prefix the guard sets.
        const isMalformed = error.message.startsWith('Malformed ');
        const status = isMalformed ? 400 : statusForCode(error.code);
        return errorResponse(status, error.code, error.message);
      }
      // Never leak internals to the wire (defensive — core reads should not throw
      // non-BoardError, but a corrupt ledger / IO error could).
      return errorResponse(
        500,
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Unexpected host error.',
      );
    }
  }

  // An /api/ path that matched no route (or wrong method) is a 404 NOT_FOUND.
  return errorResponse(404, 'NOT_FOUND', `No API route for ${method} ${path}.`);
}
