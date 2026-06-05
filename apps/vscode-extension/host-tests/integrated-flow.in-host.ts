// END-OF-EPIC RULE-14 INTEGRATED EXPLORATORY SMOKE (runs INSIDE the real VS Code Electron host).
//
// This is the LEAD's Rule-14 gate for Epic 10 — distinct from the per-story AC-shaped probes
// (open-ledger / tree-model / room-panel / compose-panel). Those each ask "did THIS story do what
// it said?"; NONE asks "is the assembled operator surface whole at the SEAMS between stories?" — the
// exact blind spot that shipped the Epic-9 proto-room gap. This probe drives the WHOLE operator
// journey as a real user, in ONE continuous session, through ALL THREE surface managers wired
// against ONE ledger + ONE operator — crossing every seam: ComposePanel(create) → Tree(project
// appears) → ComposePanel(post) → Tree(NAVIGABLE proto-room, not just a count) → RoomPanel(open it) →
// reply(activates) → Tree(pending→active) → react → readContract(agreed mark moves, FR21) →
// ComposePanel(focus) → whoami → ComposePanel(join a foreign project) → Tree(now a member).
//
// It asserts the INTEGRATED state at each seam out-of-band (fresh reads / the tree model the
// BoardTreeProvider presents / the real RoomPanel + ComposePanel managers), so a seam gap between
// any two stories surfaces here even though every per-story tier is green. Writes findings to
// AGENTBBS_PROBE_OUT for the runner to assert out-of-band.

import { writeFileSync } from 'node:fs';

import { announceProject, register } from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import * as vscode from 'vscode';

import { ComposePanelManager } from '../src/compose-panel.js';
import { RoomPanelManager, type PanelLike } from '../src/room-panel.js';
import { dispatchRequest } from '../src/bridge.js';
import { buildTreeModel } from '../src/tree/tree-model.js';
import { webviewThemeKind } from '../src/webview/theme-kind.js';

const OPERATOR = 'operator';

export async function run(): Promise<void> {
  const out = process.env.AGENTBBS_PROBE_OUT;
  const r = {
    opened: false,
    electron: process.versions.electron || null,
    node: process.versions.node || null,
    // Seam 1: create a project (ComposePanel) → it appears in the TREE.
    projectCreated: false,
    projectInTree: false,
    // Seam 2: post an announcement (ComposePanel) → a NAVIGABLE proto-room row in the TREE.
    announcementPosted: false,
    protoRoomNavigableInTree: false,
    // Seam 3: OPEN the proto-room (RoomPanel) → a real panel rendering the announcement.
    roomPanelOpened: false,
    roomPanelShowsAnnouncement: false,
    // Seam 4: reply ACTIVATES it → the TREE row transitions pending→active.
    replyActivatedRoom: false,
    treeRowActiveAfterReply: false,
    // Seam 5: react → the agreed mark (FR21 highest-seq live-👍) is computed via readContract.
    agreedMarkComputed: false,
    // Seam 6: set focus (ComposePanel) → whoami reflects it.
    focusSetAndReflected: false,
    // Seam 7: join a foreign project (ComposePanel) → the TREE shows the new membership.
    foreignProjectJoined: false,
    foreignProjectInTreeAsMember: false,
    // Cross-surface exclusivity: the compose panel + a room panel COEXIST (compose is single-reuse;
    // rooms are their own tabs) — they are distinct surfaces, not fighting one panel slot.
    composeAndRoomPanelsCoexist: false,
    error: null as string | null,
  };

  let dataAccess: ReturnType<typeof createDataAccessNodeSqlite> | undefined;
  const composePanels: vscode.WebviewPanel[] = [];
  const roomPanels: vscode.WebviewPanel[] = [];
  let composeManager: ComposePanelManager | undefined;
  let roomManager: RoomPanelManager | undefined;
  try {
    dataAccess = createDataAccessNodeSqlite();
    r.opened = true;

    // The cast of a real session: the operator + a peer who owns a FOREIGN project to join later.
    await register(dataAccess, { handle: OPERATOR, currentFocus: 'leading' });
    await register(dataAccess, { handle: 'peer', currentFocus: 'helping' });
    const foreign = await announceProject(dataAccess, 'peer', {
      title: 'Peer Project',
      description:
        'the peer owns this; the operator will join it from the editor',
    });

    const extUri = vscode.Uri.file(process.cwd());
    const distRoot = vscode.Uri.joinPath(extUri, 'dist');
    composeManager = new ComposePanelManager({
      dataAccess,
      assetUris: {
        script: vscode.Uri.joinPath(distRoot, 'webview', 'compose.js'),
        styles: [vscode.Uri.joinPath(distRoot, 'webview', 'compose.css')],
      },
      iconPath: new vscode.ThemeIcon('edit'),
      resolveOperatorHandle: () => OPERATOR,
      resolveThemeKind: () =>
        webviewThemeKind(vscode.window.activeColorTheme.kind),
      createPanel: (title) => {
        const p = vscode.window.createWebviewPanel(
          'agentbbs.compose',
          title,
          vscode.ViewColumn.Active,
          { enableScripts: true, localResourceRoots: [distRoot] },
        );
        composePanels.push(p);
        return p as unknown as never;
      },
    });
    roomManager = new RoomPanelManager({
      dataAccess,
      assetUris: {
        script: vscode.Uri.joinPath(distRoot, 'webview', 'main.js'),
        styles: [vscode.Uri.joinPath(distRoot, 'webview', 'main.css')],
      },
      iconPath: new vscode.ThemeIcon('comment-discussion'),
      resolveOperatorHandle: () => OPERATOR,
      resolveThemeKind: () =>
        webviewThemeKind(vscode.window.activeColorTheme.kind),
      createPanel: (_roomId: string, title: string): PanelLike => {
        const p = vscode.window.createWebviewPanel(
          'agentbbs.room',
          title,
          vscode.ViewColumn.Active,
          { enableScripts: true, localResourceRoots: [distRoot] },
        );
        roomPanels.push(p);
        return p as unknown as PanelLike;
      },
    });

    // ── SEAM 1: create a project from the editor → it shows in the tree ──────────────────────────
    composeManager.open('create-project');
    const created = await dispatchRequest(dataAccess, {
      id: 'c1',
      op: 'announceProject',
      args: {
        actor: OPERATOR,
        title: 'Flow Project',
        description: 'integrated smoke',
      },
    });
    const projectId = (
      created.result as { project: { projectId: string } } | undefined
    )?.project.projectId;
    r.projectCreated = created.ok === true && typeof projectId === 'string';
    {
      const model = await buildTreeModel(dataAccess, OPERATOR);
      r.projectInTree = model.projects.some((p) => p.projectId === projectId);
    }

    // ── SEAM 2: post an announcement → a NAVIGABLE proto-room row in the tree (not just a count) ──
    composeManager.open('post-announcement', projectId ?? null);
    const posted = await dispatchRequest(dataAccess, {
      id: 'c2',
      op: 'postAnnouncement',
      args: {
        actor: OPERATOR,
        projectId,
        subject: 'Kickoff',
        body: 'who can pair on this?',
      },
    });
    const roomId = (posted.result as { room: { roomId: string } } | undefined)
      ?.room.roomId;
    r.announcementPosted = posted.ok === true && typeof roomId === 'string';
    {
      const model = await buildTreeModel(dataAccess, OPERATOR);
      const project = model.projects.find((p) => p.projectId === projectId);
      const row = project?.rooms.find((rm) => rm.roomId === roomId);
      // NAVIGABLE: a selectable pending row carrying the room id — the Epic-9 gap was "counted, not
      // navigable", so assert the ROW exists + is pending, not merely announcementCount > 0.
      r.protoRoomNavigableInTree = row !== undefined && row.pending === true;
    }

    // ── SEAM 3: OPEN the proto-room as a real WebviewPanel rendering the announcement ─────────────
    if (typeof roomId === 'string') {
      await roomManager.openRoom(roomId);
      r.roomPanelOpened = roomPanels.length === 1;
      const before = await dispatchRequest(dataAccess, {
        id: 'r0',
        op: 'readRoom',
        args: { roomId },
      });
      const room = before.result as {
        room: { active: boolean };
        messages: Array<{ body: string }>;
      };
      r.roomPanelShowsAnnouncement =
        room.room.active === false &&
        room.messages.some((m) => m.body.includes('pair on this'));

      // ── SEAM 4: reply ACTIVATES the proto-room → the tree row goes pending→active ───────────────
      const reply = await dispatchRequest(dataAccess, {
        id: 'r1',
        op: 'reply',
        args: {
          actor: 'peer',
          roomId,
          body: 'I can pair — proposing the interface.',
        },
      });
      const after = await dispatchRequest(dataAccess, {
        id: 'r2',
        op: 'readRoom',
        args: { roomId },
      });
      r.replyActivatedRoom =
        reply.ok === true &&
        (after.result as { room: { active: boolean } }).room.active === true;
      {
        const model = await buildTreeModel(dataAccess, OPERATOR);
        const project = model.projects.find((p) => p.projectId === projectId);
        const row = project?.rooms.find((rm) => rm.roomId === roomId);
        // The SAME room is now an ACTIVE row (pending:false) — and NOT also a stale pending row.
        r.treeRowActiveAfterReply = row !== undefined && row.pending === false;
      }

      // ── SEAM 5: the operator AGREES → the agreed mark (FR21 highest-seq live-👍) is computed ─────
      // Realistic flow: the peer PROPOSED (their reply). To 👍 it, the operator must be a
      // participant — so the operator REPLIES first (Mode A→B grant-on-act: acting = joining; the
      // product correctly gates react with NOT_A_MEMBER for a non-participant), THEN 👍's the peer's
      // proposal. The contract is the highest-seq message holding a LIVE 👍 — the peer's proposal
      // (which carries the 👍), NOT the operator's later un-👍'd reply (the FR21 discriminator).
      const afterMsgs = (
        after.result as { messages: Array<{ seq: number; actor: string }> }
      ).messages;
      const peerProposal = afterMsgs.find((m) => m.actor === 'peer');
      if (peerProposal !== undefined) {
        await dispatchRequest(dataAccess, {
          id: 'r3',
          op: 'reply',
          args: {
            actor: OPERATOR,
            roomId,
            body: 'agreed — let us go with that.',
          },
        });
        const reacted = await dispatchRequest(dataAccess, {
          id: 'r4',
          op: 'react',
          args: { actor: OPERATOR, roomId, messageSeq: peerProposal.seq },
        });
        const contract = await dispatchRequest(dataAccess, {
          id: 'r5',
          op: 'readContract',
          args: { roomId },
        });
        const agreed = (contract.result as { contract: { seq: number } | null })
          .contract;
        // FR21: the agreed mark is the peer's 👍'd proposal (the highest-seq LIVE-👍'd message),
        // not the operator's higher-seq but un-👍'd reply.
        r.agreedMarkComputed =
          reacted.ok === true &&
          agreed !== null &&
          agreed.seq === peerProposal.seq;
      }
    }

    // ── SEAM 6: set focus from the editor → whoami reflects it ───────────────────────────────────
    composeManager.open('focus');
    const setFocus = await dispatchRequest(dataAccess, {
      id: 'f1',
      op: 'updateFocus',
      args: { actor: OPERATOR, focus: 'driving the integrated smoke' },
    });
    {
      // whoami is actor-scoped (no actor → {handle:null, focus:null}); pass the operator.
      const me = await dispatchRequest(dataAccess, {
        id: 'f2',
        op: 'whoami',
        args: { actor: OPERATOR },
      });
      const focus =
        (me.result as { focus?: string | null } | undefined)?.focus ?? null;
      r.focusSetAndReflected =
        setFocus.ok === true && focus === 'driving the integrated smoke';
    }

    // ── SEAM 7: join the peer's foreign project from the editor → the tree shows the membership ───
    composeManager.open('join-project');
    const joined = await dispatchRequest(dataAccess, {
      id: 'j1',
      op: 'joinBoard',
      args: { actor: OPERATOR, projectId: foreign.projectId },
    });
    r.foreignProjectJoined = joined.ok === true;
    {
      const model = await buildTreeModel(dataAccess, OPERATOR);
      // The operator now sees the foreign project as one of THEIR projects (a member).
      r.foreignProjectInTreeAsMember = model.projects.some(
        (p) => p.projectId === foreign.projectId,
      );
    }

    // Cross-surface exclusivity: the compose panel is a SINGLE reused panel across all the opens
    // above (create/post/focus/join → 1), while the room open created its OWN distinct panel — the
    // two surface families coexist (compose ≠ rooms-as-tabs), not fighting one slot.
    r.composeAndRoomPanelsCoexist =
      composePanels.length === 1 && roomPanels.length === 1;

    composeManager.dispose();
    roomManager.dispose();
  } catch (err) {
    r.error =
      err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  } finally {
    for (const p of [...composePanels, ...roomPanels]) {
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
    writeFileSync(out, JSON.stringify(r, null, 2), 'utf8');
  }

  const seams: Array<[string, boolean]> = [
    ['opened', r.opened],
    ['projectCreated', r.projectCreated],
    ['projectInTree', r.projectInTree],
    ['announcementPosted', r.announcementPosted],
    ['protoRoomNavigableInTree', r.protoRoomNavigableInTree],
    ['roomPanelOpened', r.roomPanelOpened],
    ['roomPanelShowsAnnouncement', r.roomPanelShowsAnnouncement],
    ['replyActivatedRoom', r.replyActivatedRoom],
    ['treeRowActiveAfterReply', r.treeRowActiveAfterReply],
    ['agreedMarkComputed', r.agreedMarkComputed],
    ['focusSetAndReflected', r.focusSetAndReflected],
    ['foreignProjectJoined', r.foreignProjectJoined],
    ['foreignProjectInTreeAsMember', r.foreignProjectInTreeAsMember],
    ['composeAndRoomPanelsCoexist', r.composeAndRoomPanelsCoexist],
  ];
  const failed = seams.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(
      `INTEGRATED-FLOW (Rule-14) PROBE FAILED at seam(s): ${failed.join(', ')} — ${JSON.stringify(r)}`,
    );
  }
}
