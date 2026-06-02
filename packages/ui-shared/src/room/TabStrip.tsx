// TabStrip — the horizontal strip of open-room editor tabs (Story 9.8 / AC #1; DESIGN
// components.room-tab).
//
// Rooms open as editor tabs side-by-side (like files). The TabStrip renders the ordered list
// of OPEN rooms as RoomTabs, one ACTIVE (its RoomView is shown), the rest inactive. A 1px
// `--border` divider sits between tabs (a left border on every tab after the first). Clicking
// a tab fires `onSelect(roomId)` (focus it); clicking a tab's `×` fires `onClose(roomId)` (a
// VIEW-ONLY drop — never a board op, AC2).
//
// The strip itself sits on `--surface-panel` (the chrome step off the base) so inactive tabs
// blend into it and the active tab (base bg + accent rail) reads as the foreground document.
// When no rooms are open the strip renders nothing (the surface shows its empty placeholder).
//
// WEB-ONLY (DESIGN.md): the web tab strip with its leading-• / trailing-× / accent rail. The
// VS Code host renders native editor tabs (Epic 10); this model stays prop-driven for reuse.
//
// PRESENTATION-ONLY (NFR2): no @agentbbs/core / @agentbbs/data-access import; prop-driven.
// React 19 automatic JSX runtime.

import { RoomTab } from './RoomTab.js';

import type { RoomTabModel } from './RoomTab.js';
import type { CSSProperties } from 'react';

export interface TabStripProps {
  /** The ordered list of OPEN room tabs (rendered side-by-side, left to right). */
  tabs: RoomTabModel[];
  /** The ACTIVE room id (the tab whose RoomView is shown). `null` → no active tab. */
  activeRoomId: string | null;
  /** Fired with the room id when a tab is clicked (focus it). */
  onSelect?: (roomId: string) => void;
  /**
   * Fired with the room id when a tab's `×` is clicked — a VIEW-ONLY close. NOT a board op
   * (AC2): the surface MUST NOT fire any board write here.
   */
  onClose?: (roomId: string) => void;
}

/** Render the ordered strip of open-room editor tabs (1px divider between tabs). */
export function TabStrip({
  tabs,
  activeRoomId,
  onSelect,
  onClose,
}: TabStripProps) {
  if (tabs.length === 0) return null;

  const stripStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    background: 'var(--surface-panel)',
    overflowX: 'auto',
  };

  return (
    <div
      className="tab-strip"
      data-testid="tab-strip"
      role="tablist"
      style={stripStyle}
    >
      {tabs.map((tab, index) => (
        <div
          key={tab.roomId}
          // The 1px --border divider between tabs (a left border on every tab after the first).
          style={
            index > 0 ? { borderLeft: '1px solid var(--border)' } : undefined
          }
        >
          <RoomTab
            tab={tab}
            active={tab.roomId === activeRoomId}
            onSelect={onSelect}
            onClose={onClose}
          />
        </div>
      ))}
    </div>
  );
}
