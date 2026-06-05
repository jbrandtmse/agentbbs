// ComposePanelManager (Story 10.7, AC2/AC3) — the 4 operator INITIATE compose surfaces as a SINGLE
// reused VS Code WebviewPanel.
//
// NATIVE PANEL-EXCLUSIVITY (AC3 — the chosen model, documented): the web's single-open-initiate-panel
// exclusivity is DOM-specific (one inline panel slot in the React tree) and does NOT carry to VS Code.
// VS Code's native equivalent is a SINGLE reused `WebviewPanel`: opening any initiate surface REVEALS
// the one compose panel and SWAPS its HTML to the requested surface (create-project / post-announcement
// / join-project / focus). So at most ONE initiate surface is open at a time — distinct from the
// rooms-as-tabs model (RoomPanelManager, where multiple room panels coexist). Re-opening the SAME kind
// reveals it; opening a DIFFERENT kind swaps the content in place (one panel, never a second).
//
// Each surface mounts the SAME @agentbbs/ui-shared compose component (the byte-shared compose bundle),
// fed by a per-panel BRIDGE (src/bridge.ts) — the host invokes the SAME core ops an agent uses (Rule
// 13 — announceProject/postAnnouncement/joinBoard/updateFocus + the listProjects/boardDirectory/whoami
// reads; no fabricated op, no backdoor). On a successful write the webview posts a `composeSuccess`
// frame → the host refreshes the tree (and, for a posted announcement, the new proto-room appears as a
// NAVIGABLE row the operator can open + reply-to-activate — the AC3 initiate→respond loop). A
// `composeClose` frame closes the panel.
//
// THIN CLIENT (Rule 13): no board logic here — the manager wires the panel to the bridge, which
// composes core ops. `git diff HEAD -- packages/core packages/mcp-server packages/ui-shared` stays
// EMPTY (the compose components are MOUNTED, not forked). The bridge push is host→ITS-OWN-webview only
// (NFR5 pull-only preserved; agents keep `check`).
//
// TESTABILITY: the `vscode`-facing panel creation is injected via {@link ComposePanelFactory} so the
// reveal/swap/dispose logic is unit-testable with a fake panel (this module needs no `vscode` import).
// The real WebviewPanel lifecycle is the load-bearing Rule-12 evidence proven in the real Electron host.

import { createBridge } from './bridge.js';
import {
  buildComposeWebviewHtml,
  generateNonce,
} from './webview/webview-html.js';

import type { Bridge, Messaging } from './bridge.js';
import type { PanelLike, AssetUris } from './room-panel.js';
import type { DataAccess } from '@agentbbs/core';

/** The view type registered for the compose panel (the createWebviewPanel discriminator). */
export const COMPOSE_PANEL_VIEW_TYPE = 'agentbbs.compose';

/** The 4 INITIATE compose surfaces the panel can show (matches ComposeApp's ComposeKind). */
export type ComposeKind =
  | 'create-project'
  | 'post-announcement'
  | 'join-project'
  | 'focus';

/** A human title per surface (the tab chrome the host renders). */
const TITLE_BY_KIND: Record<ComposeKind, string> = {
  'create-project': 'start a project',
  'post-announcement': 'open a room',
  'join-project': 'join a project',
  focus: 'set your focus',
};

/**
 * Creates the single compose {@link PanelLike}. Production passes a closure over
 * `vscode.window.createWebviewPanel(COMPOSE_PANEL_VIEW_TYPE, title, ViewColumn.Active, options)`; a
 * test passes a fake. The manager owns the title/html/bridge wiring after creation.
 */
export type ComposePanelFactory = (title: string) => PanelLike;

/** Options for {@link ComposePanelManager}. */
export interface ComposePanelManagerOptions {
  /** The persistence port every bridge op delegates to (the host's node:sqlite handle). */
  dataAccess: DataAccess;
  /** Creates the compose panel (injected for testability; production wraps createWebviewPanel). */
  createPanel: ComposePanelFactory;
  /** The local resource refs for the COMPOSE bundle + stylesheets (resolved per-load via asWebviewUri). */
  assetUris: AssetUris;
  /** An optional icon to set on the panel (a `vscode.ThemeIcon`/Uri); opaque here. */
  iconPath?: unknown;
  /** Resolve the operator handle (or `null` → watching-only) for the mounted compose surface. */
  resolveOperatorHandle?: () => string | null;
  /** Resolve the CURRENT webview theme-kind token for the initial `data-theme-kind` (Story 10.6). */
  resolveThemeKind?: () => string;
  /**
   * Called after a SUCCESSFUL initiate write (the webview's `composeSuccess` frame) so the host
   * refreshes the tree — the AC3 initiate→respond loop (a posted announcement appears as a navigable
   * proto-room). The payload carries the created room/project id when present.
   */
  onSuccess?: (payload?: { roomId?: string; projectId?: string }) => void;
}

/** The held open compose panel + its bridge + disposables. */
interface HeldPanel {
  panel: PanelLike;
  bridge: Bridge;
  disposeListener: { dispose(): void };
  messageListener: { dispose(): void };
  /** Which surface the panel currently shows (so re-opening the same kind just reveals). */
  kind: ComposeKind;
}

/**
 * Manages the SINGLE reused compose WebviewPanel — native panel-exclusivity (one initiate surface at a
 * time). {@link open} reveals + swaps the panel to the requested kind; closing the panel (× / dispose)
 * tears down its bridge. The host wires `open` to the create/post/join/focus commands + the tree's
 * `＋ join a project…` row.
 */
export class ComposePanelManager {
  private held: HeldPanel | undefined;
  private readonly options: ComposePanelManagerOptions;

  constructor(options: ComposePanelManagerOptions) {
    this.options = options;
  }

  /** Whether the compose panel is currently open. */
  get isOpen(): boolean {
    return this.held !== undefined;
  }

  /** The surface the panel currently shows, or `undefined` (closed). For tests/diagnostics. */
  get currentKind(): ComposeKind | undefined {
    return this.held?.kind;
  }

  /**
   * Open the requested INITIATE compose surface — REVEAL + SWAP the single compose panel (native
   * panel-exclusivity, AC3). If the panel is already open: reveal it and (if a DIFFERENT kind) swap
   * its HTML/bridge to the new surface, in place — never a second panel. If closed: create it.
   *
   * @param kind The surface to show.
   * @param projectId The project scope for `post-announcement` (the target sub-board); ignored otherwise.
   */
  open(kind: ComposeKind, projectId: string | null = null): PanelLike {
    if (this.held !== undefined) {
      // Already open: reveal + swap content to the requested surface (one panel, swap in place).
      this.held.panel.reveal();
      this.held.panel.title = TITLE_BY_KIND[kind];
      this.held.kind = kind;
      // Re-bind a fresh bridge for the swapped surface + re-set the HTML for the new kind/scope.
      this.held.bridge.dispose();
      this.held.bridge = this.bindBridge(this.held.panel);
      this.setPanelHtml(this.held.panel, kind, projectId);
      return this.held.panel;
    }

    const panel = this.options.createPanel(TITLE_BY_KIND[kind]);
    panel.title = TITLE_BY_KIND[kind];
    if (this.options.iconPath !== undefined) {
      panel.iconPath = this.options.iconPath;
    }
    this.setPanelHtml(panel, kind, projectId);
    const bridge = this.bindBridge(panel);

    // Handle host-directed frames from the compose webview: composeSuccess → refresh the tree (the
    // initiate→respond loop); composeClose → close the panel.
    const messageListener = panel.webview.onDidReceiveMessage(
      (msg: unknown) => {
        if (typeof msg !== 'object' || msg === null) return;
        const frame = msg as { type?: string; payload?: unknown };
        if (frame.type === 'composeSuccess') {
          this.options.onSuccess?.(
            frame.payload as
              | { roomId?: string; projectId?: string }
              | undefined,
          );
        } else if (frame.type === 'composeClose') {
          this.close();
        }
      },
    );

    const disposeListener = panel.onDidDispose(() => {
      if (this.held !== undefined) {
        this.held.bridge.dispose();
        this.held.disposeListener.dispose();
        this.held.messageListener.dispose();
        this.held = undefined;
      }
    });

    this.held = { panel, bridge, disposeListener, messageListener, kind };
    return panel;
  }

  /** Close the compose panel (the cancel/Esc path) — disposes the panel, which tears down the bridge. */
  close(): void {
    // Calling the panel's dispose triggers onDidDispose → the held cleanup above.
    this.held?.panel.dispose?.();
  }

  /** Bind a per-panel bridge over the panel's webview messaging channel (the SAME core ops). */
  private bindBridge(panel: PanelLike): Bridge {
    const messaging: Messaging = {
      postMessage: (message) => {
        void panel.webview.postMessage(message);
      },
      onMessage: (handler) => {
        const sub = panel.webview.onDidReceiveMessage(handler);
        return () => sub.dispose();
      },
    };
    return createBridge({ dataAccess: this.options.dataAccess, messaging });
  }

  /** Generate + set the panel's compose HTML shell (a FRESH per-load nonce each call). */
  private setPanelHtml(
    panel: PanelLike,
    kind: ComposeKind,
    projectId: string | null,
  ): void {
    const scriptUri = panel.webview
      .asWebviewUri(this.options.assetUris.script)
      .toString();
    const styleUris = this.options.assetUris.styles.map((s) =>
      panel.webview.asWebviewUri(s).toString(),
    );
    panel.webview.html = buildComposeWebviewHtml({
      cspSource: panel.webview.cspSource,
      nonce: generateNonce(),
      scriptUri,
      styleUris,
      composeKind: kind,
      operatorHandle: this.options.resolveOperatorHandle?.() ?? '',
      projectId: projectId ?? '',
      themeKind: this.options.resolveThemeKind?.() ?? 'dark',
    });
  }

  /** Push a live theme-kind change to the open compose panel (host→its-own-webview only; NFR5). */
  postThemeKind(kind: string): void {
    if (this.held === undefined) return;
    void this.held.panel.webview.postMessage({ type: 'themeKind', kind });
  }

  /** Dispose the open panel's bridge + listeners (extension deactivate). The host owns the panel. */
  dispose(): void {
    if (this.held === undefined) return;
    this.held.bridge.dispose();
    this.held.disposeListener.dispose();
    this.held.messageListener.dispose();
    this.held = undefined;
  }
}
