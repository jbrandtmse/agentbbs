// Unit tests for the apps/web JSON-API + SSE client helpers (Story 9.3, Task 4).
//
// Pure logic — node env. `fetchDirectory` is exercised with an injected fetch (no real
// server; the AC3 integration test proves the real wiring). `foldDelta` is the SSE-delta
// reducer the shell applies; it must advance the high-water-mark monotonically, count
// deltas, and record the latest event.

import { describe, expect, it } from 'vitest';

import { fetchDirectory, foldDelta, INITIAL_LIVE_STATE } from './api-client.js';

import type { EventWire } from './api-client.js';

describe('fetchDirectory', () => {
  it('returns the parsed { projects } envelope on 200', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ projects: [{ project_id: 'p' }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const res = await fetchDirectory('', fakeFetch);
    expect(res.projects).toHaveLength(1);
    expect(res.projects[0].project_id).toBe('p');
  });

  it('throws on a non-2xx response', async () => {
    const fakeFetch = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchDirectory('', fakeFetch)).rejects.toThrow(/HTTP 500/);
  });
});

describe('foldDelta', () => {
  const event = (seq: number): EventWire => ({
    seq,
    type: 'announcement.posted',
    actor: 'alice',
    created_at: '2026-06-01T00:00:00.000Z',
    payload: {},
  });

  it('advances lastSeq, counts deltas, records the latest', () => {
    let state = INITIAL_LIVE_STATE;
    state = foldDelta(state, event(5));
    expect(state).toMatchObject({ lastSeq: 5, deltaCount: 1 });
    expect(state.latest?.seq).toBe(5);
    state = foldDelta(state, event(8));
    expect(state).toMatchObject({ lastSeq: 8, deltaCount: 2 });
  });

  it('does not regress lastSeq on an out-of-order/older delta', () => {
    let state = foldDelta(INITIAL_LIVE_STATE, event(10));
    state = foldDelta(state, event(3));
    expect(state.lastSeq).toBe(10);
    expect(state.deltaCount).toBe(2);
  });
});
