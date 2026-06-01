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
//   GET /api/rooms/:roomId              → { room, messages }
//   GET /api/rooms/:roomId/contract     → { room_id, contract }
// The route table maps cleanly to the remaining read ops (read-room / read-contract /
// list-* already wired); WRITE endpoints (reply / react / add_participant / join) are
// NOT built here — they land with Stories 9.6/9.7. The dispatch table is the documented
// extension seam: a write route slots in as a new `{ method:'POST', pattern, handler }`
// entry. Do NOT add writes now.
//
// ERROR MODEL: core throws BoardError(code, message); the host maps each closed code to
// an HTTP status + the uniform `{ code, message }` body (the same closed contract the
// MCP surface exposes, mapped to a different transport). A *_NOT_FOUND code → 404; an
// unknown route → 404 with NOT_FOUND; anything unexpected → 500 INTERNAL_ERROR. Success
// returns the value directly (no { data } envelope), snake_case, real arrays/booleans,
// `null` for absence — the wire contract.

import {
  BoardError,
  boardDirectory,
  listAnnouncements,
  listProjects,
  listRooms,
  readContract,
  readRoom,
} from '@agentbbs/core';

import {
  memberToWire,
  messageToWire,
  projectToWire,
  roomToWire,
} from './wire.js';

import type { DataAccess } from '@agentbbs/core';

/** A slug param (project_id / room_id) — the shape core read ops expect. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The JSON body + HTTP status a route handler resolves to. */
export interface JsonResponse {
  status: number;
  /** A JSON-serializable value (object). */
  body: unknown;
}

/** A matched route handler: receives the captured path params + the data-access port. */
type RouteHandler = (
  params: Record<string, string>,
  dataAccess: DataAccess,
) => Promise<JsonResponse>;

/** One route in the dispatch table. `pattern` segments may be `:name` captures. */
interface Route {
  method: 'GET';
  /** Path template, e.g. `/api/rooms/:roomId/contract`. */
  pattern: string;
  handler: RouteHandler;
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
 * The read-only route table. Each handler is THIN — it validates its params, calls a
 * core read op, and maps to the snake_case wire envelope mirroring the MCP contract.
 */
const ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: '/api/directory',
    handler: async (_params, dataAccess) => {
      const projects = await listProjects(dataAccess);
      return { status: 200, body: { projects: projects.map(projectToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects',
    handler: async (_params, dataAccess) => {
      const projects = await listProjects(dataAccess);
      return { status: 200, body: { projects: projects.map(projectToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:projectId/members',
    handler: async (params, dataAccess) => {
      const projectId = requireSlug(params.projectId, 'project_id');
      const members = await boardDirectory(dataAccess, projectId);
      return { status: 200, body: { members: members.map(memberToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:projectId/announcements',
    handler: async (params, dataAccess) => {
      const projectId = requireSlug(params.projectId, 'project_id');
      const rooms = await listAnnouncements(dataAccess, projectId);
      return { status: 200, body: { announcements: rooms.map(roomToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:projectId/rooms',
    handler: async (params, dataAccess) => {
      const projectId = requireSlug(params.projectId, 'project_id');
      const rooms = await listRooms(dataAccess, projectId);
      return { status: 200, body: { rooms: rooms.map(roomToWire) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/rooms/:roomId',
    handler: async (params, dataAccess) => {
      const roomId = requireSlug(params.roomId, 'room_id');
      const { room, messages } = await readRoom(dataAccess, roomId);
      return {
        status: 200,
        body: { room: roomToWire(room), messages: messages.map(messageToWire) },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/rooms/:roomId/contract',
    handler: async (params, dataAccess) => {
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
 * @param method The request method (only GET is served in 9.3).
 * @param path The request URL pathname (query stripped by the caller).
 * @param dataAccess The persistence port handlers delegate to.
 * @returns A {@link JsonResponse}, or `null` when `path` is not an API route.
 */
export async function handleApiRequest(
  method: string,
  path: string,
  dataAccess: DataAccess,
): Promise<JsonResponse | null> {
  if (!path.startsWith('/api/') && path !== '/api') {
    return null;
  }

  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const params = matchPattern(route.pattern, path);
    if (params === null) continue;
    try {
      return await route.handler(params, dataAccess);
    } catch (error: unknown) {
      if (error instanceof BoardError) {
        // A malformed-slug guard reuses BOARD_NOT_FOUND but is a client 400; a real
        // not-found is 404. Distinguish by the message prefix the guard sets.
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
