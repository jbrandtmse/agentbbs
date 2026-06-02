// ConnectionFooter — the quiet sidebar connection-state footer (Story 9.10 / AC1, AC2;
// DESIGN.md components.connection-footer).
//
// A calm, inline footer LED at the bottom of the sidebar:
//   - CONNECTED   → `● connected`     (the `--agreed-green` LED — DESIGN: "the connected LED")
//   - RECONNECTING → `○ reconnecting…` (inline, `--text-dim`)
//
// CALM POSTURE IS THE BRAND (DESIGN Do/Don't): disconnection is an INLINE state change, NEVER
// a modal / blocking dialog — "surface disconnection as a quiet inline 'reconnecting…' — never
// spam modal alerts; the world is pull-only." Already-loaded content stays readable while
// reconnecting; this footer is the ONLY disconnection signal. No alarm, no red.
//
// PROP-DRIVEN + PRESENTATION-ONLY (NFR2): the `status` is computed by the surface from the
// live transport (apps/web maps the `EventSource` open/error to connected/reconnecting). The
// SAME component is reused by the VS Code surface (Epic 10) against a status it builds from
// the host channel. React 19 automatic JSX runtime.

import type { CSSProperties } from 'react';

/** The live transport status the footer renders. */
export type ConnectionStatus = 'connected' | 'reconnecting';

export interface ConnectionFooterProps {
  /** The live connection status (the surface maps the transport to this). */
  status: ConnectionStatus;
}

/**
 * Render the quiet sidebar connection footer: `● connected` (agreed-green LED) when the host
 * channel is open, `○ reconnecting…` (dim, inline) when it is reconnecting. Never a modal.
 */
export function ConnectionFooter({ status }: ConnectionFooterProps) {
  const connected = status === 'connected';

  const footerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontFamily: 'var(--identifier-font)',
    fontSize: 'var(--identifier-size)',
    color: 'var(--text-dim)',
    padding: 'var(--space-2) var(--space-3)',
    borderTop: '1px solid var(--border-soft)',
  };

  // The LED: a filled `●` agreed-green dot when connected, a hollow `○` dim ring when
  // reconnecting. The LED glyph is decorative (the text carries the meaning for SR).
  const ledStyle: CSSProperties = {
    color: connected ? 'var(--agreed-green)' : 'var(--text-dim)',
    flexShrink: 0,
  };

  return (
    <div
      className="connection-footer"
      data-testid="connection-footer"
      data-status={status}
      style={footerStyle}
    >
      <span
        className="connection-footer-led"
        aria-hidden="true"
        style={ledStyle}
      >
        {connected ? '●' : '○'}
      </span>
      <span
        className="connection-footer-label"
        data-testid="connection-footer-label"
      >
        {connected ? 'connected' : 'reconnecting…'}
      </span>
    </div>
  );
}
