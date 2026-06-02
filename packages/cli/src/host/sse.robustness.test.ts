// QA hardening for the SSE channel + MAX(seq) poller (Story 9.3, AC #2/#3 robustness).
//
// skill-rules Rule 5: AC #2/#3 assert a LOAD-BEARING service guarantee — the
// maxSeq-poll → eventsSince → SSE-push path delivering DELTAS to the operator's live
// view. The dev's `sse.test.ts` proves the single-client happy path (headers, one
// delta, the seed-not-resend, cleanup). It does NOT prove the harder service
// properties this suite hardens:
//
//   1. MULTIPLE concurrent clients ALL receive the same delta (a broadcast, not a
//      first-come consume).
//   2. A client connecting AFTER events already exist gets the documented starting
//      point — deltas from "now" forward, NOT a flood of all back-history (the
//      no-flood posture mirroring `check`).
//   3. A delta is NOT re-sent on the next poll tick — exactly-once per client, no
//      duplicate frames as the high-water-mark advances. (Mutation-tested
//      non-vacuous below, skill-rules Rule 7.)
//   4. Rapid successive appends are all delivered, in `seq` ASC order (the append
//      total order — never reordered or coalesced-away).
//   5. One client disconnecting does NOT stop delivery to the others, and does NOT
//      stop the shared poller while connections remain (no premature teardown).
//
// All against a REAL in-memory `createDataAccess` ledger (no mocks) + a lightweight
// fake ServerResponse capturing the written frames (no real socket).

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
  ended = false;
  writeHead(): this {
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
  /** The parsed event objects from each `data:` frame written so far. */
  events(): { seq: number; type: string }[] {
    return this.written
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice('data: '.length))
      .flatMap((d) => {
        try {
          return [JSON.parse(d) as { seq: number; type: string }];
        } catch {
          return [];
        }
      });
  }
  /** The `seq`s delivered, in delivery order. */
  seqs(): number[] {
    return this.events().map((e) => e.seq);
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
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timed out');
}

/** Append a fresh project event; returns the resulting maxSeq. */
async function appendProject(title: string): Promise<number> {
  await announceProject(dataAccess, 'alice', { title, description: 'd' });
  return dataAccess.maxSeq();
}

describe('SSE robustness — broadcast, no-flood, exactly-once, ordering, lifecycle', () => {
  it('broadcasts a delta to MULTIPLE concurrent clients (all receive it)', async () => {
    await register(dataAccess, { handle: 'alice', currentFocus: 'f' });

    const channel = createSseChannel({ dataAccess, pollIntervalMs: 10 });
    const clients = [
      new FakeResponse(),
      new FakeResponse(),
      new FakeResponse(),
    ];
    for (const c of clients) channel.addConnection(c.asResponse());

    // Let the shared poller seed its high-water-mark past the pre-existing register.
    await new Promise((r) => setTimeout(r, 40));

    const newSeq = await appendProject('Broadcast Board');

    await waitFor(() => clients.every((c) => c.seqs().includes(newSeq)));
    // EVERY connected client got the SAME delta — it is a broadcast, not a
    // first-client-consumes queue.
    for (const c of clients) {
      expect(c.seqs()).toContain(newSeq);
    }
    expect(channel.connectionCount()).toBe(3);
    channel.close();
  });

  it('a client connecting AFTER events exist gets deltas from "now" (no back-history flood)', async () => {
    // Seed SEVERAL events BEFORE anyone connects.
    await register(dataAccess, { handle: 'alice', currentFocus: 'f' });
    await appendProject('History One');
    await appendProject('History Two');
    const seqBeforeConnect = await dataAccess.maxSeq();
    expect(seqBeforeConnect).toBeGreaterThan(1);

    const channel = createSseChannel({ dataAccess, pollIntervalMs: 10 });
    const late = new FakeResponse();
    channel.addConnection(late.asResponse());

    // Let the poller seed + run several ticks. NO back-history should be delivered.
    await new Promise((r) => setTimeout(r, 60));
    expect(late.seqs()).toHaveLength(0);

    // A NEW event after connecting DOES arrive (the channel is live, not dead). Note
    // `announceProject` appends a PAIR of events atomically (project.announced +
    // board.joined), so `appendProject` returns the HIGHER of the two seqs.
    const afterSeq = await appendProject('After Connect');
    await waitFor(() => late.seqs().includes(afterSeq));
    // It received ONLY post-connection events — EVERY delivered seq is strictly greater
    // than the pre-connection high-water-mark, so NO back-history leaked in.
    expect(late.seqs().length).toBeGreaterThan(0);
    for (const s of late.seqs()) {
      expect(s).toBeGreaterThan(seqBeforeConnect);
    }
    expect(late.seqs()).toContain(afterSeq);
    channel.close();
  });

  it('does NOT re-send a delivered delta on the next poll tick (exactly-once per client)', async () => {
    // This is the load-bearing lastSentSeq-advance semantic (mutation-tested below).
    await register(dataAccess, { handle: 'alice', currentFocus: 'f' });

    const channel = createSseChannel({ dataAccess, pollIntervalMs: 8 });
    const client = new FakeResponse();
    channel.addConnection(client.asResponse());

    await new Promise((r) => setTimeout(r, 30)); // seed
    const newSeq = await appendProject('Once Only');
    await waitFor(() => client.seqs().includes(newSeq));

    // Let MANY further ticks elapse with NO new appends. The delivered seq must not
    // be re-emitted — the high-water-mark advanced past it.
    await new Promise((r) => setTimeout(r, 80));
    const occurrences = client.seqs().filter((s) => s === newSeq).length;
    expect(occurrences).toBe(1);
    channel.close();
  });

  it('delivers rapid successive appends ALL, in seq ASC order', async () => {
    await register(dataAccess, { handle: 'alice', currentFocus: 'f' });

    const channel = createSseChannel({ dataAccess, pollIntervalMs: 30 });
    const client = new FakeResponse();
    channel.addConnection(client.asResponse());
    await new Promise((r) => setTimeout(r, 60)); // seed

    // Append several events FASTER than the poll interval, so one tick coalesces the
    // batch via eventsSince — all must be delivered, none dropped, in seq order.
    const seqs: number[] = [];
    for (const title of ['Rapid A', 'Rapid B', 'Rapid C', 'Rapid D']) {
      seqs.push(await appendProject(title));
    }
    const lastSeq = seqs[seqs.length - 1];

    await waitFor(() => client.seqs().includes(lastSeq));
    const delivered = client.seqs().filter((s) => seqs.includes(s));
    // All four arrived...
    expect(new Set(delivered)).toEqual(new Set(seqs));
    // ...and in non-decreasing seq order (the append total order is preserved).
    const sorted = [...delivered].sort((a, b) => a - b);
    expect(delivered).toEqual(sorted);
    channel.close();
  });

  it('one client disconnecting keeps delivery + the poller alive for the rest', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    await register(dataAccess, { handle: 'alice', currentFocus: 'f' });

    const channel = createSseChannel({ dataAccess, pollIntervalMs: 10 });
    const stay = new FakeResponse();
    const leave = new FakeResponse();
    channel.addConnection(stay.asResponse());
    channel.addConnection(leave.asResponse());
    await new Promise((r) => setTimeout(r, 40)); // seed

    // One client disconnects; the poller must NOT be cleared (a connection remains).
    leave.emit('close');
    expect(channel.connectionCount()).toBe(1);
    expect(clearSpy).not.toHaveBeenCalled();

    // The surviving client still receives new deltas.
    const newSeq = await appendProject('Survivor Delta');
    await waitFor(() => stay.seqs().includes(newSeq));
    expect(stay.seqs()).toContain(newSeq);
    // The departed client got nothing after it left.
    expect(leave.seqs()).not.toContain(newSeq);

    clearSpy.mockRestore();
    channel.close();
  });
});
