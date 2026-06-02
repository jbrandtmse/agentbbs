// The room webview ENTRY POINT (Story 10.4, AC2/AC4) — mounts the SAME ui-shared RoomView.
//
// Built as a SEPARATE esbuild bundle (platform:browser; react/react-dom/ui-shared BUNDLED — the
// webview is a browser context, distinct from the host CJS bundle). It mounts the byte-shared
// `@agentbbs/ui-shared` RoomView (NOT a fork — Rule 13; the component lives in src/webview/
// RoomApp.tsx so it is DOM-testable without this mount side effect) into #root, fed a
// RoomViewModel built from the host↔webview postMessage BRIDGE (readRoom + readContract), and
// imports the SAME side-effecting ui-shared CSS the web mounts PLUS the `--vscode-*` theme layer
// (vscode-tokens.css, loaded LAST so its :root overrides win — AC3). The room id + operator handle
// ride in on the mount root's data attributes (no inline script — keeps the nonce CSP clean).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The SAME side-effecting ui-shared stylesheets the web mounts (byte-shared), THEN the VS Code
// theme layer LAST so its :root `--vscode-*` overrides win (AC3 — the only per-surface delta).
import '@agentbbs/ui-shared/tokens.css';
import '@agentbbs/ui-shared/markdown.css';
import '@agentbbs/ui-shared/room.css';
import '@agentbbs/ui-shared/chrome.css';
import './vscode-tokens.css';

import { createPostMessageBridge } from './bridge-client.js';
import { RoomApp } from './RoomApp.js';

/**
 * The `acquireVsCodeApi` global the VS Code webview host injects (typed minimally). `setState`
 * persists a JSON-serializable object VS Code hands back to the extension's WebviewPanelSerializer
 * on a window reload (Story 10.5, AC2) — we persist `{ roomId }` so the panel re-attaches to its
 * room after a reload.
 */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

/** Read the mount root's data attributes (room id + operator handle) and mount the RoomApp. */
function mount(): void {
  const rootElement = document.getElementById('root');
  if (rootElement === null) {
    throw new Error('#root not found — the webview HTML shell is malformed.');
  }
  const roomId = rootElement.dataset['roomId'] ?? '';
  const handleAttr = rootElement.dataset['operatorHandle'] ?? '';
  const operatorHandle = handleAttr.length > 0 ? handleAttr : null;

  const api = acquireVsCodeApi();
  // Persist the room id so a window reload restores this panel to the right room (AC2). The
  // extension's WebviewPanelSerializer reads this `{ roomId }` back in deserializeWebviewPanel.
  api.setState({ roomId });

  const bridge = createPostMessageBridge(api);

  createRoot(rootElement).render(
    <StrictMode>
      <RoomApp
        bridge={bridge}
        roomId={roomId}
        operatorHandle={operatorHandle}
      />
    </StrictMode>,
  );
}

mount();
