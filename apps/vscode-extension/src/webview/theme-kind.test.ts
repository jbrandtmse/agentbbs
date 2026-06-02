// ColorThemeKind → webview theme-kind mapping tests (Story 10.6, AC2).
//
// Node tier (no DOM, no vscode): the pure numeric-enum → token mapping. The numeric values are
// PINNED to @types/vscode@1.120.0's ColorThemeKind (Light=1, Dark=2, HighContrast=3,
// HighContrastLight=4 — Rule 3, verified against the installed .d.ts). A content-guard test imports
// the REAL `vscode` enum is impossible in the node project (no vscode module), so we pin the numeric
// values via the COLOR_THEME_KIND constant + a comment citing the verification. Discoverable by ROOT
// `pnpm test` (co-located .test.ts → node project; Rule 8).

import { describe, expect, it } from 'vitest';

import {
  COLOR_THEME_KIND,
  isHighContrast,
  webviewThemeKind,
} from './theme-kind.js';

describe('webviewThemeKind — numeric ColorThemeKind → token (AC2, Rule 3)', () => {
  it('maps the verified @types/vscode@1.120.0 enum values to tokens', () => {
    // PINNED (Rule 3): these numeric values are the installed ColorThemeKind enum.
    expect(COLOR_THEME_KIND).toEqual({
      Light: 1,
      Dark: 2,
      HighContrast: 3,
      HighContrastLight: 4,
    });
    expect(webviewThemeKind(1)).toBe('light');
    expect(webviewThemeKind(2)).toBe('dark');
    expect(webviewThemeKind(3)).toBe('high-contrast');
    expect(webviewThemeKind(4)).toBe('high-contrast-light');
  });

  it('an unknown kind degrades to the safe `dark` default (never crashes the theme switch)', () => {
    expect(webviewThemeKind(0)).toBe('dark');
    expect(webviewThemeKind(99)).toBe('dark');
  });
});

describe('isHighContrast — the HC branch the CSS keys off (AC2)', () => {
  it('is true for BOTH high-contrast dark and high-contrast light, false otherwise', () => {
    expect(isHighContrast('high-contrast')).toBe(true);
    expect(isHighContrast('high-contrast-light')).toBe(true);
    expect(isHighContrast('dark')).toBe(false);
    expect(isHighContrast('light')).toBe(false);
  });
});
