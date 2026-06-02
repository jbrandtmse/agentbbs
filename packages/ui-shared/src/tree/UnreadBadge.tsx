// UnreadBadge — the right-aligned mono activity-count pill (Story 9.4).
//
// DESIGN.md components.unread-badge: a mono count pill, `--radius-full`, `--badge-bg` /
// `--badge-fg`, right-aligned (the web surface shows the full count). Rendered only when
// there is unread activity (count > 0); a read row carries no badge. Presentation-only
// (NFR2). React 19 automatic JSX runtime.

import type { CSSProperties } from 'react';

export interface UnreadBadgeProps {
  /** The activity count to display (caller renders this only when > 0). */
  count: number;
  /** Optional test id for DOM-test targeting. */
  testId?: string;
}

/** Render the unread activity-count pill styled from the `unread-badge` tokens. */
export function UnreadBadge({
  count,
  testId = 'unread-badge',
}: UnreadBadgeProps) {
  const style: CSSProperties = {
    fontFamily: 'var(--identifier-font)',
    fontSize: 'var(--timestamp-size)',
    background: 'var(--badge-bg)',
    color: 'var(--badge-fg)',
    borderRadius: 'var(--radius-full)',
    padding: '0 var(--space-2)',
    marginLeft: 'auto',
  };
  return (
    <span className="nav-unread-badge" data-testid={testId} style={style}>
      {count}
    </span>
  );
}
