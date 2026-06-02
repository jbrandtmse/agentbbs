// SectionLabel — an UPPERCASE, letter-spaced tree section header (Story 9.4).
//
// DESIGN.md components.section-label: UI font 10.5px, weight 600, letter-spacing 0.9px,
// UPPERCASE. Used for the `NEEDS YOU (n)` header and each project name. Presentation-only
// (NFR2). React 19 automatic JSX runtime — no `import React`.

import type { CSSProperties, ReactNode } from 'react';

export interface SectionLabelProps {
  /** The label content (already the human text; CSS upper-cases it). */
  children: ReactNode;
  /** Optional test id for DOM-test targeting. */
  testId?: string;
  /** Optional color token override (e.g. flag-warm-text for NEEDS YOU). */
  color?: string;
}

/** Render a tree section header styled from the `section-label` tokens. */
export function SectionLabel({ children, testId, color }: SectionLabelProps) {
  const style: CSSProperties = {
    fontFamily: 'var(--section-label-font)',
    fontSize: 'var(--section-label-size)',
    fontWeight: 'var(--section-label-weight)' as CSSProperties['fontWeight'],
    letterSpacing: 'var(--section-label-letter-spacing)',
    textTransform: 'uppercase',
    color: color ?? 'var(--text-dim)',
  };
  return (
    <div className="nav-section-label" data-testid={testId} style={style}>
      {children}
    </div>
  );
}
