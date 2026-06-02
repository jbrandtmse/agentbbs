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
import { RoomLru, DEFAULT_RETAIN_CAP } from './room-lru.js';
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
  /**
   * Programmatically close the panel (the real `vscode.WebviewPanel.dispose`). Optional so the room
   * fakes that pre-date Story 10.7 still satisfy the type; the compose manager's cancel/Esc path
   * calls it to close the single reused compose panel.
   */
  dispose?(): void;
  /** Fired when the panel is closed (the × / the editor closing it) — cleanup hook. */
  onDidDispose(handler: () => void): { dispose(): void };
  /**
   * Fired when the panel's view state changes (becomes visible/active or hidden). The manager uses
   * the `visible` transition to (a) touch the LRU so the focused room stays warm, and (b) re-feed
   * the model to a NON-retained panel whose DOM was torn down while hidden (AC2 re-render). The
   * real `vscode.WebviewPanel.onDidChangeViewState` fires `{ webviewPanel }`; we read `.visible`.
   * Optional so existing fakes that pre-date Story 10.5 still satisfy the type.
   */
  onDidChangeViewState?(handler: () => void): { dispose(): void };
  /** Whether the panel is currently visible — read on a view-state change to detect focus. */
  readonly visible?: boolean;
}

/**
 * Creates a fresh room {@link PanelLike} for a room id. Production passes a closure over
 * `vscode.window.createWebviewPanel(ROOM_PANEL_VIEW_TYPE, title, ViewColumn.Active, options)`; a
 * test passes a fake. The manager owns the title/icon/html/bridge wiring after creation.
 *
 * @param retain Whether the panel should be created with `retainContextWhenHidden: true` (the room
 *   is within the LRU retain window). Because `retainContextWhenHidden` is READONLY on
 *   WebviewPanelOptions (Rule 3 — fixed at creation), this decision is made ONCE, at open time.
 */
export type PanelFactory = (
  roomId: string,
  title: string,
  retain: boolean,
) => PanelLike;

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
  /**
   * Story 10.6 (AC2) — resolve the CURRENT webview theme-kind token (from
   * `vscode.window.activeColorTheme.kind` via {@link webviewThemeKind}) for the INITIAL `data-theme-kind`
   * attribute on each panel's mount root, so the HC overrides apply on first paint. A function so a
   * theme switch is picked up on the NEXT open; live re-theming of OPEN panels goes through
   * {@link RoomPanelManager.postThemeKind}. Defaults to `dark` when absent.
   */
  resolveThemeKind?: () => string;
  /**
   * How many most-recent rooms are kept warm with `retainContextWhenHidden` (the LRU cap; AC2).
   * Beyond this, a (re)opened panel is created NON-retained so it re-renders on focus — bounded
   * memory. Defaults to {@link DEFAULT_RETAIN_CAP}.
   */
  retainCap?: number;
}

/** A held open panel + its bridge + disposables (cleaned up on dispose). */
interface OpenPanel {
  panel: PanelLike;
  bridge: Bridge;
  disposeListener: { dispose(): void };
  /** The onDidChangeViewState subscription (LRU touch + non-retained re-feed); may be absent. */
  viewStateListener?: { dispose(): void };
  /** Whether this panel was created with retainContextWhenHidden (decided once at open). */
  retained: boolean;
  /** Was the panel visible at the last view-state check (to detect a hidden→visible transition). */
  lastVisible: boolean;
}

/**
 * Manages the room WebviewPanels — one per room id, reveal-not-duplicate, dispose-cleanup. The
 * marquee AC1/AC5 behavior (keyed open/reveal/dispose) lives here; the per-panel HTML + bridge
 * wiring is the AC2 mount.
 */
export class RoomPanelManager {
  private readonly panels = new Map<string, OpenPanel>();
  private readonly options: RoomPanelManagerOptions;
  /** The LRU bounding how many most-recent rooms are kept warm (retainContextWhenHidden). */
  private readonly lru: RoomLru;

  constructor(options: RoomPanelManagerOptions) {
    this.options = options;
    this.lru = new RoomLru(options.retainCap ?? DEFAULT_RETAIN_CAP);
  }

  /** How many room panels are currently open (for tests/diagnostics). */
  get openCount(): number {
    return this.panels.size;
  }

  /** Whether a panel for `roomId` is currently open. */
  has(roomId: string): boolean {
    return this.panels.has(roomId);
  }

  /** Whether the panel for `roomId` was created retained (within the LRU window at open). */
  isRetained(roomId: string): boolean {
    return this.panels.get(roomId)?.retained ?? false;
  }

  /** The room ids currently within the LRU retain window (most-recent first) — for tests. */
  retainedRooms(): string[] {
    return this.lru.retained();
  }

  /** How many currently-open panels were created retained (live-DOM panels) — for tests. */
  get retainedCount(): number {
    let n = 0;
    for (const entry of this.panels.values()) if (entry.retained) n += 1;
    return n;
  }

  /**
   * Decide whether a NEWLY-opened panel should be created with `retainContextWhenHidden`. Because
   * the flag is READONLY (Rule 3 — fixed at creation, never un-set on a live panel), the only lever
   * for bounded memory is to CAP how many open panels are created retained: a new panel is retained
   * iff fewer than `retainCap` currently-open panels are already retained. Beyond the cap, the new
   * panel is NON-retained → its DOM is torn down when hidden and re-rendered on focus (AC2). This
   * keeps at most `retainCap` panels holding their DOM alive at once.
   */
  private decideRetain(): boolean {
    return this.retainedCount < this.lru.retainCap;
  }

  /**
   * Open the room as a WebviewPanel — or REVEAL the existing one (AC1: one panel per room, keyed
   * by `roomId`; re-select reveals, never duplicates). On a fresh open: decide retention (bounded
   * by the LRU cap — see {@link decideRetain}), create the panel RETAINED or not accordingly, set
   * its title/icon, generate the HTML shell (nonce CSP), bind a per-panel bridge, and register
   * dispose + view-state listeners. Returns the panel.
   *
   * @param roomId The room (active or proto-room) to open — the open-command argument.
   */
  openRoom(roomId: string): PanelLike {
    const existing = this.panels.get(roomId);
    if (existing !== undefined) {
      // AC1 — reveal the already-open panel; do NOT create a duplicate. Touch the LRU so the
      // re-revealed room stays warm (it moves to most-recent).
      this.lru.touch(roomId);
      existing.panel.reveal();
      return existing.panel;
    }

    // Decide retention ONCE, at open time (retainContextWhenHidden is readonly — Rule 3): bound
    // the number of LIVE-DOM retained panels to the LRU cap.
    const retain = this.decideRetain();
    this.lru.touch(roomId);

    // The tab title is the room id (mono identifier); the subject is room metadata in the view.
    const panel = this.options.createPanel(roomId, `#${roomId}`, retain);
    panel.title = `#${roomId}`;
    if (this.options.iconPath !== undefined) {
      panel.iconPath = this.options.iconPath;
    }

    this.wirePanel(roomId, panel, retain);
    return panel;
  }

  /**
   * Adopt an externally-created panel (the {@link RoomPanelManager} serializer's restore path,
   * Story 10.5 AC2) into the manager's keyed map so reveal-not-duplicate holds AFTER a window
   * reload. VS Code hands the serializer a fresh WebviewPanel; this sets its title/icon, re-sets
   * the HTML shell (fresh nonce), binds a fresh bridge, and registers the dispose/view-state
   * listeners — exactly like {@link openRoom}'s fresh-open path, minus the createPanel call (the
   * host already created it). If a panel for the room is somehow already held, the incoming one is
   * adopted (the held one is dropped) so the map never duplicates.
   *
   * @param roomId The room the restored panel belongs to (from the persisted webview state).
   * @param panel The panel VS Code created for the deserialize call.
   */
  adoptPanel(roomId: string, panel: PanelLike): void {
    const held = this.panels.get(roomId);
    if (held !== undefined) {
      // Defensive: drop the stale held entry so the restored panel becomes the single source.
      held.bridge.dispose();
      held.disposeListener.dispose();
      held.viewStateListener?.dispose();
      this.panels.delete(roomId);
    }
    const retain = this.decideRetain();
    this.lru.touch(roomId);
    panel.title = `#${roomId}`;
    if (this.options.iconPath !== undefined) {
      panel.iconPath = this.options.iconPath;
    }
    this.wirePanel(roomId, panel, retain);
  }

  /**
   * Shared panel wiring used by both {@link openRoom} (fresh open) and {@link adoptPanel}
   * (serializer restore): set the HTML shell (nonce CSP), bind the per-panel bridge, and register
   * dispose + view-state listeners. Records the panel in the keyed map.
   */
  private wirePanel(roomId: string, panel: PanelLike, retain: boolean): void {
    this.setPanelHtml(roomId, panel);

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

    // Dispose-cleanup: drop from the map + stop the bridge + the view-state listener + the LRU
    // entry when the panel closes (the × / editor).
    const disposeListener = panel.onDidDispose(() => {
      const heldPanel = this.panels.get(roomId);
      if (heldPanel !== undefined) {
        heldPanel.bridge.dispose();
        heldPanel.disposeListener.dispose();
        heldPanel.viewStateListener?.dispose();
        this.panels.delete(roomId);
      }
      this.lru.remove(roomId);
    });

    const entry: OpenPanel = {
      panel,
      bridge,
      disposeListener,
      retained: retain,
      lastVisible: panel.visible ?? true,
    };

    // AC2 — view-state handling: on a hidden→visible transition, touch the LRU (keep the focused
    // room warm) and, for a NON-retained panel (its DOM was torn down while hidden), re-set the
    // HTML shell so the webview re-initializes + the bridge re-feeds the model on focus. A retained
    // panel keeps its DOM, so it needs no re-render — only the LRU touch.
    if (typeof panel.onDidChangeViewState === 'function') {
      entry.viewStateListener = panel.onDidChangeViewState(() => {
        const nowVisible = panel.visible ?? true;
        const becameVisible = nowVisible && !entry.lastVisible;
        entry.lastVisible = nowVisible;
        if (!nowVisible) return;
        this.lru.touch(roomId);
        if (becameVisible && !entry.retained) {
          // Non-retained: the hidden panel's context was suspended/destroyed; re-mount it.
          this.setPanelHtml(roomId, panel);
        }
      });
    }

    this.panels.set(roomId, entry);
  }

  /** Generate + set the panel's HTML shell (a FRESH per-load nonce each call — AC1). */
  private setPanelHtml(roomId: string, panel: PanelLike): void {
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
      themeKind: this.options.resolveThemeKind?.() ?? 'dark',
    };
    panel.webview.html = buildRoomWebviewHtml(html);
  }

  /**
   * Story 10.6 (AC2) — push a live theme-kind change to ALL open room panels (host→its-own-webviews
   * only; NFR5 preserved). Called by the extension on `vscode.window.onDidChangeActiveColorTheme` so
   * the open RoomViews re-apply their `data-theme-kind` and the HC overrides flip without a reload.
   *
   * @param kind The new webview theme-kind token (from {@link webviewThemeKind}).
   */
  postThemeKind(kind: string): void {
    for (const { panel } of this.panels.values()) {
      void panel.webview.postMessage({ type: 'themeKind', kind });
    }
  }

  /** Dispose all open panels' bridges + listeners (extension deactivate). The host owns the panels. */
  dispose(): void {
    for (const {
      bridge,
      disposeListener,
      viewStateListener,
    } of this.panels.values()) {
      bridge.dispose();
      disposeListener.dispose();
      viewStateListener?.dispose();
    }
    this.panels.clear();
  }
}
