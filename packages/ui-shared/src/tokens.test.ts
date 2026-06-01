// QA hardening (Story 9.1) — TOKEN-CORE COMPLETENESS / drift guard.
//
// The contrast suite (contrast.test.ts) proves the AA floor for the ~5 load-bearing
// color COMBOS; the DOM suite (TokenProbe.test.tsx) proves one token RESOLVES + flips.
// Neither asserts that the WHOLE semantic color ramp is present in BOTH theme scopes.
// A dropped or renamed token (e.g. someone deletes `--accent-hover` from the light
// scope, or typos `--agreed-line` in one scope only) would slip past both — the
// "one token core, per-surface theming" property quietly breaks for that role, and a
// later consumer that reads `var(--dropped)` in light mode renders the wrong/empty
// value with no test going red.
//
// This guard pins the FULL set of semantic color roles (Rule 10 spirit — to the
// SHIPPED tokens.css, parsed from the file, not a hand-copy of the values) and
// asserts every role is defined in BOTH the dark `:root` scope and the light
// `:root[data-theme='light']` scope, and that the two scopes define EXACTLY the same
// role set (symmetry). The expected role NAMES are the consumer-facing semantic roles
// from DESIGN.md `colors:` (the `-light` suffix is a prose disambiguator only, per the
// tokens.css header), so a drift from the DESIGN.md role vocabulary also goes red.
//
// Mutation-tested non-vacuous (Rule 7), recorded in the QA section of the story:
//   - Deleting `--accent-hover` from the light scope → "light scope defines every
//     semantic color role" RED (and the symmetry test RED).
//   - tokens.css restored byte-identical (sha256 verified) after each mutation.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
);

/**
 * The canonical consumer-facing semantic COLOR roles, lifted from DESIGN.md
 * `colors:` (dropping the `-light` prose suffix — both themes redefine the SAME
 * names). This is the role VOCABULARY the surfaces consume; both scopes must define
 * exactly this set so `var(--role)` resolves in either theme.
 */
const SEMANTIC_COLOR_ROLES = [
  // surfaces
  '--surface-base',
  '--surface-panel',
  '--surface-input',
  '--code-panel',
  // borders
  '--border',
  '--border-soft',
  // text ramp
  '--text',
  '--text-body',
  '--text-strong',
  '--text-muted',
  '--text-dim',
  '--text-faint',
  // accent
  '--accent',
  '--accent-hover',
  '--accent-on-dark',
  '--accent-fg',
  '--selection',
  // agreed
  '--agreed-green',
  '--agreed-line',
  // flag-warm
  '--flag-warm',
  '--flag-warm-text',
  // badge / chip / inline-code
  '--badge-bg',
  '--badge-fg',
  '--chip-bg',
  '--code-inline-bg',
  // code syntax tints
  '--code-keyword',
  '--code-type',
  '--code-fn',
  '--code-comment',
] as const;

/** Parse the `--name: #hex;` color declarations from a single selector block. */
function parseColorRoles(selectorRegex: RegExp): Set<string> {
  const match = selectorRegex.exec(css);
  if (!match) {
    throw new Error(
      `tokens.css: selector block not found for ${selectorRegex}`,
    );
  }
  const body = match[1];
  const roles = new Set<string>();
  const declRe = /(--[a-z0-9-]+)\s*:\s*#[0-9a-fA-F]{3,6}\s*;/gu;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(body)) !== null) {
    roles.add(m[1]);
  }
  return roles;
}

// Same scope-isolation as contrast.test.ts: the dark block is the FIRST `:root { … }`,
// the light block is `:root[data-theme='light'] { … }`.
const darkRoles = parseColorRoles(/:root\s*\{([\s\S]*?)\}\s*\/\*/u);
const lightRoles = parseColorRoles(
  /:root\[data-theme='light'\]\s*\{([\s\S]*?)\}\s*$/u,
);

describe('token-core completeness — every semantic color role in BOTH theme scopes', () => {
  it('dark :root scope defines every semantic color role from DESIGN.md', () => {
    const missing = SEMANTIC_COLOR_ROLES.filter((r) => !darkRoles.has(r));
    expect(missing, `missing in dark scope: ${missing.join(', ')}`).toEqual([]);
  });

  it("light :root[data-theme='light'] scope defines every semantic color role", () => {
    const missing = SEMANTIC_COLOR_ROLES.filter((r) => !lightRoles.has(r));
    expect(missing, `missing in light scope: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('the dark and light scopes define EXACTLY the same color-role set (symmetry)', () => {
    // Neither scope may carry a role the other lacks — that would make a consumer
    // theme-dependent in a way the token core forbids.
    const onlyDark = [...darkRoles].filter((r) => !lightRoles.has(r));
    const onlyLight = [...lightRoles].filter((r) => !darkRoles.has(r));
    expect(onlyDark, `roles only in dark: ${onlyDark.join(', ')}`).toEqual([]);
    expect(onlyLight, `roles only in light: ${onlyLight.join(', ')}`).toEqual(
      [],
    );
  });

  it('each scope defines no UNEXPECTED color role beyond the DESIGN.md vocabulary', () => {
    // Catches a stray/renamed color token that drifted from the documented role set.
    const expected = new Set<string>(SEMANTIC_COLOR_ROLES);
    const strayDark = [...darkRoles].filter((r) => !expected.has(r));
    const strayLight = [...lightRoles].filter((r) => !expected.has(r));
    expect(strayDark, `unexpected dark roles: ${strayDark.join(', ')}`).toEqual(
      [],
    );
    expect(
      strayLight,
      `unexpected light roles: ${strayLight.join(', ')}`,
    ).toEqual([]);
  });
});
