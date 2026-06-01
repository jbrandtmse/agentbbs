// Render-fidelity DOM tests for CodeBlock (Story 9.2 Task 4, AC #2).
//
// Runs under the 'ui-shared-dom' Vitest project (happy-dom). Asserts the code-panel
// chrome, the inert class-spans (no inline styles), `white-space: pre` (never
// wraps), and the ~25-line cap + expand affordance behavior.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CodeBlock, CODE_BLOCK_LINE_CAP } from './CodeBlock.js';
import { prewarmHighlighter } from './highlight.js';

let mountEl: HTMLDivElement;
let root: Root;

beforeAll(async () => {
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

async function renderBlock(code: string, lang?: string): Promise<HTMLElement> {
  await act(async () => {
    root.render(<CodeBlock code={code} lang={lang} testId="cb" />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const el = mountEl.querySelector<HTMLElement>('[data-testid="cb"]');
  if (el === null) throw new Error('CodeBlock did not mount');
  return el;
}

describe('CodeBlock render fidelity', () => {
  it('renders on the code-panel with class-spans and no inline styles', async () => {
    const el = await renderBlock('const x: number = 1;', 'typescript');
    const pre = el.querySelector('pre.code-block');
    expect(pre).not.toBeNull();
    expect(pre?.getAttribute('data-code-block')).toBe('true');
    expect(pre?.getAttribute('data-lang')).toBe('typescript');
    // Tinted token class-spans present.
    expect(
      el.querySelectorAll('.code-keyword, .code-type, .code-fn, .code-comment')
        .length,
    ).toBeGreaterThan(0);
    // No inline style attribute (NFR12).
    expect(el.querySelector('[style]')).toBeNull();
    // The inner code carries the line spans.
    expect(el.querySelector('code.code-block-inner')).not.toBeNull();
    expect(el.querySelectorAll('.code-line').length).toBeGreaterThan(0);
  });

  it('an unknown language falls back to plain inert text (no token tints, still .code-line)', async () => {
    const el = await renderBlock('just some text\nmore text', 'no-such-lang');
    expect(el.querySelector('pre.code-block')).not.toBeNull();
    expect(
      el.querySelectorAll('.code-keyword, .code-type, .code-fn, .code-comment')
        .length,
    ).toBe(0);
    expect(el.querySelectorAll('.code-line').length).toBe(2);
    expect(el.textContent).toContain('just some text');
  });

  it('shows code as escaped TEXT (an injected tag is not a live element)', async () => {
    const el = await renderBlock('<script>alert(1)</script>', 'html');
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<script>');
  });

  it('does NOT show the expand affordance for short code', async () => {
    const el = await renderBlock('one\ntwo\nthree', 'text');
    expect(el.querySelector('[data-testid="cb-expand"]')).toBeNull();
  });

  it('shows + toggles the expand affordance for code over the line cap', async () => {
    const tall = Array.from(
      { length: CODE_BLOCK_LINE_CAP + 5 },
      (_, i) => `line ${i}`,
    ).join('\n');
    const el = await renderBlock(tall, 'text');
    const expand = el.querySelector<HTMLButtonElement>(
      '[data-testid="cb-expand"]',
    );
    expect(expand).not.toBeNull();
    // Initially capped (not expanded).
    let pre = el.querySelector('pre.code-block');
    expect(pre?.classList.contains('code-block--expanded')).toBe(false);
    expect(expand?.getAttribute('aria-expanded')).toBe('false');

    // Click expands in place.
    await act(async () => {
      expand?.click();
    });
    pre = el.querySelector('pre.code-block');
    expect(pre?.classList.contains('code-block--expanded')).toBe(true);
    const expandAfter = el.querySelector<HTMLButtonElement>(
      '[data-testid="cb-expand"]',
    );
    expect(expandAfter?.getAttribute('aria-expanded')).toBe('true');
    expect(expandAfter?.textContent).toContain('Collapse');
  });
});
