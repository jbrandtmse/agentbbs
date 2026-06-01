// DOM-project test setup (referenced by the `ui-shared-dom` Vitest project's
// `setupFiles` in the root vitest.config.ts).
//
// Story 9.2 / Task 5 — folds in Story 9.1 deferred item 9.1-L1: React logs
//   "Warning: The current testing environment is not configured to support act(...)"
// when `globalThis.IS_REACT_ACT_ENVIRONMENT` is unset. Setting it `true` here makes
// `act()` semantics correct (effects flush synchronously inside `act`) and silences
// the stderr noise for every `.test.tsx` in the DOM project — the right place for
// it now that Story 9.2 adds more component-render tests.
//
// See: https://react.dev/reference/react/act (IS_REACT_ACT_ENVIRONMENT global).

declare global {
  // `var` is required for a global augmentation (let/const do not augment globalThis).
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export {};
