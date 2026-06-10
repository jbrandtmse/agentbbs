// Wire-mapping tests (Story 1.5, AC1/AC2) — WRITE direction.
//
// Asserts the camelCase (core) -> snake_case (wire/at-rest) conversion is correct
// and exhaustive over the closed event vocabulary, that `newEventToRow` stamps
// `created_at` and produces a JSON string with snake_case keys, and that NO
// camelCase key leaks into the serialized payload.

import { describe, expect, it } from 'vitest';

import {
  MalformedPayloadError,
  newEventToRow,
  payloadToWire,
  rowToEvent,
  wireToPayload,
} from './mapping.js';

import type { StoredEventRow } from './mapping.js';
import type { Event, EventType, NewEvent } from '@agentbbs/core';

describe('payloadToWire — camelCase -> snake_case (AC1)', () => {
  it('converts the multi-word payload keys to snake_case', () => {
    expect(
      payloadToWire({
        type: 'identity.registered',
        actor: 'alice',
        payload: { handle: 'alice', currentFocus: 'shipping 1.5' },
      }),
    ).toEqual({ handle: 'alice', current_focus: 'shipping 1.5' });

    expect(
      payloadToWire({
        type: 'project.announced',
        actor: 'alice',
        payload: { projectId: 'agentbbs', title: 'AgentBBS', description: 'x' },
      }),
    ).toEqual({ project_id: 'agentbbs', title: 'AgentBBS', description: 'x' });

    expect(
      payloadToWire({
        type: 'room.participant_added',
        actor: 'alice',
        payload: { roomId: 'calling-interface', handle: 'bob' },
      }),
    ).toEqual({ room_id: 'calling-interface', handle: 'bob' });

    expect(
      payloadToWire({
        type: 'message.reacted',
        actor: 'alice',
        payload: { messageSeq: 42 },
      }),
    ).toEqual({ message_seq: 42 });
  });

  it('leaves single-word keys unchanged and maps projectId/roomId on announcement.posted', () => {
    expect(
      payloadToWire({
        type: 'announcement.posted',
        actor: 'alice',
        payload: {
          projectId: 'calling-interface',
          roomId: 'r1',
          subject: 'Subj',
          body: 'Body',
        },
      }),
    ).toEqual({
      project_id: 'calling-interface',
      room_id: 'r1',
      subject: 'Subj',
      body: 'Body',
    });
  });

  it('never emits a camelCase key for any event type', () => {
    const samples: NewEvent[] = [
      {
        type: 'identity.registered',
        actor: 'a',
        payload: { handle: 'a', currentFocus: 'f' },
      },
      {
        type: 'identity.focus_updated',
        actor: 'a',
        payload: { handle: 'a', currentFocus: 'f' },
      },
      { type: 'identity.seen', actor: 'a', payload: { handle: 'a' } },
      {
        type: 'project.announced',
        actor: 'a',
        payload: { projectId: 'p', title: 't', description: 'd' },
      },
      { type: 'board.joined', actor: 'a', payload: { projectId: 'p' } },
      {
        type: 'announcement.posted',
        actor: 'a',
        payload: { projectId: 'p', roomId: 'r', subject: 's', body: 'b' },
      },
      { type: 'room.replied', actor: 'a', payload: { roomId: 'r', body: 'b' } },
      {
        type: 'room.participant_added',
        actor: 'a',
        payload: { roomId: 'r', handle: 'h' },
      },
      { type: 'message.reacted', actor: 'a', payload: { messageSeq: 1 } },
      { type: 'message.unreacted', actor: 'a', payload: { messageSeq: 1 } },
    ];

    for (const event of samples) {
      const wire = payloadToWire(event);
      for (const key of Object.keys(wire)) {
        expect(key, `key "${key}" on ${event.type}`).not.toMatch(/[A-Z]/u);
      }
    }
  });
});

describe('newEventToRow — row input (AC1/AC2)', () => {
  it('stamps created_at, copies type/actor, and JSON-encodes a snake_case payload', () => {
    const createdAt = '2026-05-30T12:34:56.000Z';
    const row = newEventToRow(
      {
        type: 'identity.registered',
        actor: 'alice',
        payload: { handle: 'alice', currentFocus: 'shipping 1.5' },
      },
      createdAt,
    );

    expect(row.type).toBe('identity.registered');
    expect(row.actor).toBe('alice');
    expect(row.created_at).toBe(createdAt);

    const parsed = JSON.parse(row.payload) as Record<string, unknown>;
    expect(parsed).toEqual({ handle: 'alice', current_focus: 'shipping 1.5' });
    expect(row.payload).not.toMatch(/currentFocus/);
  });
});

describe('wireToPayload — snake_case -> camelCase (READ direction, AC1)', () => {
  it('converts multi-word wire keys back to camelCase', () => {
    expect(
      wireToPayload('identity.registered', {
        handle: 'alice',
        current_focus: 'shipping 1.6',
      }),
    ).toEqual({ handle: 'alice', currentFocus: 'shipping 1.6' });

    expect(
      wireToPayload('project.announced', {
        project_id: 'agentbbs',
        title: 'AgentBBS',
        description: 'x',
      }),
    ).toEqual({ projectId: 'agentbbs', title: 'AgentBBS', description: 'x' });

    expect(
      wireToPayload('room.participant_added', {
        room_id: 'calling-interface',
        handle: 'bob',
      }),
    ).toEqual({ roomId: 'calling-interface', handle: 'bob' });

    expect(wireToPayload('message.reacted', { message_seq: 42 })).toEqual({
      messageSeq: 42,
    });
  });

  it('never surfaces a snake_case key to core', () => {
    const payload = wireToPayload('identity.registered', {
      handle: 'a',
      current_focus: 'f',
    });
    for (const key of Object.keys(payload)) {
      expect(key, `key "${key}"`).not.toMatch(/_/u);
    }
  });
});

describe('rowToEvent — on-disk row -> internal Event (READ direction, AC1)', () => {
  it('maps seq/type/actor/created_at and a camelCase payload', () => {
    const row: StoredEventRow = {
      seq: 7,
      type: 'identity.registered',
      actor: 'alice',
      created_at: '2026-05-30T12:34:56.000Z',
      payload: JSON.stringify({ handle: 'alice', current_focus: 'shipping' }),
    };

    const event = rowToEvent(row);

    expect(event.seq).toBe(7);
    expect(event.type).toBe('identity.registered');
    expect(event.actor).toBe('alice');
    expect(event.createdAt).toBe('2026-05-30T12:34:56.000Z');
    expect(event.payload).toEqual({
      handle: 'alice',
      currentFocus: 'shipping',
    });
  });

  it('throws loudly on an unknown event type (corrupt/foreign row)', () => {
    const row: StoredEventRow = {
      seq: 1,
      type: 'not.a.real.type',
      actor: 'x',
      created_at: '2026-05-30T00:00:00.000Z',
      payload: '{}',
    };
    expect(() => rowToEvent(row)).toThrow(/Unknown event type/u);
  });
});

// Story 1.6 completion (Story 13.4, AC1) — a KNOWN-type-but-MALFORMED payload row
// (a missing or wrong-typed payload key) must fail LOUDLY at this read seam with a
// clear data-access-local error, NOT silently coerce `undefined → "undefined"` /
// `undefined → NaN` and leak a structurally-wrong Event into core. Mirrors
// `asEventType`'s loud failure for the `type` column (NFR10 ledger integrity). The
// error is a data-access `MalformedPayloadError`, deliberately NOT a
// BoardError/BOARD_ERROR_CODE (the closed agent error set is unchanged — AC3).
describe('wireToPayload — rejects a malformed payload row (Story 13.4, AC1)', () => {
  it('throws when a required STRING key is MISSING (no silent "undefined")', () => {
    // identity.registered requires `handle` + `current_focus`; drop `handle`.
    expect(() =>
      wireToPayload('identity.registered', { current_focus: 'f' }),
    ).toThrow(MalformedPayloadError);
    // The clear message names the type and the offending key — not a coerced object.
    expect(() =>
      wireToPayload('identity.registered', { current_focus: 'f' }),
    ).toThrow(/malformed identity\.registered payload.*handle/u);
  });

  it('throws when a required STRING key is WRONG-TYPED (e.g. a number for body)', () => {
    expect(() =>
      wireToPayload('room.replied', { room_id: 'r', body: 123 }),
    ).toThrow(/malformed room\.replied payload.*body/u);
  });

  it('throws when the integer message_seq is MISSING (no silent NaN)', () => {
    expect(() => wireToPayload('message.reacted', {})).toThrow(
      /malformed message\.reacted payload.*message_seq/u,
    );
  });

  it('throws when message_seq is WRONG-TYPED (a string "x" → not NaN coercion)', () => {
    // The old `Number("x")` produced NaN silently; now it fails loudly.
    expect(() =>
      wireToPayload('message.reacted', { message_seq: 'x' }),
    ).toThrow(MalformedPayloadError);
  });

  it('throws when message_seq is a NON-INTEGER number (1.5)', () => {
    expect(() =>
      wireToPayload('message.unreacted', { message_seq: 1.5 }),
    ).toThrow(/malformed message\.unreacted payload.*message_seq/u);
  });

  it('propagates the seam error through rowToEvent for a malformed stored row', () => {
    // A valid `type` whose stored JSON payload is missing a required key — the
    // exact "planted malformed row" shape a corrupt/foreign ledger produces.
    const row: StoredEventRow = {
      seq: 4,
      type: 'project.announced',
      actor: 'x',
      created_at: '2026-05-30T00:00:00.000Z',
      payload: JSON.stringify({ project_id: 'p', title: 't' }), // missing `description`
    };
    expect(() => rowToEvent(row)).toThrow(
      /malformed project\.announced payload.*description/u,
    );
  });

  it('leaves the happy path UNAFFECTED — a well-formed row still round-trips', () => {
    // Sanity: the validation only fires on a genuinely malformed row; a complete,
    // correctly-typed payload maps exactly as before.
    expect(wireToPayload('message.reacted', { message_seq: 42 })).toEqual({
      messageSeq: 42,
    });
    expect(
      wireToPayload('identity.registered', {
        handle: 'alice',
        current_focus: 'shipping',
      }),
    ).toEqual({ handle: 'alice', currentFocus: 'shipping' });
  });
});

// ---------------------------------------------------------------------------
// QA EDGE COVERAGE (Story 13.4 QA stage) — systematic malformed-payload matrix.
//
// The dev's block above proves the seam rejects a missing/wrong-typed key for a
// representative SUBSET (identity.registered, room.replied, message.reacted/
// unreacted, project.announced-via-rowToEvent). This block HARDENS the guarantee
// across MORE of the 10 closed event types and EVERY required key of each, plus
// the integer edges, so a future field-validation regression in ANY branch is
// caught — not just the dev's sampled ones. Each malformed case asserts the clear
// MalformedPayloadError naming type + offending key; each type's WELL-FORMED row
// is also asserted to still round-trip (the validation fires ONLY on a genuinely
// malformed row). Mutation-tested non-vacuous (Rule 7) — see the QA test-summary.
// ---------------------------------------------------------------------------
describe('wireToPayload — malformed-payload matrix across all 10 types (Story 13.4 QA)', () => {
  // For each closed event type: a WELL-FORMED wire payload, and the camelCase
  // payload it must produce. Every required key is then independently dropped and
  // wrong-typed below, driven off this single source of truth.
  const cases: {
    type: EventType;
    wellFormed: Record<string, unknown>;
    expected: Record<string, unknown>;
    /** Required STRING keys (snake_case wire keys). */
    stringKeys: string[];
    /** Required INTEGER keys (snake_case wire keys). */
    intKeys: string[];
  }[] = [
    {
      type: 'identity.registered',
      wellFormed: { handle: 'alice', current_focus: 'f' },
      expected: { handle: 'alice', currentFocus: 'f' },
      stringKeys: ['handle', 'current_focus'],
      intKeys: [],
    },
    {
      type: 'identity.focus_updated',
      wellFormed: { handle: 'alice', current_focus: 'f2' },
      expected: { handle: 'alice', currentFocus: 'f2' },
      stringKeys: ['handle', 'current_focus'],
      intKeys: [],
    },
    {
      type: 'identity.seen',
      wellFormed: { handle: 'alice' },
      expected: { handle: 'alice' },
      stringKeys: ['handle'],
      intKeys: [],
    },
    {
      type: 'project.announced',
      wellFormed: { project_id: 'p', title: 't', description: 'd' },
      expected: { projectId: 'p', title: 't', description: 'd' },
      stringKeys: ['project_id', 'title', 'description'],
      intKeys: [],
    },
    {
      type: 'board.joined',
      wellFormed: { project_id: 'p' },
      expected: { projectId: 'p' },
      stringKeys: ['project_id'],
      intKeys: [],
    },
    {
      type: 'announcement.posted',
      wellFormed: { project_id: 'p', room_id: 'r', subject: 's', body: 'b' },
      expected: { projectId: 'p', roomId: 'r', subject: 's', body: 'b' },
      stringKeys: ['project_id', 'room_id', 'subject', 'body'],
      intKeys: [],
    },
    {
      type: 'room.replied',
      wellFormed: { room_id: 'r', body: 'b' },
      expected: { roomId: 'r', body: 'b' },
      stringKeys: ['room_id', 'body'],
      intKeys: [],
    },
    {
      type: 'room.participant_added',
      wellFormed: { room_id: 'r', handle: 'h' },
      expected: { roomId: 'r', handle: 'h' },
      stringKeys: ['room_id', 'handle'],
      intKeys: [],
    },
    {
      type: 'message.reacted',
      wellFormed: { message_seq: 7 },
      expected: { messageSeq: 7 },
      stringKeys: [],
      intKeys: ['message_seq'],
    },
    {
      type: 'message.unreacted',
      wellFormed: { message_seq: 7 },
      expected: { messageSeq: 7 },
      stringKeys: [],
      intKeys: ['message_seq'],
    },
  ];

  for (const c of cases) {
    describe(c.type, () => {
      it('round-trips a well-formed payload (validation does NOT fire)', () => {
        expect(wireToPayload(c.type, { ...c.wellFormed })).toEqual(c.expected);
      });

      for (const key of c.stringKeys) {
        it(`throws when required string "${key}" is MISSING`, () => {
          const wire = { ...c.wellFormed };
          delete wire[key];
          expect(() => wireToPayload(c.type, wire)).toThrow(
            MalformedPayloadError,
          );
          // The message names BOTH the type and the offending key.
          expect(() => wireToPayload(c.type, wire)).toThrow(
            new RegExp(
              `malformed ${escapeRe(c.type)} payload.*${escapeRe(key)}`,
              'u',
            ),
          );
        });

        it(`throws when required string "${key}" is WRONG-TYPED (number)`, () => {
          const wire = { ...c.wellFormed, [key]: 123 };
          expect(() => wireToPayload(c.type, wire)).toThrow(
            new RegExp(
              `malformed ${escapeRe(c.type)} payload.*${escapeRe(key)}`,
              'u',
            ),
          );
        });

        it(`throws when required string "${key}" is NULL (typeof object, not string)`, () => {
          // A JSON null is a common corrupt-row shape; the old String(null) ==
          // "null" silent coercion is exactly what this rejects.
          const wire = { ...c.wellFormed, [key]: null };
          expect(() => wireToPayload(c.type, wire)).toThrow(
            MalformedPayloadError,
          );
        });
      }

      for (const key of c.intKeys) {
        it(`throws when required integer "${key}" is MISSING (no silent NaN)`, () => {
          const wire = { ...c.wellFormed };
          delete wire[key];
          expect(() => wireToPayload(c.type, wire)).toThrow(
            new RegExp(
              `malformed ${escapeRe(c.type)} payload.*${escapeRe(key)}`,
              'u',
            ),
          );
        });

        it(`throws when required integer "${key}" is a STRING "x" (no NaN coercion)`, () => {
          const wire = { ...c.wellFormed, [key]: 'x' };
          expect(() => wireToPayload(c.type, wire)).toThrow(
            MalformedPayloadError,
          );
        });

        it(`throws when required integer "${key}" is a NON-INTEGER (1.5)`, () => {
          const wire = { ...c.wellFormed, [key]: 1.5 };
          expect(() => wireToPayload(c.type, wire)).toThrow(
            MalformedPayloadError,
          );
        });
      }
    });
  }

  it('propagates a malformed payload through rowToEvent for every multi-key type', () => {
    // The dev block covers rowToEvent for project.announced; this widens the
    // JSON-payload-on-disk path to a second type (announcement.posted) so the
    // rowToEvent → JSON.parse → wireToPayload chain is proven for a 4-key shape.
    const row: StoredEventRow = {
      seq: 11,
      type: 'announcement.posted',
      actor: 'x',
      created_at: '2026-05-30T00:00:00.000Z',
      // missing `body`
      payload: JSON.stringify({ project_id: 'p', room_id: 'r', subject: 's' }),
    };
    expect(() => rowToEvent(row)).toThrow(
      /malformed announcement\.posted payload.*body/u,
    );
  });
});

// QA OBSERVATION (Story 13.4) — message_seq positivity is NOT validated, only
// integer-ness. `requireInt` rejects non-numbers, NaN, and non-integers, but a
// NEGATIVE or ZERO integer passes (typeof number && Number.isInteger). A real
// `message_seq` references an assigned AUTOINCREMENT seq (always ≥ 1), so a ≤ 0
// value is technically a malformed reference — but the dev's validator (and the AC,
// which asks for "missing/wrong-typed", not "out-of-range") does not guard it. This
// test PINS the current behavior so it is a deliberate, documented choice rather
// than an unstated gap; surfaced in the QA test-summary as a LOW observation (not a
// gate-blocking defect — no AC requires positivity, and the upstream write path
// only ever stamps real positive seq values).
describe('wireToPayload — message_seq positivity is NOT validated (QA observation, Story 13.4)', () => {
  it('ACCEPTS a negative integer message_seq (only integer-ness is checked)', () => {
    expect(wireToPayload('message.reacted', { message_seq: -5 })).toEqual({
      messageSeq: -5,
    });
  });

  it('ACCEPTS a zero message_seq (only integer-ness is checked)', () => {
    expect(wireToPayload('message.unreacted', { message_seq: 0 })).toEqual({
      messageSeq: 0,
    });
  });
});

/** Escape a string for safe interpolation into a `RegExp` (dots in event types). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

describe('mapping round-trip — write then read yields original payload (AC1)', () => {
  it('rowToEvent(newEventToRow(...)) restores the original camelCase payload for all 10 types', () => {
    // One representative NewEvent per closed-vocabulary type.
    const samples: NewEvent[] = [
      {
        type: 'identity.registered',
        actor: 'a',
        payload: { handle: 'a', currentFocus: 'f' },
      },
      {
        type: 'identity.focus_updated',
        actor: 'a',
        payload: { handle: 'a', currentFocus: 'f2' },
      },
      { type: 'identity.seen', actor: 'a', payload: { handle: 'a' } },
      {
        type: 'project.announced',
        actor: 'a',
        payload: { projectId: 'p', title: 't', description: 'd' },
      },
      { type: 'board.joined', actor: 'a', payload: { projectId: 'p' } },
      {
        type: 'announcement.posted',
        actor: 'a',
        payload: { projectId: 'p', roomId: 'r', subject: 's', body: 'b' },
      },
      { type: 'room.replied', actor: 'a', payload: { roomId: 'r', body: 'b' } },
      {
        type: 'room.participant_added',
        actor: 'a',
        payload: { roomId: 'r', handle: 'h' },
      },
      { type: 'message.reacted', actor: 'a', payload: { messageSeq: 9 } },
      { type: 'message.unreacted', actor: 'a', payload: { messageSeq: 9 } },
    ];

    const createdAt = '2026-05-30T12:00:00.000Z';
    let seq = 0;
    for (const newEvent of samples) {
      const rowInput = newEventToRow(newEvent, createdAt);
      // Simulate the on-disk row SQLite would hand back (seq assigned, same cols).
      seq += 1;
      const stored: StoredEventRow = {
        seq,
        type: rowInput.type,
        actor: rowInput.actor,
        created_at: rowInput.created_at,
        payload: rowInput.payload,
      };
      const event: Event = rowToEvent(stored);

      expect(event.type).toBe(newEvent.type);
      expect(event.actor).toBe(newEvent.actor);
      expect(event.createdAt).toBe(createdAt);
      expect(event.seq).toBe(seq);
      // The payload round-trips exactly (modulo assigned seq/createdAt above).
      expect(event.payload).toEqual(newEvent.payload);
    }
  });
});
