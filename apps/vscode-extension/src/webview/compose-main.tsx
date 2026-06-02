// The COMPOSE webview ENTRY POINT (Story 10.7, AC2) — mounts ONE of the 4 byte-shared ui-shared
// INITIATE compose surfaces into the single reused compose WebviewPanel.
//
// Built as a SEPARATE esbuild bundle (dist/webview/compose.js, platform:browser, format:esm),
// distinct from the room bundle (dist/webview/main.js) but sharing the SAME side-effecting ui-shared
// CSS + the `--vscode-*` theme layer. It reads the mount root's data attributes (the compose KIND +
// the operator handle + the project scope + the initial theme-kind — no inline script, keeping the
// strict nonce CSP clean), creates the postMessage bridge (the SAME bridge-client the room webview
// uses), and mounts {@link ComposeApp}. ComposeApp lives in its own module so it is DOM-testable
// WITHOUT this mount side effect (the RoomApp.tsx discipline).
//
// HOST-DIRECTED FRAMES: on a successful write the surface posts `{ type:'composeSuccess', payload }`
// so the host refreshes the tree (and, for a posted announcement, can hand off to the navigable
// proto-room — the AC3 initiate→respond loop); on cancel/Esc it posts `{ type:'composeClose' }` so
// the host closes the panel. These are host→webview-CHANNEL frames only (NFR5 — no agent push).

import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
// The SAME side-effecting ui-shared stylesheets the web + the room webview mount (byte-shared), THEN
// the VS Code theme layer LAST so its :root `--vscode-*` overrides win.
import '@agentbbs/ui-shared/tokens.css';
import '@agentbbs/ui-shared/markdown.css';
import '@agentbbs/ui-shared/room.css';
import '@agentbbs/ui-shared/chrome.css';
import './vscode-tokens.css';

import { createPostMessageBridge } from './bridge-client.js';
import { ComposeApp, type ComposeKind } from './ComposeApp.js';

import type { Bridge } from './bridge-client.js';

/** The `acquireVsCodeApi` global the VS Code webview host injects (typed minimally). */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

/**
 * The stateful compose webview root — creates the bridge once, mirrors the live theme-kind onto the
 * mount root, and mounts {@link ComposeApp}. Success/close fire host-directed frames the host listens
 * for (tree refresh + panel close).
 */
function ComposeRoot({
  rootElement,
  kind,
  operatorHandle,
  projectId,
}: {
  rootElement: HTMLElement;
  kind: ComposeKind;
  operatorHandle: string | null;
  projectId: string | null;
}) {
  const bridgeRef = useRef<(Bridge & { dispose(): void }) | null>(null);
  const apiRef = useRef<ReturnType<typeof acquireVsCodeApi> | null>(null);

  if (bridgeRef.current === null) {
    const api = acquireVsCodeApi();
    apiRef.current = api;
    api.setState({ composeKind: kind, projectId });
    bridgeRef.current = createPostMessageBridge(api, {
      // Re-apply the live theme-kind onto the mount root so the HC overrides flip live (the same
      // mechanism the room webview uses). No live fold for a compose surface — it is a form.
      onThemeKind: (k) => {
        rootElement.dataset['themeKind'] = k;
      },
    });
  }

  useEffect(() => {
    return () => bridgeRef.current?.dispose();
  }, []);

  return (
    <ComposeApp
      bridge={bridgeRef.current}
      kind={kind}
      operatorHandle={operatorHandle}
      projectId={projectId}
      onSuccess={(payload) =>
        apiRef.current?.postMessage({ type: 'composeSuccess', payload })
      }
      onClose={() => apiRef.current?.postMessage({ type: 'composeClose' })}
    />
  );
}

/** Read the mount root's data attributes and mount the requested compose surface. */
function mount(): void {
  const rootElement = document.getElementById('root');
  if (rootElement === null) {
    throw new Error(
      '#root not found — the compose webview HTML shell is malformed.',
    );
  }
  const kind = (rootElement.dataset['composeKind'] ??
    'create-project') as ComposeKind;
  const handleAttr = rootElement.dataset['operatorHandle'] ?? '';
  const operatorHandle = handleAttr.length > 0 ? handleAttr : null;
  const projectIdAttr = rootElement.dataset['projectId'] ?? '';
  const projectId = projectIdAttr.length > 0 ? projectIdAttr : null;
  // The INITIAL theme-kind is already on the root (set by the HTML shell from the host's
  // activeColorTheme.kind); the `vscode-tokens.css` HC overrides key off the `data-theme-kind`
  // attribute directly, and `onThemeKind` re-applies it live — so no React seed is needed.

  createRoot(rootElement).render(
    <StrictMode>
      <ComposeRoot
        rootElement={rootElement}
        kind={kind}
        operatorHandle={operatorHandle}
        projectId={projectId}
      />
    </StrictMode>,
  );
}

mount();
