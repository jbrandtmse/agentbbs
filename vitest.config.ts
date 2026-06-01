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
          // stay here. .test.tsx in OTHER packages still run node here.
          exclude: ['packages/ui-shared/src/**/*.test.tsx'],
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
          include: ['packages/ui-shared/src/**/*.test.tsx'],
          // Story 9.2 / 9.1-L1: set IS_REACT_ACT_ENVIRONMENT=true so React act()
          // semantics are correct and the act(...) stderr warning is silenced for
          // every DOM-project component test.
          setupFiles: ['packages/ui-shared/src/test-setup-dom.ts'],
          passWithNoTests: true,
        },
      },
    ],
  },
});
