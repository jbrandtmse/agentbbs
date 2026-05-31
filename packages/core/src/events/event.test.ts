// Event / NewEvent shape contracts (Story 1.3, AC1).
//
// Verifies the folded `Event` is a discriminated union over `type` (narrowing
// `type` narrows `payload`), and that `NewEvent` is the append-input form with
// no `seq`/`createdAt`.

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Event, NewEvent } from './event.js';
import type { ProjectAnnouncedPayload } from './payloads.js';

describe('Event shape (AC1)', () => {
  it('narrows payload when narrowing on type (discriminated union)', () => {
    const event: Event = {
      seq: 7,
      type: 'project.announced',
      actor: 'alice',
      createdAt: '2026-05-30T00:00:00.000Z',
      payload: {
        projectId: 'agentbbs',
        title: 'AgentBBS',
        description: 'a board',
      },
    };

    if (event.type === 'project.announced') {
      // Inside the guard, payload is narrowed to ProjectAnnouncedPayload.
      expectTypeOf(event.payload).toEqualTypeOf<ProjectAnnouncedPayload>();
      expect(event.payload.projectId).toBe('agentbbs');
    } else {
      throw new Error('discriminant narrowing failed');
    }
  });

  it('Event carries the authoritative seq + display-only createdAt', () => {
    expectTypeOf<Event>().toHaveProperty('seq').toEqualTypeOf<number>();
    expectTypeOf<Event>().toHaveProperty('createdAt').toEqualTypeOf<string>();
    expectTypeOf<Event>().toHaveProperty('actor').toEqualTypeOf<string>();
  });

  it('NewEvent is the append-input form: no seq, no createdAt', () => {
    const input: NewEvent = {
      type: 'identity.seen',
      actor: 'alice',
      payload: { handle: 'alice' },
    };
    expect(input).not.toHaveProperty('seq');
    expect(input).not.toHaveProperty('createdAt');

    // Type-level: seq/createdAt are not keys of NewEvent.
    expectTypeOf<keyof NewEvent>().not.toEqualTypeOf<'seq'>();
    const withSeq: NewEvent = {
      type: 'identity.seen',
      actor: 'alice',
      payload: { handle: 'alice' },
      // @ts-expect-error NewEvent must not accept a seq (assigned at append time).
      seq: 1,
    };
    expect(withSeq.type).toBe('identity.seen');
  });
});
