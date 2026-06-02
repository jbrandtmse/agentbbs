// Story 10.4, AC1/AC2/AC4 — the in-host ROOM-PANEL probe (runs INSIDE the real VS Code Electron
// host). The Rule-12 real-runtime evidence that:
//   - AC1: `RoomPanelManager.openRoom` creates a GENUINE `vscode.window.createWebviewPanel` (a real
//     WebviewPanel with a real `webview` + `cspSource` + `asWebviewUri`), and re-opening the SAME
//     room REVEALS the existing panel (the map keeps ONE panel per room — no duplicate);
//   - AC2: the panel's HTML shell is set (nonce CSP, the bundle + theme CSS linked via asWebviewUri,
//     the mount root carrying the room id) — the data path the webview bundle mounts against;
//   - AC4 (Rule 15 respond-parity): a real `reply` through the panel's bridge ACTIVATES a
//     PROTO-ROOM — the room flips active:false → true, asserted OUT-OF-BAND via a fresh
//     data-access read (NOT the write's own return). The MUTATION-non-vacuity of this semantic is
//     proven in the headless tier (src/bridge.test.ts, Rule 7); here it is proven on the REAL host.
//
// It bundles @agentbbs/core + @agentbbs/data-access + the RoomPanelManager (the SAME host-side
// code the extension wires) — see build-host-tests.cjs. Writes findings to AGENTBBS_PROBE_OUT for
// the runner to assert out-of-band. The real WEBVIEW→host round-trip (the webview JS posting a
// readRoom request) needs the bundle loaded + the panel painted — that is the lead's
// chrome-devtools/manual smoke; here we assert the panel surface + drive the bridge dispatch over
// the REAL node:sqlite handle (proving the host path runs in-host) + the real reply activation.

import { writeFileSync } from 'node:fs';

import { announceProject, postAnnouncement, register } from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import * as vscode from 'vscode';

import { dispatchRequest } from '../src/bridge.js';
import { RoomPanelManager, type PanelLike } from '../src/room-panel.js';

export async function run(): Promise<void> {
  const out = process.env.AGENTBBS_PROBE_OUT;
  const result: {
    opened: boolean;
    electron: string | null;
    node: string | null;
    panelCreated: boolean;
    panelHasWebview: boolean;
    htmlHasNonceCsp: boolean;
    htmlHasRoomId: boolean;
    htmlNoUnsafe: boolean;
    revealNotDuplicate: boolean;
    protoInactiveBefore: boolean;
    activeAfterReply: boolean;
    activatedByOperator: boolean;
    error: string | null;
  } = {
    opened: false,
    electron: process.versions.electron || null,
    node: process.versions.node || null,
    panelCreated: false,
    panelHasWebview: false,
    htmlHasNonceCsp: false,
    htmlHasRoomId: false,
    htmlNoUnsafe: false,
    revealNotDuplicate: false,
    protoInactiveBefore: false,
    activeAfterReply: false,
    activatedByOperator: false,
    error: null,
  };

  let dataAccess: ReturnType<typeof createDataAccessNodeSqlite> | undefined;
  const createdPanels: vscode.WebviewPanel[] = [];
  try {
    dataAccess = createDataAccessNodeSqlite();
    result.opened = true;

    // Seed: a project + a PROTO-ROOM (announced, no reply yet → inactive), and a replier identity.
    await register(dataAccess, { handle: 'alice', currentFocus: 'seeding' });
    await register(dataAccess, {
      handle: 'operator',
      currentFocus: 'responding',
    });
    const project = await announceProject(dataAccess, 'alice', {
      title: 'In-Host Room Project',
      description: 'seeded inside the real VS Code Electron host',
    });
    const proto = await postAnnouncement(dataAccess, 'alice', {
      projectId: project.projectId,
      subject: 'Proto subject',
      body: 'A proto-room **announcement** with no reply yet.',
    });

    // The extension dir is the development path; resolve the (built) bundle/css refs the same way
    // extension.ts does — they need not exist on disk for asWebviewUri to produce a uri.
    const extUri = vscode.Uri.file(process.cwd());
    const distRoot = vscode.Uri.joinPath(extUri, 'dist');
    const manager = new RoomPanelManager({
      dataAccess,
      assetUris: {
        script: vscode.Uri.joinPath(distRoot, 'webview', 'main.js'),
        styles: [vscode.Uri.joinPath(distRoot, 'webview', 'main.css')],
      },
      iconPath: new vscode.ThemeIcon('comment-discussion'),
      resolveOperatorHandle: () => 'operator',
      createPanel: (roomId, title): PanelLike => {
        const panel = vscode.window.createWebviewPanel(
          'agentbbs.room',
          title,
          vscode.ViewColumn.Active,
          { enableScripts: true, localResourceRoots: [distRoot] },
        );
        createdPanels.push(panel);
        return panel as unknown as PanelLike;
      },
    });

    // AC1 — open the proto-room: a genuine WebviewPanel is created with a real webview.
    const panel = manager.openRoom(
      proto.roomId,
    ) as unknown as vscode.WebviewPanel;
    result.panelCreated = createdPanels.length === 1;
    result.panelHasWebview =
      typeof panel.webview === 'object' &&
      typeof panel.webview.cspSource === 'string' &&
      typeof panel.webview.asWebviewUri === 'function';

    // AC2 — the HTML shell: nonce CSP, the room id on the mount root, NO unsafe-inline/eval.
    const html = panel.webview.html;
    result.htmlHasNonceCsp =
      html.includes('Content-Security-Policy') && html.includes('nonce-');
    result.htmlHasRoomId = html.includes(`data-room-id="${proto.roomId}"`);
    result.htmlNoUnsafe =
      !html.includes('unsafe-inline') && !html.includes('unsafe-eval');

    // AC1 — re-open the SAME room: REVEAL, not a duplicate (still ONE created panel).
    manager.openRoom(proto.roomId);
    result.revealNotDuplicate =
      createdPanels.length === 1 && manager.openCount === 1;

    // AC4 — the proto-room is INACTIVE before any reply.
    const before = await dispatchRequest(dataAccess, {
      id: 'b',
      op: 'readRoom',
      args: { roomId: proto.roomId },
    });
    result.protoInactiveBefore =
      (before.result as { room: { active: boolean } } | undefined)?.room
        .active === false;

    // AC4 — a real reply through the panel's bridge ACTIVATES the proto-room (the Epic-4 min-seq
    // activator; the SAME core reply an agent uses). Dispatch through the bridge dispatcher over
    // the REAL node:sqlite handle (the exact path the panel's bridge uses for an inbound request).
    const replyRes = await dispatchRequest(dataAccess, {
      id: 'r',
      op: 'reply',
      args: {
        actor: 'operator',
        roomId: proto.roomId,
        body: 'I will take this.',
      },
    });
    if (!replyRes.ok) {
      throw new Error(
        `reply through the bridge failed: ${replyRes.error?.code ?? 'unknown'}`,
      );
    }

    // Assert ACTIVATION out-of-band via a fresh read (not the write's own return).
    const after = await dispatchRequest(dataAccess, {
      id: 'a',
      op: 'readRoom',
      args: { roomId: proto.roomId },
    });
    const room = (
      after.result as { room: { active: boolean; activatedBy?: string } }
    ).room;
    result.activeAfterReply = room.active === true;
    result.activatedByOperator = room.activatedBy === 'operator';

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
    !result.panelHasWebview ||
    !result.htmlHasNonceCsp ||
    !result.htmlHasRoomId ||
    !result.htmlNoUnsafe ||
    !result.revealNotDuplicate ||
    !result.protoInactiveBefore ||
    !result.activeAfterReply ||
    !result.activatedByOperator
  ) {
    throw new Error(
      `ROOM-PANEL PROBE FAILED in the Electron host — ${JSON.stringify(result)}`,
    );
  }
}
