---
baseline_commit: 6af81e2b8031aa05e4b79004939c61a3f1be4c09
---

# Story 9.1: ui-shared scaffold and design-token system

Status: review

<!-- Created by the /epic-cycle Lead Creates Story Files gate (lead-side /bmad-create-story). -->
<!-- Baseline: AGENTBBS-1-epic9 @ 6af81e2 (Epic 9 setup commit). FIRST UI story of the project. -->

## Story

As a UI developer,
I want the shared React package with the semantic design-token system,
so that both surfaces (web control room + VS Code webview) render from one token core with per-surface theming.

## Acceptance Criteria

**AC1 — Semantic token roles + typography (DESIGN.md token core).**
**Given** `ui-shared`,
**When** I inspect `tokens.css`,
**Then** it defines the semantic token roles (surfaces, text ramp, accent, agreed-green, flag-warm, borders, radii, spacing) with **full dark and light ramps** using the canonical brand hex,
**And** the **two-family typography split** is encoded (UI/system font for prose + chrome + message body; monospace for handles, room ids, timestamps, and all code) with the long-form body set at **~13px / 1.62 line-height** within a **~72ch measure** (`max-width` ~760px).

**AC2 — Measured contrast floor (AA, both modes).**
**Given** the measured contrast targets,
**When** the load-bearing small-text combos are checked,
**Then** they meet AA (**≥4.5:1** normal text / **≥3:1** large + UI) in **both** modes per the DESIGN.md contrast table (reproduced under Dev Notes → Contrast targets).

**AC3 — Integration AC (token core is consumable by a React surface).**
**Given** the `ui-shared` package after this story,
**When** a React component in `ui-shared` references a semantic token (via a CSS custom property from `tokens.css`) and is rendered in a DOM test environment,
**Then** the custom property resolves to the canonical value for the active theme (dark default; light when the documented light-mode selector/attribute is set), proving the token core is wired for consumption by the surfaces that follow (Stories 9.2+). This is the Rule 1 Integration AC: the first consumer of the token core is exercised in this story rather than only asserted to exist.

> **Note on "no consumers yet" escape clause:** this story introduces the `ui-shared` React/token core that ALL later Epic 9 stories consume. AC3 wires the first in-package consumer (a token-referencing component rendered in a DOM test) so the producer is not shipped green with the consumer-wiring unbuilt. The first cross-surface consumer (`apps/web`) lands in Story 9.3; the first feature component (inert renderer) in Story 9.2.

## Tasks / Subtasks

- [x] **Task 1 — React + JSX scaffold for `ui-shared`** (AC: #1, #3)
  - [x] Add `react` + `react-dom` deps (and `@types/react` / `@types/react-dom` devDeps) to `packages/ui-shared/package.json` via the `catalog:` protocol (versions already pinned in `pnpm-workspace.yaml`: react ^19.2.6, react-dom ^19.2.6, @types/react ^19.2.15, @types/react-dom ^19.2.3). React/react-dom are `dependencies` (consumed by both surfaces); `@types/*` are `devDependencies`. — installed react 19.2.6 / react-dom 19.2.6 / @types/react 19.2.15 / @types/react-dom 19.2.3.
  - [x] Update `packages/ui-shared/tsconfig.json` to compile `.tsx`: add `"jsx": "react-jsx"` to `compilerOptions`, add the React types to `lib`/`types` as needed, and broaden `include` to `["src/**/*.ts", "src/**/*.tsx"]`. Keep `extends: ../../tsconfig.base.json`, `rootDir: src`, `outDir: dist`, `composite: true` (inherited). Do NOT add `@agentbbs/*` `paths` to a package tsconfig (the cross-package `paths` live ONLY in `tsconfig.typecheck.json` — see Rule 2 / build-honesty note). — added `jsx: "react-jsx"` + `lib: ["ES2023","DOM","DOM.Iterable"]` (DOM needed by the component + DOM test); no `paths` added.
  - [x] Update `packages/ui-shared/package.json` `build` script remains `tsc -b tsconfig.json`. Confirm `pnpm -r build` still produces `dist/`. — `dist/` regenerated with TokenProbe + contrast + index.
  - [x] `pnpm install` to materialize the new deps; confirm `pnpm-lock.yaml` updates and `allowBuilds` is unaffected (React has no native build script). — lockfile updated; allowBuilds untouched (React/happy-dom have no native build).

- [x] **Task 2 — `tokens.css` semantic token core** (AC: #1)
  - [x] Author `packages/ui-shared/src/tokens.css` defining every semantic role from DESIGN.md `colors:` as CSS custom properties on `:root` for the **dark (default)** ramp, and a parallel **light** ramp under the documented light-mode selector (see Dev Notes → Light-mode mechanism). Name the custom properties after the semantic role … — NOT after raw hex. Include the full ramp … (every role in the DESIGN.md `colors:` block, both dark and light). — RECONCILED (see Completion Notes): the `*-light` SUFFIXED names listed parenthetically in this subtask CONTRADICT the Dev Notes (line ~84: "Do not invent `*-light`-suffixed custom-property NAMES … the light ramp REDEFINES the SAME names"). The Dev Notes design is the ratified one; those roles (`text-dim`, `agreed-line`, `flag-warm-text`, `chip-bg`, `accent-on-dark`) ARE encoded — as the SAME names redefined under `:root[data-theme='light']`.
  - [x] Encode radii (`--radius-sm` 4px, `--radius-default` 5px, `--radius-md` 6px, `--radius-full` 9999px), spacing scale (`--space-1`=4px … `--space-7`=18px, `--space-tree-row-y`=3px, `--measure`=760px, `--sidebar-w`=232px) per DESIGN.md `rounded:` + `spacing:`.
  - [x] Encode the two-family typography split as custom properties: `--font-ui` + `--font-mono` exactly per DESIGN.md, plus per-role size/weight/line-height/letter-spacing for message-body (UI 13px/1.62), handle (mono 12.5px/600), identifier (mono 12px), timestamp (mono 10.5px, ls 0.2px), code (mono 12px/1.55), tree-item (mono 12px), section-label (UI 10.5px/600, ls 0.9px), ui-label (UI 12.5px). Long-form body 13px/1.62 in a ~72ch measure (`--measure` 760px).
  - [x] Add a brief header comment in `tokens.css` citing DESIGN.md as the source of truth and noting the VS Code surface maps the same roles to `--vscode-*` (per-surface delta; NOT this story's hex).

- [x] **Task 3 — Contrast verification (AA floor, both modes)** (AC: #2)
  - [x] Implement a small, self-contained WCAG contrast utility in `ui-shared` source (`src/contrast.ts` exporting `contrastRatio` + `relativeLuminance` + `hexToRgb`, WCAG relative-luminance formula). No new runtime dep — pure TS. Exported from the barrel for reuse by a11y story 9.10.
  - [x] Add a contrast test (`src/contrast.test.ts`) asserting EACH load-bearing combo from the DESIGN.md table meets its floor in BOTH modes. Source of truth = `tokens.css` PARSED DIRECTLY (Approach 2, Dev Notes → avoiding a hand-copy): the test reads the dark `:root` block and the light `:root[data-theme='light']` block as separate scopes and runs the real `contrastRatio` over the parsed hex — pins the SHIPPED values, no hand-copy.
  - [x] Verify the `text-muted` dark combo (`#858585` on `#1e1e1e`) — DESIGN.md "edge, 4.5:1" — passes the `>= 4.5` assertion (strict `>=`; true WCAG ≈ 4.52, so 4.49 cannot slip). Mutation-tested RED (weakened to `#6a6a6a`).

- [x] **Task 4 — First in-package token consumer (Integration AC)** (AC: #3)
  - [x] Add a minimal token-consuming React component (`src/TokenProbe.tsx`) relying on `tokens.css` custom properties, rendering an element whose style reads `color: var(--text-body)` (+ surface/typography tokens).
  - [x] Add a DOM-environment test (`src/TokenProbe.test.tsx`) rendering the component (react-dom/client `createRoot` + `act`), applying `tokens.css`, and asserting via `getComputedStyle(documentElement).getPropertyValue` that the dark default resolves to `#d4d4d4` and the `data-theme="light"` selector flips it to `#1e1e1e` (and back). Mutation-tested RED (broke the light value). DOM env = happy-dom (Task 5).
  - [x] Export the new component + `contrastRatio` (and `relativeLuminance`/`hexToRgb` + `TokenProbeProps`) from `src/index.ts`; retained the `UI_SHARED_PACKAGE` marker (stable barrel).

- [x] **Task 5 — Wire the UI test tier into the default suite (Epic 8 retro Action B; Rule 8)** (AC: #2, #3)
  - [x] Added a SECOND project entry to the root `vitest.config.ts` (`name: 'ui-shared-dom'`, `environment: 'happy-dom'`, `include: ['packages/ui-shared/src/**/*.test.tsx']`) and EXCLUDED that glob from the node project, so each UI test runs in exactly one env. Verified mechanism against installed vitest 4.1.7 types: `BuiltinEnvironment = "node"|"jsdom"|"happy-dom"|"edge-runtime"`; `environmentMatchGlobs` is REMOVED in v4 (absent from the types) → second-project entry is the supported path. happy-dom 20.9.0 added to catalog + ui-shared devDeps. Single-root-config invariant preserved.
  - [x] Confirmed `pnpm test` (root `vitest run`) discovers + runs the new files in the DEFAULT run: 724 tests (was 709 at baseline) = +15 (12 contrast + 3 DOM). No `.only`/`.skip`/`.todo`.
  - [x] Confirmed `pnpm run typecheck` type-checks the new `.tsx`. Smallest fix = added `jsx: "react-jsx"` + `lib: ["ES2023","DOM","DOM.Iterable"]` to `tsconfig.typecheck.json` (the standalone flat pass does NOT inherit the package tsconfig's jsx/lib). Did NOT widen `types` (story caution honored); React types resolve via the module graph (explicit `import` from 'react', not ambient). The node packages' no-DOM guarantee is preserved by their per-package production builds (base `lib: ["ES2023"]`) — `pnpm run build` stays the guard.
  - [x] Full honest gate (recorded): `lint` 0 · `build` all 7 packages Done · `typecheck` 0 · `test` 724 passed (105 files, +15) · `format --check` clean (after `format:write` reflowed contrast.test.ts).

## Dev Notes

### What this story is (and is NOT)

- **IS:** the `ui-shared` React/TSX scaffold + the `tokens.css` semantic token core (dark + light) + the two-family typography encoding + a WCAG contrast utility & test proving the AA floor + the first in-package token consumer rendered in a DOM test + the UI test-tier wiring into the default suite/build graph.
- **IS NOT:** any rendered application, web host, SSE, markdown renderer, tree, room thread, composer, or `apps/web`. Those are Stories 9.2–9.10. Do NOT build UI features here — only the token core + scaffold + the consumer-wiring proof.
- **Module boundary (NFR2):** `ui-shared` is a THIN client package. It MUST NOT import `@agentbbs/core`/`@agentbbs/data-access` board logic in this story (no board logic in a client). It owns presentation only.

### Canonical source of truth — DESIGN.md

`_bmad-output/planning-artifacts/ux-designs/ux-AgentBBS-2026-05-30/DESIGN.md` is authoritative ("the spines win on conflict with any mock, wireframe, or import"). Every token value below is lifted from its `colors:` / `typography:` / `rounded:` / `spacing:` front-matter blocks. The VS Code surface does NOT use these hexes — it maps the same semantic roles to `--vscode-*` variables (a later/extension concern, Epic 10). This story ships the **web canonical** hex values only, as semantic custom properties.

### Full color ramp to encode (from DESIGN.md `colors:`)

**Dark (default, on `:root`):**
`--surface-base` #1e1e1e · `--surface-panel` #252526 · `--surface-input` #3c3c3c · `--code-panel` #1b1b1b · `--border` #333333 · `--border-soft` #2d2d2d · `--text` #cccccc · `--text-body` #d4d4d4 · `--text-strong` #ffffff · `--text-muted` #858585 · `--text-dim` #9d9d9d · `--text-faint` #6f6f6f · `--accent` #007acc · `--accent-hover` #1177bb · `--accent-on-dark` #3794d6 · `--accent-fg` #ffffff · `--selection` #094771 · `--agreed-green` #4ec07a · `--agreed-line` #3b8f63 · `--flag-warm` #d6a44a · `--flag-warm-text` #e2c184 · `--badge-bg` #37373d · `--badge-fg` #cccccc · `--chip-bg` #2b2b2e · `--code-inline-bg` #2a2a2d · code tints `--code-keyword` #569cd6 / `--code-type` #4ec9b0 / `--code-fn` #dcdcaa / `--code-comment` #7a7a7a.

**Light (first-class, under the light selector):**
`--surface-base` #ffffff · `--surface-panel` #f3f3f3 · `--surface-input` #ffffff · `--code-panel` #f6f6f6 · `--border` #e0e0e0 · `--border-soft` #ededed · `--text` #1e1e1e · `--text-body` #1e1e1e · `--text-strong` #0a0a0a · `--text-muted` #6e6e6e · `--text-faint` #9b9b9b · `--text-dim` #6b6b6b · `--accent` #0066b8 · `--accent-hover` #1177bb · `--accent-on-dark` #0066b8 · `--accent-fg` #ffffff · `--selection` #cfe3f7 · `--agreed-green` #2f9e63 · `--agreed-line` #2f9e63 · `--flag-warm` #b07d18 · `--flag-warm-text` #7a560f · `--chip-bg` #f1f1f1 · `--badge-bg` #dadada · `--badge-fg` #333333 · `--code-inline-bg` #eeeeee · code tints `--code-keyword` #0000c0 / `--code-type` #267f99 / `--code-fn` #795e26 / `--code-comment` #6a8f5a.

> The light ramp REDEFINES the SAME custom-property names (e.g. `--text-body` flips #d4d4d4→#1e1e1e). Consumers reference `var(--text-body)` and get the right value for the active theme — this is the "one token core, per-surface theming" property. Do not invent `*-light`-suffixed custom-property NAMES for the consumer-facing tokens; the suffix exists in DESIGN.md only to disambiguate the two hex values in prose. (You MAY keep internal `*-light` names in a source-of-truth data file used by the contrast test; see below.)

### Light-mode mechanism (decide + document)

DESIGN.md says "dark-first, light first-class" but does not pin the selector. Choose the conventional, surface-agnostic mechanism and document it in Dev Notes + a `tokens.css` comment: recommended `:root { …dark… }` + `:root[data-theme="light"] { …light… }` (attribute on the root element), which is trivially drivable by both the web shell and a future VS Code `body.vscode-light` mapping, and testable by toggling the attribute in the DOM test. (A `prefers-color-scheme` media query MAY be layered later; the explicit attribute is the testable primitive for AC3.) Avoid coupling to any framework theme lib — none is selected yet (architecture lists UI state-management as an open assumption; do not introduce one here).

### Contrast targets (DESIGN.md measured table — AC2 pins THESE)

Floor = **4.5:1** normal text / **3:1** large + UI. Assert each in the named mode:

| Combo (small text) | Dark | Light |
|---|---|---|
| body text on surface-base (`text-body` / `text-body-light`) | `#d4d4d4` on `#1e1e1e` → **11.3:1** | `#1e1e1e` on `#ffffff` → **17.4:1** |
| meta on surface (`text-muted` / `text-muted-light`) | `#858585` on `#1e1e1e` → **4.5:1** (edge — the one to watch) | `#6e6e6e` on `#ffffff` → **5.1:1** |
| handle accent on surface (`accent-on-dark` / `accent-light`) | `#3794d6` on `#252526` → **4.6:1** | `#0066b8` on `#f3f3f3` → **5.3:1** |
| NEEDS YOU text on its ground (`flag-warm-text`) | `#e2c184` on `#252526` → **8.9:1** | `#7a560f` on `#ffffff` → **6.6:1** |
| agreed-green on surface | `#4ec07a` on `#1e1e1e` → **7.3:1** (text-floor pair) | `#2f9e63` on `#ffffff` → **3.4:1** (LARGE/UI ≥3:1 ONLY — do NOT assert ≥4.5 here) |

- The four "small text" rows assert **≥4.5:1** in both modes (dark `text-muted` is exactly at 4.5 — assert `>= 4.5`).
- The **agreed-green-on-white** light combo is **3.4:1** — it is a LARGE/UI-only color per DESIGN.md (rule/glyph), so assert it against the **≥3:1** floor, NOT ≥4.5. Encode this distinction in the test (a per-combo expected floor), do not blanket-assert 4.5 everywhere or the agreed-green light row will false-fail.
- The handle-accent combos are measured on the **panel** ground (`#252526` dark / `#f3f3f3` light), not base — use the correct background per the table.

### Avoiding a hand-copy (Rule 10 spirit)

The contrast test must pin the SHIPPED token values, not a re-typed list that can drift from `tokens.css`. Two acceptable approaches — pick one and note it:
1. A single TS module (e.g. `src/tokens.ts`) exporting the hex values as typed constants, with `tokens.css` GENERATED-from or KEPT-in-lockstep-with it, and a guard test that the CSS custom properties match the TS constants (parse the `.css` for `--name: #hex;` and compare). This makes `tokens.ts` the source of truth and pins the CSS to it.
2. Parse `tokens.css` directly in the contrast test (read the file, extract `--name: value`), and run the WCAG math on the parsed values. The test then operates on exactly the shipped CSS.
Approach 2 most directly satisfies "pin the claim to the shipped artifact." Either is acceptable; document the choice. A bare re-typed hex list in the test is NOT acceptable (it can pass while `tokens.css` drifts).

### Test environment (Epic 8 retro Action B)

- Root `vitest.config.ts` is the SINGLE workspace config (Story 1.2 invariant — packages never define their own). It already `include`s `packages/*/src/**/*.test.{ts,tsx}` under one `node`-environment project. React component / `getComputedStyle` tests need a DOM. Add a DOM environment (`happy-dom` recommended — lighter than `jsdom`; verify against React 19) scoped to the UI tests, EITHER via a second project whose `include` is `packages/ui-shared/src/**/*.test.tsx` with `environment: 'happy-dom'`, OR via `test.environmentMatchGlobs` / a per-file `// @vitest-environment happy-dom` pragma. Whichever you choose, the existing `node` tests MUST keep running under `node` (do not flip the global env). Add the chosen env to the catalog + `ui-shared` devDeps.
- `contrast.test.ts` is pure math (no DOM) → can stay `node`. Only the `*.test.tsx` rendering tests need the DOM env.
- Rule 8: confirm the new tests run in the DEFAULT `pnpm test` (not just a path-filtered run). Confirm no `.only`/`.skip`/`.todo` ship.

### Source facts to VERIFY before coding (Rule 4 — confirm against the repo)

- `packages/ui-shared/` exists with `package.json` (name `@agentbbs/ui-shared`, type module, build `tsc -b tsconfig.json`), `src/index.ts` (only the `UI_SHARED_PACKAGE` marker today), `tsconfig.json` (extends base, rootDir src, outDir dist). VERIFIED at baseline 6af81e2.
- Catalog (`pnpm-workspace.yaml`) ALREADY pins react ^19.2.6, react-dom ^19.2.6, @types/react ^19.2.15, @types/react-dom ^19.2.3, vite ^8.0.14, @vitejs/plugin-react ^6.0.2, markdown-it/dompurify/shiki (for later stories). It does NOT pin a DOM test env — you add `happy-dom` (or `jsdom`) to the catalog in Task 5. VERIFIED.
- Root `vitest.config.ts` `projects[0].test.environment === 'node'` and `include` covers `.tsx`. VERIFIED — so the wiring is "add a DOM env," not "make tsx discoverable" (it already is).
- `tsconfig.base.json` excludes `**/*.test.tsx` from package builds; `tsconfig.typecheck.json` overrides that and includes `packages/*/src/**/*.tsx`. VERIFIED.
- Naming conventions (architecture §Conventions): React components `PascalCase.tsx`, ONE component per file, NO default exports except React components; other files `kebab-case.ts`; functions/vars `camelCase`; types/components `PascalCase`; consts `UPPER_SNAKE`. Follow these.

### Research-First triggers (research-first.md / Rule 3)

- **React 19.2 + `jsx: "react-jsx"`** — confirm the automatic JSX runtime config and that React 19 needs no `import React` per file. Verify against the installed `@types/react@19.2.x` `.d.ts`, not memory.
- **happy-dom vs jsdom under Vitest 4 + React 19** — confirm the chosen env supports `getComputedStyle` resolution of CSS custom properties (some DOM shims resolve `var()` incompletely). If `getComputedStyle().getPropertyValue('--token')` is the assertion, verify the chosen env returns the cascaded value; if a shim does NOT resolve `var()` substitution, assert on the custom-property value directly (which both resolve) rather than a substituted `color`. Record the verified behavior in the Dev Agent Record.
- **Vitest multi-environment** — confirm the exact supported mechanism in the INSTALLED vitest ^4.1.7 (`test.projects` per-project `environment`, `environmentMatchGlobs` status in v4, or the per-file pragma). `environmentMatchGlobs` was deprecated/removed in some v3→v4 step — verify against the installed version before using it; prefer a second project entry if unsure.

### Smoke (lead-side gate — informational)

No rendered app exists until Story 9.3, so the 9.1 smoke is a **library/CLI-style** exercise: the lead runs the real contrast utility over the SHIPPED `tokens.css` values and observes the AA floor pass for every combo, and runs the DOM consumer test against a real DOM env observing the token resolve dark→light. If a trivially-renderable static harness exists, the lead MAY additionally load `tokens.css` in chrome-devtools-mcp and read computed styles. (Method recorded at the smoke gate.)

### References

- [Source: _bmad-output/planning-artifacts/ux-designs/ux-AgentBBS-2026-05-30/DESIGN.md#Colors] — canonical hex, per-surface model, contrast targets table.
- [Source: DESIGN.md#Typography] — two-family split; long-form body 13px/1.62 within ~72ch; per-role sizes.
- [Source: DESIGN.md front-matter `colors:`/`typography:`/`rounded:`/`spacing:`] — exact token values.
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 9 / Story 9.1] — ACs.
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — ui-shared shared-core, build-once-mount-twice, per-surface delta; #Selected Toolchain (Vite 8 / React 19); #Conventions (naming).
- [Source: vitest.config.ts] — single-root-config, src-alias, node environment, tsx include.
- [Source: pnpm-workspace.yaml] — catalog pins (React/Vite/markdown stack) + allowBuilds.
- [Source: _bmad-output/implementation-artifacts/9-0-epic-8-deferred-cleanup.md] — Action B (this story owns the UI test-tier wiring + build-graph integration).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad dev-story stage under /epic-cycle).

### Debug Log References

- Honest gate (final): `pnpm run lint` → 0 problems; `pnpm run build` → all 7 packages Done; `pnpm run typecheck` → 0 errors; `pnpm test` → 105 files / 724 tests passed (baseline 709 → +15); `pnpm run format --check` → clean.
- Mutation tests (Rule 7), tokens.css backed up + restored BYTE-IDENTICAL (`cmp` confirmed):
  - Weakened dark `--text-muted` `#858585`→`#6a6a6a` → contrast.test.ts RED on the text-muted edge floor. Reverted → green.
  - Broke light `--text-body` `#1e1e1e`→`#abcdef` → TokenProbe.test.tsx RED on the light-flip assertion (read `#abcdef`, proving the `[data-theme='light']` cascade genuinely resolves in happy-dom, not a stale dark value). Reverted → green.

### Completion Notes List

- **Research-First verifications (Rule 3 / research-first.md), confirmed against installed types/runtime:**
  - React 19.2 + `jsx: "react-jsx"`: NO per-file `import React` needed (confirmed `react/jsx-runtime` + `@types/react@19.2.15/jsx-runtime.d.ts` present). TokenProbe.tsx uses a TYPE-ONLY `import type { CSSProperties }`.
  - Vitest 4.1.7 multi-env: confirmed `BuiltinEnvironment = "node"|"jsdom"|"happy-dom"|"edge-runtime"` and that `environmentMatchGlobs` is ABSENT from the v4 types (removed). Used a second `test.projects[]` entry — the supported mechanism.
  - happy-dom CSS custom properties: EMPIRICALLY verified (the DOM test passes + the mutation flips it). happy-dom resolves a custom property read on the element it is DECLARED on — `getComputedStyle(document.documentElement).getPropertyValue('--token')` against `:root` — and the `[data-theme='light']` attribute selector flips it. It does NOT reliably do `var()` substitution into `getComputedStyle(child).color`, so the AC3 assertion reads the property at its `:root` declaration site (the cascade source the consumer relies on) rather than a substituted child color. The component-render half asserts the component mounts and carries the `var(--text-body)` reference into the live DOM (`probe.style.color === 'var(--text-body)'`).
- **Contrast test source of truth (Rule 10 spirit):** Approach 2 — `contrast.test.ts` PARSES `tokens.css` directly (dark `:root` block + light `:root[data-theme='light']` block as separate scopes) and runs the shipped `contrastRatio` over the parsed hex. No hand-copied hex list. Per-combo floor encoded (4.5 small text; 3 for the one LARGE/UI-only color, agreed-green-on-white 3.4:1) so the agreed-green light row does not false-fail a blanket 4.5.
- **DESIGN.md reference-value discrepancy (NOT a defect, NOT a Rule-5 tripwire):** the contrast cross-check found `--text-body` light (`#1e1e1e` on `#ffffff`) computes true WCAG 16.67, but DESIGN.md's table documents 17.4 (Δ≈0.73). This is a minor inaccuracy in the planning doc's measured-reference column; the AA floor (≥4.5) is met with vast margin, so the token value is correct. The cross-check tolerance is 1.0 (catches a wrong-pair resolution, which is off by whole integers, while absorbing the doc rounding). Documented inline in contrast.test.ts. Not amended in DESIGN.md (it is a non-load-bearing reference number, and the spec is `status: final`); surfaced here for the reviewer.
- **In-story AC/Dev-Notes reconciliation (Rule 8):** Task 2's first subtask listed `*-light`-SUFFIXED custom-property names (`--text-dim-light`, etc.), which contradicts the Dev Notes design ("the light ramp REDEFINES the SAME names; do not invent `*-light` consumer tokens"). Implemented the ratified Dev Notes design — those roles are encoded as the same names redefined under the light selector. No `*-light` consumer-facing tokens exist.
- **Module boundary (NFR2):** ui-shared imports only `react`/`react-dom` + node builtins (in tests). No `@agentbbs/core` / `@agentbbs/data-access` import. Lint (boundary rules) green.
- **tokens.css shipping:** `tsc` does not copy `.css`, so `dist/` has no `tokens.css`. Added a `./tokens.css` subpath export pointing at `src/tokens.css` (+ `src/tokens.css` to `files`) so the stylesheet is reachable by a bundling consumer (Vite, Story 9.3) rather than orphaned. The web host wiring (how/where the stylesheet is mounted) is the Story 9.3 consumer's concern.

### File List

- `_bmad-output/implementation-artifacts/9-1-ui-shared-scaffold-and-design-token-system.md` (this story: frontmatter baseline_commit, task checkboxes, Dev Agent Record, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (9-1 → in-progress → review)
- `pnpm-workspace.yaml` (catalog: add `happy-dom: ^20.9.0`)
- `pnpm-lock.yaml` (materialized react/react-dom/@types/*/happy-dom)
- `vitest.config.ts` (second project `ui-shared-dom` @ happy-dom; exclude .test.tsx from node project)
- `tsconfig.typecheck.json` (add `jsx: react-jsx` + DOM lib for the ui-shared .tsx pass)
- `packages/ui-shared/package.json` (react/react-dom deps; @types/* + happy-dom devDeps; `./tokens.css` export)
- `packages/ui-shared/tsconfig.json` (jsx + DOM lib + `.tsx` include)
- `packages/ui-shared/src/index.ts` (barrel: export contrastRatio/relativeLuminance/hexToRgb, TokenProbe, TokenProbeProps)
- `packages/ui-shared/src/tokens.css` (NEW — semantic token core, dark + light)
- `packages/ui-shared/src/contrast.ts` (NEW — WCAG contrast utility)
- `packages/ui-shared/src/contrast.test.ts` (NEW — AC2 contrast floor, pins tokens.css)
- `packages/ui-shared/src/TokenProbe.tsx` (NEW — first token consumer)
- `packages/ui-shared/src/TokenProbe.test.tsx` (NEW — AC3 DOM integration test)

### Change Log

- 2026-06-01 — Story 9.1 implemented: `@agentbbs/ui-shared` React/TSX scaffold + `tokens.css` semantic token core (dark + light, web-canonical hex from DESIGN.md) + two-family typography encoding + WCAG `contrastRatio` utility & AA-floor test (pins shipped tokens.css, both modes, per-combo floor) + first in-package token consumer (`TokenProbe`) rendered in a happy-dom DOM test proving dark→light resolution + UI test tier wired into the default `pnpm test` (second vitest project) and the build/typecheck graph. Honest gate green (lint 0 / build all / typecheck 0 / test 724 / format clean). Both high-stakes tests mutation-verified non-vacuous.

## Review Findings (code-review stage, 2026-06-01)

**Verdict: APPROVE.** All 3 ACs met. Honest gate re-run green by the reviewer: build all 7 packages Done · typecheck 0 errors · default `pnpm test` = **728 passed** (724 dev count + 4 from QA's `tokens.test.ts` token-core completeness guard). No HIGH, no MED. Two LOW polish items deferred. The two dev/QA-surfaced adjudication items are confirmed correctly disposed.

### AC verification

- **AC1 (semantic roles + typography):** PASS. `tokens.css` encodes every DESIGN.md `colors:` role in both the dark `:root` and light `:root[data-theme='light']` scopes (verified against the DESIGN.md `colors:` block; QA's `tokens.test.ts` pins the full 29-role vocabulary to the shipped file and asserts dark↔light symmetry). Radii/spacing/two-family typography split (`--font-ui`/`--font-mono`) + per-role size/weight/line-height encoded. Long-form body = 13px / 1.62, `--measure: 760px` shipped verbatim — DESIGN.md itself annotates 760px as "~72ch" (`spacing.measure: 760px # … (~72ch)`), so the 760px token IS the ratified spec value; the "~72ch" is the doc's own approximation. Not a defect.
- **AC2 (measured AA floor, both modes):** PASS, genuinely MEASURED not asserted (Rule 5 clear). `contrast.test.ts` parses the SHIPPED `tokens.css` (Approach 2 — no hand-copy, Rule 10 satisfied) and runs the real `contrastRatio` over the parsed hex, per-combo floor (4.5 small-text; 3 for the one LARGE/UI-only agreed-green-on-white row). Reviewer independently recomputed all 10 combos with an out-of-band WCAG implementation: every combo clears its floor (lowest small-text = `text-muted` dark 4.518 ≥ 4.5 strict; agreed-green-light 3.392 ≥ 3). Mutation-verified non-vacuous by the reviewer (weakening `--text-muted`→`#6a6a6a` turned it RED), tokens.css restored byte-identical (cmp).
- **AC3 (Integration AC — token core consumable by a React surface):** PASS, REAL runtime (Rule 1 + Rule 3 clear). `TokenProbe.test.tsx` runs under the `ui-shared-dom` happy-dom project, `createRoot().render()`s the real `TokenProbe` component into a live DOM, and asserts it mounted (`textContent`, `style.color === 'var(--text-body)'`) — a genuine render, not a stub. The token-resolution half reads `getComputedStyle(documentElement).getPropertyValue('--text-body')` = `#d4d4d4` dark, flips to `#1e1e1e` under `data-theme="light"`, and back. Reviewer mutation-verified the flip non-vacuous (breaking light `--text-body` → RED), restored byte-identical.

### Adjudication of the two surfaced items

1. **DESIGN.md text-body-light reference value 17.4 vs true WCAG 16.671 (Δ≈0.729):** Disposition CONFIRMED CORRECT. Reviewer's independent math = 16.671 (dev said 16.67 — matches). This is a non-load-bearing reference number in a `status: final` planning doc; the load-bearing AA floor (≥4.5) is met with ~3.7× margin. **NOT a Rule-5 NFR tripwire** — Rule 5 fires when an NFR is unmeasurable / impossible / contradictory / un-implementable; here the NFR (AA contrast) is fully measurable, measured, and PASSES. A slightly-off documentation reference number is a doc nit, not an un-implementable NFR. The test's 1.0 cross-check tolerance correctly absorbs the doc rounding while still catching a wrong-pair resolution (off by whole integers). Leaving DESIGN.md unamended is acceptable. (Optional LOW below.)
2. **In-story Rule-8 contradiction (`*-light`-suffixed token NAMES in Task 2 parenthetical vs the Dev Notes "redefine the same names" design):** Reconciliation CONFIRMED SOUND. The Dev Notes design (line ~88) is the ratified one and matches the DESIGN.md intent ("one token core, per-surface theming" — consumers read `var(--text-body)` and get the active-theme value). `tokens.css` correctly redefines the SAME names under the light selector; there are NO `*-light` consumer-facing tokens (grep-confirmed). The `-light` suffix in DESIGN.md is a prose disambiguator only. Implementing the ratified Dev Notes design over the contradictory subtask parenthetical is exactly Rule 8 done right.

### Invariants confirmed

- **Single-root-config:** PASS. The happy-dom DOM env is a SECOND `test.projects[]` entry in the ONE root `vitest.config.ts` (`name: 'ui-shared-dom'`), with the `.test.tsx` glob EXCLUDED from the node project so each UI test runs in exactly one env. No per-package vitest config. `environmentMatchGlobs` correctly avoided (removed in vitest 4).
- **Module boundary (NFR2):** PASS. `ui-shared/src` imports only `react`/`react-dom`/`node:*` (in tests) — zero `@agentbbs/core` / `@agentbbs/data-access` imports (the only mentions are in comments). grep-confirmed.
- **Build-honesty:** PASS. The cross-package `paths` and the new `jsx`/DOM-`lib` widening live ONLY in `tsconfig.typecheck.json` (the aggregate no-emit pass) — NOT in `tsconfig.base.json`. The per-package `tsconfig.json` adds `jsx`/DOM-lib scoped to ui-shared (the only .tsx package), which does not leak to the node packages (each has its own tsconfig with base `lib: ["ES2023"]`); `pnpm run build` stays the shipped-artifact / no-DOM guard. `tokens.css` reachable via the `./tokens.css` subpath export (tsc does not copy .css; export points at `src/`).

### LOW findings (deferred — non-blocking)

- **9.1-L1 (test hygiene):** `TokenProbe.test.tsx` emits `Warning: The current testing environment is not configured to support act(...)` on stderr because `globalThis.IS_REACT_ACT_ENVIRONMENT` is unset. The render test still genuinely renders and asserts correctly (not vacuous — proven by the mutation flip), so this is cosmetic noise, not a correctness defect. Suggest setting `IS_REACT_ACT_ENVIRONMENT = true` in a small DOM-project setup file (or per-file) when Story 9.2 adds more component tests, to silence the warning and make `act()` flush effects properly. Deferred to the first feature-component story (9.2).
- **9.1-L2 (doc accuracy, optional):** DESIGN.md row 339 documents the text-body-light contrast as 17.4:1; true WCAG = 16.671:1 (item 1 above). Non-load-bearing reference number; AA met with vast margin. Optional one-character correction to DESIGN.md if a future doc-accuracy pass touches that table; not required now (spec is `status: final`, value is non-load-bearing, and the test documents the discrepancy inline). Deferred.
