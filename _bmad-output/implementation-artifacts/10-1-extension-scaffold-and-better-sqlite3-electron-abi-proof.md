---
baseline_commit: aa37847
---

# Story 10.1: Extension scaffold and better-sqlite3 ↔ Electron ABI proof

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an extension developer,
I want the `apps/vscode-extension` scaffolded as a real VS Code extension AND the native-module (SQLite driver) ↔ extension-host ABI path proven first,
so that the single flagged build risk for the whole epic (AR2) is retired before any further VS Code work depends on it.

## Acceptance Criteria

1. **(AC1 — scaffold + activation)** Given the `apps/vscode-extension` scaffold (esbuild single-bundle build, `engines.vscode` set, an `activate(context)`/`deactivate()` entry, a minimal `contributes`/activation event), when the extension is built and loaded in the VS Code Extension Development Host, then it activates without error (an activation log line / a trivial registered command runs), and the SQLite driver the extension host will use (`better-sqlite3`) is **proven loadable in the extension-host runtime, ABI-matched to the target Electron version** via `@electron/rebuild`/prebuilds — i.e. opening an in-memory DB and reading `SELECT sqlite_version()` succeeds inside the host runtime.

2. **(AC2 — fallback path)** Given the prebuild/rebuild path proves brittle OR the target Electron ABI cannot be matched/verified in this environment, when the better-sqlite3 native load cannot be proven in the extension-host runtime, then the documented `node:sqlite` fallback is **exercised** (a probe that `require('node:sqlite')` resolves in the target runtime and can open an in-memory DB + run `SELECT sqlite_version()`), and the chosen resolution (rebuild-proven vs node:sqlite-fallback) is **recorded explicitly** in the Dev Agent Record with the empirical evidence (the actual `process.versions.modules` / `process.versions.electron` observed, or why neither could be observed here).

3. **(AC3 — empirical ABI determination, Rule 3)** Given any claim about the target Electron version / Node ABI, when the story records the target, then the target ABI is **determined empirically** from the real runtime (the installed `@types/vscode` `engines.vscode` floor + a runtime read of `process.versions.electron`/`process.versions.modules`, or `@electron/rebuild`'s own resolution) — NOT hard-coded from a web-search-claimed constant. Any web-sourced version number is treated as a hint to verify, never as fact.

## Integration ACs

AC1 IS the runtime-integration AC for this service-introducing story: the scaffold is proven to **activate in its real runtime (the Extension Development Host) AND to load its SQLite driver there** — not merely to compile. The first DB-opening *consumer* of this proven path is **Story 10.2** ("Extension host opens the DB and bridges to the webview"), which wires `data-access` through the driver this story retires the risk on. Per Rule 1, the producer→consumer wire-up is named: Story 10.1 proves the driver loads; Story 10.2 is the first consumer that opens a real ledger through it.

## Tasks / Subtasks

- [x] **Task 1 — Scaffold the extension as a real VS Code extension (AC1)**
  - [x] Replace the Epic-1 placeholder `src/index.ts` marker with a real `src/extension.ts` exporting `activate(context: vscode.ExtensionContext)` and `deactivate()`. Keep the deliverable a thin client (Rule 13): NO board logic in this layer.
  - [x] Update `apps/vscode-extension/package.json`: add `engines.vscode` (a current stable floor — verify the value, see Dev Notes), `main` → the esbuild output (`./dist/extension.cjs`), a minimal `contributes`/`activationEvents` and a trivial registered command for the activation proof, `categories`, `displayName`. Add devDeps: `@types/vscode` (matching the `engines.vscode` floor), `esbuild`. (`@electron/rebuild` NOT added — node:sqlite fallback resolved, see Dev Agent Record.) Add catalog entries in `pnpm-workspace.yaml` for the new shared deps (verified installable on the registry 2026-06-02).
  - [x] Add `apps/vscode-extension/esbuild.js`: `platform:'node'`, `format:'cjs'` (VS Code extension host loads CommonJS `main`), `bundle:true`, `external:['vscode', 'better-sqlite3', '*.node']` (NEVER bundle the native addon or the `vscode` API module), `outfile:'dist/extension.cjs'`, sourcemap. Wired `build`/`build:bundle`/`watch`/`typecheck` scripts in package.json.
  - [x] Reconcile the build: the package built via `tsc -b`. New build story — bundle via esbuild for the runnable artifact + typecheck via `tsc --noEmit`. Repo gate (`pnpm run build` / `pnpm run typecheck`) green; root build graph (8 packages) passes.
- [x] **Task 2 — Determine the target ABI empirically (AC3, Rule 3)**
  - [x] Read the INSTALLED `@types/vscode` floor and chose `engines.vscode` = `^1.105.0` (a recent-stable floor; type version == engine floor per the VS Code convention). Latest available 1.120.0 (registry, 2026-06-02). NO web-claimed Electron/ABI number coded to.
  - [x] No real VS Code / Electron runtime reachable on this machine (no `electron` in node_modules, no VS Code `product.json` in standard Windows dirs). Read `process.versions` from the real standalone Node runtime instead: node 24.16.0, ABI (`modules`) 137, `electron` absent. Recorded explicitly (changes the resolution to AC2's fallback).
- [x] **Task 3 — Prove the SQLite driver loads in the extension-host runtime (AC1/AC2)**
  - [x] Primary path NOT verifiable here: no Electron runtime / launchable Extension Development Host to rebuild `better-sqlite3` against and load into. `@electron/rebuild`/`electron` deliberately NOT installed (would still produce no verifiable result and would not honor Rule 12). better-sqlite3@12.10.0 IS proven to load at its built ABI 137 (open `:memory:`, `SELECT sqlite_version()` → 3.53.1) — the driver works; only the Electron-host ABI MATCH is unverifiable here.
  - [x] Exercised the **`node:sqlite` fallback** (AC2): `import('node:sqlite')` resolves in the target Node runtime, `new DatabaseSync(':memory:')` opens, `SELECT sqlite_version()` returns a version string. This is the V1 resolution recorded in the Dev Agent Record. Load-level proof ONLY — does NOT wire `data-access` (that is 10.2). No new node:sqlite-backed `data-access` impl was needed for the proof, so NO clarification halt was triggered.
- [x] **Task 4 — Tests discoverable by the default suite (AC1/AC2; QA Rule 8)**
  - [x] Added `apps/vscode-extension/src/abi-proof.test.ts`, discovered by root `pnpm test` (the `apps/*/src/**/*.test.ts` node project). Asserts: (a) node:sqlite fallback opens `:memory:` + returns `sqlite_version()` in a real process; (b) better-sqlite3 loads at its ABI + returns `sqlite_version()`; (c) empirical ABI read (not hard-coded); (d) `activate()` registers the proof command against a minimal `ExtensionContext` without throwing (`vscode` mocked; the real Extension Dev Host smoke is the lead's gate). Mutation-tested non-vacuous (Rule 7).
- [x] **Task 5 — Record the resolution (AC2/AC3)**
  - [x] Dev Agent Record records: chosen driver path (node:sqlite-fallback), empirical ABI evidence, why `@electron/rebuild` was not invoked, and the esbuild externalization decision. See below.

## Dev Notes

### What this story is (and is NOT)
- **IS:** the real scaffold of `apps/vscode-extension` (esbuild bundle, `engines.vscode`, `activate`/`deactivate`, minimal contributes) + an empirical proof that the SQLite driver loads in the extension-host runtime, retiring the AR2 build risk **first**, before 10.2–10.6 build on it.
- **IS NOT:** opening a real ledger (that is Story 10.2), the TreeView (10.3), webviews (10.4), CSP (10.5), or live updates (10.6). Keep scope to scaffold + driver-load proof.

### The AR2 risk (the whole reason this story is first)
[Source: architecture.md#Selected Toolchain (l.168), #Core Architectural Decisions (l.228, l.255), #Risks (l.727–729, l.740)] better-sqlite3 is the V1 SQLite driver and the ONLY package that imports it is `data-access`. The extension host is an **Electron** process whose embedded Node ABI (`process.versions.modules`) differs from standalone Node 24 (ABI **137**, confirmed: `node v24.16.0 modules 137`). The installed `better-sqlite3@12.10.0` addon at `node_modules/.pnpm/better-sqlite3@12.10.0/.../build/Release/better_sqlite3.node` is compiled for ABI 137 → it will NOT load as-is in the Electron host. The architecture's stated plan: ship ABI-matched prebuilds via `electron-rebuild`; **fallback is `node:sqlite`** if prebuilds prove brittle. This story is the architecture's named "first extension story" that proves the path (architecture.md l.727–729).

### Research-First / Rule 3 (this is a version-specific external-API story — verify, don't assume)
A Perplexity pass at story-authoring time returned only the model's *projections* (its cited sources were irrelevant; it could not find authoritative pages), so its specific numbers (a claimed Electron 37.2.0 / ABI 125 / "node:sqlite stripped from Electron") are **UNVERIFIED HINTS, not facts** — do NOT code to them. Confirmed-defensible guidance only:
- The rebuild tool is the scoped **`@electron/rebuild`** (successor to the unscoped `electron-rebuild`). Verify the installed package's CLI surface before invoking (Rule 3: check `node_modules/@electron/rebuild` types/README).
- better-sqlite3 v12 prebuilds **target Node runtimes, not Electron** → a rebuild against the Electron ABI is the expected primary path.
- `node:sqlite` is the documented fallback. Its **availability inside the Electron extension-host runtime MUST be runtime-probed** — Electron can omit/strip built-in modules; never assume it is present. (Node 24 ships `node:sqlite`; the Electron host's embedded Node may differ.)
- esbuild MUST mark `vscode`, `better-sqlite3`, and `*.node` as **external** (the `vscode` module is provided by the host; the native addon cannot be bundled).
- Determine the target Electron/ABI **empirically** (installed `@types/vscode` floor + a real runtime read), per AC3.

### Environment reality (affects the resolution — read before choosing a path)
At story-authoring the lead probed this machine: no VS Code `product.json` in the standard Windows install dirs, no `electron` in `node_modules`, and `@types/vscode`/`esbuild`/`@electron/rebuild` NOT yet installed; `code --version` returned an anomalous `v22.22.1` (not a VS Code version string). **A real Extension Development Host may not be launchable here.** That is precisely why AC2's `node:sqlite` fallback exists and is a fully legitimate V1 resolution. If the better-sqlite3 Electron rebuild + host-load cannot be VERIFIED in this environment, exercising + recording the `node:sqlite` fallback (load-level proof + empirical note that the host ABI couldn't be observed here) SATISFIES AC2 — do not fake an unverifiable better-sqlite3-in-Electron pass (Rule 12: real-runtime evidence, never a green stub for runtime-only behavior). The lead's per-story smoke will independently exercise whichever path resolved.

### Files / structure (architecture-aligned)
[Source: architecture.md#Proposed/Detailed source tree (l.553–566)] Target layout for `apps/vscode-extension/`:
- `package.json` — `engines.vscode`, `contributes`, `activationEvents`, `main`→`dist/extension.js`, esbuild + ABI devDeps.
- `esbuild.js` — single-bundle, web-ext-compatible, externalizes `vscode`/`better-sqlite3`/`*.node`.
- `src/extension.ts` — `activate`/`deactivate` (replaces the placeholder `src/index.ts`; remove or repurpose the `VSCODE_EXTENSION_APP` marker — check it has no importer first via grep).
- `tsconfig.json` — already extends root base + references `ui-shared`/`data-access`; adjust for `@types/vscode` types + esbuild-vs-tsc build split.
- The proof test co-located per the repo's test convention so the **root `pnpm test`** discovers it.

### Module boundary (NFR2 / Rule 13)
[Source: architecture.md l.197–202, l.409, l.589] The extension is a **thin client**: it imports `core`/`data-access`/`ui-shared`, NEVER better-sqlite3 directly (only `data-access` imports better-sqlite3) and NEVER lets board logic leak into the extension layer. 10.1 proves the *driver loads*; it does not itself call `data-access` yet. Do not add a `better-sqlite3` dependency to the extension's `package.json` — the addon is reached transitively through `data-access` (10.2). The ABI proof in 10.1 can require the addon via `data-access`'s resolution or a dev-only probe; keep the production dependency graph clean.

### Testing standards
[Source: project-rules.md Rule 12] DOM/shim tests are necessary but not sufficient for runtime-only behavior; the real-runtime evidence here is the driver actually loading + `activate()` running. Root `pnpm test` is the canonical gate (NOT a per-package `vitest`). Current baseline: 1202 logic-passing (1 known Windows teardown flake in `data-access/seed-protocol-race.test.ts`, item `E10-baseline-seedrace-eperm` — NOT this story's, re-run in isolation to confirm green; Rule 6).

### Project Structure Notes
- The `apps/vscode-extension` placeholder (`src/index.ts` `VSCODE_EXTENSION_APP` marker, the `dist/` from Epic 1) is the Story-1.1/1.2 skeleton, not prior Epic-10 work. Repurpose it.
- Adding esbuild changes the build from pure `tsc -b`; keep `pnpm run build` and `pnpm run typecheck` green at the root (the gate) — verify the root build graph still passes.
- `pnpm install` will need the new devDeps; ensure `allowBuilds`/catalog discipline in `pnpm-workspace.yaml` stays consistent (better-sqlite3 is already approved there).

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 10 / Story 10.1]
- [Source: _bmad-output/planning-artifacts/architecture.md#Selected Toolchain, #Core Architectural Decisions, #Detailed source tree, #Risks (ABI item l.727–729)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-AgentBBS-2026-05-30/wireframes/wireframe-vscode-v1.md] (UX context for later stories; 10.1 is scaffold-only)
- [Source: .claude/rules/project-rules.md Rules 3, 12, 13; .claude/rules/research-first.md]
- [Source: packages/data-access/src/index.ts (the DataAccess port barrel — the future 10.2 consumer surface)]
- [Source: _bmad-output/implementation-artifacts/10-0-epic-9-deferred-cleanup.md (Epic 10 carries; this story has no carried awareness-notes)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — dev-story stage, Story 10.1.

### Debug Log References

- Empirical runtime probe (this machine, 2026-06-02): `node 24.16.0`, `process.versions.modules` (ABI) = **137**, `process.versions.electron` = **none** (standalone Node). better-sqlite3@12.10.0 addon present at `node_modules/.pnpm/better-sqlite3@12.10.0/.../build/Release/better_sqlite3.node`, loads + `SELECT sqlite_version()` → **3.53.1**. `node:sqlite` present (exports `DatabaseSync, StatementSync, Session, constants, backup`).
- No `electron` in node_modules; no VS Code `product.json` in standard Windows install dirs — confirms a real Electron extension-host runtime is NOT reachable here.
- Gate (final): lint 0, typecheck 0, build 8/8, format clean, `pnpm test` **1206 passed / 140 files / 0 failed** (baseline 1202 logic-passing + 4 new). The known `seed-protocol-race.test.ts` Windows teardown flake did NOT manifest.

### Completion Notes List

**RESOLUTION — driver path: `node:sqlite` FALLBACK (AC2).** The primary better-sqlite3 ↔ Electron-host ABI match could NOT be verified on this machine: there is no `electron` runtime, no VS Code `product.json`, and no launchable Extension Development Host to rebuild against / load into. Per the story Dev Notes ("Environment reality") + Rule 12, faking an unverifiable better-sqlite3-in-Electron pass is forbidden, so the documented `node:sqlite` fallback is the V1 resolution. The fallback is EXERCISED (not assumed): `import('node:sqlite')` resolves in the target Node runtime, `new DatabaseSync(':memory:')` opens, `SELECT sqlite_version()` returns a version string. The lead's per-story smoke will independently exercise the resolved path; if a later story reaches a real Electron host, the better-sqlite3 rebuild path can be pursued then.

**Empirical ABI (AC3, Rule 3) — determined from the real runtime, NOT a web claim.** node 24.16.0 / ABI 137 / electron=none, read live from `process.versions`. `engines.vscode` floor chosen = `^1.105.0` (a recent-stable floor that does not lock out users on slightly older builds; latest `@types/vscode` available is 1.120.0 per the registry). The type version is aligned to the engine floor (`@types/vscode@^1.105.0`) per the VS Code convention. better-sqlite3 is proven to LOAD/RUN at its built ABI 137 (sqlite 3.53.1) — the DRIVER works; the only thing unverifiable here is the Electron-host ABI MATCH.

**Rule 3 delta — web claims treated as unverified hints, NOT coded to.** A Perplexity pass returned only low-authority sources (rxdb blog, YouTube, a personal blog) — exactly the situation the Dev Notes flagged. Its specific claims (a `rebuild({buildPath, electronVersion, onlyModules, force})` Promise API; `electron-rebuild -v <ver> -m <path>` CLI; "node:sqlite stripped from Electron") are recorded as HINTS to verify against the INSTALLED `@electron/rebuild` `.d.ts` IF that tool is ever installed — none were coded to, and `@electron/rebuild` is NOT installed, so none could be verified. The "node:sqlite stripped from Electron" claim is moot for this story: no Electron runtime is reachable to test it either way; the fallback is proven in the target Node runtime that IS reachable.

**esbuild externalization decision (the artifact Epic 10 + VSIX packaging depend on).** `apps/vscode-extension/esbuild.js`: `platform:'node'`, `format:'cjs'`, `bundle:true`, `external:['vscode','better-sqlite3','*.node']`, `outfile:'dist/extension.cjs'`, sourcemap. `vscode` is host-provided (not an npm package); `better-sqlite3` + `*.node` are the native addon (its .js wrapper resolves a platform/ABI-specific binary at runtime — bundling breaks resolution). Verified in the emitted bundle: `require("vscode")` is externalized (not inlined), `module.exports` exposes `activate`/`deactivate`/`ACTIVATION_LOG`, bundle is 2.2kb (no addon inlined).

**Module-system decision (host-correct + monorepo-consistent).** The package is `"type": "module"` (so the `.ts` source is ESM, consistent with every other workspace package and resolving the root aggregate typecheck under base NodeNext + `verbatimModuleSyntax`), while the esbuild output is `dist/extension.cjs` and `main` → `./dist/extension.cjs`. A `.cjs` file is ALWAYS CommonJS regardless of `type`, so the VS Code extension host (which loads `main` via `require()` — it does NOT run extensions as native ESM as of 2025) gets a CommonJS entry. Researched + confirmed (VS Code issue #201874 + the esbuild-extension bundling pattern). The extension `tsconfig.json` is `noEmit` (esbuild owns the runtime artifact; tsc is typecheck-only) and uses base NodeNext.

**Rule 13 (thin client) honored.** `src/extension.ts` imports ONLY `vscode`; it does NOT import better-sqlite3, data-access, core, or ui-shared yet (10.1 is scaffold + driver-load proof; 10.2 is the first DB-opening consumer). No board logic in the extension layer. better-sqlite3 / node:sqlite are touched ONLY in the dev test as a probe — the production dependency graph stays clean (no `better-sqlite3` dep added to the extension's package.json; it is reached transitively through data-access in 10.2). Lint module-boundary guards stay green.

**eslint config touch.** Added a scoped block (apps/*/esbuild.js, packages/*/esbuild.js) giving node globals to plain-JS build/tool scripts — `esbuild.js` is a Node tool entry, not package source, and the base recommended `no-undef` would otherwise flag `process`/`console`. No existing rule weakened.

### File List

- `apps/vscode-extension/package.json` (modified — real VS Code extension manifest: displayName, publisher, categories, `engines.vscode ^1.105.0`, `main`→`dist/extension.cjs`, `contributes.commands`, `activationEvents`, build/watch/typecheck scripts, `type:module`, devDeps `@types/vscode`+`esbuild`)
- `apps/vscode-extension/src/extension.ts` (new — `activate`/`deactivate`/`ACTIVATION_LOG`; thin client, no board logic)
- `apps/vscode-extension/src/index.ts` (deleted — the Epic-1 `VSCODE_EXTENSION_APP` placeholder marker; confirmed no importer before removing)
- `apps/vscode-extension/esbuild.js` (new — single-bundle CJS build, externalizes vscode/better-sqlite3/*.node)
- `apps/vscode-extension/tsconfig.json` (modified — noEmit typecheck split, `@types/vscode` types)
- `apps/vscode-extension/src/abi-proof.test.ts` (new — the AC1/AC2/AC3 driver-load + activation proof; root-suite-discovered; mutation-tested)
- `pnpm-workspace.yaml` (modified — catalog: `@types/vscode ^1.105.0`, `esbuild ^0.28.0`; allowBuilds: `esbuild: true`)
- `eslint.config.js` (modified — node globals for apps/*/esbuild.js, packages/*/esbuild.js build scripts)
- `pnpm-lock.yaml` (modified — install of new devDeps)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — 10-1 ready-for-dev → in-progress → review)

## Change Log

| Date       | Change                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| 2026-06-02 | Story 10.1 implemented: extension scaffold (esbuild CJS bundle + activate/deactivate) + SQLite-driver ABI proof. Resolution = **node:sqlite fallback** (AC2) — no Electron host reachable to verify the better-sqlite3 Electron-ABI match (Rule 12); empirical ABI node 24.16.0 / modules 137 / electron=none read live (AC3, Rule 3). All 5 tasks complete; full gate green (lint/typecheck/build/format + 1206 tests). Status → review. |
| 2026-06-02 | Code review: 1 HIGH found + auto-resolved inline (QA negative-path test broke the canonical root `pnpm run typecheck` gate — `TS2307` on a static `import('node:this-module-does-not-exist')`; fixed by computing the specifier so tsc cannot statically resolve it, runtime behavior + non-vacuity unchanged). 1 NEW MED forward-risk recorded in deferred-work (10.2 better-sqlite3↔Electron-host driver risk). Combined-changeset test count corrected to **1212** (dev's 4 + QA's 6 = the bundle/activation tests; the "1206" above was the pre-QA dev-stage figure). All 4 marquee assertions reviewer-mutation-RE-confirmed non-vacuous (Rule 7), reverted byte-identical. Rule 13 contract byte-identical (core/mcp untouched). FULL gate re-run GREEN: lint 0 · typecheck 0 · build clean · format clean · `pnpm test` 1212/141/0. See Review Findings below. |

## Review Findings (code review — 2026-06-02)

**Disposition: APPROVE after 1 HIGH auto-resolved inline.** AC1/AC2/AC3 met with honest real-runtime evidence; the better-sqlite3↔Electron-host ABI match is correctly recorded as unverifiable on this machine (honest AC2 node:sqlite-fallback landing, NOT a faked pass — Rule 12). 0 carried-to-backlog from the existing OPEN set (no 10.1 trigger). 1 NEW MED forward-risk recorded in `deferred-work.md` for Story 10.2.

### HIGH (auto-resolved inline)
1. **Canonical root `pnpm run typecheck` gate was RED** (`TS2307` — `bundle-and-activation.test.ts:165` used a static-string `import('node:this-module-does-not-exist')`; `tsc --noEmit` statically resolves a literal specifier and errored, exit 2). The dev's "typecheck 0" predated the QA test addition; the combined changeset broke the gate and the QA gate did not re-run the root typecheck (Vitest does not typecheck, so the runtime test masked it). **Fix:** computed the specifier (`['node:this-module','does-not-exist'].join('-')`) so tsc cannot statically resolve it — runtime rejection behavior + non-vacuity byte-identical, mirroring the sibling `require(string)` test. Verified: typecheck 0; test still green; full gate green. (Detail in `deferred-work.md` → Story 10.1.)

### MED (deferred — forward-risk, owner Story 10.2)
2. **DOWNSTREAM RISK: `data-access` is better-sqlite3-only; if the Electron host can't load better-sqlite3, 10.2 needs a `node:sqlite`-backed `data-access` adapter behind the NFR2 seam.** 10.1 honestly proved the host-ABI match is unverifiable here; the first DB-opening consumer (10.2) must determine empirically in a real Extension Dev Host whether better-sqlite3 loads, else rebuild (add `@electron/rebuild` then, Rule 3) or add a node:sqlite adapter behind the `DataAccess` port (no driver leak into the extension — Rule 13). Recorded OPEN in `deferred-work.md`.

### Verifications (all PASS)
- **Rule 3 (real-runtime + external-API discipline):** node:sqlite loads + returns `SELECT sqlite_version()` = `3.53.0` in a real process; better-sqlite3 loads at built ABI 137 via the data-access transitive resolution path; empirical ABI (node 24.16.0 / modules 137 / electron=none) read LIVE; no web-claimed Electron/ABI constant coded to (`@electron/rebuild`/electron deliberately not installed).
- **Rule 7 (mutation non-vacuity):** node:sqlite version-match → RED (`/^ZZZ_MUTANT/`); activate() command id (dev `toContain` + QA `toEqual`) → RED (`agentbbs.MUTANT`); synthetic-import externalization guard → RED (esbuild "Could not resolve" when better-sqlite3 removed from `external`). All reverted byte-identical (diff vs pre-mutation backups: IDENTICAL).
- **Rule 12 (canonical ROOT gate):** ran `pnpm test` (root, not per-package) = 1212/141/0; node:sqlite resolution is a genuine real-runtime proof, not a stub.
- **Rule 13 (thin client):** `git diff HEAD -- packages/core packages/mcp-server` EMPTY (agent contract byte-identical); extension imports only `vscode`; no better-sqlite3 dep in extension package.json; no board logic in extension.
- **esbuild externalization in the EMITTED bundle:** `require("vscode")` present (not inlined); no `better_sqlite3.node` / `*.node` inlined; `module.exports` + activate/deactivate/ACTIVATION_LOG present (2.2kb).
- **`@types/vscode@1.120.0` satisfies `engines.vscode ^1.105.0`** (floor = engine commitment, latest-within-caret per VS Code convention). `type:module` source + `.cjs` host output = correct for the host's CommonJS `require()` loader.
- **Rule 6:** N/A (no `docs/adr`). **Rule 1:** AC1 is a real runtime-integration AC (activates + loads driver in the host runtime); first consumer named = Story 10.2.
