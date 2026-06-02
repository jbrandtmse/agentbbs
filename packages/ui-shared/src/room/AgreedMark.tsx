// AgreedMark — the computed `✓ agreed` mark (Story 9.6 / AC #2, FR21).
//
// A small `✓ agreed` tag in `--agreed-green` (mono identifier font), per DESIGN.md
// components.agreed-mark. It marks the message the room CONVERGED on — the CURRENT CONTRACT
// (the highest-`seq` message currently holding a live 👍, computed via `readContract` /
// `/api/rooms/:id/contract`). It is COMPUTED, NEVER a stored flag: the surface re-derives
// which message carries the mark on every 👍 change, so the mark MOVES to a higher-`seq`
// message that gains the contract and DISAPPEARS when all live 👍s retract (THE APPEND
// INVARIANT / FR21).
//
// Rendered TWICE on the converged post (DESIGN.md): a mirror in the message HEAD and the
// canonical mark in the FOOTER beside the 👍. This component is the tag itself; MessagePost
// decides WHICH post is converged (from the `agreed` prop the surface computes) and places a
// mark in both slots.
//
// PRESENTATION-ONLY (NFR2): no @agentbbs/core / @agentbbs/data-access import; prop-driven.
// React 19 automatic JSX runtime.

import type { CSSProperties } from 'react';

export interface AgreedMarkProps {
  /**
   * Where this mark sits — `head` (the message-head mirror) or `footer` (beside the 👍).
   * Distinguishes the two placements in the DOM (testids/classes); purely cosmetic.
   */
  placement: 'head' | 'footer';
}

/** Render the `✓ agreed` mark in agreed-green (mono). Placement is cosmetic (head/footer). */
export function AgreedMark({ placement }: AgreedMarkProps) {
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    fontFamily: 'var(--identifier-font)',
    fontSize: 'var(--identifier-size)',
    color: 'var(--agreed-green)',
    whiteSpace: 'nowrap',
  };

  return (
    <span
      className={`agreed-mark agreed-mark--${placement}`}
      data-testid={`agreed-mark-${placement}`}
      data-placement={placement}
      style={style}
    >
      <span aria-hidden="true">✓</span>
      <span>agreed</span>
    </span>
  );
}
