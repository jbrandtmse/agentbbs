// Minimal, dependency-free HTML-text escaper for emitting code-token TEXT inside
// our own class-spans (highlight.ts). Code is shown as TEXT, never executed: every
// character that is special in HTML text/attribute context is entity-encoded, so a
// token whose content is literally `<script>` becomes `&lt;script&gt;` and can
// never re-open a tag. This is NOT a sanitizer — DOMPurify (render-markdown.ts) is
// the sanitizer for the prose path; this is the escaper for the syntax-token path,
// where we build the markup ourselves and must not let token content break out.
//
// Presentation-only: no @agentbbs/core / @agentbbs/data-access import (NFR2).

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Entity-encode the five HTML-significant characters. `&` first (handled by the regex). */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
