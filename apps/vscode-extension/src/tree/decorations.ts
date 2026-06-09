// The native FileDecorationProvider (Story 10.3, AC3) — supplies the unread/NEEDS-YOU markers
// for the tree's room rows, keyed off the `agentbbs:` room URIs (BoardTreeProvider sets each
// row's `resourceUri`). The PURE mapping (which decoration, the badge 2-char cap, the
// needs-vs-unread precedence) lives in decoration-model.ts; this class just wraps it in a real
// `vscode.FileDecoration` (badge + ThemeColor + tooltip) and looks up the room's current state
// from the live BoardTreeModel snapshot.
//
// THE BADGE 2-CHAR CAP is enforced in `decoration-model.ts#roomDecoration` (the returned badge
// is always ≤2 chars; past 99 it collapses to `•` and the exact count rides in the row's
// `TreeItem.description`). Read rooms → `undefined` (calm, no badge).
//
// THIN CLIENT (Rule 13): the decoration SOURCE is the SAME deterministic state the tree model
// uses (NEEDS YOU = the `add_participant(@operator)` set; unread = events since the per-room
// join floor) — no body-text `@mention` heuristic (9.4-mention stays deferred). No board logic.

import * as vscode from 'vscode';

import { roomDecoration } from './decoration-model.js';
import { NEEDS_YOU_COLOR_ID, UNREAD_COLOR_ID } from './decoration-model.js';
import { parseRoomUri } from './room-uri.js';

import type { BoardTreeModel, TreeRoomRow } from './tree-model.js';

/** A live source of the current tree model (the provider holds the snapshot). */
export interface ModelSource {
  getModel(): BoardTreeModel | undefined;
}

/**
 * Supplies file decorations for the tree's `agentbbs://room/<id>` URIs from the current
 * {@link BoardTreeModel}. Fire {@link refresh} after the model is rebuilt so VS Code re-queries.
 */
export class BoardDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<
    undefined | vscode.Uri | vscode.Uri[]
  >();
  /** Signalled on refresh — VS Code re-queries `provideFileDecoration` for visible items. */
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  constructor(private readonly source: ModelSource) {}

  /** Signal that decorations may have changed (after a model rebuild). */
  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  provideFileDecoration(
    uri: vscode.Uri,
  ): vscode.ProviderResult<vscode.FileDecoration> {
    // Only decorate our own scheme's room URIs; anything else is not ours.
    if (uri.scheme !== 'agentbbs') return undefined;
    const roomId = parseRoomUri(uri.toString());
    if (roomId === undefined) return undefined;

    const row = this.findRoom(roomId);
    if (row === undefined) return undefined;

    const spec = roomDecoration({
      needsYou: row.needsYou,
      unread: row.unread,
      unreadCount: row.unreadCount,
    });
    if (spec === undefined) return undefined; // calm/read room — no badge

    return new vscode.FileDecoration(
      spec.badge,
      spec.tooltip,
      new vscode.ThemeColor(spec.colorId),
    );
  }

  /** Find a room row (across projects + the needs-you bucket reflection on project rows). */
  private findRoom(roomId: string): TreeRoomRow | undefined {
    const model = this.source.getModel();
    if (model === undefined) return undefined;
    for (const project of model.projects) {
      const row = project.rooms.find((r) => r.roomId === roomId);
      if (row !== undefined) return row;
    }
    return undefined;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

// Re-exported so the activation site / tests can reference the color ids without reaching into
// the pure model module directly.
export { NEEDS_YOU_COLOR_ID, UNREAD_COLOR_ID };
