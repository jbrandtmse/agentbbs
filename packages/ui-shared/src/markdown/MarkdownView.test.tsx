// Render-fidelity DOM tests for MarkdownView (Story 9.2 Task 4, AC #2).
//
// Runs under the 'ui-shared-dom' Vitest project (happy-dom; IS_REACT_ACT_ENVIRONMENT
// set by test-setup-dom.ts). Renders the component into a real DOM and asserts the
// STRUCTURAL + token-class outcome (not pixels): a fenced code block produces
// class-spans inside a .code-block panel; a GFM table, inline code, blockquote,
// list, bold, and a safe link all render their expected elements; raw HTML is
// inert (no <script>).
//
// The render is async (Shiki highlighter loads once), so each test prewarms the
// highlighter, renders inside act(), and flushes microtasks before asserting.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MarkdownView } from './MarkdownView.js';
import { prewarmHighlighter } from './highlight.js';

let mountEl: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  // Warm the highlighter once so MarkdownView's synchronous seed path produces the
  // fully-tokenized output on first paint (and the async effect is a no-op upgrade).
  await prewarmHighlighter();
});

beforeEach(() => {
  mountEl = document.createElement('div');
  document.body.append(mountEl);
  root = createRoot(mountEl);
});

afterEach(() => {
  act(() => root.unmount());
  mountEl.remove();
});

/** Render `body` and flush the async render effect. */
async function renderView(body: string): Promise<HTMLElement> {
  await act(async () => {
    root.render(<MarkdownView body={body} testId="mv" />);
  });
  // Allow the async renderMarkdown promise + setState to settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const el = mountEl.querySelector<HTMLElement>('[data-testid="mv"]');
  if (el === null) throw new Error('MarkdownView did not mount');
  return el;
}

describe('MarkdownView render fidelity', () => {
  it('renders a fenced code block as class-spans inside a .code-block panel', async () => {
    const el = await renderView('```typescript\nconst x: number = 1;\n```');
    const pre = el.querySelector('pre.code-block');
    expect(pre).not.toBeNull();
    expect(pre?.getAttribute('data-code-block')).toBe('true');
    expect(pre?.getAttribute('data-lang')).toBe('typescript');
    // Token class-spans present (keyword/type tints), NOT inline styles.
    const tinted = el.querySelectorAll(
      '.code-keyword, .code-type, .code-fn, .code-comment',
    );
    expect(tinted.length).toBeGreaterThan(0);
    // No inline style attribute anywhere (NFR12 strict style-src).
    expect(el.querySelector('[style]')).toBeNull();
    // Code shown as text — the keyword `const` is present in textContent.
    expect(el.textContent).toContain('const');
  });

  it('renders a GFM table', async () => {
    const el = await renderView('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(el.querySelector('table')).not.toBeNull();
    expect(el.querySelectorAll('thead th').length).toBe(2);
    expect(el.querySelectorAll('tbody td').length).toBe(2);
  });

  it('renders inline code, blockquote, list, bold, and a safe link', async () => {
    const el = await renderView(
      'Some `inline` code.\n\n> a quote\n\n- one\n- two\n\n**bold** and [link](https://example.com)',
    );
    // Inline code: a <code> not inside a <pre>.
    const inlineCode = [...el.querySelectorAll('code')].find(
      (c) => c.closest('pre') === null,
    );
    expect(inlineCode?.textContent).toBe('inline');
    expect(el.querySelector('blockquote')?.textContent).toContain('a quote');
    expect(el.querySelectorAll('ul li').length).toBe(2);
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    const a = el.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
  });

  it('renders raw HTML in source as inert text (no <script>)', async () => {
    const el = await renderView('hi <script>alert(1)</script> there');
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<script>');
  });
});
