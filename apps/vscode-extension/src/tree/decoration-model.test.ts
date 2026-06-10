// The decoration-model tests (Story 10.3, AC3) — the PURE needs/unread/read precedence + the
// badge 2-char-cap BOUNDARY. Discoverable by the ROOT `pnpm test` (Rule 8). The badge-cap
// boundary is a MUTATION target (Rule 7): widening the cap (e.g. allowing 3 chars) must turn
// the `100 → '•'` assertion RED; the precedence (needs outranks unread) must hold.

import { describe, expect, it } from 'vitest';

import {
  BADGE_MAX_LENGTH,
  NEEDS_YOU_BADGE,
  NEEDS_YOU_COLOR_ID,
  UNREAD_BADGE,
  UNREAD_COLOR_ID,
  roomDecoration,
  unreadBadge,
  unreadDescription,
} from './decoration-model.js';

describe('unreadBadge — the 2-char cap boundary (mutation target)', () => {
  it('shows a 1-digit count verbatim', () => {
    expect(unreadBadge(1)).toBe('1');
    expect(unreadBadge(9)).toBe('9');
  });

  it('shows a 2-digit count verbatim — up to the cap (99)', () => {
    expect(unreadBadge(10)).toBe('10');
    expect(unreadBadge(99)).toBe('99');
  });

  it('collapses a 3-digit count to the • glyph at the boundary (100)', () => {
    // BOUNDARY: 99 (2 chars) fits; 100 (3 chars) exceeds the cap → •. A widened cap turns this RED.
    expect(unreadBadge(100)).toBe(UNREAD_BADGE);
    expect(unreadBadge(1000)).toBe(UNREAD_BADGE);
  });

  it('every badge it produces is within the API cap', () => {
    for (const n of [1, 9, 10, 99, 100, 1234]) {
      expect(unreadBadge(n).length).toBeLessThanOrEqual(BADGE_MAX_LENGTH);
    }
  });
});

describe('unreadDescription — the UNCAPPED exact count (Story 13.6, closes 10.3-unread-count-test-gap)', () => {
  it('formats a small count verbatim', () => {
    expect(unreadDescription(1)).toBe('1 new');
    expect(unreadDescription(7)).toBe('7 new');
  });

  it('has NO 2-char cap — a large count is shown in full (unlike the badge)', () => {
    // The badge collapses 150 → '•' (3 chars exceed the API cap); the description does NOT.
    expect(unreadDescription(150)).toBe('150 new');
    expect(unreadBadge(150)).toBe(UNREAD_BADGE);
  });
});

describe('roomDecoration — precedence + calm', () => {
  it('a read room (no needs, no unread) is calm → undefined (no badge)', () => {
    expect(
      roomDecoration({ needsYou: false, unread: false, unreadCount: 0 }),
    ).toBeUndefined();
  });

  it('an unread room maps to the unread badge + color', () => {
    const spec = roomDecoration({
      needsYou: false,
      unread: true,
      unreadCount: 3,
    });
    expect(spec).toBeDefined();
    expect(spec!.badge).toBe('3');
    expect(spec!.colorId).toBe(UNREAD_COLOR_ID);
  });

  it('a NEEDS YOU room maps to the ! badge + needs color', () => {
    const spec = roomDecoration({
      needsYou: true,
      unread: false,
      unreadCount: 0,
    });
    expect(spec).toBeDefined();
    expect(spec!.badge).toBe(NEEDS_YOU_BADGE);
    expect(spec!.colorId).toBe(NEEDS_YOU_COLOR_ID);
  });

  it('NEEDS YOU outranks unread when a room is BOTH (precedence)', () => {
    const spec = roomDecoration({
      needsYou: true,
      unread: true,
      unreadCount: 42,
    });
    expect(spec!.badge).toBe(NEEDS_YOU_BADGE);
    expect(spec!.colorId).toBe(NEEDS_YOU_COLOR_ID);
  });

  it('the unread badge honors the cap (100 unread → •, never overflowing)', () => {
    const spec = roomDecoration({
      needsYou: false,
      unread: true,
      unreadCount: 100,
    });
    expect(spec!.badge).toBe(UNREAD_BADGE);
    expect(spec!.badge.length).toBeLessThanOrEqual(BADGE_MAX_LENGTH);
  });
});
