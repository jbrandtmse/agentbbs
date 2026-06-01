// @vitest-environment happy-dom
//
// Structural unit tests for the renderMarkdown pipeline (Story 9.2 Task 1, AC #1).
// Complements the XSS-corpus guard (render-markdown.xss.test.ts) with positive
// fidelity assertions: the pipeline produces the expected GFM element set and
// emits fenced code as inert class-spans (no inline styles).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderMarkdown, renderMarkdownSync } from './render-markdown.js';
import { prewarmHighlighter } from './highlight.js';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('renderMarkdown — structural fidelity', () => {
  it('renders headings, paragraphs, lists, bold, blockquote', async () => {
    const doc = parse(
      await renderMarkdown(
        '# Title\n\npara\n\n- a\n- b\n\n**bold**\n\n> quote',
      ),
    );
    expect(doc.querySelector('h1')?.textContent).toBe('Title');
    expect(doc.querySelectorAll('ul li').length).toBe(2);
    expect(doc.querySelector('strong')?.textContent).toBe('bold');
    expect(doc.querySelector('blockquote')?.textContent).toContain('quote');
  });

  it('renders a GFM table by default (no plugin)', async () => {
    const doc = parse(
      await renderMarkdown('| h1 | h2 |\n|----|----|\n| a | b |'),
    );
    expect(doc.querySelector('table')).not.toBeNull();
    expect(doc.querySelectorAll('thead th').length).toBe(2);
    expect(doc.querySelectorAll('tbody td').length).toBe(2);
  });

  it('renders inline code as a non-pre <code>', async () => {
    const doc = parse(await renderMarkdown('use `npm install` here'));
    const code = [...doc.querySelectorAll('code')].find(
      (c) => c.closest('pre') === null,
    );
    expect(code?.textContent).toBe('npm install');
  });

  it('renders a fenced code block as inert class-spans, no inline style', async () => {
    const html = await renderMarkdown('```typescript\nconst x = 1;\n```');
    expect(html).toMatch(/class="code-block"/u);
    expect(html).toMatch(/data-code-block="true"/u);
    expect(html).toMatch(/code-(?:keyword|type|fn|comment)/u);
    const doc = parse(html);
    // No element carries an inline style attribute.
    for (const el of doc.body.querySelectorAll('*')) {
      expect(el.hasAttribute('style')).toBe(false);
    }
  });

  it('keeps a safe http link with its href', async () => {
    const doc = parse(await renderMarkdown('[x](https://example.com/p)'));
    expect(doc.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/p',
    );
  });

  it('renderMarkdownSync produces the same structure after prewarm', async () => {
    await prewarmHighlighter();
    const sync = renderMarkdownSync('```javascript\nconst y = 2;\n```');
    expect(sync).toMatch(/class="code-block"/u);
    expect(sync).toMatch(/code-(?:keyword|type|fn|comment)/u);
  });

  it('handles empty / whitespace body without throwing', async () => {
    expect(await renderMarkdown('')).toBe('');
    expect((await renderMarkdown('   ')).trim()).toBe('');
  });
});

// QA hardening (Story 9.2, AC #2 + NFR12): the code-block NEVER-WRAP + ~25-line CAP
// + horizontal-scroll behavior is class-driven CSS (markdown.css), and the strict
// style-src CSP NFR12 depends on requires the whole markdown stylesheet to carry NO
// inline-style escape hatch. happy-dom does not apply an external stylesheet to
// computed style, so we pin these load-bearing rules against the SHIPPED markdown.css
// SOURCE OF TRUTH (Rule 10 spirit — parsed from the file, not a hand-copy). A
// regression that lets code wrap, drops the cap, or removes the horizontal scroll
// would go RED here even though no DOM computed-style test would catch it.
describe('markdown.css — code-block never-wrap + cap contract (AC #2)', () => {
  const css = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'markdown.css'),
    'utf8',
  );

  /**
   * Extract the body of the CSS rule whose selector list contains `selector` as a
   * whole selector token (immediately followed by `,` `{` or whitespace+one of
   * those) — so `.code-block` does NOT spuriously match `.code-block--expanded`.
   */
  function ruleBody(selector: string): string {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    // selector token, then any rest of the selector list (no braces), then the body.
    const re = new RegExp(`${esc}(?=[\\s,{])[^{}]*\\{([^}]*)\\}`, 'u');
    const m = re.exec(css);
    return m ? m[1] : '';
  }

  it('code-block inner NEVER wraps (white-space: pre, NOT pre-wrap/pre-line)', () => {
    const body = ruleBody('.code-block-inner');
    expect(body, '.code-block-inner rule present').not.toBe('');
    // Must be exactly `pre` — `pre-wrap`/`pre-line` WOULD let code wrap, so the
    // value must be terminated by `;`/whitespace/end, never a `-`. (A naive
    // /pre\b/ is fooled because `-` is a word boundary inside `pre-wrap`.)
    expect(body, 'never-wrap requires white-space: pre exactly').toMatch(
      /white-space:\s*pre\s*(?:;|$)/u,
    );
    expect(body, 'must NOT be pre-wrap/pre-line').not.toMatch(
      /white-space:\s*pre-(?:wrap|line)/u,
    );
  });

  it('code-block scrolls horizontally for wide code (overflow-x: auto)', () => {
    const body = ruleBody('.code-block');
    expect(body).toMatch(/overflow-x:\s*auto/u);
  });

  it('code-block caps height (~25 lines) and expands via .code-block--expanded', () => {
    const capBody = ruleBody('.code-block');
    expect(capBody).toMatch(/max-height:/u);
    // 25 is the documented line cap (matches CODE_BLOCK_LINE_CAP).
    expect(capBody).toMatch(/\b25\b/u);
    const expandedBody = ruleBody('.code-block--expanded');
    expect(expandedBody).toMatch(/max-height:\s*none/u);
  });

  it('the whole markdown stylesheet has no inline-style escape hatch tokens', () => {
    // Sanity: the stylesheet itself is the styling surface — it must not, e.g.,
    // reintroduce a shiki color literal via an `[style]` attribute selector hack.
    expect(css).not.toMatch(/\[style\b/u);
  });
});
