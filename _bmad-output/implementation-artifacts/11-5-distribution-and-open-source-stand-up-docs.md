---
baseline_commit: 1f8353e9ea35f74764293934a2dcda6c8cf1f4c8
---

# Story 11.5: Distribution and open-source stand-up docs

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an outside developer,
I want packaged distribution and clear docs,
so that I can stand up the board and point agents at it without the author present (NFR8).

## Acceptance Criteria

**From epics.md (Epic 11, Story 11.5):**

**Given** a release,
**When** I install it,
**Then** `mcp-server` + `cli` are publishable to npm, the extension packages as a VSIX with ABI-matched `better-sqlite3` prebuilds, and the web build ships with the server.

**Given** the repo,
**When** I read `docs/` and the README,
**Then** `mcp-tool-contract.md` (the 12-tool surface + field shapes + closed error codes), `negotiation-protocol.md`, and `architecture.md` are present, and the README is a canonical stand-up guide,
**And** following them alone, an outside developer can run the board and connect an agent.

### Two Rule-8 reconciliations (planning AC predates the shipped reality — resolve explicitly, in writing)

1. **"ABI-matched `better-sqlite3` prebuilds" for the VSIX is MOOT.** Epic 10 shipped the VS Code extension on the **`node:sqlite`** adapter (the AR2 fallback): `apps/vscode-extension` esbuild marks `external: ['better-sqlite3','*.node']`, the production bundle contains `require("node:sqlite")` + **ZERO** `better-sqlite3` / no `*.node` (proven by `bundle-and-activation.test.ts` + the Story-10.2 real-host probe across two Electron ABIs). `node:sqlite` is built into the Node/Electron runtime, so the VSIX needs **NO** native prebuild at all. The AC's prebuild requirement is satisfied **vacuously / N-A** — reconcile by packaging the extension as-is (pure JS bundle, no native addon) and DOCUMENT in Dev Notes that the prebuild clause is obviated by the node:sqlite design. Do NOT add `better-sqlite3` or `@electron/rebuild` to the extension to satisfy a stale AC.
2. **"the 12-tool surface" is stale — the shipped surface is 17 tools.** `docs/mcp-tool-contract.md` already exists (Story 7.0) and is pinned to the live `Client.listTools()` set (17 tools) by `packages/mcp-server/src/tool-contract.drift.test.ts`. The README/stand-up guide must say **17** (or be count-agnostic + pinned), never 12. Reconcile by keeping the doc's 17-tool truth and ensuring the README does not reintroduce the "12" drift (the same 4.5-tool-label class corrected in Epic 7).

### Refined / testable ACs

**AC1 — `mcp-server` + `cli` (and their workspace deps `core` + `data-access`) are npm-publish-READY, verified by dry-run.**
**Given** the publishable package set (`@agentbbs/core`, `@agentbbs/data-access`, `@agentbbs/mcp-server`, `@agentbbs/cli` — mcp-server/cli depend on core+data-access, so all four must be publishable),
**When** prepared,
**Then** each has: a real semver `version` (e.g. `0.1.0`, not `0.0.0`), `private` removed (or `publishConfig.access: "public"` for the scoped `@agentbbs/*` names), correct `files`/`bin`/`main`/`exports`, and `workspace:*` deps that pnpm rewrites to the real version at pack time,
**And** `pnpm publish --dry-run` (or `pnpm pack` / `npm pack --dry-run`) for each produces a VALID tarball whose contents include the built `dist` + the package metadata, with no `workspace:*` specifier leaking into the packed `package.json` (pnpm rewrites them),
**And** actual `npm publish` (registry upload) is OUT of scope — it needs registry credentials and is a release action; the gate here is publish-READINESS proven by dry-run/pack. State this boundary in Dev Notes.

**AC2 — the web build ships with the server (an npm-installed `cli` serves the UI).**
**Given** `agentbbs ui` serves the built `apps/web` `dist` by RUNTIME PATH RESOLUTION today (walks up to `<root>/apps/web/dist`, `packages/cli/src/host/static-assets.ts`) — which does NOT exist when `cli` is installed from npm (no monorepo, the assets aren't in the cli tarball),
**When** `cli` is packaged,
**Then** the built `apps/web` `dist` is **included in the published `cli` artifact** (e.g. copied into the cli package's own files at build/prepack — `packages/cli/web-dist/` or similar, added to `files`), and the static-asset resolver finds it in the installed-from-npm layout (extend the existing resolver: the packaged location is checked IN ADDITION TO the dev monorepo walk-up + the `AGENTBBS_WEB_DIST` override — preserving the dev experience),
**And** a test proves the packaged-layout resolution path (the resolver finds web assets at the packaged location, not only the monorepo path).

**AC3 — the VS Code extension packages as a VSIX.**
**Given** `apps/vscode-extension`,
**When** packaged,
**Then** a `@vscode/vsce` (dev) dependency + a `.vscodeignore` (excludes `src`, tests, `host-tests`, maps, `node_modules` dev cruft — ships only `dist` + manifest + README/LICENSE) + a `package`/`package:vsix` script are added, and `vsce package` produces a VALID `.vsix` containing the `dist/extension.cjs` bundle (with `require("node:sqlite")`, no `better-sqlite3`/`*.node` — reconciliation #1),
**And** the extension `package.json` is marketplace-valid (real `version`, `publisher`, `engines.vscode`, `main`, `displayName`/`description`/`categories` as `vsce` requires; `private` handled so packaging succeeds),
**And** actual marketplace upload (`vsce publish`) is OUT of scope (needs a publisher PAT). The gate is a produced, valid `.vsix` verified by `vsce package` (or `vsce ls` listing its contents).

**AC4 — `docs/` carries the three machine-relevant docs.**
**Given** `docs/`,
**When** inspected,
**Then** `docs/mcp-tool-contract.md` (already present, 17 tools, drift-pinned) and `docs/negotiation-protocol.md` (already present) remain, AND `docs/architecture.md` is PRESENT (currently only at `_bmad-output/planning-artifacts/architecture.md` — add a `docs/architecture.md`: either the canonical architecture doc moved/copied to `docs/`, or a docs-appropriate architecture overview that does not drift from the planning artifact — choose one and state it),
**And** the existing Epic-7 drift-guards for the two machine-consumed docs stay green (the doc claims stay pinned to the code).

**AC5 — the README is a canonical stand-up guide.**
**Given** the README (currently a "🚧 Under construction" placeholder),
**When** rewritten,
**Then** it is a canonical stand-up guide: what AgentBBS is (brief), prerequisites (Node 24.x / pnpm), how to BUILD, how to RUN the board (the MCP server for agents + `agentbbs ui` for the operator), how to CONNECT an agent (point an MCP client at the `agentbbs-mcp-server` bin with `AGENTBBS_DB`), where the docs live (link `docs/mcp-tool-contract.md` [17 tools], `docs/negotiation-protocol.md`, `docs/architecture.md`), and a one-paragraph "what the agent does on the board" (register → announce → discover → negotiate via the four moves),
**And** following the README alone an outside developer can run the board and connect an agent (the lead's smoke verifies the documented happy path actually works),
**And** the README must NOT reintroduce the "12 tools" drift (reconciliation #2) — say 17 or count-agnostic.

**AC6 — Rule-10 content-guard pins the README/stand-up machine-relevant claims to the code.**
**Given** the README is now an agent/operator-consumed asset (it names the bins, the env var, the tool count, the commands),
**When** tested,
**Then** a content-guard test pins the README's machine-relevant claims to their source of truth: the bin names (`agentbbs`, `agentbbs-mcp-server`) to the packages' `bin` fields; the env var (`AGENTBBS_DB`) to the code; the tool count/claim to the live `Client.listTools()` set (or the already-pinned `docs/mcp-tool-contract.md`); the CLI subcommands (`export`/`import`/`ui`) to the dispatch table,
**And** the guard parses the machine-relevant claims from a clearly-delimited region (a sentinel pair or a scoped section) so prose doesn't false-positive (Rule 10), and is mutation-tested non-vacuous (drift a pinned claim → RED → revert).

**AC7 — gate green; agent contract byte-identical.**
**Given** all the above,
**When** the canonical root gate runs (`pnpm run lint` · `typecheck` · `build` · `pnpm test` · `pnpm run format`),
**Then** all green, the existing 1550 suite stays green plus the new packaging/guard tests, the published-package version bumps + manifest edits do NOT change runtime behavior, and `git diff HEAD -- packages/core/src packages/mcp-server/src` shows no change to the agent-facing SOURCE (version/manifest/`files` edits to `package.json` are packaging metadata, NOT the agent wire/types/error set — Rule 13: the 17-tool surface + closed error/event sets stay byte-identical).

## Tasks / Subtasks

- [x] **Task 1 — npm publish-readiness (AC1)** (AC: 1)
  - [x] Set a real `version` (propose `0.1.0`) across `@agentbbs/core`, `@agentbbs/data-access`, `@agentbbs/mcp-server`, `@agentbbs/cli`; remove `private` or add `publishConfig.access: "public"`; verify `files`/`bin`/`main`/`exports`. Verify `pnpm publish --dry-run`/`pnpm pack` produces valid tarballs with `workspace:*` rewritten and no leak. (Decide on `ui-shared`/`apps/web` publish posture — web is served, not necessarily npm-published; document.)
- [x] **Task 2 — web build ships with the server (AC2)** (AC: 2)
  - [x] At cli build/prepack, copy `apps/web/dist` into the cli package's own published files; extend `static-assets.ts` to resolve the packaged location too (additive to the monorepo walk-up + `AGENTBBS_WEB_DIST`). Test the packaged-layout resolution.
- [x] **Task 3 — VSIX packaging (AC3 + reconciliation #1)** (AC: 3)
  - [x] Add `@vscode/vsce` dev dep, `.vscodeignore`, a `package`/`package:vsix` script; make `package.json` marketplace-valid; produce a valid `.vsix` via `vsce package`; confirm the bundle is node:sqlite-only (no better-sqlite3/*.node). Document the obviated prebuild clause.
- [x] **Task 4 — docs/architecture.md (AC4)** (AC: 4)
  - [x] Add `docs/architecture.md` (moved/copied canonical or a docs overview that doesn't drift); keep the Epic-7 doc drift-guards green.
- [x] **Task 5 — README stand-up guide (AC5 + reconciliation #2)** (AC: 5)
  - [x] Rewrite README into the canonical stand-up guide (build/run/connect/docs-links/agent-loop); 17 tools, never 12.
- [x] **Task 6 — Rule-10 content-guard (AC6)** (AC: 6)
  - [x] Add a README content-guard pinning bins/env/tool-count/subcommands to source; sentinel-delimited; mutation-tested non-vacuous.
- [x] **Task 7 — gate (AC7)** (AC: 7)
  - [x] Full canonical root gate green; confirm agent-facing source byte-identical.

## Dev Notes

### Verified source facts (Rule 4 — this session)
- **All packages `private: true`, `version: "0.0.0"`** — `@agentbbs/mcp-server` (`bin: agentbbs-mcp-server → ./dist/main.js`, `main`, `files:["dist"]`, `exports`), `@agentbbs/cli` (`bin: agentbbs → ./dist/index.js`, `files:["dist"]`), `@agentbbs/vscode-extension` (`publisher: "agentbbs"`, `engines.vscode: "^1.105.0"`, `main: ./dist/extension.cjs`). mcp-server + cli both depend on `@agentbbs/core` + `@agentbbs/data-access` via `workspace:*` → those two MUST also be publish-ready. pnpm rewrites `workspace:*` to the resolved version at pack/publish.
- **Web-asset serving** (`packages/cli/src/host/static-assets.ts`): the host finds `apps/web/dist` by RUNTIME PATH WALK-UP to `<root>/apps/web/dist`, with an `AGENTBBS_WEB_DIST` env override; there is NO cli→apps/web package dep. So an npm-installed cli (no monorepo) currently can't find the web assets — AC2's gap. `cli` `files` is `["dist"]` only.
- **Extension is node:sqlite, NOT better-sqlite3** — `apps/vscode-extension` esbuild `external: ['better-sqlite3','*.node']`; production bundle = `require("node:sqlite")` + zero better-sqlite3 (Epic-10 `bundle-and-activation.test.ts` + Story-10.2 real-host probe). Reconciliation #1: VSIX needs no native prebuild. `@vscode/vsce` is NOT installed yet.
- **docs/** currently has `mcp-tool-contract.md` (17 tools, drift-pinned by `tool-contract.drift.test.ts`), `negotiation-protocol.md`, `pull-only-delivery.md`, `append-invariant-checklist.md` — but NOT `architecture.md` (only at `_bmad-output/planning-artifacts/architecture.md`). AC4 adds `docs/architecture.md`.
- **README** is the "🚧 Under construction / no code written yet" placeholder — must become the canonical stand-up guide (the code now exists: 17-tool MCP server, the `agentbbs` cli with `export`/`import`/`ui`, the web UI, the VS Code extension).
- **17-tool surface** is the source of truth (`tool-contract.drift.test.ts` pins the doc to live `listTools()`); the AC's "12" is stale (reconciliation #2; same class as the Epic-7-corrected 4.5-tool-label drift).

### What this story is NOT
- NOT actual `npm publish` or `vsce publish` (registry/marketplace credentials + a release decision — OUT of scope; the gate is dry-run/pack/`vsce package`).
- NOT an agent-contract change. Version bumps + `files`/manifest edits are packaging metadata; the 17-tool wire, closed error/event sets, and core types stay byte-identical (Rule 13). Do NOT touch `packages/core/src` / `packages/mcp-server/src` agent logic.
- NOT adding `better-sqlite3`/`@electron/rebuild` to the extension (reconciliation #1 — the node:sqlite design obviates it).

### Architecture compliance
- [Source: architecture.md — AR23 (CLI), AR25 (distribution & docs), NFR8 (OSS readiness)] this story IS the AR25/NFR8 deliverable.
- [Source: epics.md Epic 11 SC] "`mcp-server` + `cli` publish to npm; the extension packages as a VSIX with ABI-matched prebuilds; the web build ships with the server" + "`docs/` … + the README stand-up guide let an outside dev run the board and point agents at it" — reconciled per #1/#2.

### Testing standards (verified)
- `*.test.ts` under `packages/*/src/**`; ROOT `pnpm test` is the gate (Rule 12). Packaging assertions: `npm pack --dry-run --json` / `pnpm pack` output parsed for tarball contents + absence of `workspace:*` in the packed manifest; the web-dist resolver test exercises the packaged-layout path; the README content-guard (Rule 10) reads the README + pins to `bin` fields / `AGENTBBS_DB` / `listTools()` / the dispatch table, sentinel-delimited, mutation-tested non-vacuous (Rule 7). Heavy external tools (`vsce package` producing a real `.vsix`) are best exercised at the lead's per-story smoke if they're awkward in the unit suite — but assert the config (`.vscodeignore`, the script, the manifest validity) in a test.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 11 — Story 11.5 + the Epic-11 success criteria]
- [Source: packages/cli/src/host/static-assets.ts — web-dist runtime resolution (AC2)]
- [Source: apps/vscode-extension/esbuild.js + package.json + bundle-and-activation.test.ts — node:sqlite-only bundle (reconciliation #1)]
- [Source: docs/mcp-tool-contract.md + packages/mcp-server/src/tool-contract.drift.test.ts — 17-tool truth (reconciliation #2)]
- [Source: README.md — current under-construction placeholder to replace]
- [Source: .claude/rules/project-rules.md — Rule 8 (reconcile both stale ACs explicitly), Rule 10 (content-guard the agent/operator-consumed README + docs), Rule 13 (agent contract byte-identical; packaging metadata only), Rule 12 (root gate)]

## Dev Agent Record

### Context Reference

- `_bmad-output/project-context.md` (loaded), `.claude/rules/project-rules.md` (Rules 3, 4, 7, 8, 10, 12, 13), `.claude/rules/research-first.md`.

### Agent Model Used

claude-opus-4-8[1m] (dev-story stage)

### Debug Log References

- `pnpm --filter <pkg> pack --pack-destination <tmp>` for core/data-access/mcp-server/cli → four valid `0.1.0` tarballs; packed manifests inspected: every `workspace:*` rewritten to `0.1.0`, every `catalog:` rewritten to its concrete version (`better-sqlite3@^12.10.0`, `@modelcontextprotocol/sdk@1.29.0`, `zod@^4.4.3`); no `workspace:`/`catalog:` specifier leaked; `private` absent + `publishConfig.access: public` present. cli tarball carried 304 `web-dist/` assets + `dist` + bin (1.9 MB).
- `pnpm --filter agentbbs-vscode-extension exec vsce package --no-dependencies --out <tmp>` → valid **1.88 MB `.vsix`**, 9 files (`dist/extension.cjs` + webview assets + manifest + README, NO src/tests/maps). Extracted + verified: `require("node:sqlite")` present, **0** live `require("better-sqlite3")`, **0** `*.node` (reconciliation #1 holds in the actual artifact; the lone `better-sqlite3` string is a JSDoc comment, not a require).
- README content-guard mutation-tested non-vacuous (Rule 7): drifting db-env (`AGENTBBS_DB`→`AGENTBBS_DATABASE`), tool-count (17→16), a dropped subcommand (`ui`), and a wrong bin (`agentbbs-mcp-server`→`agentbbs-server`) each turned the matching assertion RED; reverted byte-identical → 6/6 GREEN.
- FULL ROOT GATE: `pnpm run lint` clean · `pnpm run typecheck` clean · `pnpm run build` clean · `pnpm test` **1582 passed (182 files, 0 failed)** · `pnpm run format` clean.
- Rule 13: `git diff HEAD -- packages/core/src` EMPTY; `git diff HEAD -- packages/mcp-server/src` no tracked-file change (only one NEW additive test file). `tool-contract.drift.test.ts` stays GREEN (17 tools + closed error/event sets unchanged).

### Completion Notes

- **AC1 — publish-readiness:** `core`/`data-access`/`mcp-server`/`cli` → `version: 0.1.0`, `private` removed, `publishConfig.access: "public"` added (scoped `@agentbbs/*` default-restricted otherwise), `license`/`description` added. `files`/`bin`/`main`/`exports` verified. `pnpm pack` proves leak-free rewrite (above). Actual `npm publish` OUT of scope (credentials/release action). **Posture decision:** `ui-shared` and `apps/web` left `private` — the web build SHIPS INSIDE the published `cli` (AC2), not as its own npm package; `ui-shared` is consumed only at build time by the apps (bundled), so neither needs to be npm-published for the V1 distribution. A new `packages/cli/src/distribution.packaging.test.ts` pins the manifest readiness.
- **AC2 — web ships with cli:** `packages/cli/scripts/copy-web-dist.mjs` copies `apps/web/dist` → `packages/cli/web-dist/` at cli `build` + `prepack`; `web-dist` added to cli `files`. `resolveWebDist` extended: env override → monorepo walk-up (dev) → **packaged `<cli-pkg>/web-dist`** when no workspace marker is found (installed-from-npm) → conventional fallback. Three new tests in `static-assets.test.ts` (packaged-layout resolution + the no-marker/no-packaged fallback). `web-dist/` added to `.gitignore`/`.prettierignore`/eslint ignores (built artifact).
- **AC3 — VSIX (+ reconciliation #1):** `@vscode/vsce@^3.9.2` cataloged + added as ext devDep; `.vscodeignore` (deny-list: src/tests/host-tests/maps/esbuild.js); `package:vsix` script; ext `version: 0.1.0` + `license`/`repository` added; ext README authored. `vsce package` produced a valid node:sqlite-only `.vsix` (above). **Three vsce blockers hit + reconciled (Rule 3/Rule 8 — see below):** scoped name, `catalog:` `@types/vscode`, `.vscodeignore`+`files` conflict. New `vsix-packaging.test.ts` pins the marketplace-valid config; the real `.vsix` production is the lead's smoke (heavy for the unit suite) but was dev-verified here. **No** `better-sqlite3`/`@electron/rebuild` added — the node:sqlite design obviates the stale prebuild clause.
- **AC4 — docs/architecture.md:** authored a curated docs-facing overview that links the canonical planning ADD and the drift-guarded contract docs; no machine-pinned claims (so it cannot drift) and reflects shipped reality (17 tools, node:sqlite extension). The Epic-7 guards (`tool-contract.drift.test.ts`, `negotiation-protocol-doc.test.ts`, etc.) pin `mcp-tool-contract.md`/`negotiation-protocol.md` only — both untouched, stay GREEN.
- **AC5 — README (+ reconciliation #2):** rewrote into the canonical stand-up guide (what/prereqs/build/run-UI/connect-an-agent with an MCP-client config example/agent-loop/docs-links). Says 17 (or count-agnostic); the guard forbids any `12 tools`/`12-tool` regression. README removed from `.prettierignore` (now a maintained asset; prettier-clean).
- **AC6 — content-guard:** `packages/mcp-server/src/readme-content-guard.test.ts` pins the README's sentinel-delimited (`AGENTBBS-README:BEGIN/END`, an HTML comment) machine claims: bins→`bin` fields, `AGENTBBS_DB`→`DB_PATH_ENV` (data-access), subcommands→new exported `SUBCOMMAND_NAMES` (cli dispatch), tool-count→live `Client.listTools()`. In mcp-server (not cli) because the live-count pin needs the MCP SDK, which cli must not reach (NFR2 boundary); cross-package symbols resolve via the root vitest alias. Mutation-tested non-vacuous.
- **AC7 — gate + Rule 13:** full gate GREEN; agent-facing source byte-identical (above).

#### Rule-4 corrected source-facts (surfaced loudly)

1. **README was NOT a bare "🚧 under construction / no code written" placeholder.** The Dev-Notes source-fact (and AC5) said so, but the actual README was already a rich conceptual doc that even said "complete 17-tool contract." It only carried an under-construction BANNER + a "Planning is complete; implementation has not started" status section. Reconciled by removing the stale banner/status and ADDING the missing operational sections (build/run/connect/agent-loop) + the sentinel guard block — not a from-scratch rewrite of a placeholder.

#### Rule-3 / Rule-8 reconciliations forced by vsce's ACTUAL behavior (verified against the installed 3.9.2)

2. **vsce rejects a scoped `name`.** `@agentbbs/vscode-extension` → `ERROR Invalid extension "name"`. Renamed the extension manifest `name` to UNSCOPED **`agentbbs-vscode-extension`** (extension ID `agentbbs.agentbbs-vscode-extension`). The extension is a leaf app (nothing imports it), so the only couplings were the two boundary forbid-lists (eslint `NO_CLIENT_FROM_CORE`, `on-demand.nfr.test.ts`) — both updated to the new name — plus stale comments. This is packaging metadata on a thin client; core/mcp-server agent surface untouched (Rule 13).
3. **vsce cannot parse a `catalog:` version string.** `@types/vscode: "catalog:"` → `ERROR Failed to parse semver of @types/vscode`. De-cataloged ONLY `@types/vscode` in the ext manifest to a concrete `^1.105.0` (== the catalog pin == the `engines.vscode` floor convention). No catalog-drift guard exists, so this is contained.
4. **vsce forbids `.vscodeignore` + `files` together.** Removed the ext manifest's `"files": ["dist"]` (the extension ships via VSIX/`.vscodeignore`, never npm — `files` was unused for it).
5. **`keytar` + `@vscode/vsce-sign` build scripts** (vsce transitive deps) set to `false` in `allowBuilds` — both are `vsce publish`-only (OUT of scope); `vsce package` works without them, keeping install non-interactive.

#### Scoped to the lead's per-story smoke (Rule 12)

- The actual `vsce package` `.vsix` PRODUCTION and the `pnpm pack` dry-runs were dev-verified here (evidence in Debug Log) but are not run inside the vitest suite (heavy/environment-coupled); the config + manifest readiness IS asserted by tests. The lead's smoke should re-produce the `.vsix` and confirm `agentbbs ui` serves the packaged web client from an installed-layout / the documented README happy path end-to-end.

### File List

**Modified:**

- `README.md` — rewritten into the canonical stand-up guide (AC5) + sentinel guard block (AC6).
- `packages/core/package.json` — version 0.1.0, drop private, publishConfig/license/description (AC1).
- `packages/data-access/package.json` — version 0.1.0, drop private, publishConfig/license/description (AC1).
- `packages/mcp-server/package.json` — version 0.1.0, drop private, publishConfig/license/description (AC1).
- `packages/cli/package.json` — version 0.1.0, drop private, publishConfig/license/description, `web-dist` in `files`, build/prepack/copy-web-dist scripts (AC1/AC2).
- `packages/cli/src/host/static-assets.ts` — packaged-layout `web-dist` resolution + `PACKAGED_WEB_DIST_DIR` export (AC2).
- `packages/cli/src/host/static-assets.test.ts` — packaged-layout + no-marker fallback tests (AC2).
- `packages/cli/src/index.ts` — exported `SUBCOMMAND_NAMES` from the dispatch table (AC6 source-of-truth).
- `packages/cli/src/host/on-demand.nfr.test.ts` — boundary forbid-list updated to the unscoped ext name.
- `apps/vscode-extension/package.json` — unscoped name, version 0.1.0, license/repository, vsce devDep, `package:vsix` script, removed `files` (AC3).
- `apps/vscode-extension/src/extension.ts` — header comment updated to the unscoped name.
- `apps/vscode-extension/host-tests/run-host-tests.cjs` — filter-name comment updated.
- `eslint.config.js` — boundary forbid-list updated to unscoped ext name; ignore `**/web-dist/**`; node-globals block for `*/scripts/**/*.mjs`.
- `pnpm-workspace.yaml` — cataloged `@vscode/vsce@^3.9.2`; `allowBuilds` keytar/@vscode/vsce-sign: false.
- `pnpm-lock.yaml` — vsce + transitive deps.
- `.gitignore` / `.prettierignore` — ignore `packages/cli/web-dist/`; README removed from prettierignore.

**Added:**

- `LICENSE` — MIT (OSS readiness / package `license` field).
- `docs/architecture.md` — docs-facing architecture overview (AC4).
- `apps/vscode-extension/.vscodeignore` — VSIX deny-list (AC3).
- `apps/vscode-extension/README.md` — extension README (vsce requires non-template; AC3).
- `apps/vscode-extension/src/vsix-packaging.test.ts` — VSIX config-readiness guard (AC3).
- `packages/cli/scripts/copy-web-dist.mjs` — copies apps/web/dist into the cli package (AC2).
- `packages/cli/src/distribution.packaging.test.ts` — npm publish-readiness guard (AC1/AC2).
- `packages/mcp-server/src/readme-content-guard.test.ts` — README Rule-10 content-guard (AC6).

### Change Log

- 2026-06-07 — Code review (capstone weight, Epic 11 final story). One HIGH auto-resolved inline (README UTF-8 corruption). Full canonical root gate re-run GREEN: lint clean · typecheck clean · build clean · `pnpm test` **1588 passed / 182 files / 0 failed** · `pnpm run format` clean. Rule 13 re-confirmed (`packages/core/src` diff EMPTY; `packages/mcp-server/src` adds ONLY the content-guard test; `tool-contract.drift.test.ts` + `server.bootstrap.test.ts` GREEN, 17-tool wire + closed error/event sets unchanged). AC6 content-guard independently mutation-tested non-vacuous (3 mutations RED, reverted byte-identical). See Review Findings below.
- 2026-06-06 — Story 11.5 implemented (AR23/AR25/NFR8 distribution + OSS stand-up). Four packages made npm-publish-ready (0.1.0, public); web build now ships inside the published cli; VS Code extension packages as a valid node:sqlite-only VSIX; `docs/architecture.md` added; README rewritten as the canonical stand-up guide with a Rule-10 content-guard. Two Rule-8 reconciliations honored (prebuild clause obviated by node:sqlite; 17 not 12 tools) + three vsce-forced reconciliations (unscoped name, de-cataloged @types/vscode, no `files` with `.vscodeignore`) recorded. Full root gate green (1582 tests); agent-facing core/mcp-server source byte-identical (Rule 13). Left UNCOMMITTED for the lead's per-story smoke gate.

## Review Findings (code-review stage, 2026-06-07)

**Verdict: APPROVED (1 HIGH auto-resolved inline; 0 open).** Capstone-weight review of the Epic-11-final OSS-readiness surface. Full canonical root gate re-run GREEN end-to-end.

### HIGH-1 (RESOLVED inline) — README.md shipped UTF-8-corrupted (mojibake) on the canonical OSS stand-up artifact

- **Issue:** The working-tree `README.md` — THE canonical stand-up guide AC5 ships for an outside developer — was double-encoded: it carried a spurious UTF-8 BOM and **97 mojibake sequences**. Every em-dash `—` rendered as `â€"`, every `👍` as `ðŸ‘`, every `→` as `â†'`, the box-drawing tree as `â”œâ”€â”€`, the `·` as `Â·`. At HEAD the file was clean UTF-8 (no BOM); the corruption was introduced during the Story-11.5 rewrite (saved through a CP1252/double-encode round-trip). The bytes still decode as valid UTF-8, so nothing crashed — but a reader/Markdown renderer sees garbled glyphs throughout the marquee document. **Why the AC6 guard missed it:** the content-guard pins ASCII machine tokens (`agentbbs-mcp-server`, `AGENTBBS_DB`, `17`, subcommands) — all survived the corruption intact — so the guard was correctly GREEN and non-vacuous, but structurally blind to prose-glyph mojibake. Contained to `README.md`; `docs/architecture.md`, the extension `README.md`, and `LICENSE` were verified clean (0 mojibake, no BOM).
- **Severity rationale:** HIGH — this IS the user-facing OSS deliverable of the story (and the epic); a corrupted README is the first thing an outside developer sees. Not deferrable.
- **Resolution:** Reversed the double-encoding per-character (CP1252 round-trip with a latin-1 fallback for the 0x80–0x9F box-drawing bytes; 0 unrecoverable chars, 0 replacement chars), stripped the BOM, normalized to LF. Verified strict-UTF-8 decode, 0 mojibake, all special glyphs restored (`—`, `👍`, `→`, `├└`, `·`), and **all machine tokens + the sentinel block byte-intact** (`mcp-tool-count: 17`, `cli-subcommands: ui, export, import`, the config-fence `"command": "agentbbs-mcp-server"`). Ran `prettier --write README.md` (it re-aligned only the two Markdown tables' column padding — the original mojibake's double-width glyphs had thrown off prettier's column math; pure cosmetic, no token/content change) → README is now prettier-clean (the dev had removed it from `.prettierignore`, so this is a gate requirement). Content-guard 10/10 GREEN after the fix.

### Verifications performed (capstone checklist — all PASS)

- **Rule 13 (agent contract byte-identical):** `git diff HEAD -- packages/core/src` EMPTY; `packages/mcp-server/src` adds ONLY `readme-content-guard.test.ts` (no agent-logic edit); `tool-contract.drift.test.ts` + `server.bootstrap.test.ts` GREEN in isolation (9/9) → 17-tool wire + closed error/event sets unchanged. Version/`private`/`publishConfig`/`files`/manifest edits are packaging metadata only.
- **Extension rename (scoped→unscoped) across ALL tiers:** the only live couplings — eslint `NO_CLIENT_FROM_CORE` forbid-list, `packages/cli/src/host/on-demand.nfr.test.ts` NFR2 forbid-list, `vsix-packaging.test.ts`, `extension.ts`/`run-host-tests.cjs` comments — all consistently use `agentbbs-vscode-extension`. No stale scoped name leaked into code/config (remaining `@agentbbs/vscode-extension` hits are historical `_bmad-output/` story docs only, where pnpm `--filter` still resolves by directory anyway).
- **AC6 content-guard mutation-tested non-vacuous (independent re-run):** (a) visible config-fence bin rename `agentbbs-mcp-server`→`agentbbs-server`, sentinel left correct → RED (the Rule-18 call-form/visible-surface assertion caught it); (b) sentinel `mcp-tool-count: 17`→`12` → RED (pinned to live `listTools()`); (c) sentinel drop a subcommand → RED (pinned to `SUBCOMMAND_NAMES` from the dispatch table). Reverted byte-identical (sha verified) → 10/10 GREEN.
- **AC2 packaged-web-dist resolver:** the four `static-assets.test.ts` precedence tests use REAL temp dirs (not mocks): packaged-layout resolves in the no-workspace-marker (npm-installed) layout; `AGENTBBS_WEB_DIST` override wins unconditionally; the monorepo walk-up still wins when a workspace marker exists (no dev regression); conventional fallback when neither present. Build confirmed `copy-web-dist.mjs` populated `packages/cli/web-dist`; `web-dist` is in cli `files`.
- **AC1/AC3 OUT-OF-SCOPE boundary honored:** no `npm publish` / `vsce publish` in any script; `package:vsix` runs only `vsce package` (local artifact). Publish-readiness is real: all four packages 0.1.0, `private` dropped, `publishConfig.access: public`, `bin`/`main`/`exports`/`files` correct; source deps stay `workspace:*`/`catalog:` (pnpm rewrites at pack — the dev's `pnpm pack` dry-run + the lead's smoke own the actual tarball/`.vsix` production).
- **Rule 8 reconciliations correct:** (1) VSIX is genuinely node:sqlite-only (the bundle/manifest carry no `better-sqlite3`/`@electron/rebuild`); (2) README + docs say 17 (never 12 — guard forbids the `\b12[\s-]tools?\b` regression).
- **`docs/architecture.md` (AC4):** curated overview with NO machine-pinned claims (count-agnostic on the tool surface, defers to the drift-guarded `mcp-tool-contract.md`) → cannot drift; accurately reflects shipped reality (node:sqlite extension, wasm-unsafe-eval CSP, cli-ships-web-dist). The Epic-7 doc drift-guards untouched + GREEN.
- **Root gate:** `pnpm run lint` clean · `pnpm run typecheck` clean · `pnpm run build` clean · `pnpm test` **1588 passed / 182 files / 0 failed** · `pnpm run format` clean.

### Note for the lead's per-story smoke

The actual `pnpm pack` (four tarballs, leak-free `workspace:`/`catalog:` rewrite) and `vsce package` (a real node:sqlite-only `.vsix`) production are heavy/environment-coupled and NOT run inside the vitest suite (the config-readiness halves ARE asserted by `distribution.packaging.test.ts` + `vsix-packaging.test.ts`). The dev verified both during dev (evidence in Debug Log); the lead's smoke should re-produce the `.vsix` + confirm `agentbbs ui` serves the packaged web client from an installed-layout per the README happy path.
