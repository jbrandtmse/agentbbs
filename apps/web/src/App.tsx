// The web control-room shell (Story 9.3 → 9.4).
//
// Story 9.4 replaces the minimal 9.3 project list with the real sidebar NavTree
// (@agentbbs/ui-shared): a global-read tree of EVERY project/room (FR28), live
// unread/activity decorations folded from SSE, and the explicit-escalation-only NEEDS YOU
// queue. On mount it:
//   1. builds the NavTreeModel from the host JSON API (operator handle, NEEDS YOU set,
//      directory, per-project rooms/announcements) — `loadTreeModel`;
//   2. opens the SSE channel and folds each delta into the tree model IMMUTABLY
//      (`foldTreeDelta`) so unread/activity decorations + live escalations update in
//      near-real-time (host → operator browser; NFR5 — never an agent push).
// Selecting a room clears its unread (basic for 9.4 — the rich tab-focus clear is 9.8/9.9).
//
// It imports @agentbbs/ui-shared (the shared React core) + the tokens.css design-token core
// (in main.tsx). It NEVER imports @agentbbs/core / @agentbbs/data-access and never speaks
// MCP or SQL (NFR2) — only the JSON API + SSE.
//
// Story 9.7 adds the join-gate Composer (the room main-column composer seam): the operator
// joins + posts as a peer over the SAME core ops agents use (joinBoard → reply), flipping the
// posture `you: watching` → `you: @operator (peer)` on real participation. The sidebar
// `＋ join a project…` row stays a documented hand-off (a board-picker affordance, distinct
// from the in-room composer — see handleJoinProject).

import { useEffect, useState } from 'react';
import { Composer, NavTree, RoomView } from '@agentbbs/ui-shared';

import {
  foldTreeDelta,
  loadRoomViewModel,
  loadTreeModel,
  openEventStream,
  postJoin,
  postReact,
  postReply,
  postUnreact,
  selectRoom,
} from './api-client.js';

import type { NavTreeModel, RoomViewModel } from '@agentbbs/ui-shared';
import type { CSSProperties } from 'react';

const shellStyle: CSSProperties = {
  display: 'flex',
  color: 'var(--text-body)',
  background: 'var(--surface-base)',
  fontFamily: 'var(--message-body-font)',
  minHeight: '100vh',
};

const mainStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
};

/** The web control-room shell — sidebar NavTree + the room thread main column (Story 9.5). */
export function App() {
  const [model, setModel] = useState<NavTreeModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The currently-open room's view model (Story 9.5 — a SINGLE open room; multi-tab is 9.8),
  // or null when no room is selected. Loaded on selection from the host JSON API.
  const [room, setRoom] = useState<RoomViewModel | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  // Whether a composer write (join or send) is in flight — disables the composer controls so
  // the operator does not double-submit (a basic disabled state; the rich optimistic echo +
  // failure-retry is Story 9.9).
  const [composerPending, setComposerPending] = useState(false);
  // Whether the operator has clicked `[ join room to post ]` for the open room (local intent).
  // Design reconciliation (Story 9.7): the board has no standalone "join room" op — clicking
  // join grants SUB-BOARD membership (joinBoard) and REVEALS the composer field; the FIRST send
  // (reply) is the grant-on-act that makes the operator a true ROOM PARTICIPANT (posture → peer).
  // So the composer shows its joined (field + send) state when the operator is ALREADY a peer OR
  // has just clicked join. Reset whenever a different room is opened.
  const [joinedIntent, setJoinedIntent] = useState(false);

  // Build the tree model once on mount (real ledger data over the JSON API).
  useEffect(() => {
    let cancelled = false;
    loadTreeModel()
      .then((built) => {
        if (!cancelled) setModel(built);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load the board.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Open the SSE live view; fold each delta into the tree model (live decorations).
  useEffect(() => {
    const close = openEventStream((event) => {
      setModel((prev) => (prev === null ? prev : foldTreeDelta(prev, event)));
    });
    return close;
  }, []);

  function handleSelectRoom(roomId: string): void {
    setModel((prev) => (prev === null ? prev : selectRoom(prev, roomId)));
    // Open the room as a thread (Story 9.5 — a single open room). Load its view model
    // (room + messages + participants + the operator posture) from the host JSON API.
    setRoom(null);
    setRoomError(null);
    // A fresh room starts at its true participation state — clear any prior join intent.
    setJoinedIntent(false);
    loadRoomViewModel(roomId)
      .then((built) => {
        setRoom(built);
      })
      .catch((err: unknown) => {
        setRoomError(
          err instanceof Error ? err.message : 'Failed to open the room.',
        );
      });
  }

  function handleJoinProject(): void {
    // DISPOSITION (Story 9.7): the room-level join-to-post (the join-gate Composer below) is
    // this story's focus — the operator joins + posts as a peer from INSIDE an open room. The
    // sidebar `＋ join a project…` action (a board-wide discovery affordance, distinct from the
    // room composer) remains a documented hand-off: it would `postJoin(projectId)` for a chosen
    // board, but that board-picker UX is out of 9.7's scope (the composer's onJoin already wires
    // joinBoard for the open room's sub-board). Left as a logged stub.
    console.info(
      'join a project… (sidebar board-picker is a later affordance)',
    );
  }

  // Story 9.6 — toggle a 👍 on a post. Decide react-vs-unreact from the operator's CURRENT
  // live state on that post (operator ∈ reactions, computed from /api/me), fire the write,
  // then RE-LOAD the room view model so the live count, the operator's chip state, AND the
  // agreed-mark POSITION re-derive (a basic refetch/fold — the rich optimistic echo +
  // reconciliation is Story 9.9). The agreed mark is COMPUTED from the re-fetched contract,
  // never stored (FR21): it MOVES when a higher-seq message gains the contract and
  // DISAPPEARS when all live 👍s retract.
  function handleToggleReaction(seq: number): void {
    if (room === null) return;
    const roomId = room.roomId;
    const operator = room.operatorHandle ?? null;
    const post = room.messages.find((m) => m.seq === seq);
    const alreadyReacted =
      operator !== null && post !== undefined
        ? post.reactions.includes(operator)
        : false;
    const write = alreadyReacted ? postUnreact : postReact;
    write(roomId, seq)
      .then(() => loadRoomViewModel(roomId))
      .then((rebuilt) => {
        // Only apply if the operator is still on the same room (guards a fast room switch).
        setRoom((prev) =>
          prev !== null && prev.roomId === roomId ? rebuilt : prev,
        );
      })
      .catch((err: unknown) => {
        // A 403 (NOT_A_MEMBER / NO_OPERATOR) or transient failure — surface a calm error.
        // The chip's canReact gate prevents the common non-participant doomed write; this
        // catches the race/edge. Story 9.10 enriches the error voice.
        setRoomError(
          err instanceof Error ? err.message : 'Could not update the reaction.',
        );
      });
  }

  // Story 9.7 — `[ join room to post ]`: join the SUB-BOARD (membership) so the operator can
  // post. Per the Design reconciliation (the board has no standalone "join room" op), room
  // PARTICIPATION is established by the first SEND (reply, grant-on-act) — joinBoard here is
  // the immediate membership + the `✓ you joined` step. After joining, refetch the room so the
  // composer reveals the field; the posture flips to peer once the operator SENDS.
  function handleJoinRoom(): void {
    if (room === null) return;
    const roomId = room.roomId;
    const projectId = room.projectId;
    // Reveal the composer field immediately (the join-then-post flow): the operator can now
    // type their first post, whose SEND (reply) grants room participation. joinBoard runs in
    // the background to grant sub-board membership.
    setJoinedIntent(true);
    setComposerPending(true);
    postJoin(projectId)
      .then(() => loadRoomViewModel(roomId))
      .then((rebuilt) => {
        setRoom((prev) =>
          prev !== null && prev.roomId === roomId ? rebuilt : prev,
        );
      })
      .catch((err: unknown) => {
        // Join failed — drop back to the gate (no half-joined state, per EXPERIENCE.md).
        setJoinedIntent(false);
        setRoomError(
          err instanceof Error ? err.message : 'Could not join the room.',
        );
      })
      .finally(() => setComposerPending(false));
  }

  // Story 9.7 — SEND a message as a peer over the SAME core `reply` agents use (no operator
  // backdoor). Grant-on-act makes the operator a ROOM PARTICIPANT, so after the refetch the
  // posture flips `you: watching` → `you: @operator (peer)` and the 👍/add_participant
  // affordances enable. Basic refetch (optimistic echo is Story 9.9).
  function handleSendMessage(body: string): void {
    if (room === null) return;
    const roomId = room.roomId;
    setComposerPending(true);
    postReply(roomId, body)
      .then(() => loadRoomViewModel(roomId))
      .then((rebuilt) => {
        setRoom((prev) =>
          prev !== null && prev.roomId === roomId ? rebuilt : prev,
        );
      })
      .catch((err: unknown) => {
        // 413 BODY_TOO_LARGE / 403 NO_OPERATOR / transient — surface a calm error (9.10 voice).
        setRoomError(
          err instanceof Error ? err.message : 'Could not post the message.',
        );
      })
      .finally(() => setComposerPending(false));
  }

  return (
    <div style={shellStyle} data-testid="web-shell">
      {model !== null && (
        <NavTree
          model={model}
          onSelectRoom={handleSelectRoom}
          onJoinProject={handleJoinProject}
        />
      )}
      <main style={mainStyle} data-testid="main-pane">
        {error !== null && <p data-testid="error">Error: {error}</p>}
        {model === null && error === null && <p>Loading the board…</p>}
        {model !== null && model.activeRoomId === null && (
          <p data-testid="no-room">Select a room from the sidebar.</p>
        )}
        {model !== null &&
          model.activeRoomId !== null &&
          roomError !== null && (
            <p data-testid="room-error">Error: {roomError}</p>
          )}
        {model !== null &&
          model.activeRoomId !== null &&
          room === null &&
          roomError === null && <p data-testid="room-loading">Opening room…</p>}
        {room !== null && (
          <RoomView
            room={room}
            onToggleReaction={handleToggleReaction}
            composerSlot={
              <Composer
                // The composer shows its JOINED (field + send) state when the operator is a true
                // ROOM PARTICIPANT (posture `peer`) OR has just clicked `[ join room to post ]`
                // (local intent) — the join-then-post flow (Story 9.7 reconciliation: clicking
                // join reveals the field so the operator can type their first post; that SEND is
                // the grant-on-act that establishes participation). A watching operator who has
                // not clicked join sees the `[ join room to post ]` gate.
                joined={room.operatorPosture.kind === 'peer' || joinedIntent}
                pending={composerPending}
                onJoin={handleJoinRoom}
                onSend={handleSendMessage}
              />
            }
          />
        )}
      </main>
    </div>
  );
}
