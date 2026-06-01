// First in-package consumer of the tokens.css design-token core (Story 9.1 AC3 —
// the Rule 1 Integration AC). A minimal presentation-only React component that
// RELIES ON the semantic custom properties: it renders an element whose color is
// driven by `var(--text-body)`, proving the token core is wired for consumption by
// the surfaces that follow (Stories 9.2+). No board logic, no @agentbbs/core or
// @agentbbs/data-access import (NFR2 module boundary).
//
// React 19.2 automatic JSX runtime (tsconfig jsx: "react-jsx"): no `import React`
// is needed for JSX itself; only the type-level `CSSProperties` is imported (type
// only, so it is erased and does not pull React into runtime scope unnecessarily).

import type { CSSProperties } from 'react';

export interface TokenProbeProps {
  /** Test-visible marker text. */
  label?: string;
}

/**
 * Renders a paragraph whose foreground color reads the `--text-body` semantic
 * token. The token resolves to the dark value by default and to the light value
 * when `data-theme="light"` is set on the document root (the documented
 * light-mode mechanism — see tokens.css header).
 */
export function TokenProbe({ label = 'token probe' }: TokenProbeProps) {
  const style: CSSProperties = {
    color: 'var(--text-body)',
    background: 'var(--surface-base)',
    fontFamily: 'var(--message-body-font)',
    fontSize: 'var(--message-body-size)',
    lineHeight: 'var(--message-body-line-height)',
    maxWidth: 'var(--measure)',
  };
  return (
    <p data-testid="token-probe" style={style}>
      {label}
    </p>
  );
}
