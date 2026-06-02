// Payload-map completeness (Story 1.3, AC1).
//
// Asserts there is exactly one EventPayloadMap entry per event type — guarding
// against an event type that has no payload (or a payload with no event). This
// is primarily a TYPE-level guarantee (the map's `extends Record<EventType, …>`
// constraint makes it total at compile time); these tests pin that guarantee and
// add a runtime cross-check of the keys for good measure.

import { describe, expect, expectTypeOf, it } from 'vitest';

import { EVENT_TYPES, type EventType } from './types.js';
import type {
  EventPayloadMap,
  IdentityRegisteredPayload,
  PayloadOf,
  RoomParticipantAddedPayload,
} from './payloads.js';

describe('event payloads (AC1)', () => {
  it('EventPayloadMap has an entry for every EventType (keys match exactly)', () => {
    // Type-level: the map keys are exactly the EventType union.
    expectTypeOf<keyof EventPayloadMap>().toEqualTypeOf<EventType>();
  });

  it('PayloadOf resolves each type to its specific payload', () => {
    expectTypeOf<
      PayloadOf<'identity.registered'>
    >().toEqualTypeOf<IdentityRegisteredPayload>();
    expectTypeOf<
      PayloadOf<'room.participant_added'>
    >().toEqualTypeOf<RoomParticipantAddedPayload>();
  });

  it('payloads are camelCase: identity.registered carries handle + currentFocus', () => {
    // Constructing a value pins the field names (would fail to compile on a
    // snake_case slip or a renamed field).
    const payload: PayloadOf<'identity.registered'> = {
      handle: 'alice',
      currentFocus: 'bootstrapping the board',
    };
    expect(Object.keys(payload).sort()).toEqual(['currentFocus', 'handle']);
  });

  it('room.participant_added.handle is the ADDED identity (a second handle)', () => {
    const payload: PayloadOf<'room.participant_added'> = {
      roomId: 'calling-interface',
      handle: 'bob',
    };
    expect(payload.handle).toBe('bob');
    expect(payload.roomId).toBe('calling-interface');
  });

  it('message.reacted carries the messageSeq it targets', () => {
    const payload: PayloadOf<'message.reacted'> = { messageSeq: 42 };
    expect(payload.messageSeq).toBe(42);
  });

  it('announcement.posted carries the board scope projectId alongside roomId/subject/body (Story 4.1)', () => {
    // Story 4.1 ADDED projectId (the sub-board the announcement was posted to) to the
    // previously board-less payload. Constructing the value pins all four field names
    // (would fail to compile if projectId were dropped or renamed).
    const payload: PayloadOf<'announcement.posted'> = {
      projectId: 'calling-interface',
      roomId: 'calling-interface-2',
      subject: 'Calling Interface',
      body: 'need a hand on the calling interface',
    };
    expect(Object.keys(payload).sort()).toEqual([
      'body',
      'projectId',
      'roomId',
      'subject',
    ]);
    expect(payload.projectId).toBe('calling-interface');
  });

  it('the runtime vocabulary covers every payload-map key (cross-check)', () => {
    // Every event type has a payload entry: build a fully-populated map and
    // assert its keys equal EVENT_TYPES. This catches a runtime/type drift where
    // the tuple and the map fall out of sync.
    const witness: Record<EventType, true> = {
      'identity.registered': true,
      'identity.focus_updated': true,
      'identity.seen': true,
      'project.announced': true,
      'board.joined': true,
      'announcement.posted': true,
      'room.replied': true,
      'room.participant_added': true,
      'message.reacted': true,
      'message.unreacted': true,
    };
    expect(Object.keys(witness).sort()).toEqual([...EVENT_TYPES].sort());
  });
});
