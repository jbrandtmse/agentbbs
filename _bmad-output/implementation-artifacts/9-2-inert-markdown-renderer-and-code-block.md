---
baseline_commit: 0ff9ac272ffb507d8a9d2a7d205fca52e7cab219
---

# Story 9.2: Inert Markdown renderer and code block

Status: done

<!-- Created by the /epic-cycle Lead Creates Story Files gate (lead-side /bmad-create-story). -->
<!-- Baseline: AGENTBBS-1-epic9 @ 0ff9ac2 (Story 9.1). The marquee NFR12 security story. -->

## Story

As an operator,
I want agent-authored Markdown rendered safely and richly,
so that I can read long-form posts with code/tables without any risk of code execution (NFR12).

## Acceptance Criteria

**AC1 — Inert rendering pipeline (NFR12 core).**
**Given** an agent message body,
**When** it renders,
**Then** it passes through **markdown-it with raw HTML disabled** → **DOMPurify** → **Shiki tokenization emitted as CSS-class spans**, so **no script executes**, **code is shown as text**, and **links are safe** (no auto-navigation / no fetch).

**AC2 — Code block component.**
**Given** a fenced code block,
**When** it renders,
**Then** it sits on the deeper **code-panel** (`var(--code-panel)`) with a **1px border** and **restrained VS Code syntax tints**, **never wraps** (horizontal scroll), and **caps at ~25 lines** with internal scroll + an **expand affordance**,
**And** GFM **tables**, **inline code**, **blockquotes**, **lists**, **bold**, and **links** render per the component spec (DESIGN.md §Components → Markdown rendering inside a post).

**AC3 — Adversarial inert proof (NFR12 + Epic 8 retro Action A).**
**Given** a crafted malicious post (e.g. embedded `<script>`, `<img onerror>`, `javascript:`/`data:` link, event-handler attributes, `<iframe>`, SVG/`<style>` payloads),
**When** it renders,
**Then** **nothing executes** and **no network request is triggered** by the content. This is proven by an **XSS-corpus guard test** (Epic 8 retro Action A; Rule 10) over a corpus of known attack vectors, asserting the rendered output contains no executable script, no event-handler attributes, no dangerous-scheme hrefs, and that no network fetch/navigation is triggered — **mutation-tested non-vacuous** (defeating the sanitizer must turn the corpus test RED).

## Tasks / Subtasks

- [x] **Task 1 — Inert render pipeline** (AC: #1, #3)
  - [x] Add `markdown-it`, `dompurify`, `shiki` deps + `@types/markdown-it` devDep to `packages/ui-shared/package.json` via `catalog:` (pinned: markdown-it ^14.2.0, @types/markdown-it ^14.1.2, dompurify ^3.4.7, shiki ^4.1.0). DOMPurify DOM acquisition verified under happy-dom (Research-First — `createDOMPurify(globalThis)`; `isSupported === true`).
  - [x] Author `src/markdown/render-markdown.ts` (kebab-case module): `renderMarkdown(body): Promise<string>` (+ `renderMarkdownSync`) piping **markdown-it `html: false`** → hardened `validateLink` → **DOMPurify.sanitize** (allowlist; forbids `<script>`/handlers/dangerous schemes; `<a>` kept scheme-safe, no auto-nav) → inert HTML.
  - [x] Syntax highlighting emits **CSS-class spans, NOT inline styles** — `src/markdown/highlight.ts` tokenizes via `codeToTokens(..., { includeExplanation: true })` and classifies each token's TextMate scope into `.code-keyword`/`.code-type`/`.code-fn`/`.code-comment`, building spans with `class=` ONLY (no `style=`/`color`, no shiki color-classes). `@shikijs/transformers` deliberately NOT added (mechanism documented in Research-First notes). `.code-*` CSS rules added in `src/markdown/markdown.css` reading the `tokens.css` `--code-*` tints.
  - [x] Pipeline: async `prewarmHighlighter()` loads grammars once; the markdown-it fence `highlight` callback then tokenizes SYNCHRONOUSLY (`highlightToInertHtmlSync`). Security posture identical either path: classes not inline styles.

- [x] **Task 2 — `MarkdownView` React component + code block** (AC: #1, #2)
  - [x] Author `src/markdown/MarkdownView.tsx` (PascalCase, one per file, no default export) rendering the inert output in the `.markdown-view` reading column (`var(--measure)` + `message-body` typography). Renders only the post-DOMPurify SANITIZED string via `dangerouslySetInnerHTML` (safe — DOMPurify removed all active content; documented in the file header).
  - [x] Author `src/markdown/CodeBlock.tsx`: `var(--code-panel)` ground, 1px `var(--border)`, `var(--radius-md)`, restrained `--code-*` tints, `white-space: pre` (never wraps; `overflow-x:auto`), **~25-line cap** (`CODE_BLOCK_LINE_CAP`) with internal scroll + an **expand affordance** (`.code-block--expanded`).
  - [x] GFM **tables** (default preset, no plugin — verified), **inline code** (mono `--code-inline-bg`, 1px border, `--radius-sm`), **blockquotes** (3px left rail, `--text-dim`), **lists/bold/links** (bold→`--text-strong`, links→`--accent`) — styled in `markdown.css` per DESIGN.md §Components. Table head uses `--badge-bg` (nearest faint panel token; no `--table-head-bg` token exists yet — noted).
  - [x] Export `MarkdownView`, `CodeBlock`, `renderMarkdown`, `renderMarkdownSync`, highlight helpers from `src/index.ts` barrel.

- [x] **Task 3 — XSS-corpus guard (Epic 8 retro Action A; Rule 10)** (AC: #3)
  - [x] Author `src/markdown/render-markdown.xss.test.ts` (happy-dom env via docblock) — a 25-vector CORPUS (raw `<script>`, `<img onerror>`, `<svg onload>`, `javascript:`/`vbscript:`/`data:text/html` hrefs, `<iframe>`/`srcdoc`, `<object>`/`<embed>`, `onclick`/`onmouseover`, `<style>`, `<form formaction>`, `<meta refresh>`, `<base>`, nested-encoding/uppercase/whitespace scheme bypasses, mXSS, markdown `[x](javascript:…)`/`![](javascript:…)`). Assertions PARSE the rendered output into a real DOM (not string-match — escaped text must not false-positive) and verify: no live dangerous element, no `on*` attribute, no dangerous-scheme href/src, code as escaped TEXT, safe links survive.
  - [x] Behavioral inert proof: a planted `globalThis.__xssCanary` is asserted NEVER invoked after injecting the sanitized output into a live DOM node (and no live handler/script in the subtree).
  - [x] **Mutation-tested non-vacuous** two ways: (1) an in-test parallel UNSAFE pipeline (`html:true`, no DOMPurify) trips `assertInert` on >8 vectors (a permanent regression-guard test); (2) MANUAL source mutation documented below — `html:false→true` turned 2 tests RED, then bypassing DOMPurify AND `html:true` turned 20/30 RED; restored byte-identical (source verified intact, 30/30 green).

- [x] **Task 4 — Render-fidelity tests + gate** (AC: #2)
  - [x] DOM tests (`MarkdownView.test.tsx` / `CodeBlock.test.tsx`, happy-dom): fenced code block (class-spans, no inline style, panel chrome, cap/expand toggle), GFM table, inline code, blockquote, list, bold, safe link, unknown-lang fallback, inert raw HTML. Plus `highlight.test.ts` + `render-markdown.test.ts` unit tiers.
  - [x] Honest gate (exact counts below): lint 0 / build 7/7 / typecheck 0 / test 780 passed (111 files) / format `--check` clean. No `.only`/`.skip`/`.todo`.

- [x] **Task 5 — Fold in Story 9.1 LOW 9.1-L1 (React act-env)** (housekeeping)
  - [x] Added `src/test-setup-dom.ts` (`globalThis.IS_REACT_ACT_ENVIRONMENT = true`) wired into the `ui-shared-dom` Vitest project via `setupFiles`. Full suite now runs with NO `act(...)` stderr warning. 9.1-L1 closed in `deferred-work.md` (this story = resolver).

## Dev Notes

### What this story is (and is NOT)

- **IS:** the inert Markdown rendering pipeline (markdown-it html-off → DOMPurify → Shiki class-spans), the `MarkdownView` + `CodeBlock` React components, the full GFM element set, and the **XSS-corpus security guard** that is the load-bearing NFR12 evidence.
- **IS NOT:** the room thread layout, the post header/footer, the 👍 chip, the agreed mark, the tree, the composer, the web host. Those are later stories. 9.2 owns ONLY the body-rendering of one post's Markdown + the security proof. (Story 9.5 assembles posts into a thread and will CONSUME `MarkdownView`.)
- **Consumed-by:** Story 9.5 (room thread) renders each post's body via `MarkdownView`; the renderer is the first feature consumer of the Story 9.1 token core (the `--code-*` tints + `message-body` typography).

### NFR12 is the whole point — the security posture (do not weaken)

1. **markdown-it `html: false`** — raw HTML in the markdown source is NOT parsed as HTML (it is escaped to text). First line of defense.
2. **DOMPurify** — defense-in-depth over the rendered HTML; strips any `<script>`, event-handler attributes, dangerous-scheme URLs, and active elements that slipped through. Configure conservatively (allowlist the markdown-produced element set; forbid the rest).
3. **Shiki → CSS classes, never inline styles** — so a strict `style-src` CSP holds and there is no in-webview highlighter needing `unsafe-inline`/`unsafe-eval`. Map token types to the `--code-*` classes from `tokens.css`.
4. **Links safe** — rendered `<a>` must not auto-navigate or fetch; no `javascript:`/`data:text/html` schemes. (Whether links open at all / in a new tab is a later-story behavior; here they must simply be inert and scheme-safe.)
- The architecture pins this exact stack: "markdown-it (HTML off) → DOMPurify → Shiki (class-based tokens); strict nonce CSP" [architecture.md#Frontend / line 235, 287]. The webview CSP string itself is deferred to the VS Code epic (Epic 10) — but the renderer's class-not-inline-style output is what MAKES a strict CSP possible, so honor it now.

### Research-First triggers (research-first.md / Rule 3) — VERIFY against installed types

- **shiki ^4.1.0** — the highlighter creation API (`createHighlighter` / `getSingletonHighlighter` / the fine-grained `shiki/core` bundle), how to emit **CSS classes instead of inline styles** (`@shikijs/transformers` `transformerStyleToClass`, or `defaultColor: false` + CSS-variable theme, or a custom token→class map). Shiki's DEFAULT is inline styles — confirm the exact v4 mechanism for class output against the installed package. This is the single highest-risk API in the story.
- **markdown-it ^14.2.0** — `new MarkdownIt({ html: false, linkify: ?, … })`; built-in GFM table support (markdown-it has tables in CommonMark-plus by default — confirm); how rendered links are emitted and how to neutralize unsafe schemes (markdown-it has a `validateLink` hook — verify the v14 signature).
- **dompurify ^3.4.7** — `DOMPurify.sanitize(html, config)` config keys for forbidding tags/attributes and URL-scheme policy in v3.4; how it obtains a DOM in a non-browser (it needs a `window`; `createDOMPurify(window)`); confirm it works under the chosen happy-dom/jsdom test env.

### DESIGN.md component specs (the visual contract — already tokenized in 9.1)

- **code-block:** `var(--code-panel)` bg, 1px `var(--border)`, `var(--radius-md)`, fg `var(--text-body)`, tints `.code-keyword`/`.code-type`/`.code-fn`/`.code-comment`, `white-space: pre` (never wrap), `overflow-x: auto`, max-height ~25 lines then internal scroll + expand. "A single tall snippet must not swallow the room."
- **inline-code:** mono, `var(--code-inline-bg)`, 1px `var(--border)`, `var(--radius-sm)`.
- **table:** 1px-bordered cells, UI-font header on a faint head-bg (`#2a2a2c` dark / `#f0f0f0` light — note: not yet a token; either add a `--table-head-bg` token or use the documented literals and flag it), mono in code cells.
- **blockquote:** 3px left rail (`var(--border)` tone), mono, `var(--text-dim)`.
- **lists/bold/links:** standard; bold→`var(--text-strong)`, links→`var(--accent)`.
- [Source: DESIGN.md#Components → "Markdown rendering inside a post"; front-matter `components.code-block`/`inline-code`/`table`/`blockquote`.]

### Source facts to VERIFY (Rule 4)

- Catalog pins markdown-it ^14.2.0, @types/markdown-it ^14.1.2, dompurify ^3.4.7, shiki ^4.1.0 (VERIFIED in `pnpm-workspace.yaml` at baseline). `@shikijs/transformers` is NOT yet in the catalog — if you use it, add it (pin a version aligned with shiki 4).
- `tokens.css` (Story 9.1) defines `--code-panel`, `--code-inline-bg`, `--border`, `--radius-md`/`--radius-sm`, `--text-body`, `--text-strong`, `--accent`, and the `--code-keyword`/`--code-type`/`--code-fn`/`--code-comment` tints — but these are CUSTOM PROPERTIES (color VALUES), not yet CSS CLASSES. You need actual `.code-keyword { color: var(--code-keyword) }` rules (a new `markdown.css` or additions co-located with the renderer) for the Shiki class-spans to pick up the tint. VERIFY the token names against the shipped `tokens.css`.
- happy-dom DOM env + the `ui-shared-dom` vitest project exist (Story 9.1). DOMPurify + DOM-rendering tests run there.
- No `@agentbbs/core`/`data-access` import (module boundary; ui-shared is presentation-only).

### Smoke (lead-side gate — informational)

Strong real-runtime smoke for the SECURITY story: the lead loads a harness rendering `renderMarkdown` output of (a) a rich benign post (code block with tints, GFM table, inline code, blockquote, list, link) and (b) the XSS corpus, in a REAL Chrome (chrome-devtools-mcp), and asserts out-of-band that NO script ran, NO network request was triggered by the content (check the network log / a fetch spy / console errors), code rendered as text, and the code-block class-spans are tinted. This is the production runtime for NFR12 — a real browser, not happy-dom.

### References

- [Source: epics.md#Epic 9 / Story 9.2] — ACs.
- [Source: architecture.md#Frontend Architecture (inert rendering, line 235/287); #Untrusted-content rendering safety (NFR12)].
- [Source: DESIGN.md#Components → Markdown rendering inside a post; front-matter component specs.]
- [Source: EXPERIENCE.md — Message post / Code block / Inline code / Table / Blockquote rows; "renders agent-authored markdown inert".]
- [Source: 9-0-epic-8-deferred-cleanup.md] — Epic 8 retro Action A (XSS-corpus inert-render guard, Rule 10) is owned by THIS story.
- [Source: 9-1-…md Review Findings / deferred-work 9.1-L1] — fold the React act-env fix here.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad dev-story stage, /epic-cycle).

### Research-First findings (Rule 3 — verified against INSTALLED node_modules types + an empirical probe)

Installed versions confirmed: shiki **4.1.0**, markdown-it **14.2.0**, @types/markdown-it **14.1.2**, dompurify **3.4.7** (all match the catalog pins). `@shikijs/transformers` is NOT installed and was deliberately NOT added (see decision below).

**shiki 4.1.0 — class output (the single highest-risk API).** Verified against `node_modules/shiki/dist/bundle-full.d.mts` and `@shikijs/types@4.1.0`:
- `createHighlighter({ themes, langs })` is async → returns a `Highlighter` with a SYNC `codeToTokens(code, { lang, theme, includeExplanation })` returning `TokensResult { tokens: ThemedToken[][] }`.
- `ThemedToken` (extends `TokenStyles` + `TokenBase`) carries `color?: string` (hex), `fontStyle?: FontStyle` (a `const enum`: None=0/Italic=1/Bold=2/Underline=4), and — when `includeExplanation: true` — `explanation[].scopes[].scopeName` (the TextMate scope, e.g. `storage.type.js`, `comment.line.double-slash.js`, `constant.numeric.decimal.js`).
- **Decision (class-not-inline-style, NFR12):** rather than add `@shikijs/transformers` `transformerStyleToClass` (which still maps shiki's hex COLORS into generated classes + needs a `getCSS()` stylesheet of colors), I tokenize with `codeToTokens(..., { includeExplanation: true })` and classify each token by its TextMate scope into one of the four DESIGN.md `.code-*` classes (`code-keyword`/`code-type`/`code-fn`/`code-comment`), then build the spans MYSELF with `class=` ONLY — emitting **NO `style=`/`color` attribute at all** and NO shiki-generated color classes. This is the strictest NFR12 posture (zero inline style, zero unsafe-inline need) AND drops a dependency. The token COLOR is discarded; only the scope-derived class survives, tinted by the `markdown.css` `.code-*` rules that read the `tokens.css` `--code-*` custom properties. Empirically confirmed scopes map cleanly (probe: `storage.type`→keyword, `comment.*`→comment, `constant.numeric`/`constant.language`→type-tint, `entity.name.function`/`support.function`→fn).
- `FontStyle` is a `const enum` (erased at compile time, unsafe to import as a runtime value across the ESM boundary) — I use the numeric bit literals (`1`=italic, `2`=bold, `4`=underline) directly instead of importing the enum.

**markdown-it 14.2.0.** Verified against `@types/markdown-it@14.1.2/lib/index.d.mts` + probe:
- `new MarkdownIt({ html: false, linkify: false })`; `Options.html` JSDoc `@default false`. With `html:false`, raw HTML in source is ESCAPED to text (probe: `<script>alert(1)</script>` → `&lt;script&gt;alert(1)&lt;/script&gt;` inside a `<p>`), the first line of defense.
- **GFM tables are enabled by default** in the default preset (probe: pipe table → full `<table><thead>…`). No plugin needed.
- `validateLink(url): boolean` is an overridable instance method. Its DEFAULT already returns `false` for `javascript:`, `vbscript:`, `file:`, and `data:` except safe image types (probe: `javascript:`→false, `data:text/html`→false, `https:`→true, `data:image/png`→true). I tighten it further to an explicit https/http/mailto + safe-image-data allowlist for belt-and-suspenders.

**dompurify 3.4.7.** Verified against `dompurify/dist/purify.cjs.d.ts` + probe:
- The default export is a `DOMPurify` instance that is ALSO a factory: `_default(root?: WindowLike): DOMPurify`. The bare instance binds to ambient `window`/`globalThis`; to be robust at module-load (no ambient `window` guaranteed) I bind explicitly via the factory with `globalThis` cast to `WindowLike`. Under happy-dom a `new Window()` works (probe: `isSupported === true`).
- `sanitize(dirty, cfg?)` returns a sanitized string by default. Config keys verified: `ALLOWED_TAGS`, `ALLOWED_ATTR`, `FORBID_TAGS`, `FORBID_ATTR`, `ALLOWED_URI_REGEXP`. Probe confirmed `<script>` removed, `onclick`/`onerror` stripped, `href="javascript:…"` dropped — even before adding my explicit allowlist (defense-in-depth on top of markdown-it `html:false`).

### Debug Log References

- **XSS-corpus assertion design (real bug caught early):** the first corpus assertions string-matched the rendered HTML (`/javascript:/`, `/<script/`). They false-RED on INERT output — a dropped-link's source text `[bad](javascript:alert(1))` and the ESCAPED `&lt;img … onerror=…&gt;` both contain the literal substrings but are inert. Rewrote `assertInert` to PARSE the output into a real DOM (`DOMParser.parseFromString`) and assert on actual elements/attributes/scheme of `href`/`src` — the semantically correct "is it live?" check (mirrors the browser smoke). This is the same class as Rule 10's "parse the machine-relevant part robustly."
- **happy-dom resource-fetch noise (mutation test):** parsing the DELIBERATELY-unsafe HTML (`<iframe src="https://evil.example">`) made happy-dom attempt a real `fetch`, printing `NetworkError`/`AbortError` to stderr (itself evidence the unsafe path is live). Silenced by disabling `disableJavaScriptFileLoading`/`disableCSSFileLoading`/`navigation.disableChildFrameNavigation` on `globalThis.happyDOM.settings` in the XSS test's `beforeAll`. The real `renderMarkdown` output triggers none of this.
- **Typecheck narrowing:** `codeToTokens` requires `lang: BundledLanguage`, not `string`. Made `isKnownLang` a type-guard (`x is BundledLanguage`) and typed `emitInertHtml`'s param accordingly — `HIGHLIGHT_LANGS` literals are all valid bundled grammars, so the guard narrows cleanly.

### Mutation-test record (Rule 7 + Rule 10 — corpus non-vacuity)

Performed on the real production source, restored byte-identical:
1. `render-markdown.ts` `html: false` → `html: true`: XSS corpus → **2 tests RED** (the "escapes raw HTML to TEXT" + behavioral tests — proves the `html:false` flag is load-bearing even with DOMPurify still active). Restored `html: false`.
2. Then `html: true` AND DOMPurify bypassed (`const clean = rawHtml`): XSS corpus → **20 of 30 tests RED** (live `<script>`/`<iframe>`/`<svg>`/`onerror`/dangerous-scheme vectors all leak). Restored `html: false` + `DOMPurify.sanitize(rawHtml, SANITIZE_CONFIG)`.
3. Post-restore: source verified intact (no `MUTATION` marker; `html: false` + both `DOMPurify.sanitize` call sites present) and the corpus is **30/30 green**. A permanent in-test parallel-unsafe-pipeline assertion (the last `it` in the file) keeps this non-vacuity guard as a regression gate without touching production source.

### Completion Notes List

- Implemented the inert Markdown pipeline (markdown-it `html:false` → hardened `validateLink` → DOMPurify allowlist) + Shiki tokenization emitted as **CSS-CLASS spans, never inline styles** (the single highest-risk NFR12 requirement), classifying TextMate scopes into the four DESIGN.md `--code-*` tints. `@shikijs/transformers` deliberately NOT added — the custom scope→class map is the strictest posture (zero inline style, zero color leak) and drops a dependency.
- `MarkdownView` (sanitized-HTML render in the reading column) and `CodeBlock` (code-panel chrome, `white-space:pre` never-wrap, ~25-line cap + expand affordance) ship with the full GFM element set (tables, inline code, blockquote, lists, bold, safe links) styled in `markdown.css` per DESIGN.md.
- The XSS-corpus guard (25 vectors + behavioral proof + mutation non-vacuity) is the load-bearing NFR12 evidence (Epic 8 retro Action A; Rule 10), DOM-parse-based and mutation-tested RED.
- Module boundary clean (NFR2): ui-shared imports NO `@agentbbs/core`/`data-access` (presentation-only). Naming: PascalCase.tsx components (one per file, no default export), kebab-case.ts modules.
- 9.1-L1 (React act-env) closed via the `ui-shared-dom` `setupFiles` setup — full suite runs with no `act()` warning.
- **Honest gate (exact counts):** `pnpm run lint` → 0 · `pnpm run build` → 7/7 packages · `pnpm run typecheck` → 0 · `pnpm test` → **780 passed (111 files)**, up from the 9.1 baseline 728 (+52: 25-vector XSS corpus + behavioral + mutation + render-fidelity + highlight/escape units) · `pnpm run format --check` → clean. No `.only`/`.skip`/`.todo`.
- **Rule 5 (NFR tripwire):** none fired — NFR12 is implementable as worded and is implemented + measured (the corpus). No planning-artifact amendment needed. **Rule 6 (ADR):** N/A — no `docs/adr/`.

### File List

New:
- `packages/ui-shared/src/markdown/render-markdown.ts`
- `packages/ui-shared/src/markdown/highlight.ts`
- `packages/ui-shared/src/markdown/escape-html.ts`
- `packages/ui-shared/src/markdown/markdown.css`
- `packages/ui-shared/src/markdown/MarkdownView.tsx`
- `packages/ui-shared/src/markdown/CodeBlock.tsx`
- `packages/ui-shared/src/markdown/render-markdown.xss.test.ts`
- `packages/ui-shared/src/markdown/render-markdown.test.ts`
- `packages/ui-shared/src/markdown/highlight.test.ts`
- `packages/ui-shared/src/markdown/MarkdownView.test.tsx`
- `packages/ui-shared/src/markdown/CodeBlock.test.tsx`
- `packages/ui-shared/src/test-setup-dom.ts`

Modified:
- `packages/ui-shared/package.json` (markdown-it/dompurify/shiki deps + @types/markdown-it devDep via `catalog:`; `./markdown.css` export + files entry)
- `packages/ui-shared/src/index.ts` (barrel exports for the renderer + components)
- `vitest.config.ts` (`ui-shared-dom` project `setupFiles`)
- `_bmad-output/implementation-artifacts/deferred-work.md` (9.1-L1 marked RESOLVED)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (9.2 → in-progress → review)

### Change Log

- 2026-06-01 — Story 9.2 implemented: inert Markdown rendering pipeline (markdown-it html:false → DOMPurify → Shiki CSS-class spans), `MarkdownView` + `CodeBlock` components with the full GFM element set, the NFR12 XSS-corpus guard (mutation-tested non-vacuous), and the `markdown.css` `.code-*` tint rules. Folded in Story 9.1 9.1-L1 (React act-env setup). Honest gate green (lint 0 / build 7-7 / typecheck 0 / test 780 / format clean).
- 2026-06-01 — **Code review: APPROVED — 0 HIGH / 0 MED / 0 LOW.** See Review Findings below.

## Review Findings (code-review stage — 2026-06-01)

**Verdict: APPROVED. 0 HIGH / 0 MED / 0 LOW. No deferred items.**

This is the marquee NFR12 security story; it was reviewed adversarially against the security boundary. The inert pipeline is genuinely safe, the Shiki output is genuinely class-only, and the XSS corpus is genuinely non-vacuous — all independently re-verified by the reviewer.

### Honest gate (reviewer re-ran, all GREEN)

- `pnpm run lint` → 0 · `pnpm run build` → 7/7 · `pnpm run typecheck` → 0 · `pnpm run format --check` → clean.
- `npx vitest run` (default suite) → **798 passed (111 files)**, 0 fail, no `.only`/`.skip`/`.todo`. (Matches the 728→798 epic-cycle expectation; the dev-record "780" is the pre-QA-hardening count — informational, not a defect.)
- `git status` after all reviewer activity matches the expected changeset exactly (whole new `packages/ui-shared/src/markdown/` dir + `test-setup-dom.ts` over baseline 0ff9ac2); no phantom edits.

### AC verification

- **AC1 (inert pipeline) — MET.** Traced every path to `dangerouslySetInnerHTML`: `MarkdownView` injects ONLY the post-`renderMarkdown` (→ markdown-it `html:false` → hardened `validateLink` → `DOMPurify.sanitize`) string; `CodeBlock` injects ONLY self-built escaped-token-text + class-name spans (no untrusted attribute path). markdown-it `html: false` confirmed at `render-markdown.ts:136` (load-bearing — reviewer mutation flipped it RED, see below). DOMPurify allowlist is conservative (closed `ALLOWED_TAGS`, `script`/`style`/`iframe`/`object`/`embed`/`form`/`input`/`svg`/`math`/`link`/`meta`/`base` forbidden, ALL `on*`/`style`/`srcdoc`/`srcset`/`src`/`formaction`/`xlink:href` forbidden, strict `ALLOWED_URI_REGEXP`, `ALLOW_DATA_ATTR:false`, `ALLOW_UNKNOWN_PROTOCOLS:false`). `validateLink` allowlists only http(s)/mailto/tel/#/relative + safe image-data; everything else drops the href.
- **AC2 (code block + GFM) — MET.** `CodeBlock` renders the `var(--code-panel)` chrome, 1px border, `white-space: pre` never-wrap + `overflow-x:auto`, ~25-line cap (`CODE_BLOCK_LINE_CAP=25`) + expand affordance (class-driven, no inline style). Full GFM element set (tables/inline-code/blockquote/lists/bold/links) styled in `markdown.css` per DESIGN.md. Real-DOM component tests (`MarkdownView.test.tsx`/`CodeBlock.test.tsx`) assert the structure + the cap/expand toggle.
- **AC3 (adversarial inert proof) — MET.** `render-markdown.xss.test.ts` runs a 39-vector corpus (25 dev + QA hardening) through the REAL `renderMarkdown`, asserts inert via REAL-DOM parse (`DOMParser`, not string-match — so escaped text does not false-positive), plus a behavioral canary and a permanent in-test parallel-unsafe-pipeline non-vacuity guard. Mutation-tested non-vacuous (below).

### Reviewer-independent verification (Rules 3, 5, 7, 10)

- **Rule 7 / 10 — corpus non-vacuity, INDEPENDENTLY confirmed.** Reviewer mutated the REAL production source (`html:false`→`html:true` AND bypassed `DOMPurify.sanitize`), ran `render-markdown.xss.test.ts` → **29 of 43 RED** (incl. the behavioral canary catching a live `<script>`), then restored `render-markdown.ts` byte-identical (verified `html: false` + both `DOMPurify.sanitize` call sites present, no MUTATION marker; corpus back to 43/43 green; `git status` clean). The corpus genuinely discriminates a defeated sanitizer.
- **Rule 3 — real-runtime evidence PRESENT.** The user-facing inert render has real DOM-env evidence: `MarkdownView.test.tsx`/`CodeBlock.test.tsx` render the components into a live happy-dom DOM under the `ui-shared-dom` project and assert observable DOM/render state; the XSS corpus parses real rendered output into a real DOM and injects it into a live node (behavioral canary). Not a stub.
- **Rule 5 — NFR12 PROVEN, not worked-around.** NFR12 is genuinely measured by the corpus + behavioral canary, not asserted in comments. No tripwire fired (NFR is implementable as worded).
- **Rule 1 / Consumed-by — SATISFIED.** Story declares Consumed-by: Story 9.5 (room thread renders each post via `MarkdownView`); the renderer's own surface is exercised by real-DOM tests in THIS story.
- **Rule 6 — N/A** (no `docs/adr/`).
- **Reviewer extra adversarial probes (11, all inert):** CRLF/tab-in-scheme, leading-control-char `javascript:`, unicode-homoglyph scheme, protocol-relative link, IE conditional-comment `<script>`, non-allowlisted `details`/`summary`/`dl`/`dt`/`dd`, table align attr, markdown png image — every one stripped/inert. No allowlist hole found (SVG/MathML/data-URI/event-handler all closed). Class-only Shiki output confirmed structurally (`emitInertHtml` never references `tok.color`; builds `class=` spans only) + pinned by the QA 9-language sweep.

### Notes (non-blocking, no action)

- The dev-record honest-gate line says "test 780"; the QA hardening pushed it to 798. Cosmetic stale count in the dev narrative, not a code defect — the live suite is 798/798 green.
- 9.1-L1 (React `act` env) correctly RESOLVED here: `test-setup-dom.ts` wired via `setupFiles`; reviewer confirmed the full suite runs with no `act(...)` stderr warning. deferred-work.md updated.
