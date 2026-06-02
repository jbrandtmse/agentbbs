// AC3 — Integration AC (the token core is consumable by a React surface).
//
// Runs under the 'ui-shared-dom' Vitest project (environment: happy-dom; see the
// root vitest.config.ts). Renders the first in-package token consumer (TokenProbe)
// into a real DOM, applies the SHIPPED tokens.css, and asserts the semantic custom
// property resolves to the canonical value for the active theme — dark by default,
// flipping to light when the documented `data-theme="light"` attribute is set on
// the document root.
//
// Research-First note (verified empirically in this suite, recorded in the Dev
// Agent Record): happy-dom does NOT resolve `var()` SUBSTITUTION in
// getComputedStyle(el).color, and `:root`-declared custom properties do not
// reliably cascade to a CHILD element's computed style. The reliable primitive is
// reading the custom property on the element it is DECLARED on — :root, i.e.
// document.documentElement — via getComputedStyle(documentElement)
// .getPropertyValue('--token'). That is exactly the cascade source the consumer
// relies on, so the assertion is faithful, not a workaround. The component-render
// half proves TokenProbe mounts and carries the var() reference into the live DOM.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TokenProbe } from './TokenProbe.js';

const tokensCss = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
);

// Canonical DESIGN.md value for --text-body in each mode (the AC3 "resolves to the
// canonical value" target). Kept tiny + asserted both ways; the contrast test is
// the exhaustive tokens.css↔DESIGN.md pin.
const DARK_TEXT_BODY = '#d4d4d4';
const LIGHT_TEXT_BODY = '#1e1e1e';

let styleEl: HTMLStyleElement;
let mountEl: HTMLDivElement;

beforeEach(() => {
  // Default theme: dark (no data-theme attribute on :root).
  document.documentElement.removeAttribute('data-theme');
  styleEl = document.createElement('style');
  styleEl.textContent = tokensCss;
  document.head.append(styleEl);
  mountEl = document.createElement('div');
  document.body.append(mountEl);
});

afterEach(() => {
  styleEl.remove();
  mountEl.remove();
  document.documentElement.removeAttribute('data-theme');
});

/** Resolve a custom property on :root (the element the tokens are declared on). */
function rootToken(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

describe('AC3 — tokens.css token core is consumable by a React surface', () => {
  it('renders TokenProbe into the DOM carrying the var(--text-body) reference', () => {
    const root = createRoot(mountEl);
    act(() => {
      root.render(<TokenProbe label="hello" />);
    });

    const probe = mountEl.querySelector<HTMLElement>(
      '[data-testid="token-probe"]',
    );
    expect(probe).not.toBeNull();
    expect(probe?.textContent).toBe('hello');
    // The component wired the semantic token into the live DOM (inline style).
    expect(probe?.style.color).toBe('var(--text-body)');

    act(() => {
      root.unmount();
    });
  });

  it('resolves --text-body to the canonical DARK value by default', () => {
    expect(rootToken('--text-body')).toBe(DARK_TEXT_BODY);
    // surface-base too, to prove the whole dark ramp is the active scope.
    expect(rootToken('--surface-base')).toBe('#1e1e1e');
  });

  it('flips --text-body to the canonical LIGHT value when data-theme="light" is set', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    expect(rootToken('--text-body')).toBe(LIGHT_TEXT_BODY);
    expect(rootToken('--surface-base')).toBe('#ffffff');
    // And back to dark when the attribute is removed (the toggle is live).
    document.documentElement.removeAttribute('data-theme');
    expect(rootToken('--text-body')).toBe(DARK_TEXT_BODY);
  });
});
