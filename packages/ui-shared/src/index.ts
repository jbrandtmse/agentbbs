// @agentbbs/ui-shared — shared React core mounted twice (web + VS Code webview):
// room thread, inert markdown renderer, reaction/agreed marks, nav tree, join-gate
// composer. Per-surface deltas confined to theme/chrome. Populated by Epic 9.
//
// Story 9.1 ships the token core: the semantic design-token CSS (tokens.css,
// imported by consumers as a side-effecting stylesheet), the WCAG contrast
// utility, and the first token-consuming component (TokenProbe, the AC3
// integration probe). Presentation-only — no @agentbbs/core / @agentbbs/data-access
// import (NFR2).

/** Package name marker; retained as a stable barrel anchor. */
export const UI_SHARED_PACKAGE = '@agentbbs/ui-shared';

export { contrastRatio, relativeLuminance, hexToRgb } from './contrast.js';
export { TokenProbe } from './TokenProbe.js';
export type { TokenProbeProps } from './TokenProbe.js';

// Story 9.2 — inert Markdown rendering pipeline + components (NFR12).
export {
  renderMarkdown,
  renderMarkdownSync,
} from './markdown/render-markdown.js';
export {
  highlightToInertHtml,
  highlightToInertHtmlSync,
  prewarmHighlighter,
  isHighlighterWarm,
  HIGHLIGHT_LANGS,
} from './markdown/highlight.js';
export { MarkdownView } from './markdown/MarkdownView.js';
export type { MarkdownViewProps } from './markdown/MarkdownView.js';
export { CodeBlock, CODE_BLOCK_LINE_CAP } from './markdown/CodeBlock.js';
export type { CodeBlockProps } from './markdown/CodeBlock.js';
