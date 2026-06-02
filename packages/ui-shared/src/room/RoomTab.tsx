// RoomTab — one open room rendered as an editor tab (Story 9.8 / AC #1; DESIGN
// components.room-tab).
//
// Rooms open as editor tabs (like files); a RoomTab is ONE such tab in the TabStrip.
// Two visual states (DESIGN.md room-tab), driven by `active`:
//   - ACTIVE (the tab whose RoomView is shown): `--surface-base` bg + `--text-strong`
//     + a 2px `--accent` TOP rail (`inset 0 2px 0 var(--accent)`). The leading `•`
//     (`--accent`) shows when `unread`; the trailing `×` (`--text-faint`) is the close glyph.
//   - INACTIVE (a background open tab): `--surface-panel` bg + `--text-dim`. A leading `•`
//     still shows when the background room has unread activity (the SSE-fed unread, Story 9.4
//     delta signal); focusing the tab clears it (the surface owns the clear-on-focus).
// A 1px `--border` divider sits between tabs (rendered by the TabStrip as a left border on
// each tab after the first). The label is the room `identifier` in mono.
//
// WEB-ONLY (DESIGN.md): the leading-`•` / trailing-`×` / 2px top rail are web flourishes — the
// VS Code host renders native tab chrome (title/icon/close) and the webview owns only contents
// (Epic 10). This is the WEB tab strip; the model stays prop-driven for Epic 10 reuse.
//
// AC2 nuance: clicking the `×` fires `onClose(roomId)` — a VIEW-ONLY action (drop the tab from
// the open list). It is NOT a board op: the board has no "leave room" / "un-participate" op
// (membership/participation is append-only + monotonic, Epics 3-5). The surface's `onClose`
// MUST NOT fire any board write. The `×` click is stopped from also firing `onSelect`.
//
// PRESENTATION-ONLY (NFR2): no @agentbbs/core / @agentbbs/data-access import; prop-driven.
// React 19 automatic JSX runtime.

import type { CSSProperties, MouseEvent } from 'react';

/** One open room's tab descriptor (the prop-driven model a tab renders). */
export interface RoomTabModel {
  /** The room's slug id — the tab's identity + the `onSelect`/`onClose` argument. */
  roomId: string;
  /** The label shown on the tab (the room identifier, mono). */
  label: string;
  /** Whether this background tab has unread activity (the leading `•`). Defaults false. */
  unread?: boolean;
}

export interface RoomTabProps {
  /** The tab to render. */
  tab: RoomTabModel;
  /** Whether this tab is the ACTIVE one (its RoomView is shown). */
  active: boolean;
  /** Fired with the room id when the tab body is clicked (focus this tab). */
  onSelect?: (roomId: string) => void;
  /**
   * Fired with the room id when the trailing `×` is clicked — a VIEW-ONLY close (drop the
   * tab). NOT a board op (AC2): the surface MUST NOT fire any board write here.
   */
  onClose?: (roomId: string) => void;
}

/** Render one open room as an editor tab (active vs inactive; unread `•`; close `×`). */
export function RoomTab({ tab, active, onSelect, onClose }: RoomTabProps) {
  const unread = tab.unread ?? false;

  const tabStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: 'var(--space-2) var(--space-4)',
    fontFamily: 'var(--identifier-font)',
    fontSize: 'var(--identifier-size)',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
    // Active = base bg + strong text + a 2px accent TOP rail; inactive = panel bg + dim text.
    background: active ? 'var(--surface-base)' : 'var(--surface-panel)',
    color: active ? 'var(--text-strong)' : 'var(--text-dim)',
    // The 2px accent top rail on the active tab (DESIGN room-tab active-rail). `boxShadow`
    // (inset top) paints the rail without shifting layout; inactive tabs carry none.
    boxShadow: active ? 'inset 0 2px 0 var(--accent)' : 'none',
  };

  const dotStyle: CSSProperties = {
    color: 'var(--accent)',
    fontSize: 'var(--identifier-size)',
    lineHeight: 1,
  };

  const closeStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-faint)',
    cursor: 'pointer',
    fontFamily: 'var(--identifier-font)',
    fontSize: 'var(--identifier-size)',
    lineHeight: 1,
    padding: '0 var(--space-1)',
  };

  function handleClose(ev: MouseEvent): void {
    // The `×` is a VIEW-ONLY close — stop it from also bubbling into the tab's onSelect.
    ev.stopPropagation();
    onClose?.(tab.roomId);
  }

  return (
    <div
      className={active ? 'room-tab room-tab--active' : 'room-tab'}
      data-testid="room-tab"
      data-room-id={tab.roomId}
      data-active={active ? 'true' : 'false'}
      data-unread={unread ? 'true' : 'false'}
      role="tab"
      aria-selected={active}
      style={tabStyle}
      onClick={() => onSelect?.(tab.roomId)}
    >
      {unread && (
        <span
          className="room-tab-unread"
          data-testid="room-tab-unread"
          aria-hidden="true"
          style={dotStyle}
        >
          •
        </span>
      )}
      <span className="room-tab-label" data-testid="room-tab-label">
        {tab.label}
      </span>
      <button
        type="button"
        className="room-tab-close"
        data-testid="room-tab-close"
        aria-label={`Close ${tab.label}`}
        title="Close tab"
        style={closeStyle}
        onClick={handleClose}
      >
        ×
      </button>
    </div>
  );
}
