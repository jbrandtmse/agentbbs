// QA seam coverage (Story 10.4, AC2) — the nonce-CSP HTML content-guard, HARDENED.
//
// The dev's room-panel.test.ts asserts the happy-path CSP shape (nonce present, no unsafe-*,
// theme layer last). This file is the Rule-10 CONTENT-GUARD on the load-bearing CSP claims of the
// webview shell, pinned to the builder's OWN output and MUTATION-TESTED-style assertions on EVERY
// CSP directive that makes the strict 10.5 CSP possible. The CSP is the security boundary of a
// surface that renders agent-authored markdown — a regression that loosens `default-src`, drops
// the nonce, or admits `unsafe-inline`/`unsafe-eval` must turn a test RED here, one story before
// 10.5 hardens it further.
//
// SEAM the dev tests skipped: (1) EACH CSP directive asserted independently (not just the
// happy-path substring), so a drift in any one fails loud; (2) the per-load nonce is on BOTH the
// script AND every style link AND inside the script-src/style-src directives (a partial nonce ships
// a non-loading or unprotected asset); (3) NO inline `<script>` body and NO inline `style=` attr in
// the shell (the inert-markdown stack needs neither — an inline script in the shell would need
// `unsafe-inline` and break the strict CSP); (4) untrusted room id / handle / URIs are
// attribute-escaped so a planted `"><script>` in any of them cannot break out of its attribute
// (the markdown body stays inert via ui-shared's DOMPurify — proven in 9.2; THIS guards the SHELL).
// Discoverable by ROOT `pnpm test` (co-located .test.ts → node project; Rule 8). Pure string
// builder — no DOM, no vscode.

import { describe, expect, it } from 'vitest';

import { buildRoomWebviewHtml, generateNonce } from './webview-html.js';

const NONCE = 'deadbeefcafef00ddeadbeefcafef00d';

function build(
  overrides: Partial<Parameters<typeof buildRoomWebviewHtml>[0]> = {},
): string {
  return buildRoomWebviewHtml({
    cspSource: 'vscode-webview://abc123',
    nonce: NONCE,
    scriptUri: 'https://abc123.vscode-webview/main.js',
    styleUris: [
      'https://abc123.vscode-webview/main.css',
      'https://abc123.vscode-webview/vscode-tokens.css',
    ],
    roomId: 'calling-interface',
    operatorHandle: 'operator',
    ...overrides,
  });
}

/** Extract the CSP directive string from the generated <meta http-equiv> tag. */
function cspOf(html: string): string {
  const m = html.match(
    /content="(default-src[^"]*)"\s*\/>\s*<meta name="viewport"/,
  );
  // The CSP meta is the first content="…" after Content-Security-Policy.
  const idx = html.indexOf('Content-Security-Policy');
  expect(idx).toBeGreaterThanOrEqual(0);
  const after = html.slice(idx);
  const cm = after.match(/content="([^"]*)"/);
  expect(cm).not.toBeNull();
  return (m?.[1] ?? cm![1]).replace(/&#39;|&apos;/g, "'");
}

describe('buildRoomWebviewHtml — CSP directive content-guard (AC2, Rule 10 hardened)', () => {
  it('default-src is none (the locked-down base — everything must be allowlisted)', () => {
    const csp = cspOf(build());
    expect(csp).toMatch(/default-src 'none'/);
  });

  it("script-src admits the per-load nonce + the narrow 'wasm-unsafe-eval' token — no host, no broad unsafe-*", () => {
    const csp = cspOf(build());
    const scriptSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBeDefined();
    // The nonce + the WASM token the byte-shared ui-shared Shiki markdown renderer requires
    // (Epic 10 manual smoke #2 — without it every message body rendered empty). 'wasm-unsafe-eval'
    // permits WebAssembly ONLY; it is NEITHER 'unsafe-inline' NOR the broad 'unsafe-eval'.
    expect(scriptSrc).toBe(`script-src 'nonce-${NONCE}' 'wasm-unsafe-eval'`);
    // The exact-match above already forbids the FORBIDDEN tokens; assert explicitly so a regression
    // is unmistakable. NOTE: 'wasm-unsafe-eval' contains the substring `unsafe-eval`, so assert the
    // exact quoted forbidden tokens (not a bare substring) to avoid a false-fail on the wasm token.
    expect(scriptSrc).not.toContain(`'unsafe-inline'`);
    expect(scriptSrc).not.toContain(`'unsafe-eval'`);
    expect(scriptSrc).not.toContain('*');
  });

  it('style-src admits the nonce + the webview cspSource only — no unsafe-inline', () => {
    const csp = cspOf(build());
    const styleSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('style-src'));
    expect(styleSrc).toBeDefined();
    expect(styleSrc).toContain(`'nonce-${NONCE}'`);
    expect(styleSrc).toContain('vscode-webview://abc123');
    expect(styleSrc).not.toContain('unsafe-inline');
  });

  // ---- Story 10.5 strict-CSP hardening: img-src/font-src/connect-src pinned to the minimum. ----

  it('img-src is pinned to the cspSource ONLY — no data:, no https: wildcard (10.5: inert markdown renders no images)', () => {
    const csp = cspOf(build());
    const imgSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('img-src'));
    expect(imgSrc).toBeDefined();
    // Own-origin only. The 10.4 `https: data:` grant is GONE (the markdown stack emits no images).
    expect(imgSrc).toBe('img-src vscode-webview://abc123');
    expect(imgSrc).not.toContain('data:');
    expect(imgSrc).not.toContain('https:');
    expect(imgSrc).not.toContain('*');
  });

  it('font-src is pinned to the cspSource ONLY — no wildcard (10.5: CSS bundles no @font-face)', () => {
    const csp = cspOf(build());
    const fontSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('font-src'));
    expect(fontSrc).toBeDefined();
    expect(fontSrc).toBe('font-src vscode-webview://abc123');
    expect(fontSrc).not.toContain('data:');
    expect(fontSrc).not.toContain('*');
  });

  it("connect-src is 'none' — the webview is postMessage-only, ZERO network (NFR12 inert)", () => {
    const csp = cspOf(build());
    const connectSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('connect-src'));
    expect(connectSrc).toBeDefined();
    expect(connectSrc).toBe(`connect-src 'none'`);
    expect(connectSrc).not.toContain('*');
    expect(connectSrc).not.toContain('https:');
  });

  it('the WHOLE CSP carries no wildcard, no FORBIDDEN unsafe-* (only the narrow wasm token), and no data:/https: scheme (strict floor)', () => {
    const csp = cspOf(build());
    expect(csp).not.toContain(`'unsafe-inline'`);
    expect(csp).not.toContain(`'unsafe-eval'`);
    // The ONLY permitted unsafe-bearing token is the exact 'wasm-unsafe-eval'; nothing broader.
    expect(csp).not.toMatch(/(?<!wasm-)unsafe-eval/u);
    expect(csp).not.toContain('*');
    expect(csp).not.toContain('data:');
    expect(csp).not.toContain('https:');
  });

  it('the document carries NO inline <script> body and NO inline style= attribute (strict-CSP precondition)', () => {
    const html = build();
    // The only <script> is the nonce'd module with a src — never an inline body.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]+<\/script>/i);
    // No inline style="…" attribute anywhere (would need 'unsafe-inline' to apply).
    expect(html).not.toMatch(/\sstyle=/i);
  });

  it('the per-load nonce is on the script tag AND every style <link>', () => {
    const html = build();
    expect(html).toMatch(
      new RegExp(`<script[^>]*\\bnonce="${NONCE}"[^>]*\\bsrc=`),
    );
    // Two style links → two nonce'd <link>s.
    const linkNonces = [...html.matchAll(/<link[^>]*\bnonce="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(linkNonces).toEqual([NONCE, NONCE]);
  });

  it('a freshly generated nonce flows verbatim into the CSP and the tags (no stale/hard-coded nonce)', () => {
    const fresh = generateNonce();
    const html = build({ nonce: fresh });
    expect(html).toContain(`'nonce-${fresh}'`);
    expect(html).toContain(`nonce="${fresh}"`);
    // The default placeholder nonce must NOT appear when a different one is supplied.
    expect(html).not.toContain(NONCE);
  });
});

describe('buildRoomWebviewHtml — untrusted-input attribute escaping (AC2, shell break-out guard)', () => {
  it('a planted "><script> in the room id cannot break out of the data attribute', () => {
    const html = build({ roomId: '"><script>alert(1)</script>' });
    // The injected payload is escaped — no live <script> tag, the quote is encoded.
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('a planted "><script> in the operator handle is attribute-escaped (HOST-surface field)', () => {
    const html = build({ operatorHandle: '"><script>steal()</script>' });
    expect(html).not.toMatch(/<script>steal\(\)<\/script>/);
    expect(html).toContain('data-operator-handle="&quot;&gt;&lt;script&gt;');
  });

  it('a malicious style URI cannot inject a second attribute or tag', () => {
    const html = build({
      styleUris: [
        'https://x/a.css" onload="evil()',
        'https://x/vscode-tokens.css',
      ],
    });
    expect(html).not.toContain('onload="evil()"');
    expect(html).toContain('&quot; onload=&quot;evil()');
  });
});
