// Room-id base-deriver unit tests (Story 4.1, Task 2 / AC #1, #5).
//
// Pins the pure `roomIdBase` against the AC #1 canonical case + the AC #5 empty-subject
// fallback, and proves it REUSES `slugify` (no duplicated slug algorithm) by checking
// the two agree on a non-empty subject. No I/O — a pure function under test.

import { describe, expect, it } from 'vitest';

import { slugify } from '../projects/slug.js';
import { EMPTY_SUBJECT_ROOM_BASE, roomIdBase } from './room-id.js';

describe('roomIdBase — room-id base derivation (AC #1)', () => {
  it('slugs a normal subject to the canonical kebab base', () => {
    expect(roomIdBase('Calling Interface')).toBe('calling-interface');
    expect(roomIdBase('Ledger Concurrency')).toBe('ledger-concurrency');
    expect(roomIdBase('Hello,  World!')).toBe('hello-world');
  });

  it('mirrors slugify exactly for any subject that slugs non-empty (REUSE, not a fork)', () => {
    for (const subject of [
      'Calling Interface',
      'v2 HTTP daemon',
      'epic-4-rooms',
      'Wire / Internal Mapping',
    ]) {
      expect(roomIdBase(subject)).toBe(slugify(subject));
    }
  });
});

describe('roomIdBase — empty-subject fallback (AC #5)', () => {
  it('falls back to the literal base "room" when the subject has no [a-z0-9]', () => {
    // slugify collapses these to '' — the helper must NOT return an empty base.
    expect(roomIdBase('!!!')).toBe(EMPTY_SUBJECT_ROOM_BASE);
    expect(roomIdBase('   ')).toBe(EMPTY_SUBJECT_ROOM_BASE);
    expect(roomIdBase('')).toBe(EMPTY_SUBJECT_ROOM_BASE);
    expect(roomIdBase('日本語')).toBe(EMPTY_SUBJECT_ROOM_BASE);
    // And the fallback is exactly 'room'.
    expect(roomIdBase('!!!')).toBe('room');
  });

  it('returns a non-empty base for every input (the proto-room is always addressable)', () => {
    for (const subject of ['!!!', '', '   ', '日本語', 'Real Subject']) {
      expect(roomIdBase(subject).length).toBeGreaterThan(0);
    }
  });
});
