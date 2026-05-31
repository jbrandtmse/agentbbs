// Session-identity holder tests (Story 2.3, Task 2).
//
// The holder is per-connection/per-process server state (one MCP server process ==
// one agent == one session, per architecture "one process per agent"). It is NOT
// board state and lives in the mcp-server layer, never in core. These tests pin its
// tiny contract: starts unauthenticated (`handle: null`) and is a mutable reference
// the tool closures share (so a set is observable to every holder of the reference —
// the mechanism the login/register tools and Stories 2.4/2.5 rely on).

import { describe, expect, it } from 'vitest';

import { createSessionIdentity } from './session.js';

describe('createSessionIdentity', () => {
  it('starts unauthenticated with handle === null', () => {
    const session = createSessionIdentity();
    expect(session.handle).toBeNull();
  });

  it('is a mutable reference — a set is visible through the same object', () => {
    const session = createSessionIdentity();
    session.handle = 'ada';
    expect(session.handle).toBe('ada');
  });

  it('each call returns an independent holder (no shared module state)', () => {
    const a = createSessionIdentity();
    const b = createSessionIdentity();
    a.handle = 'ada';
    expect(b.handle).toBeNull();
  });
});
