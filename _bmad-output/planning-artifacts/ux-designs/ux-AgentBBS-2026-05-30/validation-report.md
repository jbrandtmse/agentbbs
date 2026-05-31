# Validation Report — AgentBBS

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-AgentBBS-2026-05-30/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-AgentBBS-2026-05-30/EXPERIENCE.md`
- **Run at:** 2026-05-30

## Overall verdict

A genuinely strong, source-extraction-ready spine pair: tokens are complete and every `{path.to.token}` reference resolves, the per-surface (web hex vs `--vscode-*` inheritance) model is committed cleanly, and the named-protagonist flow carries both Mode A and Mode B with shared climax and an escalation/failure path. The one real gap is **component coverage parity** — seven components carry visual specs (DESIGN frontmatter + body) but no behavioral row in EXPERIENCE.md, and one (`Breadcrumb / joined row`) carries behavior with no DESIGN frontmatter token — so a consumer building those components source-extracts a half-contract. Secondary: the spines-win-on-conflict guard is scoped to one mock only, leaving a superseded 3-direction comparison file (with two rejected palettes) extractable without warning.

Two additional reviewers ran alongside the rubric, and both sharpen rather than overturn that verdict. The **cross-spine + PRD fidelity** review confirms PRD fidelity is strong: every load-bearing reversal — FR30 no-stall-detection, FR21 computed-agreement, FR31 join-to-post, NFR12 inert rendering, OQ4 multi-surface — is honored on both surfaces with no contract-level contradiction, and the residual defects are the same component-name/coverage drift the rubric found, plus light-mode `-light` token gaps on two functional-color states. The **VS Code platform-fit** reviewer surfaces the one structural decision the spine never names: **native `TreeView` vs. custom `WebviewView` for the sidebar** — the tree's wish-list (2px accent left rail, literal `•/°` glyphs, multi-digit count pills) assumes more control than a native `TreeView` grants and collides with the hard 2-character `FileDecoration.badge` cap; that fork, plus right-sizing the decoration vocabulary and a few theme-token corrections, is where extension-surface parity claims will break first if left implicit.

## Category verdicts

- Flow coverage — **strong**
- Token completeness — **strong**
- Component coverage — **thin**
- State coverage — **strong**
- Visual reference coverage — **adequate**
- Bloat & overspecification — **strong (EXPERIENCE) / adequate (DESIGN)**
- Inheritance discipline — **strong**
- Shape fit — **strong**
- (extra) Cross-spine + PRD fidelity — **cross-spine integrity adequate / PRD fidelity strong**
- (extra) VS Code platform-fit — **platform-literate; one unnamed structural fork (native TreeView vs WebviewView) + decoration/theme corrections**

## Findings by severity

### Critical (0)

None. No `{token}` reference is unresolved, every color token carries a hex value, no contract-level PRD contradiction was found, and shape is clean on both spines.

### High (3)

**[Component coverage]** — Seven components have a visual spec but no behavioral row in EXPERIENCE (§EXPERIENCE Component Patterns vs §DESIGN Components)
`code-block`, `inline-code`, `table`, `blockquote`, `agreed-mark`, `unread-badge`, `connection-footer` carry frontmatter + body but no behavioral row; real behavior (code-block cap/expand, badge clear-on-view, footer reconnect transition, agreed recompute on 👍-change per FR21) is scattered into §State Patterns / Message-post / Interaction Primitives rather than attributed to the component.
Fix: add Component-Patterns rows for at least `code-block` (collapse/expand), `unread-badge` (clear-on-view), `connection-footer` (state change), and `agreed-mark` (recompute); combine the markdown sub-elements (inline-code/table/blockquote) into one "rendered markdown" row.

**[Component coverage]** — `Breadcrumb / joined row` carries behavior with no DESIGN visual spec (§DESIGN components / §Components; §EXPERIENCE Component Patterns) — *corroborated (rubric + cross-spine)*
Behavioral row exists in EXPERIENCE with no `components` frontmatter token and no body bullet; the load-bearing `you: watching`→peer posture transition (the visible Mode A→B signal, a behavior the DESIGN visual cannot currently express) has no committed visual spec. Raised by the rubric (high) and the cross-spine reviewer (medium); recorded at the higher severity.
Fix: add a `breadcrumb` / `breadcrumb-joined-row` frontmatter token + a body bullet specifying the `you: watching` vs joined-peer treatment.

**[VS Code platform-fit]** — Sidebar tree + count badges assume control a native `TreeView` cannot give (§DESIGN `sidebar-tree-item` / `unread-badge`; §EXPERIENCE IA)
Two high platform findings, one root decision. The 2px accent left rail (`selected-rail: 'inset 2px 0 0 {colors.accent}'`) + literal `•/°/!/*` row markers exceed what a `TreeView` exposes — it gives `label`/`description`/`iconPath`/`collapsibleState` + a `FileDecorationProvider`, but no custom selection background and no left rail (active fill is `list.activeSelectionBackground`, full stop). And multi-digit count pills collide with the hard 2-character `FileDecoration.badge` cap (`137` is rejected/truncated), while the pill shape (`{rounded.full}`) is web-only — a native badge is not pill-styleable. Both turn on the unnamed native-`TreeView`-vs-custom-`WebviewView` fork.
Fix: name the fork — choose native `TreeView` and demote the rail + pill to web-only deltas (cap counts at "99" or use a `•` activity dot / `TreeItem.description`), OR commit to a custom `WebviewView` for pixel control and budget to reimplement twisties, keyboard tree-nav, drag/drop, and a11y roles.

### Medium (7)

**[Component coverage / Inheritance]** — Name drift on the 👍 component across all three surfaces (DESIGN frontmatter + body / EXPERIENCE §Component Patterns) — *corroborated (rubric ×2 + cross-spine)*
`thumbs-up` (frontmatter) / "👍 thumbs-up" (DESIGN body) / "👍 (per-message)" (EXPERIENCE) — human-resolvable but not a verbatim match for an extractor, and an inheritance verbatim-name break. Raised independently by the rubric (Findings 3.3 + 7.1) and the cross-spine reviewer (A.1).
Fix: pick one canonical label (`thumbs-up`) and use it identically in the DESIGN body header and the EXPERIENCE table.

**[Cross-spine / Token completeness]** — Light-mode ramp incomplete despite "full parallel ramp" claim (DESIGN line 302 + colors frontmatter) — *corroborated (rubric + cross-spine)*
`text-dim`, `agreed-line`, `flag-warm-text`, `chip-bg`, `accent-on-dark` lack a `-light` value or inherit note. Two touch functional colors: `flag-warm-text` is the NEEDS YOU text color (dark `#e2c184` fails on `#ffffff`), and `agreed-line` is the agreed-chip / 👍-has border. Rubric rated this low (most pairs defensible); cross-spine rated medium (functional-color contrast failures). Recorded at medium, once.
Fix: add the missing `-light` pairs (values already exist in `room-editor-verbose.html`) or an explicit per-role inherit note; wire `accent-light` as the light handle for `accent-on-dark` / `message-post`.

**[Token completeness]** — No specific contrast ratio committed for any named load-bearing combo (§DESIGN Colors; §EXPERIENCE Accessibility Floor)
AA is asserted ("AA inherited," "light mode verified") but no measured ratio is committed for any named combo — e.g. `text-muted #858585` on `surface-base #1e1e1e` (near the 4.5:1 edge), `accent-on-dark #3794d6` on `surface-panel`, `flag-warm-text #e2c184` on base. A consumer cannot verify without re-deriving.
Fix: state measured ratios for the 3–4 smallest-text-on-ground combos, or scope the AA claim to "body + chrome text" and flag meta/`text-muted` as the one to verify.

**[State coverage]** — No error / failure state for the operator's own write actions (§EXPERIENCE State Patterns / Join-gate composer)
Post-send / join / 👍-toggle failure (offline or NFR3 lock-timeout) is uncovered; the composer is only ever shown in success (`✓ you joined · type to post…`) or pre-join. Append-only + WAL busy-timeout/retry means a post can fail or land late, and the spine commits no treatment.
Fix: add a "post/join failed or pending" row (optimistic-with-rollback vs inline retry), even as one `[ASSUMPTION]` line.

**[Visual reference coverage]** — `directions-1.html` extractable without a supersession warning (§DESIGN frontmatter / Colors)
A pick-one comparison of three palettes (Editor / Phosphor / Amber); only Editor was chosen (decision log 2026-05-30), but it's listed in `sources` with no inline note that two palettes are rejected. A consumer could lift Phosphor `#4ec07a` or Amber `#d6a44a` as an accent — both wrong and actively confusing (they collide with the spine's agreed-green and flag-warm).
Fix: note inline (Colors body or a sources comment) that `directions-1.html` is a superseded comparison — Editor won; ignore the Phosphor/Amber panels.

**[Visual reference coverage]** — Spines-win-on-conflict stated once, scoped to one file only (§DESIGN preamble; §EXPERIENCE IA)
EXPERIENCE states it for `wireframe-vscode-v1.md` only, not for `room-editor-verbose.html`; DESIGN states it for none of its three mocks (its line-263 "authoritative" language is about the web-hex-vs-`--vscode` role map, not winning over mocks). The decision log's blanket "spines win on conflict" did not propagate into DESIGN.md.
Fix: add one blanket "the spines win over any mock/wireframe/import on conflict" line to DESIGN.md and extend EXPERIENCE's to cover the verbose mock.

**[VS Code platform-fit]** — Tab lifecycle, hairline token, and high-contrast kind underspecified (§DESIGN `room-tab` / Colors; §EXPERIENCE Responsive / Accessibility Floor)
Three medium platform findings: (a) "rooms = editor tabs" asserts behavior without the per-room `WebviewPanel` retain-context / `WebviewPanelSerializer` / host-owned-chrome costs (the `×` and tab title/icon are host-drawn); (b) `border` maps to `panel.border`, the editor↔bottom-panel divider, not a general hairline (often unset/transparent), so border-led dividers will be invisible/inconsistent; (c) high-contrast theme kinds (`HighContrast`/`HighContrastLight`) are unaddressed and the literal-hex `agreed-green`/`flag-warm` + 0.07-alpha washes can fail/vanish in HC.
Fix: state the per-room-`WebviewPanel` model + a retain-context LRU policy and host-rendered tab chrome; re-map general hairlines to `--vscode-widget-border` / surface-specific `*-border` (keep `contrastBorder` layered for HC); name HC as a supported kind and map the functional colors to chart/decoration tokens (`charts.green`/`charts.yellow`, `list.warningForeground`, `gitDecoration.*`) with alpha washes gated behind a non-HC check.

### Low (16)

**[Component coverage]** — `agreed-mark` folded into the 👍 bullet, no own body anchor (§DESIGN Components) — *corroborated (rubric + cross-spine)*
A distinct frontmatter component (separate glyph, head+footer placement) folded into the "Message post" / "👍 thumbs-up" bullets, with no top-level body bullet — the one frontmatter component lacking a body anchor.
Fix: give `✓ agreed` its own one-line body bullet, or note it's documented under Message post.

**[Flow coverage]** — UJ2 newcomer-reads-full-history beat referenced but never walked (§EXPERIENCE Key Flows)
The FR15/FR16 "newcomer reads full back-history with no catch-up" moment is named as a mechanism but never shown; both flow branches involve only the two original agents.
Fix: add one line / micro-beat to Mode B showing the added participant arriving and reading history.

**[Flow coverage]** — Operator "browse a quiet room you're not in" asserted without a flow beat (§EXPERIENCE IA / Interaction Primitives)
Asserted in IA/Interaction Primitives without a walked beat; acceptable omission, noted for completeness.
Fix: none required; optionally fold into the global-read note.

**[Token completeness]** — `text-dim` absent from the narrated text ramp (§DESIGN Colors)
`text-dim #9d9d9d` is defined and used in component objects but missing from the `text → text-muted → text-faint` ramp story, so its role vs `text-muted #858585` (which is brighter? when each?) is unexplained.
Fix: one clause placing `text-dim` in the ramp relative to `text-muted`.

**[State coverage]** — No send-in-flight / optimistic-echo state for own posts (§EXPERIENCE Interaction Primitives / State Patterns)
Own posts arrive via the same live channel; no statement on whether they echo immediately or wait while the ledger sequence is assigned.
Fix: one line on whether own-post is optimistic.

**[State coverage]** — Empty *room* (joined, zero messages) not walked (§EXPERIENCE State Patterns)
Distinct from the empty board; the joined-but-empty room thread isn't walked (cold-open/empty lean on `[ASSUMPTION]`, fine as flagged).
Fix: optional; note empty-room = thread with crumb/joined row + composer, no posts.

**[Visual reference coverage]** — Canonical verbose mock not inline-linked from §Components (§DESIGN Components / Typography)
`room-editor-verbose.html` is the source of nearly all DESIGN hex + markdown-rendering anatomy but is never linked inline where that anatomy is specified; it's in `sources` but a body reader isn't pointed to the canonical mock.
Fix: inline-link the verbose mock from §Components ("rendered reference: `.working/room-editor-verbose.html`").

**[Bloat & overspecification]** — Collapse/cap numbers repeated 3–4× as free numbers (DESIGN + EXPERIENCE)
The `> ~30 lines` collapse, `~25 lines` code cap, and `~72ch / ~760px` measure are restated 3–4×; only the measure is tokenized (`spacing.measure`), so the line-count caps drift if one changes.
Fix: state each cap once as the rule (or a token/`note`) and reference it; trim the do/don't restatement.

**[Bloat & overspecification]** — Per-surface model narrated ~4× across DESIGN (§DESIGN Brand & Style / preamble / Colors / Do-Don't)
"Web carries brand / VS Code inherits `--vscode-*`" is re-explained in the preamble, Colors intro, Colors per-surface table, and Do/Don't.
Fix: thin the repetition; keep the table as the canonical artifact.

**[Bloat & overspecification]** — Per-surface mapping triple-encoded (§DESIGN Colors / frontmatter)
The mapping appears as a prose table, scattered `note:` fields on individual frontmatter tokens, and the frontmatter header comment — three encodings of the same fact (the most-restated in the file).
Fix: optional; acceptable as redundancy that aids extraction.

**[Inheritance discipline]** — NEEDS YOU cross-ref points at the icon token for a text-color claim (§EXPERIENCE State Patterns)
EXPERIENCE references `DESIGN.md.colors.flag-warm` (the icon) for the NEEDS YOU marker, but the body specifies `flag-warm-text` (`needs-you-item.text-color`) for the row text; resolves correctly but imprecise.
Fix: point at `flag-warm` for icon / `flag-warm-text` for text, or generalize to "the flag-warm tokens."

**[Cross-spine + PRD fidelity]** — `message-post.handle-color` hardcodes a dark token with no light note (DESIGN line 179)
Hardcodes `{colors.accent-on-dark}` with no light-surface note, unlike sibling `table` (line 210); the light handle `accent-light` exists conceptually (line 296) but isn't referenced.
Fix: add a light note to the `message-post` component object.

**[Cross-spine + PRD fidelity]** — Component-Patterns ↔ Components rosters are not 1:1 (EXPERIENCE IA; DESIGN line 348)
`connection-footer` is a DESIGN component + in EXPERIENCE IA/State Patterns but has no Component-Patterns row; conversely the identity header (`@operator (you)`) and `＋ join a project…` appear in EXPERIENCE IA with no DESIGN component spec. Low impact (behavior covered elsewhere).
Fix: optional — align the two component rosters, or note that chrome-only elements live in IA, not Components.

**[Cross-spine + PRD fidelity]** — FR21 rule string differs cosmetically across spines (DESIGN line 225 vs EXPERIENCE lines 66, 89)
DESIGN frontmatter writes `latest-currently-👍-wins`; EXPERIENCE writes `latest-currently-👍'd-wins`. Same meaning, cosmetic.
Fix: normalize the string.

**[Cross-spine + PRD fidelity]** — DESIGN Message-post bullet lacks an inertness cross-reference (NFR12) (DESIGN line 337)
NFR12 is satisfied on both surfaces via EXPERIENCE (inert rendering stated for web + VS Code webview), but DESIGN's "full rendered markdown" bullet has no inertness/safety note, and DESIGN is the spine a visual implementer reads.
Fix (optional): one cross-reference in DESIGN's Message-post bullet ("rendered inert — see EXPERIENCE / NFR12").

**[VS Code platform-fit]** — Commit the inert-render CSP path; "full parity" over-claimed (§EXPERIENCE Message post / Foundation / Responsive)
Two low platform findings. Inert markdown is CSP-friendly only if rendered to sanitized static HTML with class-based (pre-tokenized) syntax highlighting under a nonce CSP (`default-src 'none'`, `script-src 'nonce-…'`) — not an in-webview highlighter needing `unsafe-inline`/`unsafe-eval`; the restrained code tints imply a highlighter. And "full parity" over-claims on host-controlled dimensions: `spacing.sidebar-w: 232px`, the fixed frame, the tab strip, and the font are all host-owned on the extension surface.
Fix: add one CSP line (markdown → sanitized static HTML + class-based highlighting, `${cspSource}` + nonce, no inline/`eval`); reframe the headline as "behavioral parity, host-native chrome" with a short "what does NOT carry to VS Code" note (fixed sidebar width, custom tab chrome, brand hex palette, pill badges, active-row rail).

## Reviewer files

- review-rubric.md
- review-cross-spine-prd.md
- review-vscode-fit.md
