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
// NOTE: the `＋ join a project…` row exists + is clickable; the JOIN FLOW itself is Story
// 9.7 — for 9.4 the click handler is a documented no-op stub (logs intent).

import { useEffect, useState } from 'react';
import { NavTree, RoomView } from '@agentbbs/ui-shared';

import {
  foldTreeDelta,
  loadRoomViewModel,
  loadTreeModel,
  openEventStream,
  postReact,
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
    // Story 9.7 owns the join flow; for 9.4 this is a documented hand-off stub.
    console.info('join a project… (wiring lands in Story 9.7)');
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
          <RoomView room={room} onToggleReaction={handleToggleReaction} />
        )}
      </main>
    </div>
  );
}
