// The room webview HTML shell + nonce/CSP builder (Story 10.4, AC2).
//
// The host injects this HTML into the room WebviewPanel. It references the BUILT webview bundle
// (dist/webview/main.js — react + ui-shared + the RoomView mount) and the side-effecting ui-shared
// CSS (tokens.css/markdown.css/room.css/chrome.css) PLUS the VS Code `--vscode-*` theme layer
// (vscode-tokens.css, loaded LAST so its `:root` overrides win — AC3), all via `asWebviewUri`.
//
// CSP (STRICT — Story 10.5): `default-src 'none'`; scripts ONLY via a per-load NONCE; styles ONLY
// via the nonce + `webview.cspSource`; `img-src`/`font-src` pinned to `cspSource` (own-origin only,
// no `data:`/`https:` wildcard — the inert markdown renders NO images and the CSS bundles no font);
// `connect-src 'none'` (the webview talks to the host via `acquireVsCodeApi().postMessage` ONLY —
// ZERO network). NO `unsafe-inline` / `unsafe-eval` — the inert-markdown stack (markdown-it HTML-off
// → DOMPurify → Shiki class spans) needs no inline script/eval, which is exactly what makes the
// strict CSP possible.
//
// ONE narrow exception (the ROOM shell only — defect-fix, Epic 10 manual smoke #2): `script-src`
// also carries `'wasm-unsafe-eval'`. The byte-shared `@agentbbs/ui-shared` inert-markdown renderer
// highlights fenced code with Shiki, whose oniguruma regex engine is WebAssembly that is COMPILED
// in the webview (the wasm is inlined in the bundle — there is NO network fetch). Under Chromium
// (the Electron webview) a strict `script-src` with no wasm token blocks `WebAssembly.instantiate`,
// so Shiki's `createHighlighter` never resolves → `renderMarkdown` (which awaits the highlighter
// before producing ANY html) never resolves → EVERY message body renders empty. `'wasm-unsafe-eval'`
// is the purpose-built, narrow CSP token for WebAssembly; it is NOT `'unsafe-inline'` and NOT
// `'unsafe-eval'` (it permits WASM ONLY — no JS eval / inline-script surface), so the inert/no-script
// NFR12 guarantee and the "no unsafe-inline/unsafe-eval" Story-10.5 posture are PRESERVED. The
// COMPOSE shell renders only plain form inputs (no MarkdownView/Shiki), so its CSP stays wasm-free.
//
// The room id is passed to the bundle via a `data-room-id` attribute on the mount root (NOT an
// inline script — keeps the CSP clean). See buildRoomWebviewHtml for the per-directive justification.
//
// PURE (testable): no `vscode` import. The caller supplies the already-resolved webview URIs +
// the cspSource + a fresh nonce; this only assembles the string. A content-guard test asserts the
// CSP shape (nonce present; room `script-src` carries `'wasm-unsafe-eval'`; NO `'unsafe-inline'`/
// `'unsafe-eval'`; compose stays wasm-free).

/** The pieces the host resolves (via `webview.asWebviewUri`) and passes to the shell builder. */
export interface WebviewHtmlOptions {
  /** The `webview.cspSource` — the allowed origin for the webview's own assets. */
  cspSource: string;
  /** A fresh per-load nonce gating the script + style tags. */
  nonce: string;
  /** The `asWebviewUri` of the built bundle (dist/webview/main.js). */
  scriptUri: string;
  /** The `asWebviewUri`s of the stylesheets to link, IN ORDER (vscode-tokens.css must be LAST). */
  styleUris: string[];
  /** The room id the bundle mounts (passed via a data attribute — no inline script). */
  roomId: string;
  /**
   * The resolved operator handle, or `''` (watching-only). HOST-SURFACE/display-only — it drives
   * the operator POSTURE + the composer gate + the 👍 chip state in the view, exactly like the
   * web's `/api/me` handle. NOT an agent-contract field (Rule 13 — core/MCP untouched). Passed via
   * a data attribute (no inline script — keeps the CSP clean).
   */
  operatorHandle: string;
  /**
   * Story 10.6 (AC2) — the INITIAL webview theme-kind token (`light` / `dark` / `high-contrast` /
   * `high-contrast-light`), resolved host-side from `vscode.window.activeColorTheme.kind`. Placed on
   * the mount root as `data-theme-kind` so the `vscode-tokens.css` HC overrides apply on FIRST paint
   * (before any postMessage); the host re-pushes a `themeKind` frame on `onDidChangeActiveColorTheme`
   * so the webview re-themes live. Defaults to `dark` (the ui-shared canonical default).
   */
  themeKind?: string;
}

/**
 * Generate a Content-Security-Policy nonce — 32 hex chars from a CSPRNG. The host calls this once
 * per panel load. (Browser `crypto.getRandomValues` is available in the Electron host; we accept
 * an injected `randomBytes` only for testability — default uses the global crypto.)
 */
export function generateNonce(
  fillRandom: (arr: Uint8Array<ArrayBuffer>) => void = (arr) => {
    globalThis.crypto.getRandomValues(arr);
  },
): string {
  const bytes = new Uint8Array(16);
  fillRandom(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Build the room webview HTML with the STRICT Story-10.5 CSP. Every directive is pinned to the
 * minimum the room webview actually needs — no wildcard beyond `webview.cspSource`, no `data:`,
 * NO `unsafe-inline` / `unsafe-eval`:
 *
 *   - `default-src 'none'`     — locked-down base; everything must be allow-listed below.
 *   - `script-src 'nonce-<n>'` — ONLY the per-load-nonce'd bundle module (no host, no unsafe-*).
 *   - `style-src <cspSource> 'nonce-<n>'` — the nonce'd <link>s + the webview's own asset origin.
 *   - `img-src <cspSource>`    — own-origin ONLY. The inert-markdown stack renders NO images
 *                                 (`img` is not in ui-shared's DOMPurify ALLOWED_TAGS, and
 *                                 `src`/`srcset` are FORBID_ATTR), so the 10.4 `https: data:`
 *                                 grant is DROPPED — code-as-text never emits an image.
 *   - `font-src <cspSource>`   — own-origin ONLY. The ui-shared CSS declares no `@font-face`/
 *                                 `url()` (VS Code supplies fonts via `--vscode-font-family`),
 *                                 so this is the floor that admits a future bundled font without
 *                                 a wildcard.
 *   - `connect-src 'none'`     — the webview talks to the host via `acquireVsCodeApi().postMessage`
 *                                 ONLY; the bundle issues ZERO network requests (no fetch/
 *                                 EventSource/XMLHttpRequest/WebSocket — NFR12 inert).
 *
 * `script-src` ALSO carries `'wasm-unsafe-eval'` — the ONE narrow loosening (room shell only). The
 * byte-shared ui-shared markdown renderer highlights fenced code with Shiki, whose oniguruma engine
 * is WebAssembly COMPILED in-webview (inlined in the bundle, NO network fetch). Without this token
 * Chromium blocks the WASM compile → `createHighlighter` never resolves → `renderMarkdown` (which
 * awaits the highlighter first) never resolves → EVERY message body renders EMPTY (Epic 10 manual
 * smoke #2). `'wasm-unsafe-eval'` permits WebAssembly ONLY; it is NEITHER `'unsafe-inline'` NOR
 * `'unsafe-eval'` (no JS-eval / inline-script surface opens), so the inert/no-script NFR12 guarantee
 * and the strict Story-10.5 posture are preserved. (The compose shell renders no markdown, so its
 * CSP stays wasm-free — see {@link buildComposeWebviewHtml}.)
 *
 * @param options The resolved URIs + cspSource + nonce + room id.
 */
export function buildRoomWebviewHtml(options: WebviewHtmlOptions): string {
  const {
    cspSource,
    nonce,
    scriptUri,
    styleUris,
    roomId,
    operatorHandle,
    themeKind = 'dark',
  } = options;

  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource}`,
    `font-src ${cspSource}`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    // `'wasm-unsafe-eval'` permits the Shiki oniguruma WASM compile the byte-shared ui-shared
    // markdown renderer needs (see the builder JSDoc). It is NOT unsafe-inline/unsafe-eval — no
    // JS-eval surface; NFR12 inert rendering holds. Room shell only; compose stays wasm-free.
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `connect-src 'none'`,
  ].join('; ');

  const styleLinks = styleUris
    .map(
      (href) =>
        `<link rel="stylesheet" nonce="${nonce}" href="${escapeAttr(href)}" />`,
    )
    .join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${styleLinks}
    <title>AgentBBS room</title>
  </head>
  <body>
    <div id="root" data-room-id="${escapeAttr(roomId)}" data-operator-handle="${escapeAttr(operatorHandle)}" data-theme-kind="${escapeAttr(themeKind)}"></div>
    <script type="module" nonce="${nonce}" src="${escapeAttr(scriptUri)}"></script>
  </body>
</html>`;
}

/** The pieces the host resolves for a COMPOSE webview shell (Story 10.7). */
export interface ComposeWebviewHtmlOptions {
  /** The `webview.cspSource` — the allowed origin for the webview's own assets. */
  cspSource: string;
  /** A fresh per-load nonce gating the script + style tags. */
  nonce: string;
  /** The `asWebviewUri` of the built COMPOSE bundle (dist/webview/compose.js). */
  scriptUri: string;
  /** The `asWebviewUri`s of the stylesheets to link, IN ORDER (vscode-tokens.css must be LAST). */
  styleUris: string[];
  /**
   * Which of the 4 INITIATE compose surfaces to mount (`create-project` / `post-announcement` /
   * `join-project` / `focus`). Rides in on the mount root's `data-compose-kind` attribute (no
   * inline script — keeps the strict nonce CSP clean), exactly as the room shell passes the room id.
   */
  composeKind: string;
  /**
   * The resolved operator handle, or `''` (watching-only). HOST-SURFACE/display-only (Rule 13 —
   * core/MCP untouched) — it is the INITIATE actor + drives the watching-only gate the compose
   * surface renders. Passed via a data attribute (no inline script).
   */
  operatorHandle: string;
  /**
   * The PROJECT-SCOPE for a project-scoped compose surface (`post-announcement` targets THIS
   * project). `''` for the unscoped surfaces (create-project / join-project / focus). Passed via a
   * data attribute.
   */
  projectId?: string;
  /** The INITIAL webview theme-kind token (see {@link WebviewHtmlOptions.themeKind}). */
  themeKind?: string;
}

/**
 * Build the COMPOSE webview HTML with the strict Story-10.5 CSP. The deltas from
 * {@link buildRoomWebviewHtml} are the bundle it references (the compose bundle), the mount-root
 * data attributes (`data-compose-kind` + an optional `data-project-id` instead of `data-room-id`),
 * AND — deliberately — NO `'wasm-unsafe-eval'` on `script-src`. The 4 compose surfaces
 * (create-project / post-announcement / join-project / focus) render plain form inputs only; NONE
 * mounts the ui-shared MarkdownView, so no Shiki/oniguruma WASM compile ever runs here. The room
 * shell's narrow wasm token is therefore NOT carried into compose — keeping its CSP at the tighter
 * floor (no WASM permitted at all). Otherwise the strict posture is identical: `default-src 'none'`,
 * nonce'd script/style, own-origin img/font, `connect-src 'none'`, no unsafe-inline/unsafe-eval.
 *
 * @param options The resolved URIs + cspSource + nonce + the compose kind/scope/handle/theme.
 */
export function buildComposeWebviewHtml(
  options: ComposeWebviewHtmlOptions,
): string {
  const {
    cspSource,
    nonce,
    scriptUri,
    styleUris,
    composeKind,
    operatorHandle,
    projectId = '',
    themeKind = 'dark',
  } = options;

  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource}`,
    `font-src ${cspSource}`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `connect-src 'none'`,
  ].join('; ');

  const styleLinks = styleUris
    .map(
      (href) =>
        `<link rel="stylesheet" nonce="${nonce}" href="${escapeAttr(href)}" />`,
    )
    .join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${styleLinks}
    <title>AgentBBS compose</title>
  </head>
  <body>
    <div id="root" data-compose-kind="${escapeAttr(composeKind)}" data-project-id="${escapeAttr(projectId)}" data-operator-handle="${escapeAttr(operatorHandle)}" data-theme-kind="${escapeAttr(themeKind)}"></div>
    <script type="module" nonce="${nonce}" src="${escapeAttr(scriptUri)}"></script>
  </body>
</html>`;
}

/** Minimal attribute-value escaping for the URIs/CSP/room id placed into the HTML attributes. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
