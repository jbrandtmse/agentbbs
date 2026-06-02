// RoomPanelManager (Story 10.4, AC1/AC2/AC4/AC5) — rooms as editor-tab WebviewPanels.
//
// Fills the Story-10.3 `agentbbs.openRoom` command SEAM: selecting a room (active OR a navigable
// proto-room) opens it as a `vscode.window.createWebviewPanel` in the editor area — rooms = editor
// tabs, the host renders the tab chrome (title = the room id, an icon, the native ×). ONE PANEL
// PER ROOM (keyed by `room_id`): re-selecting an open room REVEALS the existing panel, never a
// duplicate. The rooms-as-tabs model deliberately allows MULTIPLE open room tabs (the
// single-open-INITIATE-panel exclusivity is Story 10.7's concern, not rooms; the only
// "exclusivity" here is reveal-existing per room id).
//
// Each panel mounts the SAME `@agentbbs/ui-shared` RoomView (the built webview bundle), fed by a
// per-panel BRIDGE (src/bridge.ts) over the panel's own webview messaging channel — the host
// invokes the SAME core ops an agent uses (Rule 13 — readRoom/readContract/reply/react/unreact;
// no fabricated op, no backdoor). AC4 (Rule 15 respond-parity): opening a proto-room shows the
// announcement + the join-gate composer, and a `reply` through the bridge ACTIVATES it via the
// EXISTING Epic-4 min-seq activator — the operator can open, read, AND reply-to-activate.
//
// THIN CLIENT (Rule 13, LOAD-BEARING): no board logic here — the manager wires panels to the
// bridge, which composes core ops. `git diff HEAD -- packages/core packages/mcp-server` stays
// EMPTY. The bridge push is host→ITS-OWN-webview only (NFR5 pull-only preserved; agents keep
// `check`).
//
// TESTABILITY: the `vscode`-facing panel creation is injected via {@link PanelFactory} so the
// keyed open/reveal/dispose Map logic is unit-testable with a fake window (host-side test), while
// production wires the real `vscode.window.createWebviewPanel`. The real WebviewPanel lifecycle
// (panel opens, bridge round-trip, proto-room reply-activates) is the load-bearing Rule-12
// evidence proven in the real Electron host (@vscode/test-electron) + the lead smoke.

import { createBridge } from './bridge.js';
import {
  buildRoomWebviewHtml,
  generateNonce,
  type WebviewHtmlOptions,
} from './webview/webview-html.js';

import type { Bridge, Messaging } from './bridge.js';
import type { DataAccess } from '@agentbbs/core';

/** The view type registered for room panels (the createWebviewPanel discriminator). */
export const ROOM_PANEL_VIEW_TYPE = 'agentbbs.room';

/**
 * The minimal `WebviewPanel`-shaped surface the manager drives — a structural subset of
 * `vscode.WebviewPanel` so a test can supply a fake (and so this module needs no `vscode` import).
 * The real `vscode.WebviewPanel` satisfies this.
 */
export interface PanelLike {
  title: string;
  /** The VS Code panel icon (a ThemeIcon / Uri); set host-side. Opaque here. */
  iconPath?: unknown;
  /** The panel's webview — the bridge messaging channel + the HTML sink + URI resolver. */
  readonly webview: {
    html: string;
    options: unknown;
    cspSource: string;
    asWebviewUri(localResource: unknown): { toString(): string };
    postMessage(message: unknown): Thenable<boolean> | void;
    onDidReceiveMessage(handler: (message: unknown) => void): {
      dispose(): void;
    };
  };
  /** Bring an existing panel to the foreground (the reveal-not-duplicate path). */
  reveal(viewColumn?: unknown, preserveFocus?: boolean): void;
  /** Fired when the panel is closed (the × / the editor closing it) — cleanup hook. */
  onDidDispose(handler: () => void): { dispose(): void };
}

/**
 * Creates a fresh room {@link PanelLike} for a room id. Production passes a closure over
 * `vscode.window.createWebviewPanel(ROOM_PANEL_VIEW_TYPE, title, ViewColumn.Active, options)`; a
 * test passes a fake. The manager owns the title/icon/html/bridge wiring after creation.
 */
export type PanelFactory = (roomId: string, title: string) => PanelLike;

/** Resolves the `asWebviewUri`-ready local resource refs for the bundle + each stylesheet. */
export interface AssetUris {
  /** Resolve the built bundle's local resource ref (passed to `webview.asWebviewUri`). */
  script: unknown;
  /** Resolve each stylesheet's local resource ref, IN ORDER (vscode-tokens.css LAST — AC3). */
  styles: unknown[];
}

/** Options for {@link RoomPanelManager}. */
export interface RoomPanelManagerOptions {
  /** The persistence port every bridge op delegates to (the host's node:sqlite handle). */
  dataAccess: DataAccess;
  /** Creates a panel for a room (injected for testability; production wraps createWebviewPanel). */
  createPanel: PanelFactory;
  /** The local resource refs for the bundle + stylesheets (resolved per-panel via asWebviewUri). */
  assetUris: AssetUris;
  /** An optional icon to set on each panel (a `vscode.ThemeIcon`/Uri); opaque here. */
  iconPath?: unknown;
  /**
   * The resolved operator handle (or `null` → watching-only) injected into each panel's HTML so
   * the mounted RoomView computes the operator POSTURE / composer gate / 👍 state. HOST-SURFACE
   * display field (Rule 13 — not an agent contract field). A function so a handle re-resolve (the
   * setting changed) is picked up on the NEXT open without re-constructing the manager.
   */
  resolveOperatorHandle?: () => string | null;
}

/** A held open panel + its bridge + disposables (cleaned up on dispose). */
interface OpenPanel {
  panel: PanelLike;
  bridge: Bridge;
  disposeListener: { dispose(): void };
}

/**
 * Manages the room WebviewPanels — one per room id, reveal-not-duplicate, dispose-cleanup. The
 * marquee AC1/AC5 behavior (keyed open/reveal/dispose) lives here; the per-panel HTML + bridge
 * wiring is the AC2 mount.
 */
export class RoomPanelManager {
  private readonly panels = new Map<string, OpenPanel>();
  private readonly options: RoomPanelManagerOptions;

  constructor(options: RoomPanelManagerOptions) {
    this.options = options;
  }

  /** How many room panels are currently open (for tests/diagnostics). */
  get openCount(): number {
    return this.panels.size;
  }

  /** Whether a panel for `roomId` is currently open. */
  has(roomId: string): boolean {
    return this.panels.has(roomId);
  }

  /**
   * Open the room as a WebviewPanel — or REVEAL the existing one (AC1: one panel per room, keyed
   * by `roomId`; re-select reveals, never duplicates). On a fresh open: create the panel, set its
   * title/icon, generate the HTML shell (nonce CSP) referencing the bundle + CSS via asWebviewUri,
   * bind a per-panel bridge over the panel's webview channel (the SAME `createBridge` the bridge
   * tests exercise), and register dispose-cleanup. Returns the panel.
   *
   * @param roomId The room (active or proto-room) to open — the open-command argument.
   */
  openRoom(roomId: string): PanelLike {
    const existing = this.panels.get(roomId);
    if (existing !== undefined) {
      // AC1 — reveal the already-open panel; do NOT create a duplicate.
      existing.panel.reveal();
      return existing.panel;
    }

    // The tab title is the room id (mono identifier); the subject is room metadata in the view.
    const panel = this.options.createPanel(roomId, `#${roomId}`);
    panel.title = `#${roomId}`;
    if (this.options.iconPath !== undefined) {
      panel.iconPath = this.options.iconPath;
    }

    // Resolve the bundle + stylesheet URIs for THIS webview (asWebviewUri is per-webview).
    const scriptUri = panel.webview
      .asWebviewUri(this.options.assetUris.script)
      .toString();
    const styleUris = this.options.assetUris.styles.map((s) =>
      panel.webview.asWebviewUri(s).toString(),
    );

    const html: WebviewHtmlOptions = {
      cspSource: panel.webview.cspSource,
      nonce: generateNonce(),
      scriptUri,
      styleUris,
      roomId,
      operatorHandle: this.options.resolveOperatorHandle?.() ?? '',
    };
    panel.webview.html = buildRoomWebviewHtml(html);

    // Bind a per-panel bridge over the panel's own webview messaging channel. The bridge
    // dispatches the webview's readRoom/readContract/reply/react/unreact requests to core
    // (Rule 13) and pushes MAX(seq) deltas host→THIS-webview only (NFR5 pull-only preserved).
    const messaging: Messaging = {
      postMessage: (message) => {
        void panel.webview.postMessage(message);
      },
      onMessage: (handler) => {
        const sub = panel.webview.onDidReceiveMessage(handler);
        return () => sub.dispose();
      },
    };
    const bridge = createBridge({
      dataAccess: this.options.dataAccess,
      messaging,
    });

    // Dispose-cleanup: drop from the map + stop the bridge when the panel closes (the × / editor).
    const disposeListener = panel.onDidDispose(() => {
      const held = this.panels.get(roomId);
      if (held !== undefined) {
        held.bridge.dispose();
        held.disposeListener.dispose();
        this.panels.delete(roomId);
      }
    });

    this.panels.set(roomId, { panel, bridge, disposeListener });
    return panel;
  }

  /** Dispose all open panels' bridges + listeners (extension deactivate). The host owns the panels. */
  dispose(): void {
    for (const { bridge, disposeListener } of this.panels.values()) {
      bridge.dispose();
      disposeListener.dispose();
    }
    this.panels.clear();
  }
}
