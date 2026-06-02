// Shiki syntax highlighting emitted as CSS-CLASS spans — never inline styles.
//
// NFR12 + strict style-src: an in-webview highlighter that needs `unsafe-inline`
// or `unsafe-eval` is FORBIDDEN. Shiki's default `codeToHtml` emits
// `style="color:#..."` on every span — also forbidden here. Instead we tokenize
// with `codeToTokens(..., { includeExplanation: true })` (verified sync method on
// the shiki 4.1.0 Highlighter — see the story's Research-First notes) and CLASSIFY
// each token by its TextMate scope into one of the four DESIGN.md code tints
// (`code-keyword`/`code-type`/`code-fn`/`code-comment`). We then build the spans
// OURSELVES carrying `class=` ONLY — no `style=`, no `color`, no shiki-generated
// color classes. The actual color comes from the `markdown.css` `.code-*` rules,
// which read the `tokens.css` `--code-*` custom properties; so a strict
// `style-src` CSP (no `unsafe-inline`) holds. The shiki token COLOR is discarded.
//
// The highlighter init is async (grammars/themes load once); tokenization is then
// synchronous. `prewarmHighlighter()` lets a consumer preload before first render;
// `highlightToInertHtml` awaits the singleton on demand. Either way the security
// posture is identical: classes, not inline styles.
//
// Presentation-only: no @agentbbs/core / @agentbbs/data-access import (NFR2).

import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from 'shiki';

import { escapeHtml } from './escape-html.js';

/**
 * The bundled grammars preloaded into the singleton highlighter. Kept to a small,
 * common set so the bundle stays lean; an unknown/unlisted language falls back to
 * plain (escaped, unclassed) text rather than failing.
 */
export const HIGHLIGHT_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'python',
  'bash',
  'shell',
  'sql',
  'css',
  'html',
  'markdown',
  'yaml',
  'rust',
  'go',
  'java',
  'c',
  'cpp',
  'diff',
] as const;

/**
 * The single dark theme used purely as the TOKENIZER's scope→token oracle. Its
 * COLORS are discarded (we emit classes, not colors); only the TextMate scope
 * classification it drives matters, so one theme suffices for both light and dark
 * surfaces (the `.code-*` classes re-tint per `data-theme` via tokens.css).
 */
const TOKENIZER_THEME = 'dark-plus';

/** The four restrained code tints from DESIGN.md / tokens.css. */
type CodeClass =
  | 'code-keyword'
  | 'code-type'
  | 'code-fn'
  | 'code-comment'
  | null;

let highlighterPromise: Promise<Highlighter> | undefined;
let highlighterReady: Highlighter | undefined;

/**
 * Lazily create (once) the shared singleton highlighter with the bundled langs +
 * the tokenizer theme. Idempotent: concurrent callers share one in-flight promise.
 */
function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise === undefined) {
    highlighterPromise = createHighlighter({
      themes: [TOKENIZER_THEME],
      langs: [...HIGHLIGHT_LANGS],
    }).then((hl) => {
      highlighterReady = hl;
      return hl;
    });
  }
  return highlighterPromise;
}

/**
 * Preload the highlighter (grammars + theme) so subsequent SYNC tokenization
 * (`highlightToInertHtmlSync`, used inside markdown-it's sync `highlight` callback)
 * has no init latency. Optional but required before the sync path; safe to call
 * more than once. Resolves when ready.
 */
export async function prewarmHighlighter(): Promise<void> {
  await getHighlighter();
}

/**
 * Map a token's TextMate scopes (most-specific last) to one of the four code
 * tints, or `null` for plain (unclassed) text. The classification is intentionally
 * coarse + restrained (DESIGN.md "restrained VS Code syntax tints"): we tint
 * keywords/storage/control, types/constants/numbers, functions, and comments only;
 * everything else (identifiers, punctuation, operators, plain strings) renders in
 * the default `--text-body` ground with no tint.
 */
function classifyScopes(scopes: readonly string[]): CodeClass {
  // Walk most-specific first (the last scope is the innermost match).
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const s = scopes[i];
    if (s.startsWith('comment')) return 'code-comment';
    if (
      s.startsWith('keyword') ||
      s.startsWith('storage') ||
      s.startsWith('keyword.control') ||
      s.startsWith('variable.language') // this/self/super
    ) {
      return 'code-keyword';
    }
    if (
      s.startsWith('entity.name.function') ||
      s.startsWith('support.function') ||
      s.startsWith('meta.function-call') ||
      s.startsWith('variable.function')
    ) {
      return 'code-fn';
    }
    if (
      s.startsWith('entity.name.type') ||
      s.startsWith('entity.name.class') ||
      s.startsWith('support.type') ||
      s.startsWith('support.class') ||
      s.startsWith('constant.numeric') ||
      s.startsWith('constant.language') || // true/false/null
      s.startsWith('variable.other.constant')
    ) {
      return 'code-type';
    }
  }
  return null;
}

/** All TextMate scope names attached to a token, outermost→innermost. */
function tokenScopes(
  explanation: { scopes: { scopeName: string }[] }[],
): string[] {
  return explanation.flatMap((e) => e.scopes.map((sc) => sc.scopeName));
}

/** Emit plain escaped text, one `code-line` span per line, no token tints. Inert. */
function plainInertHtml(code: string): string {
  return code
    .split('\n')
    .map((line) => `<span class="code-line">${escapeHtml(line)}</span>`)
    .join('\n');
}

/** Type-guard: `lang` (normalized) has a bundled grammar in the singleton. */
function isKnownLang(
  normalizedLang: string,
): normalizedLang is BundledLanguage {
  return (
    normalizedLang.length > 0 &&
    (HIGHLIGHT_LANGS as readonly string[]).includes(normalizedLang)
  );
}

/**
 * Tokenize with the (already-loaded) highlighter and build the inert class-span
 * HTML. The output carries `class=` attributes ONLY — never `style=`/`color`.
 * Every token's text is HTML-escaped (code is shown as TEXT, never executed).
 */
function emitInertHtml(
  highlighter: Highlighter,
  code: string,
  // Always a member of HIGHLIGHT_LANGS (guarded by isKnownLang at every call site),
  // which are all valid bundled grammars.
  normalizedLang: BundledLanguage,
): string {
  const { tokens } = highlighter.codeToTokens(code, {
    lang: normalizedLang,
    theme: TOKENIZER_THEME,
    includeExplanation: true,
  });

  return tokens
    .map((line) => {
      const inner = line
        .map((tok) => {
          const text = escapeHtml(tok.content);
          const cls = classifyScopes(tokenScopes(tok.explanation ?? []));
          // FontStyle bit flags (const enum erased at runtime): 1=italic, 2=bold.
          // We map ONLY to classes — never inline style — keeping NFR12 strict.
          const styleClasses: string[] = [];
          const fs = tok.fontStyle ?? 0;
          if ((fs & 1) !== 0) styleClasses.push('code-italic');
          if ((fs & 2) !== 0) styleClasses.push('code-bold');
          const classList = [cls, ...styleClasses].filter(
            (c): c is string => c !== null,
          );
          if (classList.length === 0) return text;
          return `<span class="${classList.join(' ')}">${text}</span>`;
        })
        .join('');
      return `<span class="code-line">${inner}</span>`;
    })
    .join('\n');
}

/**
 * SYNC tokenize → inert class-span HTML. Requires `prewarmHighlighter()` to have
 * resolved first (the highlighter must already be loaded); if it is NOT loaded, or
 * the lang is unknown/unbundled, falls back to plain escaped text — still inert.
 * This is the variant markdown-it's synchronous `highlight` callback uses.
 */
export function highlightToInertHtmlSync(code: string, lang?: string): string {
  const normalizedLang = (lang ?? '').trim().toLowerCase();
  if (highlighterReady === undefined || !isKnownLang(normalizedLang)) {
    return plainInertHtml(code);
  }
  return emitInertHtml(highlighterReady, code, normalizedLang);
}

/**
 * ASYNC tokenize → inert class-span HTML. Awaits the singleton highlighter (loads
 * on first call), then tokenizes. An unknown/unbundled `lang` (or none) falls back
 * to plain escaped text with no token classes — still perfectly inert.
 */
export async function highlightToInertHtml(
  code: string,
  lang?: string,
): Promise<string> {
  const normalizedLang = (lang ?? '').trim().toLowerCase();
  if (!isKnownLang(normalizedLang)) {
    return plainInertHtml(code);
  }
  const highlighter = await getHighlighter();
  return emitInertHtml(highlighter, code, normalizedLang);
}

/** True once the singleton highlighter has finished loading (sync path is ready). */
export function isHighlighterWarm(): boolean {
  return highlighterReady !== undefined;
}

/** Reset the cached highlighter — test seam only (lets a test force a re-create). */
export function resetHighlighterForTest(): void {
  highlighterPromise = undefined;
  highlighterReady = undefined;
}
