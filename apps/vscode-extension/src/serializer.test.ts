// RoomPanelSerializer unit tests (Story 10.5, AC2) — the deserialize → re-attach logic.
//
// Host-side, no real vscode/DOM: a FAKE manager records adoptPanel calls; a fake panel stands in
// for the WebviewPanel VS Code hands the serializer. Proves: the room id is resolved from the
// persisted state ({ roomId } object OR bare string), deserialize adopts the panel for the right
// room, and a state with no resolvable room id is a no-op (nothing adopted). The REAL
// register+reload round-trip in the Electron host is the Rule-12 real-runtime evidence (see the
// host probe / the manual-reload note in the Dev Agent Record). Discoverable by ROOT `pnpm test`.

import { describe, expect, it } from 'vitest';

import {
  createRoomPanelSerializer,
  roomIdFromState,
  ROOM_SERIALIZER_VIEW_TYPE,
} from './serializer.js';
import { ROOM_PANEL_VIEW_TYPE, type PanelLike } from './room-panel.js';

import type { RoomPanelManager } from './room-panel.js';
import type * as vscode from 'vscode';

/** A fake manager recording adoptPanel(roomId, panel) calls. */
function fakeManager(): Pick<RoomPanelManager, 'adoptPanel'> & {
  adopted: Array<{ roomId: string; panel: PanelLike }>;
} {
  const adopted: Array<{ roomId: string; panel: PanelLike }> = [];
  return {
    adopted,
    adoptPanel(roomId: string, panel: PanelLike): void {
      adopted.push({ roomId, panel });
    },
  };
}

/** A minimal fake WebviewPanel (the deserialize logic only forwards it to adoptPanel). */
function fakePanel(): vscode.WebviewPanel {
  return { id: 'fake-restored-panel' } as unknown as vscode.WebviewPanel;
}

describe('roomIdFromState — resolve the persisted room id', () => {
  it('reads the bundle shape { roomId }', () => {
    expect(roomIdFromState({ roomId: 'calling-interface' })).toBe(
      'calling-interface',
    );
  });
  it('accepts a bare string (defensive)', () => {
    expect(roomIdFromState('room-x')).toBe('room-x');
  });
  it('returns null for missing/empty/unusable state', () => {
    expect(roomIdFromState(undefined)).toBeNull();
    expect(roomIdFromState(null)).toBeNull();
    expect(roomIdFromState('')).toBeNull();
    expect(roomIdFromState({})).toBeNull();
    expect(roomIdFromState({ roomId: '' })).toBeNull();
    expect(roomIdFromState({ roomId: 42 })).toBeNull();
    expect(roomIdFromState({ other: 'x' })).toBeNull();
  });
});

describe('createRoomPanelSerializer — deserialize re-attaches the panel to its room (AC2)', () => {
  it('is registered under the room panel view type', () => {
    expect(ROOM_SERIALIZER_VIEW_TYPE).toBe(ROOM_PANEL_VIEW_TYPE);
    expect(ROOM_SERIALIZER_VIEW_TYPE).toBe('agentbbs.room');
  });

  it('adopts the restored panel for the room id in the persisted state', async () => {
    const manager = fakeManager();
    const serializer = createRoomPanelSerializer(manager);
    const panel = fakePanel();
    await serializer.deserializeWebviewPanel(panel, {
      roomId: 'calling-interface',
    });
    expect(manager.adopted).toHaveLength(1);
    expect(manager.adopted[0].roomId).toBe('calling-interface');
    expect(manager.adopted[0].panel).toBe(panel as unknown as PanelLike);
  });

  it('adopts when the persisted state is a bare room-id string', async () => {
    const manager = fakeManager();
    const serializer = createRoomPanelSerializer(manager);
    await serializer.deserializeWebviewPanel(fakePanel(), 'room-x');
    expect(manager.adopted).toHaveLength(1);
    expect(manager.adopted[0].roomId).toBe('room-x');
  });

  it('does NOT adopt (no-op) when the state carries no resolvable room id', async () => {
    const manager = fakeManager();
    const serializer = createRoomPanelSerializer(manager);
    await serializer.deserializeWebviewPanel(fakePanel(), undefined);
    await serializer.deserializeWebviewPanel(fakePanel(), {});
    expect(manager.adopted).toHaveLength(0);
  });
});
