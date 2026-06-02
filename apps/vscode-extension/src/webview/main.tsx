// The room webview ENTRY POINT (Story 10.4 mount; Story 10.6 live fold + theme + footer wiring).
//
// Built as a SEPARATE esbuild bundle (platform:browser; react/react-dom/ui-shared BUNDLED — the
// webview is a browser context, distinct from the host CJS bundle). It mounts the byte-shared
// `@agentbbs/ui-shared` RoomView (NOT a fork — Rule 13; the component lives in src/webview/
// RoomApp.tsx so it is DOM-testable without this mount side effect) into #root, fed a
// RoomViewModel built from the host↔webview postMessage BRIDGE (readRoom + readContract), and
// imports the SAME side-effecting ui-shared CSS the web mounts PLUS the `--vscode-*` theme layer
// (vscode-tokens.css, loaded LAST so its :root overrides win). The room id + operator handle +
// INITIAL theme-kind ride in on the mount root's data attributes (no inline script — keeps the
// nonce CSP clean).
//
// STORY 10.6 wiring (this file): the bridge is created with hooks so the webview CONSUMES the host
// frames — `onDelta` feeds the live RoomView fold (a tiny subscriber registry forwards delta events
// to RoomApp); `onThemeKind` re-applies the `data-theme-kind` attribute LIVE so the HC overrides flip
// when the operator switches color theme (AC2); `onStatus` drives the ConnectionFooter LED (AC3).

import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
// The SAME side-effecting ui-shared stylesheets the web mounts (byte-shared), THEN the VS Code
// theme layer LAST so its :root `--vscode-*` overrides win (the only per-surface delta).
import '@agentbbs/ui-shared/tokens.css';
import '@agentbbs/ui-shared/markdown.css';
import '@agentbbs/ui-shared/room.css';
import '@agentbbs/ui-shared/chrome.css';
import './vscode-tokens.css';

import { createPostMessageBridge } from './bridge-client.js';
import { RoomApp } from './RoomApp.js';
import { isHighContrast, type WebviewThemeKind } from './theme-kind.js';

import type { Bridge } from './bridge-client.js';
import type { ConnectionStatus } from '@agentbbs/ui-shared';

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

/**
 * The stateful webview root — holds the live connection status + the live theme-kind + a
 * delta-subscriber registry so the bridge's `onDelta` frames reach the RoomApp fold. Created once
 * per mount. The theme-kind drives BOTH the `data-theme-kind` attribute on the mount root (the
 * `vscode-tokens.css` HC overrides key off it) AND the RoomView `highContrast` prop (the agreed-wash
 * → transparent gate) — kept in sync by a single state value updated on each `onThemeKind` frame.
 */
function WebviewRoot({
  rootElement,
  roomId,
  operatorHandle,
  initialThemeKind,
}: {
  rootElement: HTMLElement;
  roomId: string;
  operatorHandle: string | null;
  initialThemeKind: WebviewThemeKind;
}) {
  const [status, setStatus] = useState<ConnectionStatus>('reconnecting');
  const [themeKind, setThemeKind] =
    useState<WebviewThemeKind>(initialThemeKind);
  // The single registered delta handler (RoomApp subscribes once); a ref so the bridge's onDelta —
  // created once below — always calls the CURRENT handler.
  const deltaHandlerRef = useRef<((events: unknown[]) => void) | null>(null);
  const bridgeRef = useRef<(Bridge & { dispose(): void }) | null>(null);

  if (bridgeRef.current === null) {
    const api = acquireVsCodeApi();
    // Persist the room id so a window reload restores this panel to the right room (Story 10.5).
    api.setState({ roomId });
    bridgeRef.current = createPostMessageBridge(api, {
      onDelta: ({ events }) => deltaHandlerRef.current?.(events),
      onThemeKind: (kind) => setThemeKind(kind as WebviewThemeKind),
      onStatus: setStatus,
    });
  }

  // Mirror the live theme-kind onto the mount root's data attribute (the HC CSS overrides key off it).
  useEffect(() => {
    rootElement.dataset['themeKind'] = themeKind;
  }, [rootElement, themeKind]);

  useEffect(() => {
    return () => bridgeRef.current?.dispose();
  }, []);

  const subscribeToDeltas = (handler: (events: unknown[]) => void) => {
    deltaHandlerRef.current = handler;
    return () => {
      deltaHandlerRef.current = null;
    };
  };

  return (
    <RoomApp
      bridge={bridgeRef.current}
      roomId={roomId}
      operatorHandle={operatorHandle}
      subscribeToDeltas={subscribeToDeltas}
      connectionStatus={status}
      highContrast={isHighContrast(themeKind)}
    />
  );
}

/** Read the mount root's data attributes (room id + operator handle + theme kind) and mount. */
function mount(): void {
  const rootElement = document.getElementById('root');
  if (rootElement === null) {
    throw new Error('#root not found — the webview HTML shell is malformed.');
  }
  const roomId = rootElement.dataset['roomId'] ?? '';
  const handleAttr = rootElement.dataset['operatorHandle'] ?? '';
  const operatorHandle = handleAttr.length > 0 ? handleAttr : null;
  // The INITIAL theme-kind is on the root (set by the HTML shell from the host's
  // activeColorTheme.kind); seed React state from it, then onThemeKind frames re-apply it live.
  const initialThemeKind = (rootElement.dataset['themeKind'] ??
    'dark') as WebviewThemeKind;

  createRoot(rootElement).render(
    <StrictMode>
      <WebviewRoot
        rootElement={rootElement}
        roomId={roomId}
        operatorHandle={operatorHandle}
        initialThemeKind={initialThemeKind}
      />
    </StrictMode>,
  );
}

mount();
