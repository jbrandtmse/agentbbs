// NeedsYouItem — one row in the pinned NEEDS YOU escalation section (Story 9.4 / AC #3).
//
// DESIGN.md components.needs-you-item: the `!` icon reads `--flag-warm`, the text reads
// `--flag-warm-text`; the `(n)` lives on the section label. WARM, NEVER RED — this is the
// deliberate inversion of the old time-based FR30: a human was EXPLICITLY pulled in
// (add_participant). It is a healthy "you're wanted here", not an alarm; red would read as
// an error/danger, which is exactly the wrong signal (EXPERIENCE.md — quiet is healthy, a
// flag is an invitation). NEVER use a red/danger color anywhere in this component.
//
// Presentation-only (NFR2). Clicking selects the escalated room (handed the room id).
// React 19 automatic JSX runtime.

import type { CSSProperties } from 'react';

export interface NeedsYouItemProps {
  /** The escalated room's id (the click target / data attr). */
  roomId: string;
  /** The escalated room's subject (the visible label). */
  subject: string;
  /** Click handler — selects the escalated room. */
  onClick?: () => void;
}

/** Render one NEEDS YOU row — flag-warm `!` icon + warm text. Never red. */
export function NeedsYouItem({ roomId, subject, onClick }: NeedsYouItemProps) {
  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontFamily: 'var(--tree-item-font)',
    fontSize: 'var(--tree-item-size)',
    // The row TEXT reads --flag-warm-text (DESIGN.md). Never a red literal.
    color: 'var(--flag-warm-text)',
    padding: 'var(--space-tree-row-y) var(--space-3)',
    cursor: onClick ? 'pointer' : 'default',
  };
  return (
    <li
      className="nav-needs-you-item"
      data-testid="needs-you-item"
      data-room-id={roomId}
      role="treeitem"
      style={style}
      onClick={onClick}
    >
      <span
        className="nav-glyph-needs"
        data-testid="needs-you-icon"
        aria-hidden="true"
        // The icon reads --flag-warm (DESIGN.md). Never red.
        style={{ color: 'var(--flag-warm)' }}
      >
        {'!'}
      </span>
      <span className="nav-needs-you-subject">{subject}</span>
    </li>
  );
}
