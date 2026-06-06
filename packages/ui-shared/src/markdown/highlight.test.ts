// Unit tests for the Shiki class-span tokenizer (highlight.ts).
//
// Pins the load-bearing NFR12 properties of the highlight path: output carries
// `class=` only (never `style=`/`color`), code is HTML-escaped (shown as TEXT),
// scopes classify to the four `.code-*` tints, and an unknown lang falls back to
// inert plain text. Pure (no DOM needed) — runs in the node project.

import { beforeAll, describe, expect, it } from 'vitest';

import {
  HIGHLIGHT_LANGS,
  highlightToInertHtml,
  prewarmHighlighter,
} from './highlight.js';
import { escapeHtml } from './escape-html.js';

// Stabilization (Story 11.0 AC2): initialize the singleton Shiki highlighter ONCE
// for this file before any per-test async call. Without this, each of the 6 direct
// `highlightToInertHtml(...)` calls independently awaits the lazy `createHighlighter`
// (oniguruma WASM) singleton; under full-suite PARALLEL load that first WASM init
// contends with the other Shiki-driving test files (render-markdown.test.ts,
// RoomApp.live.test.ts) and intermittently exceeds the implicit per-test timeout —
// the recurring `9.5-shiki-warmup` / `10.5` / `10.6` flake. Prewarming here is the
// established prewarm discipline (render-markdown.test.ts:70 does the same in-test);
// a generous explicit timeout covers the one-time cold WASM compile under load. The
// NFR12 assertions below are UNCHANGED — only the init timing is made deterministic.
beforeAll(async () => {
  await prewarmHighlighter();
}, 30_000);

describe('highlightToInertHtml — inert class-span output', () => {
  it('emits CSS-class spans, never inline style/color', async () => {
    const html = await highlightToInertHtml('const x = 1; // c', 'javascript');
    expect(html).not.toMatch(/style\s*=/iu);
    expect(html).not.toMatch(/color\s*:/iu);
    // The keyword `const` is tinted via a code-* class.
    expect(html).toMatch(/class="[^"]*code-(?:keyword|type|fn|comment)/u);
    // Per-line wrapper present.
    expect(html).toMatch(/<span class="code-line">/u);
  });

  it('HTML-escapes token text (code is TEXT, never executable)', async () => {
    const html = await highlightToInertHtml(
      'const s = "<script>";',
      'javascript',
    );
    expect(html).toMatch(/&lt;script&gt;/u);
    expect(html.toLowerCase()).not.toMatch(/<script[\s>]/u);
  });

  it('classifies a comment to code-comment', async () => {
    const html = await highlightToInertHtml('// hello', 'javascript');
    expect(html).toMatch(/class="[^"]*code-comment/u);
  });

  it('falls back to plain inert text for an unknown lang', async () => {
    const html = await highlightToInertHtml('<b>x</b>\ny', 'no-such-lang');
    // No token tints, but line-wrapped + escaped.
    expect(html).not.toMatch(/code-keyword|code-type|code-fn|code-comment/u);
    expect(html).toMatch(/&lt;b&gt;x&lt;\/b&gt;/u);
    expect(html.split('\n').length).toBe(2);
  });

  it('the bundled lang list is non-empty and includes common langs', () => {
    expect(HIGHLIGHT_LANGS).toContain('typescript');
    expect(HIGHLIGHT_LANGS).toContain('python');
    expect(HIGHLIGHT_LANGS.length).toBeGreaterThan(5);
  });

  // QA hardening (NFR12 + strict style-src CSP): a per-grammar regression could leak
  // an inline `style=`/`color:` for ONE language while others stay clean. Sweep a
  // representative set of bundled grammars over real tinted snippets and assert NONE
  // emits an inline style — the class-not-inline-style invariant must hold for every
  // language, not just JS. (Shiki's DEFAULT codeToHtml emits style="color:#…"; this
  // guard would go RED if the custom class-span path regressed to that.)
  it('emits NO inline style/color for ANY bundled language', async () => {
    const snippets: Partial<Record<string, string>> = {
      typescript: 'const x: number = 1; // c',
      python: 'def f(x):\n    return x  # c',
      json: '{"a": 1, "b": true}',
      bash: 'echo "hi" # c',
      sql: 'SELECT * FROM t -- c',
      css: '.a { color: red; }',
      rust: 'fn main() { let x = 1; }',
      go: 'func main() { x := 1 }',
      yaml: 'a: 1\nb: true',
    };
    for (const [lang, code] of Object.entries(snippets)) {
      const html = await highlightToInertHtml(code as string, lang);
      expect(html, `${lang}: inline style= leaked`).not.toMatch(/style\s*=/iu);
      expect(html, `${lang}: inline color: leaked`).not.toMatch(/color\s*:/iu);
      // class= is the ONLY styling hook present.
      expect(html, `${lang}: should carry class=`).toMatch(/class="/u);
    }
  });
});

describe('escapeHtml', () => {
  it('entity-encodes the five HTML-significant characters', () => {
    expect(escapeHtml('<a href="x" & \'y\'>')).toBe(
      '&lt;a href=&quot;x&quot; &amp; &#39;y&#39;&gt;',
    );
  });
});
