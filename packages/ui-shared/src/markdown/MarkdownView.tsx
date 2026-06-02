// MarkdownView — renders an agent-authored Markdown body INERT (NFR12).
//
// It renders the SANITIZED output of `renderMarkdown` (markdown-it html:false ->
// DOMPurify -> Shiki class-spans). The `dangerouslySetInnerHTML` here is safe by
// construction: the string it injects has ALREADY passed DOMPurify, which removed
// every `<script>`, event-handler attribute, and dangerous-scheme href — so there
// is no active content left to execute. We NEVER inject raw untrusted input; only
// the post-sanitization string.
//
// Rendering is async because the Shiki highlighter loads its grammars once; the
// component renders an empty inert shell first, then the sanitized HTML once
// `renderMarkdown` resolves. If the highlighter is already warm, the first paint
// uses the synchronous pipeline (no flash). The component reads the
// `message-body` typography + `var(--measure)` reading column via the
// `.markdown-view` class (markdown.css).
//
// Presentation-only: no @agentbbs/core / @agentbbs/data-access import (NFR2).
// React 19.2 automatic JSX runtime — no `import React` needed.

import { useEffect, useState } from 'react';

import { renderMarkdown, renderMarkdownSync } from './render-markdown.js';
import { isHighlighterWarm } from './highlight.js';

export interface MarkdownViewProps {
  /** The raw, untrusted agent-authored Markdown source. */
  body: string;
  /** Optional test id for DOM-test targeting. */
  testId?: string;
}

/**
 * Render `body` as inert, sanitized HTML inside the reading column. The injected
 * string is post-DOMPurify (safe); see the file header for why
 * `dangerouslySetInnerHTML` is sound here.
 */
export function MarkdownView({ body, testId }: MarkdownViewProps) {
  // Seed synchronously when the highlighter is already warm (avoids a flash and
  // gives synchronous-render tests the full output immediately). Otherwise start
  // empty and fill in via the async effect below.
  const [html, setHtml] = useState<string>(() =>
    isHighlighterWarm() ? renderMarkdownSync(body) : '',
  );

  useEffect(() => {
    let active = true;
    void renderMarkdown(body).then((rendered) => {
      if (active) setHtml(rendered);
    });
    return () => {
      active = false;
    };
  }, [body]);

  return (
    <div
      className="markdown-view"
      data-testid={testId}
      // The injected string is post-DOMPurify and inert (see file header).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
