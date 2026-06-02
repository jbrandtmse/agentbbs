// Build the in-host LEDGER probe (Story 10.2) — bundles host-tests/open-ledger.in-host.ts into
// host-tests/dist/open-ledger.in-host.cjs for @vscode/test-electron to load as extensionTestsPath.
//
// The ledger probe imports @agentbbs/data-access + @agentbbs/core (workspace TS packages), so it
// must be bundled — the Electron host loads extensionTestsPath via require() and resolves it from
// the extension dir, where the raw workspace TS is not directly requirable. esbuild produces a
// single CommonJS module exposing `run()`.
//
// EXTERNALS (load-bearing — mirror esbuild.js):
//   - 'vscode'      : host-provided, not an npm package.
//   - 'node:sqlite' : a Node BUILTIN the host provides (the whole point of this story); bundling
//                     a builtin is wrong — esbuild externalizes node: builtins for platform:node
//                     anyway, but we name it explicitly for clarity.
//   - 'better-sqlite3' / '*.node' : the extension never uses better-sqlite3 (node:sqlite is the
//                     host driver), but keep them external so a stray transitive import can never
//                     inline the native addon.
//
// The @agentbbs/* workspace packages ARE bundled (plain TS, the thin-client surface) — exactly
// like the production extension bundle.

'use strict';

const path = require('node:path');

const esbuild = require('esbuild');

const HERE = __dirname;

async function main() {
  await esbuild.build({
    entryPoints: [path.join(HERE, 'open-ledger.in-host.ts')],
    outfile: path.join(HERE, 'dist', 'open-ledger.in-host.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    sourcemap: true,
    external: ['vscode', 'node:sqlite', 'better-sqlite3', '*.node'],
    logLevel: 'info',
  });
  console.log('[build-host-tests] built host-tests/dist/open-ledger.in-host.cjs');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
