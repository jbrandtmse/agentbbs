// Story 10.7, AC1/AC2/AC3 — the in-host COMPOSE-PANEL probe (runs INSIDE the real VS Code Electron
// host). The Rule-12 real-runtime evidence that:
//   - AC2: `ComposePanelManager.open` creates a GENUINE `vscode.window.createWebviewPanel` (a real
//     WebviewPanel + webview + cspSource + asWebviewUri), and opening a DIFFERENT initiate surface
//     REVEALS+SWAPS the ONE panel (native panel-exclusivity — never a second panel);
//   - AC1: each of the 4 INITIATE bridge writes (announceProject / postAnnouncement / joinBoard /
//     updateFocus) LANDS in the ledger, asserted OUT-OF-BAND via a fresh data-access read (NOT the
//     write's own return), over the REAL node:sqlite handle through the panel's bridge dispatch;
//   - AC3 (Rule 15 both directions): a posted announcement appears as a NAVIGABLE PROTO-ROOM (it is
//     in listAnnouncements AND the tree model renders it as a navigable pending row the operator can
//     open + reply-to-activate) — proven by activating it through the SAME core reply. The MUTATION-
//     non-vacuity of "navigable, not just counted" is enforced below (assert the row is selectable,
//     not merely that the count incremented);
//   - the operator GATE: a watching-only write (no operator handle) yields the host-surface
//     NO_OPERATOR (BEFORE core) — the consistent gate.
//
// It bundles @agentbbs/core + @agentbbs/data-access + the ComposePanelManager + buildTreeModel (the
// SAME host-side code the extension wires) — see build-host-tests.cjs. Writes findings to
// AGENTBBS_PROBE_OUT for the runner to assert out-of-band.

import { writeFileSync } from 'node:fs';

import { announceProject, register } from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import * as vscode from 'vscode';

import { ComposePanelManager, type ComposeKind } from '../src/compose-panel.js';
import { dispatchRequest } from '../src/bridge.js';
import { buildTreeModel } from '../src/tree/tree-model.js';
import { webviewThemeKind } from '../src/webview/theme-kind.js';

export async function run(): Promise<void> {
  const out = process.env.AGENTBBS_PROBE_OUT;
  const result: {
    opened: boolean;
    electron: string | null;
    node: string | null;
    panelCreated: boolean;
    singlePanelReused: boolean;
    htmlHasComposeKind: boolean;
    htmlHasNonceCsp: boolean;
    htmlNoUnsafe: boolean;
    // AC1 — each of the 4 writes LANDS in the ledger (out-of-band).
    announceLanded: boolean;
    postAnnouncementLanded: boolean;
    joinBoardLanded: boolean;
    updateFocusLanded: boolean;
    // AC3 — the posted announcement is a NAVIGABLE proto-room (not just counted) + reply-activates.
    protoRoomNavigable: boolean;
    protoRoomActivatesByReply: boolean;
    // The operator gate (consistent host-surface code).
    watchingOnlyGated: boolean;
    error: string | null;
  } = {
    opened: false,
    electron: process.versions.electron || null,
    node: process.versions.node || null,
    panelCreated: false,
    singlePanelReused: false,
    htmlHasComposeKind: false,
    htmlHasNonceCsp: false,
    htmlNoUnsafe: false,
    announceLanded: false,
    postAnnouncementLanded: false,
    joinBoardLanded: false,
    updateFocusLanded: false,
    protoRoomNavigable: false,
    protoRoomActivatesByReply: false,
    watchingOnlyGated: false,
    error: null,
  };

  let dataAccess: ReturnType<typeof createDataAccessNodeSqlite> | undefined;
  const createdPanels: vscode.WebviewPanel[] = [];
  try {
    dataAccess = createDataAccessNodeSqlite();
    result.opened = true;

    // Seed: the operator identity (the INITIATE actor) + a second peer who owns a foreign project
    // (so joinBoard has a real board to join).
    await register(dataAccess, { handle: 'operator', currentFocus: 'leading' });
    await register(dataAccess, { handle: 'alice', currentFocus: 'owning' });
    const foreign = await announceProject(dataAccess, 'alice', {
      title: 'Foreign Project',
      description: 'alice owns this; the operator will join it',
    });

    const extUri = vscode.Uri.file(process.cwd());
    const distRoot = vscode.Uri.joinPath(extUri, 'dist');
    const manager = new ComposePanelManager({
      dataAccess,
      assetUris: {
        script: vscode.Uri.joinPath(distRoot, 'webview', 'compose.js'),
        styles: [vscode.Uri.joinPath(distRoot, 'webview', 'compose.css')],
      },
      iconPath: new vscode.ThemeIcon('edit'),
      resolveOperatorHandle: () => 'operator',
      resolveThemeKind: () =>
        webviewThemeKind(vscode.window.activeColorTheme.kind),
      createPanel: (title) => {
        const panel = vscode.window.createWebviewPanel(
          'agentbbs.compose',
          title,
          vscode.ViewColumn.Active,
          { enableScripts: true, localResourceRoots: [distRoot] },
        );
        createdPanels.push(panel);
        return panel as unknown as never;
      },
    });

    // AC2 — open the create-project surface: a genuine WebviewPanel with a real webview.
    manager.open('create-project');
    result.panelCreated = createdPanels.length === 1;
    const panel = createdPanels[0];
    const html = panel.webview.html;
    result.htmlHasComposeKind = html.includes(
      'data-compose-kind="create-project"',
    );
    result.htmlHasNonceCsp =
      html.includes('Content-Security-Policy') && html.includes('nonce-');
    result.htmlNoUnsafe =
      !html.includes('unsafe-inline') && !html.includes('unsafe-eval');

    // Native panel-exclusivity: opening a DIFFERENT surface REUSES the ONE panel (no second panel).
    for (const kind of [
      'focus',
      'join-project',
      'post-announcement',
    ] as ComposeKind[]) {
      manager.open(
        kind,
        kind === 'post-announcement' ? 'operator-project' : null,
      );
    }
    result.singlePanelReused = createdPanels.length === 1;

    // --- AC1: each of the 4 writes LANDS (driven over the bridge dispatch — the exact path the
    // panel's bridge uses for an inbound request — against the REAL node:sqlite handle). ---

    // announceProject → a new project the operator owns.
    const ann = await dispatchRequest(dataAccess, {
      id: 'w1',
      op: 'announceProject',
      args: {
        actor: 'operator',
        title: 'Operator Project',
        description: 'started from the editor',
      },
    });
    const operatorProjectId = (
      ann.result as { project: { projectId: string } } | undefined
    )?.project.projectId;
    {
      // OUT-OF-BAND: the project.announced event for the operator's new project is in the ledger.
      // The folded Event nests its fields under `.payload` (a discriminated union over `type`).
      const events = await dataAccess.eventsSince(0);
      result.announceLanded =
        ann.ok === true &&
        events.some(
          (e) =>
            e.type === 'project.announced' &&
            (e.payload as { projectId?: string }).projectId ===
              operatorProjectId,
        );
    }

    // postAnnouncement → a proto-room in the operator's own project (they are a member as announcer).
    const post = await dispatchRequest(dataAccess, {
      id: 'w2',
      op: 'postAnnouncement',
      args: {
        actor: 'operator',
        projectId: operatorProjectId,
        subject: 'Need a hand',
        body: 'who can take this?',
      },
    });
    const protoRoomId = (
      post.result as { room: { roomId: string } } | undefined
    )?.room.roomId;
    {
      // OUT-OF-BAND: the proto-room is in listAnnouncements for the operator's project (a fresh
      // read, not the write's own return) — non-vacuous (a fabricated return would not appear here).
      const anns = await dispatchRequest(dataAccess, {
        id: 'w2b',
        op: 'listAnnouncements',
        args: { projectId: operatorProjectId },
      });
      result.postAnnouncementLanded =
        post.ok === true &&
        typeof protoRoomId === 'string' &&
        (
          anns.result as { announcements: Array<{ roomId: string }> }
        ).announcements.some((r) => r.roomId === protoRoomId);
    }

    // joinBoard → the operator joins alice's foreign project (membership lands out-of-band).
    const join = await dispatchRequest(dataAccess, {
      id: 'w3',
      op: 'joinBoard',
      args: { actor: 'operator', projectId: foreign.projectId },
    });
    {
      const members = await dispatchRequest(dataAccess, {
        id: 'w3b',
        op: 'boardDirectory',
        args: { projectId: foreign.projectId },
      });
      result.joinBoardLanded =
        join.ok === true &&
        (members.result as { members: Array<{ handle: string }> }).members.some(
          (m) => m.handle === 'operator',
        );
    }

    // updateFocus → the operator's focus updates (a real identity.focus_updated lands).
    const focus = await dispatchRequest(dataAccess, {
      id: 'w4',
      op: 'updateFocus',
      args: { actor: 'operator', focus: 'reviewing the bridge' },
    });
    {
      const events = await dataAccess.eventsSince(0);
      result.updateFocusLanded =
        focus.ok === true &&
        events.some((e) => e.type === 'identity.focus_updated');
    }

    // --- AC3 (Rule 15 both directions): the posted announcement is a NAVIGABLE proto-room, NOT just
    // a count. Build the tree model (the SAME builder the BoardTreeProvider presents) for the
    // operator and assert the proto-room is a SELECTABLE pending row (carrying the open path), then
    // ACTIVATE it through the SAME core reply — closing the initiate→respond loop in one surface. ---
    if (typeof protoRoomId === 'string') {
      const model = await buildTreeModel(dataAccess, 'operator');
      const project = model.projects.find(
        (p) => p.projectId === operatorProjectId,
      );
      const protoRow = project?.rooms.find((r) => r.roomId === protoRoomId);
      // NAVIGABLE (mutation-target): the row EXISTS as a pending row with the room id (so the tree
      // renders it as a selectable open-command row) — NOT merely that announcementCount > 0.
      result.protoRoomNavigable =
        protoRow !== undefined &&
        protoRow.pending === true &&
        protoRow.roomId === protoRoomId;

      // The respond half: a reply through the bridge ACTIVATES the proto-room (active:false → true),
      // asserted OUT-OF-BAND.
      const before = await dispatchRequest(dataAccess, {
        id: 'rb',
        op: 'readRoom',
        args: { roomId: protoRoomId },
      });
      const wasInactive =
        (before.result as { room: { active: boolean } }).room.active === false;
      const reply = await dispatchRequest(dataAccess, {
        id: 'rr',
        op: 'reply',
        args: {
          actor: 'alice',
          roomId: protoRoomId,
          body: 'I will take this.',
        },
      });
      const after = await dispatchRequest(dataAccess, {
        id: 'ra',
        op: 'readRoom',
        args: { roomId: protoRoomId },
      });
      const nowActive =
        (after.result as { room: { active: boolean } }).room.active === true;
      result.protoRoomActivatesByReply =
        wasInactive && reply.ok === true && nowActive;
    }

    // The operator GATE: a watching-only write (no actor) → host-surface NO_OPERATOR (BEFORE core).
    const gated = await dispatchRequest(dataAccess, {
      id: 'g1',
      op: 'announceProject',
      args: { title: 'No Actor', description: 'watching-only' },
    });
    result.watchingOnlyGated =
      gated.ok === false && gated.error?.code === 'NO_OPERATOR';

    manager.dispose();
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    for (const p of createdPanels) {
      try {
        p.dispose();
      } catch {
        /* harmless on teardown */
      }
    }
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
    !result.panelCreated ||
    !result.singlePanelReused ||
    !result.htmlHasComposeKind ||
    !result.htmlHasNonceCsp ||
    !result.htmlNoUnsafe ||
    !result.announceLanded ||
    !result.postAnnouncementLanded ||
    !result.joinBoardLanded ||
    !result.updateFocusLanded ||
    !result.protoRoomNavigable ||
    !result.protoRoomActivatesByReply ||
    !result.watchingOnlyGated
  ) {
    throw new Error(
      `COMPOSE-PANEL PROBE FAILED in the Electron host — ${JSON.stringify(result)}`,
    );
  }
}
