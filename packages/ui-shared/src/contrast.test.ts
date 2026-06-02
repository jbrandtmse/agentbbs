// AC2 — measured contrast floor (AA, both modes).
//
// Rule 10 spirit: this test PINS the DESIGN.md contrast claims to the SHIPPED
// tokens.css values, not a re-typed hex list. It parses tokens.css directly
// (Approach 2 from the story Dev Notes) — reading the dark `:root` block and the
// light `:root[data-theme='light']` block as two separate scopes (the same
// property name, e.g. --text-body, is redefined in each) — and runs the real WCAG
// math (the SAME contrastRatio shipped to consumers) over the parsed values.
//
// Each load-bearing combo from the DESIGN.md table carries a PER-COMBO expected
// floor: 4.5 for normal small text, 3 for the one LARGE/UI-only color
// (agreed-green on white = 3.4:1). A blanket 4.5 assertion would false-fail that
// row; a blanket 3 would let a real small-text regression slip — so the floor is
// encoded per combo.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast.js';

const tokensCssPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'tokens.css',
);
const css = readFileSync(tokensCssPath, 'utf8');

/**
 * Extract the `--name: #hex;` declarations from a single selector block in the
 * shipped tokens.css. We isolate the block body by selector so the dark and light
 * redefinitions of the same property name do not collide.
 */
function parseBlock(selectorRegex: RegExp): Record<string, string> {
  const match = selectorRegex.exec(css);
  if (!match) {
    throw new Error(
      `tokens.css: selector block not found for ${selectorRegex}`,
    );
  }
  const body = match[1];
  const out: Record<string, string> = {};
  const declRe = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/gu;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(body)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

// Dark block = the FIRST `:root { … }` (the default ramp).
const dark = parseBlock(/:root\s*\{([\s\S]*?)\}\s*\/\*/u);
// Light block = `:root[data-theme='light'] { … }` (to end of file/block).
const light = parseBlock(/:root\[data-theme='light'\]\s*\{([\s\S]*?)\}\s*$/u);

/**
 * The DESIGN.md measured contrast table (story Dev Notes → Contrast targets).
 * `fg`/`bg` are TOKEN NAMES resolved against the parsed ramp for `mode`, so the
 * assertion runs on the SHIPPED hex, never a hand-copy. `floor` is the per-combo
 * AA floor; `documented` is the DESIGN.md measured ratio (sanity reference).
 */
interface Combo {
  label: string;
  mode: 'dark' | 'light';
  fg: string;
  bg: string;
  floor: number;
  documented: number;
}

const COMBOS: Combo[] = [
  // body text on surface-base
  {
    label: 'body text on surface-base (dark)',
    mode: 'dark',
    fg: '--text-body',
    bg: '--surface-base',
    floor: 4.5,
    documented: 11.3,
  },
  {
    label: 'body text on surface-base (light)',
    mode: 'light',
    fg: '--text-body',
    bg: '--surface-base',
    floor: 4.5,
    documented: 17.4,
  },
  // meta on surface (text-muted) — dark is the edge case, exactly ~4.5
  {
    label: 'meta on surface text-muted (dark, the edge)',
    mode: 'dark',
    fg: '--text-muted',
    bg: '--surface-base',
    floor: 4.5,
    documented: 4.5,
  },
  {
    label: 'meta on surface text-muted (light)',
    mode: 'light',
    fg: '--text-muted',
    bg: '--surface-base',
    floor: 4.5,
    documented: 5.1,
  },
  // handle accent — measured on the PANEL ground, not base
  {
    label: 'handle accent on panel accent-on-dark (dark)',
    mode: 'dark',
    fg: '--accent-on-dark',
    bg: '--surface-panel',
    floor: 4.5,
    documented: 4.6,
  },
  {
    label: 'handle accent on panel accent-light (light)',
    mode: 'light',
    fg: '--accent-on-dark',
    bg: '--surface-panel',
    floor: 4.5,
    documented: 5.3,
  },
  // NEEDS YOU text on its ground (flag-warm-text)
  {
    label: 'NEEDS YOU flag-warm-text on panel (dark)',
    mode: 'dark',
    fg: '--flag-warm-text',
    bg: '--surface-panel',
    floor: 4.5,
    documented: 8.9,
  },
  {
    label: 'NEEDS YOU flag-warm-text on white (light)',
    mode: 'light',
    fg: '--flag-warm-text',
    bg: '--surface-base',
    floor: 4.5,
    documented: 6.6,
  },
  // agreed-green on surface — dark is text-floor; light is LARGE/UI-only (≥3)
  {
    label: 'agreed-green on surface-base (dark, text-floor)',
    mode: 'dark',
    fg: '--agreed-green',
    bg: '--surface-base',
    floor: 4.5,
    documented: 7.3,
  },
  {
    label: 'agreed-green on white (light, LARGE/UI-only ≥3)',
    mode: 'light',
    fg: '--agreed-green',
    bg: '--surface-base',
    floor: 3,
    documented: 3.4,
  },
];

describe('AC2 — DESIGN.md contrast targets pinned to shipped tokens.css', () => {
  it('parsed both ramps from tokens.css (sanity: a few known hexes)', () => {
    expect(dark['--text-body']).toBe('#d4d4d4');
    expect(dark['--surface-base']).toBe('#1e1e1e');
    expect(light['--text-body']).toBe('#1e1e1e');
    expect(light['--surface-base']).toBe('#ffffff');
    // The light ramp genuinely redefines the name (not the dark value leaking in).
    expect(light['--text-body']).not.toBe(dark['--text-body']);
  });

  for (const combo of COMBOS) {
    it(`${combo.label} meets its AA floor (≥${combo.floor}:1)`, () => {
      const ramp = combo.mode === 'dark' ? dark : light;
      const fgHex = ramp[combo.fg];
      const bgHex = ramp[combo.bg];
      expect(fgHex, `missing ${combo.fg} in ${combo.mode} ramp`).toBeDefined();
      expect(bgHex, `missing ${combo.bg} in ${combo.mode} ramp`).toBeDefined();

      const ratio = contrastRatio(fgHex, bgHex);
      // Strict >= so a 4.49 cannot slip past the 4.5 floor (the dark text-muted
      // edge case is exactly at the floor — true WCAG ≈ 4.52).
      expect(ratio).toBeGreaterThanOrEqual(combo.floor);
      // Cross-check against the DESIGN.md documented ratio. Tolerance 1.0: it
      // confirms we resolved the INTENDED pair (a wrong pair is off by whole
      // integers) while absorbing DESIGN.md's table rounding. NOTE: every row
      // matches within ~0.05 EXCEPT 'body text on surface-base (light)': true
      // WCAG(#1e1e1e on #ffffff) = 16.67, but DESIGN.md documents 17.4 (Δ≈0.73,
      // a minor inaccuracy in the planning doc's reference number — NOT a token
      // problem; the AA floor is met with vast margin). Not a Rule-5 NFR tripwire:
      // the load-bearing AA-floor assertion above passes; only DESIGN.md's
      // measured-reference column is slightly off for this one pair.
      expect(Math.abs(ratio - combo.documented)).toBeLessThan(1);
    });
  }

  it('agreed-green on white is BELOW the 4.5 small-text floor (so it is correctly classified LARGE/UI-only)', () => {
    // Guards the per-combo-floor design: if someone blanket-asserted 4.5 they
    // would (correctly) fail here, which is why this row carries a ≥3 floor.
    const ratio = contrastRatio(
      light['--agreed-green'],
      light['--surface-base'],
    );
    expect(ratio).toBeLessThan(4.5);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
