// Root Vitest config — the SINGLE workspace-wide test configuration.
//
// Story 1.2 establishes this. Per the Rule-5 amendment to the planning artifacts
// (architecture.md / epics.md / project-context.md), Vitest 4 REMOVED the
// standalone `vitest.workspace.ts` file (its deprecation in v3 became a removal in
// v4 — see the official Vitest 4 migration guide). The single-root-config /
// packages-extend-never-redefine intent is preserved here via `test.projects`,
// which is the supported successor to the workspace file. Packages do NOT define
// their own Vitest config; they are discovered as projects from this one file.
//
// `passWithNoTests: true` keeps CI green while packages have no tests yet (the
// scaffold is mostly empty barrels until Story 1.3+). Co-located `*.test.ts(x)`
// beside source is the convention (project-context.md#Testing).
//
// --- Cross-package `src` resolution (Story 3.0, Task 1 / AC #1) ---
// `resolve.alias` maps each `@agentbbs/<pkg>` specifier to that package's
// `src/index.ts` (live TypeScript source) so CROSS-package tests resolve against
// source, NOT each package's built `dist/`. Before this, a brand-new `core` export
// was invisible to `mcp-server`/`cli`/`ui-shared` tests until `core` was rebuilt
// (the Epic 2 "stale-dist `INTERNAL_ERROR`" papercut — deferred-work 2.4 /
// superseded project-rules Rule 2). Intra-package tests were never affected; only
// cross-package consumers saw the stale surface. The standing proof is now the body
// of Epic 3's mcp-server tests themselves: they import REAL `core` exports
// (`announceProject`/`PROJECT_EXISTS`, `joinBoard`, `boardDirectory`,
// `requireMembership`, …) through the `@agentbbs/core` specifier and run green from a
// no-`dist` state — every one is a live cross-package `src`-alias exercise. (The
// dedicated synthetic proof fixture + test — `cross-package-alias-proof.ts` /
// `cross-package-alias.proof.test.ts` — were retired in Story 4.0 once those real
// exports made them redundant; see deferred-work 3.0-a.)
//
// BUILD-MODE HONESTY: tests now run against `src`, so the shipped `dist`/`exports`
// artifact is NOT validated by the test run. The `pnpm run build` step (kept in the
// gate) is the `dist`-artifact guard — a broken barrel `exports` still surfaces at
// build time. The alias only aliases the package ROOTS (`@agentbbs/core`, …); no
// deep `@agentbbs/<pkg>/<subpath>` specifier is imported by any test (confirmed),
// so the barrel alias masks nothing. Single-root-config invariant (Story 1.2)
// stands: this alias lives in the ONE root config, not per-package configs.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Story 13.2 — the serialized Shiki-highlighter suite list lives in its own tiny
// module (no `vitest` types) so the Rule-8 drift guard can import it as the single
// source of truth WITHOUT dragging this config (and its non-project `passWithNoTests`
// typings) into the typecheck program. See vitest.highlighter-suites.ts.
import { highlighterSuites } from './vitest.highlighter-suites.js';

// Absolute repo root (this config file's directory), ESM-safe.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** Resolve a workspace package's `src/index.ts` barrel to an absolute path. */
const pkgSrc = (pkg: string): string =>
  path.resolve(rootDir, 'packages', pkg, 'src/index.ts');

// Map each workspace specifier to its source barrel. Object form = exact-string
// match (Vite/@rollup-plugin-alias), so `@agentbbs/core` does NOT swallow a
// hypothetical `@agentbbs/core/<subpath>` import — package roots only.
const workspaceSrcAlias: Record<string, string> = {
  '@agentbbs/core': pkgSrc('core'),
  '@agentbbs/data-access': pkgSrc('data-access'),
  '@agentbbs/mcp-server': pkgSrc('mcp-server'),
  '@agentbbs/cli': pkgSrc('cli'),
  '@agentbbs/ui-shared': pkgSrc('ui-shared'),
};

// --- Shiki highlighter-using suites: serialized to kill the tokenizer flake ---
// (Story 13.2 — consolidates deferred-work 9.5-shiki-warmup + 10.5-shiki-flake +
// 10.6-shiki-flake.)
//
// ROOT CAUSE (verified against the INSTALLED `@shikijs/primitive@4.1.0` source —
// `dist/index.mjs` `_tokenizeWithTheme`, line 691): the production renderer
// (`packages/ui-shared/src/markdown/highlight.ts`) tokenizes with
// `codeToTokens(..., { includeExplanation: true })`. That path runs TWO grammar
// passes per line — `tokenizeLine` (for the explanation/scopes) and `tokenizeLine2`
// (for the encoded color metadata) — and indexes the explanation tokens by a running
// counter (`tokensWithScopes[tokensWithScopesIndex]`). Under FULL-SUITE CONCURRENCY
// (many Vitest worker processes each tokenizing simultaneously, under memory
// pressure) those two passes intermittently DESYNC, the explanation array runs
// short, and `tokenWithScopes` is `undefined` → `TypeError: Cannot read properties
// of undefined (reading 'startIndex')`. RED-under-parallel-load / GREEN-in-isolation
// — exactly the 10.5/10.6 signature.
//
// WHY NOT "more prewarm": per-file `beforeAll(prewarmHighlighter)` is ALREADY in
// every highlighter-using file; it guarantees the singleton is LOADED, but the fault
// is a concurrency/memory-pressure bug INSIDE the library's dual-pass tokenizer, not
// a cold-highlighter miss. More prewarm cannot fix it.
//
// WHY NOT "bump @shikijs/*" (Option B): Research-First (2026-06-10, Perplexity)
// found NO documented 4.x patch fixing this `_tokenizeWithTheme`/`startIndex` fault;
// `@shikijs/core@4.2.0` exists but is NOT documented as addressing it. A blind,
// undocumented bump risks silently changing the inert CSS-class-span OUTPUT, which
// AC3 freezes byte-for-byte. Rejected.
//
// THE FIX (Option A — remove the concurrency): collect EVERY highlighter-using test
// file into ONE dedicated project that runs with `fileParallelism: false` (a
// supported Vitest 4.1.7 top-level option — verified in the installed
// `vitest/dist/chunks/reporters.d.CtLUhkkA.d.ts`: "Should all test files run in
// parallel … Setting this to `false` will override `maxWorkers` to `1`"). Within
// this project the files run ONE AT A TIME, so the tokenizer is never invoked
// concurrently; and because NO file OUTSIDE this project uses the highlighter, there
// is no concurrent tokenization anywhere in the run. Other projects stay fully
// parallel (fileParallelism is per-project — verified via Research-First). These
// files are EXCLUDED from the two existing projects so they run in exactly one place.
// Single-root-config invariant (Story 1.2) preserved — this third project lives in
// the ONE root config. The serial project uses happy-dom + the DOM act() setup so the
// `.tsx` React renders work (and the pure-node `highlight.test.ts` runs fine under
// happy-dom — verified); the two `render-markdown*.ts` files' own
// `@vitest-environment happy-dom` docblocks are now redundant-but-harmless.
//
// The list itself (`highlighterSuites`) is imported from `vitest.highlighter-suites.ts`
// (a types-free module) so the Story-13.2 QA discoverability drift-guard can pin it as
// the single source of truth without dragging this config into the typecheck program.

export default defineConfig({
  // Top-level alias (applies to the root run / config resolution).
  resolve: {
    alias: workspaceSrcAlias,
  },
  test: {
    passWithNoTests: true,
    // One config, many projects: each workspace package's co-located
    // *.test.ts(x) files are collected under a named project. Packages extend
    // this root config; they never define their own.
    projects: [
      {
        // Also set the alias inside the project config so it applies to the
        // project run (the projects array does not inherit the root `resolve`).
        resolve: {
          alias: workspaceSrcAlias,
        },
        extends: true,
        test: {
          name: 'agentbbs',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.{ts,tsx}',
            'apps/*/src/**/*.test.{ts,tsx}',
          ],
          // The UI test tier (Story 9.1) runs React/getComputedStyle tests under a
          // DOM env in the separate 'ui-shared-dom' project below. Exclude those
          // .test.tsx from this node project so each UI test runs in exactly one
          // env (never twice). Pure-node ui-shared tests (e.g. contrast.test.ts)
          // stay here. Story 9.3 adds apps/web's React shell render test (App.test.tsx),
          // which is ALSO a DOM-project test — excluded here, included in ui-shared-dom
          // below. Pure-node apps/web tests (api-client.test.ts) stay here.
          exclude: [
            'packages/ui-shared/src/**/*.test.tsx',
            'apps/web/src/**/*.test.tsx',
            // Story 10.4 — the VS Code webview React mount (RoomApp) is a DOM-tier test too;
            // it runs under the happy-dom project below, never twice (Rule 12 corollary — the
            // canonical gate is ROOT `pnpm test`, which maps it; a per-package `vitest` run does
            // NOT and would falsely report `document is not defined`).
            'apps/vscode-extension/src/**/*.test.tsx',
            // Story 13.2 — the highlighter-using `.ts` suites move to the serialized
            // `markdown-serial` project (below) so they never tokenize concurrently. Excluded
            // here so each runs in exactly one project (the `.tsx` ones are already excluded by
            // the `.test.tsx` globs above).
            ...highlighterSuites,
          ],
          passWithNoTests: true,
        },
      },
      {
        // UI test tier (Story 9.1, Epic 8 retro Action B). React component /
        // CSS-custom-property tests need a browser-like DOM. happy-dom is the
        // lighter Vitest builtin env (verified a supported BuiltinEnvironment in
        // the installed vitest 4.1.7 types: "node"|"jsdom"|"happy-dom"|"edge-runtime";
        // `environmentMatchGlobs` was REMOVED in v4, so a second project entry is
        // the supported multi-env mechanism). Single-root-config invariant
        // (Story 1.2) preserved: this lives in the ONE root config, not a
        // per-package config.
        resolve: {
          alias: workspaceSrcAlias,
        },
        extends: true,
        test: {
          name: 'ui-shared-dom',
          environment: 'happy-dom',
          // The DOM-env React component tests: ui-shared's own (Story 9.1/9.2), apps/web's
          // shell render test (Story 9.3), and (Story 10.4) the VS Code webview RoomApp mount —
          // the SECOND cross-package DOM consumer of ui-shared (the webview mounts the same
          // RoomView). All run under happy-dom with the shared act() setup.
          include: [
            'packages/ui-shared/src/**/*.test.tsx',
            'apps/web/src/**/*.test.tsx',
            'apps/vscode-extension/src/**/*.test.tsx',
          ],
          // Story 13.2 — the highlighter-using `.tsx` suites move to the serialized
          // `markdown-serial` project (below). Excluded here so each runs in exactly one
          // project. The DOM-mapping for every OTHER `.test.tsx` is unchanged (Rule 12: the
          // canonical gate is ROOT `pnpm test`; this keeps non-highlighter `.tsx` on happy-dom).
          exclude: [...highlighterSuites],
          // Story 9.2 / 9.1-L1: set IS_REACT_ACT_ENVIRONMENT=true so React act()
          // semantics are correct and the act(...) stderr warning is silenced for
          // every DOM-project component test.
          setupFiles: ['packages/ui-shared/src/test-setup-dom.ts'],
          passWithNoTests: true,
        },
      },
      {
        // Story 13.2 — the SERIALIZED Shiki-highlighter project. Every test file that
        // tokenizes via the `ui-shared` markdown renderer (`highlight.ts` →
        // `codeToTokens({ includeExplanation: true })`) runs HERE, ONE AT A TIME
        // (`fileParallelism: false`), so the `@shikijs/primitive@4.1.0`
        // `_tokenizeWithTheme` dual-pass tokenizer is never invoked concurrently across
        // worker processes — which is the documented full-suite flake (deferred-work
        // 9.5/10.5/10.6: `TypeError: …reading 'startIndex'`, RED-under-parallel-load /
        // GREEN-in-isolation). Because NO file outside this project uses the highlighter,
        // serializing this project alone removes ALL concurrent tokenization in the run;
        // every other project stays fully parallel (fileParallelism is per-project).
        //
        // Environment: happy-dom + the DOM act() setup so the `.tsx` React renders work;
        // the pure-node `highlight.test.ts` runs fine under happy-dom too (verified). The
        // alias + setup mirror the `ui-shared-dom` project so behavior is identical apart
        // from serialization. Single-root-config invariant (Story 1.2) preserved.
        resolve: {
          alias: workspaceSrcAlias,
        },
        extends: true,
        test: {
          name: 'markdown-serial',
          environment: 'happy-dom',
          include: [...highlighterSuites],
          // Serialize: run these files one at a time (overrides maxWorkers to 1 for this
          // project only — verified against the installed vitest@4.1.7 types). This is the
          // load-bearing line: it removes the concurrent tokenization that triggers the
          // library fault.
          fileParallelism: false,
          setupFiles: ['packages/ui-shared/src/test-setup-dom.ts'],
          passWithNoTests: true,
        },
      },
    ],
  },
});
