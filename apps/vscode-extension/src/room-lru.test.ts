// RoomLru unit tests (Story 10.5, AC2) — the pure LRU bounding which room panels stay warm.
//
// Host-side, no vscode/DOM. Proves: cap enforcement, move-to-front on touch, the retain window
// (top-N), eviction order, removal, and the retain decision returned by touch(). Discoverable by
// ROOT `pnpm test` (co-located .test.ts → node project; Rule 8).

import { describe, expect, it } from 'vitest';

import { RoomLru, DEFAULT_RETAIN_CAP } from './room-lru.js';

describe('RoomLru — bounded most-recently-used room ordering (AC2)', () => {
  it('defaults to DEFAULT_RETAIN_CAP and rejects a non-positive cap', () => {
    expect(new RoomLru().retainCap).toBe(DEFAULT_RETAIN_CAP);
    expect(() => new RoomLru(0)).toThrow();
    expect(() => new RoomLru(-1)).toThrow();
    expect(() => new RoomLru(1.5)).toThrow();
  });

  it('touch returns true while within the cap, false once pushed out of the window', () => {
    const lru = new RoomLru(2);
    expect(lru.touch('a')).toBe(true); // [a]
    expect(lru.touch('b')).toBe(true); // [b, a]
    expect(lru.touch('c')).toBe(true); // [c, b, a] — c is most-recent, within top-2
    // a is now at index 2 (outside the top-2 window) → not retained.
    expect(lru.shouldRetain('a')).toBe(false);
    expect(lru.shouldRetain('b')).toBe(true);
    expect(lru.shouldRetain('c')).toBe(true);
  });

  it('re-touching an existing room moves it to most-recent (front)', () => {
    const lru = new RoomLru(2);
    lru.touch('a');
    lru.touch('b');
    lru.touch('c'); // [c, b, a]; a evicted from window
    expect(lru.shouldRetain('a')).toBe(false);
    // Re-touch a → it moves to front, back inside the window; the previously-2nd (b) drops out.
    expect(lru.touch('a')).toBe(true); // [a, c, b]
    expect(lru.shouldRetain('a')).toBe(true);
    expect(lru.shouldRetain('c')).toBe(true);
    expect(lru.shouldRetain('b')).toBe(false);
  });

  it('retained() returns exactly the top-cap rooms, most-recent first', () => {
    const lru = new RoomLru(3);
    for (const r of ['a', 'b', 'c', 'd', 'e']) lru.touch(r);
    // order = [e, d, c, b, a]; top-3 = [e, d, c]
    expect(lru.retained()).toEqual(['e', 'd', 'c']);
  });

  it('remove drops a room from the order and re-opens the window for the next', () => {
    const lru = new RoomLru(2);
    lru.touch('a');
    lru.touch('b');
    lru.touch('c'); // [c, b, a]; a outside window
    expect(lru.shouldRetain('a')).toBe(false);
    lru.remove('c'); // [b, a]
    // a is now within the top-2 again.
    expect(lru.shouldRetain('a')).toBe(true);
    expect(lru.snapshot()).toEqual(['b', 'a']);
  });

  it('remove of an absent room is a no-op', () => {
    const lru = new RoomLru(2);
    lru.touch('a');
    expect(() => lru.remove('nope')).not.toThrow();
    expect(lru.snapshot()).toEqual(['a']);
  });

  it('a cap of 1 keeps only the single most-recent room warm', () => {
    const lru = new RoomLru(1);
    expect(lru.touch('a')).toBe(true);
    expect(lru.touch('b')).toBe(true); // [b, a]
    expect(lru.shouldRetain('a')).toBe(false);
    expect(lru.shouldRetain('b')).toBe(true);
    expect(lru.retained()).toEqual(['b']);
  });
});
