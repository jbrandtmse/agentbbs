// WCAG 2.x relative-luminance + contrast-ratio utility (pure TS, no runtime dep).
//
// Test-support today (Story 9.1 AC2 pins the DESIGN.md AA contrast table to the
// SHIPPED tokens.css values via this math); exported from the barrel so the a11y
// story (9.10) can reuse it. Presentation-only — no board logic, no DOM.
//
// Formulae: WCAG 2.1 "relative luminance" and "contrast ratio" definitions.
//   - https://www.w3.org/WAI/WCAG21/Techniques/general/G18
//   - https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio

/** Parse a 3- or 6-digit hex color (with or without leading '#') to [r,g,b] 0–255. */
export function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.trim().replace(/^#/u, '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/u.test(full)) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }
  const int = Number.parseInt(full, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** sRGB channel (0–255) → linearized channel, per the WCAG transfer function. */
function linearizeChannel(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0 = black … 1 = white) of an sRGB hex color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * linearizeChannel(r) +
    0.7152 * linearizeChannel(g) +
    0.0722 * linearizeChannel(b)
  );
}

/**
 * WCAG contrast ratio between two sRGB hex colors, in the range [1, 21].
 * Order-independent: contrastRatio(a, b) === contrastRatio(b, a).
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}
