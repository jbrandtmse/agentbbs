// formatTimestamp — a calm, terse, DETERMINISTIC display timestamp (Story 9.5, Rule 3).
//
// DESIGN.md renders the per-post timestamp as a faint, right-aligned mono meta string
// (e.g. `12:04:51`). This formats the host-provided `created_at` ISO-8601 UTC string into
// that terse `HH:MM:SS` form.
//
// DETERMINISTIC + LOCALE-STABLE (research-first / Rule 3): we DO NOT use
// `Date#toLocaleTimeString` (locale- + timezone-dependent → non-reproducible across
// machines/CI) and we DO NOT read the wall clock. We parse the fixed-shape ISO-8601 UTC
// string and emit its UTC time-of-day directly, so the same input ALWAYS yields the same
// output regardless of the host locale, timezone, or the test clock. This is a pure
// function of its input string.
//
// Presentation-only (NFR2): no core/data-access import.

/**
 * Format an ISO-8601 UTC timestamp string into a terse `HH:MM:SS` (UTC) display string.
 *
 * Pure + deterministic: the output depends ONLY on `iso` (never the host locale/timezone
 * or the wall clock). A malformed/empty input yields an empty string (the post then shows
 * no timestamp rather than a misleading one).
 *
 * @param iso An ISO-8601 UTC instant, e.g. `2026-06-01T12:04:51.000Z`.
 * @returns The UTC time-of-day as `HH:MM:SS`, or `''` if `iso` is not parseable.
 */
export function formatTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  // Build the time-of-day from UTC parts (locale-/timezone-independent).
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
