// Wire-mapping tests (Story 1.5, AC1/AC2) — WRITE direction.
//
// Asserts the camelCase (core) -> snake_case (wire/at-rest) conversion is correct
// and exhaustive over the closed event vocabulary, that `newEventToRow` stamps
// `created_at` and produces a JSON string with snake_case keys, and that NO
// camelCase key leaks into the serialized payload.

import { describe, expect, it } from 'vitest';

import {
  newEventToRow,
  payloadToWire,
  rowToEvent,
  wireToPayload,
} from './mapping.js';

import type { StoredEventRow } from './mapping.js';
import type { Event, NewEvent } from '@agentbbs/core';

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
