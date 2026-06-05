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

// TWO-BUNDLE SPLIT (Story 10.4 — AC2):
//   1. THE HOST BUNDLE (dist/extension.cjs) — platform:'node', format:'cjs', the extension-host
//      entry. React-FREE (the host never renders React; only the webview does). Externals as
//      above.
//   2. THE WEBVIEW BUNDLE (dist/webview/main.js) — platform:'browser', format:'esm'. The webview
//      is a BROWSER context (an iframe the VS Code host renders), DISTINCT from the host CJS
//      bundle. react / react-dom / @agentbbs/ui-shared are BUNDLED into it (NO externals — there
//      is no node_modules resolution inside the webview). The side-effecting ui-shared CSS
//      (tokens/markdown/room/chrome) + the `--vscode-*` theme layer are emitted as a single
//      `dist/webview/main.css` (the `css` loader bundles the imported stylesheets); the host links
//      it alongside the script. Verify the webview bundle has NO node built-ins (browser context).

import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} — the extension HOST bundle (CJS, node, React-free). */
const hostBuildOptions = {
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

/** @type {import('esbuild').BuildOptions} — the WEBVIEW bundle (ESM, browser; React + ui-shared bundled). */
const webviewBuildOptions = {
  entryPoints: ['src/webview/main.tsx'],
  outfile: 'dist/webview/main.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  sourcemap: true,
  // React 19 automatic JSX runtime (no `import React` needed in the .tsx).
  jsx: 'automatic',
  // The imported `*.css` (ui-shared stylesheets + the vscode-tokens theme layer) bundle into a
  // single dist/webview/main.css the host links beside the script.
  loader: { '.css': 'css' },
  // PRODUCTION React build (Epic-10 defect-fix): define NODE_ENV=production so React runs its
  // PRODUCTION runtime in the shipped VSIX — this DISABLES StrictMode's dev-only double-invoke
  // (mount→unmount→remount) and drops React's dev warnings/checks, shrinking the bundle. Without
  // it the webview shipped a DEV React build whose StrictMode double-mount exposed the bridge
  // lifecycle bug. The bridge-lifecycle fix (module-scope acquire) is correct regardless of build
  // mode; this define matches the production shape AND removes the dev double-invoke. The compose
  // bundle spreads these options, so it inherits the define + minify. (define values must be valid
  // JS expressions — hence the nested quotes giving the literal string "production".)
  define: { 'process.env.NODE_ENV': '"production"' },
  // Minify the shipped webview bundle (smaller VSIX; pairs with the production define).
  minify: true,
  // NO externals — the webview has no module resolver; react/react-dom/ui-shared are bundled in.
  external: [],
  logLevel: 'info',
};

/**
 * @type {import('esbuild').BuildOptions} — the COMPOSE webview bundle (Story 10.7). The operator
 * INITIATE compose surfaces (CreateProjectCompose/PostAnnouncementCompose/JoinProjectPicker/
 * FocusAffordance) mounted into the single reused compose panel. SAME browser/ESM/React-bundled
 * shape as the room bundle, distinct entry — emits dist/webview/compose.js (+ compose.css, the SAME
 * ui-shared stylesheets + vscode-tokens theme layer).
 */
const composeWebviewBuildOptions = {
  ...webviewBuildOptions,
  entryPoints: ['src/webview/compose-main.tsx'],
  outfile: 'dist/webview/compose.js',
};

async function main() {
  if (watch) {
    const hostCtx = await esbuild.context(hostBuildOptions);
    const webviewCtx = await esbuild.context(webviewBuildOptions);
    const composeCtx = await esbuild.context(composeWebviewBuildOptions);
    await Promise.all([
      hostCtx.watch(),
      webviewCtx.watch(),
      composeCtx.watch(),
    ]);
    console.log(
      '[esbuild] watching apps/vscode-extension/src/extension.ts + src/webview/main.tsx + src/webview/compose-main.tsx …',
    );
  } else {
    await esbuild.build(hostBuildOptions);
    console.log('[esbuild] built dist/extension.cjs');
    await esbuild.build(webviewBuildOptions);
    console.log('[esbuild] built dist/webview/main.js (+ main.css)');
    await esbuild.build(composeWebviewBuildOptions);
    console.log('[esbuild] built dist/webview/compose.js (+ compose.css)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
