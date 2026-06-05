// room-uri round-trip tests (Story 10.3) — the `agentbbs://room/<id>` scheme that links a tree
// row's resourceUri to the FileDecorationProvider. Discoverable by ROOT `pnpm test`.

import { describe, expect, it } from 'vitest';

import {
  AGENTBBS_URI_SCHEME,
  parseRoomUri,
  roomUriString,
} from './room-uri.js';

describe('room URI round-trip', () => {
  it('builds an agentbbs://room/<id> URI', () => {
    expect(roomUriString('my-room-1')).toBe('agentbbs://room/my-room-1');
    expect(AGENTBBS_URI_SCHEME).toBe('agentbbs');
  });

  it('recovers the roomId from a well-formed URI', () => {
    expect(parseRoomUri(roomUriString('my-room-1'))).toBe('my-room-1');
  });

  it('round-trips an id with reserved characters', () => {
    const id = 'room/with space';
    expect(parseRoomUri(roomUriString(id))).toBe(id);
  });

  it('rejects a non-room / foreign-scheme URI', () => {
    expect(parseRoomUri('file:///etc/passwd')).toBeUndefined();
    expect(parseRoomUri('agentbbs://project/x')).toBeUndefined();
    expect(parseRoomUri('agentbbs://room/')).toBeUndefined();
    expect(parseRoomUri('not a uri')).toBeUndefined();
  });
});
