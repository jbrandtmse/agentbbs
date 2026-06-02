// The room webview HTML shell + nonce/CSP builder (Story 10.4, AC2).
//
// The host injects this HTML into the room WebviewPanel. It references the BUILT webview bundle
// (dist/webview/main.js — react + ui-shared + the RoomView mount) and the side-effecting ui-shared
// CSS (tokens.css/markdown.css/room.css/chrome.css) PLUS the VS Code `--vscode-*` theme layer
// (vscode-tokens.css, loaded LAST so its `:root` overrides win — AC3), all via `asWebviewUri`.
//
// CSP (baseline for 10.4 — the FULL `default-src 'none'` hardening + retain/LRU/serializer is
// Story 10.5): a per-load NONCE gates the script + styles, and `webview.cspSource` allows the
// webview's own asset origin. NO `unsafe-inline` / `unsafe-eval` — the inert-markdown stack
// (markdown-it HTML-off → DOMPurify → Shiki class spans) needs no inline script/eval, which is
// exactly what makes the strict 10.5 CSP possible. The room id is passed to the bundle via a
// `data-room-id` attribute on the mount root (NOT an inline script — keeps the CSP clean).
//
// PURE (testable): no `vscode` import. The caller supplies the already-resolved webview URIs +
// the cspSource + a fresh nonce; this only assembles the string. A content-guard test asserts the
// CSP shape (nonce present; no unsafe-inline/unsafe-eval).

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
 * Build the room webview HTML. The CSP: scripts only the nonce'd bundle; styles only the nonce'd
 * <link>s + `webview.cspSource`; `img-src` allows the cspSource + data: (inert markdown may carry
 * data-uri-free images — code-as-text); everything else `'none'`. Inert markdown needs no inline
 * script/style, so NO `unsafe-inline` / `unsafe-eval` (the 10.5 strict-CSP precondition).
 *
 * @param options The resolved URIs + cspSource + nonce + room id.
 */
export function buildRoomWebviewHtml(options: WebviewHtmlOptions): string {
  const { cspSource, nonce, scriptUri, styleUris, roomId, operatorHandle } =
    options;

  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} https: data:`,
    `font-src ${cspSource}`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
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
    <div id="root" data-room-id="${escapeAttr(roomId)}" data-operator-handle="${escapeAttr(operatorHandle)}"></div>
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
