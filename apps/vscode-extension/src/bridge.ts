// The postMessage bridge: host ⇄ webview (Story 10.2, AC2).
//
// THE VS CODE ANALOGUE of the web host's JSON API + SSE poller (packages/cli/src/host/) — the
// SAME thin-client pattern (mirror core read/write ops over the DataAccess seam), but over
// `postMessage` instead of HTTP/SSE. The webview issues a typed request `{ id, op, args }`;
// the host invokes the corresponding CORE op THROUGH the data-access handle and posts back
// `{ id, ok, result | error }`. A short-interval `MAX(seq)` poll pushes new-event deltas to the
// webview (host→webview only). NO board logic lives here — it composes core ops, never
// reimplements a fold/gate.
//
// RULE 13 (LOAD-BEARING):
//   - Every webview affordance maps to an EXISTING core op (no fabricated board op, no client
//     backdoor). The read surface (boardDirectory/listProjects/listRooms/listAnnouncements/
//     readRoom/readContract) + the write pattern (reply) are exactly the ops the web host
//     mirrors and an agent could perform via MCP.
//   - PULL-ONLY (NFR5) is preserved: the delta push is host→ITS-OWN-webview (the operator's
//     editor view), NOT an agent push. Agents keep `check`. No agent-facing push path is added
//     — structurally, this module touches only the local webview messaging channel.
//   - TRIM DISCIPLINE (Story 10.0 awareness carry, item 9.13-trim): the `reply` write trims the
//     body host-side and REJECTS a whitespace-only body before reaching core, so the bridge
//     never persists a whitespace post a direct caller could send. (A future `updateFocus`
//     write — deferred to its consuming story — must apply the SAME trim.)
//
// WRITE SURFACE SCOPE (named, not silently dropped): the READ surface + the `reply` write were
// established in Story 10.2. Story 10.4 (the room webview consumer) wires `react`/`unreact` for
// the ReactionChip 👍 toggle — the SAME core ops an agent uses (Rule 13; named-deferred-to-
// consumer in 10.2, consumed here, NOT a dead 👍 click). The remaining writes
// (joinBoard/updateFocus/announceProject/postAnnouncement/addParticipant) stay
// DEFERRED-TO-CONSUMER — wired by their consuming Epic-10 stories (the operator INITIATE
// surfaces are Story 10.7) following this same dispatch shape, exactly as the web host added
// writes incrementally. They are NOT fabricated here.

import {
  BoardError,
  boardDirectory,
  findRoom,
  listAnnouncements,
  listProjects,
  listRooms,
  react,
  readContract,
  reply,
  roomMessages,
  roomParticipants,
  unreact,
} from '@agentbbs/core';

import type { DataAccess } from '@agentbbs/core';

/** A webview→host request: a correlation `id`, the `op` name, and its `args`. */
export interface BridgeRequest {
  id: string;
  op: string;
  args?: Record<string, unknown>;
}

/** A host→webview response: the `id` it answers, an `ok` flag, and the result OR a typed error. */
export interface BridgeResponse {
  type: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  /** Present iff `ok === false`: a `{ code, message }` mirroring the closed BoardError shape. */
  error?: { code: string; message: string };
}

/** A host→webview DELTA frame: new events (seq > the webview's last-seen), pushed by the poller. */
export interface BridgeDelta {
  type: 'delta';
  /** New events as raw folded core Events (the webview derives its own UI). seq-ASC. */
  events: unknown[];
  /** The new high-water-mark (max seq pushed) — the webview's next cursor. */
  maxSeq: number;
}

/**
 * A host→webview THEME-KIND frame (Story 10.6, AC2): the operator's active color-theme kind changed
 * (`vscode.window.onDidChangeActiveColorTheme`). Carries the {@link webviewThemeKind} token so the
 * webview re-applies its `data-theme-kind` attribute and the `vscode-tokens.css` HC overrides flip
 * LIVE. Host→its-own-webview only (NFR5 — no agent path; this is purely the operator's editor view).
 */
export interface BridgeThemeKind {
  type: 'themeKind';
  /** The theme-kind token (`light` / `dark` / `high-contrast` / `high-contrast-light`). */
  kind: string;
}

/** Anything the host posts to the webview. */
export type HostToWebview = BridgeResponse | BridgeDelta | BridgeThemeKind;

/**
 * A transport-agnostic message channel — the seam that lets the bridge be unit-tested with a
 * fake channel AND bound to a real VS Code `Webview` (whose `postMessage` + `onDidReceiveMessage`
 * satisfy this shape). The bridge depends ONLY on this, never on `vscode` — so the dispatch +
 * poll logic is testable in plain Node with an in-memory channel and a real in-memory
 * data-access handle.
 */
export interface Messaging {
  /** Post a message to the webview (host→webview). */
  postMessage(message: HostToWebview): void;
  /** Register a handler for webview→host messages. Returns a disposer. */
  onMessage(handler: (message: unknown) => void): () => void;
}

/** Options for {@link createBridge}. */
export interface BridgeOptions {
  /** The persistence port every op delegates to (the node:sqlite-backed handle). */
  dataAccess: DataAccess;
  /** The webview messaging channel. */
  messaging: Messaging;
  /** Poll interval (ms) for the MAX(seq) delta poll. Default {@link DEFAULT_POLL_INTERVAL_MS}. */
  pollIntervalMs?: number;
}

/** The default delta-poll interval (ms) — short enough to feel live, cheap as a maxSeq read. */
export const DEFAULT_POLL_INTERVAL_MS = 250;

/** The live bridge: dispatches requests + runs the delta poll. `dispose()` stops everything. */
export interface Bridge {
  /** Stop the poll, detach the message handler. Idempotent. */
  dispose(): void;
}

/**
 * A HOST-surface error — a condition the bridge detects BEFORE (or instead of) reaching core,
 * so it has NO place in core's closed `BoardError` set (Rule 13 — the agent-facing error
 * contract stays byte-identical). It carries its own SCREAMING_SNAKE code in the HOST's
 * vocabulary (`BAD_REQUEST`). `dispatchRequest` maps it to the same `{ code, message }` error
 * envelope as a `BoardError`; only the origin differs. This mirrors the web host's `HostApiError`.
 */
class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

/** The read ops the tree + room views need — each composed from core, NO board logic here. */
type OpHandler = (
  dataAccess: DataAccess,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Require a string arg; throw a host-surface BAD_REQUEST (mirrors the web host's body guard). */
function requireString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BridgeError(
      'BAD_REQUEST',
      `Request arg "${field}" must be a non-empty string.`,
    );
  }
  return value;
}

/** Require a finite-number arg; throw a host-surface BAD_REQUEST (the react/unreact target seq). */
function requireNumber(args: Record<string, unknown>, field: string): number {
  const value = args[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BridgeError(
      'BAD_REQUEST',
      `Request arg "${field}" must be a finite number.`,
    );
  }
  return value;
}

/**
 * The op table — webview op name → composed core call. READ ops mirror the web host's GET
 * routes; the single WRITE (`reply`) establishes the request/response write pattern. Adding a
 * later write (10.3–10.6) is a new entry here, the SAME shape — never a fabricated board op.
 */
const OPS: Record<string, OpHandler> = {
  // --- READ surface (the tree + room views consume these) ---
  listProjects: async (dataAccess) => ({
    projects: await listProjects(dataAccess),
  }),
  boardDirectory: async (dataAccess, args) => ({
    members: await boardDirectory(dataAccess, requireString(args, 'projectId')),
  }),
  listRooms: async (dataAccess, args) => ({
    rooms: await listRooms(dataAccess, requireString(args, 'projectId')),
  }),
  listAnnouncements: async (dataAccess, args) => ({
    announcements: await listAnnouncements(
      dataAccess,
      requireString(args, 'projectId'),
    ),
  }),
  readRoom: async (dataAccess, args) => {
    // No standalone core `readRoom` op exists; mirror the web host — fold the stream ONCE and
    // derive room + messages + participants from it (an unknown room → ROOM_NOT_FOUND, the
    // same code readContract raises). Ordering stays by `seq` (roomMessages keeps that).
    const roomId = requireString(args, 'roomId');
    const events = await dataAccess.eventsSince(0);
    const room = findRoom(events, roomId);
    if (room === undefined) {
      throw new BoardError(
        'ROOM_NOT_FOUND',
        `No such room: "${roomId}". It was never announced.`,
      );
    }
    return {
      room,
      messages: roomMessages(events, roomId),
      participants: roomParticipants(events, roomId),
    };
  },
  readContract: async (dataAccess, args) => {
    const roomId = requireString(args, 'roomId');
    return { roomId, contract: await readContract(dataAccess, roomId) };
  },

  // --- WRITE pattern (established with `reply`; later writes follow this shape) ---
  reply: async (dataAccess, args) => {
    const actor = requireString(args, 'actor');
    const roomId = requireString(args, 'roomId');
    // TRIM DISCIPLINE (9.13-trim awareness carry): trim host-side and reject a whitespace-only
    // body BEFORE core, so the bridge never persists a blank post. core still enforces its own
    // invariants (the 256 KB BODY_TOO_LARGE cap, ROOM_NOT_FOUND) on the trimmed value.
    const rawBody = requireString(args, 'body');
    const body = rawBody.trim();
    if (body.length === 0) {
      throw new BridgeError(
        'BAD_REQUEST',
        'Reply body must not be empty or whitespace-only.',
      );
    }
    const room = await reply(dataAccess, actor, { roomId, body });
    return { room };
  },

  // react/unreact — the ReactionChip 👍 toggle (Story 10.4 consumer; named-deferred-to-consumer
  // in 10.2). The SAME core react/unreact an agent uses (Rule 13 — no fabricated op, no
  // backdoor; core gates the actor on room participation → NOT_A_MEMBER for a non-participant,
  // exactly as the web). Returns the message seq + its live reactors after, so the webview can
  // collapse any optimistic divergence to the authoritative set (mirrors the web's ReactResponse).
  react: async (dataAccess, args) => {
    const actor = requireString(args, 'actor');
    const messageSeq = requireNumber(args, 'messageSeq');
    const { messageSeq: seq, reactions } = await react(
      dataAccess,
      actor,
      messageSeq,
    );
    return { messageSeq: seq, reactions };
  },
  unreact: async (dataAccess, args) => {
    const actor = requireString(args, 'actor');
    const messageSeq = requireNumber(args, 'messageSeq');
    const { messageSeq: seq, reactions } = await unreact(
      dataAccess,
      actor,
      messageSeq,
    );
    return { messageSeq: seq, reactions };
  },
};

/**
 * Dispatch one webview request to its core op and return the response envelope. A thrown
 * BoardError (or host-surface guard) maps to `{ ok:false, error:{ code, message } }` — the
 * SAME closed-shape mapping the web host uses; an unknown op is a `BAD_REQUEST`; anything
 * unexpected is `INTERNAL_ERROR` (internals never leak past the seam).
 */
export async function dispatchRequest(
  dataAccess: DataAccess,
  request: BridgeRequest,
): Promise<BridgeResponse> {
  const handler = OPS[request.op];
  if (handler === undefined) {
    return {
      type: 'response',
      id: request.id,
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: `Unknown bridge op: "${request.op}".`,
      },
    };
  }
  try {
    const result = await handler(dataAccess, request.args ?? {});
    return { type: 'response', id: request.id, ok: true, result };
  } catch (err) {
    // A host-surface BridgeError carries its own code; a core BoardError carries the closed
    // agent-facing code. Both map to the same `{ code, message }` envelope (only origin differs).
    if (err instanceof BridgeError || err instanceof BoardError) {
      return {
        type: 'response',
        id: request.id,
        ok: false,
        error: { code: err.code, message: err.message },
      };
    }
    return {
      type: 'response',
      id: request.id,
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message:
          err instanceof Error ? err.message : 'Unexpected bridge error.',
      },
    };
  }
}

/** True iff `msg` is a well-formed webview→host request. */
function isBridgeRequest(msg: unknown): msg is BridgeRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as BridgeRequest).id === 'string' &&
    typeof (msg as BridgeRequest).op === 'string'
  );
}

/**
 * Create the live bridge over a {@link Messaging} channel + a {@link DataAccess} handle.
 *
 * - Wires webview→host requests through {@link dispatchRequest} and posts the response back.
 * - Starts a `MAX(seq)` delta poll: each tick reads `maxSeq()`; when it advances past the
 *   last-pushed seq, reads `eventsSince(lastSent)` and pushes a {@link BridgeDelta} to the
 *   webview, then advances the mark. Seeded to the live `maxSeq` on the first tick so the
 *   webview gets deltas from "now" forward (back-history is fetched via the read ops on demand
 *   — the same posture as the web SSE poller + `check`'s no-flood rule). The interval is
 *   `unref()`'d so it never keeps the host process alive on its own.
 *
 * @returns A {@link Bridge}; call `dispose()` on panel close / deactivate (mirrors the web SSE
 *   host's lifecycle discipline — clear the interval, detach the handler).
 */
export function createBridge(options: BridgeOptions): Bridge {
  const { dataAccess, messaging } = options;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const disposeHandler = messaging.onMessage((msg: unknown) => {
    if (!isBridgeRequest(msg)) return; // ignore non-request frames
    void dispatchRequest(dataAccess, msg).then((response) => {
      messaging.postMessage(response);
    });
  });

  // -1 = "not yet seeded": seed to the live maxSeq on the first tick so connecting does not
  // flood pre-existing back-history (mirrors the web SSE poller's lastSentSeq seeding).
  let lastSentSeq = -1;
  let polling = false;

  const timer: NodeJS.Timeout = setInterval(() => {
    if (polling) return;
    polling = true;
    void (async () => {
      try {
        const max = await dataAccess.maxSeq();
        if (lastSentSeq === -1) {
          lastSentSeq = max; // seed: stream from "now" forward
          return;
        }
        if (max <= lastSentSeq) return; // no advance → nothing to push
        const events = await dataAccess.eventsSince(lastSentSeq);
        if (events.length > 0) {
          // Advance to the LAST PUSHED event's seq, NOT the pre-read `max` snapshot (mirrors the
          // web SSE poller: sse.ts advances lastSentSeq to event.seq). An event can land BETWEEN
          // this tick's maxSeq() and eventsSince() reads, so the pushed batch may include a seq >
          // max; advancing to `max` would leave the mark BELOW that event and the next tick would
          // re-fetch + RE-PUSH it (a duplicate delta) — and the frame's own maxSeq would understate
          // the events it carries. Advancing to the batch's true high-water mark is exactly-once.
          const highWater = (events[events.length - 1] as { seq: number }).seq;
          messaging.postMessage({ type: 'delta', events, maxSeq: highWater });
          lastSentSeq = highWater;
        }
      } catch {
        // A transient read error must not kill the poller; the next tick retries (the operator's
        // live view degrades gracefully; agents are unaffected — they never touch this path).
      } finally {
        polling = false;
      }
    })();
  }, pollIntervalMs);
  // Do not keep the host alive solely for the poller.
  timer.unref?.();

  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      disposeHandler();
    },
  };
}
