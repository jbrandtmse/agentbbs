// Cross-package Vitest `src`-alias proof fixture (Story 3.0, Task 1 / AC #1).
//
// This sentinel export exists ONLY to prove the root `vitest.config.ts`
// `resolve.alias` maps the `@agentbbs/core` specifier to this package's
// `src/index.ts` (live TypeScript source) rather than the built `dist/`.
//
// The proof: `packages/mcp-server/src/cross-package-alias.proof.test.ts` imports
// `CROSS_PACKAGE_ALIAS_PROOF` (and `crossPackageAliasProof()`) through the
// `@agentbbs/core` package specifier — a CROSS-package import — and exercises it
// green WITHOUT any prior `pnpm run build`. Before the alias landed, that
// specifier resolved through `@agentbbs/core`'s `exports` map to `core/dist/`, so
// a brand-new `core` export was invisible to mcp-server tests until `core` was
// rebuilt (the Epic 2 "stale-dist `INTERNAL_ERROR`" papercut — deferred-work 2.4 /
// the now-superseded Rule 2). With the alias, the same import resolves to this
// source file and the new symbol is visible immediately from a stale-`dist` state.
//
// Keep this tiny and dependency-free; it is test infrastructure, not board logic.

/**
 * A sentinel constant added in Story 3.0 that is intentionally NOT present in any
 * previously-built `core/dist/`. Cross-package tests that see this value prove they
 * resolved `@agentbbs/core` from `src` via the Vitest alias, not from a stale build.
 */
export const CROSS_PACKAGE_ALIAS_PROOF = 'agentbbs:core-src-alias:3.0' as const;

/**
 * A trivial behavioral surface for the alias proof — returns the sentinel. Having a
 * callable (not just a constant) lets the proof test EXERCISE a fresh `core` export
 * end-to-end the way Epic 3's real new exports (consumed by mcp-server) will be.
 */
export function crossPackageAliasProof(): typeof CROSS_PACKAGE_ALIAS_PROOF {
  return CROSS_PACKAGE_ALIAS_PROOF;
}
