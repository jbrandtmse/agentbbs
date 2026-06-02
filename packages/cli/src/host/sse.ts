// The on-demand web host's SSE channel + MAX(seq) poller (Story 9.3, Task 2 / AC #2).
//
// NFR5 FRAMING (load-bearing — do not blur): this SSE channel is the HOST → OPERATOR-
// BROWSER live view. The operator opened the control room; this streams the board's
// new events to THEIR OWN open browser. It is NOT an agent push: agents stay strictly
// pull-only via `check` (the agent-facing contract pushes nothing — pull-only-delivery.md
// / project-context.md#pull-only line). An SSE to the operator's own chosen live view is
// not a push to an agent. No agent path touches this code.
//
// HOW (AC #2): the host does NOT subscribe to the ledger (SQLite has no change feed) —
// it POLLS `dataAccess.maxSeq()` on a short interval. When `maxSeq` advances past the
// last-sent `seq`, it reads the new events via `eventsSince(lastSent)` and writes each as
// an SSE `data:` frame (with an `id:` = the event `seq`) to every connected client, then
// advances the shared high-water-mark. So clients receive DELTAS (events with
// `seq > lastSentSeq`), never a full re-send.
//
// LIFECYCLE: one shared poller for the whole host (a single `setInterval`), started on
// first connection and stopped when the last client disconnects (and on host shutdown).
// Each connection is tracked; a client `close` removes it. No leaked intervals/sockets:
// `close()` clears the interval and ends every open response. The shared `lastSentSeq`
// is seeded to the current `maxSeq()` when the poller starts, so a freshly-connected
// operator sees deltas from "now" forward (back-history is fetched via the JSON API /
// read_room on demand — same posture as `check`'s no-flood rule).

import { eventToWire } from './wire.js';

import type { DataAccess } from '@agentbbs/core';
import type { ServerResponse } from 'node:http';

/** The default poll interval (ms) — short enough to feel live, cheap as a maxSeq read. */
export const DEFAULT_SSE_POLL_INTERVAL_MS = 250;

/** SSE response headers (text/event-stream; no caching; keep-alive). */
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  // Defeat proxy buffering so frames flush immediately.
  'X-Accel-Buffering': 'no',
} as const;

/** Options for {@link createSseChannel}. */
export interface SseChannelOptions {
  /** The persistence port the poller reads (`maxSeq` + `eventsSince`). */
  dataAccess: DataAccess;
  /** Poll interval in ms. Defaults to {@link DEFAULT_SSE_POLL_INTERVAL_MS}. */
  pollIntervalMs?: number;
}

/** The SSE channel: attach operator connections, poll for deltas, clean up. */
export interface SseChannel {
  /**
   * Register a new operator-browser connection. Writes the SSE headers, sends an
   * initial comment frame (so the client's EventSource fires `open`), starts the
   * shared poller if this is the first client, and wires `close` cleanup.
   */
  addConnection(res: ServerResponse): void;
  /** The number of currently-connected operator browsers (for tests/diagnostics). */
  connectionCount(): number;
  /** Stop the poller and end every open connection (host shutdown). Idempotent. */
  close(): void;
}

/**
 * Create the host's SSE channel over a {@link DataAccess} port. One shared poller
 * serves all connected operator browsers; deltas are events with `seq > lastSentSeq`.
 *
 * @param options The data-access port + optional poll interval.
 * @returns An {@link SseChannel} the HTTP host attaches connections to.
 */
export function createSseChannel(options: SseChannelOptions): SseChannel {
  const { dataAccess } = options;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_SSE_POLL_INTERVAL_MS;

  const connections = new Set<ServerResponse>();
  let timer: NodeJS.Timeout | undefined;
  // The shared high-water-mark: the highest `seq` already pushed to clients. `-1`
  // means "not yet seeded" (seed to the live maxSeq on poller start so connecting
  // does not flood pre-connection back-history).
  let lastSentSeq = -1;
  // Guards against overlapping polls (a slow read should not stack intervals).
  let polling = false;

  /** Write one SSE event frame (id + data) to a single connection. */
  function writeFrame(res: ServerResponse, seq: number, data: string): void {
    res.write(`id: ${seq}\n`);
    res.write(`data: ${data}\n\n`);
  }

  /** One poll tick: detect new events via maxSeq, push deltas, advance the mark. */
  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const max = await dataAccess.maxSeq();
      if (lastSentSeq === -1) {
        // Seed on first tick: start streaming from "now" forward.
        lastSentSeq = max;
        return;
      }
      if (max <= lastSentSeq) return; // no advance → nothing to push
      const newEvents = await dataAccess.eventsSince(lastSentSeq);
      for (const event of newEvents) {
        const frame = JSON.stringify(eventToWire(event));
        for (const res of connections) {
          writeFrame(res, event.seq, frame);
        }
        if (event.seq > lastSentSeq) lastSentSeq = event.seq;
      }
    } catch {
      // A transient read error must not kill the poller; the next tick retries. We
      // deliberately swallow (the operator's live view degrades gracefully, agents
      // are unaffected — they never touch this path).
    } finally {
      polling = false;
    }
  }

  function startPollerIfNeeded(): void {
    if (timer !== undefined) return;
    lastSentSeq = -1; // re-seed on (re)start
    timer = setInterval(() => {
      void poll();
    }, pollIntervalMs);
    // Do not keep the process alive solely for the poller (on-demand host: the HTTP
    // server's listening socket is what keeps it up; the poller is incidental).
    timer.unref?.();
  }

  function stopPoller(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  return {
    addConnection(res: ServerResponse): void {
      res.writeHead(200, SSE_HEADERS);
      // An initial comment frame so the client's EventSource fires `open` promptly.
      res.write(': connected\n\n');
      connections.add(res);
      startPollerIfNeeded();

      const cleanup = (): void => {
        connections.delete(res);
        if (connections.size === 0) {
          stopPoller();
        }
      };
      res.on('close', cleanup);
    },
    connectionCount(): number {
      return connections.size;
    },
    close(): void {
      stopPoller();
      for (const res of connections) {
        res.end();
      }
      connections.clear();
    },
  };
}
