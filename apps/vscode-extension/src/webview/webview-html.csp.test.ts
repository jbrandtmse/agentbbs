// Story 10.5, AC1 — the STRICT-CSP content-guard, MUTATION-TESTED non-vacuous (Rule 7 + Rule 10).
//
// The CSP is the security boundary of a surface that renders agent-authored markdown. This guard
// pins the load-bearing strict shape produced by `buildRoomWebviewHtml` — `default-src 'none'`, a
// per-load nonce on script + style, the narrow `'wasm-unsafe-eval'` token on `script-src` (REQUIRED
// for the byte-shared ui-shared Shiki/oniguruma WASM markdown renderer — its ABSENCE rendered every
// message body empty in the real webview; Epic 10 manual smoke #2), `img-src`/`font-src` pinned to
// the cspSource ONLY, `connect-src 'none'`, and NO `'unsafe-inline'`/`'unsafe-eval'`/wildcard — to
// the builder's OWN output. A regression that loosens ANY directive (a wildcard, a broad `unsafe-*`,
// a dropped nonce, a DROPPED `'wasm-unsafe-eval'`, a re-added `data:`) MUST turn a test RED here.
//
// NOTE: the *runtime* "WASM compiles → bodies actually render" behavior is NOT verifiable here —
// happy-dom does not enforce CSP. This guard PINS the CSP STRING; the lead's real Ext-Dev-Host
// smoke is the runtime evidence (Rule 12).
//
// The final MUTATION test proves the guard is non-vacuous WITHOUT mutating the production source
// (so `git diff` on webview-html.ts stays empty): it builds a set of plausible-WRONG CSP strings
// in-test (the loosenings a careless edit would introduce) and asserts the SAME structural
// assertions then FAIL. A guard that passes against both the strict CSP and a loosened one would
// guard nothing.
//
// Pure string builder — no DOM, no vscode. Discoverable by ROOT `pnpm test` (co-located .test.ts →
// node project; Rule 8).

import { describe, expect, it } from 'vitest';

import { buildRoomWebviewHtml } from './webview-html.js';

const NONCE = 'deadbeefcafef00ddeadbeefcafef00d';
const CSP_SOURCE = 'vscode-webview://abc123';

/** Build the room HTML with the standard fixture; `nonce` overridable for the fresh-nonce test. */
function buildHtml(nonce = NONCE): string {
  return buildRoomWebviewHtml({
    cspSource: CSP_SOURCE,
    nonce,
    scriptUri: 'https://abc123.vscode-webview/main.js',
    styleUris: [
      'https://abc123.vscode-webview/main.css',
      'https://abc123.vscode-webview/vscode-tokens.css',
    ],
    roomId: 'calling-interface',
    operatorHandle: 'operator',
  });
}

/** Extract the raw CSP directive string from the generated <meta http-equiv> tag. */
function cspOf(html: string): string {
  const idx = html.indexOf('Content-Security-Policy');
  expect(idx).toBeGreaterThanOrEqual(0);
  const after = html.slice(idx);
  const m = after.match(/content="([^"]*)"/);
  expect(m).not.toBeNull();
  // The builder HTML-escapes the single quotes in the attribute value; un-escape for matching.
  return m![1].replace(/&#39;|&apos;|&#x27;/giu, "'");
}

/** Split a CSP into a directive map keyed by the directive name. */
function directives(csp: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of csp.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const sp = trimmed.indexOf(' ');
    const name = sp === -1 ? trimmed : trimmed.slice(0, sp);
    map.set(name, trimmed);
  }
  return map;
}

/**
 * The structural strict-CSP assertions, factored out so the MUTATION test can run the EXACT SAME
 * checks against a deliberately-loosened CSP and confirm they fail. Returns nothing; throws (via
 * `expect`) on any violation.
 */
function assertStrictCsp(csp: string, nonce: string): void {
  const d = directives(csp);
  // The locked-down base.
  expect(d.get('default-src')).toBe(`default-src 'none'`);
  // Scripts: the per-load nonce + the narrow WASM token. `'wasm-unsafe-eval'` is REQUIRED here
  // (defect-fix, Epic 10 manual smoke #2): the byte-shared ui-shared markdown renderer compiles
  // Shiki's oniguruma WASM in-webview, which Chromium blocks without this token (→ empty message
  // bodies). It is the purpose-built WebAssembly token — NOT `'unsafe-inline'`/`'unsafe-eval'` —
  // so no JS-eval/inline-script surface opens (NFR12 inert rendering preserved). This is a PIN:
  // dropping the token (the regression that broke rendering) MUST turn this RED.
  expect(d.get('script-src')).toBe(
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
  );
  // Styles: nonce + own-origin only.
  expect(d.get('style-src')).toBe(`style-src ${CSP_SOURCE} 'nonce-${nonce}'`);
  // Images + fonts: own-origin ONLY (no data:/https:/wildcard).
  expect(d.get('img-src')).toBe(`img-src ${CSP_SOURCE}`);
  expect(d.get('font-src')).toBe(`font-src ${CSP_SOURCE}`);
  // Network: none.
  expect(d.get('connect-src')).toBe(`connect-src 'none'`);
  // No FORBIDDEN loosening tokens ANYWHERE in the CSP. We assert the two forbidden quoted tokens
  // PRECISELY: `'unsafe-inline'` and `'unsafe-eval'`. NOTE: `'wasm-unsafe-eval'` legitimately
  // contains the substring `unsafe-eval`, so a naive /unsafe-eval/ match would FALSE-FAIL — we
  // require the EXACT quoted `'unsafe-eval'` token (preceded by `'`, not by `wasm-`) to be absent.
  expect(csp).not.toContain(`'unsafe-inline'`);
  expect(csp).not.toContain(`'unsafe-eval'`);
  // The ONLY permitted `unsafe`-bearing token is the exact WASM token; nothing broader.
  expect(csp).not.toMatch(/(?<!wasm-)unsafe-eval/u);
  expect(csp).not.toContain('*');
  expect(csp).not.toContain('data:');
  expect(csp).not.toContain('https:');
}

describe('buildRoomWebviewHtml — strict CSP content-guard (Story 10.5 AC1)', () => {
  it('the produced CSP matches the strict shape exactly', () => {
    assertStrictCsp(cspOf(buildHtml()), NONCE);
  });

  it('a freshly supplied nonce flows verbatim into script-src/style-src + both tag attributes', () => {
    const fresh = 'feedface00000000feedface00000000';
    const html = buildHtml(fresh);
    assertStrictCsp(cspOf(html), fresh);
    expect(html).toContain(`'nonce-${fresh}'`);
    expect(html).toContain(`nonce="${fresh}"`);
    expect(html).not.toContain(NONCE);
  });

  // -------------------------------------------------------------------------------------------
  // MUTATION TEST (Rule 7 non-vacuity). The production source is NOT mutated (git diff on
  // webview-html.ts stays empty); instead we synthesize the loosenings a careless edit would
  // introduce and confirm the SAME `assertStrictCsp` checks go RED on each. If any loosened CSP
  // passed, the guard would be vacuous.
  // -------------------------------------------------------------------------------------------
  it('the guard goes RED against each plausible loosening (non-vacuous)', () => {
    const base = [
      `default-src 'none'`,
      `img-src ${CSP_SOURCE}`,
      `font-src ${CSP_SOURCE}`,
      `style-src ${CSP_SOURCE} 'nonce-${NONCE}'`,
      // Mirrors the production room CSP: nonce + the narrow WASM token.
      `script-src 'nonce-${NONCE}' 'wasm-unsafe-eval'`,
      `connect-src 'none'`,
    ];

    const loosenings: ReadonlyArray<readonly [string, string[]]> = [
      // script-src gains unsafe-inline (alongside the legitimate wasm token).
      [
        'script-src unsafe-inline',
        base.map((dir) =>
          dir.startsWith('script-src') ? `${dir} 'unsafe-inline'` : dir,
        ),
      ],
      // script-src gains unsafe-eval (the FORBIDDEN broad eval token, distinct from the permitted
      // 'wasm-unsafe-eval'). Proves the precise-token guard discriminates the two.
      [
        'script-src unsafe-eval',
        base.map((dir) =>
          dir.startsWith('script-src') ? `${dir} 'unsafe-eval'` : dir,
        ),
      ],
      // script-src DROPS the required wasm token (the exact regression that broke message-body
      // rendering — the PIN must turn RED on its absence).
      [
        'script-src missing wasm-unsafe-eval',
        base.map((dir) =>
          dir.startsWith('script-src') ? `script-src 'nonce-${NONCE}'` : dir,
        ),
      ],
      // The nonce is dropped from script-src (an unprotected/non-loading script).
      [
        'script-src missing nonce',
        base.map((dir) =>
          dir.startsWith('script-src') ? `script-src 'self'` : dir,
        ),
      ],
      // img-src re-admits data: (the dropped 10.4 grant).
      [
        'img-src data:',
        base.map((dir) => (dir.startsWith('img-src') ? `${dir} data:` : dir)),
      ],
      // img-src admits a https: wildcard.
      [
        'img-src https:',
        base.map((dir) => (dir.startsWith('img-src') ? `${dir} https:` : dir)),
      ],
      // connect-src opens up to a wildcard (would allow network exfil).
      [
        'connect-src *',
        base.map((dir) =>
          dir.startsWith('connect-src') ? `connect-src *` : dir,
        ),
      ],
      // default-src loosened away from 'none'.
      [
        'default-src loosened',
        base.map((dir) =>
          dir.startsWith('default-src') ? `default-src 'self'` : dir,
        ),
      ],
      // style-src gains unsafe-inline.
      [
        'style-src unsafe-inline',
        base.map((dir) =>
          dir.startsWith('style-src') ? `${dir} 'unsafe-inline'` : dir,
        ),
      ],
    ];

    for (const [label, parts] of loosenings) {
      const loosened = parts.join('; ');
      expect(
        () => assertStrictCsp(loosened, NONCE),
        `loosening "${label}" must turn the guard RED`,
      ).toThrow();
    }

    // Sanity: the UNmutated base passes the same assertion (proving the loosenings, not the
    // assertion shape, are what trip it).
    expect(() => assertStrictCsp(base.join('; '), NONCE)).not.toThrow();
  });
});
