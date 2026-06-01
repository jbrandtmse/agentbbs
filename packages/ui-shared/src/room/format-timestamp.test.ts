// Unit tests for formatTimestamp (Story 9.5, Task 4 / Rule 3).
//
// Pins the DETERMINISTIC, LOCALE-/TIMEZONE-/CLOCK-INDEPENDENT display timestamp: the same
// ISO input ALWAYS yields the same `HH:MM:SS` (UTC) output, and a malformed input yields
// '' (no misleading timestamp). Pure function — no DOM, no clock.

import { describe, expect, it } from 'vitest';

import { formatTimestamp } from './format-timestamp.js';

describe('formatTimestamp — deterministic UTC HH:MM:SS (Rule 3)', () => {
  it('formats an ISO-8601 UTC instant to its UTC time-of-day', () => {
    expect(formatTimestamp('2026-06-01T12:04:51.000Z')).toBe('12:04:51');
  });

  it('zero-pads hours/minutes/seconds', () => {
    expect(formatTimestamp('2026-06-01T01:02:03.000Z')).toBe('01:02:03');
    expect(formatTimestamp('2026-06-01T00:00:00.000Z')).toBe('00:00:00');
  });

  it('is locale-/timezone-independent: a UTC instant renders its UTC time-of-day regardless of offset notation', () => {
    // The same instant expressed with a +02:00 offset is 10:04:51 UTC.
    expect(formatTimestamp('2026-06-01T12:04:51+02:00')).toBe('10:04:51');
  });

  it('is a pure function of its input (same input → same output, no clock dependency)', () => {
    const iso = '2026-06-01T23:59:59.000Z';
    expect(formatTimestamp(iso)).toBe(formatTimestamp(iso));
    expect(formatTimestamp(iso)).toBe('23:59:59');
  });

  it('returns "" for a malformed/empty timestamp (no misleading display)', () => {
    expect(formatTimestamp('')).toBe('');
    expect(formatTimestamp('not-a-date')).toBe('');
  });
});
