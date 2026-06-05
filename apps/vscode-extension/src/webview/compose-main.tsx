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
//
// EPIC-10 DEFECT-FIX (StrictMode-safe bridge lifecycle): see main.tsx. `acquireVsCodeApi()` can be
// invoked EXACTLY ONCE (it throws on a second call), and the bridge owns a `window` 'message'
// listener. Creating the bridge during render + disposing it from a `useEffect` cleanup hung the
// surface under React StrictMode (the throw-away first mount disposed the bridge; the remount could
// neither recreate it nor re-acquire the api). FIX: acquire the api + create the bridge ONCE at
// MODULE scope in `mount()` (outside the StrictMode tree) and pass them in as props.

import { StrictMode } from 'react';
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
 * The minimal `acquireVsCodeApi()` shape this surface uses (postMessage to the host). */
interface ComposeVsCodeApi {
  postMessage(message: unknown): void;
}

/**
 * The compose webview root — mounts {@link ComposeApp} over the MODULE-scope bridge (created once in
 * `mount()`, outside the StrictMode tree). Success/close fire host-directed frames the host listens
 * for (tree refresh + panel close). It holds NO bridge lifecycle of its own — a StrictMode
 * unmount/remount is harmless because the bridge + its window 'message' listener live at module
 * scope (the Epic-10 defect-fix; see the header).
 */
function ComposeRoot({
  bridge,
  api,
  kind,
  operatorHandle,
  projectId,
}: {
  bridge: Bridge;
  api: ComposeVsCodeApi;
  kind: ComposeKind;
  operatorHandle: string | null;
  projectId: string | null;
}) {
  return (
    <ComposeApp
      bridge={bridge}
      kind={kind}
      operatorHandle={operatorHandle}
      projectId={projectId}
      onSuccess={(payload) =>
        api.postMessage({ type: 'composeSuccess', payload })
      }
      onClose={() => api.postMessage({ type: 'composeClose' })}
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

  // Acquire the api + create the bridge ONCE, at module scope (outside the StrictMode tree). The
  // bridge's window 'message' listener stays live for the life of the webview; a StrictMode
  // mount/unmount/remount never disposes it (the defect this fix removes). No live fold for a
  // compose surface — it is a form; the only host frame it consumes is the live theme-kind.
  const api = acquireVsCodeApi();
  api.setState({ composeKind: kind, projectId });
  const bridge: Bridge = createPostMessageBridge(api, {
    // Re-apply the live theme-kind onto the mount root so the HC overrides flip live (the same
    // mechanism the room webview uses).
    onThemeKind: (k) => {
      rootElement.dataset['themeKind'] = k;
    },
  });

  createRoot(rootElement).render(
    <StrictMode>
      <ComposeRoot
        bridge={bridge}
        api={api}
        kind={kind}
        operatorHandle={operatorHandle}
        projectId={projectId}
      />
    </StrictMode>,
  );
}

mount();
