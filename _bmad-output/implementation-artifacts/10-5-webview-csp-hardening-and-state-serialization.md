---
baseline_commit: 995375f
---

# Story 10.5: Webview CSP hardening and state serialization

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a security-conscious operator,
I want the room webview locked down and resilient across reloads/backgrounding,
so that untrusted board content stays inert (NFR12) and unread survives backgrounding (AR22).

## Acceptance Criteria

1. **(AC1 — strict CSP, NFR12/AR22)** Given a room webview, when it loads, then its CSP is `default-src 'none'` with scripts allowed ONLY via a per-load nonce and styles ONLY via the nonce + `webview.cspSource`; `img-src`/`font-src`/`connect-src` are pinned to the minimum the webview actually needs (no wildcards beyond `cspSource` + any genuinely-required `data:`), and there is NO `unsafe-inline`/`unsafe-eval`. Markdown renders inert via the SAME ui-shared stack (markdown-it HTML-off → DOMPurify → Shiki class spans) — code-as-text, safe links, no auto-navigation, no script execution. A content-guard test pins the CSP shape (mutation-tested: any loosening — a wildcard, `unsafe-inline`, a missing nonce — turns it RED), and the inert-render contract is asserted (a planted `<script>`/`<img onerror>` in a message body does NOT execute/fire).

2. **(AC2 — retain + LRU + serializer)** Given active and recently-used rooms, when I switch away and back OR reload the window, then: the ACTIVE room panel uses `retainContextWhenHidden` (no re-render/scroll-loss on tab switch); a small **LRU** keeps the N most-recent rooms warm (beyond N, `retainContextWhenHidden` is dropped so non-retained rooms re-render correctly on focus — bounded memory); and a `WebviewPanelSerializer` (registered via `window.registerWebviewPanelSerializer`) restores backgrounded room tabs across a **window reload** with their unread/identity state intact (the panel re-attaches to its room + re-reads, rather than vanishing). Non-retained rooms re-render correctly when focused.

## Integration ACs

This story HARDENS the Story-10.4 room webview surface (no new consumer surface; it makes the existing one secure + resilient). AC1/AC2 are real-runtime integration ACs verified in the real VS Code Electron host (`@vscode/test-electron`): the served CSP string is strict + the inert contract holds in a real webview; the serializer is registered + a serialize→deserialize round-trip restores a room panel to its room. Per Rule 1 this is a hardening story over an existing wired surface, not a new producer.

## Tasks / Subtasks

- [x] **Task 1 — Strict CSP hardening (AC1)**
  - [x] In `apps/vscode-extension/src/webview/webview-html.ts`, finalize the strict CSP: `default-src 'none'`; `script-src 'nonce-<n>'`; `style-src <cspSource> 'nonce-<n>'`; `img-src <cspSource>` (drop `data:` UNLESS the inert markdown genuinely needs it — verify; if code-as-text never emits images, omit it); `font-src <cspSource>`; `connect-src 'none'` (the webview talks to the host via `acquireVsCodeApi().postMessage`, NOT network — confirm no fetch/EventSource in the webview bundle); no `unsafe-inline`/`unsafe-eval`. Resolve the CR-deferred note (10.4: `img-src`/`font-src` were unpinned). [Source: deferred-work Story 10.4 review.]
  - [x] Confirm the webview bundle issues ZERO network requests (NFR12 inert; the 9.2 web canary precedent) — the bridge is postMessage-only. A real-host/DOM assertion that no content-triggered request fires.
  - [x] Content-guard test (mutation-tested, Rule 7): the CSP contains the nonce + `default-src 'none'` + no `unsafe-*`/wildcard; a planted `unsafe-inline`/wildcard/missing-nonce turns it RED. Plus an inert-render assertion (a `<script>`/`<img onerror=>` in a message body does not execute — reuse/мirror the 9.2 XSS-corpus approach over the ui-shared MarkdownView; use `beforeAll(prewarmHighlighter)` if it renders code — 9.5-shiki carry).
- [x] **Task 2 — retainContextWhenHidden + LRU (AC2)**
  - [x] In `apps/vscode-extension/src/room-panel.ts` (the `RoomPanelManager`), set `retainContextWhenHidden: true` for the active + the N most-recent room panels (an LRU of room ids, e.g. N=4); when a panel falls out of the LRU window, it does NOT retain (re-renders on focus). Track LRU order on panel reveal/focus (`onDidChangeViewState`). Keep memory bounded; the LRU logic is host-side + unit-testable (a pure LRU over room ids with a configurable cap; eviction order proven).
  - [x] Non-retained rooms re-render correctly on focus: on `onDidChangeViewState` becoming visible, a non-retained panel re-runs its mount/read (the webview re-initializes; the bridge re-feeds the model). Assert the re-render path works.
- [x] **Task 3 — WebviewPanelSerializer (AC2)**
  - [x] Add `apps/vscode-extension/src/serializer.ts` implementing `vscode.WebviewPanelSerializer` and register it via `window.registerWebviewPanelSerializer('agentbbs.room', serializer)` in `activate` (with the matching `package.json` contribution if required). On `deserializeWebviewPanel(panel, state)`, re-attach the panel to its room (the room id persisted in the panel `state` via `webview.postMessage`/`setState` round-trip or the panel's serialized state), re-set the HTML (fresh nonce), and re-feed the model from the bridge so unread/identity state is correct after reload. The `RoomPanelManager` adopts the deserialized panel into its `Map` (so reveal-not-duplicate still holds post-reload).
  - [x] Persist the room id in the webview state (`acquireVsCodeApi().setState({ roomId })` in the bundle, restored on deserialize). Verify the round-trip.
- [x] **Task 4 — Tests (Rule 7/8/12) + real-host smoke**
  - [x] Host-side unit tests (root-`pnpm test`-discoverable): room-lru.test.ts (cap/eviction), serializer.test.ts (deserialize→adopt), webview-html.csp.test.ts (mutation-tested CSP guard), room-panel.test.ts (retain/LRU/adoptPanel).
  - [x] DOM/inert test: RoomApp.inert.test.tsx under the root happy-dom project (Rule 8/12 corollary — `apps/vscode-extension/src/**/*.test.tsx` mapped to `ui-shared-dom`).
  - [x] Real-host `@vscode/test-electron`: extended room-panel.in-host.ts — strict CSP holds in a real webview (cspStrict), serializer registers, deserialize round-trip re-attaches (deserializeReattached). The TRUE window-reload restore is a MANUAL lead-reload smoke step (cannot be triggered headlessly), documented + NOT asserted green on a stub (Rule 12).
- [x] **Task 5 — Record decisions** (see Completion Notes).

## Dev Notes

### Current CSP (10.4 baseline to harden)
[Source: apps/vscode-extension/src/webview/webview-html.ts] Already: `default-src 'none'`, `script-src 'nonce-<n>'`, `style-src <cspSource> 'nonce-<n>'`, `img-src <cspSource> data:`, no `unsafe-inline`/`unsafe-eval`; room id + operator handle passed via `data-*` attributes (NOT inline script — keeps CSP clean). 10.5 TIGHTENS: pin `img-src`/`font-src`/`connect-src` to the minimum (the CR's deferred 10.4 note), confirm `connect-src 'none'` (postMessage-only, no network), and re-evaluate whether `data:` in `img-src` is needed (drop if not). The strict CSP is POSSIBLE precisely because the inert-markdown stack uses no inline script/style/eval and no in-webview highlighter (Shiki tokenizes to class spans at build/host time). [Source: architecture.md l.287–288.]

### Retain / LRU / serializer (AR22)
[Source: architecture.md l.288, l.561–562] `room-panel.ts` = `one WebviewPanel per room; CSP + retain/LRU`; `serializer.ts` = `WebviewPanelSerializer (unread survives reload)`. The web surface had no analogue (a browser tab is the OS's concern); this is VS Code-specific resilience. `retainContextWhenHidden` keeps the active/recent panels' DOM alive across tab switches (no scroll/state loss); the LRU bounds how many stay retained; the serializer makes backgrounded room tabs survive a full window reload (VS Code calls `deserializeWebviewPanel` for each persisted panel on reload). Verify all APIs against the installed `@types/vscode` (Rule 3): `WebviewPanelOptions.retainContextWhenHidden`, `window.registerWebviewPanelSerializer`, `WebviewPanelSerializer.deserializeWebviewPanel(panel, state)`, `webview.getState`/`setState` (webview-side via `acquireVsCodeApi`), `onDidChangeViewState`.

### Panel-exclusivity carry
[Source: 10-0-epic-9-deferred-cleanup.md] Panel-exclusivity is web-DOM-specific; for ROOMS the model is "reveal-not-duplicate per room id" (already in 10.4) + "multiple room tabs OK" — NOT single-open exclusivity. The single-open-initiate-panel exclusivity is Story 10.7's (the compose surfaces). This story's serializer/LRU must keep reveal-not-duplicate correct ACROSS a reload (the deserialized panel is adopted into the manager's map so a later open reveals it, not duplicates).

### Module boundary / Rule 13
Pure hardening of the client surface; `git diff HEAD -- packages/core packages/mcp-server packages/ui-shared` stays EMPTY (no core/contract/ui-shared change — the inert stack is reused as-is). No new board op, no agent push. The operator handle stays a host-surface display field.

### Testing standards / baseline
[Source: project-rules.md Rules 7, 8, 12] Canonical gate = ROOT `pnpm test` + the FULL aggregate gate (build/typecheck/lint/format — the lead now runs the whole aggregate at smoke after the 10.3 drift). Mutation-test the CSP content-guard non-vacuous. Real-host evidence via `@vscode/test-electron`. Baseline entering 10.5: 1359 tests (1 known Windows teardown flake, item E10-baseline-seedrace-eperm — NOT yours). NOTE: run the FULL aggregate gate, not just `pnpm test` — the 10.3 review only verified vitest and missed a typecheck/format drift (deferred-work 10.4 process note).

### Project Structure Notes
- New: `apps/vscode-extension/src/serializer.ts` + the LRU/retain logic in `room-panel.ts` + the CSP tightening in `webview-html.ts` + the webview-state round-trip in the bundle; tests (host-side + DOM-inert + real-host).
- A true window-reload restore may be a manual lead-smoke step if `@vscode/test-electron` can't trigger a reload headlessly — be honest about which half is automated vs manual (Rule 12: don't assert reload-restore green on a stub).

### References
- [Source: epics.md#Epic 10 / Story 10.5; architecture.md l.287–288, l.561–562]
- [Source: apps/vscode-extension/src/{webview/webview-html.ts, room-panel.ts, webview/main.tsx} (10.4); packages/ui-shared/src/markdown/* (inert stack); apps/web 9.2 XSS-corpus precedent]
- [Source: .claude/rules/project-rules.md Rules 1, 3, 7, 8, 12, 13; 10-0-epic-9-deferred-cleanup.md (panel-exclusivity + 9.5-shiki carries); deferred-work.md (10.4 CSP img/font + aggregate-gate notes)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story).

### Debug Log References

- Full aggregate gate (Rule 12): `pnpm run lint` (0), `pnpm run build` (8/8), `pnpm --filter @agentbbs/vscode-extension typecheck` (0), `pnpm vitest run` (1391 passed, 0 skipped; baseline 1359 → +32), `pnpm run format --check` (clean after one prettier --write pass — the 10.3-drift lesson reproduced: format flagged 5 new files, fixed).
- Real-host smoke: `pnpm --filter @agentbbs/vscode-extension test:host` — all four probes exit 0 in the real Electron host (electron 42.2.0 / node 24.15.0); `cspStrict:true`, `serializerRegistered:true`, `deserializeReattached:true`.
- CSP mutation-test (Rule 7) against the REAL production source: loosened `img-src` to `${cspSource} data: https:` → 4 guard tests RED → reverted byte-identical → green.

### Completion Notes List

**Rule 3 — verified APIs against installed @types/vscode 1.120.0 (deltas recorded):**
- `WebviewPanelOptions.retainContextWhenHidden` is **`readonly`** — it is fixed at `createWebviewPanel` time and CANNOT be toggled on a live panel. This is the load-bearing finding: the LRU cannot un-retain a panel. Design consequence below.
- `window.registerWebviewPanelSerializer(viewType, serializer): Disposable`.
- `WebviewPanelSerializer.deserializeWebviewPanel(webviewPanel, state)` — panel is the FIRST arg, state the SECOND (the docstring also says the serializer must take ownership: re-set `.html` + re-hook events — which `adoptPanel` does).
- `onDidChangeViewState` fires `WebviewPanelOnDidChangeViewStateEvent` (`.webviewPanel`); the panel's `.visible` is read to detect a hidden→visible transition.
- webview-side `acquireVsCodeApi().setState(obj)` / `getState()` for the persisted state (round-tripped to the serializer on reload).

**Decision — the final strict CSP (AC1):**
`default-src 'none'; img-src <cspSource>; font-src <cspSource>; style-src <cspSource> 'nonce-<n>'; script-src 'nonce-<n>'; connect-src 'none'`
- `default-src 'none'` — locked-down base.
- `script-src 'nonce-<n>'` — ONLY the per-load-nonce'd bundle module; no host, no unsafe-*.
- `style-src <cspSource> 'nonce-<n>'` — the nonce'd `<link>`s + the webview's own asset origin.
- `img-src <cspSource>` — own-origin ONLY. **Dropped the 10.4 `https: data:` grant** after verifying the inert-markdown stack emits NO images (`img` not in ui-shared's DOMPurify `ALLOWED_TAGS`; `src`/`srcset` are `FORBID_ATTR`).
- `font-src <cspSource>` — own-origin ONLY (verified no `@font-face`/`url()` in the ui-shared CSS; VS Code supplies fonts via `--vscode-font-family`).
- `connect-src 'none'` — the webview is postMessage-only; verified the bundle has NO fetch/EventSource/XMLHttpRequest/WebSocket. NFR12 inert.
- NO `unsafe-inline`/`unsafe-eval` (the inert stack needs neither — that is what makes the strict CSP possible).

**Real-host CSP finding (Rule-12 value — the fixture could NOT see this):** the REAL `webview.cspSource` on a modern VS Code build is NOT a single `vscode-webview://…` origin — it is `'self' https://*.vscode-cdn.net` (asWebviewUri rewrites local resources onto the vscode-cdn.net CDN). So in the real webview `img-src`/`font-src` legitimately expand to `'self' https://*.vscode-cdn.net`. This is the host's OWN-asset allowlist, NOT a wildcard the extension added — `img-src ${cspSource}` is still own-origin-only. The fixture guards use a synthetic single-origin cspSource (correct for pinning the BUILDER shape); the in-host probe asserts each directive is pinned to EXACTLY the real cspSource (no extra token, no `data:`). My first in-host assertion was too strict (globally banned `*`/`https:`) and the real host caught it — corrected to be cspSource-relative.

**Decision — LRU + retain (AC2):** because `retainContextWhenHidden` is readonly, the LRU (`room-lru.ts`, default cap 4) does NOT un-retain live panels; instead `RoomPanelManager.decideRetain()` caps how many open panels are CREATED retained (`retainedCount < cap` → retained; otherwise non-retained). This bounds live-DOM memory to at most `cap` panels. A non-retained panel re-renders on a hidden→visible `onDidChangeViewState` (re-set HTML → fresh nonce → webview re-init → bridge re-feeds the model); a retained one does not (DOM kept alive). The LRU is a pure host-side structure (touch/move-to-front/eviction-order), unit-tested independently.

**Decision — serializer state shape (AC2):** the webview persists `{ roomId }` via `acquireVsCodeApi().setState`. On reload VS Code calls `deserializeWebviewPanel(panel, state)`; `roomIdFromState` resolves the room id (accepts `{ roomId }` or a bare string defensively), then `RoomPanelManager.adoptPanel(roomId, panel)` re-sets the HTML (fresh nonce), binds a fresh bridge, re-reads the room (unread/identity correct — read fresh, not cached), and ADOPTS the panel into the keyed map so reveal-not-duplicate survives the reload. A state with no resolvable room id is a no-op.

**Real-host-verified vs manual-reload-pending (Rule 12):** real-host-VERIFIED = the strict CSP in a real webview, the serializer registration API, and the deserialize→re-attach round-trip (a real fresh panel + persisted state → adopted → reveal-not-duplicate). MANUAL-PENDING = a TRUE window reload (VS Code persisting panels across an actual `reloadWindow` and reviving them via the serializer) — `@vscode/test-electron` cannot trigger a headless reload, so that is a manual lead-reload smoke step; it is documented in the probe and NOT asserted green on a stub.

**Rule 13 (thin client):** `git diff HEAD -- packages/core packages/mcp-server packages/ui-shared` is EMPTY. No new board op, no agent push; pure client hardening + resilience. The operator handle stays a host-surface display field. The inert ui-shared stack is reused as-is.

**Rule 5/6:** no NFR tripwire (NFR12 inert + AR22 resilience are implementable as worded — no planning-artifact amendment). No ADRs in `docs/adr/` (Rule 6 N/A).

### File List

New:
- apps/vscode-extension/src/room-lru.ts
- apps/vscode-extension/src/serializer.ts
- apps/vscode-extension/src/room-lru.test.ts
- apps/vscode-extension/src/serializer.test.ts
- apps/vscode-extension/src/webview/webview-html.csp.test.ts
- apps/vscode-extension/src/webview/RoomApp.inert.test.tsx

Modified:
- apps/vscode-extension/src/webview/webview-html.ts (strict CSP: pin img-src/font-src, add connect-src 'none', drop data:/https:)
- apps/vscode-extension/src/room-panel.ts (LRU + retain decision + onDidChangeViewState re-render + adoptPanel + PanelFactory retain arg + PanelLike onDidChangeViewState/visible)
- apps/vscode-extension/src/extension.ts (pass retain into createWebviewPanel options; register the serializer)
- apps/vscode-extension/src/webview/main.tsx (acquireVsCodeApi().setState({ roomId }))
- apps/vscode-extension/package.json (onWebviewPanel:agentbbs.room activation event)
- apps/vscode-extension/src/room-panel.test.ts (fake panel retain/viewState; LRU + adoptPanel tests; factory 3-arg)
- apps/vscode-extension/src/webview/webview-html.qa.test.ts (strict img-src/font-src/connect-src + whole-CSP floor guards)
- apps/vscode-extension/src/bundle-and-activation.test.ts (vscode mock: registerWebviewPanelSerializer + panel onDidChangeViewState/visible)
- apps/vscode-extension/src/abi-proof.test.ts (vscode mock: same as above)
- apps/vscode-extension/host-tests/room-panel.in-host.ts (real-host strict-CSP + serializer-register + deserialize-round-trip assertions)
- apps/vscode-extension/host-tests/run-host-tests.cjs (assert the new in-host fields)

### Change Log

- 2026-06-02 — Story 10.5 implemented: strict webview CSP (AC1) + retainContextWhenHidden/LRU + WebviewPanelSerializer (AC2). +32 tests (1359→1391). Full aggregate gate green; real-host smoke green. Left uncommitted for the lead's post-CR smoke gate.

## Review Findings (code review, 2026-06-02)

**Verdict: APPROVED — 0 HIGH / 0 MED / 0 LOW-blocking. 2 LOW/INFO + 1 forward-risk recorded to deferred-work.md. AC1 + AC2 both met with honest real-runtime evidence.**

- **AC1 (strict CSP + inert):** MET. Final CSP `default-src 'none'; img-src <cspSource>; font-src <cspSource>; style-src <cspSource> 'nonce-<n>'; script-src 'nonce-<n>'; connect-src 'none'` — every directive minimal, no `unsafe-*`/`data:`/wildcard, fresh per-load nonce. The 10.4 CR-deferred `img-src https:/font-src` note is RESOLVED. Inert-render contract re-verified (real RoomApp mounted with `<script>`/`<img onerror>`/`fetch`/js-link payloads → canary never fires, zero fetch, no live dangerous element). `connect-src 'none'` genuinely holds (postMessage-only bridge; no fetch/EventSource in the webview bundle).
- **AC2 (retain + LRU + serializer):** MET. `retainContextWhenHidden` confirmed READONLY in `@types/vscode@1.120.0`; the LRU correctly caps how many panels are CREATED retained (bounded live-DOM memory) rather than un-retaining live panels — the right design given the constraint. Serializer deserialize fails SAFE on missing/garbage state (no-op, no wrong-room adopt), `adoptPanel` re-attaches into the keyed map (reveal-not-duplicate survives reload), fresh nonce on every (re)set/adopt. Manual window-reload restore is honestly scoped as a lead-reload step, NOT faked green.
- **Rule 3:** all three VS Code APIs verified against the installed types (retain readonly @ d.ts:10082, `deserializeWebviewPanel(panel,state)` @ :10221, `registerWebviewPanelSerializer(...):Disposable` @ :11743).
- **Rule 7 (mutation, reviewer-re-confirmed non-vacuous, all reverted byte-identical):** loosened the REAL `img-src` → 4 CSP guards RED; off-by-one'd the REAL LRU comparator → 4 LRU guards RED; inert + state-roundtrip carry their own in-test mutation proofs that discriminate. All production source reverted byte-identical, gates GREEN.
- **Rule 12 (canonical gate, FULL aggregate):** reviewer re-ran ROOT `pnpm test` (1397 passed / 1 failed) + build (8/8) + typecheck (0) + lint (0) + format (clean). The sole test failure is the known Shiki full-suite flake in an UNTOUCHED package (passes in isolation; Rule 6 ground-truthed) — recorded LOW, not a regression.
- **Rule 13 (thin client):** `git diff HEAD -- packages/core packages/mcp-server packages/ui-shared` EMPTY; no new board op; no agent push; `connect-src 'none'`.
- **Rule 3/12 real-host (LOAD-BEARING):** reviewer INDEPENDENTLY re-ran `test:host` GREEN — `cspStrict:true`, `serializerRegistered:true`, `deserializeReattached:true` in a real Electron host (exit 0).
- **Deferred (2 LOW + 1 forward-risk):** (1) Shiki full-suite flake recurrence (new `startIndex` signature; test-infra, untouched package); (2) non-retained panel re-mounts on focus → discards unsaved in-webview UI state (composer draft) — forward-risk for Stories 10.6/10.7. Full disposition in `deferred-work.md`.
- **Rule 5/6:** N/A (no NFR tripwire worked around; no `docs/adr`).
