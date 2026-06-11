// The native sidebar TreeDataProvider (Story 10.3, AC1/AC2) — the `vscode`-facing presenter for
// the pure {@link BoardTreeModel}. Runs HOST-SIDE and reads via the data-access handle + core
// ops DIRECTLY (it does NOT postMessage to itself; the bridge is for the room webviews,
// Story 10.4). Gives free twisties, keyboard nav, and a11y tree roles; selection/hover lean on
// the native `--vscode-list-*` styling (no custom CSS).
//
// THIN CLIENT (Rule 13): the model is built by {@link buildTreeModel}, which composes only
// EXISTING core read ops — this file just maps it to `TreeItem`s. No board logic here.
//
// THE HIERARCHY (mirrors the web control room):
//   root → NEEDS YOU (N) bucket  → needs-you room rows
//        → project nodes         → announcements (N) indicator + active rooms + proto-rooms
//        → ＋ join a project…     (an action row — the open handler is a thin seam, see below)
//
// RULE 15 (the marquee contract): a project's children are its ACTIVE rooms FIRST, then its
// PENDING proto-rooms as SIBLING NAVIGABLE rows (selectable, carrying the open command) — NOT
// merely a count. {@link buildTreeModel} produces them in that order; this presenter renders
// each `TreeRoomRow` (pending or not) as a navigable `TreeItem` carrying {@link OPEN_ROOM_COMMAND}.
//
// THE OPEN-ROOM COMMAND is a thin SEAM this story registers; Story 10.4 fills it with the room
// WebviewPanel. The rows already carry it + are selectable, so proto-room NAVIGABILITY is
// structurally present NOW (not deferred) — exactly what 9.14 fixed on the web.

import * as vscode from 'vscode';

import { buildTreeModel } from './tree-model.js';
import { unreadDescription } from './decoration-model.js';
import { roomUriString } from './room-uri.js';

import type { BoardTreeModel, TreeRoomRow } from './tree-model.js';
import type { DataAccess } from '@agentbbs/core';

/** The view id (matches `contributes.views` in package.json). */
export const BOARD_TREE_VIEW_ID = 'agentbbs.boardTree';
/** The command a room/proto-room row invokes when selected (filled by Story 10.4). */
export const OPEN_ROOM_COMMAND = 'agentbbs.openRoom';
/** The command the `＋ join a project…` action row invokes (filled by Story 10.7's compose picker). */
export const JOIN_PROJECT_COMMAND = 'agentbbs.joinProject';
/** Story 10.7 — the operator INITIATE commands (the 4 compose surfaces). */
export const CREATE_PROJECT_COMMAND = 'agentbbs.createProject';
export const POST_ANNOUNCEMENT_COMMAND = 'agentbbs.postAnnouncement';
export const SET_FOCUS_COMMAND = 'agentbbs.setFocus';

/** The discriminated node union the tree is built from. */
export type BoardTreeNode =
  | { kind: 'needsYouBucket' }
  | {
      kind: 'needsYouRoom';
      room: { roomId: string; projectId: string; subject: string };
    }
  | { kind: 'project'; projectId: string }
  | { kind: 'announcementsIndicator'; projectId: string; count: number }
  | { kind: 'room'; row: TreeRoomRow }
  | { kind: 'joinProjectAction' };

/**
 * The native board tree. Holds the most-recently-built {@link BoardTreeModel} as a snapshot;
 * {@link refresh} re-reads it and fires `onDidChangeTreeData`. The operator handle is captured
 * at construction (re-read on refresh by the caller if the setting changes).
 */
export class BoardTreeProvider implements vscode.TreeDataProvider<BoardTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    BoardTreeNode | undefined | void
  >();
  /** Fired when the model changes — VS Code re-queries `getChildren`/`getTreeItem`. */
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private model: BoardTreeModel | undefined;

  constructor(
    private readonly dataAccess: DataAccess,
    private operatorHandle: string | null,
  ) {}

  /** The current model snapshot (or `undefined` before the first {@link refresh}). For tests/decorations. */
  getModel(): BoardTreeModel | undefined {
    return this.model;
  }

  /** Update the operator handle (e.g. the setting changed) — the next refresh personalizes to it. */
  setOperatorHandle(handle: string | null): void {
    this.operatorHandle = handle;
  }

  /** Re-read the model from the ledger and signal the view to refresh. */
  async refresh(): Promise<void> {
    this.model = await buildTreeModel(this.dataAccess, this.operatorHandle);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: BoardTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'needsYouBucket': {
        const count = this.model?.needsYou.length ?? 0;
        const item = new vscode.TreeItem(
          `NEEDS YOU (${count})`,
          count > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon('warning');
        item.contextValue = 'agentbbs.needsYouBucket';
        item.tooltip =
          'Rooms you were explicitly pulled into (Mode-B escalations).';
        return item;
      }
      case 'needsYouRoom': {
        const item = new vscode.TreeItem(
          node.room.subject,
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon('warning');
        item.resourceUri = vscode.Uri.parse(roomUriString(node.room.roomId));
        item.contextValue = 'agentbbs.needsYouRoom';
        item.command = {
          command: OPEN_ROOM_COMMAND,
          title: 'Open Room',
          arguments: [node.room.roomId],
        };
        return item;
      }
      case 'project': {
        const project = this.model?.projects.find(
          (p) => p.projectId === node.projectId,
        );
        const item = new vscode.TreeItem(
          project?.title ?? node.projectId,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new vscode.ThemeIcon('folder');
        item.contextValue = 'agentbbs.project';
        return item;
      }
      case 'announcementsIndicator': {
        const item = new vscode.TreeItem(
          `announcements (${node.count})`,
          vscode.TreeItemCollapsibleState.None,
        );
        // The `*` proto-room/announcement glyph (wireframe legend). The mail/megaphone icon
        // reads as "posts awaiting a reply".
        item.iconPath = new vscode.ThemeIcon('megaphone');
        item.contextValue = 'agentbbs.announcementsIndicator';
        item.tooltip =
          'Announced negotiations with no reply yet (proto-rooms).';
        return item;
      }
      case 'room': {
        const { row } = node;
        const item = new vscode.TreeItem(
          row.subject,
          vscode.TreeItemCollapsibleState.None,
        );
        // Pending proto-rooms get the `*` announcement icon; active rooms the comment icon.
        item.iconPath = new vscode.ThemeIcon(
          row.pending ? 'megaphone' : 'comment-discussion',
        );
        // The decoration KEY — the FileDecorationProvider decorates this URI (unread/needs).
        item.resourceUri = vscode.Uri.parse(roomUriString(row.roomId));
        item.contextValue = row.pending
          ? 'agentbbs.protoRoom'
          : 'agentbbs.room';
        // The exact unread count rides in `description` (no 2-char cap, unlike the badge) —
        // formatted by the vscode-free `unreadDescription` so the string is unit-testable.
        if (row.unreadCount > 0) {
          item.description = unreadDescription(row.unreadCount);
        }
        // RULE 15: EVERY room row — pending proto-room INCLUDED — is selectable + carries the
        // open command, so it is navigable now (the seam Story 10.4 fills with the webview).
        item.command = {
          command: OPEN_ROOM_COMMAND,
          title: 'Open Room',
          arguments: [row.roomId],
        };
        return item;
      }
      case 'joinProjectAction': {
        const item = new vscode.TreeItem(
          '＋ join a project…',
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon('add');
        item.contextValue = 'agentbbs.joinProjectAction';
        item.command = {
          command: JOIN_PROJECT_COMMAND,
          title: 'Join a project',
        };
        return item;
      }
    }
  }

  getChildren(node?: BoardTreeNode): BoardTreeNode[] {
    const model = this.model;
    if (model === undefined) return [];

    // ROOT: the NEEDS YOU bucket, then each project, then the join-a-project action row.
    if (node === undefined) {
      const roots: BoardTreeNode[] = [{ kind: 'needsYouBucket' }];
      for (const project of model.projects) {
        roots.push({ kind: 'project', projectId: project.projectId });
      }
      roots.push({ kind: 'joinProjectAction' });
      return roots;
    }

    switch (node.kind) {
      case 'needsYouBucket':
        return model.needsYou.map((room) => ({ kind: 'needsYouRoom', room }));
      case 'project': {
        const project = model.projects.find(
          (p) => p.projectId === node.projectId,
        );
        if (project === undefined) return [];
        // The `announcements (N)` indicator FIRST, then the room rows (active first, then
        // pending proto-rooms — the order buildTreeModel already established, Rule 15).
        const children: BoardTreeNode[] = [
          {
            kind: 'announcementsIndicator',
            projectId: project.projectId,
            count: project.announcementCount,
          },
        ];
        for (const row of project.rooms) {
          children.push({ kind: 'room', row });
        }
        return children;
      }
      default:
        return [];
    }
  }

  /** Dispose the change emitter. The view + provider registrations are owned by subscriptions. */
  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
