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

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    // One config, many projects: each workspace package's co-located
    // *.test.ts(x) files are collected under a named project. Packages extend
    // this root config; they never define their own.
    projects: [
      {
        extends: true,
        test: {
          name: 'agentbbs',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.{ts,tsx}',
            'apps/*/src/**/*.test.{ts,tsx}',
          ],
          passWithNoTests: true,
        },
      },
    ],
  },
});
