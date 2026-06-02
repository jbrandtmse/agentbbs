// @agentbbs/vscode-extension — the VS Code operator surface.
//
// This module is the extension-host ENTRY POINT (the package `main`, bundled to
// dist/extension.cjs by esbuild). It is a THIN CLIENT (NFR2 / project-rules Rule 13): it
// imports @agentbbs/core / @agentbbs/data-access / @agentbbs/ui-shared, but NEVER a SQLite
// driver directly (only @agentbbs/data-access does, transitively) and NO board logic lives
// here.
//
// Story 10.1 scope: prove the scaffold ACTIVATES + the SQLite driver loads in the host.
// Story 10.2 scope (this): on activate, OPEN the shared ledger via @agentbbs/data-access's
// node:sqlite adapter (AC1), reusing resolveDbPath (AGENTBBS_DB / project-root walk-up); close
// it on deactivate. The postMessage bridge (src/bridge.ts) is ready for the webview-bearing
// stories (10.4) to bind to a real webview — its dispatch + delta-poll logic is proven by
// bridge.test.ts and the real-host ledger probe.

import * as vscode from 'vscode';

import { ComposePanelManager } from './compose-panel.js';
import { openLedger } from './db.js';
import { RoomPanelManager, ROOM_PANEL_VIEW_TYPE } from './room-panel.js';
import { createRoomPanelSerializer } from './serializer.js';
import {
  BoardTreeProvider,
  BOARD_TREE_VIEW_ID,
  OPEN_ROOM_COMMAND,
  JOIN_PROJECT_COMMAND,
  CREATE_PROJECT_COMMAND,
  POST_ANNOUNCEMENT_COMMAND,
  SET_FOCUS_COMMAND,
} from './tree/BoardTreeProvider.js';
import { BoardDecorationProvider } from './tree/decorations.js';
import { resolveOperatorHandle } from './tree/operator-handle.js';
import { webviewThemeKind } from './webview/theme-kind.js';

import type { BoardTreeNode } from './tree/BoardTreeProvider.js';
import type { PanelLike } from './room-panel.js';
import type { OpenedLedger } from './db.js';

/** Activation log marker — asserted by the host smoke / surfaced in the host log. */
export const ACTIVATION_LOG = '[agentbbs] extension activated';

/** Command id: re-read the board model + refresh the tree/decorations. */
export const REFRESH_COMMAND = 'agentbbs.refresh';

/** The default refresh poll interval (ms) — re-reads the model so live escalations/unread show. */
export const DEFAULT_REFRESH_INTERVAL_MS = 2000;

/** The host's single opened ledger handle, held for the lifetime of the activation. */
let ledger: OpenedLedger | undefined;

/** The board tree provider (held so deactivate can dispose it). */
let treeProvider: BoardTreeProvider | undefined;
/** The room WebviewPanel manager (Story 10.4) — held so deactivate can dispose the bridges. */
let roomPanels: RoomPanelManager | undefined;
/** The compose WebviewPanel manager (Story 10.7) — held so deactivate can dispose the bridge. */
let composePanels: ComposePanelManager | undefined;
/** The refresh poll timer (held so deactivate can clear it). */
let refreshTimer: NodeJS.Timeout | undefined;

/**
 * Extension activation entry point. Invoked by the VS Code extension host on the first
 * activation event.
 *
 * Opens the shared SQLite ledger via @agentbbs/data-access (node:sqlite adapter; AC1) and holds
 * the handle for the session. Registers a trivial command as the activation proof + logs an
 * activation line. Kept thin (Rule 13) — no board logic; the DB handle is the seam the bridge
 * (and the 10.3+ views) delegate every op to.
 */
export function activate(context: vscode.ExtensionContext): void {
  // Open the shared ledger (AGENTBBS_DB / project-root walk-up, via data-access). A failure to
  // open must not crash activation — log it; the views/bridge surface the error to the operator.
  try {
    ledger = openLedger();
    console.log(`${ACTIVATION_LOG} (ledger: ${ledger.dbPath})`);
  } catch (err) {
    ledger = undefined;
    console.error(
      `[agentbbs] failed to open the ledger: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.log(ACTIVATION_LOG);
  }

  // A trivial registered command — invoking it proves the extension activated and its command
  // surface is live. Disposed automatically via context.subscriptions.
  const disposable = vscode.commands.registerCommand(
    'agentbbs.helloAbiProof',
    () => {
      void vscode.window.showInformationMessage(
        'AgentBBS extension is active.',
      );
    },
  );
  context.subscriptions.push(disposable);

  // The native board tree (Story 10.3) — only wired when the ledger opened. The tree reads via
  // the data-access handle + core ops DIRECTLY (host-side; the bridge is for the room webviews).
  if (ledger !== undefined) {
    registerBoardTree(context, ledger);
  }
}

/**
 * Resolve the operator handle from the `agentbbs.operatorHandle` setting (then `AGENTBBS_OPERATOR`
 * env), canonicalized to the ledger form so the NEEDS YOU `add_participant` match lands. `null`
 * → watching-only (empty NEEDS YOU; global read still works).
 */
function readOperatorHandle(): string | null {
  const setting = vscode.workspace
    .getConfiguration('agentbbs')
    .get<string>('operatorHandle');
  return resolveOperatorHandle(setting);
}

/**
 * Register the native TreeView + FileDecorationProvider + the open-room/join/refresh commands,
 * and start a light refresh poll. The open-room command (Story 10.4) opens the room as a
 * WebviewPanel via {@link RoomPanelManager} — one panel per room, reveal-not-duplicate; every row
 * (active OR a navigable proto-room) is selectable + carries the command (Rule 15).
 */
function registerBoardTree(
  context: vscode.ExtensionContext,
  openedLedger: OpenedLedger,
): void {
  const provider = new BoardTreeProvider(
    openedLedger.dataAccess,
    readOperatorHandle(),
  );
  treeProvider = provider;

  const decorations = new BoardDecorationProvider(provider);

  const treeView = vscode.window.createTreeView(BOARD_TREE_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    treeView,
    provider,
    decorations,
    vscode.window.registerFileDecorationProvider(decorations),
  );

  // Story 10.4 — the room WebviewPanel manager. Each room opens as an editor-tab webview mounting
  // the built ui-shared bundle (dist/webview/main.js + main.css) + the VS Code theme layer, fed by
  // a per-panel bridge over the shared ledger (Rule 13 — the SAME core ops an agent uses). The
  // localResourceRoots is the extension's dist/ so the webview can load its own bundle/CSS.
  const distRoot = vscode.Uri.joinPath(context.extensionUri, 'dist');
  const scriptRef = vscode.Uri.joinPath(distRoot, 'webview', 'main.js');
  const cssRef = vscode.Uri.joinPath(distRoot, 'webview', 'main.css');
  const manager = new RoomPanelManager({
    dataAccess: openedLedger.dataAccess,
    assetUris: { script: scriptRef, styles: [cssRef] },
    iconPath: new vscode.ThemeIcon('comment-discussion'),
    resolveOperatorHandle: () => readOperatorHandle(),
    // Story 10.6 (AC2) — the INITIAL theme-kind for a freshly-opened panel (so HC applies on first
    // paint). Live re-theming of OPEN panels is the onDidChangeActiveColorTheme subscription below.
    resolveThemeKind: () =>
      webviewThemeKind(vscode.window.activeColorTheme.kind),
    createPanel: (roomId, title, retain): PanelLike => {
      const panel = vscode.window.createWebviewPanel(
        ROOM_PANEL_VIEW_TYPE,
        title,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          // Story 10.5 (AC2): the manager bounds how many panels are created retained (the LRU
          // cap) so live-DOM memory stays bounded; a panel beyond the cap is created non-retained
          // and re-renders on focus.
          retainContextWhenHidden: retain,
          localResourceRoots: [distRoot],
        },
      );
      // The structural PanelLike the manager drives — the real vscode.WebviewPanel satisfies it.
      return panel as unknown as PanelLike;
    },
  });
  roomPanels = manager;
  context.subscriptions.push({ dispose: () => manager.dispose() });

  // Story 10.7 — the operator INITIATE compose surfaces as a SINGLE reused WebviewPanel (native
  // panel-exclusivity: one initiate surface at a time, reveal+swap; distinct from rooms-as-tabs).
  // Each surface mounts the byte-shared ui-shared compose component (the compose bundle) fed by a
  // per-panel bridge → the SAME core ops an agent uses (Rule 13). On a successful write the manager
  // refreshes the tree so a posted announcement appears as a NAVIGABLE proto-room (the AC3
  // initiate→respond loop).
  const composeScriptRef = vscode.Uri.joinPath(
    distRoot,
    'webview',
    'compose.js',
  );
  const composeCssRef = vscode.Uri.joinPath(distRoot, 'webview', 'compose.css');
  const composeManager = new ComposePanelManager({
    dataAccess: openedLedger.dataAccess,
    assetUris: { script: composeScriptRef, styles: [composeCssRef] },
    iconPath: new vscode.ThemeIcon('edit'),
    resolveOperatorHandle: () => readOperatorHandle(),
    resolveThemeKind: () =>
      webviewThemeKind(vscode.window.activeColorTheme.kind),
    onSuccess: () => {
      // The initiate→respond loop (Rule 15): re-read the model so a created project / posted
      // announcement (a navigable proto-room) appears live in the tree the operator can then open.
      void refreshBoard(provider, decorations);
    },
    createPanel: (title): PanelLike => {
      const panel = vscode.window.createWebviewPanel(
        'agentbbs.compose',
        title,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [distRoot],
        },
      );
      return panel as unknown as PanelLike;
    },
  });
  composePanels = composeManager;
  context.subscriptions.push({ dispose: () => composeManager.dispose() });

  // Live re-theme the open compose panel too (alongside the room panels), so the HC overrides flip
  // without a reload (host→its-own-webview only; NFR5 preserved).
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      composeManager.postThemeKind(webviewThemeKind(theme.kind));
    }),
  );

  // Story 10.6 (AC2) — re-theme OPEN room panels LIVE when the operator switches color theme
  // (light↔dark↔high-contrast). VS Code re-injects its `--vscode-*` variables automatically, but the
  // HIGH-CONTRAST overrides in vscode-tokens.css key off the `data-theme-kind` attribute the webview
  // sets from the host — so we must push the new kind. Host→its-own-webviews only (NFR5 preserved).
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      manager.postThemeKind(webviewThemeKind(theme.kind));
    }),
  );

  // Story 10.5 (AC2) — the WebviewPanelSerializer. On a window reload, VS Code calls
  // deserializeWebviewPanel for each persisted room panel; the serializer re-attaches it to its
  // room via the manager (adoptPanel: re-set HTML + fresh bridge + re-read + map adoption so
  // reveal-not-duplicate survives the reload). Registered during activate (the matching
  // `onWebviewPanel:agentbbs.room` activation event is declared in package.json).
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(
      ROOM_PANEL_VIEW_TYPE,
      createRoomPanelSerializer(manager),
    ),
  );

  // The open-room command (Story 10.4) — open the room as a WebviewPanel (reveal-not-duplicate).
  // The Story-10.7 INITIATE commands open the single reused compose panel (reveal+swap per kind):
  //   - JOIN_PROJECT fills the tree's `＋ join a project…` seam (the picker computes joinable
  //     host-side via the bridge reads, then joinBoard on choose).
  //   - POST_ANNOUNCEMENT is project-scoped: fired from the `announcements (N)` indicator inline
  //     action, it receives that node so the post targets THAT project (operator↔agent parity — an
  //     agent can post into a room-less board it belongs to, so the operator must be able to too).
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_ROOM_COMMAND, (roomId: string) => {
      manager.openRoom(roomId);
    }),
    vscode.commands.registerCommand(JOIN_PROJECT_COMMAND, () => {
      composeManager.open('join-project');
    }),
    vscode.commands.registerCommand(CREATE_PROJECT_COMMAND, () => {
      composeManager.open('create-project');
    }),
    vscode.commands.registerCommand(SET_FOCUS_COMMAND, () => {
      composeManager.open('focus');
    }),
    vscode.commands.registerCommand(
      POST_ANNOUNCEMENT_COMMAND,
      (node?: BoardTreeNode) => {
        // The inline action passes the announcements-indicator node (project-scoped). A
        // command-palette invocation (no node) opens unscoped — the surface gates on a missing
        // project at submit (the operator picks via the indicator action in practice).
        const projectId =
          node !== undefined && 'projectId' in node ? node.projectId : null;
        composeManager.open('post-announcement', projectId);
      },
    ),
    vscode.commands.registerCommand(REFRESH_COMMAND, () => {
      void refreshBoard(provider, decorations);
    }),
  );

  // Initial load + a light poll so live escalations / unread surface (the rich live-fold UX is
  // Story 10.6; refresh-on-demand + a poll is enough here). The interval is unref'd so it never
  // keeps the host alive on its own.
  void refreshBoard(provider, decorations);
  refreshTimer = setInterval(() => {
    void refreshBoard(provider, decorations);
  }, DEFAULT_REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}

/** Re-read the model (re-resolving the operator handle) + signal both providers. */
async function refreshBoard(
  provider: BoardTreeProvider,
  decorations: BoardDecorationProvider,
): Promise<void> {
  provider.setOperatorHandle(readOperatorHandle());
  await provider.refresh();
  decorations.refresh();
}

/**
 * Extension deactivation hook. Closes the ledger handle opened at activation (Story 10.2) so the
 * node:sqlite connection is released cleanly on shutdown. The command disposable is owned by
 * context.subscriptions and torn down by the host.
 */
export function deactivate(): void {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (roomPanels !== undefined) {
    roomPanels.dispose();
    roomPanels = undefined;
  }
  if (composePanels !== undefined) {
    composePanels.dispose();
    composePanels = undefined;
  }
  if (treeProvider !== undefined) {
    treeProvider.dispose();
    treeProvider = undefined;
  }
  if (ledger !== undefined) {
    try {
      ledger.dataAccess.close();
    } catch {
      /* a double-close / already-closed connection is harmless on shutdown */
    }
    ledger = undefined;
  }
}
