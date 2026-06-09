// ColorThemeKind → webview theme-kind token (Story 10.6, AC2).
//
// PURE + `vscode`-FREE: maps the NUMERIC `vscode.ColorThemeKind` enum value (1=Light, 2=Dark,
// 3=HighContrast, 4=HighContrastLight — VERIFIED against @types/vscode@1.120.0, Rule 3) to a
// stable string token the webview applies as a `data-theme-kind` attribute on the mount root. The
// `vscode-tokens.css` HC overrides key off `[data-theme-kind^="high-contrast"]`, so the high-contrast
// (dark AND light) branches collapse to a `high-contrast`-prefixed token; the non-HC light/dark
// kinds are emitted distinctly for completeness (the `--vscode-*` layer already adapts light↔dark
// from the injected variables — the explicit token is the HC switch the CSS needs).
//
// Taking the NUMERIC value (not importing `vscode`) keeps this unit-testable in the node project AND
// usable in both the host (extension.ts reads `window.activeColorTheme.kind`) and a test.

/** The webview theme-kind tokens (the `data-theme-kind` attribute values). */
export type WebviewThemeKind =
  | 'light'
  | 'dark'
  | 'high-contrast'
  | 'high-contrast-light';

/** The numeric `vscode.ColorThemeKind` values (Rule 3 — verified against @types/vscode@1.120.0). */
export const COLOR_THEME_KIND = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
} as const;

/**
 * Map a numeric `vscode.ColorThemeKind` to its {@link WebviewThemeKind} token. An unknown value
 * defaults to `'dark'` (the ui-shared canonical default + the `vscode-tokens.css` fallback palette),
 * so a future enum member never crashes the theme switch — it degrades to the safe default.
 *
 * @param kind The numeric `vscode.window.activeColorTheme.kind`.
 */
export function webviewThemeKind(kind: number): WebviewThemeKind {
  switch (kind) {
    case COLOR_THEME_KIND.Light:
      return 'light';
    case COLOR_THEME_KIND.Dark:
      return 'dark';
    case COLOR_THEME_KIND.HighContrast:
      return 'high-contrast';
    case COLOR_THEME_KIND.HighContrastLight:
      return 'high-contrast-light';
    default:
      return 'dark';
  }
}

/** True iff the token is a high-contrast theme (dark OR light) — the branch the HC CSS keys off. */
export function isHighContrast(token: WebviewThemeKind): boolean {
  return token === 'high-contrast' || token === 'high-contrast-light';
}
