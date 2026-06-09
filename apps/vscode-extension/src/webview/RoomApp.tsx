// RoomApp — the room webview's React component (Story 10.4 mount; Story 10.6 live fold + footer).
//
// Extracted from main.tsx so it can be DOM-tested in isolation (no `acquireVsCodeApi`, no
// module-load mount side effect). It mounts the byte-shared ui-shared RoomView + the join-gate
// Composer + the calm ConnectionFooter (Story 9.10), fed a RoomViewModel built over an injected
// {@link Bridge}, and wires every affordance to an EXISTING core op via the bridge (Rule 13 — no
// fabricated op, no backdoor):
//   - SEND → `reply` (grant-on-act; the first reply on a PROTO-ROOM is the Epic-4 min-seq
//     ACTIVATOR — AC4 reply-to-activate, the operator RESPOND-parity contract);
//   - `[ join room to post ]` → local intent (participation lands on the first SEND — there is no
//     standalone room-join op, the web's Design reconciliation);
//   - 👍 toggle → `react`/`unreact`.
//
// STORY 10.6 — LIVE FOLD (AC1): the webview CONSUMES the host bridge's MAX(seq) delta poll (the
// `onDelta` frames, wired-but-unconsumed per the 10.4 CR). New events FOLD into the live model via
// the PURE camelCase reducer (room-fold.ts, mirroring web 9.9): new messages append in seq order,
// reactions update, the agreed mark moves (FR21) — WITHOUT a full reload. The operator's reply
// echoes OPTIMISTICALLY (pending) then reconciles when its real seq lands (in the re-read OR a
// folded delta). NFR5 (pull-only) preserved: the delta is host→its-own-webview; agents keep `check`.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Composer, ConnectionFooter, RoomView } from '@agentbbs/ui-shared';

import type { Bridge, ReactResult } from './bridge-client.js';
import { loadRoomViewModel } from './bridge-client.js';
import {
  appendPendingPost,
  foldRoomDelta,
  makePendingPost,
  markPendingPostFailed,
  newClientToken,
  reconcileReread,
} from './room-fold.js';

import type { ConnectionStatus, RoomViewModel } from '@agentbbs/ui-shared';

export interface RoomAppProps {
  /** The host↔webview transport seam (the postMessage bridge, or a fake in a test). */
  bridge: Bridge;
  /** The room (active or proto-room) this panel renders. */
  roomId: string;
  /** The resolved operator handle, or `null` (watching-only). */
  operatorHandle: string | null;
  /**
   * Story 10.6 (AC1) — subscribe to the host's live DELTA frames. Called once on mount with a
   * handler the live fold feeds; returns a disposer. The handler receives each delta's RAW CORE
   * events (camelCase). Optional so a test can mount without the live channel (the mount + write
   * paths still work); production (main.tsx) wires it to the postMessage bridge's `onDelta`.
   */
  subscribeToDeltas?: (handler: (events: unknown[]) => void) => () => void;
  /**
   * Story 10.6 (AC3) — the live host→webview channel status for the calm ConnectionFooter LED.
   * Defaults to `connected` (a freshly-mounted panel whose bridge answered the initial load is, by
   * definition, connected). main.tsx drives it from the bridge's first-frame signal.
   */
  connectionStatus?: ConnectionStatus;
  /**
   * Story 10.6 (AC2) — whether the active VS Code theme is HIGH-CONTRAST (dark or light). Passed to
   * ui-shared's RoomView → MessageThread → MessagePost so the translucent agreed WASH renders as
   * `transparent` under HC (the solid `--agreed-line` rail carries the agreed meaning instead — the
   * `--vscode-*` token layer's HC overrides handle the borders/greens). main.tsx derives it LIVE from
   * the host's ColorThemeKind (re-applied on `onDidChangeActiveColorTheme`). Defaults to `false`.
   */
  highContrast?: boolean;
}

/** The room webview shell — loads the model over the bridge, folds live deltas, wires the writes. */
export function RoomApp({
  bridge,
  roomId,
  operatorHandle,
  subscribeToDeltas,
  connectionStatus = 'connected',
  highContrast = false,
}: RoomAppProps) {
  const [room, setRoom] = useState<RoomViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Local intent: the operator clicked `[ join room to post ]` but has not sent yet (grant-on-act
  // establishes participation on the first SEND, mirroring the web's joinedIntent).
  const [joinedIntent, setJoinedIntent] = useState(false);

  // A ref mirror of the current model so the mount-once delta subscription folds against the LATEST
  // model (not the value captured when the effect subscribed). The fold updates BOTH the ref and state.
  const roomRef = useRef<RoomViewModel | null>(null);
  roomRef.current = room;

  const reload = useCallback((): Promise<void> => {
    return loadRoomViewModel(bridge, roomId, operatorHandle)
      .then((vm) => {
        setRoom(vm);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : 'Failed to open the room.',
        );
      });
  }, [bridge, roomId, operatorHandle]);

  // Load the room on mount (over the bridge — the AC2 mount data path).
  useEffect(() => {
    void reload();
  }, [reload]);

  // Story 10.6 (AC1) — subscribe ONCE to the host's live delta frames and FOLD each event into the
  // live model (append new messages in seq order, update reactions, move the agreed mark — all via
  // the pure camelCase reducer). De-dup/idempotent by seq + optimistic-echo reconcile are inside
  // foldRoomDelta. The fold reads roomRef.current so it always applies to the latest model.
  useEffect(() => {
    if (subscribeToDeltas === undefined) return;
    const dispose = subscribeToDeltas((events: unknown[]) => {
      const current = roomRef.current;
      if (current === null) return; // not loaded yet — the initial read will carry these
      let next = current;
      for (const ev of events) {
        next = foldRoomDelta(next, ev);
      }
      if (next !== current) {
        roomRef.current = next;
        setRoom(next);
      }
    });
    return dispose;
  }, [subscribeToDeltas]);

  // The `[ join room to post ]` gate: there is no standalone room-join op (Design reconciliation);
  // participation is established by the first SEND. Clicking the gate flips local intent so the
  // composer reveals the field — the actual participation lands on send (grant-on-act).
  const handleJoin = useCallback(() => {
    setJoinedIntent(true);
  }, []);

  // SEND → core `reply` (grant-on-act). Story 10.6 — OPTIMISTIC echo + reconcile (mirrors web 9.9):
  //   1. ECHO the operator's message into the thread PENDING (dimmed "sending…") immediately.
  //   2. POST the reply; on SUCCESS RE-READ the model (grant-on-act flips posture to peer, lands the
  //      confirmed post at its real seq, activates a proto-room — the Epic-4 min-seq activator, AC4),
  //      then RECONCILE (drop THIS echo, keep other in-flight echoes — no duplicate).
  //   3. On FAILURE flip the echo to FAILED inline (the body is preserved for a retry).
  // No fabricated activate op — `reply` IS the activation.
  const handleSend = useCallback(
    (body: string) => {
      if (operatorHandle === null) {
        setError('watching-only — open the room as a handle to reply.');
        return;
      }
      const current = roomRef.current;
      if (current === null) return;
      const clientToken = newClientToken();
      const echo = makePendingPost(operatorHandle, body, clientToken);
      const withEcho = appendPendingPost(current, echo);
      roomRef.current = withEcho;
      setRoom(withEcho);
      setPending(true);

      const priorMessages = withEcho.messages;
      bridge
        .request('reply', { actor: operatorHandle, roomId, body })
        .then(() => loadRoomViewModel(bridge, roomId, operatorHandle))
        .then((rebuilt) => {
          // Reconcile the authoritative re-read with any OTHER still-in-flight echoes; drop THIS one.
          const reconciled = reconcileReread(
            rebuilt,
            priorMessages,
            clientToken,
          );
          roomRef.current = reconciled;
          setRoom(reconciled);
          setError(null);
        })
        .catch((err: unknown) => {
          // FAILURE: flip the echo to failed inline (draft preserved); calm, no modal.
          const base = roomRef.current;
          if (base !== null) {
            const failed = markPendingPostFailed(base, clientToken);
            roomRef.current = failed;
            setRoom(failed);
          }
          setError(
            err instanceof Error ? err.message : 'Could not post the reply.',
          );
        })
        .finally(() => setPending(false));
    },
    [bridge, roomId, operatorHandle],
  );

  // 👍 toggle → core `react`/`unreact` (the SAME ops an agent uses). Decide from the operator's
  // CURRENT live state, fire the write, then apply the AUTHORITATIVE reactors the write returns
  // (collapses any divergence) + re-derive the agreed mark via the fold. The live delta poll also
  // folds the resulting message.reacted/unreacted — idempotent (no double-apply).
  const handleToggleReaction = useCallback(
    (seq: number) => {
      const current = roomRef.current;
      if (current === null || operatorHandle === null) return;
      const post = current.messages.find((m) => m.seq === seq);
      if (post === undefined) return;
      const op = post.reactions.includes(operatorHandle) ? 'unreact' : 'react';
      bridge
        .request<ReactResult>(op, { actor: operatorHandle, messageSeq: seq })
        .then((result) => {
          // Apply the authoritative reactors from the write, then re-read so the agreed mark + chip
          // reflect the converged state (the re-read is the same discipline the 10.4 toggle used).
          void reload();
          return result;
        })
        .catch((err: unknown) => {
          setError(
            err instanceof Error
              ? err.message
              : 'Could not update the reaction.',
          );
        });
    },
    [bridge, operatorHandle, reload],
  );

  if (error !== null && room === null) {
    return (
      <p
        data-testid="room-error"
        style={{ color: 'var(--text-muted)', padding: 'var(--space-7)' }}
      >
        couldn’t open the room — {error}
      </p>
    );
  }
  if (room === null) {
    return (
      <p
        data-testid="room-loading"
        style={{ color: 'var(--text-dim)', padding: 'var(--space-7)' }}
      >
        opening room…
      </p>
    );
  }

  const joined = room.operatorPosture.kind === 'peer' || joinedIntent;

  // The room column over the calm connection footer (Story 9.10 — the ONLY liveness signal, NEVER a
  // modal). The footer reflects the host→webview channel health (AC3). A column flex so the footer
  // sits at the bottom and the RoomView fills the rest.
  return (
    <div
      data-testid="room-app"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <RoomView
          room={room}
          onToggleReaction={handleToggleReaction}
          highContrast={highContrast}
          composerSlot={
            <Composer
              joined={joined}
              pending={pending}
              onJoin={handleJoin}
              onSend={handleSend}
            />
          }
        />
      </div>
      <ConnectionFooter status={connectionStatus} />
    </div>
  );
}
