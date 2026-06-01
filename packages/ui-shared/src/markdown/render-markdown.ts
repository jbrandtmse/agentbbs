// The inert Markdown rendering pipeline — the marquee NFR12 security surface.
//
//   markdown-it (html: false) -> DOMPurify -> (fenced code already tokenized to
//   Shiki CSS-CLASS spans by the markdown-it `highlight` callback)
//
// Defense in depth, in order:
//   1. markdown-it `html: false` — raw HTML in the agent-authored source is NOT
//      parsed as HTML; it is ESCAPED to text (`<script>` -> `&lt;script&gt;`).
//      First line of defense (verified in the Research-First probe).
//   2. A hardened `validateLink` — only http/https/mailto + safe image `data:`
//      URIs survive as link/image hrefs; `javascript:`/`vbscript:`/`file:`/
//      `data:text/html` are rejected (markdown-it's default already blocks these;
//      we pin an explicit allowlist on top).
//   3. DOMPurify — defense-in-depth over the rendered HTML: an allowlist of the
//      element/attribute set markdown produces, `<script>`/`<style>`/`<iframe>`/
//      `<object>`/`<embed>` forbidden, ALL `on*` event-handler attributes
//      forbidden, and a strict `ALLOWED_URI_REGEXP` so any dangerous-scheme href
//      that somehow reached the DOM is stripped.
//   4. Fenced code is highlighted to CSS-CLASS spans (no inline styles) by
//      `highlight.ts`, so a strict `style-src` CSP (no `unsafe-inline`) holds.
//
// The output is a SANITIZED HTML string safe to inject via React
// `dangerouslySetInnerHTML` (MarkdownView) — it is "dangerous" only by API name;
// every active construct has already been removed by steps 1-3.
//
// Presentation-only: no @agentbbs/core / @agentbbs/data-access import (NFR2).

import MarkdownIt from 'markdown-it';
import createDOMPurify, { type Config, type WindowLike } from 'dompurify';

import { highlightToInertHtmlSync, prewarmHighlighter } from './highlight.js';
import { escapeHtml } from './escape-html.js';

/**
 * Bind DOMPurify to an explicit window-like root rather than relying on an ambient
 * `window` existing at module-load. In the browser AND under happy-dom (tests),
 * `globalThis` carries the DOM globals DOMPurify needs (`DOMParser`, `Node`, …);
 * the factory accepts it directly (verified against dompurify 3.4.7 types — the
 * default export is itself the `(root?: WindowLike) => DOMPurify` factory).
 */
const DOMPurify = createDOMPurify(globalThis as unknown as WindowLike);

/**
 * The SANITIZER allowlist — the exact element + attribute set markdown-it (with
 * `html: false`) produces, plus the code-block chrome our fence renderer emits.
 * Everything not listed is dropped. `script`/`style`/`iframe`/`object`/`embed`/
 * `form`/`input` are NOT in `ALLOWED_TAGS`, so they cannot appear; `on*` handlers
 * and `style`/`srcdoc` are explicitly forbidden as a second guard.
 */
const SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS: [
    // Block + inline prose
    'p',
    'br',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'ul',
    'ol',
    'li',
    'strong',
    'em',
    'del',
    's',
    'a',
    // Code
    'code',
    'pre',
    'span',
    // GFM tables
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  ALLOWED_ATTR: [
    // Links: href only (no target/rel auto-nav behavior is added here — links are
    // inert + scheme-safe; whether/how they open is a later-story concern).
    'href',
    'title',
    // Our code-block + token classes (code-line, code-keyword, …) and GFM table
    // alignment classes. `class` is the ONLY styling hook — never `style`.
    'class',
    // Table cell alignment markdown-it may emit as an attribute.
    'align',
    // A data hook the CodeBlock chrome uses for the language label / expand logic.
    'data-lang',
    'data-code-block',
  ],
  // Forbid the dangerous element + attribute classes outright (belt + suspenders
  // on top of the allowlist).
  FORBID_TAGS: [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'svg',
    'math',
    'link',
    'meta',
    'base',
  ],
  FORBID_ATTR: ['style', 'srcdoc', 'srcset', 'src', 'formaction', 'xlink:href'],
  // Only safe schemes survive as URIs. http(s)/mailto/tel + fragment/relative.
  // (DOMPurify default already blocks javascript:/data:text/html; this pins it.)
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/iu,
  // No data-* attributes beyond the two we allow-listed, and no unknown protocols.
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  // Return a string (the default), which MarkdownView injects post-sanitization.
  RETURN_TRUSTED_TYPE: false,
};

/** Safe URL schemes for the markdown-it `validateLink` override (link + image). */
const SAFE_LINK_SCHEME = /^(?:https?:|mailto:|tel:|#|\/|\.)/iu;
const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);/iu;

/**
 * Build the shared markdown-it instance. `html: false` is the load-bearing flag.
 * `linkify: false` keeps us from auto-linking bare URLs (no surprise live links).
 * GFM tables are on by default in the default preset (verified).
 */
function createRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: false,
    breaks: false,
    typographer: false,
    // Fenced code: tokenize to inert CSS-CLASS spans (sync; highlighter is
    // prewarmed by renderMarkdown before render). Returning a full <pre…> string
    // makes markdown-it skip its own escaping wrapper for this token.
    highlight: (code, lang) => {
      const langClass = lang.trim().toLowerCase();
      const inner = highlightToInertHtmlSync(code, langClass);
      const dataLang = langClass.length > 0 ? escapeHtml(langClass) : '';
      // The CodeBlock component keys off data-code-block + data-lang for chrome
      // (panel, border, ~25-line cap + expand). `pre` carries the inert spans.
      return (
        `<pre class="code-block" data-code-block="true"` +
        (dataLang ? ` data-lang="${dataLang}"` : '') +
        `><code class="code-block-inner">${inner}</code></pre>`
      );
    },
  });

  // Hardened link validation: only safe schemes survive (defense-in-depth on top
  // of html:false + DOMPurify). Anything else returns false -> markdown-it emits
  // the link text WITHOUT an href.
  md.validateLink = (url: string): boolean =>
    SAFE_LINK_SCHEME.test(url.trim()) || SAFE_IMAGE_DATA.test(url.trim());

  return md;
}

const renderer = createRenderer();

/**
 * Render an agent-authored Markdown `body` to a SANITIZED, INERT HTML string.
 *
 * Async: it awaits `prewarmHighlighter()` so the synchronous fence `highlight`
 * callback can tokenize fenced code to class-spans with the loaded highlighter.
 * The returned string has passed markdown-it (html:false) -> DOMPurify and is safe
 * to inject via `dangerouslySetInnerHTML` (every active construct is gone).
 */
export async function renderMarkdown(body: string): Promise<string> {
  await prewarmHighlighter();
  const rawHtml = renderer.render(body ?? '');
  const clean = DOMPurify.sanitize(rawHtml, SANITIZE_CONFIG);
  return typeof clean === 'string' ? clean : String(clean);
}

/**
 * Synchronous variant for callers that have already `await prewarmHighlighter()`.
 * Identical security pipeline; useful inside a React render that preloaded the
 * highlighter (so code blocks still get class-spans, not plain fallback text).
 */
export function renderMarkdownSync(body: string): string {
  const rawHtml = renderer.render(body ?? '');
  const clean = DOMPurify.sanitize(rawHtml, SANITIZE_CONFIG);
  return typeof clean === 'string' ? clean : String(clean);
}
