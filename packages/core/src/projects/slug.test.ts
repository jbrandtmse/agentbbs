// Slug-helper unit tests (Story 3.1, Task 1 / AR10).
//
// Pins the pure derivation `slugify` against the AR10 contract + the edge cases the
// story calls out (empty / whitespace / punctuation / unicode-fold). No I/O — a
// pure function under test.

import { describe, expect, it } from 'vitest';

import { slugify } from './slug.js';

describe('slugify — AR10 project/sub-board id derivation', () => {
  it('lowercases and joins words with a single dash (the canonical case)', () => {
    expect(slugify('Calling Interface')).toBe('calling-interface');
    expect(slugify('Ledger Concurrency')).toBe('ledger-concurrency');
  });

  it('collapses runs of punctuation/whitespace to a single dash', () => {
    expect(slugify('Hello,  World!')).toBe('hello-world');
    expect(slugify('a---b___c   d')).toBe('a-b-c-d');
    expect(slugify('Wire / Internal Mapping')).toBe('wire-internal-mapping');
  });

  it('strips leading and trailing separators', () => {
    expect(slugify('  Hello World  ')).toBe('hello-world');
    expect(slugify('!!!edge!!!')).toBe('edge');
    expect(slugify('-already-kebab-')).toBe('already-kebab');
  });

  it('keeps digits and is idempotent on an already-canonical slug', () => {
    expect(slugify('epic-3-projects')).toBe('epic-3-projects');
    expect(slugify('v2 HTTP daemon')).toBe('v2-http-daemon');
    expect(slugify(slugify('Calling Interface'))).toBe('calling-interface');
  });

  it('returns empty string for whitespace-only or no-alphanumeric titles', () => {
    expect(slugify('   ')).toBe('');
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('folds non-[a-z0-9] (accented / non-Latin) characters to separators', () => {
    // V1 folds only to ASCII; accented/non-Latin chars are not in [a-z0-9] after
    // lowercasing, so they collapse to a dash exactly like punctuation. The ASCII
    // segments survive; a fully non-ASCII title slugs to the empty string.
    expect(slugify('Café Münchën')).toBe('caf-m-nch-n');
    expect(slugify('naïve-coördinate')).toBe('na-ve-co-rdinate');
    expect(slugify('日本語')).toBe('');
  });
});
