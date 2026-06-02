// The room browse read operations (Story 4.2, Task 2 / AC #1, #2, #3).
//
// `listAnnouncements` and `listRooms` are the read surfaces the two browse tools
// (`list_announcements` / `list_rooms`) consume. They split the rooms projection for a
// sub-board into the two views FR9 makes board-wide readable:
//   - listAnnouncements → the PROTO-rooms (announcements with NO reply yet, `active=false`)
//   - listRooms         → the ACTIVATED rooms (≥1 reply exists, `active=true`)
// Both are scoped to one `projectId` and ordered by `seq` ascending (announcement order;
// NEVER `createdAt`). The activation flag itself is derived by the Story 4.2 `foldRooms`
// read-model (a room is active iff ≥1 `room.replied` for it exists); these ops only FILTER
// the fold — they neither compute activation nor know about replies.
//
// THIN reads: each reads the full event stream once via the DataAccess port
// (`eventsSince(0)`, already `seq`-ordered), resolves the board via the Story 3.1
// `findProject` (BOARD_NOT_FOUND if absent — the same existence-check `boardDirectory`
// uses, so a typo'd board id is a clear error, not a silently-empty list), folds the
// rooms directory ONCE via `foldRooms` (NEVER duplicated here — the fold is the one source
// of truth for the room shape + activation), filters to this board + the requested active
// flag, and returns the records `seq`-sorted. Derived state, NEVER stored (THE APPEND
// INVARIANT): the directory is recomputed from events every call; there is no `rooms`
// table.
//
// Session-agnostic: NO `actor` param — the only identity precondition (an established
// identity; NO membership, this is an open read) is enforced at the MCP tool, not here.
// core stays session-agnostic, mirroring `listProjects` / `boardDirectory`.

import { findProject } from '../projects/projection.js';
import { foldRooms } from './projection.js';
import { BoardError } from '../errors.js';

import type { DataAccess } from '../ports.js';
import type { Room } from './projection.js';

/**
 * Read the rooms directory for one board, filtered to a requested `active` flag and
 * ordered by `seq` ascending. The shared core of {@link listAnnouncements} (active=false)
 * and {@link listRooms} (active=true): existence-check the board, fold the rooms once,
 * filter to `room.projectId === projectId` AND `room.active === active`, return seq-sorted.
 *
 * An unknown `projectId` (never announced) → `BoardError('BOARD_NOT_FOUND')` (AC #3) —
 * BEFORE any (empty) listing is returned, so a typo'd board is an explicit error.
 */
async function listRoomsByActive(
  dataAccess: DataAccess,
  projectId: string,
  active: boolean,
): Promise<Room[]> {
  const events = await dataAccess.eventsSince(0);

  // Existence-check the board FIRST (AC #3): an unknown board is BOARD_NOT_FOUND, not a
  // permissive empty list (which would hide a typo'd project_id). Mirrors boardDirectory.
  const project = findProject(events, projectId);
  if (project === undefined) {
    throw new BoardError(
      'BOARD_NOT_FOUND',
      `No sub-board with project_id "${projectId}" exists.`,
    );
  }

  // Fold the rooms directory once (the one source of truth for shape + activation), then
  // filter to THIS board and the requested active flag. Map iteration already preserves
  // announcement (=seq) order, but sort explicitly so the contract does not depend on Map
  // internals (matches listProjects).
  const directory = foldRooms(events);
  return [...directory.values()]
    .filter((room) => room.projectId === projectId && room.active === active)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * List a sub-board's ANNOUNCEMENTS — the proto-rooms with no reply yet (`active=false`) —
 * ordered by `seq` ascending (announcement order). The "open needs" view (AC #1): rooms a
 * member could pick up by replying. An unknown `projectId` → `BoardError('BOARD_NOT_FOUND')`
 * (AC #3). No membership is consulted — the listing is board-wide readable (FR9); the only
 * precondition (an established identity) is enforced by the MCP tool, not core.
 *
 * @param dataAccess The persistence port (the only dependency); `eventsSince(0)` returns
 *   ALL events `seq`-ordered.
 * @param projectId The slug id of the sub-board whose announcements to list.
 * @returns The proto-rooms (`active=false`) of the board as a `Room[]` sorted by `seq` asc.
 * @throws {BoardError} `BOARD_NOT_FOUND` if no project with `projectId` was announced.
 */
export async function listAnnouncements(
  dataAccess: DataAccess,
  projectId: string,
): Promise<Room[]> {
  return listRoomsByActive(dataAccess, projectId, false);
}

/**
 * List a sub-board's ROOMS — the activated rooms with ≥1 reply (`active=true`) — ordered by
 * `seq` ascending (announcement order). The "active conversations" view (AC #1): rooms a
 * reply has turned into a live thread. An unknown `projectId` → `BoardError('BOARD_NOT_FOUND')`
 * (AC #3). No membership is consulted — the listing is board-wide readable (FR9); the only
 * precondition (an established identity) is enforced by the MCP tool, not core.
 *
 * @param dataAccess The persistence port (the only dependency); `eventsSince(0)` returns
 *   ALL events `seq`-ordered.
 * @param projectId The slug id of the sub-board whose activated rooms to list.
 * @returns The activated rooms (`active=true`) of the board as a `Room[]` sorted by `seq` asc.
 * @throws {BoardError} `BOARD_NOT_FOUND` if no project with `projectId` was announced.
 */
export async function listRooms(
  dataAccess: DataAccess,
  projectId: string,
): Promise<Room[]> {
  return listRoomsByActive(dataAccess, projectId, true);
}
