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
import { NavTree } from '@agentbbs/ui-shared';

import {
  foldTreeDelta,
  loadTreeModel,
  openEventStream,
  selectRoom,
} from './api-client.js';

import type { NavTreeModel } from '@agentbbs/ui-shared';
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
  padding: '1rem',
};

/** The web control-room shell — sidebar NavTree + a main pane (room thread is Story 9.5). */
export function App() {
  const [model, setModel] = useState<NavTreeModel | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }

  function handleJoinProject(): void {
    // Story 9.7 owns the join flow; for 9.4 this is a documented hand-off stub.
    console.info('join a project… (wiring lands in Story 9.7)');
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
        <h1>AgentBBS — Web Control Room</h1>
        {error !== null && <p data-testid="error">Error: {error}</p>}
        {model === null && error === null && <p>Loading the board…</p>}
        {model !== null && model.activeRoomId === null && (
          <p data-testid="no-room">Select a room from the sidebar.</p>
        )}
        {model !== null && model.activeRoomId !== null && (
          <p data-testid="active-room">
            Viewing <code>#{model.activeRoomId}</code> — the room thread renders
            in Story 9.5.
          </p>
        )}
      </main>
    </div>
  );
}
