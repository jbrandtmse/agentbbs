# Test Automation Summary — Story 10.4 (Rooms as WebviewPanels)

QA stage: `qa-generate-e2e-tests`. Value-add focused on the SEAMS the dev tests skipped (Epic-9
pattern), per the stage brief. The dev's tier (RoomApp.test.tsx, room-panel.test.ts, bridge.test.ts,
bridge-client.test.ts, the real-host probe) already covered the AC happy paths; these add the
seam/security/parity coverage that AC-shaped tests structurally miss.

## Rule 7 — re-confirmed the dev's load-bearing mutation (no new code, evidence only)

- **AC4 proto-room reply-to-activate** (`bridge.test.ts`): broke the bridge `reply` op (skip core,
  return `active:false`) → the activation test went RED (`expected true, received false`); reverted
  byte-identical (verified no residue in `bridge.ts`).
- Each NEW high-stakes test below was also mutation-tested non-vacuous and the production source
  reverted byte-identical.

## Generated Tests (3 files, +39 tests; ROOT `pnpm test` 1320 → 1359)

### `apps/vscode-extension/src/webview/webview-html.qa.test.ts` (node tier, 9 tests)
The hardened nonce-CSP content-guard (candidate b). Each CSP directive asserted independently
(`default-src 'none'`, `script-src` admits ONLY the nonce — no host/unsafe-*/wildcard, `style-src`
nonce + cspSource only), no inline `<script>` body / no inline `style=` attr, the per-load nonce on
the script AND every style `<link>`, a fresh nonce flows verbatim, and untrusted room-id / operator-
handle / style-URI break-out attempts stay attribute-escaped (the SHELL guard; markdown-body
inertness is ui-shared's DOMPurify, proven in 9.2).
**Mutation:** added `'unsafe-inline'` to `script-src` → RED; reverted.

### `apps/vscode-extension/src/webview/vscode-tokens.qa.test.ts` (node tier, 26 tests)
The `--vscode-*` theme-layer content-guard + Rule 13 (candidate e). Pins each required semantic
token (surface/text/accent/agreed/flag/border/font) remaps to a `--vscode-*` var (not a literal),
every override carries a web-palette FALLBACK, fonts defer to `--vscode-font-family`/editor-font,
the theme layer is the LAST `<link>` (its `:root` overrides win), and `packages/ui-shared/src/
tokens.css` is BYTE-IDENTICAL to HEAD (mount, don't fork).
**Mutation:** appended a comment to `ui-shared/tokens.css` → the byte-identical guard RED; reverted.

### `apps/vscode-extension/src/webview/RoomApp.qa.test.tsx` (happy-dom / ui-shared-dom project, 4 tests)
The DOM-tier seams (candidate d + the agreedSeq-render gap). A PEER clicking the reaction chip in
the MOUNTED RoomApp fires the EXISTING `react` op for the correct message seq, a second click fires
`unreact` (toggle from current live state — NOT a dead click); a WATCHING operator's chip is the
disabled join hand-off and fires NO bridge write (Rule 13 — no non-participant backdoor); a
readContract agreedSeq actually RENDERS the ✓ AgreedMark on the converged post (vs null → no mark).
Runs under the ROOT vitest `ui-shared-dom` happy-dom project (Rule 12 corollary; `beforeAll(prewarm
Highlighter)` 9.5-shiki carry).
**Mutation:** `handleToggleReaction` early-return (dead click) → the react test RED; reverted.

## Rule 13 verification (independent of the new tests)
`git diff HEAD` is EMPTY for `packages/core`, `packages/mcp-server`, and the entire `packages/ui-shared`
package — the agent-facing contract and byte-shared UI are untouched. The data-access `.ts` drift the
dev noted is whitespace-only (an import joined onto one line — non-behavioral). RoomView is MOUNTED,
not forked (no ui-shared component copied into the extension).

## Coverage
- AC1 (panel keying / reveal-not-duplicate / dispose): dev's room-panel.test.ts + real-host probe.
- AC2 (mount + CSP + model build): dev tier + NEW hardened CSP guard + NEW agreedSeq render.
- AC3 (`--vscode-*` theme): dev's load-order check + NEW theme-layer content-guard + Rule-13 pin.
- AC4 (proto-room reply-to-activate): dev tier (mutation re-confirmed) + real-host probe.
- 👍 react/unreact round-trip: dev's bridge tier + NEW DOM not-a-dead-click proof.

## Gate (canonical = ROOT `pnpm test`)
ROOT `pnpm test` 1359/1359 · typecheck 0 · lint 0 · format clean. Known seed-protocol-race EPERM
Windows flake did not surface this run.

## Next Steps
- Lead's real-Chrome/theme-paint smoke (Rule-12 fidelity) remains the load-bearing manual gate.
- 10.5 (CSP hardening / retain-LRU / serializer), 10.6 (live fold + a11y) extend these guards.
