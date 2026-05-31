// Load-bearing guard against event-vocabulary drift (Story 1.3, AC1).
//
// The "exactly 10 event types" test is the canary: it fails loudly on any
// accidental addition, removal, or typo in the closed vocabulary. Renaming a
// type is a breaking export-format change and MUST trip this test.

import { describe, expect, expectTypeOf, it } from 'vitest';

import { EVENT_TYPES, type EventType } from './types.js';

/**
 * The canonical, expected vocabulary — duplicated here on purpose. This literal
 * is the independent oracle; `EVENT_TYPES` is the source under test. If they
 * diverge, the vocabulary changed and someone must consciously update BOTH (and
 * version the change if it is a rename/removal).
 */
const EXPECTED_EVENT_TYPES = [
  'identity.registered',
  'identity.focus_updated',
  'identity.seen',
  'project.announced',
  'board.joined',
  'announcement.posted',
  'room.replied',
  'room.participant_added',
  'message.reacted',
  'message.unreacted',
] as const;

describe('event vocabulary (AC1)', () => {
  it('contains EXACTLY 10 event types', () => {
    expect(EVENT_TYPES).toHaveLength(10);
  });

  it('matches the canonical vocabulary exactly (membership + order)', () => {
    expect(EVENT_TYPES).toEqual(EXPECTED_EVENT_TYPES);
  });

  it('has no duplicate types', () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
  });

  it('every type follows the noun.past_tense shape (a single dot, lowercase)', () => {
    for (const type of EVENT_TYPES) {
      expect(type).toMatch(/^[a-z]+\.[a-z_]+$/u);
    }
  });

  it('EventType is the union derived from EVENT_TYPES', () => {
    expectTypeOf<(typeof EVENT_TYPES)[number]>().toEqualTypeOf<EventType>();
    expectTypeOf<'identity.registered'>().toMatchTypeOf<EventType>();
    // A non-member must NOT be assignable to EventType.
    // @ts-expect-error 'identity.created' is not in the closed vocabulary.
    const bad: EventType = 'identity.created';
    expect(bad).toBe('identity.created');
  });
});
