// RoomPanelSerializer (Story 10.5, AC2) — restores backgrounded room tabs across a WINDOW RELOAD.
//
// VS Code persists the webview panels of a serializer-registered viewType when the window shuts
// down / reloads. On the next launch, for EACH persisted panel it calls
// `deserializeWebviewPanel(panel, state)` (the panel FIRST, the persisted state SECOND — verified
// against the installed @types/vscode 1.120.0, Rule 3). The serializer must take ownership of the
// fresh panel: re-set its `.html` and re-hook its events. We delegate that to the
// {@link RoomPanelManager}'s `adoptPanel`, so reveal-not-duplicate (Story 10.4 AC1) keeps holding
// AFTER a reload — a later open of the restored room reveals it, not duplicates it. The unread /
// identity state is correct because the adopted panel re-reads the room over its fresh bridge (the
// same readRoom/readContract path a fresh open uses), not from any stale cached value.
//
// The room id is the load-bearing piece of persisted state. The webview bundle persists it via
// `acquireVsCodeApi().setState({ roomId })` on mount (see webview/main.tsx); VS Code hands that
// state object back here as `state`. We accept either the structured `{ roomId }` (the bundle's
// shape) or a bare string (defensive), and ignore a panel whose state carries no resolvable room
// id (nothing to restore).
//
// PURE-ish: this module imports the `vscode` TYPE only for the interface it implements; it holds NO
// vscode runtime value. The manager is injected, so the deserialize logic is unit-testable with a
// fake manager + a fake panel (no real host needed for the re-attach logic; the real
// register+reload round-trip is the @vscode/test-electron / manual-reload evidence, Rule 12).

import { ROOM_PANEL_VIEW_TYPE } from './room-panel.js';

import type { PanelLike, RoomPanelManager } from './room-panel.js';
import type * as vscode from 'vscode';

/** The view type the serializer is registered under (the room WebviewPanel discriminator). */
export const ROOM_SERIALIZER_VIEW_TYPE = ROOM_PANEL_VIEW_TYPE;

/** The persisted webview state shape the room bundle writes via `setState`. */
export interface RoomWebviewState {
  /** The room the panel was showing — the only field needed to re-attach + re-read. */
  roomId?: string;
}

/**
 * Resolve a room id from an arbitrary persisted-state value. Accepts the bundle's `{ roomId }`
 * object or a bare string (defensive). Returns `null` when no usable room id is present.
 */
export function roomIdFromState(state: unknown): string | null {
  if (typeof state === 'string' && state.length > 0) return state;
  if (
    state !== null &&
    typeof state === 'object' &&
    'roomId' in state &&
    typeof (state as RoomWebviewState).roomId === 'string' &&
    ((state as RoomWebviewState).roomId ?? '').length > 0
  ) {
    return (state as RoomWebviewState).roomId ?? null;
  }
  return null;
}

/**
 * A WebviewPanelSerializer that re-attaches a restored room panel to its room via the manager.
 * Implements `vscode.WebviewPanelSerializer`; the only runtime dependency is the injected manager.
 *
 * @param manager The room panel manager that owns the keyed panel map.
 */
export function createRoomPanelSerializer(
  manager: Pick<RoomPanelManager, 'adoptPanel'>,
): vscode.WebviewPanelSerializer<RoomWebviewState | string | undefined> {
  return {
    deserializeWebviewPanel(
      webviewPanel: vscode.WebviewPanel,
      state: RoomWebviewState | string | undefined,
    ): Thenable<void> {
      const roomId = roomIdFromState(state);
      if (roomId === null) {
        // No resolvable room id — nothing to restore. Leave the bare panel to the host (it will be
        // an empty shell); we cannot re-attach it to a room we can't identify.
        return Promise.resolve();
      }
      // Take ownership: the manager re-sets the HTML (fresh nonce CSP), binds a fresh bridge, and
      // re-reads the room — and adopts the panel into its map so reveal-not-duplicate holds.
      manager.adoptPanel(roomId, webviewPanel as unknown as PanelLike);
      return Promise.resolve();
    },
  };
}
