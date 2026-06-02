// RoomApp — the room webview's React component (Story 10.4, AC2/AC4).
//
// Extracted from main.tsx so it can be DOM-tested in isolation (no `acquireVsCodeApi`, no
// module-load mount side effect). It mounts the byte-shared ui-shared RoomView + the join-gate
// Composer, fed a RoomViewModel built over an injected {@link Bridge}, and wires every affordance
// to an EXISTING core op via the bridge (Rule 13 — no fabricated op, no backdoor):
//   - SEND → `reply` (grant-on-act; the first reply on a PROTO-ROOM is the Epic-4 min-seq
//     ACTIVATOR — AC4 reply-to-activate, the operator RESPOND-parity contract);
//   - `[ join room to post ]` → local intent (participation lands on the first SEND — there is no
//     standalone room-join op, the web's Design reconciliation);
//   - 👍 toggle → `react`/`unreact`.
// After a write the model is RE-READ over the bridge so the posture flips watching→peer, the
// proto-room shows active, and the agreed mark moves (the rich live fold is Story 10.6).

import { useCallback, useEffect, useState } from 'react';
import { Composer, RoomView } from '@agentbbs/ui-shared';

import type { Bridge, ReactResult } from './bridge-client.js';
import { loadRoomViewModel } from './bridge-client.js';

import type { RoomViewModel } from '@agentbbs/ui-shared';

export interface RoomAppProps {
  /** The host↔webview transport seam (the postMessage bridge, or a fake in a test). */
  bridge: Bridge;
  /** The room (active or proto-room) this panel renders. */
  roomId: string;
  /** The resolved operator handle, or `null` (watching-only). */
  operatorHandle: string | null;
}

/** The room webview shell — loads the model over the bridge, wires reply/react to core ops. */
export function RoomApp({ bridge, roomId, operatorHandle }: RoomAppProps) {
  const [room, setRoom] = useState<RoomViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Local intent: the operator clicked `[ join room to post ]` but has not sent yet (grant-on-act
  // establishes participation on the first SEND, mirroring the web's joinedIntent).
  const [joinedIntent, setJoinedIntent] = useState(false);

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

  // The `[ join room to post ]` gate: there is no standalone room-join op (Design reconciliation);
  // participation is established by the first SEND. Clicking the gate flips local intent so the
  // composer reveals the field — the actual participation lands on send (grant-on-act).
  const handleJoin = useCallback(() => {
    setJoinedIntent(true);
  }, []);

  // SEND → core `reply` (grant-on-act). For a PROTO-ROOM this first reply is the Epic-4 min-seq
  // ACTIVATOR (AC4): on success we RE-READ the model so the room shows active + the posture flips
  // peer + the composer stays open. No fabricated activate op — `reply` IS the activation.
  const handleSend = useCallback(
    (body: string) => {
      if (operatorHandle === null) {
        setError('watching-only — open the room as a handle to reply.');
        return;
      }
      setPending(true);
      bridge
        .request('reply', { actor: operatorHandle, roomId, body })
        .then(() => reload())
        .catch((err: unknown) => {
          setError(
            err instanceof Error ? err.message : 'Could not post the reply.',
          );
        })
        .finally(() => setPending(false));
    },
    [bridge, roomId, operatorHandle, reload],
  );

  // 👍 toggle → core `react`/`unreact` (the SAME ops an agent uses). Decide from the operator's
  // CURRENT live state, fire the write, then RE-READ so the chip + count + agreed mark reflect the
  // authoritative result (the rich optimistic echo is Story 10.6).
  const handleToggleReaction = useCallback(
    (seq: number) => {
      if (room === null || operatorHandle === null) return;
      const post = room.messages.find((m) => m.seq === seq);
      if (post === undefined) return;
      const op = post.reactions.includes(operatorHandle) ? 'unreact' : 'react';
      bridge
        .request<ReactResult>(op, { actor: operatorHandle, messageSeq: seq })
        .then(() => reload())
        .catch((err: unknown) => {
          setError(
            err instanceof Error
              ? err.message
              : 'Could not update the reaction.',
          );
        });
    },
    [bridge, room, operatorHandle, reload],
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

  return (
    <RoomView
      room={room}
      onToggleReaction={handleToggleReaction}
      composerSlot={
        <Composer
          joined={joined}
          pending={pending}
          onJoin={handleJoin}
          onSend={handleSend}
        />
      }
    />
  );
}
