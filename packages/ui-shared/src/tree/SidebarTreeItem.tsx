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
// Presentation-only (NFR2 — no core/data-access import). The row is a semantic
// `role="treeitem"` <li> within the NavTree's `role="tree"`. Story 9.10 layers the a11y
// floor: a ROVING TABINDEX (`tabIndex` is 0 for the one active row, -1 otherwise), an
// `onKeyDown` for APG arrow-key traversal, an `aria-label` so a screen reader announces the
// row meaningfully, and a `data-tree-id` for the roving-focus DOM lookup. The visible focus
// ring (AA, ≥3:1) is the `.nav-row:focus-visible` rule in tree.css. React 19 automatic JSX
// runtime.

import { UnreadBadge } from './UnreadBadge.js';

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from 'react';

/** Which leading read/unread glyph a row shows (rooms only; sections pass `none`). */
export type ReadState = 'unread' | 'read' | 'none';

export interface SidebarTreeItemProps {
  /** The row label (room subject / bucket name). */
  label: ReactNode;
  /** The leading read/unread glyph (`•` accent / `°` faint / nothing). */
  readState?: ReadState;
  /**
   * Story 9.14 — whether this row is a PROTO-ROOM (an announced, not-yet-activated room:
   * `active:false`). When true the row renders VISUALLY DISTINCT as pending/unanswered: a
   * leading `°` pending marker (in the faint/dim ramp) REPLACES the read/unread glyph, and the
   * label is dimmed — so an unanswered negotiation reads differently from an active room. The
   * row stays a real, selectable `treeitem` (opening it shows the announcement; replying
   * activates it). Default `false`.
   */
  pending?: boolean;
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
  /**
   * Story 9.10 a11y — the roving-tabindex value: `0` for the ONE active row in the tree, `-1`
   * for every other row (the WAI-ARIA tree pattern). Default `-1`.
   */
  tabIndex?: number;
  /** Story 9.10 a11y — the row's stable id for the tree's roving-focus DOM lookup. */
  treeId?: string;
  /** Story 9.10 a11y — the tree's shared key handler (APG arrow-key traversal). */
  onKeyDown?: (event: ReactKeyboardEvent) => void;
  /**
   * Story 9.10 a11y — the screen-reader label announcing the row (e.g. the room id + its
   * read/needs-you state). Falls back to the visible label text when omitted.
   */
  ariaLabel?: string;
}

/** Render one mono sidebar nav row with its glyphs, optional badge, and selection rail. */
export function SidebarTreeItem({
  label,
  readState = 'none',
  pending = false,
  needsYou = false,
  activityCount = 0,
  selected = false,
  depth = 0,
  onClick,
  leadingGlyph,
  dataAttrs,
  tabIndex = -1,
  treeId,
  onKeyDown,
  ariaLabel,
}: SidebarTreeItemProps) {
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontFamily: 'var(--tree-item-font)',
    fontSize: 'var(--tree-item-size)',
    fontWeight: 'var(--tree-item-weight)' as CSSProperties['fontWeight'],
    // Story 9.14 — a PROTO-ROOM (pending/unanswered) row reads dimmer than an active room.
    color: pending ? 'var(--text-dim)' : 'var(--text)',
    padding: 'var(--space-tree-row-y) var(--space-3)',
    paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-4))`,
    cursor: onClick ? 'pointer' : 'default',
    // The active row: the `--selection` fill + the 2px accent LEFT RAIL (DESIGN.md).
    background: selected ? 'var(--selection)' : 'transparent',
    boxShadow: selected ? 'inset 2px 0 0 var(--accent)' : 'none',
  };

  const className = [
    'nav-row',
    selected ? 'nav-row-selected' : '',
    pending ? 'nav-row-pending' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      style={rowStyle}
      role="treeitem"
      aria-selected={selected}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      data-tree-id={treeId}
      onClick={onClick}
      onKeyDown={onKeyDown}
      {...dataAttrs}
    >
      {leadingGlyph !== undefined && (
        <span className="nav-glyph-static" aria-hidden="true">
          {leadingGlyph}
        </span>
      )}
      {/* Story 9.14 — a PROTO-ROOM shows the distinct `°` pending marker (faint ramp) in place
          of the read/unread glyph: it is unanswered, so the read/unread axis does not apply. */}
      {pending && (
        <span
          className="nav-glyph-pending"
          data-testid="pending-glyph"
          aria-hidden="true"
          style={{ color: 'var(--text-faint)' }}
        >
          {'°'}
        </span>
      )}
      {!pending && readState !== 'none' && (
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
