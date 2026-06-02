// esbuild bundler for the AgentBBS VS Code extension (Story 10.1).
//
// The VS Code extension host loads the package `main` as a CommonJS module, so
// the bundle is `platform:'node'`, `format:'cjs'`. A single bundle keeps the
// shipped extension small and avoids node_modules resolution surprises in the
// host.
//
// EXTERNALS (load-bearing — do NOT bundle these):
//   - 'vscode'        : provided by the extension host at runtime; it is not an
//                       npm package and cannot be bundled.
//   - 'better-sqlite3': a native addon. The .js wrapper resolves a platform/ABI-
//                       specific *.node binary at runtime; bundling it would
//                       break that resolution. Only @agentbbs/data-access imports
//                       it, transitively (Rule 13 — the extension never imports
//                       better-sqlite3 directly).
//   - '*.node'        : the native addon binary itself, marked external so esbuild
//                       never tries to inline it.
//
// `@agentbbs/*` workspace packages ARE bundled (they are plain TS/JS, the thin-
// client surface).
//
// OUTPUT EXTENSION — `.cjs`: this package is `"type": "module"` (so its .ts source
// is authored/type-checked as ESM, consistent with the rest of the monorepo), but
// the VS Code extension host loads `main` via CommonJS `require()`. A `.cjs` file is
// ALWAYS CommonJS regardless of the package `type` field, so emitting
// `dist/extension.cjs` (format:'cjs') gives the host a CommonJS entry while keeping
// the source ESM. This file itself is an ES module (package is type:module).

import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  // Never bundle the host-provided API, the native SQLite addon, or any *.node binary.
  external: ['vscode', 'better-sqlite3', '*.node'],
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[esbuild] watching apps/vscode-extension/src/extension.ts …');
  } else {
    await esbuild.build(buildOptions);
    console.log('[esbuild] built dist/extension.cjs');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
