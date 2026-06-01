// SidebarTreeItem — one mono nav row (Story 9.4).
//
// DESIGN.md components.sidebar-tree-item: mono `tree-item` font, `--space-tree-row-y` (3px)
// vertical padding, the text ramp (`--text` / `--text-dim` / `--text-faint`), the active
// row's `--selection` fill + `inset 2px 0 0 var(--accent)` LEFT RAIL, and the custom glyph
// set rendered as a leading marker:
//   • unread   → `--accent`     (class `nav-glyph-unread`)
//   ° read     → `--text-faint` (class `nav-glyph-read`)
//   ! needs    → `--flag-warm`  (class `nav-glyph-needs`) — warm, NEVER red
//   * announcements (the announcements bucket uses this)
// A room row may carry BOTH an unread/read glyph AND a needs `!` glyph (escalated + unread).
//
// Presentation-only (NFR2 — no core/data-access import). The row is a semantic list item
// with a button-like role hook left for Story 9.10 (full a11y); 9.4 structures the markup
// (role="treeitem", a real <li>) so 9.10 can layer keyboard nav + ARIA without reshaping it.
// React 19 automatic JSX runtime.

import { UnreadBadge } from './UnreadBadge.js';

import type { CSSProperties, ReactNode } from 'react';

/** Which leading read/unread glyph a row shows (rooms only; sections pass `none`). */
export type ReadState = 'unread' | 'read' | 'none';

export interface SidebarTreeItemProps {
  /** The row label (room subject / bucket name). */
  label: ReactNode;
  /** The leading read/unread glyph (`•` accent / `°` faint / nothing). */
  readState?: ReadState;
  /** Whether to also show the `!` NEEDS YOU glyph (flag-warm, never red). */
  needsYou?: boolean;
  /** The activity count; renders the unread badge when > 0. */
  activityCount?: number;
  /** Whether this row is the active selection (2px accent left rail + fill). */
  selected?: boolean;
  /** Indentation depth (rooms sit under a project twisty). */
  depth?: number;
  /** Click handler (room selection / bucket open). */
  onClick?: () => void;
  /** A leading static glyph for non-room rows (e.g. `*` for the announcements bucket). */
  leadingGlyph?: string;
  /** `data-room-id` / `data-project-id` style attributes for DOM-test targeting. */
  dataAttrs?: Record<string, string>;
}

/** Render one mono sidebar nav row with its glyphs, optional badge, and selection rail. */
export function SidebarTreeItem({
  label,
  readState = 'none',
  needsYou = false,
  activityCount = 0,
  selected = false,
  depth = 0,
  onClick,
  leadingGlyph,
  dataAttrs,
}: SidebarTreeItemProps) {
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontFamily: 'var(--tree-item-font)',
    fontSize: 'var(--tree-item-size)',
    fontWeight: 'var(--tree-item-weight)' as CSSProperties['fontWeight'],
    color: 'var(--text)',
    padding: 'var(--space-tree-row-y) var(--space-3)',
    paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-4))`,
    cursor: onClick ? 'pointer' : 'default',
    // The active row: the `--selection` fill + the 2px accent LEFT RAIL (DESIGN.md).
    background: selected ? 'var(--selection)' : 'transparent',
    boxShadow: selected ? 'inset 2px 0 0 var(--accent)' : 'none',
  };

  const className = ['nav-row', selected ? 'nav-row-selected' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      style={rowStyle}
      role="treeitem"
      aria-selected={selected}
      onClick={onClick}
      {...dataAttrs}
    >
      {leadingGlyph !== undefined && (
        <span className="nav-glyph-static" aria-hidden="true">
          {leadingGlyph}
        </span>
      )}
      {readState !== 'none' && (
        <span
          className={
            readState === 'unread' ? 'nav-glyph-unread' : 'nav-glyph-read'
          }
          data-testid="unread-glyph"
          aria-hidden="true"
          style={{
            color:
              readState === 'unread' ? 'var(--accent)' : 'var(--text-faint)',
          }}
        >
          {readState === 'unread' ? '•' : '°'}
        </span>
      )}
      {needsYou && (
        <span
          className="nav-glyph-needs"
          data-testid="needs-you-glyph"
          aria-hidden="true"
          style={{ color: 'var(--flag-warm)' }}
        >
          {'!'}
        </span>
      )}
      <span className="nav-row-label">{label}</span>
      {activityCount > 0 && <UnreadBadge count={activityCount} />}
    </li>
  );
}
