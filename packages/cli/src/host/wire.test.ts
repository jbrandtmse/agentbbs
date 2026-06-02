// Unit tests for the JSON-API wire mappers (Story 9.3, Task 4).
//
// Pins the camelCase→snake_case boundary: the project/member/room/message mappers mirror
// the MCP tool contract envelope shapes, and `eventToWire` remaps the camelCase core
// payload keys back to snake_case for the SSE frames (the wire contract — snake_case at
// every serialization boundary). No mocks — these are pure functions over typed inputs.

import { describe, expect, it } from 'vitest';

import {
  eventToWire,
  memberToWire,
  messageToWire,
  projectToWire,
  roomToWire,
} from './wire.js';

import type {
  DirectoryMember,
  Event,
  Project,
  Room,
  RoomMessage,
} from '@agentbbs/core';

describe('wire mappers — snake_case boundary mirroring the MCP contract', () => {
  it('projectToWire renames camelCase → snake_case + copies members array', () => {
    const project: Project = {
      projectId: 'calling-interface',
      title: 'Calling Interface',
      description: 'd',
      announcer: 'alice',
      seq: 2,
      members: ['alice', 'bob'],
    };
    expect(projectToWire(project)).toEqual({
      project_id: 'calling-interface',
      title: 'Calling Interface',
      description: 'd',
      announcer: 'alice',
      members: ['alice', 'bob'],
    });
  });

  it('memberToWire → { handle, current_focus, last_seen }', () => {
    const member: DirectoryMember = {
      handle: 'alice',
      currentFocus: 'wiring',
      lastSeen: '2026-06-01T00:00:00.000Z',
    };
    expect(memberToWire(member)).toEqual({
      handle: 'alice',
      current_focus: 'wiring',
      last_seen: '2026-06-01T00:00:00.000Z',
    });
  });

  it('roomToWire omits activator fields for a proto-room, includes them when active', () => {
    const proto: Room = {
      roomId: 'r1',
      projectId: 'p',
      subject: 's',
      body: 'b',
      postedBy: 'alice',
      seq: 3,
      active: false,
      activatedBy: undefined,
      activatedAtSeq: undefined,
    };
    const protoWire = roomToWire(proto);
    expect(protoWire).not.toHaveProperty('activated_by');
    expect(protoWire).not.toHaveProperty('activated_at_seq');
    expect(protoWire.active).toBe(false);

    const active: Room = {
      ...proto,
      active: true,
      activatedBy: 'bob',
      activatedAtSeq: 5,
    };
    const activeWire = roomToWire(active);
    expect(activeWire.activated_by).toBe('bob');
    expect(activeWire.activated_at_seq).toBe(5);
  });

  it('messageToWire → { seq, actor, body, kind, reactions }', () => {
    const message: RoomMessage = {
      seq: 4,
      actor: 'alice',
      body: 'hi',
      kind: 'reply',
      reactions: ['bob'],
    };
    expect(messageToWire(message)).toEqual({
      seq: 4,
      actor: 'alice',
      body: 'hi',
      kind: 'reply',
      reactions: ['bob'],
    });
  });

  it('eventToWire remaps camelCase payload keys → snake_case (roomId → room_id)', () => {
    const event: Event = {
      seq: 7,
      type: 'room.replied',
      actor: 'alice',
      createdAt: '2026-06-01T00:00:00.000Z',
      payload: { roomId: 'calling-interface-2', body: 'a reply' },
    };
    const wire = eventToWire(event);
    expect(wire.seq).toBe(7);
    expect(wire.type).toBe('room.replied');
    expect(wire.created_at).toBe('2026-06-01T00:00:00.000Z');
    expect(wire.payload).toEqual({
      room_id: 'calling-interface-2',
      body: 'a reply',
    });
  });

  it('eventToWire remaps a multi-key payload (handle, currentFocus → snake_case)', () => {
    const event: Event = {
      seq: 1,
      type: 'identity.focus_updated',
      actor: 'alice',
      createdAt: '2026-06-01T00:00:00.000Z',
      payload: { handle: 'alice', currentFocus: 'new focus' },
    };
    expect(eventToWire(event).payload).toEqual({
      handle: 'alice',
      current_focus: 'new focus',
    });
  });
});
