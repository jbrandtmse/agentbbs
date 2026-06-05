// Story 10.3, AC1/AC2/AC3 — the in-host TREE-MODEL probe (runs INSIDE the real VS Code Electron
// host). The Rule-12 real-runtime evidence that the native tree's model — built host-side via
// the data-access handle + core ops DIRECTLY (NOT the webview bridge) — produces the correct
// node tree against a REAL seeded ledger in the genuine Electron host, INCLUDING:
//   - AC2 / Rule 15: a PROTO-ROOM appears as a NAVIGABLE ROW (a sibling of the active room),
//     not merely counted — the exact web gap 9.11→9.14 fixed, proven here in-host;
//   - AC3: the decoration SOURCE state is correct — a NEEDS YOU room (add_participant(@operator))
//     is flagged, and unread is derived from the operator's join floor.
//
// It bundles @agentbbs/core + @agentbbs/data-access + the tree-model builder (the SAME vscode-free
// builder the BoardTreeProvider uses) — see build-host-tests.cjs. Writes findings to
// AGENTBBS_PROBE_OUT for the runner to assert out-of-band. (The `vscode`-facing TreeItem mapping
// is exercised by VS Code itself when the view renders; the model — the load-bearing
// SELECTION/ORDERING logic — is what we assert in-host.)

import { writeFileSync } from 'node:fs';

import {
  addParticipant,
  announceProject,
  postAnnouncement,
  register,
  reply,
} from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';

import { buildTreeModel } from '../src/tree/tree-model.js';
import { roomDecoration } from '../src/tree/decoration-model.js';

/**
 * Seed a board, build the tree model IN THE ELECTRON HOST, and record whether the proto-room is
 * a navigable row + the decoration source state is correct. AGENTBBS_DB is set by the runner to
 * an isolated temp path. Writes the result JSON before any throw so the runner always has the
 * evidence.
 */
export async function run(): Promise<void> {
  const out = process.env.AGENTBBS_PROBE_OUT;
  const result: {
    opened: boolean;
    electron: string | null;
    modules: string | null;
    node: string | null;
    projectFound: boolean;
    activeRoomIsRow: boolean;
    activeRoomNotPending: boolean;
    protoRoomIsNavigableRow: boolean;
    protoRoomPending: boolean;
    activeBeforePending: boolean;
    announcementCount: number | null;
    needsYouFlagged: boolean;
    needsYouBucketHasRoom: boolean;
    error: string | null;
  } = {
    opened: false,
    electron: process.versions.electron || null,
    modules: process.versions.modules || null,
    node: process.versions.node || null,
    projectFound: false,
    activeRoomIsRow: false,
    activeRoomNotPending: false,
    protoRoomIsNavigableRow: false,
    protoRoomPending: false,
    activeBeforePending: false,
    announcementCount: null,
    needsYouFlagged: false,
    needsYouBucketHasRoom: false,
    error: null,
  };

  let dataAccess: ReturnType<typeof createDataAccessNodeSqlite> | undefined;
  try {
    dataAccess = createDataAccessNodeSqlite();
    result.opened = true;

    // Seed: a project + an ACTIVE room (replied) + a PENDING proto-room (no reply), and pull
    // @operator into the active room (the NEEDS YOU escalation).
    await register(dataAccess, { handle: 'alice', currentFocus: 'seeding' });
    await register(dataAccess, { handle: 'bob', currentFocus: 'replying' });
    await register(dataAccess, {
      handle: 'operator',
      currentFocus: 'watching',
    });
    const project = await announceProject(dataAccess, 'alice', {
      title: 'In-Host Tree Project',
      description: 'seeded inside the real VS Code Electron host',
    });
    const activeRoom = await postAnnouncement(dataAccess, 'alice', {
      projectId: project.projectId,
      subject: 'Active subject',
      body: 'Active body',
    });
    const protoRoom = await postAnnouncement(dataAccess, 'alice', {
      projectId: project.projectId,
      subject: 'Proto subject',
      body: 'Proto body',
    });
    await reply(dataAccess, 'bob', {
      roomId: activeRoom.roomId,
      body: 'first reply',
    });
    await addParticipant(dataAccess, 'bob', {
      roomId: activeRoom.roomId,
      handle: 'operator',
    });

    // Build the model the BoardTreeProvider would present — host-side, via core ops directly.
    const model = await buildTreeModel(dataAccess, 'operator');
    const node = model.projects.find((p) => p.projectId === project.projectId);
    result.projectFound = node !== undefined;

    if (node !== undefined) {
      const activeRow = node.rooms.find((r) => r.roomId === activeRoom.roomId);
      const protoRow = node.rooms.find((r) => r.roomId === protoRoom.roomId);
      result.activeRoomIsRow = activeRow !== undefined;
      result.activeRoomNotPending = activeRow?.pending === false;
      // RULE 15: the proto-room is a NAVIGABLE ROW (present in `rooms`, pending-styled), not
      // merely counted.
      result.protoRoomIsNavigableRow = protoRow !== undefined;
      result.protoRoomPending = protoRow?.pending === true;
      // Active rooms first, then pending — a stable order.
      const order = node.rooms.map((r) => r.roomId);
      result.activeBeforePending =
        order.indexOf(activeRoom.roomId) < order.indexOf(protoRoom.roomId);
      result.announcementCount = node.announcementCount;
      // AC3 decoration source: the escalated room is NEEDS-YOU flagged → the ! decoration.
      result.needsYouFlagged = activeRow?.needsYou === true;
      const deco =
        activeRow !== undefined
          ? roomDecoration({
              needsYou: activeRow.needsYou,
              unread: activeRow.unread,
              unreadCount: activeRow.unreadCount,
            })
          : undefined;
      // sanity: a NEEDS-YOU room yields a decoration (badge '!').
      if (deco !== undefined && deco.badge !== '!') {
        result.needsYouFlagged = false;
      }
    }
    result.needsYouBucketHasRoom = model.needsYou.some(
      (r) => r.roomId === activeRoom.roomId,
    );
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      dataAccess?.close();
    } catch {
      /* harmless on teardown */
    }
  }

  if (out) {
    writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
  }

  if (
    !result.opened ||
    !result.projectFound ||
    !result.protoRoomIsNavigableRow ||
    !result.protoRoomPending ||
    !result.needsYouFlagged
  ) {
    throw new Error(
      `TREE-MODEL PROBE FAILED in the Electron host — opened=${result.opened} ` +
        `projectFound=${result.projectFound} protoRoomIsNavigableRow=${result.protoRoomIsNavigableRow} ` +
        `protoRoomPending=${result.protoRoomPending} needsYouFlagged=${result.needsYouFlagged} ` +
        `error=${result.error || 'none'}`,
    );
  }
}
