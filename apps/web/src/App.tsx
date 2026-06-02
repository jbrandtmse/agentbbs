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
import {
  Composer,
  ConnectionFooter,
  CreateProjectCompose,
  FocusAffordance,
  JoinProjectPicker,
  NavTree,
  PostAnnouncementCompose,
  RoomView,
  TabStrip,
} from '@agentbbs/ui-shared';

import {
  ApiError,
  announceProject,
  appendPendingPost,
  deriveAgreedSeq,
  fetchDirectory,
  fetchMe,
  foldRoomDelta,
  foldTreeDelta,
  loadRoomViewModel,
  loadTreeModel,
  makePendingPost,
  markPendingPostFailed,
  newClientToken,
  openEventStream,
  postAnnouncement,
  postFocus,
  postJoin,
  postReact,
  postReply,
  postUnreact,
  selectRoom,
} from './api-client.js';

import type {
  ConnectionStatus,
  JoinableProject,
  MessagePostModel,
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

// Story 9.11 — the calm INITIATE bar (a thin row holding the `＋ start a project` / `＋ open a
// room` toggle). Quiet panel-bg row with a bottom rule; the toggle is a terse lowercase text
// button (Story 9.10 calm voice), NOT a splashy CTA.
const initiateBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-2) var(--space-7)',
  background: 'var(--surface-panel)',
  borderBottom: '1px solid var(--border)',
};

const initiateButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-dim)',
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
  cursor: 'pointer',
  padding: 'var(--space-1) 0',
};

// Story 9.14 (AC3) — the DISABLED initiate-button treatment (watching-only host): inert + faint,
// `not-allowed` cursor, no pointer events (mirrors the Story 9.13 FocusAffordance disabled state).
const initiateButtonDisabledStyle: CSSProperties = {
  ...initiateButtonStyle,
  color: 'var(--text-faint)',
  cursor: 'not-allowed',
  opacity: 0.6,
};

// Story 9.14 (AC3) — the terse inline reason shown next to a disabled initiate affordance.
const initiateReasonStyle: CSSProperties = {
  color: 'var(--text-faint)',
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
};

// Story 9.11 — the project-scoped "open a room in <project>" label above the shell-level
// announcement compose (so the operator sees which board the new room lands in).
const openRoomLabelStyle: CSSProperties = {
  color: 'var(--text-dim)',
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
};

// The sidebar column: the nav tree fills it, the connection footer sits at the bottom (Story
// 9.10). A fixed-width flex column matching the tree's --sidebar-w so the footer aligns under it.
const sidebarColumnStyle: CSSProperties = {
  width: 'var(--sidebar-w)',
  flexShrink: 0,
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--surface-panel)',
  borderRight: '1px solid var(--border)',
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
  // Story 9.10 — the live transport status for the calm connection footer (AC1). It starts
  // `reconnecting` (the channel is not open until the EventSource fires `onopen`), flips to
  // `connected` on open, and back to `reconnecting` on a dropped connection. NEVER a modal —
  // already-loaded content stays readable while reconnecting (the live fold resumes on reopen).
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('reconnecting');

  // Story 9.11 — the operator INITIATE-surface compose panels (calm, inline, never a modal).
  // `createProjectOpen` toggles the "start a project" form; `createProjectError`/`createPending`
  // drive its inline calm error (`PROJECT_EXISTS`) + disabled state. The "open a room" panel is
  // PROJECT-SCOPED, NOT room-scoped: `announceProjectId` is the project it targets (an agent can
  // `post_announcement` into a room-less board it belongs to, so the operator must be able to too
  // — the affordance opens via the NavTree `announcements (N)` bucket, INDEPENDENT of any open
  // room). `announceComposeOpen` toggles it; `announceError`/`announcePending` drive its inline
  // state; `announceJoinFirst` flips it to the join-first CTA when core rejects a non-member with
  // NOT_A_MEMBER (AC2 handoff, never a silent failure).
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(
    null,
  );
  const [createPending, setCreatePending] = useState(false);
  const [announceComposeOpen, setAnnounceComposeOpen] = useState(false);
  const [announceProjectId, setAnnounceProjectId] = useState<string | null>(
    null,
  );
  const [announceError, setAnnounceError] = useState<string | null>(null);
  const [announcePending, setAnnouncePending] = useState(false);
  const [announceJoinFirst, setAnnounceJoinFirst] = useState(false);

  // Story 9.12 — the calm "join a project" discovery picker (wires the previously-inert
  // `＋ join a project…` row). `joinPickerOpen` toggles the inline panel; `joinable` is the
  // global-read directory MINUS the projects the operator already belongs to (computed when the
  // picker opens, canonical-handle compare); `joinPickerError`/`joinPending` drive its calm inline
  // error (`NO_OPERATOR` for a watching-only host) + disabled state. NOT a modal (Story 9.10).
  const [joinPickerOpen, setJoinPickerOpen] = useState(false);
  const [joinable, setJoinable] = useState<JoinableProject[]>([]);
  const [joinPickerError, setJoinPickerError] = useState<string | null>(null);
  const [joinPending, setJoinPending] = useState(false);

  // Story 9.13 — the operator's OWN current focus + registration status (HOST-layer `/api/me`
  // fields). `operatorFocus` is shown on the `@operator (you)` row; `operatorRegistered` (with
  // `model.operatorHandle !== null`) gates the set-focus affordance — a watching-only OR unregistered
  // operator sees it DISABLED inline (never a crash, AC1). `focusError`/`focusPending` drive the
  // affordance's calm inline error + disabled-while-writing state. The focus is set over the SAME
  // core `update_focus` an agent uses (no operator backdoor) and reflected LIVE by re-reading /api/me.
  const [operatorFocus, setOperatorFocus] = useState<string | null>(null);
  const [operatorRegistered, setOperatorRegistered] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [focusPending, setFocusPending] = useState(false);

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

  // Story 9.13 — read the operator's own focus + registration once on mount (the HOST-layer /api/me
  // fields). A failure is non-fatal (the affordance stays disabled-by-default); the tree load above
  // owns the board-level error. Re-read after a successful set so the new focus reflects live.
  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setOperatorFocus(me.focus ?? null);
        setOperatorRegistered(me.registered === true);
      })
      .catch(() => {
        // Non-fatal: leave the affordance disabled-by-default; the board error is surfaced elsewhere.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Open the SSE live view; fold each delta into the tree model (live decorations) AND into the
  // open-tab unread flags (a BACKGROUND tab whose room gains activity shows a leading •; the
  // active tab stays read — the operator is looking at it). Same Story 9.4 delta signal.
  useEffect(() => {
    const close = openEventStream(
      (event) => {
        setModel((prev) => (prev === null ? prev : foldTreeDelta(prev, event)));
        foldTabUnread(event);
        foldTabRoom(event);
      },
      '',
      {
        // Map the SSE transport to the calm footer LED (Story 9.10): `connected` on open,
        // `reconnecting` on a dropped connection (the browser EventSource auto-reconnects;
        // the 9.9 live fold resumes on the next open — idempotent by seq, no double-apply).
        onStatus: setConnectionStatus,
      },
    );
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

  /**
   * Story 9.9 — fold one SSE delta into each OPEN tab's LOADED room view model IMMUTABLY (the
   * AC1 live-thread fold, Mode A watch-live): a `room.replied` in an open room appends the post
   * (de-dup vs. an optimistic echo by this operator); a `message.reacted`/`message.unreacted`
   * updates the affected post's reactions + re-derives the ✓ agreed mark. `foldRoomDelta` is
   * pure + immutable (new model objects) and a no-op for a delta targeting a different room, so
   * mapping it over every tab only touches the tab(s) the delta concerns. Never throws.
   *
   * NFR5: this is the operator's OWN kept-open live view folding host→browser deltas — NOT an
   * agent push. Agents stay pull-only via `check`; nothing here pushes to any agent.
   */
  function foldTabRoom(event: EventWire): void {
    setOpenTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        if (tab.room === null) return tab;
        const folded = foldRoomDelta(tab.room, event);
        if (folded === tab.room) return tab;
        changed = true;
        return { ...tab, room: folded };
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

  /** Find a project's display title from the tree model (Story 9.14 — the join-first callout). */
  function projectTitle(projectId: string | null): string | undefined {
    if (projectId === null || model === null) return undefined;
    return model.projects.find((p) => p.projectId === projectId)?.title;
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

  // Story 9.14 (AC5) — COMPOSE-PANEL EXCLUSIVITY. The operator INITIATE panels (start-a-project,
  // open-a-room, join-picker) are calm inline affordances that previously toggled INDEPENDENTLY, so
  // two could stack at once (e.g. open-a-room over the create-project form) and overlay an open room
  // view confusingly. This central helper makes them MUTUALLY EXCLUSIVE: opening one CLOSES the
  // others (and clears their inline state), so at most one initiate panel is ever open and the open
  // room stays legible. Each open-site routes through here instead of flipping its own flag directly.
  // (The FocusAffordance owns its own internal edit toggle in the sidebar; the three main panels are
  // the ones that stack over the room view — AC5's primary concern.)
  type InitiatePanel = 'create-project' | 'open-room' | 'join-picker';
  function openInitiatePanel(panel: InitiatePanel): void {
    // Close create-project unless it's the one being opened.
    if (panel !== 'create-project') {
      setCreateProjectOpen(false);
      setCreateProjectError(null);
    }
    // Close open-a-room unless it's the one being opened.
    if (panel !== 'open-room') {
      setAnnounceComposeOpen(false);
      setAnnounceError(null);
      setAnnounceJoinFirst(false);
    }
    // Close the join-picker unless it's the one being opened.
    if (panel !== 'join-picker') {
      setJoinPickerOpen(false);
      setJoinPickerError(null);
    }
    // Open the requested one.
    if (panel === 'create-project') setCreateProjectOpen(true);
    if (panel === 'open-room') setAnnounceComposeOpen(true);
    if (panel === 'join-picker') setJoinPickerOpen(true);
  }

  // Story 9.12 — OPEN THE JOIN-A-PROJECT PICKER (wires the previously-inert `＋ join a project…`
  // row). Fetch the global-read directory (`fetchDirectory`, the same read the tree builds from)
  // and compute the JOINABLE set = every project MINUS the ones the operator already belongs to
  // (filter `members` against the CANONICAL operator handle — `model.operatorHandle`, lowercased
  // by resolveOperatorHandle, matching how memberships are stored). Then open the calm inline
  // picker. A watching-only host (no operator handle) cannot resolve an actor → keep the JOIN a
  // no-op at choose-time (the picker surfaces the host's NO_OPERATOR calmly); we still open the
  // picker so the affordance does not crash. On a directory-read failure, surface the calm error.
  function handleJoinProject(): void {
    setJoinPickerError(null);
    // `model.operatorHandle` is already canonical (lowercased by `resolveOperatorHandle`), and
    // `members` are stored canonical by the board. We still compare CANONICALLY on both sides
    // (lowercase the member entry too) so the joinable filter does not silently depend on a
    // distant upstream invariant — a project the operator already belongs to is excluded even if
    // a member entry were to arrive in a different case (Story 9.12 "canonical-handle compare").
    const operator = model?.operatorHandle ?? null;
    fetchDirectory()
      .then((directory) => {
        const next: JoinableProject[] = directory.projects
          .filter(
            (p) =>
              operator === null ||
              !p.members.some((m) => m.toLowerCase() === operator),
          )
          .map((p) => ({ projectId: p.project_id, title: p.title }));
        setJoinable(next);
        // AC5 — opening the picker closes any other initiate panel (no stacking).
        openInitiatePanel('join-picker');
      })
      .catch((err: unknown) => {
        // Even on a read failure, open the picker so the affordance is not a silent no-op; the
        // calm inline error explains why the list is empty (never a modal, never a crash).
        setJoinable([]);
        setJoinPickerError(
          err instanceof Error ? err.message : 'Could not load projects.',
        );
        openInitiatePanel('join-picker');
      });
  }

  // Story 9.12 — CHOOSE a project to join from the picker. Call `postJoin(projectId)` (the SAME
  // `join_board` op an agent uses — no operator backdoor; idempotent, a re-join is a host no-op),
  // then `loadTreeModel()` to refresh so the new membership shows LIVE, and close the picker. On
  // failure surface the calm inline error (NO_OPERATOR for a watching-only host / BOARD_NOT_FOUND
  // / …) with the picker still open (never a silent swallow). Closing the picker without choosing
  // is a clean no-op (no board write) — handled by the cancel/Esc handlers on the panel.
  function handleChooseJoin(projectId: string): void {
    setJoinPending(true);
    setJoinPickerError(null);
    postJoin(projectId)
      .then(() => loadTreeModel())
      .then((built) => {
        // The new membership appears live (a full re-derive of the global-read model — the same
        // success-refetch discipline as the announce/reply paths in 9.9/9.11).
        setModel(built);
        setJoinPickerOpen(false);
        setJoinPickerError(null);
      })
      .catch((err: unknown) => {
        setJoinPickerError(
          err instanceof Error ? err.message : 'Could not join the project.',
        );
      })
      .finally(() => setJoinPending(false));
  }

  // Story 9.11 — START A NEGOTIATION (announce a project). Open the calm compose panel; on submit
  // call the SAME core `announceProject` an agent uses (no operator backdoor). On success the new
  // `project.announced` + the operator's `board.joined` land in the ledger; refresh the tree so the
  // new project appears LIVE (the operator is its first member), and close the panel. On
  // PROJECT_EXISTS (duplicate title/slug → 409) show the calm inline error WITH the draft intact
  // (the form stays open — no modal). NO_OPERATOR (watching-only) surfaces the same way.
  function handleCreateProject(input: {
    title: string;
    description: string;
  }): void {
    setCreatePending(true);
    setCreateProjectError(null);
    announceProject(input.title, input.description)
      .then(() => loadTreeModel())
      .then((built) => {
        // The new project appears live in the tree (a full re-derive of the global-read model —
        // brand-new projects/rooms are outside foldTreeDelta's decoration scope, so we refetch the
        // authoritative model, the same success-refetch discipline as the reply path in 9.9).
        setModel(built);
        setCreateProjectOpen(false);
        setCreateProjectError(null);
      })
      .catch((err: unknown) => {
        // Calm inline error (PROJECT_EXISTS / NO_OPERATOR / …) — the panel stays open, draft intact.
        setCreateProjectError(
          err instanceof Error ? err.message : 'Could not create the project.',
        );
      })
      .finally(() => setCreatePending(false));
  }

  // Story 9.11 — OPEN THE PROJECT-SCOPED "open a room" compose (the AC2 PRIMARY path). Fired by the
  // NavTree `announcements (N)` bucket so the affordance is reachable for a MEMBER of a ROOM-LESS
  // project — an agent can post_announcement into a room-less board it belongs to, so the operator
  // must be able to too (operator↔agent parity, the whole point of this correct-course story). The
  // target is the SELECTED project, INDEPENDENT of any open room. (The in-room `＋ open a room`
  // toggle below also routes here, passing the active room's projectId.)
  function handleOpenAnnouncements(projectId: string): void {
    setAnnounceProjectId(projectId);
    setAnnounceError(null);
    setAnnounceJoinFirst(false);
    // AC5 — opening this panel closes any other initiate panel (no stacking).
    openInitiatePanel('open-room');
  }

  // Story 9.11 — OPEN A ROOM (post an announcement) into the SELECTED project (`announceProjectId`,
  // set by handleOpenAnnouncements — NOT derived from an open room, so a room-less board works).
  // The SAME core `postAnnouncement` an agent uses. On success the new `announcement.posted` lands;
  // refresh the tree so the new room appears LIVE, and close the panel. AC2: on NOT_A_MEMBER (403)
  // flip to the join-first CTA (never a silent failure); on BODY_TOO_LARGE (413) / other → calm
  // inline error.
  function handlePostAnnouncement(input: {
    subject: string;
    body: string;
  }): void {
    const projectId = announceProjectId;
    if (projectId === null) return;
    setAnnouncePending(true);
    setAnnounceError(null);
    setAnnounceJoinFirst(false);
    postAnnouncement(projectId, input.subject, input.body)
      .then(() => loadTreeModel())
      .then((built) => {
        setModel(built);
        setAnnounceComposeOpen(false);
        setAnnounceError(null);
      })
      .catch((err: unknown) => {
        // AC2 — a non-member cannot open a room: surface the join-first handoff (never silent).
        if (err instanceof ApiError && err.code === 'NOT_A_MEMBER') {
          setAnnounceJoinFirst(true);
          return;
        }
        // BODY_TOO_LARGE / BOARD_NOT_FOUND / NO_OPERATOR / … → calm inline error, draft intact.
        setAnnounceError(
          err instanceof Error ? err.message : 'Could not open the room.',
        );
      })
      .finally(() => setAnnouncePending(false));
  }

  // Story 9.11 / AC2 — the join-first handoff: the operator clicks `[ join this project first ]`,
  // so join the SELECTED project's sub-board (`joinBoard`, the SAME op an agent uses) then drop back
  // to the compose form so they can post (now a member). Composes with Story 9.12's join path.
  function handleAnnounceJoinFirst(): void {
    const projectId = announceProjectId;
    if (projectId === null) return;
    setAnnouncePending(true);
    setAnnounceError(null);
    postJoin(projectId)
      .then(() => {
        // Now a member — drop the join-first CTA back to the compose form (the draft is in the
        // component's own state; the operator re-submits to post).
        setAnnounceJoinFirst(false);
      })
      .catch((err: unknown) => {
        setAnnounceError(
          err instanceof Error ? err.message : 'Could not join the project.',
        );
      })
      .finally(() => setAnnouncePending(false));
  }

  // Story 9.13 — SET MY FOCUS. Set the operator's OWN focus over the SAME core `update_focus` an
  // agent uses (no operator backdoor); on success a real `identity.focus_updated` lands in the ledger.
  // Then re-read /api/me so the new focus reflects LIVE on the `@operator (you)` row, and close the
  // editor. On failure surface the calm inline error (NO_OPERATOR for watching-only / the host's
  // OPERATOR_NOT_REGISTERED backstop / …) with the draft preserved (the affordance keeps the field).
  // The PRIMARY guard is the affordance being DISABLED when watching-only OR unregistered (below);
  // this handler is only reachable when enabled, but the host backstop still catches a race.
  function handleSetFocus(focus: string): void {
    setFocusPending(true);
    setFocusError(null);
    postFocus(focus)
      .then((result) => {
        // Reflect the new focus immediately from the authoritative write response, then re-read
        // /api/me as the live source of truth (mirrors the announce/join success-refetch discipline).
        setOperatorFocus(result.focus);
        return fetchMe();
      })
      .then((me) => {
        setOperatorFocus(me.focus ?? null);
        setOperatorRegistered(me.registered === true);
        setFocusError(null);
      })
      .catch((err: unknown) => {
        setFocusError(
          err instanceof Error ? err.message : 'Could not set your focus.',
        );
      })
      .finally(() => setFocusPending(false));
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

  /** Apply an immutable patch to ONE post (by seq) in a tab's room model, re-deriving agreed. */
  function patchTabPostReactions(
    roomId: string,
    seq: number,
    nextReactions: string[],
  ): void {
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.roomId !== roomId || tab.room === null) return tab;
        const messages = tab.room.messages.map((m) =>
          m.seq === seq ? { ...m, reactions: nextReactions } : m,
        );
        return {
          ...tab,
          room: { ...tab.room, messages, agreedSeq: deriveAgreedSeq(messages) },
        };
      }),
    );
  }

  // Story 9.9 — OPTIMISTIC 👍 toggle on a post in the ACTIVE room (AC2). Decide react-vs-unreact
  // from the operator's CURRENT live state, OPTIMISTICALLY apply the toggle (add/remove the
  // operator from the post's reactions + re-derive the ✓ agreed mark) so the chip + count + mark
  // update INSTANTLY, then fire the write. On success the ReactResult `reactions` is the
  // AUTHORITATIVE post-state (apply it — collapses any divergence). On failure the optimistic
  // toggle REVERTS to the exact prior reactions (NO count drift — the snapshot is restored).
  function handleToggleReaction(seq: number): void {
    const room = activeTab?.room ?? null;
    if (room === null) return;
    const roomId = room.roomId;
    const operator = room.operatorHandle ?? null;
    if (operator === null) return;
    const post = room.messages.find((m) => m.seq === seq);
    if (post === undefined) return;
    // Snapshot the EXACT prior reactions so a failure reverts with no drift.
    const priorReactions = [...post.reactions];
    const alreadyReacted = priorReactions.includes(operator);
    const optimisticReactions = alreadyReacted
      ? priorReactions.filter((r) => r !== operator)
      : [...priorReactions, operator];

    // Optimistic apply — instant chip/count/agreed update.
    patchTabPostReactions(roomId, seq, optimisticReactions);

    const write = alreadyReacted ? postUnreact : postReact;
    write(roomId, seq)
      .then((result) => {
        // The ReactResult reactions are authoritative — apply them (idempotent if they match
        // the optimistic state; corrective if a concurrent change diverged).
        patchTabPostReactions(roomId, seq, result.reactions);
      })
      .catch((err: unknown) => {
        // REVERT the optimistic toggle to the exact prior reactions (no count drift), then
        // surface a calm inline error.
        patchTabPostReactions(roomId, seq, priorReactions);
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

  // Story 9.9 — OPTIMISTIC SEND + reconciliation (AC2), over the SAME core `reply` agents use
  // (no operator backdoor). Flow:
  //   1. ECHO the operator's message into the thread PENDING (dimmed "sending…") immediately,
  //      with a clientToken; the composer is NOT blocked (composerPending stays false so the
  //      operator can keep typing the next post).
  //   2. POST the reply. On SUCCESS, REFETCH the room (grant-on-act flips the posture to peer +
  //      lands the confirmed message at its real seq) and RECONCILE: drop the pending echo (the
  //      refetch already carries the confirmed post) so there is NO DUPLICATE; preserve any
  //      OTHER in-flight echoes (concurrent sends).
  //   3. On FAILURE, flip the echo to FAILED inline (`post failed — retry`) — the body is
  //      PRESERVED in the echo, so retry re-sends the SAME body. No modal, no lost draft.
  //
  // RECONCILIATION KEY (Research-First, recorded in Dev Notes): the reply POST returns the ROOM,
  // NOT the new message seq (`roomToWire`'s seq is the activation seq, not the post). So we do
  // NOT key on a POST-response message seq; we REFETCH (authoritative) + de-dup the pending echo
  // by clientToken, and the redundant SSE `room.replied` is de-duped by `foldRoomDelta`
  // (idempotent by seq + the same actor/body echo replacement).
  function handleSendMessage(body: string): void {
    const room = activeTab?.room ?? null;
    if (room === null) return;
    const roomId = room.roomId;
    const operator = room.operatorHandle ?? activeTab?.label ?? 'you';
    const clientToken = newClientToken();
    const echo: MessagePostModel = makePendingPost(operator, body, clientToken);

    // 1. Optimistic echo — append immediately (no composer block).
    setOpenTabs((prev) =>
      prev.map((tab) =>
        tab.roomId === roomId && tab.room !== null
          ? { ...tab, room: appendPendingPost(tab.room, echo) }
          : tab,
      ),
    );

    void sendReplyAndReconcile(roomId, body, clientToken);
  }

  /** POST a reply for an existing pending echo, then reconcile (success) or fail it inline. */
  function sendReplyAndReconcile(
    roomId: string,
    body: string,
    clientToken: string,
  ): Promise<void> {
    return postReply(roomId, body)
      .then(() => loadRoomViewModel(roomId))
      .then((rebuilt) => {
        // Story 9.14 — a reply to a PROTO-ROOM ACTIVATES it (the Epic-4 min-seq activator, the
        // SAME core `reply` an agent uses; no new op). Refresh the tree so the sidebar row flips
        // from a PENDING proto-row to a normal ACTIVE room row LIVE (the now-active room is now
        // returned by `/api/projects/:id/rooms`, so `loadTreeModel` lists it as a normal row).
        // This is the 9.11 refetch-on-success discipline (loadTreeModel() + setModel); it is a
        // no-op flip for an already-active room. A tree-refresh failure must NOT fail the reply
        // reconciliation, so it is fire-and-forget + best-effort (the room model already
        // reconciled below is the authoritative open-thread state).
        void loadTreeModel()
          .then((built) => setModel(built))
          .catch(() => {
            // Best-effort: the sidebar pending→active flip lags to the next load; the open
            // thread already reconciled. Never surfaces an error on the reply success path.
          });
        // RECONCILE: the refetched model is authoritative (it has the confirmed post at its real
        // seq + the flipped posture). Carry over any OTHER still-in-flight echoes (concurrent
        // sends); drop THIS reconciled echo so there is no duplicate.
        setOpenTabs((prev) =>
          prev.map((tab) => {
            if (tab.roomId !== roomId) return tab;
            const inflight = (tab.room?.messages ?? []).filter(
              (m) =>
                (m.pending === true || m.failed === true) &&
                m.clientToken !== clientToken,
            );
            const messages = [...rebuilt.messages, ...inflight];
            return {
              ...tab,
              room: {
                ...rebuilt,
                messages,
                agreedSeq: deriveAgreedSeq(messages),
              },
            };
          }),
        );
      })
      .catch(() => {
        // FAILURE: flip the echo to failed inline (draft preserved in the echo body; retry
        // re-sends it). No modal; the failure is shown ON THE POST itself, calm + inline.
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.roomId === roomId && tab.room !== null
              ? { ...tab, room: markPendingPostFailed(tab.room, clientToken) }
              : tab,
          ),
        );
      });
  }

  /**
   * Story 9.9 — RETRY a FAILED optimistic post (AC2): flip the failed echo back to pending and
   * re-POST the SAME preserved body. No lost draft (the body lives in the echo). A no-op if the
   * token is gone (already reconciled).
   */
  function handleRetryPost(clientToken: string): void {
    const room = activeTab?.room ?? null;
    if (room === null) return;
    const roomId = room.roomId;
    const failedPost = room.messages.find(
      (m) => m.clientToken === clientToken && m.failed === true,
    );
    if (failedPost === undefined) return;
    const body = failedPost.body;

    // Flip failed → pending (re-dim "sending…") immutably.
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.roomId !== roomId || tab.room === null) return tab;
        const messages = tab.room.messages.map((m) =>
          m.clientToken === clientToken
            ? { ...m, pending: true, failed: false }
            : m,
        );
        return { ...tab, room: { ...tab.room, messages } };
      }),
    );

    void sendReplyAndReconcile(roomId, body, clientToken);
  }

  const tabModels: RoomTabModel[] = openTabs.map((tab) => ({
    roomId: tab.roomId,
    label: tab.label,
    unread: tab.unread,
  }));

  const activeRoom = activeTab?.room ?? null;
  const activeRoomError = activeTab?.roomError ?? null;
  const activeJoinedIntent = activeTab?.joinedIntent ?? false;

  // Story 9.14 (AC3) — a WATCHING-ONLY host (no resolved operator handle) cannot initiate: the
  // `＋ start a project` / `＋ open a room` writes would fail at submit with NO_OPERATOR (403). So
  // those affordances render DISABLED inline with a terse reason — matching the Story 9.13
  // FocusAffordance disabled treatment — rather than appearing active and only failing at submit.
  const watchingOnly = model !== null && model.operatorHandle === null;
  const watchingOnlyReason =
    'watching-only — start `agentbbs ui --as <handle>`';

  return (
    <div style={shellStyle} data-testid="web-shell">
      {/* The SIDEBAR landmark column: the board nav tree (when loaded) over the quiet calm
          connection footer (AC1 — the ONLY disconnection signal, never a modal). On COLD OPEN
          (model still null) the column is present (no blocking overlay) with a calm skeleton. */}
      <div style={sidebarColumnStyle} data-testid="sidebar-column">
        {model !== null ? (
          <>
            <NavTree
              model={model}
              onSelectRoom={handleSelectRoom}
              onOpenAnnouncements={handleOpenAnnouncements}
              onJoinProject={handleJoinProject}
            />
            {/* Story 9.13 — the calm "set my focus" affordance on the `@operator (you)` row. The
                operator sets their OWN focus via the SAME core update_focus an agent uses; it
                reflects LIVE on success. DISABLED inert (with a terse reason) when watching-only
                (no operator handle) OR the configured handle is unregistered — never a crash (AC1). */}
            <FocusAffordance
              focus={operatorFocus}
              onSubmit={handleSetFocus}
              onCancel={() => setFocusError(null)}
              onEscape={() => setFocusError(null)}
              error={focusError}
              pending={focusPending}
              disabled={model.operatorHandle === null || !operatorRegistered}
              disabledReason={
                model.operatorHandle === null
                  ? 'watching-only — start `agentbbs ui --as <handle>`'
                  : 'handle not registered'
              }
            />
          </>
        ) : (
          // COLD OPEN: a calm, non-blocking skeleton in place of the tree (no full-app spinner).
          error === null && (
            <div
              data-testid="tree-skeleton"
              style={{
                flex: 1,
                padding: 'var(--space-3)',
                color: 'var(--text-dim)',
                fontFamily: 'var(--ui-label-font)',
                fontSize: 'var(--ui-label-size)',
              }}
            >
              loading…
            </div>
          )
        )}
        {/* Story 9.12 — the calm "join a project" discovery picker, opened by the NavTree
            `＋ join a project…` row. Inline at the bottom of the sidebar (NOT a modal); lists the
            global-read directory MINUS the operator's current memberships. Choosing runs the SAME
            `join_board` an agent uses + refreshes the tree LIVE; cancel/Esc is a clean no-op. */}
        {joinPickerOpen && (
          <JoinProjectPicker
            joinable={joinable}
            onChoose={handleChooseJoin}
            onCancel={() => {
              setJoinPickerOpen(false);
              setJoinPickerError(null);
            }}
            onEscape={() => {
              setJoinPickerOpen(false);
              setJoinPickerError(null);
            }}
            error={joinPickerError}
            pending={joinPending}
          />
        )}
        {/* The calm connection footer — `● connected` / `○ reconnecting…`, never a modal. */}
        <ConnectionFooter status={connectionStatus} />
      </div>
      <main style={mainStyle} data-testid="main-pane" aria-label="room">
        {error !== null && (
          <p data-testid="error">couldn’t load the board — {error}</p>
        )}

        {/* Story 9.11 — the operator INITIATE bar: `＋ start a project` opens the calm
            create-project compose panel (the SAME core announce_project an agent uses). Calm,
            inline, never a modal; the new project appears LIVE in the tree on success. */}
        {model !== null && error === null && (
          <div style={initiateBarStyle} data-testid="initiate-bar">
            <button
              type="button"
              data-testid="start-project-toggle"
              disabled={watchingOnly}
              aria-disabled={watchingOnly}
              onClick={
                watchingOnly
                  ? undefined
                  : () => {
                      // Toggle: a second click on an OPEN create-project closes it; otherwise open
                      // it (and close any other initiate panel — AC5 exclusivity).
                      if (createProjectOpen) {
                        setCreateProjectOpen(false);
                        setCreateProjectError(null);
                      } else {
                        openInitiatePanel('create-project');
                      }
                    }
              }
              style={
                watchingOnly ? initiateButtonDisabledStyle : initiateButtonStyle
              }
            >
              ＋ start a project
            </button>
            {watchingOnly && (
              <span
                data-testid="start-project-disabled-reason"
                style={initiateReasonStyle}
              >
                {watchingOnlyReason}
              </span>
            )}
          </div>
        )}
        {createProjectOpen && (
          <CreateProjectCompose
            onSubmit={handleCreateProject}
            onCancel={() => {
              setCreateProjectOpen(false);
              setCreateProjectError(null);
            }}
            onEscape={() => {
              setCreateProjectOpen(false);
              setCreateProjectError(null);
            }}
            error={createProjectError}
            pending={createPending}
          />
        )}

        {/* Story 9.11 (AC2 PRIMARY PATH) — the PROJECT-SCOPED "open a room" compose, rendered at
            SHELL level (NOT gated behind an open room) so a MEMBER of a ROOM-LESS project can post
            its first announcement — exactly what an agent can do via post_announcement. Opened by
            the NavTree `announcements (N)` bucket (handleOpenAnnouncements sets announceProjectId);
            targets THAT project. On success the new room appears LIVE in the tree; NOT_A_MEMBER →
            the calm join-first CTA; BODY_TOO_LARGE → inline calm error. */}
        {announceComposeOpen && announceProjectId !== null && (
          <div
            data-testid="open-room-panel"
            data-project-id={announceProjectId}
          >
            <div style={initiateBarStyle} data-testid="open-room-bar">
              <span style={openRoomLabelStyle}>
                open a room in {announceProjectId}
              </span>
            </div>
            <PostAnnouncementCompose
              onSubmit={handlePostAnnouncement}
              onCancel={() => {
                setAnnounceComposeOpen(false);
                setAnnounceError(null);
                setAnnounceJoinFirst(false);
              }}
              onEscape={() => {
                setAnnounceComposeOpen(false);
                setAnnounceError(null);
                setAnnounceJoinFirst(false);
              }}
              joinFirst={announceJoinFirst}
              onJoinFirst={handleAnnounceJoinFirst}
              projectLabel={projectTitle(announceProjectId)}
              error={announceError}
              pending={announcePending}
            />
          </div>
        )}

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
          <p data-testid="no-room">select a room from the sidebar</p>
        )}

        {activeTab !== undefined && activeRoomError !== null && (
          <p data-testid="room-error">
            couldn’t open the room — {activeRoomError}
          </p>
        )}
        {activeTab !== undefined &&
          activeRoom === null &&
          activeRoomError === null && (
            <p data-testid="room-loading">opening room…</p>
          )}
        {activeRoom !== null && (
          <>
            {/* Story 9.11 — the IN-ROOM `＋ open a room` toggle: a convenience entry to open ANOTHER
                room in the project the operator is currently viewing. It routes through the SAME
                project-scoped handler (handleOpenAnnouncements) as the NavTree bucket, so the
                compose panel (rendered at shell level above) targets THIS room's project. The
                room-LESS path (a fresh board with no open room) is served by the NavTree bucket. */}
            <div style={initiateBarStyle} data-testid="open-room-bar-inroom">
              <button
                type="button"
                data-testid="open-room-toggle"
                disabled={watchingOnly}
                aria-disabled={watchingOnly}
                onClick={
                  watchingOnly
                    ? undefined
                    : () => handleOpenAnnouncements(activeRoom.projectId)
                }
                style={
                  watchingOnly
                    ? initiateButtonDisabledStyle
                    : initiateButtonStyle
                }
              >
                ＋ open a room
              </button>
              {watchingOnly && (
                <span
                  data-testid="open-room-disabled-reason"
                  style={initiateReasonStyle}
                >
                  {watchingOnlyReason}
                </span>
              )}
            </div>
            <RoomView
              room={activeRoom}
              onToggleReaction={handleToggleReaction}
              onRetryPost={handleRetryPost}
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
          </>
        )}
      </main>
    </div>
  );
}
