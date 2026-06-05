---
baseline_commit: 6e70e33
---

# Story 10.7: Operator initiate-parity — compose surfaces wired through the bridge

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Added 2026-06-02 by /epic-cycle (Rule-15 both-directions scoping decision, user-ratified): the Epic-10 success criteria require operator INITIATE-parity, but 10.1–10.6 are room/respond-centric. This dedicated story wires the initiate half, mirroring Epic 9's dedicated 9.11–9.13. -->

## Story

As an operator in VS Code,
I want to create a project, post an announcement, join a project, and set my focus from the editor surface,
so that VS Code reaches FULL operator↔agent initiate-parity — not just the respond/browse half (Rule 15).

## Acceptance Criteria

1. **(AC1 — the 4 INITIATE bridge writes)** Given the Story-10.2 postMessage bridge, when the operator invokes an initiate action, then the bridge mirrors the FOUR initiate ops to the EXISTING core write ops — `announceProject` / `postAnnouncement` / `joinBoard` / `updateFocus` — each routed through the data-access handle (same OPS-table pattern as `reply`/`react`). NO fabricated board op, NO client backdoor; `git diff HEAD -- packages/core packages/mcp-server` byte-identical (Rule 13). The operator posts/creates via the SAME core ops an agent uses (grant-on-act preserved). `updateFocus` applies the 9.13-trim discipline (whitespace-only rejected/trimmed host-side). The watching-only/unregistered gates are host-surface (`NO_OPERATOR` when no operator handle — reached BEFORE core, no actor; `OPERATOR_NOT_REGISTERED` for an unregistered handle), NOT in core's closed `BOARD_ERROR_CODES` (mirror the web host's `requireOperator`).

2. **(AC2 — the 4 compose surfaces mount the shared ui-shared components, themed)** Given the VS Code surface, when the operator opens an initiate affordance, then it mounts the SAME `@agentbbs/ui-shared` compose component (themed `--vscode-*`, byte-shared — NOT forked): `CreateProjectCompose` (create a project), `PostAnnouncementCompose` (post an announcement into a project the operator belongs to), `JoinProjectPicker` (the tree's `＋ join a project…` row from Story 10.3 — fetch the global-read directory, filter to joinable, choose → `joinBoard` → tree refresh), `FocusAffordance` (set the operator's focus). Each runs its write through the AC1 bridge op, shows calm inline pending/error state (NEVER a modal — the 9.10 invariant), and refreshes the affected surface live.

3. **(AC3 — initiate→respond loop closed + watching-only gates + native panel-exclusivity)** Given the operator posts an announcement, when it succeeds, then it IMMEDIATELY appears as a NAVIGABLE proto-room in the tree (the Story-10.3/10.4 respond half — the operator can then open + reply-to-activate it), closing the initiate→respond loop in one surface (Rule 15 both directions). Given a watching-only (no `--as`/`AGENTBBS_OPERATOR` handle) or unregistered operator, the initiate affordances are gated (disabled or the calm host-surface `NO_OPERATOR`/`OPERATOR_NOT_REGISTERED` line), exactly as the web surface gates them. **Panel-exclusivity uses VS Code-native handling** (the web single-open-initiate-panel model does NOT carry): the initiate compose surfaces are managed with their OWN VS Code exclusivity (a single reused compose panel, or one-initiate-panel-at-a-time), distinct from the rooms-as-tabs model (where multiple room panels coexist).

## Integration ACs

This story CONSUMES the Story-10.2 bridge (adding the 4 initiate write ops), the Story-10.3 tree (the `＋ join a project…` seam + the navigable-proto-room respond half), and the Story-10.4 WebviewPanel-mounts-ui-shared + `--vscode-*` theme pattern. AC1/AC2/AC3 are real-runtime integration ACs verified in the real VS Code Electron host (`@vscode/test-electron`): each of the 4 bridge writes lands (assert out-of-band via the data-access handle — a created project / posted announcement / joined board / set focus is present in the ledger); a posted announcement appears as a navigable proto-room; the watching-only gate yields the host-surface code. Per Rule 1, the producer→consumer wiring (compose surface → bridge write → core op → observable ledger effect → tree/respond surface) is real and exercised. This is the LAST Epic-10 feature story; the end-of-epic Rule-14 integrated exploratory smoke runs AFTER it.

## Tasks / Subtasks

- [x] **Task 1 — The 4 initiate bridge write ops (AC1)**
  - [x] Extend the `apps/vscode-extension/src/bridge.ts` OPS table with `announceProject`, `postAnnouncement`, `joinBoard`, `updateFocus`, each mapping to the EXISTING core op via the data-access handle (mirror the `reply`/`react` write pattern from 10.2/10.4). The operator handle is the actor (the host-surface display field). Apply the operator gate: if no operator handle → host-surface `NO_OPERATOR` (BEFORE core, no actor — mirror `requireOperator` in `packages/cli/src/host/json-api.ts`); an unregistered handle → `OPERATOR_NOT_REGISTERED` where the web host does. These are HOST-surface codes (NOT core's closed `BOARD_ERROR_CODES` — Rule 13; mirror the 9.13 `OPERATOR_NOT_REGISTERED` host-surface precedent). `updateFocus`: trim host-side (9.13-trim carry — reject/trim whitespace-only).
  - [x] Verify against core (Rule 4 — internal-symbol verification): `announceProject`/`postAnnouncement`/`joinBoard`/`updateFocus` signatures (actor + args) in the core barrel; the web host's wiring is the reference.
- [x] **Task 2 — Mount the 4 compose surfaces (AC2)**
  - [x] Build a compose-webview host (`apps/vscode-extension/src/compose-panel.ts` + `webview/ComposeApp.tsx` + `webview/compose-main.tsx`) that mounts the ui-shared compose components (`CreateProjectCompose`/`PostAnnouncementCompose`/`JoinProjectPicker`/`FocusAffordance`) — byte-shared, themed `--vscode-*` (reuse the Story-10.4 vscode-tokens.css + the strict CSP shell from 10.5). Each component's `onSubmit`/`onChoose` calls the AC1 bridge write; pending/error props drive the calm inline state.
  - [x] Entry points: `JoinProjectPicker` ← the Story-10.3 tree `＋ join a project…` row (filled the seam: fetch `listProjects`/`boardDirectory` via the bridge, filter to joinable = directory MINUS the operator's memberships by canonical handle, open the picker; choose → `joinBoard` → tree refresh). `CreateProjectCompose` ← `agentbbs.createProject` (view/title `＋` action). `PostAnnouncementCompose` ← `agentbbs.postAnnouncement` (the `announcements (N)` indicator inline action, project-scoped; offers join-first on `NOT_A_MEMBER` mirroring the web's `announceJoinFirst`). `FocusAffordance` ← `agentbbs.setFocus` (view/title action).
  - [x] Verify the compose components' actual props before wiring (Rule 4): confirmed `CreateProjectComposeProps`, `PostAnnouncementComposeProps`, `JoinProjectPickerProps`, `FocusAffordanceProps`. DELTA found vs the story's Dev Notes shorthand (surfaced loudly): the Esc prop is `onEscape` (NOT `onEsc`); `FocusAffordance` uses `disabled` + `disabledReason` (NOT a single `disabled`); `JoinProjectPicker` rows are `JoinableProject{projectId,title}`.
- [x] **Task 3 — Initiate→respond loop + watching-only gates + native panel-exclusivity (AC3)**
  - [x] After a successful `postAnnouncement`, the new proto-room appears as a NAVIGABLE tree row (the `composeSuccess` frame fires the host `refreshBoard` → re-reads the tree model → the proto-room is a navigable pending row) → the operator can open + reply-to-activate it (the 10.3/10.4 respond half). Proved end-to-end in the real host (Rule 15 both directions in one surface).
  - [x] Watching-only/unregistered: gated consistently across all four. `FocusAffordance` renders DISABLED inert with a calm reason (watching-only OR unregistered, via the `whoami` host-read); `CreateProjectCompose`/`PostAnnouncementCompose`/`JoinProjectPicker` show the calm host-surface `NO_OPERATOR` line at submit. (The Epic-9 9.14 lesson — no one clickable-then-fails while another disables.)
  - [x] Panel-exclusivity: VS Code-native — a SINGLE reused compose `WebviewPanel` (`ComposePanelManager`): opening any initiate surface REVEALS + SWAPS the one panel to that kind, so only one initiate surface is open at a time. Distinct from rooms-as-tabs (multiple room panels coexist). The web single-open-initiate-panel DOM model is NOT ported. Documented in the Dev Agent Record.
- [x] **Task 4 — Tests (Rule 7/8/12) + real-host smoke**
  - [x] Bridge-op tests (root-`pnpm test`): each of the 4 writes maps to the right core op + lands in the ledger; the operator gate (no handle → NO_OPERATOR before core; unregistered → OPERATOR_NOT_REGISTERED); updateFocus trim. MUTATION-TESTED the gate-order (NO_OPERATOR before core) + the focus trim non-vacuous (Rule 7) — both RED under the mutant, reverted byte-identical.
  - [x] happy-dom (`ComposeApp.test.tsx`): the 4 surfaces mount the ui-shared components + call the right bridge op on submit (fake bridge + real component); the join-first handoff; the watching-only/unregistered gate consistent across all 4; no-modal. (No markdown render → prewarmHighlighter not needed.)
  - [x] Real-host `@vscode/test-electron` (`compose-panel.in-host.ts`): each of the 4 bridge writes LANDS out-of-band; the posted announcement appears as a NAVIGABLE proto-room (tree model row, not just a count) + reply-activates; the watching-only gate yields `NO_OPERATOR`; native single-panel-reuse holds. MUTATION-TESTED the initiate→respond navigable loop non-vacuous in the REAL host (broke `postAnnouncement` to not reach core → `protoRoomNavigable`/`protoRoomActivatesByReply` went RED), reverted byte-identical.
- [x] **Task 5 — Record decisions** (see Dev Agent Record below).

## Dev Notes

### Why this story exists (Rule 15 both-directions)
[Source: 10-0-epic-9-deferred-cleanup.md; epics.md Story 10.7; the user-ratified AskUserQuestion 2026-06-02] The Epic-10 success criteria require operator INITIATE-parity, but Stories 10.1–10.6 are room/respond-centric. Epic 9 shipped the respond half and the initiate half FELT BROKEN/MISSING until the 9.11–9.14 addendum — exactly the asymmetry Rule 15 was codified to catch. This dedicated story wires the initiate half so VS Code reaches the SAME operator↔agent parity as the web. The compose components + core write ops ALREADY exist; the work is mounting them in VS Code + wiring the bridge writes (named-deferred to consumers in Story 10.2).

### The 4 writes — mirror the web host (Rule 4 verify against core + the web wiring)
[Source: packages/cli/src/host/json-api.ts — the web write endpoints + `requireOperator`] The web wires `announceProject`/`postAnnouncement`/`joinBoard`/`updateFocus` over the same core ops, gated by `operatorHandle` (null → host-surface `NO_OPERATOR` BEFORE core, since there is no actor; unregistered → `OPERATOR_NOT_REGISTERED`). The bridge mirrors this exactly — the operator handle (from the `agentbbs.operatorHandle` setting / `AGENTBBS_OPERATOR` env, canonicalized, established in Story 10.3) is the actor. The host-surface codes are NOT in core's closed ten (Rule 13 — the 9.13 `OPERATOR_NOT_REGISTERED` + the 9.6 `NO_OPERATOR` precedents). `updateFocus` trims (9.13-trim carry).

### The 4 compose components (Rule 4 verify props before wiring)
[Source: packages/ui-shared/src/compose/*.tsx] All prop-driven, byte-shared with the web:
- `FocusAffordance` — `{ focus?, onSubmit(trimmed), onCancel?, error?, pending?, disabled?, onEsc? }`; `onSubmit` fires only on a non-empty TRIMMED edit, never when disabled.
- `JoinProjectPicker` — `{ joinable: JoinableProject[], onChoose(projectId), onCancel?, error?, pending?, onEsc? }`; the surface computes `joinable` = directory MINUS the operator's memberships (canonical-handle compare); empty → calm "no projects to join" (NOT an error).
- `CreateProjectCompose` / `PostAnnouncementCompose` — verify the exact prop shapes (`onSubmit`, error/pending, the project-id scope for post). The web `apps/web/src/App.tsx` wiring (`announceComposeOpen`/`announceProjectId`/`announceError`/`announcePending`/`announceJoinFirst`) is the behavioral reference (esp. the join-first CTA when `post_announcement` hits `NOT_A_MEMBER`).

### Theme + CSP + a11y (reuse 10.4/10.5/10.6)
The compose webviews reuse the Story-10.4 `--vscode-*` theme layer + the Story-10.5 strict nonce CSP shell + the 9.10 a11y (the compose components carry their own a11y — keyboard, Esc, no-modal, calm inline error). Mount them the SAME way RoomView is mounted (a webview bundle; can share the webview build). High-contrast (10.6) applies via the same token layer.

### Panel-exclusivity (the Epic-9 retro carry)
[Source: 10-0-epic-9-deferred-cleanup.md; epic-9-addendum-retro Action 3] The web's single-open-initiate-panel exclusivity is DOM-specific and does NOT carry to VS Code. VS Code needs its OWN: the cleanest is a SINGLE reused compose `WebviewPanel` (reveal + swap content per initiate action), so only one initiate surface is open at a time — distinct from rooms-as-tabs (10.4, where multiple room panels coexist). Document the chosen model.

### Module boundary / Rule 13 (LOAD-BEARING)
The 4 writes map to EXISTING core ops; NO new board op, NO fabricated op, NO client backdoor. `git diff HEAD -- packages/core packages/mcp-server packages/ui-shared` EMPTY (the compose components are mounted, not forked; if a genuinely-missing prop, surface it as a ui-shared change). Host-surface gate codes only. The operator acts via the SAME ops an agent uses (grant-on-act). NO agent-facing push.

### Testing standards / baseline
[Source: project-rules.md Rules 4, 7, 8, 12, 13, 15] Canonical gate = ROOT `pnpm test` + the FULL aggregate gate (build/typecheck/lint/format — the lead runs the whole aggregate at smoke). Mutation-test the operator-gate-order + the initiate→respond navigable-proto-room loop (Rule 15) non-vacuous. Real-host evidence via `@vscode/test-electron`. Baseline entering 10.7: 1434 tests (KNOWN flakes: the Windows teardown EPERM in `seed-protocol-race.test.ts` + the intermittent Shiki full-suite flake in `ui-shared/highlight.test.ts` — both NOT yours, pass in isolation; Rule 6).

### Project Structure Notes
- New: the 4 bridge write ops in `bridge.ts`; a compose-webview host (`compose-panel.ts` + `webview/ComposeApp.tsx` or per-surface) reusing the 10.4/10.5 webview infra; the tree `＋ join a project…` wiring (fill the 10.3 seam) + create/post/focus command contributions in `package.json`; tests (bridge-op + happy-dom + real-host).
- Keep `git diff HEAD -- packages/core packages/mcp-server packages/ui-shared` EMPTY.
- After this story, VS Code has FULL operator↔agent parity (initiate + respond); the Rule-14 integrated smoke runs next.

### References
- [Source: epics.md#Epic 10 / Story 10.7; epic-9-addendum-retro-2026-06-02.md (parity lessons, Action 3 panel-exclusivity)]
- [Source: packages/ui-shared/src/compose/*.tsx (the 4 components); packages/cli/src/host/json-api.ts (the web write endpoints + requireOperator gate); apps/web/src/App.tsx (the compose wiring + join-first reference); packages/core barrel (announceProject/postAnnouncement/joinBoard/updateFocus)]
- [Source: apps/vscode-extension/src/{bridge.ts, tree/*, room-panel.ts, webview/*} (10.2–10.6 foundation)]
- [Source: .claude/rules/project-rules.md Rules 1, 3, 4, 7, 8, 12, 13, 15; 10-0-epic-9-deferred-cleanup.md (9.13-trim + panel-exclusivity carries)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — bmad-dev-story under /epic-cycle.

### Debug Log References

- Full aggregate gate GREEN: `pnpm run build` clean (3 vscode bundles incl. new `dist/webview/compose.js`+`compose.css`), `pnpm run typecheck` 0, `pnpm run lint` 0, `pnpm run format` clean, ROOT `pnpm test` **1459/1459** (baseline 1434; +25 net new: 16 bridge-op + 6 compose-panel host + ... covered by 3 new files). No known flakes triggered (seed-protocol-race EPERM + Shiki both passed in the full run).
- Real-host `@vscode/test-electron` (`pnpm --filter @agentbbs/vscode-extension test:host`): ALL probes GREEN on electron 42.2.0 / node 24.15.0 — incl. the new compose probe (4 writes land, navigable proto-room + reply-activates, native single-panel-reuse, watching-only NO_OPERATOR gate).
- Mutation tests (Rule 7), all RED under the mutant then reverted byte-identical: (a) `requireOperator` fall-through → the NO_OPERATOR gate-order tests RED; (b) drop the `updateFocus` trim guard → the whitespace-focus test RED; (c) break `postAnnouncement` to return a fake room without core → the in-host `protoRoomNavigable`/`protoRoomActivatesByReply` RED.

### Completion Notes List

**The 4 INITIATE bridge-op wirings + operator gate (AC1, Rule 13).** Added `announceProject`/`postAnnouncement`/`joinBoard`/`updateFocus` to the `bridge.ts` OPS table, each mapping to the EXISTING core op (verified signatures, Rule 4: `announceProject(da,actor,{title,description})`, `postAnnouncement(da,actor,{projectId,subject,body})`, `joinBoard(da,actor,projectId)` — bare string, `updateFocus(da,handle,focus)` — bare string). The operator handle rides in as `args.actor`; a host-surface `requireOperator(args)` raises `NO_OPERATOR` BEFORE core when watching-only (mirrors the web `requireOperator`). `updateFocus` trims host-side + a `requireRegisteredOperator` backstop raises host-surface `OPERATOR_NOT_REGISTERED` (the web `/api/me/focus` precedent). Also added a host-surface `whoami` READ op (the `/api/me` analogue — folds `findIdentity` for the operator's focus/registered, drives the FocusAffordance gate). Both gate codes are host-surface (NOT in core's closed `BOARD_ERROR_CODES`). Rule-13 contract drift: `git diff HEAD -- packages/core packages/mcp-server packages/ui-shared` is EMPTY.

**Compose entry points (AC2).** New webview entry `compose-main.tsx` → `dist/webview/compose.js`+`compose.css` (a 3rd esbuild bundle, same browser/ESM/React-bundled shape as the room bundle, same ui-shared CSS + `--vscode-*` layer). `ComposeApp.tsx` (DOM-testable, like RoomApp) mounts ONE of the 4 BYTE-SHARED ui-shared compose components by `kind`, wiring each write through the bridge + owning pending/error/join-first/joinable-filter/gate. Commands: `agentbbs.createProject` (view/title `＋`), `agentbbs.setFocus` (view/title), `agentbbs.postAnnouncement` (the `announcements (N)` indicator inline action — project-scoped via the passed tree node), and the existing `agentbbs.joinProject` (the `＋ join a project…` seam, now filled). The compose components are MOUNTED not forked (ui-shared byte-identical).

**Native panel-exclusivity model (AC3) — DOCUMENTED CHOICE.** `ComposePanelManager` holds a SINGLE reused `WebviewPanel`: `open(kind, projectId?)` creates it once, then any subsequent open REVEALS + SWAPS its HTML/bridge to the requested surface in place — at most one initiate surface open at a time. This is the VS Code-native equivalent of the web's single-open-initiate-panel DOM exclusivity (which is NOT ported). Distinct from the rooms-as-tabs `RoomPanelManager` (multiple room panels coexist). `composeSuccess` frame → host `refreshBoard` (the initiate→respond loop); `composeClose` frame → panel dispose.

**The initiate→respond loop (AC3, Rule 15 both directions).** A posted announcement → `composeSuccess` → `refreshBoard` re-reads the tree model → the proto-room is a NAVIGABLE pending row (proven in the real host that it is a selectable row, NOT just a count) the operator can open + reply-to-activate via the EXISTING core `reply` (also proven in-host: active:false → true). Both halves of parity are covered (Rule 15).

**Real-host-verified vs manual.** Real-host-verified (Rule 12): the 4 writes land out-of-band, the navigable proto-room + reply-activation, the native single-panel-reuse, the nonce-CSP compose shell, the watching-only gate. The webview's actual PAINT (the compose form rendering + a real button click round-trip in the live webview iframe) is the lead's chrome-devtools/manual smoke (the in-host probe drives the host-side panel + bridge path, which is the data-bearing half; the DOM render is covered by the happy-dom tier).

**Rule-4 prop deltas surfaced.** The story's Dev Notes shorthand (`onEsc`, a single `disabled`) differs from the real ui-shared props: the Esc prop is `onEscape`; `FocusAffordance` takes `disabled` + `disabledReason`; `JoinProjectPicker` rows are `JoinableProject{projectId,title}`. Coded to the verified `.tsx` props, not the shorthand.

### File List

- apps/vscode-extension/src/bridge.ts (M — the 4 INITIATE write ops + `requireOperator`/`requireRegisteredOperator` gate + the `whoami` host-read; header scope note)
- apps/vscode-extension/src/bridge.test.ts (M — INITIATE-writes describe block: per-op land + gate-order + trim, mutation-test targets)
- apps/vscode-extension/src/compose-panel.ts (A — ComposePanelManager: native single-panel exclusivity + per-panel bridge + success/close frames)
- apps/vscode-extension/src/compose-panel.test.ts (A — host-side: panel-exclusivity, success/close, per-panel bridge write lands, compose-HTML CSP guard)
- apps/vscode-extension/src/webview/ComposeApp.tsx (A — mounts the 4 byte-shared ui-shared compose components, wired to the bridge)
- apps/vscode-extension/src/webview/ComposeApp.test.tsx (A — happy-dom: the 4 surfaces mount + call the right op + the consistent gate + join-first + no-modal)
- apps/vscode-extension/src/webview/compose-main.tsx (A — the compose webview entry point → dist/webview/compose.js)
- apps/vscode-extension/src/webview/webview-html.ts (M — `buildComposeWebviewHtml` strict-CSP shell + `ComposeWebviewHtmlOptions`)
- apps/vscode-extension/src/room-panel.ts (M — `PanelLike.dispose?()` added for the compose close path)
- apps/vscode-extension/src/extension.ts (M — wire ComposePanelManager + the create/post/focus/join commands + live theme push + deactivate disposal)
- apps/vscode-extension/src/tree/BoardTreeProvider.ts (M — CREATE_PROJECT/POST_ANNOUNCEMENT/SET_FOCUS command-id constants)
- apps/vscode-extension/package.json (M — the 3 new command contributions + view/title + view/item/context menus)
- apps/vscode-extension/esbuild.js (M — the 3rd compose webview bundle)
- apps/vscode-extension/host-tests/compose-panel.in-host.ts (A — real-host probe: 4 writes land + navigable proto-room loop + gate)
- apps/vscode-extension/host-tests/build-host-tests.cjs (M — register the compose probe entry)
- apps/vscode-extension/host-tests/run-host-tests.cjs (M — run+assert the compose probe)
- eslint.config.js (M — ignore `compose-main.tsx` for the .tsx pascal-case rule, same as `main.tsx`)

## Change Log

- 2026-06-02 — Story 10.7 dev-story: operator INITIATE-parity. Wired the 4 INITIATE bridge writes (announceProject/postAnnouncement/joinBoard/updateFocus) over the SAME core ops with the host-surface operator gate; mounted the 4 byte-shared ui-shared compose surfaces as a single reused themed compose WebviewPanel (native panel-exclusivity); closed the initiate→respond loop (posted announcement → navigable proto-room → reply-to-activate). Rule-13 contract byte-identical. Full aggregate gate green (build/typecheck/lint/format + 1459 root tests); all real-host probes green; gate-order + trim + navigable-loop mutation-tested non-vacuous (Rule 7).
- 2026-06-02 — Story 10.7 code-review: **APPROVE — CLEAN. 0 HIGH / 0 MED / 0 LOW.** No code changes by the reviewer; all findings PASS.

## Review Findings (code-review, 2026-06-02)

**Verdict: APPROVE (clean).** The final Epic-10 feature story reaches FULL operator↔agent initiate-parity. All 3 ACs met with real-runtime evidence; the Rule-15 both-directions loop is closed and mutation-proven in the real Electron host. No HIGH/MED/LOW filed; nothing deferred.

### Aggregate gate — independently re-run by the reviewer on this machine (Node 24.16.0 / pnpm 11.3.0)
- `pnpm run build` — clean; all 3 vscode bundles built incl. the new `dist/webview/compose.js` (1.4mb) + `compose.css`.
- `pnpm run typecheck` — 0 errors. `pnpm run lint` — 0. `pnpm run format` — "All matched files use Prettier code style!".
- ROOT `pnpm test` (the canonical Rule-12 gate, NOT per-package) — **1470/1470 passed (170 files)**; known flakes (seed-protocol-race EPERM, Shiki) did not surface.
- Real-host `@vscode/test-electron` (`test:host`) — **exit 0**, every probe flag `true` on a genuine host (electron 42.2.0 / node 24.15.0 / sqlite 3.51.3): panelCreated, singlePanelReused, htmlHasComposeKind/NonceCsp/NoUnsafe, announceLanded, postAnnouncementLanded, joinBoardLanded, updateFocusLanded, **protoRoomNavigable, protoRoomActivatesByReply**, watchingOnlyGated.

### Rule-by-rule
- **Rule 3/12 (real-runtime + canonical root gate):** SATISFIED. The 4 writes landing out-of-band + the navigable-proto-room→reply-activate loop are proven in the REAL Electron host (`compose-panel.in-host.ts`), not just the happy-dom shim. The canonical gate was run as ROOT `pnpm test` + the full aggregate.
- **Rule 4 (verify symbols before coding):** CONFIRMED. Core signatures match the bridge's calls exactly — `announceProject(da,actor,{title,description})`, `postAnnouncement(da,actor,{projectId,subject,body})`, `joinBoard(da,actor,projectId)` (bare string), `updateFocus(da,handle,focus)` (bare string). The ui-shared compose props match what `ComposeApp` codes to — `onEscape`, `disabled`+`disabledReason`, `JoinableProject{projectId,title}`, `joinFirst`/`onJoinFirst`/`projectLabel`. The dev's Rule-4 prop deltas (onEscape, disabled+disabledReason, JoinableProject) are accurate and correctly coded-to.
- **Rule 7 (mutation non-vacuity):** RE-VERIFIED BY THE REVIEWER. Mutated `requireOperator` to fall through (`return ''` instead of throwing) → the gate-order tests went RED (`expected false to be … NO_OPERATOR`; core was reached → `BOARD_NOT_FOUND`), then reverted byte-identical and confirmed GREEN (10 passed). The gate-order test is non-vacuous. The dev/QA additionally mutation-proved the focus-trim + the in-host navigable-loop (recorded in the Debug Log).
- **Rule 13 (thin client — LOAD-BEARING):** SATISFIED. `git diff HEAD -- packages/core packages/mcp-server packages/ui-shared` is EMPTY (the contract drift-guard stays green; the compose components are MOUNTED, not forked). All 4 writes map to EXISTING core ops the agent uses (grant-on-act preserved); the gate codes (NO_OPERATOR / OPERATOR_NOT_REGISTERED) are HOST-surface only (`BridgeError`), not in core's closed `BOARD_ERROR_CODES`. `whoami` is a host-surface read composing the existing `findIdentity` fold (the `/api/me` analogue). `addParticipant` correctly stays deferred (comment only, not imported/wired). No agent-facing push (the delta poll is host→its-own-webview only; NFR5 intact).
- **Rule 15 (parity both directions):** SATISFIED — this is the whole point of the story. The INITIATE half (4 compose surfaces → 4 bridge writes) AND the RESPOND half (a posted announcement IS a navigable proto-room → open + reply-to-activate via the SAME core `reply`) are both covered. The in-host probe asserts `protoRoomNavigable` (a SELECTABLE pending tree row with the room id — NOT merely that the count incremented) AND `protoRoomActivatesByReply` (active:false→true). Not a partial-parity push.

### Specific-scrutiny answers
- **Gate applied consistently to all 4, BEFORE core?** YES. announceProject/postAnnouncement/joinBoard/updateFocus each call `requireOperator(args)` as the first statement; a watching-only call appends NOTHING (`maxSeq` unchanged, asserted). updateFocus additionally calls `requireRegisteredOperator` before core (the OPERATOR_NOT_REGISTERED backstop, mirroring the web's `/api/me/focus`). None ungated.
- **Host-surface codes not polluting core's closed set?** CONFIRMED — drift-guard green, closed set byte-identical.
- **whoami drives the focus/compose gate (3 states)?** YES — { handle:null,focus:null,registered:false } (watching-only), registered:true+focus (registered), registered:false (configured-but-unregistered). All 3 tested; FocusAffordance renders disabled inert for the latter two.
- **Native panel-exclusivity (single reused panel, no leak)?** SOUND. `ComposePanelManager` holds ONE panel; `open()` reveals+swaps in place (disposes + re-binds a fresh bridge on the swap — the QA value-add proves a post-swap write still LANDS over the live re-bound bridge); `onDidDispose` + `dispose()` tear down bridge + listeners. Distinct from rooms-as-tabs. No leak.
- **Join-first flow mirrors the web?** YES — non-member post → core NOT_A_MEMBER → calm `[ join first ]` CTA → `joinBoard` (the SAME op) → re-show form. Mirrors `announceJoinFirst`.
- **Watching-only gate consistent (the 9.14 lesson)?** YES across all 4 — focus disabled-inert; create/post show the calm watching-only line; join lets the picker open but `choose` surfaces NO_OPERATOR calmly. No surface is clickable-then-crashes; none is a silent no-op.

### Forward-risk for the end-of-epic Rule-14 integrated smoke / Epic 11
- The in-host probe drives the 4 writes via `dispatchRequest` directly (the exact function the panel's bridge invokes) rather than through `panel.webview.onDidReceiveMessage`; the panel CREATION + html + single-reuse are via the real panel, and the per-panel bridge round-trip is separately proven in `compose-panel.test.ts`. The actual webview PAINT (form render + a real click round-trip in the live iframe) remains the lead's chrome-devtools manual smoke — correctly flagged by the dev, consistent with Rule 12's "DOM render covered by the happy-dom tier." No defect; noted so the Rule-14 integrated exploratory smoke exercises the live compose form click-through (post an announcement from the editor → open the resulting proto-room → reply) as a real user, per Rule 14/16.
- `JoinProjectPickerSurface` does an N+1 read (listProjects then boardDirectory-per-project) to compute the joinable filter — mirrors the web's `handleJoinProject`; acceptable at V1 directory scale (Rule 9: no premature optimization without a real hot-path consumer). Not deferred (no measurable concern at this scale).
