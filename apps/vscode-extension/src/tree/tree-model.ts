// The native sidebar TREE MODEL builder (Story 10.3) — a PURE, vscode-free fold over the
// shared ledger that mirrors the web control room's navigation model
// (apps/web/src/api-client.ts#loadTreeModel). Kept separate from the `vscode`-facing
// BoardTreeProvider/decorations classes (which only PRESENT this model) so the load-bearing
// SELECTION/ORDERING logic — especially the Rule-15 proto-room-navigable contract — is
// testable in plain Node against a real in-memory data-access handle, exactly as the bridge's
// dispatch logic is testable without a real Webview.
//
// THIN CLIENT (Rule 13, LOAD-BEARING): this module composes EXISTING core read ops over the
// DataAccess seam (`listProjects`/`listRooms`/`listAnnouncements`/`needsYouRooms` +
// `roomJoinSeq`/`roomMessagesSince` for the unread derivation) and reimplements NO board
// fold/gate, fabricates NO op. The unread/needs state is derived from the SAME deterministic
// core projections the web tree uses:
//   - NEEDS YOU = the `needsYouRooms` escalation set (the deterministic
//     `add_participant(@operator)` signal — NOT a body-text `@mention` scan; item 9.4-mention
//     stays deferred, there is no structured marker).
//   - unread = a room has messages with `seq > roomJoinSeq(operator)` (the per-(identity,room)
//     join floor, Story 4.6) — the operator's "new since I joined", the SAME floor `check`
//     uses. A watching-only operator (no handle) or a room the operator never joined is calm
//     (unread=false, count=0) — nothing is "new" for nobody.
//
// `git diff HEAD -- packages/core packages/mcp-server` stays EMPTY: every projection lives in
// core already; this only arranges them into the tree shape.

import {
  listAnnouncements,
  listProjects,
  listRooms,
  needsYouRooms,
  roomJoinSeq,
  roomMessagesSince,
} from '@agentbbs/core';

import type { DataAccess, Event } from '@agentbbs/core';

/** A single room row in the tree — an ACTIVE room or a PENDING proto-room (Rule 15). */
export interface TreeRoomRow {
  /** The room's globally-unique slug id — the open-command argument + decoration key. */
  roomId: string;
  /** The room belongs to this project (sub-board). */
  projectId: string;
  /** The announcement subject line (the row label). */
  subject: string;
  /**
   * `true` iff this is a PENDING proto-room (an announced negotiation no one has replied to
   * yet — `listAnnouncements`, `active:false`). A pending row is a NAVIGABLE sibling of active
   * rooms (Rule 15 / AC2): the operator can open it, read the announcement, and reply to
   * ACTIVATE it via the existing core `reply` — it is NEVER merely folded into a count.
   */
  pending: boolean;
  /** `true` iff the operator was pulled into this room via `add_participant` (the NEEDS YOU set). */
  needsYou: boolean;
  /** `true` iff there are messages the operator has not seen (seq > their join floor). */
  unread: boolean;
  /** How many messages are new for the operator (seq > join floor). 0 when read / not joined. */
  unreadCount: number;
}

/** A project (sub-board) node — its active rooms first, then pending proto-rooms (stable order). */
export interface TreeProjectNode {
  /** The project's slug id. */
  projectId: string;
  /** The project title (the node label). */
  title: string;
  /**
   * The count for the `announcements (N)` indicator — the number of PROTO-ROOMS (announcements
   * with no reply yet). A SEPARATE indicator from the navigable proto-room rows (the web keeps
   * both; AC2 — do not collapse one into the other).
   */
  announcementCount: number;
  /** Active rooms first, then pending proto-rooms — a stable, de-duplicated order (Rule 15). */
  rooms: TreeRoomRow[];
}

/** A room reference in the NEEDS YOU escalation bucket (the Mode-B queue). */
export interface NeedsYouRoomRef {
  roomId: string;
  projectId: string;
  subject: string;
}

/** The full tree model — the operator's personalized navigation snapshot. */
export interface BoardTreeModel {
  /** The resolved operator handle, or `null` (watching-only — empty NEEDS YOU, global read works). */
  operatorHandle: string | null;
  /** The Mode-B escalation queue: rooms the operator was explicitly pulled into. */
  needsYou: NeedsYouRoomRef[];
  /** Every project (global read, FR28), each with its rooms. */
  projects: TreeProjectNode[];
}

/**
 * Build the full {@link BoardTreeModel} from the shared ledger, mirroring the web tree model.
 *
 * Reads (all EXISTING core ops over the DataAccess seam): every project (`listProjects`,
 * global read), then per project its ACTIVE rooms (`listRooms`) + its PROTO-ROOMS
 * (`listAnnouncements`, `active:false`). The two sets are disjoint by `active`, but we de-dup
 * by `roomId` DEFENSIVELY so an active room can NEVER also appear as a stale proto-row (the
 * web `activeRows`/`pendingRows` split). Active rows render first, then pending rows — a
 * stable order. The NEEDS YOU set (`needsYouRooms`) flags per-room + fills the bucket. Unread
 * is derived per room from the operator's join floor (`roomJoinSeq` + `roomMessagesSince`).
 *
 * @param dataAccess The persistence port (the host's node:sqlite-backed handle).
 * @param operatorHandle The resolved, canonical operator handle, or `null` (watching-only).
 */
export async function buildTreeModel(
  dataAccess: DataAccess,
  operatorHandle: string | null,
): Promise<BoardTreeModel> {
  // One stream read drives the unread fold (the per-room join floors); core's read ops each do
  // their own eventsSince(0) for their projection. This mirrors the web host's per-route reads.
  const events = operatorHandle === null ? [] : await dataAccess.eventsSince(0);

  const [projects, needsYou] = await Promise.all([
    listProjects(dataAccess),
    needsYouRooms(dataAccess, operatorHandle),
  ]);

  const needsYouRoomIds = new Set(needsYou.map((r) => r.roomId));

  const projectNodes: TreeProjectNode[] = await Promise.all(
    projects.map(async (project) => {
      const [active, announcements] = await Promise.all([
        listRooms(dataAccess, project.projectId),
        listAnnouncements(dataAccess, project.projectId),
      ]);

      const seenRoomIds = new Set<string>();

      // ACTIVE rooms first (rooms with ≥1 reply — `listRooms`, `active:true`).
      const activeRows: TreeRoomRow[] = active.map((room) => {
        seenRoomIds.add(room.roomId);
        return makeRoomRow(
          events,
          room,
          false,
          operatorHandle,
          needsYouRoomIds,
        );
      });

      // Then PENDING proto-rooms (announcements with no reply yet — `listAnnouncements`,
      // `active:false`) as SIBLING NAVIGABLE rows (Rule 15 / AC2). De-dup by roomId so an
      // active room never also appears as a stale proto-row.
      const pendingRows: TreeRoomRow[] = announcements
        .filter((room) => !seenRoomIds.has(room.roomId))
        .map((room) => {
          seenRoomIds.add(room.roomId);
          return makeRoomRow(
            events,
            room,
            true,
            operatorHandle,
            needsYouRoomIds,
          );
        });

      return {
        projectId: project.projectId,
        title: project.title,
        // The `announcements (N)` indicator counts the PROTO-ROOMS — distinct from the
        // navigable rows above (AC2: the count bucket and the navigable rows are not the
        // same thing; the web keeps both).
        announcementCount: announcements.length,
        rooms: [...activeRows, ...pendingRows],
      };
    }),
  );

  return {
    operatorHandle,
    needsYou: needsYou.map((r) => ({
      roomId: r.roomId,
      projectId: r.projectId,
      subject: r.subject,
    })),
    projects: projectNodes,
  };
}

/**
 * Build one room row, deriving the operator's unread state from the EXISTING core join-floor
 * projection (Rule 13 — no reimplemented fold). A watching-only operator (`null` handle) or a
 * room the operator never joined (`roomJoinSeq === undefined`) is calm: unread=false, count=0
 * — there is nothing "new" for nobody / for a non-participant (the same posture `check` takes).
 */
function makeRoomRow(
  events: Event[],
  room: { roomId: string; projectId: string; subject: string },
  pending: boolean,
  operatorHandle: string | null,
  needsYouRoomIds: Set<string>,
): TreeRoomRow {
  let unreadCount = 0;
  if (operatorHandle !== null) {
    const joinSeq = roomJoinSeq(events, room.roomId, operatorHandle);
    if (joinSeq !== undefined) {
      unreadCount = roomMessagesSince(events, room.roomId, joinSeq).length;
    }
  }
  return {
    roomId: room.roomId,
    projectId: room.projectId,
    subject: room.subject,
    pending,
    needsYou: needsYouRoomIds.has(room.roomId),
    unread: unreadCount > 0,
    unreadCount,
  };
}
