// Wire-mapping tests (Story 1.5, AC1/AC2) — WRITE direction.
//
// Asserts the camelCase (core) -> snake_case (wire/at-rest) conversion is correct
// and exhaustive over the closed event vocabulary, that `newEventToRow` stamps
// `created_at` and produces a JSON string with snake_case keys, and that NO
// camelCase key leaks into the serialized payload.

import { describe, expect, it } from 'vitest';

import { newEventToRow, payloadToWire } from './mapping.js';

import type { NewEvent } from '@agentbbs/core';

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

  it('leaves single-word keys unchanged', () => {
    expect(
      payloadToWire({
        type: 'announcement.posted',
        actor: 'alice',
        payload: { roomId: 'r1', subject: 'Subj', body: 'Body' },
      }),
    ).toEqual({ room_id: 'r1', subject: 'Subj', body: 'Body' });
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
        payload: { roomId: 'r', subject: 's', body: 'b' },
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
