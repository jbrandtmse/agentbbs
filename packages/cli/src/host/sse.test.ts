// Unit tests for the SSE channel + MAX(seq) poller (Story 9.3, Task 4 / AC #2).
//
// Exercises the framing, the delta-not-full-resend rule, the maxSeq-advance detection,
// and the interval cleanup against a REAL in-memory createDataAccess ledger and a
// lightweight fake ServerResponse that captures the bytes written (no real socket).
// NFR5 framing is structural (this is the host→operator-browser channel; no agent path
// imports it) — proven by the NFR4/boundary structural test, not here.

import { EventEmitter } from 'node:events';

import { announceProject, register } from '@agentbbs/core';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSseChannel } from './sse.js';

import type { DataAccessHandle } from '@agentbbs/data-access';
import type { ServerResponse } from 'node:http';

let dataAccess: DataAccessHandle;

beforeEach(() => {
  dataAccess = createDataAccess({ dbPath: ':memory:' });
});

afterEach(() => {
  dataAccess.close();
});

/** A minimal ServerResponse stand-in that captures written frames + close events. */
class FakeResponse extends EventEmitter {
  written = '';
  headers: Record<string, unknown> | undefined;
  status: number | undefined;
  ended = false;
  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.status = status;
    this.headers = headers;
    return this;
  }
  write(chunk: string): boolean {
    this.written += chunk;
    return true;
  }
  end(): this {
    this.ended = true;
    return this;
  }
  /** The decoded `data:` payloads written so far. */
  dataFrames(): string[] {
    return this.written
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice('data: '.length));
  }
  asResponse(): ServerResponse {
    return this as unknown as ServerResponse;
  }
}

/** Wait until `predicate` is true or the timeout elapses (polling tick-driven). */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}

describe('createSseChannel', () => {
  it('sets text/event-stream headers + an initial open frame on connect', () => {
    const channel = createSseChannel({ dataAccess, pollIntervalMs: 20 });
    const res = new FakeResponse();
    channel.addConnection(res.asResponse());
    expect(res.status).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('text/event-stream');
    expect(res.written).toContain(': connected');
    expect(channel.connectionCount()).toBe(1);
    channel.close();
  });

  it('pushes a delta frame carrying the seq of a NEW event (not a full resend)', async () => {
    // Pre-seed one event BEFORE connecting; it must NOT be resent (the poller seeds
    // its high-water-mark to the current maxSeq on start).
    await register(dataAccess, { handle: 'alice', currentFocus: 'f' });

    const channel = createSseChannel({ dataAccess, pollIntervalMs: 15 });
    const res = new FakeResponse();
    channel.addConnection(res.asResponse());

    // Let the poller seed past the pre-existing event.
    await new Promise((r) => setTimeout(r, 60));
    expect(res.dataFrames()).toHaveLength(0); // pre-existing event NOT resent

    // Append a NEW event → it should arrive as a delta.
    const project = await announceProject(dataAccess, 'alice', {
      title: 'Live Board',
      description: 'd',
    });
    const newSeq = await dataAccess.maxSeq();

    await waitFor(() =>
      res.dataFrames().some((d) => d.includes(`"seq":${newSeq}`)),
    );
    const seqs = res
      .dataFrames()
      .map((d) => (JSON.parse(d) as { seq: number }).seq);
    expect(seqs).toContain(newSeq);
    // Delta only — the pre-seed event (alice's identity.registered at seq 1) is absent.
    expect(seqs).not.toContain(1);
    expect(project.projectId).toBe('live-board');
    channel.close();
  });

  it('stops the poller when the last connection closes (no leaked interval)', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const channel = createSseChannel({ dataAccess, pollIntervalMs: 15 });
    const res = new FakeResponse();
    channel.addConnection(res.asResponse());
    expect(channel.connectionCount()).toBe(1);

    // Simulate the client disconnecting.
    res.emit('close');
    expect(channel.connectionCount()).toBe(0);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
    channel.close();
  });

  it('close() ends every open connection and clears the poller', () => {
    const channel = createSseChannel({ dataAccess, pollIntervalMs: 15 });
    const a = new FakeResponse();
    const b = new FakeResponse();
    channel.addConnection(a.asResponse());
    channel.addConnection(b.asResponse());
    expect(channel.connectionCount()).toBe(2);
    channel.close();
    expect(a.ended).toBe(true);
    expect(b.ended).toBe(true);
    expect(channel.connectionCount()).toBe(0);
  });
});
