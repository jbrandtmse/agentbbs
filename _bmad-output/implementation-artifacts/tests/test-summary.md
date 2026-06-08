# Test Automation Summary — Story 12.3 (cross-project integration guidance, FR42)

QA stage: `bmad-qa-generate-e2e-tests`. Guidance/asset story — content-guard coverage (no UI, no API; Rule 3 real-runtime exemption noted: the guards parse the shipped assets + pin tool names to the live §6 contract, transitively bound to the real `McpServer` by `tool-contract.drift.test.ts`). Canonical gate = ROOT `pnpm test`.

## Generated / Strengthened Tests

### New
- [x] `packages/mcp-server/src/cross-project-play-consistency-doc.test.ts` — cross-asset Rule-8 consistency guard for the Story-12.3 play. 4 tests:
  - every distinctive play tool is a real §6 registered tool (Rule 10 / Rule 13 — no new tool);
  - the registry Rule C names the FULL distinctive play tool set (closes the per-asset gaps, incl. `read_room`);
  - the snippet §4 names the FULL distinctive play tool set;
  - **the registry Rule C and the snippet §4 name the SAME play tool set** — derived from asset CONTENT, not a shared hard-coded constant — so a future cross-asset drift turns RED (the per-asset guards would not).

## QA verifications (independent re-run, not trusting the dev's claims — Rule 20)

- **AC1 completeness.** Both dev guards pin the four distinctive PLAY_TOOLS (`list_projects`, `list_members`, `post_announcement`, `add_participant`); the four-move/cadence tools (`reply`/`react`/`read_contract`/`read_room`) are pinned by the per-asset REGISTRY_TOOLS/PROTOCOL_TOOLS and the negotiation-protocol guard. The new guard additionally pins the FULL 9-tool play set required-present in BOTH assets, closing the `read_room` gap (named in the play but not positively pinned in the snippet guard).
- **AC2 + 7.3 closure (non-vacuous, mutation-tested).** Confirmed via regex probe AND a full suite-level mutation: in BOTH assets, `add_participant` / `list_members` / `post_announcement` appear ONLY in call-form (`tool{…}`) — the OLD narrow regex `` `tok` `` captures NONE of them; the BROADENED `` `tok`(?:`|{) `` captures all three. Planted a call-form-only phantom `` `provision{ project_id }` `` in the inlined block → snippet guard RED on `["provision"]`; the narrow regex would have slipped GREEN. Broadening is ADDITIVE (still catches a bare-backtick phantom `subscribe`). Asset reverted byte-identical; guard re-GREEN. `7.3-snippet-callform-latent` genuinely closed.
- **Two-places drift.** `install-kit-doc.test.ts` drift pins GREEN; the kit's inlined snippet sentinel block + registry Rule-A…"How this registry relates" slice are byte-identical to canonical (verified directly).
- **Allowlist hygiene (Rule 18).** `project_id` is NOT one of the 17 real §6 tools → allowlisting masks no real tool. `@operator` is not a backticked snake token → correctly never a phantom candidate.
- **Rule 13.** `git diff HEAD` over `packages/core` + `packages/data-access` empty; only the two dev `*-doc.test.ts` guards + the new guard changed under `packages/mcp-server/src`.
- **Rule 8 (test discoverability).** New file is `*-doc.test.ts`, co-located, picked up by `vitest list` under the `[agentbbs]` project — runs in the default ROOT suite.

## Finding fixed (real, low-severity Rule-8 cross-asset drift)

The new SAME-set guard caught a genuine drift the dev's per-asset guards missed: registry **Rule C** step 4 names `unreact` ("Ratify via `react` (retract with `unreact`)"), but snippet **§4** step 4 omitted it ("Ratify via `react`"). Faithful fix: added `(retract with `unreact`)` to snippet §4 to match Rule C, and updated the install-kit's inlined §3.7 copy byte-identically (kit sentinel block still byte-identical to canonical; no encoding corruption — Rule 21 checked: no BOM, no mojibake, LF, glyphs intact).

## Gate legs (changed files)

- ESLint: clean. Prettier: clean (after `--write` on the new test). `tsc -b packages/mcp-server`: 0 errors.
- Doc-guard suite (6 files incl. live-surface drift guard): 60 passed.

## Coverage
- AC1 (play documented in both assets): covered + cross-asset-consistency pinned.
- AC2 (content-guarded, non-vacuous, no new tool): covered + mutation-proven; 7.3 carry closed.
