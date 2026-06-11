// Single source of truth for the Story 13.2 serialized Shiki-highlighter suites.
//
// This list is consumed in TWO places, which is why it lives in its own tiny module
// (no `vitest` type imports — so a test that imports it for the Rule-8 drift guard
// does NOT drag the full `vitest.config.ts` — and its non-project-level
// `passWithNoTests` typings — into the `tsconfig.typecheck.json` program):
//   1. `vitest.config.ts` — the `markdown-serial` project `include`, and the
//      `exclude` in the two parallel projects, so each file runs in exactly one place.
//   2. `packages/ui-shared/src/markdown/highlighter-serialization.guard.test.ts` — the
//      discoverability drift-guard that pins THIS list against the actual set of test
//      files importing/mounting the renderer (Rule 8 + Rule 10).
//
// WHY THESE FILES ARE SERIALIZED: every file here tokenizes via the `ui-shared`
// markdown renderer (`highlight.ts` → `codeToTokens({ includeExplanation: true })`).
// Run in parallel across Vitest worker processes, the `@shikijs/primitive@4.1.0`
// dual-pass tokenizer intermittently desyncs under memory pressure → `TypeError:
// …reading 'startIndex'` (deferred-work 9.5/10.5/10.6, RED-under-parallel-load /
// GREEN-in-isolation). Collecting them into ONE `fileParallelism: false` project
// removes ALL concurrent tokenization in the run.
//
// ADDING A NEW HIGHLIGHTER-USING TEST: add its repo-root-relative path here. If you
// forget, the drift guard goes RED (it found a renderer-using test not in this list).

export const highlighterSuites: string[] = [
  // ui-shared markdown / room render suites
  'packages/ui-shared/src/markdown/highlight.test.ts',
  'packages/ui-shared/src/markdown/render-markdown.test.ts',
  'packages/ui-shared/src/markdown/render-markdown.xss.test.ts',
  'packages/ui-shared/src/markdown/MarkdownView.test.tsx',
  'packages/ui-shared/src/markdown/CodeBlock.test.tsx',
  'packages/ui-shared/src/room/RoomView.test.tsx',
  // apps/web shell (mounts RoomView → the renderer)
  'apps/web/src/App.test.tsx',
  // VS Code webview (mounts the same RoomView renderer)
  'apps/vscode-extension/src/webview/RoomApp.test.tsx',
  'apps/vscode-extension/src/webview/RoomApp.qa.test.tsx',
  'apps/vscode-extension/src/webview/RoomApp.live.test.tsx',
  'apps/vscode-extension/src/webview/RoomApp.inert.test.tsx',
  'apps/vscode-extension/src/webview/WebviewBridgeRoundtrip.test.tsx',
];
