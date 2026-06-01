// Focus-ring contrast + reduced-motion CSS-floor guards (Story 9.10, Task 4 + Task 5).
//
// Pure-node (no DOM): runs the SHIPPED WCAG math (the same `contrastRatio` consumers use) over
// the SHIPPED token hexes parsed from tokens.css, and pins the chrome.css a11y floor to its
// SOURCE (the actual stylesheet). Two guards:
//
//   1. FOCUS RING ≥3:1 (WCAG 2.1 SC 1.4.11 non-text contrast — Research-First). The focus ring
//      is `--accent` (DESIGN: "focus ring = accent"). It must clear 3:1 against the surfaces it
//      is drawn over (the panel sidebar + the base main column), in BOTH themes. (Rule 10 — pin
//      the claim to the token, not a re-typed hex.)
//   2. chrome.css ships the `:focus-visible` ring rule + the `prefers-reduced-motion: reduce`
//      gate + the `.sr-only` helper (the EXPERIENCE.md floor). A drift (a deleted rule) is RED.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../contrast.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(path.resolve(here, '../tokens.css'), 'utf8');
const chromeCss = readFileSync(path.resolve(here, 'chrome.css'), 'utf8');

/** Parse `--name: #hex;` declarations from a single selector block (dark vs light scopes). */
function parseBlock(selectorRegex: RegExp): Record<string, string> {
  const match = selectorRegex.exec(tokensCss);
  if (!match)
    throw new Error(`tokens.css: block not found for ${selectorRegex}`);
  const body = match[1] ?? '';
  const out: Record<string, string> = {};
  const decl = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(body)) !== null) out[m[1]!] = m[2]!;
  return out;
}

const dark = parseBlock(/:root\s*\{([\s\S]*?)\n\}/);
const light = parseBlock(/:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/);

describe('focus ring contrast — AA non-text floor (WCAG 2.1 SC 1.4.11, ≥3:1) (AC3)', () => {
  // The focus ring (--accent) over each ground it can land on, in each theme.
  const cases: { theme: 'dark' | 'light'; ground: string }[] = [
    { theme: 'dark', ground: '--surface-base' },
    { theme: 'dark', ground: '--surface-panel' },
    { theme: 'light', ground: '--surface-base' },
    { theme: 'light', ground: '--surface-panel' },
  ];

  for (const { theme, ground } of cases) {
    it(`${theme}: focus ring (--accent) clears 3:1 over ${ground}`, () => {
      const tokens = theme === 'dark' ? dark : light;
      const ring = tokens['--accent'];
      const bg = tokens[ground];
      expect(ring, `${theme} --accent`).toBeDefined();
      expect(bg, `${theme} ${ground}`).toBeDefined();
      expect(contrastRatio(ring!, bg!)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('chrome.css a11y floor — pinned to the shipped stylesheet (AC3)', () => {
  it('ships the :focus-visible focus ring using the --accent token', () => {
    expect(chromeCss).toContain(':focus-visible');
    expect(chromeCss).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it('ships the prefers-reduced-motion: reduce gate that disables transitions/animations', () => {
    expect(chromeCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(chromeCss).toMatch(/transition-duration:\s*0\.001ms\s*!important/);
    expect(chromeCss).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
  });

  it('ships the .sr-only visually-hidden helper for the live region', () => {
    expect(chromeCss).toContain('.sr-only');
    // The clip pattern (not display:none, which would suppress SR announcement).
    expect(chromeCss).toMatch(/clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
  });
});
