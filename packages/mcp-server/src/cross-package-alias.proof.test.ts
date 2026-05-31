// Cross-package Vitest `src`-alias proof (Story 3.0, Task 1 / AC #1).
//
// THE WHOLE POINT of this test: it imports a `core` export — `CROSS_PACKAGE_ALIAS_PROOF`
// (and `crossPackageAliasProof()`) — that was ADDED in Story 3.0 and is therefore NOT
// present in any pre-Story-3.0 `core/dist/` build, through the `@agentbbs/core` PACKAGE
// specifier, from a DIFFERENT package (mcp-server). It must pass from a clean / stale-
// `dist` state WITHOUT any prior `pnpm run build`.
//
// Before Story 3.0's root `vitest.config.ts` `resolve.alias`, the `@agentbbs/core`
// specifier resolved through `core`'s `exports` map to the BUILT `core/dist/` — so a
// brand-new `core` export was invisible to mcp-server tests until `core` was rebuilt
// (the Epic 2 "stale-dist `INTERNAL_ERROR`" papercut — deferred-work 2.4 / superseded
// Rule 2). With the alias mapping `@agentbbs/core` → `packages/core/src/index.ts`, the
// same cross-package import resolves to live TS SOURCE and the fresh symbol is visible
// immediately. If this test ever fails with "is not exported" / `undefined`, the alias
// has regressed (or been removed) and the build-ordering papercut is back.

import { describe, expect, it } from 'vitest';
import {
  CROSS_PACKAGE_ALIAS_PROOF,
  crossPackageAliasProof,
} from '@agentbbs/core';

describe('cross-package @agentbbs/core src-alias resolution (Story 3.0, AC #1)', () => {
  it('sees a fresh core export through the @agentbbs/core specifier WITHOUT a prior build (resolved from src, not stale dist)', () => {
    // A constant added in Story 3.0 — absent from any earlier core/dist. Seeing its
    // value here means the @agentbbs/core specifier resolved to src via the alias.
    expect(CROSS_PACKAGE_ALIAS_PROOF).toBe('agentbbs:core-src-alias:3.0');
  });

  it('exercises a fresh core FUNCTION export end-to-end across the package boundary', () => {
    // Not just a constant: a callable, mirroring how Epic 3's new core exports
    // (consumed by mcp-server) are invoked. Exercising it green proves the live-source
    // surface is fully wired across the boundary, not merely present.
    expect(crossPackageAliasProof()).toBe(CROSS_PACKAGE_ALIAS_PROOF);
  });
});
