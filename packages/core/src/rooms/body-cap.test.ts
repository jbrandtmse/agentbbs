// `assertBodyWithinCap` / `MAX_BODY_BYTES` tests (Story 5.1, Task 1 / AC #2).
//
// The body-size cap is a CORE check that returns the closed `BODY_TOO_LARGE` code (NOT a
// Zod `.max` — a Zod boundary rejection carries no closed code; see Story 5.0). It is the
// formal 256 KB cap NFR6/AR7 commits to, which Epic 4 deferred (the interim was a Zod char
// cap). These tests PIN the two load-bearing decisions:
//   - the boundary is EXACTLY `MAX_BODY_BYTES = 256 * 1024 = 262144`: a body whose UTF-8
//     byte length is exactly the cap PASSES; one byte over THROWS `BODY_TOO_LARGE`;
//   - the measure is UTF-8 BYTE length, NOT character count: a body of few CHARACTERS whose
//     UTF-8 encoding exceeds the cap is REJECTED (emoji/CJK are multi-byte), and a long-but-
//     small ASCII body under the byte cap PASSES. A char-count cap would get both wrong.
//
// Pure, no I/O — `assertBodyWithinCap` only measures the string (the `Buffer` global is a
// Node builtin, allowed in core; it is not a client/SQLite import). The throw is the same
// `BoardError` core raises everywhere; clients map its `code` to their surface.

import { describe, expect, it } from 'vitest';

import { BoardError } from '../errors.js';
import { assertBodyWithinCap, MAX_BODY_BYTES } from './body-cap.js';

describe('MAX_BODY_BYTES', () => {
  it('is the formal 256 KB cap (262144 bytes)', () => {
    expect(MAX_BODY_BYTES).toBe(256 * 1024);
    expect(MAX_BODY_BYTES).toBe(262144);
  });
});

describe('assertBodyWithinCap — boundary on UTF-8 byte length', () => {
  it('passes a body EXACTLY at the cap (byteLength === MAX_BODY_BYTES)', () => {
    // An all-ASCII body of MAX_BODY_BYTES chars is exactly MAX_BODY_BYTES UTF-8 bytes.
    const atCap = 'a'.repeat(MAX_BODY_BYTES);
    expect(Buffer.byteLength(atCap, 'utf8')).toBe(MAX_BODY_BYTES);
    expect(() => assertBodyWithinCap(atCap)).not.toThrow();
  });

  it('throws BODY_TOO_LARGE for a body ONE byte over the cap', () => {
    const overCap = 'a'.repeat(MAX_BODY_BYTES + 1);
    expect(Buffer.byteLength(overCap, 'utf8')).toBe(MAX_BODY_BYTES + 1);
    expect(() => assertBodyWithinCap(overCap)).toThrowError(BoardError);
    try {
      assertBodyWithinCap(overCap);
      expect.unreachable('expected assertBodyWithinCap to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BoardError);
      expect((err as BoardError).code).toBe('BODY_TOO_LARGE');
    }
  });

  it('passes a body well under the cap', () => {
    expect(() => assertBodyWithinCap('a short message')).not.toThrow();
  });

  it('passes an empty body (the .min(1) non-empty rule is the boundary schema, not the cap)', () => {
    // The cap only rejects OVER-cap; emptiness is the tool boundary's concern (Zod .min(1)).
    expect(() => assertBodyWithinCap('')).not.toThrow();
  });
});

describe('assertBodyWithinCap — BYTES not characters (multi-byte UTF-8)', () => {
  it('REJECTS a body of FEW characters whose UTF-8 byte length exceeds the cap (emoji)', () => {
    // '🚀' is 1 JS string of length 2 (a surrogate pair) but FOUR UTF-8 bytes. Repeat it
    // until the BYTE length clears the cap while the CHARACTER count stays far below it —
    // a char-count cap (e.g. the retired 16k interim) would WRONGLY accept this.
    const rocketCount = Math.ceil(MAX_BODY_BYTES / 4) + 1; // 4 bytes each → just over cap
    const emojiBody = '🚀'.repeat(rocketCount);
    expect(Buffer.byteLength(emojiBody, 'utf8')).toBeGreaterThan(
      MAX_BODY_BYTES,
    );
    // Far fewer string code-units than the byte cap (≈ MAX_BODY_BYTES/2), proving the cap is
    // not measuring characters: were it chars, this would pass.
    expect(emojiBody.length).toBeLessThan(MAX_BODY_BYTES);
    expect(() => assertBodyWithinCap(emojiBody)).toThrowError(BoardError);
    try {
      assertBodyWithinCap(emojiBody);
      expect.unreachable('expected over-cap emoji body to throw');
    } catch (err) {
      expect((err as BoardError).code).toBe('BODY_TOO_LARGE');
    }
  });

  it('REJECTS a CJK body whose UTF-8 byte length exceeds the cap (3 bytes/char)', () => {
    // '本' is one character but THREE UTF-8 bytes. ⌈cap/3⌉+1 chars → just over the byte cap,
    // while the character count is ≈ cap/3 — well under a hypothetical char cap.
    const cjkCount = Math.ceil(MAX_BODY_BYTES / 3) + 1;
    const cjkBody = '本'.repeat(cjkCount);
    expect(Buffer.byteLength(cjkBody, 'utf8')).toBeGreaterThan(MAX_BODY_BYTES);
    expect(cjkBody.length).toBeLessThan(MAX_BODY_BYTES);
    expect(() => assertBodyWithinCap(cjkBody)).toThrowError(BoardError);
  });

  it('PASSES a multi-byte body whose byte length is within the cap even though it has many characters', () => {
    // A CJK body that is comfortably UNDER the byte cap (so it must be accepted) — but whose
    // BYTE length is 3× its character count, the inverse check: a byte cap accepts a body a
    // strict-but-mis-scaled char cap might reject, and rejects nothing that fits in bytes.
    const safeCjk = '本'.repeat(Math.floor(MAX_BODY_BYTES / 3) - 1);
    expect(Buffer.byteLength(safeCjk, 'utf8')).toBeLessThan(MAX_BODY_BYTES);
    expect(() => assertBodyWithinCap(safeCjk)).not.toThrow();
  });
});

// QA gap (Story 5.1): the dev pinned the byte-vs-char decision DIRECTIONALLY (over-cap
// emoji/CJK throw; under-cap CJK passes) and the EXACT cap with an ALL-ASCII tail. What was
// NOT pinned is the EXACT boundary when the cap lands ON a MULTI-BYTE char — the precise spot
// a char-vs-byte off-by-one would hide: a body whose total UTF-8 length is EXACTLY
// MAX_BODY_BYTES but whose LAST code-unit is a multi-byte char must still PASS (the count is
// bytes, and the multi-byte tail does not push it over), and appending ONE more whole
// multi-byte char must cross (the smallest multi-byte step, not the +1 ASCII byte the
// existing test uses). These straddle the boundary with the multi-byte unit AT the edge.
describe('assertBodyWithinCap — multi-byte char straddling the EXACT cap boundary', () => {
  it('PASSES a body of EXACTLY MAX_BODY_BYTES whose LAST code-unit is a 4-byte emoji', () => {
    // ASCII pad + one trailing 🚀 (4 UTF-8 bytes) → total === MAX_BODY_BYTES, ending on the
    // multi-byte unit. A byte-exact cap accepts it; a char-vs-byte off-by-one at the edge
    // (e.g. measuring the emoji as its 2 string code-units, or fence-posting on the last
    // char) would mis-judge the boundary.
    const rocketBytes = Buffer.byteLength('🚀', 'utf8'); // 4
    const atCapEmojiTail = 'a'.repeat(MAX_BODY_BYTES - rocketBytes) + '🚀';
    expect(Buffer.byteLength(atCapEmojiTail, 'utf8')).toBe(MAX_BODY_BYTES); // EXACTLY at cap
    expect(atCapEmojiTail.endsWith('🚀')).toBe(true); // boundary lands ON the multi-byte unit
    expect(() => assertBodyWithinCap(atCapEmojiTail)).not.toThrow();
  });

  it('THROWS when ONE more 4-byte emoji is appended to that exact-cap body (crosses by 4 bytes)', () => {
    // Adding a single whole multi-byte char past the exact-cap-with-multibyte-tail body is the
    // smallest crossing a multi-byte unit can make (+4 bytes here) — the multibyte analogue of
    // the dev's "+1 ASCII byte" over-cap test. The check rejects it on BYTES, not chars.
    const rocketBytes = Buffer.byteLength('🚀', 'utf8'); // 4
    const overByOneEmoji =
      'a'.repeat(MAX_BODY_BYTES - rocketBytes) + '🚀' + '🚀';
    expect(Buffer.byteLength(overByOneEmoji, 'utf8')).toBe(
      MAX_BODY_BYTES + rocketBytes,
    ); // over by exactly one emoji's bytes
    expect(() => assertBodyWithinCap(overByOneEmoji)).toThrowError(BoardError);
    try {
      assertBodyWithinCap(overByOneEmoji);
      expect.unreachable('expected the over-cap multibyte-tail body to throw');
    } catch (err) {
      expect((err as BoardError).code).toBe('BODY_TOO_LARGE');
    }
  });

  it('PASSES a body of EXACTLY MAX_BODY_BYTES whose LAST code-unit is a 3-byte CJK char', () => {
    // The 3-byte analogue: ASCII pad + one trailing 本 (3 bytes) → total === MAX_BODY_BYTES.
    // A different multi-byte width at the edge, to rule out a width-specific fence-post.
    const cjkBytes = Buffer.byteLength('本', 'utf8'); // 3
    const atCapCjkTail = 'a'.repeat(MAX_BODY_BYTES - cjkBytes) + '本';
    expect(Buffer.byteLength(atCapCjkTail, 'utf8')).toBe(MAX_BODY_BYTES);
    expect(atCapCjkTail.endsWith('本')).toBe(true);
    expect(() => assertBodyWithinCap(atCapCjkTail)).not.toThrow();
  });
});
