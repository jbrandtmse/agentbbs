// ReactionChip — the per-message 👍 pill (Story 9.6 / AC #1, FR21).
//
// A pill chip (`--radius-full`) rendering `👍 + count` in the post FOOTER (DESIGN.md
// components.thumbs-up). Two visual states, driven by `reacted` (whether the OPERATOR
// currently holds a live 👍 on this message — the "latest-currently-👍'd-wins" state of
// FR21):
//   - RESTING (not currently-👍'd): `--chip-bg` + 1px `--border` + `--text-dim`.
//   - CURRENTLY-👍'd: a green-tinted bg (`rgba(78,192,122,0.13)`) + `--agreed-line` border
//     + brighter `--text`.
// One click toggles: it calls `onToggle` (the surface decides react-vs-unreact from the
// current `reacted` state + fires the write). Reconciliation/optimism is Story 9.9 — this
// component is prop-driven and stateless (the surface refetches + re-renders the new count).
//
// PARTICIPATION GATE (the WRITE side): `canReact` reflects whether the operator may toggle
// (a participant of the room — else the core write would throw NOT_A_MEMBER). When
// `!canReact` the chip renders DISABLED with a "join to react" hand-off affordance (Story
// 9.7 owns the actual join flow) and does NOT fire `onToggle` — so a non-participant never
// triggers a doomed write. The READ side (the count + the resting/👍'd display) is OPEN: the
// chip RENDERS for any operator regardless of `canReact`.
//
// GREEN-TINT HIGH-CONTRAST GATE (DESIGN.md): the green tint is gated behind a non-HC check.
// There is no high-contrast infrastructure yet (Story 9.10 owns the a11y floor), so for the
// web V1 the default is non-HC (`highContrast={false}`) and the tint renders; a future HC
// consumer passes `highContrast` to fall back to a solid border instead of the wash. Noted
// per the story (web is fine for V1).
//
// PRESENTATION-ONLY (NFR2): no @agentbbs/core / @agentbbs/data-access import; prop-driven.
// React 19 automatic JSX runtime.

import type { CSSProperties } from 'react';

/** The currently-👍'd green-tint background (DESIGN.md thumbs-up.has-bg). */
export const REACTION_CHIP_HAS_BG = 'rgba(78,192,122,0.13)';

export interface ReactionChipProps {
  /** The LIVE 👍 count (the number of reactors currently holding a 👍 on the message). */
  count: number;
  /**
   * Whether the OPERATOR currently holds a live 👍 on this message — the FR21
   * "currently-👍'd" state. Drives the resting-vs-👍'd visual + the toggle direction.
   */
  reacted: boolean;
  /**
   * Whether the operator MAY toggle (a room participant). When `false`, the chip is the
   * disabled "join to react" hand-off (Story 9.7) and `onToggle` never fires.
   */
  canReact: boolean;
  /**
   * Fired on a one-click toggle when `canReact`. The surface reads the current `reacted`
   * to decide react-vs-unreact and fires the write (then refetches — Story 9.9 adds
   * optimism). Not fired when `!canReact`.
   */
  onToggle?: () => void;
  /**
   * High-contrast mode (DESIGN.md): when `true`, the currently-👍'd state drops the green
   * WASH for a solid border only. Defaults to `false` (web V1 is non-HC — the tint renders).
   */
  highContrast?: boolean;
}

/**
 * Render the per-message 👍 reaction chip. A participant operator sees a live, one-click
 * toggle (resting vs currently-👍'd); a non-participant sees the disabled "join to react"
 * hand-off (Story 9.7). The count + state are prop-driven (the surface refetches after a
 * write).
 */
export function ReactionChip({
  count,
  reacted,
  canReact,
  onToggle,
  highContrast = false,
}: ReactionChipProps) {
  // The currently-👍'd state tints green (unless HC → solid border, no wash); resting is
  // the calm chip-bg + faint border. The data-state attribute is the test/assert seam.
  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--radius-full)',
    fontFamily: 'var(--identifier-font)',
    fontSize: 'var(--identifier-size)',
    lineHeight: 1,
    cursor: canReact ? 'pointer' : 'not-allowed',
    background: 'transparent',
  };

  const restingStyle: CSSProperties = {
    ...baseStyle,
    background: 'var(--chip-bg)',
    // Longhand border (not the shorthand) so the design-token var survives a DOM readback.
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text-dim)',
  };

  const reactedStyle: CSSProperties = {
    ...baseStyle,
    // The green wash is gated behind non-HC (DESIGN.md); HC falls back to chip-bg + the
    // solid agreed-line border so the state still reads without relying on the wash.
    background: highContrast ? 'var(--chip-bg)' : REACTION_CHIP_HAS_BG,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--agreed-line)',
    color: 'var(--text)',
  };

  // The non-participant hand-off: a disabled chip that invites joining (Story 9.7 wires the
  // actual join). It still shows the live count (open read) but cannot toggle.
  if (!canReact) {
    return (
      <button
        type="button"
        className="reaction-chip reaction-chip--cannot-react"
        data-testid="reaction-chip"
        data-state="cannot-react"
        data-reacted={reacted ? 'true' : 'false'}
        disabled
        aria-disabled="true"
        title="Join the room to react (Story 9.7)"
        style={{ ...restingStyle, opacity: 0.6 }}
      >
        <span aria-hidden="true">👍</span>
        <span className="reaction-chip-count" data-testid="reaction-chip-count">
          {count}
        </span>
        <span className="reaction-chip-join-hint">join to react</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={
        reacted
          ? 'reaction-chip reaction-chip--reacted'
          : 'reaction-chip reaction-chip--resting'
      }
      data-testid="reaction-chip"
      data-state={reacted ? 'reacted' : 'resting'}
      data-reacted={reacted ? 'true' : 'false'}
      aria-pressed={reacted}
      onClick={onToggle}
      style={reacted ? reactedStyle : restingStyle}
    >
      <span aria-hidden="true">👍</span>
      <span className="reaction-chip-count" data-testid="reaction-chip-count">
        {count}
      </span>
    </button>
  );
}
