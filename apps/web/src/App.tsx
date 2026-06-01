// The web control-room shell (Story 9.3 → 9.4 → 9.5 → 9.8).
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
//
// It imports @agentbbs/ui-shared (the shared React core) + the tokens.css design-token core
// (in main.tsx). It NEVER imports @agentbbs/core / @agentbbs/data-access and never speaks
// MCP or SQL (NFR2) — only the JSON API + SSE.
//
// Story 9.7 adds the join-gate Composer (the room main-column composer seam): the operator
// joins + posts as a peer over the SAME core ops agents use (joinBoard → reply), flipping the
// posture `you: watching` → `you: @operator (peer)` on real participation.
//
// Story 9.8 — ROOMS AS EDITOR TABS. The 9.5 single-open-room model is generalized to a
// MULTI-TAB model: an ordered list of OPEN rooms + the ACTIVE room id (rooms behave like
// editor tabs, side-by-side). Clicking a tree room OPENS it as a tab (or focuses it if
// already open) and makes it active; the active tab's RoomView renders in the main column.
// A background tab whose room gains SSE activity shows a leading `•` (the same Story 9.4
// delta signal feeds tab unread too); focusing the tab clears it.
//
// AC2 (the load-bearing semantic): CLOSING A TAB IS A VIEW-ONLY ACTION, NEVER A BOARD OP.
// The board has NO "leave room" / "un-participate" op (membership/participation is
// append-only + monotonic — Epics 3-5). `handleCloseTab` drops the tab from the open list
// and picks a new active tab; it fires NO network write. The operator stays whatever
// participant they were; reopening the tab re-fetches the same room (read stays board-wide,
// FR28). We do NOT invent a leave/close board write.
//
// RETAIN POLICY (documented): each open tab keeps its loaded RoomViewModel in state (a simple
// "keep open rooms' models cached" so switching back is instant). Only the ACTIVE tab's
// RoomView is rendered. The VS Code WebviewPanel retain-context LRU policy is an Epic 10
// concern (noted in DESIGN room-tab); the web strip just holds the models in memory.

import { useEffect, useRef, useState } from 'react';
import { Composer, NavTree, RoomView, TabStrip } from '@agentbbs/ui-shared';

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

import type {
  NavTreeModel,
  RoomTabModel,
  RoomViewModel,
} from '@agentbbs/ui-shared';
import type { EventWire } from './api-client.js';
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

/**
 * One open room tab's full client state — the prop-driven {@link RoomTabModel} for the strip,
 * PLUS the per-tab loaded view model / load error / local join intent (the bits that used to
 * be single-room shell state in Story 9.5-9.7, now per-tab so multiple rooms stay open).
 */
interface OpenTab {
  roomId: string;
  /** The tab label (the room identifier, mono) — the subject is room metadata. */
  label: string;
  /** The leading `•` unread flag for a BACKGROUND tab (cleared on focus). */
  unread: boolean;
  /** The loaded room view model, or null while the room's thread is loading. */
  room: RoomViewModel | null;
  /** A load error for this tab's room, or null. */
  roomError: string | null;
  /** Whether the operator has clicked `[ join room to post ]` for this room (local intent). */
  joinedIntent: boolean;
}

/** Which room id (if any) an SSE event affects — its tab-unread target (mirrors the tree fold). */
function eventRoomId(event: EventWire): string | undefined {
  const roomId = event.payload['room_id'];
  return typeof roomId === 'string' ? roomId : undefined;
}

/** The web control-room shell — sidebar NavTree + the open-room TABS + active-tab thread. */
export function App() {
  const [model, setModel] = useState<NavTreeModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Story 9.8 — the MULTI-TAB model: an ordered list of OPEN rooms + the ACTIVE room id. The
  // active tab's RoomView renders. (Story 9.5-9.7 single-room shell state now lives per-tab.)
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  // A ref mirror of `activeRoomId` so the mount-once SSE handler reads the CURRENT active tab
  // (not the stale value captured when the effect subscribed) when deciding which background
  // tab gains the unread • — the active tab stays read.
  const activeRoomIdRef = useRef<string | null>(null);
  activeRoomIdRef.current = activeRoomId;
  // Whether a composer write (join or send) is in flight for the active room — disables the
  // composer controls so the operator does not double-submit (the rich optimistic echo +
  // failure-retry is Story 9.9).
  const [composerPending, setComposerPending] = useState(false);

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

  // Open the SSE live view; fold each delta into the tree model (live decorations) AND into the
  // open-tab unread flags (a BACKGROUND tab whose room gains activity shows a leading •; the
  // active tab stays read — the operator is looking at it). Same Story 9.4 delta signal.
  useEffect(() => {
    const close = openEventStream((event) => {
      setModel((prev) => (prev === null ? prev : foldTreeDelta(prev, event)));
      foldTabUnread(event);
    });
    return close;
    // Subscribe once on mount. foldTabUnread reads the CURRENT active tab via activeRoomIdRef
    // (not a captured value), so the single subscription stays correct as the active tab changes.
  }, []);

  /**
   * Fold one SSE delta into the open-tab unread flags (IMMUTABLY — a NEW tabs array). A
   * `room.replied` / `announcement.posted` for an OPEN, NON-ACTIVE tab sets its `unread` •;
   * the active tab stays read (the operator is reading it). A delta for a room with no open tab
   * is ignored (the tree fold handles the sidebar decoration). Never throws.
   */
  function foldTabUnread(event: EventWire): void {
    if (event.type !== 'room.replied' && event.type !== 'announcement.posted') {
      return;
    }
    const roomId = eventRoomId(event);
    if (roomId === undefined) return;
    const activeId = activeRoomIdRef.current;
    setOpenTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        // The active tab stays read; only a background open tab gains the unread •.
        if (tab.roomId !== roomId || tab.roomId === activeId || tab.unread) {
          return tab;
        }
        changed = true;
        return { ...tab, unread: true };
      });
      return changed ? next : prev;
    });
  }

  /** Load (or reload) a room's view model into its open tab (immutable per-tab update). */
  function loadTabRoom(roomId: string): void {
    loadRoomViewModel(roomId)
      .then((built) => {
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.roomId === roomId
              ? { ...tab, room: built, roomError: null }
              : tab,
          ),
        );
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Failed to open the room.';
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.roomId === roomId ? { ...tab, roomError: message } : tab,
          ),
        );
      });
  }

  /**
   * Clicking a tree room: OPEN it as a tab (or FOCUS it if already open) and make it active.
   * Focusing clears the tab's unread • (the SSE-fed background unread clears on focus, AC2).
   * Opening a fresh tab fetches its thread; a re-focus of an already-open tab does NOT refetch
   * (its model is retained — instant switch).
   */
  function handleSelectRoom(roomId: string): void {
    // Clear the tree-side unread for the selected room (Story 9.4 basic clear-on-select).
    setModel((prev) => (prev === null ? prev : selectRoom(prev, roomId)));
    setActiveRoomId(roomId);

    // Decide open-or-focus from the CURRENT tabs (functional check so the load decision does
    // not rely on a setState updater's side effect — the updater may run after this line).
    const alreadyOpen = openTabs.some((tab) => tab.roomId === roomId);
    if (alreadyOpen) {
      // Already open → focus it + clear its unread • (focus-clears-unread, AC2). No refetch
      // (the tab's model is retained — instant switch).
      setOpenTabs((prev) =>
        prev.map((tab) =>
          tab.roomId === roomId ? { ...tab, unread: false } : tab,
        ),
      );
      return;
    }
    // Not open → append a new tab (loading) + fetch its full model. The label is the room id
    // (the room subject is room metadata; the tab shows the mono identifier).
    const label = roomLabelFromTree(roomId);
    setOpenTabs((prev) => {
      // Guard a double-open race (two fast clicks): if it slipped in, don't duplicate.
      if (prev.some((tab) => tab.roomId === roomId)) return prev;
      return [
        ...prev,
        {
          roomId,
          label,
          unread: false,
          room: null,
          roomError: null,
          joinedIntent: false,
        },
      ];
    });
    loadTabRoom(roomId);
  }

  /** Find a room's display label (its subject, falling back to the id) from the tree model. */
  function roomLabelFromTree(roomId: string): string {
    if (model !== null) {
      for (const project of model.projects) {
        const room = project.rooms.find((r) => r.roomId === roomId);
        if (room) return room.roomId;
      }
    }
    return roomId;
  }

  /**
   * Close a tab — a VIEW-ONLY action (AC2). Drop the tab from the open list and pick a sensible
   * new active tab if the closed one was active (the tab to its right, else its left, else
   * none). This fires NO board write: the board has no "leave room" op (Epics 3-5); the
   * operator stays whatever participant they were, and reopening re-fetches the same room. We
   * do NOT invent a leave/close board op.
   */
  function handleCloseTab(roomId: string): void {
    setOpenTabs((prev) => {
      const index = prev.findIndex((tab) => tab.roomId === roomId);
      if (index === -1) return prev;
      const next = prev.filter((tab) => tab.roomId !== roomId);
      // If we closed the active tab, reactivate a neighbor (right, else left, else none).
      setActiveRoomId((currentActive) => {
        if (currentActive !== roomId) return currentActive;
        if (next.length === 0) return null;
        const newIndex = Math.min(index, next.length - 1);
        return next[newIndex]?.roomId ?? null;
      });
      return next;
    });
  }

  function handleJoinProject(): void {
    // DISPOSITION (Story 9.7): the room-level join-to-post (the join-gate Composer below) is
    // the participate seam — the operator joins + posts as a peer from INSIDE an open room. The
    // sidebar `＋ join a project…` action (a board-wide discovery affordance, distinct from the
    // room composer) remains a documented hand-off. Left as a logged stub.
    console.info(
      'join a project… (sidebar board-picker is a later affordance)',
    );
  }

  // The currently ACTIVE tab (the one whose RoomView renders), or undefined when none is open.
  const activeTab = openTabs.find((tab) => tab.roomId === activeRoomId);

  /** Patch the active tab immutably (used by the reaction/join/send handlers). */
  function patchActiveTab(patch: Partial<OpenTab>): void {
    if (activeRoomId === null) return;
    setOpenTabs((prev) =>
      prev.map((tab) =>
        tab.roomId === activeRoomId ? { ...tab, ...patch } : tab,
      ),
    );
  }

  // Story 9.6 — toggle a 👍 on a post in the ACTIVE room. Decide react-vs-unreact from the
  // operator's CURRENT live state on that post, fire the write, then RE-LOAD the room view
  // model so the live count, the operator's chip state, AND the agreed-mark POSITION re-derive
  // (a basic refetch/fold — the rich optimistic echo is Story 9.9). The agreed mark is COMPUTED
  // from the re-fetched contract, never stored (FR21).
  function handleToggleReaction(seq: number): void {
    const room = activeTab?.room ?? null;
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
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.roomId === roomId ? { ...tab, room: rebuilt } : tab,
          ),
        );
      })
      .catch((err: unknown) => {
        // A 403 (NOT_A_MEMBER / NO_OPERATOR) or transient failure — surface a calm error.
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.roomId === roomId
              ? {
                  ...tab,
                  roomError:
                    err instanceof Error
                      ? err.message
                      : 'Could not update the reaction.',
                }
              : tab,
          ),
        );
      });
  }

  // Story 9.7 — `[ join room to post ]`: join the SUB-BOARD (membership) so the operator can
  // post in the ACTIVE room. Per the Design reconciliation, room PARTICIPATION is established
  // by the first SEND (reply, grant-on-act); joinBoard here is the immediate membership + the
  // `✓ you joined` step. After joining, refetch the room so the composer reveals the field.
  function handleJoinRoom(): void {
    const room = activeTab?.room ?? null;
    if (room === null) return;
    const roomId = room.roomId;
    const projectId = room.projectId;
    patchActiveTab({ joinedIntent: true });
    setComposerPending(true);
    postJoin(projectId)
      .then(() => loadRoomViewModel(roomId))
      .then((rebuilt) => {
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.roomId === roomId ? { ...tab, room: rebuilt } : tab,
          ),
        );
      })
      .catch((err: unknown) => {
        // Join failed — drop back to the gate (no half-joined state, per EXPERIENCE.md).
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.roomId === roomId
              ? {
                  ...tab,
                  joinedIntent: false,
                  roomError:
                    err instanceof Error
                      ? err.message
                      : 'Could not join the room.',
                }
              : tab,
          ),
        );
      })
      .finally(() => setComposerPending(false));
  }

  // Story 9.7 — SEND a message as a peer over the SAME core `reply` agents use (no operator
  // backdoor). Grant-on-act makes the operator a ROOM PARTICIPANT, so after the refetch the
  // posture flips `you: watching` → `you: @operator (peer)`. Basic refetch (optimistic echo is
  // Story 9.9).
  function handleSendMessage(body: string): void {
    const room = activeTab?.room ?? null;
    if (room === null) return;
    const roomId = room.roomId;
    setComposerPending(true);
    postReply(roomId, body)
      .then(() => loadRoomViewModel(roomId))
      .then((rebuilt) => {
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.roomId === roomId ? { ...tab, room: rebuilt } : tab,
          ),
        );
      })
      .catch((err: unknown) => {
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.roomId === roomId
              ? {
                  ...tab,
                  roomError:
                    err instanceof Error
                      ? err.message
                      : 'Could not post the message.',
                }
              : tab,
          ),
        );
      })
      .finally(() => setComposerPending(false));
  }

  const tabModels: RoomTabModel[] = openTabs.map((tab) => ({
    roomId: tab.roomId,
    label: tab.label,
    unread: tab.unread,
  }));

  const activeRoom = activeTab?.room ?? null;
  const activeRoomError = activeTab?.roomError ?? null;
  const activeJoinedIntent = activeTab?.joinedIntent ?? false;

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

        {/* Story 9.8 — the open-room editor tabs (side-by-side; active tab base+rail, the
            rest panel/dim; background unread •; × closes — a VIEW action, never a board op). */}
        {openTabs.length > 0 && (
          <TabStrip
            tabs={tabModels}
            activeRoomId={activeRoomId}
            onSelect={handleSelectRoom}
            onClose={handleCloseTab}
          />
        )}

        {model !== null && openTabs.length === 0 && error === null && (
          <p data-testid="no-room">Select a room from the sidebar.</p>
        )}

        {activeTab !== undefined && activeRoomError !== null && (
          <p data-testid="room-error">Error: {activeRoomError}</p>
        )}
        {activeTab !== undefined &&
          activeRoom === null &&
          activeRoomError === null && (
            <p data-testid="room-loading">Opening room…</p>
          )}
        {activeRoom !== null && (
          <RoomView
            room={activeRoom}
            onToggleReaction={handleToggleReaction}
            composerSlot={
              <Composer
                // The composer shows its JOINED (field + send) state when the operator is a true
                // ROOM PARTICIPANT (posture `peer`) OR has just clicked `[ join room to post ]`
                // (local intent). A watching operator who has not clicked join sees the
                // `[ join room to post ]` gate.
                joined={
                  activeRoom.operatorPosture.kind === 'peer' ||
                  activeJoinedIntent
                }
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
