# Test Automation Summary — Story 11.5 (Distribution & OSS stand-up docs)

QA stage: `qa-generate-e2e-tests`. Harden the GUARDS (this is a packaging + agent/operator-consumed-docs story, not a feature suite).

## Generated / strengthened tests

### AC6 — README Rule-10 content-guard (load-bearing) — STRENGTHENED
`packages/mcp-server/src/readme-content-guard.test.ts`

- The dev's guard pinned only the **sentinel block** (`AGENTBBS-README:BEGIN/END`) values to code (bins, `AGENTBBS_DB`, subcommands, live `listTools()` count = 17). QA found a real **call-form blind spot** (Rule 18 / Epic-8 class): the sentinel is the machine MIRROR, but an outside developer copy-pastes the VISIBLE prose/code-fences. A prose-only drift (e.g. the MCP-client config fence `"command": "agentbbs-mcp-server"` renamed to a non-existent bin) left the sentinel-only guard GREEN — **empirically proven**: renaming the visible config command to `agentbbs-server` passed all 6 original tests.
- Added 4 visible-surface assertions (run against the README with the sentinel comment stripped):
  1. The MCP-client config fence `"command"` value IS the mcp-server bin, and no `agentbbs-*` command value is anything other than the real bin (pins the literal copy-pasted invocation).
  2. The visible README invokes the `agentbbs` cli bin in call form (`agentbbs <sub>`).
  3. The visible README shows the `AGENTBBS_DB` env var.
  4. The visible README invokes EVERY `SUBCOMMAND_NAMES` entry as `agentbbs <sub>` (drift in any one -> RED).
- **Mutation-tested non-vacuous (Rule 7):** config-fence command rename (-> `agentbbs-server`) -> RED; visible `agentbbs export` -> `agentbbs dump` (sentinel kept) -> RED; visible `AGENTBBS_DB` -> `AGENTBBS_PATH` (sentinel kept) -> RED. README restored byte-identical each time (verified no leak).

### AC2 — packaged-web-dist resolution — STRENGTHENED
`packages/cli/src/host/static-assets.test.ts`

- The dev's 4 cases (override / monorepo walk-up / packaged-no-marker / fallback) over real temp dirs were complete. QA added 2 **precedence** pins:
  1. `AGENTBBS_WEB_DIST` override wins even when a packaged web-dist exists (escape hatch is unconditional).
  2. The monorepo dev path wins over a packaged web-dist when a workspace marker is present (the packaged branch does not shadow the dev experience — no regression).

## Intentionally NOT changed (sufficient as shipped)

- **AC1 real pack** — the dev's `distribution.packaging.test.ts` pins the static manifest; the actual `pnpm pack` tarball production (workspace:/catalog: rewrite, 304 web-dist assets) was dev-verified and is the lead's smoke (heavy/environment-coupled in-suite). Left to the lead smoke per the test's own documented rationale.
- **AC3 VSIX node:sqlite-only bundle** — already proven against the BUILT artifact by `apps/vscode-extension/src/bundle-and-activation.test.ts` (`dist/extension.cjs` has `require("node:sqlite")`, 0 live `require("better-sqlite3")`, no `*.node`; plus a synthetic-import test exercising the `external` rule). The VSIX config guard (`vsix-packaging.test.ts`) pins the marketplace-valid manifest. A config-level `external` assertion would be redundant + weaker than the artifact proof — not added. Real `vsce package` `.vsix` production is the lead's smoke.

## Discoverability (Rule 8)
All touched test files are collected by ROOT `pnpm test`: the README guard + static-assets are node-project `*.test.ts`; `vsix-packaging.test.ts` is `apps/vscode-extension/src/*.test.ts` (node project, not the `*-dom` project). Confirmed via root run.

## Canonical gate (ROOT, Rule 12)
- `pnpm run lint` — exit 0, clean
- `pnpm run typecheck` — exit 0, clean
- `pnpm run build` — exit 0 (web-dist copy ran)
- `pnpm test` — **182 files, 1588 passed** (was 1582; +6 QA assertions)
- `pnpm run format` — exit 0, clean

## Rule 13
`git diff HEAD -- packages/core/src` empty; only mcp-server/src change is the new test file; agent-facing source byte-identical. The 17-tool drift-guard stays green.
