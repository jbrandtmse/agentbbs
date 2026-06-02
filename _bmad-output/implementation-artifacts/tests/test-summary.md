# Test Automation Summary — Story 10.1 (VS Code extension scaffold + better-sqlite3/Electron ABI proof)

QA stage of `/epic-cycle`. The dev stage shipped a mutation-tested happy-path proof
(`abi-proof.test.ts`, 4 tests, all green and discoverable by root `pnpm test`). The QA value-add
is one new file of 6 HARDENING tests closing the gate-order / negative-path / artifact gaps the
happy path structurally cannot see, each Rule-7 mutation-proven non-vacuous (all mutations reverted
byte-identical; git-confirmed clean). Canonical gate is ROOT `pnpm test` (Rule 8 discoverability /
Rule 12 corollary), green at 141 files / 1212 tests.

## Generated / Hardened Tests

### node project (`apps/*/src/**/*.test.ts` — root `pnpm test`)
- [x] `apps/vscode-extension/src/bundle-and-activation.test.ts` (NEW — 6 tests):
  - **AC1 / Rule 13 / Rule 10 — externalization asserted against the BUILT artifact**, not just the
    esbuild config. Reads `dist/extension.cjs` (builds it on-demand with correct cwd if missing) and
    pins: `vscode` is externalized as `require("vscode")` (the dev only claimed this in prose); the
    three entry symbols are exported; NO `*.node` / `better_sqlite3.node` inlined.
  - **AC1 — the `external:[better-sqlite3,*.node]` RULE is exercised**, not just its by-product. The
    10.1 extension does not import better-sqlite3, so its absence from the production bundle is vacuous
    (absent because unused). A synthetic esbuild build that DOES import better-sqlite3 under the same
    externals proves the rule that protects 10.2 (the first data-access consumer) actually functions.
  - **AC1 — activate() cleanup contract**: pushes exactly ONE disposable whose `.dispose` is a callable
    fn (not merely `subscriptions.length===1`), and `deactivate()` is a safe no-op.
  - **AC3 — empirical ABI is LIVE, not a constant**: in-process `process.versions.modules` equals an
    out-of-band fresh-node read (a hard-coded ABI would not track the runtime).
  - **AC2 — driver-load probe fails LOUDLY**: `import()` of a nonexistent built-in REJECTS and
    `require()` of an absent native addon THROWS — a silent pass would mask an absent driver.

## Rule-7 mutation proofs (non-vacuity; ALL reverted byte-identical, git diff clean)
- [x] **vscode externalization** — removed `'vscode'` from `esbuild.js` externals → build fails to
  resolve `vscode` (not an npm pkg) → artifact test RED. Reverted.
- [x] **activate disposable contract** — replaced `context.subscriptions.push(disposable)` with
  `void disposable` in `extension.ts` → cleanup test RED. Reverted.
- [x] **better-sqlite3 external rule** — dropped `'better-sqlite3'` from the synthetic build's
  externals → addon resolves/inlines, `require("better-sqlite3")` vanishes → test RED. Reverted.
- [x] **live ABI** — replaced the live comparison with a `'999'` literal → RED. Reverted.

(The dev's `abi-proof.test.ts` mutation claims were spot-confirmed by re-running it green and the live
runtime probe matches the dev's recorded evidence: node 24.16.0 / ABI 137 / electron=none.)

## Coverage
- AC1 (scaffold + activation + driver load): dev happy-path + QA artifact-externalization + disposable
  cleanup. The real Extension Development Host smoke is the lead's separate gate (no Electron host here).
- AC2 (node:sqlite fallback): dev load proof + QA loud-failure negative path.
- AC3 (empirical ABI): dev read + QA live-not-constant pin.

## Notes / Next Steps
- No Electron extension-host runtime is reachable on this machine; the better-sqlite3↔Electron ABI
  MATCH remains unverifiable here by design (AC2 node:sqlite fallback is the V1 resolution). The lead's
  per-story smoke exercises the resolved path; a future story on a real host can pursue the rebuild path.
- Tests left UNCOMMITTED in the working tree per the stage protocol (lead commits after the smoke gate).
