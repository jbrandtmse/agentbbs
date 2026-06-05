// The WEBVIEW-side bridge client + RoomViewModel builder (Story 10.4, AC2).
//
// THE VS CODE WEBVIEW ANALOGUE of apps/web/src/api-client.ts (`loadRoomViewModel`/
// `buildRoomViewModel`): the web client reads the room over the HTTP JSON API; the webview reads
// it over the host↔webview postMessage BRIDGE (src/bridge.ts). It issues a typed request
// `{ id, op, args }` to the host and correlates the `{ id, ok, result|error }` response by id; the
// host invokes the SAME core op an agent would (Rule 13 — no fabricated op, no backdoor). The
// model BUILD (`buildRoomViewModel`) mirrors the web's exactly, fed by the bridge's
// `readRoom` + `readContract` results instead of HTTP envelopes — REUSING ui-shared's
// `RoomViewModel`/`MessagePostModel` shapes (do NOT reinvent).
//
// PRESENTATION/CLIENT-LAYER (NFR2 / Rule 13): no @agentbbs/core / @agentbbs/data-access import.
// The transport is injectable (a `Bridge` interface) so the dispatch/build logic is unit-testable
// in plain Node with a fake bridge — exactly the discipline src/bridge.test.ts uses host-side.

import type {
  ConnectionStatus,
  MessagePostModel,
  OperatorPosture,
  RoomViewModel,
} from '@agentbbs/ui-shared';

/** A room's metadata as the bridge `readRoom` op returns it (camelCase — the core `Room` shape). */
export interface BridgeRoom {
  roomId: string;
  projectId: string;
  subject: string;
  body: string;
  postedBy: string;
  seq: number;
  active: boolean;
  activatedBy?: string;
  activatedAtSeq?: number;
}

/** A room message as the bridge `readRoom`/`readContract` ops return it (core `RoomMessage`). */
export interface BridgeMessage {
  seq: number;
  actor: string;
  body: string;
  kind: 'announcement' | 'reply';
  reactions: string[];
}

/** The `readRoom` result envelope (mirrors the host bridge `readRoom` op return). */
export interface ReadRoomResult {
  room: BridgeRoom;
  messages: BridgeMessage[];
  participants: string[];
}

/** The `readContract` result envelope — the converged message (FR21) or `null`. */
export interface ReadContractResult {
  roomId: string;
  contract: BridgeMessage | null;
}

/** The `react`/`unreact` result envelope — the message seq + its live reactors after. */
export interface ReactResult {
  messageSeq: number;
  reactions: string[];
}

/** A typed error carrying the host's uniform `{ code, message }` envelope (mirrors web's ApiError). */
export class BridgeClientError extends Error {
  constructor(
    /** The host/core error code (`ROOM_NOT_FOUND`, `NOT_A_MEMBER`, `BAD_REQUEST`, …). */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeClientError';
  }
}

/**
 * The injectable transport seam: a single `request(op, args)` that resolves with the op's result
 * or rejects with a {@link BridgeClientError}. A real implementation correlates host responses by
 * id over the VS Code webview messaging channel ({@link createPostMessageBridge}); a test supplies
 * a fake. The model logic depends ONLY on this — never on the DOM or `acquireVsCodeApi`.
 */
export interface Bridge {
  request<T = unknown>(op: string, args?: Record<string, unknown>): Promise<T>;
}

/**
 * Build the prop-driven {@link RoomViewModel} from the bridge `readRoom` result + the resolved
 * operator handle + the room CONTRACT (FR21 agreed seq). MIRRORS the web's `buildRoomViewModel`
 * exactly: the operator POSTURE is `peer` when the operator handle is a room participant, else
 * `watching`; the message order key stays `seq`; `agreedSeq` is the contract's seq (or `null`).
 *
 * @param room The `readRoom` result from the bridge.
 * @param operatorHandle The resolved operator handle, or `null` (watching-only).
 * @param contract The `readContract` result, or `null` (no contract read yet).
 */
export function buildRoomViewModel(
  room: ReadRoomResult,
  operatorHandle: string | null,
  contract: ReadContractResult | null = null,
): RoomViewModel {
  const isPeer =
    operatorHandle !== null && room.participants.includes(operatorHandle);
  const messages: MessagePostModel[] = room.messages.map((m) => ({
    seq: m.seq,
    actor: m.actor,
    body: m.body,
    kind: m.kind,
    reactions: m.reactions,
  }));
  const posture: OperatorPosture =
    isPeer && operatorHandle !== null
      ? { kind: 'peer', handle: operatorHandle }
      : { kind: 'watching' };
  return {
    roomId: room.room.roomId,
    projectId: room.room.projectId,
    subject: room.room.subject,
    participants: room.participants,
    messages,
    operatorPosture: posture,
    // The CONVERGED message seq (the ✓ agreed mark target) — the contract's seq, or null.
    // COMPUTED from readContract, never stored (FR21); re-read after each 👍/reply so the mark
    // MOVES/DISAPPEARS.
    agreedSeq: contract?.contract != null ? contract.contract.seq : null,
    operatorHandle,
  };
}

/**
 * Load + build a room's {@link RoomViewModel} in one call over the bridge: request `readRoom`
 * + `readContract`, then compute the model (posture + agreed seq). The single seam the webview
 * `main.tsx` calls on mount — and re-calls after a reply/👍 toggle to re-derive the live state
 * (the same role `loadRoomViewModel` plays in apps/web).
 *
 * @param bridge The transport seam.
 * @param roomId The room to load.
 * @param operatorHandle The resolved operator handle, or `null` (watching-only).
 */
export async function loadRoomViewModel(
  bridge: Bridge,
  roomId: string,
  operatorHandle: string | null,
): Promise<RoomViewModel> {
  const [room, contract] = await Promise.all([
    bridge.request<ReadRoomResult>('readRoom', { roomId }),
    bridge.request<ReadContractResult>('readContract', { roomId }),
  ]);
  return buildRoomViewModel(room, operatorHandle, contract);
}

// =============================================================================
// The real VS Code webview transport — correlates host responses by id over the
// `acquireVsCodeApi().postMessage` channel. Browser context only (the webview bundle).
// =============================================================================

/** The minimal `acquireVsCodeApi()` shape the webview uses (postMessage to the host). */
export interface VsCodeWebviewApi {
  postMessage(message: unknown): void;
}

/** A host→webview frame as the bridge posts it (response / delta / themeKind). */
interface HostFrame {
  type?: string;
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/** Optional host→webview frame hooks for {@link createPostMessageBridge} (Story 10.6). */
export interface PostMessageBridgeHooks {
  /**
   * Called with each DELTA frame's `{ events, maxSeq }` (the host MAX(seq) poll, Story 10.2/10.4).
   * Story 10.6 wires this to the live RoomView fold. The events are RAW CORE Events (camelCase).
   */
  onDelta?: (delta: { events: unknown[]; maxSeq: number }) => void;
  /**
   * Story 10.6 (AC2) — called with each THEME-KIND frame's token when the operator switches color
   * theme (`vscode.window.onDidChangeActiveColorTheme` → host `postThemeKind`). The webview re-applies
   * its `data-theme-kind` attribute so the HC overrides flip live.
   */
  onThemeKind?: (kind: string) => void;
  /**
   * Story 10.6 (AC3) — called with the live host→webview channel status for the ConnectionFooter LED.
   * Starts `reconnecting` (no frame received yet), flips to `connected` on the FIRST frame of any kind
   * (a delta tick or a response proves the channel is live). The VS Code postMessage channel does not
   * "drop" like an EventSource while the panel is alive, so this is a calm liveness signal, never an alarm.
   */
  onStatus?: (status: ConnectionStatus) => void;
}

/**
 * Create a {@link Bridge} over the real VS Code webview messaging channel. Each `request` mints a
 * correlation id, posts `{ id, op, args }` to the host, and resolves/rejects when the matching
 * `{ type:'response', id, ok, result|error }` arrives. A `window` `message` listener routes frames
 * by type/id: `response` → the pending waiter; `delta` → {@link PostMessageBridgeHooks.onDelta};
 * `themeKind` → {@link PostMessageBridgeHooks.onThemeKind}. The FIRST frame of any kind flips
 * {@link PostMessageBridgeHooks.onStatus} to `connected`. Returns the bridge + a `dispose()`.
 *
 * @param api The `acquireVsCodeApi()` handle (the webview's host channel).
 * @param hooks Optional frame hooks (the live fold / theme switch / connection LED — Story 10.6).
 */
export function createPostMessageBridge(
  api: VsCodeWebviewApi,
  hooks: PostMessageBridgeHooks = {},
): Bridge & { dispose(): void } {
  const { onDelta, onThemeKind, onStatus } = hooks;
  let counter = 0;
  let sawFrame = false;
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  function markConnected(): void {
    if (sawFrame) return;
    sawFrame = true;
    onStatus?.('connected');
  }

  function handleMessage(event: MessageEvent): void {
    const frame = event.data as HostFrame;
    if (frame === null || typeof frame !== 'object') return;
    // Any well-formed host frame proves the channel is live (the calm connection LED, AC3).
    markConnected();
    if (frame.type === 'delta') {
      const d = frame as unknown as { events: unknown[]; maxSeq: number };
      onDelta?.({ events: d.events ?? [], maxSeq: d.maxSeq ?? 0 });
      return;
    }
    if (frame.type === 'themeKind') {
      const t = frame as unknown as { kind?: string };
      if (typeof t.kind === 'string') onThemeKind?.(t.kind);
      return;
    }
    if (frame.type !== 'response' || typeof frame.id !== 'string') return;
    const waiter = pending.get(frame.id);
    if (waiter === undefined) return;
    pending.delete(frame.id);
    if (frame.ok === true) {
      waiter.resolve(frame.result);
    } else {
      const code = frame.error?.code ?? 'INTERNAL_ERROR';
      const message = frame.error?.message ?? 'Bridge request failed.';
      waiter.reject(new BridgeClientError(code, message));
    }
  }

  window.addEventListener('message', handleMessage);

  return {
    request<T = unknown>(
      op: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      counter += 1;
      const id = `wv-${String(counter)}`;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        api.postMessage({ id, op, args });
      });
    },
    dispose(): void {
      window.removeEventListener('message', handleMessage);
      pending.clear();
    },
  };
}
