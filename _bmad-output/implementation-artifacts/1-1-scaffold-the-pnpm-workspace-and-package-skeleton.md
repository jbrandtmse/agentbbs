---
story_id: "1.1"
story_key: "1-1-scaffold-the-pnpm-workspace-and-package-skeleton"
epic: 1
baseline_commit: "a5e294707118a886a8d5e60ef701ed45f0100c68"
---

# Story 1.1: Scaffold the pnpm workspace and package skeleton

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer building AgentBBS,
I want the pnpm-workspace monorepo with all packages and apps scaffolded,
so that every later capability has its home and the team builds against one consistent structure.

## Acceptance Criteria

**AC1 — Workspace layout & package skeletons**
**Given** an empty repository on Node 24 LTS with pnpm 11.3,
**When** I run the scaffold and `pnpm install`,
**Then** `pnpm-workspace.yaml` declares `packages/*` and `apps/*`, and the tree contains `packages/{core,data-access,mcp-server,cli,ui-shared}`, `apps/{web,vscode-extension}`, and `integration/bmad/`,
**And** each package has its own `package.json` with a `kebab-case` name, an `src/index.ts` barrel, and a `tsconfig.json` extending the root base,
**And** inter-package references use `workspace:*` and a shared catalog keeps common dependency versions aligned,
**And** `pnpm install` completes with a single root lockfile and no errors.

**AC2 — Strict ESM build is green**
**Given** the scaffolded workspace,
**When** I run `pnpm -r build`,
**Then** every package compiles as ESM with strict TypeScript and produces output without errors.

## Integration ACs

This is a **foundational scaffold story** — it introduces empty package *skeletons* (barrels with placeholder exports), not a runtime service with behavior. Per skill-rules Rule 1, no Integration AC of the "consumer reads service → observable effect" form applies yet.

- **First consumers of these skeletons:** Story 1.2 (toolchain + lint boundaries operate on this structure), Story 1.3 (`core/events`, `core/ports.ts`, `core/errors.ts` land in the `core` skeleton), Story 1.4 (`data-access` connection lands in the `data-access` skeleton).
- **Verification surface for this story:** the build itself — `pnpm install` produces one lockfile with no error, and `pnpm -r build` compiles every package barrel in topological order. This is exercised by the QA stage (CLI/build invocation with exit-code + produced-output assertions) and the lead's per-story smoke.

## Consumed-by

- Story 1.2 — Shared toolchain & boundary enforcement (adds ESLint/Prettier/Vitest/CI onto this scaffold).
- Story 1.3 — Event vocabulary, DataAccess port, error model (fills the `core` skeleton).
- Story 1.4 — SQLite connection, concurrency mode, DB discovery (fills the `data-access` skeleton).
- All later epics — every package created here is the home for that capability (see Requirements→Structure map in architecture.md).

## Tasks / Subtasks

- [x] **Task 1: Workspace root files** (AC: 1)
  - [x] Create `pnpm-workspace.yaml` declaring `packages: ['packages/*', 'apps/*']` and a `catalog:` block pinning shared versions (see Dev Notes → Versions).
  - [x] Create root `package.json` (private, `"type": "module"`) with workspace scripts: `build` (`pnpm -r build`), and placeholders for `test`/`lint`/`ui` to be wired in Story 1.2 (a no-op or `echo` is acceptable now — do NOT add ESLint/Vitest config here; that is Story 1.2).
  - [x] Create `tsconfig.base.json` at the root: strict ESM (`"strict": true`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, modern `target`/`lib`, `"declaration": true`, `"composite": true` for project references). Packages extend this and never redefine it.
  - [x] Ensure `.gitignore` ignores `.agentbbs/`, `dist/`, `node_modules/`, `*.vsix` (extend the existing `.gitignore`; do not clobber existing entries). — Already present in the committed `.gitignore`; verified, not clobbered.
  - [x] Pin the package manager: add `"packageManager": "pnpm@11.3.x"` to root `package.json` (use the exact 11.3 patch in the environment). — Pinned `pnpm@11.3.0`.
- [x] **Task 2: `packages/*` skeletons** (AC: 1, 2)
  - [x] For each of `core`, `data-access`, `mcp-server`, `cli`, `ui-shared`: create `package.json` (kebab-case scoped name `@agentbbs/<dir>`, `"type": "module"`, `exports`/`main`/`types` pointing at the compiled barrel, a `build` script `tsc -b` or `tsc -p tsconfig.json`), `src/index.ts` (placeholder barrel export), and `tsconfig.json` extending `../../tsconfig.base.json` with `outDir: dist` and `rootDir: src`.
  - [x] Wire inter-package dependencies as `workspace:*` to reflect the dependency arrows (clients → core → ports ← data-access): `mcp-server` and `cli` depend on `@agentbbs/core` (+ `@agentbbs/data-access` where the architecture shows it); `apps/web` and `apps/vscode-extension` depend on `@agentbbs/ui-shared`. Use TypeScript project `references` matching these edges so `tsc -b` resolves cross-package types.
  - [x] Do NOT add heavy third-party/native runtime deps yet (e.g. `better-sqlite3`, `@modelcontextprotocol/sdk`, `react`, `vite`) — declare their versions in the catalog only; the owning story adds the actual dependency. (Rationale: keep `pnpm install` fast and avoid premature native builds; better-sqlite3 lands in Story 1.4.)
- [x] **Task 3: `apps/*` and `integration/bmad/` skeletons** (AC: 1, 2)
  - [x] Create `apps/web` and `apps/vscode-extension` with the same skeleton shape (kebab-case `package.json`, `src/index.ts` placeholder, `tsconfig.json` extending base). Keep them buildable as plain TS now; Vite/esbuild config is deferred to Epics 9/10.
  - [x] Create `integration/bmad/` as a directory placeholder (it holds non-code assets per AR24; a `.gitkeep` or a short `README.md` is sufficient — it is NOT a pnpm package and must NOT be matched by the workspace globs as a buildable package).
- [x] **Task 4: Install & build verification** (AC: 1, 2)
  - [x] Run `pnpm install`; confirm exactly one root `pnpm-lock.yaml` and zero errors.
  - [x] Run `pnpm -r build`; confirm every package compiles (strict ESM) with no errors and emits `dist/`.
  - [x] Record exact tool versions (`node -v`, `pnpm -v`) in the Dev Agent Record.

## Dev Notes

### Scope boundary (read first)
This story is **scaffold only**: directory structure, `package.json`/`tsconfig` per package, `workspace:*` wiring, catalog, root `tsconfig.base.json`, and a green `pnpm install` + `pnpm -r build`. **Out of scope** (explicitly deferred — do not implement here): ESLint config + import-boundary/naming rules, the append-invariant lint rule, `.prettierrc`, `vitest.workspace.ts`, and `.github/workflows/ci.yml` — **all of these are Story 1.2**. Event vocabulary / ports / errors are Story 1.3. SQLite is Story 1.4.

### Target directory structure (authoritative)
Build exactly this top-level shape [Source: architecture.md#Complete Project Directory Structure]:
```
packages/{core,data-access,mcp-server,cli,ui-shared}/  # each: package.json, src/index.ts, tsconfig.json
apps/{web,vscode-extension}/                            # each: package.json, src/index.ts, tsconfig.json
integration/bmad/                                       # non-code asset dir placeholder (not a package)
pnpm-workspace.yaml  package.json  tsconfig.base.json  .gitignore
```
Only create the per-package `src/index.ts` barrel + skeleton now; the inner `src/` subtrees (`core/events`, `core/domain`, `data-access/sqlite`, `mcp-server/tools`, etc.) are populated by their later stories — do not pre-create empty stubs for them.

### Versions (pin in the catalog) [Source: project-context.md#Technology Stack & Versions; architecture.md#Selected Toolchain]
- Node.js **24 LTS**; TypeScript **strict, ESM**; pnpm **11.3** (workspaces + catalogs; one lockfile; `workspace:*`).
- Catalog entries to declare now (referenced by later stories): `@modelcontextprotocol/sdk` **1.29.0** (pin the minor), **Zod v4**, **better-sqlite3** (current), **Vite 8.0.x** + `@vitejs/plugin-react` v6+, markdown-it + DOMPurify + Shiki, Vitest. Declaring a catalog version does not install it until a package references it.
- **Research-First** ([Source: .claude/rules/research-first.md]): the stack is leading-edge (Node 24, pnpm 11.3 catalogs, TS NodeNext ESM, project references). Before finalizing `tsconfig.base.json` and the `build` wiring, verify current pnpm-11 catalog syntax and the correct NodeNext/`composite` settings against authoritative docs (pnpm + TypeScript) rather than relying on memory. Confirm exact `engines`/`packageManager` patch from the environment.

### Architectural rules this scaffold must encode [Source: project-context.md; architecture.md#Architectural Boundaries]
- **Module-boundary dependency arrow (load-bearing, NFR2):** clients → `core` → `ports` ← `data-access`. `core` depends on nothing from clients or `better-sqlite3`. Only `data-access` will import `better-sqlite3`. Wire `workspace:*` deps to *reflect* this now; the lint enforcement that *guarantees* it is Story 1.2.
- **Barrel-only imports:** every package exposes its public API via `src/index.ts` only; cross-package imports must target the package name (barrel), never deep paths. Set package `exports` to expose only the barrel.
- **One config at the root; packages extend, never redefine** (one `tsconfig.base.json` now; ESLint/Prettier/Vitest follow in 1.2).
- **File naming:** `kebab-case.ts` files; packages `kebab-case`; no default exports except React components. (Lint-enforced in 1.2; follow it now so 1.2 starts clean.)

### Build model
- Use TypeScript **project references** (`composite: true` in base; `references` in each package tsconfig matching the `workspace:*` edges) so `tsc -b` / `pnpm -r build` resolves cross-package types in dependency order. `pnpm -r build` runs each package's `build` script topologically (pnpm orders by `workspace:*` graph).
- Each package emits to its own `dist/`; `package.json` `exports`/`types` point at the compiled barrel so a consumer importing `@agentbbs/core` resolves the built output.

### Testing standards [Source: project-context.md#Testing]
- The project standard is **Vitest, co-located `*.test.ts(x)`, one root `vitest.workspace.ts`** — but the Vitest config and any tests are **Story 1.2 and beyond**. For *this* story the verification is the build/install gate (AC2). Do not add a Vitest config or test files here. The QA stage will assert on `pnpm install` / `pnpm -r build` exit codes and emitted `dist/`.

### Project Structure Notes
- `integration/bmad/` must not be a buildable pnpm package — keep the workspace globs to `packages/*` + `apps/*` so it is excluded. It is a home for Markdown/TOML assets (AR24), populated in Epic 7/8.
- The repo currently contains planning artifacts under `_bmad-output/`, BMad tooling under `_bmad/`, and `docs/` — leave these untouched. The scaffold adds `packages/`, `apps/`, `integration/`, and the root config files alongside them.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1: Scaffold the pnpm workspace and package skeleton]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — AR1]
- [Source: _bmad-output/planning-artifacts/architecture.md#Foundation Approach / Selected Toolchain / Proposed Workspace Layout]
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure]
- [Source: _bmad-output/planning-artifacts/architecture.md#Architectural Boundaries / File Organization Patterns / Development Workflow Integration]
- [Source: _bmad-output/project-context.md#Technology Stack & Versions / Module boundaries / Development workflow]
- [Source: .claude/rules/research-first.md]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — BMAD `bmad-dev-story` workflow under `/epic-cycle`.

### Debug Log References

**Verified tool versions (environment):**
- `node -v` → `v24.16.0`
- `pnpm -v` → `11.3.0`
- `pnpm exec tsc -v` → `Version 6.0.3`

**`pnpm install` (AC1 — exit 0, single root lockfile):**
```
Scope: all 8 workspace projects
devDependencies:
+ @types/node 24.12.4 (25.9.1 is available)
+ typescript 6.0.3
Done in 4.3s using pnpm v11.3.0
---INSTALL EXIT: 0---
```
Only the two catalog-referenced root devDeps were fetched; the unreferenced catalog
entries (better-sqlite3, MCP SDK, react, vite, etc.) were declared but not installed,
keeping install fast as the scope boundary requires. Exactly one `pnpm-lock.yaml`
exists at the repo root (verified via `find`); no per-package lockfiles. Lockfile
records the resolved `catalogs:` section.

**`pnpm -r build` (AC2 — exit 0, strict ESM, dist/ emitted):**
```
Scope: 7 of 8 workspace projects
packages/core build: Done
packages/ui-shared build: Done
packages/data-access build: Done
apps/web build: Done
packages/cli build: Done
apps/vscode-extension build: Done
packages/mcp-server build: Done
---BUILD EXIT: 0---
```
pnpm ran each package's `tsc -b` in topological order off the `workspace:*` graph
(leaves `core`/`ui-shared` first → `data-access`/`web` → `cli`/`mcp-server`/`vscode-extension`).
The root package is excluded from `-r` (it only orchestrates), hence "7 of 8".
Every package emitted `dist/index.js` + `dist/index.d.ts` (+ source/declaration maps).
Emitted JS confirmed genuine ESM (`export const …`). Build artifacts (`dist/`,
`*.tsbuildinfo`) confirmed git-ignored — clean working tree (only source + config +
lockfile tracked).

### Completion Notes List

- **Scaffold-only, as scoped.** No ESLint/Prettier/Vitest/CI (Story 1.2), no
  events/ports/errors (Story 1.3), no SQLite (Story 1.4). Heavy/native runtime deps
  (better-sqlite3, MCP SDK, react, vite, markdown stack) are declared in the catalog
  only — not installed.
- **Dependency arrows encoded via `workspace:*` + TS project `references`:**
  `core` (leaf) ← `data-access` ← {`mcp-server`, `cli`}; `ui-shared` (leaf) ← `apps/web`;
  `ui-shared` + `data-access` ← `apps/vscode-extension` (the extension host opens the DB
  via data-access per architecture.md §VS Code surface, lines 285/557). `core` references
  nothing from clients or better-sqlite3 — the NFR2 boundary is reflected structurally now;
  lint *enforcement* is Story 1.2.
- **Barrel-only public surface:** each `package.json` `exports` exposes only `.` → the
  compiled `dist/index.js` / `dist/index.d.ts`; no deep-path entry points.
- **`integration/bmad/`** is a non-package placeholder (a `README.md`); it is excluded
  from the workspace globs (`packages/*`, `apps/*`) so pnpm never treats it as buildable.
- **Research-First applied** (stack is leading-edge): verified pnpm-11 catalog syntax
  (top-level default `catalog:` + `"catalog:"` protocol), TS NodeNext + `composite`
  project-reference build wiring, and all catalog versions against the live npm registry
  on 2026-05-30.
- **`.gitignore` already covered** `.agentbbs/`, `dist/`, `node_modules/`, `*.vsix`
  (plus `*.tsbuildinfo`) — verified and left untouched (no clobber), satisfying the
  Task 1 subtask without a redundant edit.

### Decision: TypeScript pinned to 6.0.3 (npm `latest`)

The story/architecture says "TypeScript (strict, ESM)" without pinning a major. The
npm registry `latest` on 2026-05-30 is **TypeScript 6.0.3** (6.0 is GA; 5.9.3 is the
last 5.x). Pinned **6.0.3** in the catalog so the team "builds against one consistent
structure" on the project's leading-edge posture. Per Research-First, verified TS 6.0
keeps `module: NodeNext` + `moduleResolution: NodeNext` + `composite` + `declaration` +
`tsc -b` build mode fully supported. TS 6.0 default changes that *could* bite later
stages were checked and are safe for these skeletons: `strict` now defaults on (we set
it explicitly), default `moduleResolution` is now `bundler` if unspecified (we set
NodeNext explicitly), `@types` auto-discovery is now off (skeleton barrels use no
ambient Node types yet; root `@types/node` is declared for when code lands),
`noUncheckedSideEffectImports` defaults on (no side-effect imports in barrels). No NFR
tripwire (Rule 5): no NFR was unmeasurable/contradictory. No ADRs exist (`docs/adr/`
absent), so Rule 6 has nothing to check.

### File List

**Added (root config):**
- `pnpm-workspace.yaml`
- `package.json`
- `tsconfig.base.json`
- `pnpm-lock.yaml` (generated by `pnpm install`)

**Added (packages):**
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/index.ts`
- `packages/data-access/package.json`
- `packages/data-access/tsconfig.json`
- `packages/data-access/src/index.ts`
- `packages/mcp-server/package.json`
- `packages/mcp-server/tsconfig.json`
- `packages/mcp-server/src/index.ts`
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/src/index.ts`
- `packages/ui-shared/package.json`
- `packages/ui-shared/tsconfig.json`
- `packages/ui-shared/src/index.ts`

**Added (apps):**
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/web/src/index.ts`
- `apps/vscode-extension/package.json`
- `apps/vscode-extension/tsconfig.json`
- `apps/vscode-extension/src/index.ts`

**Added (integration):**
- `integration/bmad/README.md`

**Modified (planning/tracking):**
- `_bmad-output/implementation-artifacts/1-1-scaffold-the-pnpm-workspace-and-package-skeleton.md` (this story file: frontmatter `baseline_commit`, task checkboxes, Dev Agent Record, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status → in-progress → review; last_updated)

### Review Findings

**Stage:** `bmad-code-review` (epic-cycle code review), 2026-05-30. Branch `AGENTBBS-1-epic1`. Reviewer model: claude-opus-4-8 (1M context).

**Verdict: CLEAN REVIEW — zero actionable findings.** All three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) were exercised inline; every candidate finding was dismissed as a false positive or confirmed correct against the authoritative architecture. No `decision-needed`, no `patch`, no `defer`. No `deferred-work.md` entry required.

**Independent verification performed (not trusted from the dev/QA report):**
- `pnpm -r build` re-run from a cleaned dist — exit 0; 7 of 8 projects compile via `tsc -b` in topological order (root orchestrator excluded). Every package emits `dist/index.js` + `dist/index.d.ts` (+ source/decl maps). Confirmed (AC2).
- Emitted barrel is genuine strict ESM — `export const CORE_PACKAGE = …` in `packages/core/dist/index.js` (AC2).
- `pnpm install --frozen-lockfile` — exit 0, lockfile consistent; exactly one root `pnpm-lock.yaml`, no per-package lockfiles; lockfile records the `catalogs:` section (AC1).
- No premature heavy/native deps installed — `node_modules` top level contains no better-sqlite3 / MCP SDK / react / vite / zod / shiki / markdown-it / dompurify / vitest. Only `typescript` + `@types/node` (the two catalog-referenced root devDeps) fetched. Scope discipline holds.
- `dist/` + `*.tsbuildinfo` git-ignored — clean working tree, no build artifacts staged.
- Tool versions match: Node v24.16.0, pnpm 11.3.0, tsc 6.0.3.

**Scope & boundary checks (vs architecture.md + project-context.md):**
- Workspace layout matches `architecture.md#Complete Project Directory Structure` exactly: `packages/{core,data-access,mcp-server,cli,ui-shared}` + `apps/{web,vscode-extension}` + `integration/bmad/` (non-package placeholder, correctly excluded from `packages/*`/`apps/*` globs — build ran 7-of-8, integration never built). Each package has kebab-case scoped name `@agentbbs/<dir>`, `src/index.ts` barrel, `tsconfig.json` extending `../../tsconfig.base.json` and only setting `rootDir`/`outDir` (extends, never redefines).
- Strict ESM genuinely enforced: root `tsconfig.base.json` sets `"strict": true`, `module`/`moduleResolution` = `NodeNext`, `composite: true`, `declaration: true`, `verbatimModuleSyntax: true`; every package `"type":"module"` with barrel-only `exports` (`.` → compiled `dist`).
- Module-boundary arrows wired via `workspace:*`: `core` (leaf, depends on nothing), `data-access → core`, `mcp-server → {core, data-access}`, `cli → {core, data-access}`, `web → ui-shared`, `vscode-extension → {ui-shared, data-access}`. TS project `references` mirror each edge. `core` references nothing from clients or better-sqlite3 (NFR2 boundary reflected structurally; lint enforcement is Story 1.2). Only `data-access` will own better-sqlite3 (catalog-declared, uninstalled).

**Candidate findings raised and dismissed (audit trail):**
- *(Blind) clients `mcp-server`/`cli` depend on `data-access` directly rather than receiving `DataAccess` purely via DI* — **DISMISSED.** Matches authoritative architecture: `architecture.md` line 502 explicitly lists `data-access` as an `mcp-server` dependency, and line 409 permits "clients import `core`/`data-access`". The server/CLI are the composition root that wires the concrete `DataAccess` into core. The lint boundary enforces `core ✗→ data-access`, not `client ✗→ data-access`. Not a violation.
- *(Blind) apps shaped like libraries (`exports`/`files:["dist"]`)* — **DISMISSED.** Cosmetic; harmless for plain-TS skeletons. Real app build config (Vite/esbuild) is deferred to Epics 9/10 per explicit story scope.
- *(Edge) `vscode-extension` is `"type":"module"` though VS Code extensions are historically CJS* — **DISMISSED.** Architecture specifies esbuild single-bundle for the extension (lines 170/555/661), which transpiles ESM source to the host's required format at Epic 10; ESM source is consistent with the strict-ESM-everywhere posture. Correct for the skeleton.
- *(Edge) `@types/node` declared but barrels use no Node types* — **DISMISSED.** Pre-declared root ambient type root; harmless, no premature heavy dep.

**Skill-rule cross-checks:**
- **Rule 1 (Integration ACs):** PRESENT and adequate — story has an `## Integration ACs` section declaring this a foundational scaffold story with no runtime service yet, naming future consumers (1.2/1.3/1.4). No `consumer→effect` AC applies. PASS.
- **Rule 3 (real-runtime test evidence):** EXEMPT and exemption is CORRECT — pure build-pipeline story, genuinely no user-facing surface (barrels export only string-constant markers; no UI/CLI command/API). No HIGH for "no tests." PASS.
- **Rule 5 (NFR tripwire):** No NFR worked around with comments + deferred-work. No tripwire. PASS.
- **Rule 6 (ADR violations):** `docs/adr/` does not exist — no ADRs to cross-check. No-op confirmed. PASS.
- **Rule 8 (test discoverability):** QA added zero test files; confirmed no `*.test.ts`/`*.spec.ts` anywhere and no competing runner. No undiscoverable/orphan test. PASS.

**Recommended status:** `done` (no unresolved findings). Status transition + commit deferred to the lead's per-story smoke gate per epic-cycle sequencing.

## Change Log

- 2026-05-30 — Story 1.1 implemented: scaffolded the pnpm 11.3 workspace (5 packages + 2 apps + `integration/bmad/` placeholder), root `tsconfig.base.json` (strict NodeNext ESM + composite), default `catalog:` of pinned shared versions, and `workspace:*` + TS project-reference wiring reflecting the `clients → core → ports ← data-access` boundary. Verified `pnpm install` (single root lockfile, exit 0) and `pnpm -r build` (all 7 packages compile strict ESM, exit 0, emit `dist/`). Pinned TypeScript 6.0.3. Status → review.

## QA Results

**Stage:** `bmad-qa-generate-e2e-tests` (epic-cycle QA), 2026-05-30. Branch `AGENTBBS-1-epic1`.

### Outcome: NO test files generated (build-pipeline exemption)

**Rule 3 (real-runtime test evidence) — EXEMPT, noted explicitly.** Story 1.1 is a pure build-pipeline / scaffold story. Its only deliverable is directory structure, per-package `package.json`/`tsconfig`, `workspace:*` + project-reference wiring, the catalog, and a green install + build. There is **no user-facing runtime surface** (no UI, no CLI command, no API/service) — so per skill-rules Rule 3, pure non-user-facing (build pipeline) stories are exempt from real-runtime test artifacts. The verification surface is the build gate itself (AC2).

**Rule 8 (test discoverability) — no orphan test created.** The project's test runner is **Vitest + a single root `vitest.workspace.ts`**, which is **explicitly deferred to Story 1.2** and does not exist yet:
- No `vitest.workspace.ts` (and no Vitest dependency) in the repo — verified.
- No `*.test.ts`/`*.spec.ts` files exist — verified.
- Root `package.json` `test` script is a placeholder (`echo "no tests yet — wired in Story 1.2" && exit 0`).

Adding a test file now would be **undiscoverable** by any default suite (a HIGH finding on later review per Rule 8), and standing up a second runner would violate the project's "one root Vitest, packages extend" standard. Therefore **no test file and no competing runner were introduced.** The build-verification test (assert `pnpm -r build` exit 0 + emitted `dist/`) belongs in **Story 1.2**, once Vitest and the root workspace config land and the `test` script is wired.

### Build-gate verification performed live by QA (in lieu of an artifact test)

| AC | Check | Result |
| --- | --- | --- |
| AC1 | `pnpm install --frozen-lockfile` (scope: all 8 workspace projects) | exit 0 — "Already up to date"; lockfile consistent with manifests |
| AC1 | Single root `pnpm-lock.yaml`, no per-package lockfiles | confirmed (one root lockfile, no nested) |
| AC2 | `pnpm -r build` (scope: 7 of 8 — root orchestrator excluded) | exit 0 — all packages `tsc -b` Done in topological order |
| AC2 | Emitted output is genuine strict ESM | confirmed (`export const CORE_PACKAGE = …` in `packages/core/dist/index.js`) |
| — | `dist/` / build artifacts git-ignored (clean tree) | confirmed — no `dist/` entries in `git status` |

Both ACs pass on the live workspace. This live invocation is the QA evidence for the build gate; it is not an automated regression artifact (none is creatable without the deferred runner). Recommendation for code review: approve the Rule-3 build-pipeline exemption; the regression test for the build gate is correctly carried forward to Story 1.2.
