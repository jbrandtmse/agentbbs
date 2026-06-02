// CodeBlock — a single fenced code block rendered on the deeper code-panel ground.
//
// Visual contract (DESIGN.md §Components -> code-block): `var(--code-panel)` bg,
// 1px `var(--border)`, `var(--radius-md)` (6px), restrained `--code-*` tints,
// `white-space: pre` (NEVER wraps — wide code horizontally scrolls), capped at
// ~25 lines with internal vertical scroll + an EXPAND affordance that reveals the
// rest in place ("a single tall snippet must not swallow the room"). The cap +
// expand are class-driven (markdown.css `.code-block` / `.code-block--expanded`);
// no inline styles (NFR12 strict style-src).
//
// Syntax highlighting is the SAME inert class-span pipeline as the prose path
// (`highlight.ts`): tokens become CSS-CLASS spans, never inline `style`/`color`,
// and every token's text is HTML-escaped (code shown as TEXT). The injected
// inner-HTML is built by us from escaped token text + class names only, so it is
// inert by construction (no DOMPurify needed for OUR generated spans — they can
// contain no tag the escaper did not neutralize).
//
// Presentation-only: no @agentbbs/core / @agentbbs/data-access import (NFR2).

import { useEffect, useMemo, useState } from 'react';

import { highlightToInertHtml, highlightToInertHtmlSync } from './highlight.js';

/** Lines beyond this trigger the expand affordance (the ~25-line cap). */
export const CODE_BLOCK_LINE_CAP = 25;

export interface CodeBlockProps {
  /** The raw code (already extracted from the fence; shown as text). */
  code: string;
  /** Optional language hint (e.g. "typescript"); unknown langs fall back to plain. */
  lang?: string;
  /** Optional test id for DOM-test targeting. */
  testId?: string;
}

/**
 * Render a single code block with the code-panel chrome + expand affordance. Wide
 * code scrolls horizontally; tall code (> ~25 lines) is capped with internal
 * scroll until expanded.
 */
export function CodeBlock({ code, lang, testId }: CodeBlockProps) {
  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const overflowsCap = lineCount > CODE_BLOCK_LINE_CAP;
  const [expanded, setExpanded] = useState(false);

  // Seed synchronously (warm highlighter -> tinted; cold -> plain escaped text),
  // then upgrade to the fully-tokenized output once the highlighter resolves.
  const [innerHtml, setInnerHtml] = useState<string>(() =>
    highlightToInertHtmlSync(code, lang),
  );

  useEffect(() => {
    let active = true;
    void highlightToInertHtml(code, lang).then((html) => {
      if (active) setInnerHtml(html);
    });
    return () => {
      active = false;
    };
  }, [code, lang]);

  const preClass = expanded ? 'code-block code-block--expanded' : 'code-block';

  return (
    <div className="code-block-wrap" data-testid={testId}>
      <pre
        className={preClass}
        data-code-block="true"
        data-lang={lang ? lang.trim().toLowerCase() : undefined}
      >
        <code
          className="code-block-inner"
          // inner-HTML is our own escaped token text + class names only (see header).
          dangerouslySetInnerHTML={{ __html: innerHtml }}
        />
      </pre>
      {overflowsCap ? (
        <button
          type="button"
          className="code-block-expand"
          data-testid={testId ? `${testId}-expand` : undefined}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Collapse' : `Expand (${lineCount} lines)`}
        </button>
      ) : null}
    </div>
  );
}
