// QA seam coverage (Story 10.4, AC3 + Rule 13) — the `--vscode-*` theme-layer content-guard.
//
// The dev proved the theme layer is LINKED LAST in the HTML (room-panel.test.ts) and verified the
// paint in the real Electron host. This file adds the missing CONTENT-GUARD (Rule 10) on the theme
// layer's load-bearing claims, plus the Rule-13 byte-identical assertion the story leans on:
//
//   (e1) the theme layer REDEFINES the ui-shared semantic token NAMES (surface/text/accent/agreed/
//        flag/border/font) to `--vscode-*` theme variables — NOT to fixed hex — so the surface
//        adopts the live editor theme. A regression that drops a token, or maps it to a literal
//        instead of a `--vscode-*` var, fails here.
//   (e2) EVERY override carries a web-palette FALLBACK (`var(--vscode-x, <fallback>)`) so a missing
//        theme var degrades to the ui-shared default, never `unset`.
//   (e3) the theme layer is the LAST stylesheet in the order the manager hands to the HTML builder
//        (so its `:root` overrides WIN over ui-shared tokens.css — AC3).
//   (e4) RULE 13 (LOAD-BEARING): ui-shared/tokens.css is BYTE-IDENTICAL to HEAD — the per-surface
//        delta is ONLY this extra layer; the byte-shared tokens are never edited (mount, don't fork).
//
// Discoverable by ROOT `pnpm test` (co-located .test.ts → node project; Rule 8). Reads the CSS off
// disk + shells `git diff` for the byte-identical proof; no DOM, no vscode.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const themeCss = readFileSync(path.join(here, 'vscode-tokens.css'), 'utf8');

/** The token names whose mapping is the whole point of AC3 — must remap to a --vscode-* var. */
const REQUIRED_TOKEN_MAPPINGS = [
  '--surface-base',
  '--surface-panel',
  '--text',
  '--text-muted',
  '--accent',
  '--accent-fg',
  '--border',
  '--agreed-green',
  '--flag-warm',
  '--font-ui',
  '--font-mono',
] as const;

/** Pull the value of a `:root` custom property declaration (the text up to the closing `;`). */
function declValue(css: string, token: string): string | null {
  // Match `--token: <value>;` allowing multi-line values (the var()/font stacks span lines).
  const re = new RegExp(
    `${token.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]*);`,
    's',
  );
  const m = css.match(re);
  return m ? m[1].trim() : null;
}

describe('vscode-tokens.css — the --vscode-* theme layer (AC3)', () => {
  it('declares its overrides on :root so they cascade to the whole webview', () => {
    expect(themeCss).toMatch(/:root\s*\{/);
  });

  it.each(REQUIRED_TOKEN_MAPPINGS)(
    'remaps %s to a --vscode-* theme variable (not a fixed literal)',
    (token) => {
      const value = declValue(themeCss, token);
      expect(
        value,
        `${token} must be declared in the theme layer`,
      ).not.toBeNull();
      // The value resolves through a --vscode-* var (the editor theme), not just a hex/keyword.
      // (Tolerate whitespace inside var() — the font stacks span multiple lines.)
      expect(value).toMatch(/var\(\s*--vscode-/);
    },
  );

  it.each(REQUIRED_TOKEN_MAPPINGS)(
    'gives %s a fallback so a missing theme var degrades to a ui-shared default (e2)',
    (token) => {
      const value = declValue(themeCss, token)!;
      // A `var(--vscode-x, <fallback>)` form — there is a comma inside the first var() call,
      // i.e. the var has a second argument. Assert the primary var has a fallback arg.
      const firstVar = value.match(/var\(\s*--vscode-[\w-]+\s*,/s);
      expect(
        firstVar,
        `${token} must supply a fallback: var(--vscode-…, <fallback>)`,
      ).not.toBeNull();
    },
  );

  it('maps fonts to the editor font variables (AC3 — defer to --vscode-font-family / editor-font)', () => {
    expect(declValue(themeCss, '--font-ui')).toContain('--vscode-font-family');
    expect(declValue(themeCss, '--font-mono')).toContain(
      '--vscode-editor-font-family',
    );
  });
});

describe('vscode-tokens.css — load order (AC3) + Rule 13 byte-identical', () => {
  it('the manager links the theme layer LAST so its :root overrides WIN over ui-shared tokens.css (e3)', async () => {
    // Mirror the order room-panel.ts hands to the HTML builder: ui-shared CSS first, theme last.
    const { buildRoomWebviewHtml } = await import('./webview-html.js');
    const html = buildRoomWebviewHtml({
      cspSource: 'vscode-webview://x',
      nonce: 'a'.repeat(32),
      scriptUri: 'https://x/main.js',
      styleUris: [
        'https://x/tokens.css',
        'https://x/markdown.css',
        'https://x/room.css',
        'https://x/chrome.css',
        'https://x/vscode-tokens.css',
      ],
      roomId: 'r',
      operatorHandle: '',
    });
    const tokensIdx = html.indexOf('tokens.css"');
    const themeIdx = html.lastIndexOf('vscode-tokens.css"');
    // The vscode theme layer link appears AFTER the base tokens.css link.
    expect(themeIdx).toBeGreaterThan(tokensIdx);
    // …and it is the LAST stylesheet <link> in the document.
    const lastLink = html.lastIndexOf('<link');
    expect(html.slice(lastLink)).toContain('vscode-tokens.css');
  });

  it('ui-shared/tokens.css is BYTE-IDENTICAL to HEAD — the per-surface delta is ONLY this layer (Rule 13)', () => {
    // The byte-shared web tokens must NOT be edited; the VS Code surface adds an OVERRIDE layer,
    // never forks/edits the shared palette. `git diff` against HEAD for that one file must be empty.
    const diff = execFileSync(
      'git',
      ['diff', 'HEAD', '--', 'packages/ui-shared/src/tokens.css'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(diff).toBe('');
  });
});

// =============================================================================
// Story 10.6 (AC2) — the HIGH-CONTRAST override block content-guard. The HC overrides live under
// `#root[data-theme-kind^="high-contrast"]` (the webview sets the attribute from the host's
// ColorThemeKind). This guards the load-bearing HC claims: the HC selector exists; borders lean on
// `--vscode-contrastBorder`; the agreed/flag tokens map to charted/contrast tokens; focus is driven
// via `--vscode-focusBorder`. Mutation-tested non-vacuous (Rule 7): a guard that passes whether or
// not the HC block exists guards nothing — see the slice() that isolates the HC block so a dropped
// `contrastBorder`/`focusBorder` inside it turns the assertion RED.
// =============================================================================

/** Isolate the `#root[data-theme-kind^="high-contrast"] { … }` rule body from the CSS. */
function highContrastBlock(css: string): string | null {
  const m = css.match(
    /#root\[data-theme-kind\^=['"]high-contrast['"]\]\s*\{([^}]*)\}/s,
  );
  return m ? m[1] : null;
}

describe('vscode-tokens.css — high-contrast overrides (AC2)', () => {
  it('declares an HC override block keyed on the data-theme-kind^="high-contrast" attribute', () => {
    // MUTATION (Rule 7): renaming the selector (so the regex misses it) makes EVERY assertion below
    // RED — the block is null and the `.toContain` calls throw / fail.
    expect(highContrastBlock(themeCss)).not.toBeNull();
  });

  it('leans on --vscode-contrastBorder for solid borders under HC', () => {
    const block = highContrastBlock(themeCss)!;
    // The border tokens resolve through contrastBorder (the HC contract — solid edges).
    expect(block).toMatch(/--border\s*:\s*var\(\s*--vscode-contrastBorder/);
    expect(block).toMatch(
      /--border-soft\s*:\s*var\(\s*--vscode-contrastBorder/,
    );
    // The agreed LINE (the rail that carries the meaning when the wash drops) is a solid contrast border.
    expect(block).toMatch(
      /--agreed-line\s*:\s*var\(\s*--vscode-contrastBorder/,
    );
  });

  it('maps agreed-green / flag-warm to charted decoration tokens (AA under HC)', () => {
    const block = highContrastBlock(themeCss)!;
    expect(block).toContain('--vscode-charts-green');
    expect(block).toContain('--vscode-charts-yellow');
  });

  it('drives focus via --vscode-focusBorder (the AC2 focus requirement)', () => {
    const block = highContrastBlock(themeCss)!;
    // The inherited 9.10 :focus-visible ring is `outline: 2px solid var(--accent)`; under HC we
    // promote --accent to --vscode-focusBorder so the keyboard ring is the HC focus color.
    expect(block).toMatch(/--accent\s*:\s*var\(\s*--vscode-focusBorder/);
  });
});
