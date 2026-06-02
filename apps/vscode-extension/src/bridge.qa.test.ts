// QA-added seam coverage for the postMessage bridge (Story 10.2, AC2) — REAL-RUNTIME at the
// library tier: a fake in-memory Messaging channel + a REAL node:sqlite data-access handle
// over a genuine temp-file ledger (the same adapter the extension host uses). Nothing stubbed.
//
// The dev's bridge.test.ts pins the happy path (each READ op, the `reply` write + trim, an
// unknown op, a ROOM_NOT_FOUND round-trip, one delta push, dispose). This file crosses the
// SEAMS that path skips:
//   - a CORE BoardError OTHER than ROOM_NOT_FOUND (a >256 KB body → BODY_TOO_LARGE) round-trips
//     its CLOSED agent-facing code through the write op — proving the closed-set mapping is not
//     special-cased to the one read-side code the happy path used;
//   - a write op (`reply`) with a MISSING required arg → host-surface BAD_REQUEST, persists
//     NOTHING (the requireString guard fires before core, like the web host's body guard);
//   - the delta poll DE-DUPS: a second tick with no new event pushes NO further delta, and a
//     delta is pushed EXACTLY ONCE for a given advance (no re-send of already-pushed events);
//   - EMPTY-LEDGER / no-flood-on-connect: connecting to an existing ledger does NOT push the
//     pre-existing back-history as a delta (the lastSentSeq seed-to-now posture — NFR5/`check`'s
//     no-flood rule); only events that land AFTER connect are pushed;
//   - dispose() is IDEMPOTENT (a second call is a no-op, no throw).
//
// Discoverable by the ROOT `pnpm test` (co-located apps/*/src/**/*.test.ts → node project; Rule 8).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAX_BODY_BYTES,
  announceProject,
  postAnnouncement,
  register,
} from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBridge,
  dispatchRequest,
  type HostToWebview,
  type Messaging,
} from './bridge.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;
let dbPath: string;
let da: DataAccessHandle | undefined;

function fakeChannel(): Messaging & {
  sent: HostToWebview[];
  inject(msg: unknown): void;
} {
  const handlers: Array<(m: unknown) => void> = [];
  const sent: HostToWebview[] = [];
  return {
    sent,
    postMessage(message) {
      sent.push(message);
    },
    onMessage(handler) {
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    inject(msg) {
      for (const h of [...handlers]) h(msg);
    },
  };
}

async function seedBoard(
  d: DataAccessHandle,
): Promise<{ roomId: string; projectId: string }> {
  await register(d, { handle: 'alice', currentFocus: 'seeding' });
  const project = await announceProject(d, 'alice', {
    title: 'Test Project',
    description: 'desc',
  });
  const room = await postAnnouncement(d, 'alice', {
    projectId: project.projectId,
    subject: 'Subject',
    body: 'Body',
  });
  return { roomId: room.roomId, projectId: project.projectId };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-bridge-qa-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
  da = createDataAccessNodeSqlite({ dbPath });
});

afterEach(() => {
  try {
    da?.close();
  } catch {
    /* already closed */
  }
  da = undefined;
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

describe('bridge dispatch — closed-set error mapping beyond the happy-path code', () => {
  it('a core BODY_TOO_LARGE (a write op error ≠ ROOM_NOT_FOUND) round-trips its CLOSED code', async () => {
    const { roomId } = await seedBoard(da!);
    await register(da!, { handle: 'bob', currentFocus: 'x' });
    const before = await da!.maxSeq();

    // One byte over the formal 256 KB cap → core throws BODY_TOO_LARGE (a CLOSED agent-facing
    // code distinct from the read-side ROOM_NOT_FOUND the dev test used). The non-whitespace
    // body clears the host-side trim guard, so the error originates in CORE, not the bridge.
    const tooBig = 'a'.repeat(MAX_BODY_BYTES + 1);
    const res = await dispatchRequest(da!, {
      id: 'big',
      op: 'reply',
      args: { actor: 'bob', roomId, body: tooBig },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('BODY_TOO_LARGE');
    // Atomic: the rejected write persisted nothing.
    expect(await da!.maxSeq()).toBe(before);
  });

  it('a write op with a MISSING required arg → host-surface BAD_REQUEST, persists nothing', async () => {
    const { roomId } = await seedBoard(da!);
    const before = await da!.maxSeq();
    // No `actor` arg → requireString fires a BAD_REQUEST before core.
    const res = await dispatchRequest(da!, {
      id: 'noargs',
      op: 'reply',
      args: { roomId, body: 'hi' },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('BAD_REQUEST');
    expect(await da!.maxSeq()).toBe(before);
  });
});

describe('bridge delta poll — de-dup + no-flood-on-connect (NFR5 pull-only posture)', () => {
  it('does NOT push the pre-existing back-history on connect (seeds lastSentSeq to "now")', async () => {
    // The ledger already has seeded events BEFORE the bridge connects.
    await seedBoard(da!);
    const seededMax = await da!.maxSeq();
    expect(seededMax).toBeGreaterThan(0);

    const channel = fakeChannel();
    const bridge = createBridge({
      dataAccess: da!,
      messaging: channel,
      pollIntervalMs: 10,
    });
    try {
      // Give the poller several ticks to seed + run with NO new event landing.
      await delayMs(80);
      // No delta frame at all — the back-history was NOT flooded to the webview.
      expect(channel.sent.filter((m) => m.type === 'delta')).toHaveLength(0);
    } finally {
      bridge.dispose();
    }
  });

  it('pushes a delta EXACTLY ONCE per advance and de-dups idle ticks (no re-send)', async () => {
    await seedBoard(da!);
    const channel = fakeChannel();
    const bridge = createBridge({
      dataAccess: da!,
      messaging: channel,
      pollIntervalMs: 10,
    });
    try {
      await delayMs(40); // let it seed to "now"

      // One new event → exactly one delta, carrying that event.
      await register(da!, { handle: 'carol', currentFocus: 'joining' });
      await waitFor(() => channel.sent.some((m) => m.type === 'delta'));
      // Let several MORE idle ticks pass with NO further event.
      await delayMs(60);

      const deltas = channel.sent.filter((m) => m.type === 'delta');
      expect(deltas).toHaveLength(1); // de-dup: idle ticks pushed nothing more
      expect(
        (deltas[0] as { events: unknown[] }).events.length,
      ).toBeGreaterThan(0);

      // A SECOND distinct event → a SECOND delta whose maxSeq strictly advances (the cursor
      // moved; the first event is NOT re-sent — the new delta starts past the first's seq).
      const firstMax = (deltas[0] as { maxSeq: number }).maxSeq;
      await register(da!, { handle: 'dave', currentFocus: 'joining' });
      await waitFor(
        () => channel.sent.filter((m) => m.type === 'delta').length === 2,
      );
      const allDeltas = channel.sent.filter((m) => m.type === 'delta');
      expect((allDeltas[1] as { maxSeq: number }).maxSeq).toBeGreaterThan(
        firstMax,
      );
    } finally {
      bridge.dispose();
    }
  });

  it('does NOT re-push an event that lands BETWEEN maxSeq() and eventsSince() within one tick (exactly-once under the read race)', async () => {
    // The poll tick reads max = maxSeq() THEN events = eventsSince(lastSentSeq). If a new event
    // commits in that window, the pushed batch's last seq is GREATER than `max`. Advancing the
    // mark to `max` (rather than the batch high-water) would leave it below that event and the
    // NEXT tick would re-fetch + RE-PUSH it — a duplicate delta. We force exactly that race by
    // wrapping the handle so a fresh event is appended once, between maxSeq() and eventsSince().
    await seedBoard(da!);
    let raced = false;
    const racing: DataAccessHandle = {
      ...da!,
      maxSeq: () => da!.maxSeq(),
      eventsSince: async (cursor: number) => {
        if (!raced) {
          raced = true;
          // Commit a new event AFTER maxSeq() was read but BEFORE this read resolves.
          await register(da!, { handle: 'racer', currentFocus: 'late' });
        }
        return da!.eventsSince(cursor);
      },
    };
    const channel = fakeChannel();
    const bridge = createBridge({
      dataAccess: racing,
      messaging: channel,
      pollIntervalMs: 10,
    });
    try {
      await delayMs(40); // seed to "now"
      // Land an event so the first push fires; the wrapper injects a SECOND event mid-read.
      await register(da!, { handle: 'carol', currentFocus: 'joining' });
      await waitFor(() => channel.sent.some((m) => m.type === 'delta'));
      await delayMs(80); // let several more ticks run

      // Collect every event seq pushed across ALL deltas — each must appear EXACTLY ONCE.
      const deltas = channel.sent.filter((m) => m.type === 'delta');
      const pushedSeqs = deltas.flatMap((d) =>
        (d as { events: Array<{ seq: number }> }).events.map((e) => e.seq),
      );
      expect(new Set(pushedSeqs).size).toBe(pushedSeqs.length); // no duplicate seq re-pushed
      // The raced event WAS delivered (not dropped) — exactly-once, not at-most-once.
      const ledgerMax = await da!.maxSeq();
      expect(pushedSeqs).toContain(ledgerMax);
    } finally {
      bridge.dispose();
    }
  });
});

describe('bridge lifecycle — dispose is idempotent', () => {
  it('a second dispose() is a no-op (no throw)', async () => {
    await seedBoard(da!);
    const channel = fakeChannel();
    const bridge = createBridge({
      dataAccess: da!,
      messaging: channel,
      pollIntervalMs: 10,
    });
    await delayMs(20);
    expect(() => {
      bridge.dispose();
      bridge.dispose();
    }).not.toThrow();
  });
});

function delayMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await delayMs(5);
  }
}
