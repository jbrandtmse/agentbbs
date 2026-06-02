---
baseline_commit: 4a409a8
---

# Story 10.6: Live updates, high-contrast, and accessibility parity

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator in VS Code,
I want live updates and full theme/a11y support in the room webviews and tree,
so that the editor surface matches the web surface's liveness and accessibility.

## Acceptance Criteria

1. **(AC1 — live updates via the host MAX(seq) poll → postMessage fold)** Given the extension host, when new events are appended (by an agent or the operator), then the host polls `MAX(seq)` on a short interval and pushes the new-event deltas to the open room webview(s) via `postMessage`; the webview client FOLDS them into the live RoomView (new messages append in seq order, reactions/👍 counts update, the computed agreed mark moves), and the native tree decorations refresh — WITHOUT a full reload. The operator's optimistic reply echoes then reconciles when its `seq` lands (mirror the web Story-9.9 model). **The agent-facing pull-only contract is NEVER crossed** (the delta push is host→its-own-webview only; agents keep `check`; NO agent-facing push path is added).

2. **(AC2 — high-contrast theme)** Given a high-contrast theme, when the surface renders, then `ColorThemeKind` high-contrast (HighContrast / HighContrastLight) is respected: the `--vscode-*` token layer leans on `contrastBorder`; agreed-green / flag-warm map to charted/decoration tokens; alpha washes become solid borders; the webview reacts to `onDidChangeActiveColorTheme` (re-themes live when the user switches). Focus is visible via `--vscode-focusBorder`.

3. **(AC3 — accessibility parity with the web floor)** Given the room webview + tree, when navigated by keyboard / a screen reader, then keyboard navigation and screen-reader semantics MATCH the web a11y floor (the Story-9.10 capstone — APG roles, thread `role="list"`/`listitem`, the coalescing polite `aria-live` region, keyboard composer with Esc, AA `:focus-visible` ring ≥3:1, `prefers-reduced-motion`, landmarks), deferring to the editor's keybindings where they overlap (the native tree already gives free keyboard nav + a11y tree roles from Story 10.3). The a11y floor is INHERITED from the shared ui-shared chrome/a11y components (Story 9.10), not reimplemented.

## Integration ACs

This story CONSUMES the Story-10.2/10.4 bridge delta-poll (the `onDelta` hook the 10.4 CR noted as wired-but-unconsumed) and the Story-10.3 tree + Story-10.4 RoomView, and makes them LIVE + theme/a11y-complete. AC1/AC2/AC3 are real-runtime integration ACs: a real appended event (via the data-access handle / a real agent reply) flows host→webview and the RoomView folds it; the high-contrast token mapping + `onDidChangeActiveColorTheme` reaction is verified; the a11y floor is asserted (reusing the 9.10 ui-shared a11y tests in the webview context). Verified in the real VS Code Electron host via `@vscode/test-electron` where feasible (a pushed delta lands + folds; theme-kind detection). Per Rule 1, the producer (the host poll) → consumer (the webview fold + tree refresh) wiring is real and exercised.

## Tasks / Subtasks

- [x] **Task 1 — Live fold in the webview (AC1)**
  - [x] Consume the bridge's `onDelta` frames (the host MAX(seq) poll → `eventsSince(lastSent)` → `postMessage({type:'delta', events, maxSeq})`, built in 10.2/10.4) in the webview: a PURE fold reducer applies each delta to the live `RoomViewModel` (append new `room.replied`/`announcement.posted` messages in seq order for THIS room; update `react`/`unreact` live-reactor sets; recompute the agreed mark — highest-seq live-👍'd, FR21). Mirror the web Story-9.9 fold (`apps/web/src/api-client.ts` fold reducer + `foldTreeDelta`). De-dup by seq (idempotent re-fold). The webview re-renders RoomView from the folded model (no full reload). — `room-fold.ts` (camelCase reducer); consumed in `RoomApp.tsx` via `subscribeToDeltas`, wired in `main.tsx` to the bridge `onDelta`.
  - [x] Optimistic reply echo → reconcile: the operator's reply shows immediately (pending) then reconciles when its real `seq` arrives in a delta (mirror web 9.9 `PENDING_SEQ_BASE`/reconcile). No duplicate on reconcile. — `makePendingPost`/`appendPendingPost`/`reconcileReread`/`markPendingPostFailed` in `room-fold.ts`; `handleSend` in `RoomApp.tsx`.
  - [x] Tree live refresh: the host poll also triggers the Story-10.3 tree `onDidChangeTreeData`/decoration refresh so unread/needs/active transitions show live (proto-room→active when a reply lands). Keep it bounded/cheap (the existing MAX(seq) poll, not a per-event push storm). — the existing 2s host `refreshBoard` poll (extension.ts `DEFAULT_REFRESH_INTERVAL_MS`) already re-reads the tree model + fires `onDidChangeTreeData` + decorations.refresh(); a proto-room→active flip surfaces on the next poll tick. Design decision: NOT switching the tree to the per-webview delta poll (the tree is host-side and reads core directly; a per-event tree push would be a per-event storm the AC explicitly warns against).
  - [x] **PULL-ONLY (NFR5) LOAD-BEARING:** the delta push is host→its-own-webview only. Structurally confirm NO agent-facing push is added (the MCP server / agent path is untouched; agents keep `check`). `git diff HEAD -- packages/core packages/mcp-server` EMPTY. — VERIFIED empty.
- [x] **Task 2 — High-contrast theme support (AC2)**
  - [x] Detect `ColorThemeKind` (`vscode.window.activeColorTheme.kind` — Light/Dark/HighContrast/HighContrastLight) in the host; pass the kind into the webview (data attribute / postMessage) AND react to `vscode.window.onDidChangeActiveColorTheme` (re-theme live). In the `--vscode-*` token layer (`vscode-tokens.css`, Story 10.4), add high-contrast handling: lean on `--vscode-contrastBorder` (solid borders where the web used alpha washes), map agreed-green/flag-warm to charted/decoration tokens (`--vscode-charts-*`/decoration), ensure focus via `--vscode-focusBorder`. The webview applies an HC class/attr that the CSS keys off. — `theme-kind.ts` (numeric kind → token), `webview-html.ts` (`data-theme-kind` initial attr), `room-panel.ts` (`resolveThemeKind` + `postThemeKind`), `extension.ts` (`onDidChangeActiveColorTheme` → `postThemeKind`), `bridge.ts` (`themeKind` frame), `bridge-client.ts` (`onThemeKind`), `main.tsx` (re-apply attr live), `vscode-tokens.css` (`#root[data-theme-kind^="high-contrast"]` overrides).
  - [x] Verify the alpha-wash→solid-border substitution (e.g. the AGREED_POST_WASH from ui-shared) renders correctly under HC (a solid `contrastBorder` instead of a translucent fill). — driven via the ui-shared `highContrast` RoomView prop (the wash → transparent gate is in MessagePost; under HC the solid `--agreed-line` rail carries the meaning). Proven in `RoomApp.live.test.tsx` (HC: no rgba wash; non-HC: rgba wash present — the gate is non-vacuous).
- [x] **Task 3 — Accessibility parity (AC3)**
  - [x] The RoomView a11y floor is INHERITED from the Story-9.10 ui-shared chrome/a11y (APG roles, thread `role=list`/`listitem`, coalescing polite `aria-live`, keyboard composer + Esc, `:focus-visible`, `prefers-reduced-motion`, landmarks) — confirm it renders correctly in the webview context (the webview is a real browser DOM, so the 9.10 a11y applies). Map the focus ring to `--vscode-focusBorder` (≥3:1 — the VS Code theme guarantees it; verify). Defer to the editor's keybindings where they overlap (the native tree from 10.3 already provides tree-role keyboard nav). — INHERITED, not reimplemented: RoomApp mounts the byte-shared RoomView/Composer/ConnectionFooter; ui-shared `chrome.css` `:focus-visible` ring uses `var(--accent)`, which `vscode-tokens.css` promotes to `--vscode-focusBorder` under HC. Rule 13: `git diff HEAD -- packages/ui-shared` EMPTY.
  - [x] A `ConnectionFooter`-equivalent liveness indicator (the ● connected / ○ reconnecting LED, ui-shared `ConnectionFooter`) reflecting the bridge poll health (the host→webview channel) — calm, never a modal (the 9.10 no-modal invariant). Wire it from the bridge connection state. — RoomApp renders the ui-shared `ConnectionFooter`; status driven by `main.tsx` from the bridge's first-frame signal (`onStatus`: `reconnecting` until the first host frame, then `connected`).
- [x] **Task 4 — Tests (Rule 7/8/12) + real-host smoke**
  - [x] happy-dom: the live-fold reducer (delta append/react/agreed-move, de-dup, optimistic reconcile) over a RoomViewModel; mutation-test the agreed-mark-moves + the de-dup non-vacuous (Rule 7). Use `beforeAll(prewarmHighlighter)` (9.5-shiki carry — esp. given the Shiki full-suite flake now seen; consider whether to add the `isHighlighterWarm()` assert the 9.5 item suggested to harden it). — `room-fold.test.ts` (13 tests; MUTATION-TESTED both the de-dup idempotency guard AND the FR21 highest-seq selector → RED → reverted byte-identical) + `RoomApp.live.test.tsx` (DOM live-fold; ADOPTED the 9.5 `isHighlighterWarm()` assert in `beforeAll`).
  - [x] High-contrast: the token layer's HC mapping (a token resolves to `contrastBorder`/charted under HC); `ColorThemeKind` detection + the `onDidChangeActiveColorTheme` re-theme path (host-side, mocked vscode). — `vscode-tokens.qa.test.ts` (HC block content-guard, mutation-aware via the block-isolation slice), `theme-kind.test.ts` (numeric mapping pinned to @types/vscode), `theme-plumbing.qa.test.ts` (resolveThemeKind→HTML + postThemeKind→all panels).
  - [x] a11y: confirm the 9.10 ui-shared a11y tests cover the webview-mounted RoomView (or add a thin webview-context assertion); the focus ring maps to `--vscode-focusBorder`. — the 9.10 ui-shared a11y suite covers the byte-shared components RoomApp mounts (no fork); the focus-ring→`--vscode-focusBorder` mapping is pinned in `vscode-tokens.qa.test.ts`.
  - [x] Real-host `@vscode/test-electron`: a real appended event pushed host→webview lands + folds (the live path); `ColorThemeKind` is read in-host. Document any part only verifiable by a manual lead theme-switch/SR pass (Rule 12 — don't fake it green). — extended `host-tests/room-panel.in-host.ts`: `themeKindRead="dark"`, `htmlHasThemeKind=true`, `themeKindPushed=true` (postThemeKind reached the real webview), `livePollPushedDelta=true` (the bridge MAX(seq) poll pushed a delta on a real appended event over real node:sqlite). MANUAL (lead, Rule 12): the actual HC PAINT after a live theme switch + a screen-reader pass are NOT automatable headlessly — flagged for the lead's manual smoke (the host probe proves the kind is detected + pushed + the data-attr flows; the visual HC paint is the manual step).
- [x] **Task 5 — Record decisions** (the fold reducer parity with web 9.9; the HC token mappings; what a11y is inherited vs added; what's real-host-verified vs manual). — see Completion Notes.

## Dev Notes

### Live fold parity (AC1) — mirror web 9.9, don't reinvent
[Source: apps/web/src/api-client.ts — the SSE fold reducer + `foldTreeDelta` (Story 9.9)] The web folds SSE deltas into live state (append by seq, reaction update, agreed-mark recompute, optimistic echo→reconcile via `PENDING_SEQ_BASE`). The bridge ALREADY has the delta poll + `DeltaFrame {type:'delta', events, maxSeq}` (Story 10.2/10.4) and an `onDelta` hook the 10.4 CR flagged as wired-but-UNCONSUMED — THIS story consumes it. Reuse the web fold semantics (the reducer is essentially the same; the transport is postMessage not EventSource). [Source: deferred-work 10.4 review — "onDelta wired but unconsumed → live fold in 10.6".]

### Pull-only (NFR5) is LOAD-BEARING
[Source: epics.md Story 10.6 AC1; architecture.md l.234, l.286, l.392; project-rules.md Rule 13] The delta push is host→its-OWN-webview (the operator's live view), NOT an agent push. Agents stay pull-only via `check`. Add NO agent-facing push. The 6.2 no-push tests + the architecture's "host→client only (SSE/postMessage)" are the contract. Structurally confirm (grep) no push into any agent/MCP path; `git diff HEAD -- packages/core packages/mcp-server` EMPTY.

### High-contrast (AC2)
[Source: epics.md Story 10.6 AC2] `ColorThemeKind` high-contrast respected: `contrastBorder` for borders; agreed-green/flag-warm → charted/decoration tokens; alpha washes → solid borders; `--vscode-focusBorder` for focus. The `vscode-tokens.css` layer (Story 10.4) is where the HC overrides live (keyed off an HC class/attr the host sets from `window.activeColorTheme.kind`, updated on `onDidChangeActiveColorTheme`). Verify the `--vscode-*` HC token names against the VS Code theme-color reference (Rule 3). The web `tokens.css` AGREED_POST_WASH/alpha tints are what become solid `contrastBorder` under HC.

### A11y inherited from 9.10 (AC3)
[Source: packages/ui-shared/src/chrome/* + room/* (Story 9.10 a11y capstone); ConnectionFooter] The webview mounts the SAME ui-shared components that carry the 9.10 a11y floor (APG tree/list roles, roving tabindex, coalescing polite `aria-live`, keyboard composer + Esc, `:focus-visible` AA ring, `prefers-reduced-motion`, landmarks, no-modal-anywhere). Because the webview is a real browser DOM, that a11y applies as-is — confirm it renders, map the focus ring to `--vscode-focusBorder`, and defer to editor keybindings where they overlap (the native tree from 10.3 already has tree-role keyboard nav). Do NOT reimplement a11y — inherit it (Rule 13). The `ConnectionFooter` LED reflects the bridge poll health (calm, no modal — the 9.10 invariant).

### Carries (Story 10.0)
- **9.13-trim (awareness):** the bridge's `updateFocus`/`reply` trim discipline — `reply` already trimmed in 10.2; `updateFocus` is Story 10.7's (the focus compose surface). The live fold doesn't add a new write, so no new trim site here.
- **9.5-shiki-warmup:** now MATERIAL — a Shiki full-suite flake (`ui-shared/highlight.test.ts`) surfaced under the larger Epic-10 suite (recorded; passes in isolation; untouched). Any markdown-rendering DOM test here MUST use `beforeAll(prewarmHighlighter)`; CONSIDER adding the `expect(isHighlighterWarm()).toBe(true)` hardening the 9.5 item suggested, and flag whether the full-suite flake should be fixed at the epic retro (it intermittently reds the gate).

### Module boundary / Rule 13
The live fold, HC mapping, and a11y are all CLIENT-layer; `git diff HEAD -- packages/core packages/mcp-server` EMPTY; ui-shared reused (a11y/components) — if a genuinely-missing a11y prop is needed, that's a ui-shared change (surface it), not a fork. No new board op; no agent push.

### Testing standards / baseline
[Source: project-rules.md Rules 7, 8, 12] Canonical gate = ROOT `pnpm test` + the FULL aggregate gate (build/typecheck/lint/format — the lead runs the whole aggregate at smoke; the 10.3 review missed drift by running only vitest). Mutation-test the agreed-mark-moves + de-dup fold semantics. Real-host evidence via `@vscode/test-electron`. Baseline entering 10.6: 1398 tests (KNOWN flakes: the Windows teardown EPERM in `seed-protocol-race.test.ts` AND the intermittent Shiki full-suite flake in `ui-shared/highlight.test.ts` — both NOT yours, both pass in isolation; Rule 6 — re-run isolated/full to confirm before reading a red as a regression).

### Project Structure Notes
- New/changed: the webview fold consumer (`webview/main.tsx`/`RoomApp.tsx` + a fold reducer module), the HC handling in `vscode-tokens.css` + the host theme-kind plumbing, the ConnectionFooter wiring, tests.
- Keep `git diff HEAD -- packages/core packages/mcp-server` EMPTY.

### References
- [Source: epics.md#Epic 10 / Story 10.6; architecture.md l.234, l.286, l.392]
- [Source: apps/web/src/api-client.ts (9.9 fold reducer / foldTreeDelta — parity); packages/ui-shared/src/chrome/* + room/* (9.10 a11y, ConnectionFooter)]
- [Source: apps/vscode-extension/src/{bridge.ts (DeltaFrame + onDelta), webview/{main.tsx,RoomApp.tsx,vscode-tokens.css}, room-panel.ts, tree/*} (10.2–10.5 foundation)]
- [Source: .claude/rules/project-rules.md Rules 1, 3, 7, 8, 12, 13; 10-0-epic-9-deferred-cleanup.md (9.5-shiki + 9.13-trim carries); deferred-work.md (10.4 onDelta→10.6; 10.5 Shiki flake)]

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Rule 3 verification: `ColorThemeKind { Light=1, Dark=2, HighContrast=3, HighContrastLight=4 }`, `window.activeColorTheme: ColorTheme { readonly kind }`, `window.onDidChangeActiveColorTheme: Event<ColorTheme>` — confirmed against the INSTALLED `@types/vscode@1.120.0` (`node_modules/.pnpm/@types+vscode@1.120.0/.../index.d.ts:8678,11843,11848`). Perplexity (Research-First) confirmed VS Code injects `--vscode-*` webview CSS vars APPEND-ONLY (never removed on theme switch) → MUST NOT detect HC by `--vscode-contrastBorder` presence; the authoritative HC switch is the host-pushed `ColorThemeKind`.
- Rule 7 mutation-tests (both reverted byte-identical, re-GREEN): (1) defeated the `room-fold.ts` de-dup idempotency guard (`false &&`) → the "no double-append" test RED; (2) flipped the FR21 selector `m.seq > agreed` → `m.seq < agreed` → the agreed-mark-MOVES + deriveAgreedSeq tests RED.
- Rule 6: stashed all changes + rebuilt host-tests to confirm a host-smoke `serializerRegistered:false` ("already registered") was NOT pre-existing — it was introduced by my added live-poll `setTimeout` waits widening the activate()-lazy-serializer-registration race window. Fixed by (a) relocating the live-poll block AFTER the serializer assertions + (b) tolerating the "already registered" throw (activate() legitimately owns the serializer in an activated dev host). Re-run: all probes exit 0.

### Completion Notes List

- **Fold reducer (AC1) — parity with web 9.9 but CAMELCASE, not a verbatim reuse.** The VS Code host bridge pushes RAW CORE `Event` objects (camelCase: `payload.roomId`/`payload.messageSeq`/`payload.body`, top-level `actor`/`seq`/`type`/`createdAt`) because `eventsSince` returns `rowToEvent` output directly — there is NO snake_case wire stage (unlike the web SSE host whose `EventWire` is snake_case). So `room-fold.ts` is a PARALLEL reducer with the SAME semantics as web `foldRoomDelta`/`deriveAgreedSeq`/optimistic helpers, keyed on camelCase. Append-by-seq, idempotent-by-seq de-dup, optimistic-echo reconcile (same actor+body REPLACE), reactions→re-derive agreed (FR21 highest-seq live-👍'd). Pure + immutable; no core/data-access import (NFR2).
- **Optimistic reply reconcile.** `handleSend` echoes a pending post (`makePendingPost`, synthetic seq ≥ `PENDING_SEQ_BASE`), POSTs `reply`, then on success re-reads + `reconcileReread` (drops THIS echo, keeps other in-flight echoes — no duplicate; the proto-room ACTIVATES via the same Epic-4 min-seq `reply`); on failure flips the echo to failed (body preserved). A folded `room.replied` delta for the same actor+body also reconciles (idempotent with the re-read).
- **HC token mappings (AC2).** `vscode-tokens.css` adds `#root[data-theme-kind^="high-contrast"]` overrides (custom-property cascade overrides `:root` for the whole app — no component/tokens.css fork): borders + `--agreed-line` → `--vscode-contrastBorder` (solid edges); `--agreed-green`/`--flag-warm` → `--vscode-charts-green`/`--vscode-charts-yellow` (AA); `--accent`/`--accent-hover`/`--accent-on-dark` → `--vscode-focusBorder` (the inherited 9.10 `:focus-visible` ring is `outline: var(--accent)`, so promoting accent to focusBorder under HC makes the keyboard ring the HC focus color the AC requires). The agreed WASH (a JS constant `AGREED_POST_WASH`) is gated OFF via the ui-shared `highContrast` RoomView prop the webview now passes under HC. Detection: host reads `window.activeColorTheme.kind` → `webviewThemeKind` token → initial `data-theme-kind` attr (HTML) + a live `themeKind` postMessage frame on `onDidChangeActiveColorTheme`.
- **A11y INHERITED, not added (AC3, Rule 13).** RoomApp mounts the byte-shared ui-shared RoomView/Composer/ConnectionFooter — the 9.10 a11y floor (APG roles, list/listitem thread, polite aria-live, keyboard composer + Esc, `:focus-visible` AA ring, prefers-reduced-motion, landmarks, no-modal) applies as-is in the webview's real browser DOM. `git diff HEAD -- packages/ui-shared` EMPTY. ConnectionFooter wired from the bridge first-frame `onStatus` signal (calm LED, never a modal).
- **Real-host-verified vs manual (Rule 12).** REAL-HOST (`@vscode/test-electron`, all exit 0): ColorThemeKind read in-host (`themeKindRead="dark"`), it flows into the panel HTML (`htmlHasThemeKind`), `postThemeKind` reaches a real webview (`themeKindPushed`), the bridge MAX(seq) poll PUSHES a delta on a real appended event over real node:sqlite (`livePollPushedDelta`). MANUAL (lead): the actual HC PAINT after a live theme switch + a screen-reader pass — not automatable headlessly; the host probe proves detection + push + attr-flow, the visual/SR confirmation is the lead's smoke.
- **Pull-only (NFR5) + Rule 13 — byte-identical contract.** The delta is host→its-own-webview only; no agent/MCP push path added. `git diff HEAD -- packages/core packages/mcp-server` EMPTY; `git diff HEAD -- packages/ui-shared` EMPTY. The `themeKind` frame is a new HOST↔WEBVIEW message type (client layer), NOT an agent-contract change.
- **Tree live refresh (AC1).** Kept on the existing 2s host `refreshBoard` poll (re-reads the model + fires `onDidChangeTreeData` + decorations) rather than wiring the per-webview delta poll into the tree — the tree is host-side and reads core directly; a per-event tree push would be the per-event storm the AC warns against. A proto-room→active flip surfaces on the next poll tick.
- **Gate (canonical, Rule 12 full aggregate):** ROOT `pnpm test` (vitest) 1429 passed / 168 files / 0 failed (baseline 1398 + 31 new); `tsc --noEmit` 0; `eslint .` 0; `prettier --check .` clean; `pnpm run build` clean (webview bundle built); real-host `test:host` all probes exit 0. No baseline-flake recurrence (the seed-protocol-race EPERM + Shiki full-suite flakes did not surface this run).

### File List

Production (changed):
- apps/vscode-extension/src/bridge.ts (added the `BridgeThemeKind` host→webview frame type)
- apps/vscode-extension/src/extension.ts (resolveThemeKind + onDidChangeActiveColorTheme → postThemeKind)
- apps/vscode-extension/src/room-panel.ts (resolveThemeKind option + themeKind into HTML + postThemeKind method)
- apps/vscode-extension/src/webview/webview-html.ts (data-theme-kind initial attribute)
- apps/vscode-extension/src/webview/bridge-client.ts (createPostMessageBridge hooks: onDelta/onThemeKind/onStatus)
- apps/vscode-extension/src/webview/RoomApp.tsx (live fold consume + optimistic reconcile + ConnectionFooter + highContrast prop)
- apps/vscode-extension/src/webview/main.tsx (wire onDelta→fold, onThemeKind→data-attr, onStatus→footer; live highContrast)
- apps/vscode-extension/src/webview/vscode-tokens.css (high-contrast overrides under #root[data-theme-kind^="high-contrast"])

Production (new):
- apps/vscode-extension/src/webview/room-fold.ts (the camelCase live-fold reducer + optimistic-echo helpers)
- apps/vscode-extension/src/webview/theme-kind.ts (numeric ColorThemeKind → webview theme-kind token)

Tests (new):
- apps/vscode-extension/src/webview/room-fold.test.ts (fold reducer; Rule-7 mutation-tested marquee semantics)
- apps/vscode-extension/src/webview/RoomApp.live.test.tsx (DOM live-fold + optimistic reconcile + footer + HC gate)
- apps/vscode-extension/src/webview/theme-kind.test.ts (numeric mapping pinned to @types/vscode)
- apps/vscode-extension/src/theme-plumbing.qa.test.ts (host resolveThemeKind→HTML + postThemeKind→panels)

Tests (changed):
- apps/vscode-extension/src/webview/vscode-tokens.qa.test.ts (added the HC override block content-guard)
- apps/vscode-extension/src/abi-proof.test.ts (vscode mock: added activeColorTheme + onDidChangeActiveColorTheme)
- apps/vscode-extension/src/bundle-and-activation.test.ts (vscode mock: added activeColorTheme + onDidChangeActiveColorTheme)

Host-test harness (changed):
- apps/vscode-extension/host-tests/room-panel.in-host.ts (10.6 real-host evidence: themeKind read/flow/push + live-poll delta)
- apps/vscode-extension/host-tests/run-host-tests.cjs (assert the new 10.6 probe fields)
