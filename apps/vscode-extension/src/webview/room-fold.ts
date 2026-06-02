// The webview LIVE-FOLD reducer + optimistic-echo helpers (Story 10.6, AC1).
//
// THE VS CODE WEBVIEW ANALOGUE of apps/web/src/api-client.ts's `foldRoomDelta` / `deriveAgreedSeq`
// / `makePendingPost` / `appendPendingPost` / `markPendingPostFailed` / `removePendingPost` (Story
// 9.9). The web folds SSE `EventWire` frames (snake_case payloads from the HTTP host); the webview
// folds the host bridge's MAX(seq) DELTA frames, which carry RAW CORE `Event` objects — CAMELCASE
// (`payload.roomId`, `payload.messageSeq`, `payload.body`; top-level `actor`/`seq`/`type`/
// `createdAt`) because the VS Code host pushes `dataAccess.eventsSince(lastSent)` directly (the
// node:sqlite adapter's `rowToEvent` returns the camelCase core Event — NO snake_case wire stage,
// unlike the web SSE host). So this is a PARALLEL reducer with the SAME SEMANTICS keyed on camelCase
// — NOT a verbatim reuse of the web's snake_case `foldRoomDelta` (Rule 13: the fold is CLIENT-layer;
// we mirror the proven web semantics, we do not fork core).
//
// SEMANTICS (identical to web 9.9, mutation-tested non-vacuous in room-fold.test.ts, Rule 7):
//   - `room.replied` / `announcement.posted` for THIS room → APPEND the post in seq order.
//     IDEMPOTENT by seq (an already-present confirmed seq is dropped — a redelivered/re-polled
//     delta never double-appends). DE-DUP vs. the operator's OPTIMISTIC echo (same actor + body)
//     → REPLACE the pending echo with the confirmed post (reconcile), never a duplicate.
//   - `message.reacted` / `message.unreacted` → ADD/REMOVE the event's `actor` from the target
//     message's live reactors, then RE-DERIVE the agreed mark (FR21 — highest-seq live-👍'd).
//   - A delta for a DIFFERENT room (or any other type) returns the model UNCHANGED.
//
// PRESENTATION/CLIENT-LAYER (NFR2 / Rule 13): no @agentbbs/core / @agentbbs/data-access import — the
// reducer is a pure function over a plain camelCase event shape, unit-testable in plain Node.
//
// NFR5 (pull-only, LOAD-BEARING): these reducers fold deltas the HOST pushes to ITS-OWN webview (the
// operator's live editor view). There is NO agent push surface here — agents stay strictly pull-only
// via `check`; nothing in this module touches an agent/MCP path.

import type { MessagePostModel, RoomViewModel } from '@agentbbs/ui-shared';

/**
 * The CAMELCASE shape of one core {@link Event} as the host bridge delta carries it (a structural
 * subset of `@agentbbs/core`'s `Event` — only the fields the fold reads; declared locally so this
 * module needs no core import, NFR2). The bridge pushes `events: unknown[]`; {@link foldRoomDelta}
 * narrows each entry to this shape defensively (a malformed frame is ignored, never throws).
 */
export interface DeltaEvent {
  /** The event's authoritative seq (its identity + the thread order key). */
  seq: number;
  /** The event type (`room.replied`, `message.reacted`, …). */
  type: string;
  /** The acting handle (lowercased canonical). */
  actor: string;
  /** ISO-8601 UTC display timestamp (NEVER an ordering input). */
  createdAt?: string;
  /** The camelCase payload (`roomId`, `messageSeq`, `body`, …). */
  payload?: Record<string, unknown>;
}

/** Narrow an `unknown` delta entry to a {@link DeltaEvent} (defensive — a bad frame folds to a no-op). */
function asDeltaEvent(raw: unknown): DeltaEvent | null {
  if (raw === null || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e['seq'] !== 'number') return null;
  if (typeof e['type'] !== 'string') return null;
  if (typeof e['actor'] !== 'string') return null;
  return {
    seq: e['seq'],
    type: e['type'],
    actor: e['actor'],
    createdAt: typeof e['createdAt'] === 'string' ? e['createdAt'] : undefined,
    payload:
      typeof e['payload'] === 'object' && e['payload'] !== null
        ? (e['payload'] as Record<string, unknown>)
        : {},
  };
}

/** The room id a delta event concerns (its fold target), or undefined. */
function eventRoomId(event: DeltaEvent): string | undefined {
  const roomId = event.payload?.['roomId'];
  return typeof roomId === 'string' ? roomId : undefined;
}

/**
 * Derive the CONTRACT seq — the highest-`seq` message currently holding a live 👍 (FR21) — from a
 * model's messages (mirrors web `deriveAgreedSeq`). The per-post `reactions` array IS the net
 * live-reactor set, so the converged message is the highest-`seq` post with a non-empty `reactions`.
 * `null` when no message holds a live 👍. OPTIMISTIC echoes (pending/failed) never qualify.
 */
export function deriveAgreedSeq(messages: MessagePostModel[]): number | null {
  let agreed: number | null = null;
  for (const m of messages) {
    if (m.pending === true || m.failed === true) continue;
    if (m.reactions.length > 0 && (agreed === null || m.seq > agreed)) {
      agreed = m.seq;
    }
  }
  return agreed;
}

/**
 * Fold ONE host-bridge delta event into the OPEN room's {@link RoomViewModel} IMMUTABLY (a NEW
 * model; the prior model + its arrays are untouched). Mirrors web 9.9 `foldRoomDelta` keyed on
 * CAMELCASE core-event fields. Returns the SAME reference on a no-op (a delta for another room, an
 * already-present seq, or an unhandled type) so a caller can cheaply skip unchanged tabs. Never throws.
 *
 * @param model The current OPEN room model.
 * @param raw One delta entry (a raw camelCase core Event, narrowed defensively).
 * @returns A NEW model with the delta folded, or the same reference on a no-op.
 */
export function foldRoomDelta(
  model: RoomViewModel,
  raw: unknown,
): RoomViewModel {
  const event = asDeltaEvent(raw);
  if (event === null) return model;

  // A delta scoped to a DIFFERENT room is a no-op for this model (the payload may omit roomId for
  // a non-room event, e.g. identity.* — those are not folded into a room thread either).
  const roomId = eventRoomId(event);
  if (roomId !== undefined && roomId !== model.roomId) return model;

  if (event.type === 'room.replied' || event.type === 'announcement.posted') {
    return foldReplied(model, event);
  }
  if (event.type === 'message.reacted' || event.type === 'message.unreacted') {
    return foldReaction(model, event);
  }
  return model;
}

/** Fold a `room.replied`/`announcement.posted` delta: idempotent append + optimistic-echo reconcile. */
function foldReplied(model: RoomViewModel, event: DeltaEvent): RoomViewModel {
  // Idempotent by seq: the confirmed message is already present (a re-read landed it first, or a
  // re-polled/redelivered delta) → no double-append. (A pending echo shares no real seq with it.)
  if (model.messages.some((m) => m.seq === event.seq && m.pending !== true)) {
    return model;
  }
  const body =
    typeof event.payload?.['body'] === 'string'
      ? (event.payload['body'] as string)
      : '';
  // An announcement.posted is the seeding post (kind 'announcement'); a room.replied is a reply.
  const kind = event.type === 'announcement.posted' ? 'announcement' : 'reply';
  const confirmed: MessagePostModel = {
    seq: event.seq,
    actor: event.actor,
    body,
    kind,
    reactions: [],
    createdAt: event.createdAt,
  };

  // De-dup vs. THIS operator's optimistic echo: a pending/failed echo with the same actor + body is
  // the same post arriving over the delta poll → REPLACE it (reconcile) instead of appending a dup.
  const echoIndex = model.messages.findIndex(
    (m) =>
      (m.pending === true || m.failed === true) &&
      m.actor === event.actor &&
      m.body === body,
  );
  if (echoIndex !== -1) {
    const messages = model.messages.map((m, i) =>
      i === echoIndex ? confirmed : m,
    );
    return { ...model, messages };
  }

  return { ...model, messages: [...model.messages, confirmed] };
}

/** Fold a `message.reacted`/`message.unreacted` delta: add/remove the actor + re-derive agreed (FR21). */
function foldReaction(model: RoomViewModel, event: DeltaEvent): RoomViewModel {
  const targetSeq = event.payload?.['messageSeq'];
  if (typeof targetSeq !== 'number') return model;
  const add = event.type === 'message.reacted';
  let changed = false;
  const messages = model.messages.map((m) => {
    if (m.seq !== targetSeq) return m;
    const has = m.reactions.includes(event.actor);
    if (add && !has) {
      changed = true;
      return { ...m, reactions: [...m.reactions, event.actor] };
    }
    if (!add && has) {
      changed = true;
      return { ...m, reactions: m.reactions.filter((r) => r !== event.actor) };
    }
    return m;
  });
  if (!changed) return model;
  return { ...model, messages, agreedSeq: deriveAgreedSeq(messages) };
}

// =============================================================================
// Optimistic echo + reconciliation (Story 10.6, AC1) — mirrors web 9.9. The operator's reply shows
// PENDING immediately, then reconciles when its real seq lands (in a re-read OR a folded delta).
// =============================================================================

/**
 * The base `seq` for a PENDING optimistic echo (mirrors web `PENDING_SEQ_BASE`). A pending post gets
 * a synthetic seq at/above this base so it sorts to the BOTTOM of the seq-ordered thread (after every
 * real ledger message) until it reconciles. Well above any plausible real `seq`, inside MAX_SAFE_INTEGER.
 */
export const PENDING_SEQ_BASE = 1e15;

/** Monotonic counter so concurrent pending echoes get distinct (ordered) synthetic seqs. */
let pendingSeqCounter = 0;

/** Mint a unique client-side token correlating a pending echo to its confirmation / retry. Opaque. */
export function newClientToken(): string {
  pendingSeqCounter += 1;
  return `pending-${String(Date.now())}-${String(pendingSeqCounter)}`;
}

/**
 * Build a PENDING optimistic echo post for the operator's just-sent `body` (mirrors web
 * `makePendingPost`). Dimmed "sending…" in the thread; a synthetic seq (≥ {@link PENDING_SEQ_BASE})
 * sorts it last; the `clientToken` correlates it to its confirmation / retry.
 */
export function makePendingPost(
  actor: string,
  body: string,
  clientToken: string,
): MessagePostModel {
  pendingSeqCounter += 1;
  return {
    seq: PENDING_SEQ_BASE + pendingSeqCounter,
    actor,
    body,
    kind: 'reply',
    reactions: [],
    pending: true,
    clientToken,
  };
}

/** Append a PENDING echo to a room model IMMUTABLY (a NEW model; mirrors web `appendPendingPost`). */
export function appendPendingPost(
  model: RoomViewModel,
  post: MessagePostModel,
): RoomViewModel {
  return { ...model, messages: [...model.messages, post] };
}

/**
 * Mark a pending echo (by `clientToken`) as FAILED IMMUTABLY (mirrors web `markPendingPostFailed`).
 * The body is PRESERVED (retry re-sends it); `pending → failed`. A no-op if the token is gone.
 */
export function markPendingPostFailed(
  model: RoomViewModel,
  clientToken: string,
): RoomViewModel {
  let changed = false;
  const messages = model.messages.map((m) => {
    if (m.clientToken !== clientToken) return m;
    changed = true;
    return { ...m, pending: false, failed: true };
  });
  return changed ? { ...model, messages } : model;
}

/**
 * Remove a pending/failed echo (by `clientToken`) IMMUTABLY (mirrors web `removePendingPost`). Used
 * on reconciliation when the confirmed message is already present (via a re-read), so the echo is
 * dropped → NO DUPLICATE. A no-op if the token is gone.
 */
export function removePendingPost(
  model: RoomViewModel,
  clientToken: string,
): RoomViewModel {
  const messages = model.messages.filter((m) => m.clientToken !== clientToken);
  return messages.length === model.messages.length
    ? model
    : { ...model, messages };
}

/**
 * Reconcile a re-read AUTHORITATIVE model with any still-in-flight optimistic echoes (mirrors the
 * web shell's reconcile in `sendReplyAndReconcile`): the re-read carries the confirmed post at its
 * real seq + the flipped posture; carry over any OTHER pending/failed echoes (concurrent sends) EXCEPT
 * the one identified by `reconciledToken` (which the re-read already contains → drop it, no duplicate),
 * then re-derive the agreed mark. Returns the authoritative model with the surviving echoes appended.
 *
 * @param authoritative The freshly re-read room model (has the confirmed post + posture).
 * @param priorMessages The messages of the model BEFORE the re-read (source of in-flight echoes).
 * @param reconciledToken The echo token this reconcile resolves (dropped — the re-read has it).
 */
export function reconcileReread(
  authoritative: RoomViewModel,
  priorMessages: MessagePostModel[],
  reconciledToken: string,
): RoomViewModel {
  const inflight = priorMessages.filter(
    (m) =>
      (m.pending === true || m.failed === true) &&
      m.clientToken !== reconciledToken,
  );
  const messages = [...authoritative.messages, ...inflight];
  return { ...authoritative, messages, agreedSeq: deriveAgreedSeq(messages) };
}
