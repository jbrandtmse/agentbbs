---
baseline_commit: f58f686
---

# Story 10.3: Native TreeView navigation with decorations

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator in VS Code,
I want a native sidebar tree with unread/needs decorations that mirrors the web control room's navigation,
so that browsing the board feels native to the editor (free twisties, keyboard nav, a11y tree roles) at behavioral parity with the web surface.

## Acceptance Criteria

1. **(AC1 — native TreeDataProvider)** Given the extension, when the sidebar renders, then it uses a native `TreeDataProvider` (registered via `window.registerTreeDataProvider`/`createTreeView` against a `contributes.views` entry) giving free twisties, keyboard navigation, and a11y tree roles. Selection/hover lean on `--vscode-list-*`; row icons use `TreeItem.iconPath` (`ThemeIcon`). The hierarchy mirrors the web tree model: an `AgentBBS` root context, a **NEEDS YOU (N)** bucket (the Mode-B escalation queue), per-project collapsible nodes, each containing an `announcements` indicator + the project's rooms, and a `＋ join a project…` action row.

2. **(AC2 — proto-rooms are NAVIGABLE rows, Rule 15 CONTRACT)** Given a project with an announced proto-room (`active:false` — an announcement no one has replied to yet), when its project node expands, then the proto-room appears as a **navigable, selectable tree row** (a sibling of active rooms, pending-styled — mirroring the web `pendingRows` after Story 9.14), carrying the open command so it can be opened/read/reply-to-activate — NOT merely folded into a count. Active rooms render first, then pending proto-rooms (stable order); a room that becomes active never also appears as a stale proto-row. (This is the operator-parity contract carried from the Epic-9 addendum retro — the exact web gap 9.11→9.14 fixed; the native tree must not reintroduce "counted but unreachable.")

3. **(AC3 — FileDecorationProvider unread/needs markers with the badge cap)** Given unread activity / a NEEDS-YOU escalation on a room, when the tree renders, then a `FileDecorationProvider` supplies the markers: the **NEEDS YOU** flag maps to a tinted `ThemeIcon`/`ThemeColor` (e.g. a warm/charted decoration), and **unread** to a `ThemeIcon` swap or a `FileDecoration` color; the unread **count respects the `FileDecoration.badge` 2-char cap** (→ `99+`/`•` past the threshold, OR the count carried in `TreeItem.description` instead). Read rooms render calm (no badge). The decoration source is the same deterministic state the web tree uses (unread = events since the room cursor; NEEDS YOU = the `needsYouRooms` escalation set — `add_participant(@operator)`, NOT a body-text heuristic).

## Integration ACs

This story CONSUMES the Story-10.2 foundation (the host's data-access handle + the core read ops) and PRODUCES the navigation surface Story 10.4 consumes (selecting a tree row opens a room WebviewPanel). AC1/AC2/AC3 are real-runtime integration ACs: the `TreeDataProvider` is registered + returns the correct item tree against a REAL seeded ledger opened in the extension host (verified via the `@vscode/test-electron` harness), and the proto-room navigable-row + decoration behavior is asserted in-host. Per Rule 1, the producer→consumer wire-up is named: 10.3's tree rows carry an `agentbbs.openRoom`-style command id whose handler is filled by **Story 10.4** (the WebviewPanel). In this story the command may be registered as a thin seam (logs/no-op-with-TODO or opens a placeholder) — but the row MUST be selectable and carry the command (proto-room navigability is structurally present now, not deferred).

## Tasks / Subtasks

- [x] **Task 1 — TreeDataProvider + the view contribution (AC1)**
  - [x] Add `apps/vscode-extension/src/tree/BoardTreeProvider.ts` implementing `vscode.TreeDataProvider<BoardTreeNode>` (a discriminated node union: root/needs-you-bucket/project/room/proto-room/join-action). `getChildren`/`getTreeItem`; `onDidChangeTreeData` emitter for refresh. Register via `window.createTreeView('agentbbs.boardTree', { treeDataProvider, showCollapseAll: true })` in `activate`; add the `contributes.views` + a view container (activity-bar icon) + `contributes.viewsContainers` to `package.json`.
  - [x] Build the tree model from the HOST's data-access handle + core reads DIRECTLY (the tree provider runs in the extension host — it does NOT postMessage to itself; the bridge is for the webview). Mirror `apps/web/src/api-client.ts#loadTreeModel`: `boardDirectory`/`listProjects` → projects; per project `listRooms` (active) + `listAnnouncements` (proto-rooms); `needsYouRooms` → the NEEDS YOU bucket + per-room flags. Reuse core ops; reimplement NO fold/gate (Rule 13 — no board logic in the client).
  - [x] `TreeItem`: `label`, `iconPath` (`ThemeIcon`), `collapsibleState`, `contextValue`, `resourceUri` (a stable `agentbbs:`-scheme URI per room — the key the FileDecorationProvider decorates), and `command` (the open-room seam for 10.4). Selection/hover styling is native (`--vscode-list-*`, free).
- [x] **Task 2 — Proto-room navigable rows (AC2, Rule 15)**
  - [x] In the project node's `getChildren`, render active rooms first, then proto-rooms (`listAnnouncements`, `active:false`) as SIBLING navigable rows (pending-styled icon, e.g. the `*`/announcement `ThemeIcon`), each selectable + carrying the open command. De-dup: a room that is active must NOT also appear as a proto-row (mirror the web `activeRows`/`pendingRows` split keyed by `room_id`).
  - [x] Keep the `announcements (N)` COUNT indicator too (the web keeps both — the count bucket is distinct from the navigable proto-rows; do not collapse one into the other).
- [x] **Task 3 — FileDecorationProvider (AC3)**
  - [x] Add `apps/vscode-extension/src/tree/decorations.ts` implementing `vscode.FileDecorationProvider` keyed off the `agentbbs:` room URIs. NEEDS YOU → a tinted `ThemeColor` + `ThemeIcon`/badge glyph; unread → a `FileDecoration` color/`ThemeIcon` swap; the unread count honors the 2-char `badge` cap (`99+`/`•` past threshold, or the count in `TreeItem.description`). Register via `window.registerFileDecorationProvider`; fire its `onDidChangeFileDecorations` on refresh.
  - [x] Derive unread/needs from the SAME deterministic state as the web tree (unread = events since the per-(identity,room) cursor; NEEDS YOU = `needsYouRooms`). No `@mention` body-text heuristic (item 9.4-mention stays deferred — there is no structured marker; Rule 13).
- [x] **Task 4 — Refresh + lifecycle**
  - [x] Wire a refresh path (a command + an interval or the 10.2 `MAX(seq)` poll signal) that re-reads the model and fires `onDidChangeTreeData`/`onDidChangeFileDecorations`. Full live-fold UX is Story 10.6; here a correct refresh-on-demand + dispose discipline is enough. Dispose the tree view + providers on `deactivate`.
- [x] **Task 5 — Tests (Rule 8/12) + real-host smoke**
  - [x] Host-side unit tests (root-`pnpm test`-discoverable): the tree model builder (project/room/proto-room/needs-you nodes) over a real in-memory node:sqlite data-access handle + core seeds; the decoration logic (needs/unread/read states; the badge 2-char cap boundary — 99/100→`99+`). MUTATION-TEST the Rule-15 marquee semantic (Rule 7): a "proto-rooms counted-only, no navigable row" implementation must turn the AC2 test RED; revert byte-identical.
  - [x] Extend the `@vscode/test-electron` real-host harness: against a seeded ledger in the real VS Code host, assert the `TreeDataProvider` registers and `getChildren` returns the expected nodes INCLUDING a navigable proto-room row, and the `FileDecorationProvider` returns the expected decoration for an unread/needs room. (Real-runtime evidence, Rule 12.)
- [x] **Task 6 — Record decisions**
  - [x] Dev Agent Record: the node model, the decoration mapping (icons/colors/badge cap), the proto-room navigable-row proof, and which behaviors are host-side-native vs deferred to 10.4/10.6.

## Dev Notes

### Parity reference (mirror, don't reinvent) — the web tree model
[Source: apps/web/src/api-client.ts#loadTreeModel (~L305–370)] The web builds: `me` + `needsYou` + `directory` → per project, `listRooms` (active) + `listAnnouncements` (proto-rooms); **active rows first, then PENDING proto-room rows as sibling navigable rows** (the Story-9.14 fix — comment at L325–331: "a proto-room is a navigable PENDING row the operator can open, read the announcement, and reply to"), keyed by `room_id` so an active room never double-appears as a stale proto-row; `needsYou` flags per room + the NEEDS YOU bucket; the `announcements (N)` count is a SEPARATE indicator from the navigable proto-rows. The native tree must reproduce THIS model (behavioral parity, not pixel parity).

### Rule 15 (the marquee correctness contract for this story)
[Source: _bmad-output/implementation-artifacts/epic-9-addendum-retro-2026-06-02.md Action 2; 10-0-epic-9-deferred-cleanup.md carry] Proto-room navigability is part of the operator-parity CONTRACT, not a web-only affordance. The Epic-9 web surface shipped "announcements counted but the proto-room unreachable" (9.11) and a real user hit it within minutes; 9.14 fixed it by rendering proto-rooms as navigable rows mapped to the existing `reply` activator. The native tree MUST render proto-rooms navigable now. Mutation-test this (Rule 7): the count-only regression must go RED.

### Architecture: native tree, host-side
[Source: architecture.md l.285, l.558–560] `BoardTreeProvider.ts` = native `TreeDataProvider`; `decorations.ts` = `FileDecorationProvider` (unread/needs). The tree runs in the EXTENSION HOST and reads via the data-access handle + core ops DIRECTLY — it does not use the webview postMessage bridge (that's for the room webviews, Story 10.4). [Source: wireframe-vscode-v1.md] the encoded decisions: `!` needs-you · `•` unread · `◦` read · `*` announcements/proto-rooms · `▼/▶` tree · `N` activity badge (Source-Control-style) · `＋ join a project…`.

### VS Code API (Rule 3 — verify against the installed @types/vscode 1.105+/1.122)
Verify against the INSTALLED `@types/vscode` (engine floor `^1.105.0`; runtime VS Code 1.122.1): `TreeDataProvider<T>`, `TreeItem` (`iconPath`/`description`/`resourceUri`/`command`/`collapsibleState`/`contextValue`), `window.createTreeView`/`registerTreeDataProvider`, `FileDecorationProvider` (`provideFileDecoration` → `FileDecoration { badge?: string (≤2 chars), color?: ThemeColor, tooltip?, propagate? }`), `window.registerFileDecorationProvider`, `ThemeIcon`/`ThemeColor`, `EventEmitter`/`onDidChange*`, and `contributes.views`/`viewsContainers`. The `FileDecoration.badge` 2-char cap is a real API constraint — design the count display around it (or use `TreeItem.description`). Record any signature delta in the Dev Agent Record.

### Module boundary / Rule 13
The tree provider composes core read ops via the data-access handle; it reimplements no board logic, fabricates no op, and reads only existing projections (`boardDirectory`/`listProjects`/`listRooms`/`listAnnouncements`/`needsYouRooms`, the per-room cursor for unread). `git diff HEAD -- packages/core packages/mcp-server` stays EMPTY. NEEDS YOU is the deterministic `add_participant(@operator)` set — NOT a body-text `@mention` scan (9.4-mention stays deferred; no structured marker exists).

### NEEDS YOU / operator handle
The escalation queue is personalized to the operator handle (the same `--as`/`AGENTBBS_OPERATOR` concept the web host uses — a claimed handle, not a registered "operator" type). Decide how the extension obtains the operator handle (a setting `agentbbs.operatorHandle`, or env) — mirror the web host's canonicalization (lowercased/trimmed) so the `room.participant_added` match lands. Watching-only (no handle) → an empty NEEDS YOU bucket + global read still works.

### Testing standards / baseline
[Source: project-rules.md Rules 7, 8, 12] Canonical gate = ROOT `pnpm test`. Mutation-test the Rule-15 proto-room-navigable semantic + the badge-cap boundary non-vacuous. Real-host evidence via `@vscode/test-electron` (the harness from 10.2 — `pnpm --filter @agentbbs/vscode-extension test:host`). Baseline entering 10.3: 1248 tests (1 known Windows teardown flake, item E10-baseline-seedrace-eperm — NOT yours; Rule 6).

### Project Structure Notes
- New: `apps/vscode-extension/src/tree/{BoardTreeProvider.ts, decorations.ts}` + a tree-model builder (host-side, reusing core ops); `contributes.views`/`viewsContainers` in `package.json`; host-side unit tests + a real-host harness extension.
- The open-room `command` handler is a thin seam this story registers; Story 10.4 fills it with the WebviewPanel. The row must already be selectable + carry the command (Rule 15 — navigability present now).
- esbuild already externalizes `vscode`; the tree code is host-side TS bundled into `dist/extension.cjs`.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 10 / Story 10.3]
- [Source: architecture.md l.285, l.558–560; wireframe-vscode-v1.md (legend/encoded decisions)]
- [Source: apps/web/src/api-client.ts#loadTreeModel (parity reference); packages/core read ops (boardDirectory/listProjects/listRooms/listAnnouncements/needsYouRooms)]
- [Source: apps/vscode-extension/src/{db.ts,bridge.ts,extension.ts} (Story 10.2 host foundation); host-tests/ (real-host harness)]
- [Source: .claude/rules/project-rules.md Rules 1, 3, 7, 8, 12, 13, 15; research-first.md]
- [Source: _bmad-output/implementation-artifacts/10-0-epic-9-deferred-cleanup.md (Rule-15 proto-room carry → 10.3/10.4)]

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Full gate green on this machine: lint 0, build 7/7 (+ apps/web Vite dist + the esbuild extension bundle), typecheck 0, root `pnpm test` 1276/1276 (baseline 1248 + 28 new). Format: my files all pass `prettier --check`; the pre-existing `packages/data-access/src/node-sqlite/*` prettier warnings are committed/untouched (not this story).
- Real-host harness (`pnpm --filter @agentbbs/vscode-extension test:host`) PASSED in the genuine VS Code **insiders** Electron host: electron 42.2.0 / node 24.15.0 / ABI 146 / sqlite 3.51.3. The tree probe returned `protoRoomIsNavigableRow:true, protoRoomPending:true, activeBeforePending:true, needsYouFlagged:true, needsYouBucketHasRoom:true`.
- Rule-7 mutations (both reverted byte-identical, tests re-green):
  - count-only proto-rooms (`pendingRows = []`) → 3 AC2/Rule-15 assertions RED (incl. "proto-room is a navigable row" + "count separate from rows"); `announcementCount` stayed correct, proving the test discriminates navigability from count.
  - badge cap widened (`BADGE_MAX_LENGTH = 3`) → the `100 → '•'` boundary assertions RED.

### Completion Notes List

**The node model (AC1).** `BoardTreeProvider` is a `vscode.TreeDataProvider<BoardTreeNode>` over a discriminated union: `needsYouBucket` → `needsYouRoom` rows; `project` → an `announcementsIndicator` + `room` rows; a `joinProjectAction` row. The load-bearing SELECTION/ORDERING logic lives vscode-free in `tree/tree-model.ts#buildTreeModel` (mirrors `apps/web/src/api-client.ts#loadTreeModel`) so it is unit-testable in plain Node against a real node:sqlite handle — the same separation the bridge uses. `getModel()` exposes the snapshot to the decoration provider.

**Proto-room navigable proof (AC2 / Rule 15 — the marquee).** `buildTreeModel` emits active rooms FIRST then PENDING proto-rooms (`listAnnouncements`, `active:false`) as sibling rows, de-duped by `roomId` (an active room never also appears pending). `BoardTreeProvider.getTreeItem` maps EVERY `room` node — pending included — to a selectable `TreeItem` carrying `OPEN_ROOM_COMMAND` (the open-room seam). Proto-room navigability is structurally present NOW. Proven non-vacuous by the count-only mutation (→ AC2 RED) and confirmed in the REAL Electron host by the tree probe. The `announcements (N)` count is a SEPARATE `announcementsIndicator` node — both are kept (not collapsed).

**Decoration mapping + badge cap (AC3).** `tree/decoration-model.ts` (pure) → `tree/decorations.ts` (`vscode.FileDecorationProvider`), keyed off the `agentbbs://room/<id>` URIs (`tree/room-uri.ts`). Precedence: NEEDS YOU (`!` badge + `agentbbs.needsYouForeground` ThemeColor) outranks unread (count badge + `agentbbs.unreadForeground`); read rooms are calm (no decoration). The **2-char `FileDecoration.badge` cap** is honored in `unreadBadge`: 1–2 digit counts verbatim (`1`..`99`), past 99 collapses to `•`, and the EXACT count rides in `TreeItem.description` (no cap). Two `contributes.colors` map to the built-in `charts.orange`/`charts.blue`.

**Operator handle.** Resolved from the `agentbbs.operatorHandle` setting then `AGENTBBS_OPERATOR` env, canonicalized lowercased+trimmed (`tree/operator-handle.ts`) — the SAME rule as the web host's `ui.ts#resolveOperatorHandle` (duplicated, not imported: the extension is a leaf app and must not depend on `@agentbbs/cli`). `null` = watching-only (empty NEEDS YOU; global read still works). NEEDS YOU = the deterministic `needsYouRooms` (`add_participant(@operator)`) set — NOT a body-text `@mention` scan (9.4-mention stays deferred; no structured marker).

**Unread derivation.** A room is unread iff `roomMessagesSince(events, roomId, roomJoinSeq(operator))` is non-empty — the operator's "new since I joined" floor, the SAME core projection `check` uses (Rule 13: reused, not reimplemented). Watching-only / non-participant → calm.

**Host-native now vs deferred.** Native now: the tree, decorations, refresh-on-demand + a light 2s poll, dispose discipline. Deferred to **Story 10.4**: the `agentbbs.openRoom` command BODY (the room WebviewPanel) — registered now as a thin seam (info message + log) so every row's command resolves and the rows are navigable. Deferred to **Story 10.6**: the full live-fold UX. `agentbbs.joinProject` is a seam (the project-join flow is a later story), mirroring the web's inert `＋ join a project…` row.

**Rule-3 VS Code API verification (installed `@types/vscode@1.120.0`; engine floor `^1.105`, runtime VS Code 1.122.1 — types are 1.120, a benign minor delta, all symbols present):**
- `TreeDataProvider<T>`: `getTreeItem(T): TreeItem | Thenable<TreeItem>`, `getChildren(element?: T): ProviderResult<T[]>`, optional `onDidChangeTreeData?: Event<T | T[] | undefined | null | void>`. ✓
- `TreeItem`: `label`, `iconPath?: string | IconPath`, `description?: string | boolean`, `resourceUri?: Uri`, `command?: Command`, `collapsibleState?: TreeItemCollapsibleState`, `contextValue?: string`. ✓
- `FileDecorationProvider.provideFileDecoration(uri, token): ProviderResult<FileDecoration>`; `onDidChangeFileDecorations?: Event<undefined | Uri | Uri[]>`. ✓
- `FileDecoration` ctor `(badge?, tooltip?, color?: ThemeColor)`; `badge` doc reads "A very short string" — the **2-char cap is a RUNTIME constraint** (the editor truncates past 2 chars), not a typed length, so the cap is enforced in code + asserted by the boundary test. ✓
- `window.createTreeView<T>(viewId, { treeDataProvider, showCollapseAll })`, `window.registerTreeDataProvider`, `window.registerFileDecorationProvider`. ✓
- `ThemeIcon(id)`, `ThemeColor(id)`, `EventEmitter<T>` (`.event` / `.fire` / `.dispose`), `Uri.parse`. ✓
- `contributes.views` / `contributes.viewsContainers` / `contributes.colors` (with `defaults.{dark,light,highContrast}`) / `contributes.menus.view/title`. ✓

**Rule 13 (thin client) confirmed.** `git diff HEAD -- packages/core packages/mcp-server` is EMPTY. The tree composes only existing core read ops; no fabricated op, no reimplemented fold/gate.

**Design decision — `eslint.config.js` `BoardTreeProvider.ts` filename exemption.** The story + architecture.md (l.558–560) commit to the name `BoardTreeProvider.ts` (a class-per-file convention like a React component). The project's `unicorn/filename-case` rule enforces kebab-case for `.ts`. Rather than rename against the ratified architecture name, I added a narrow ignore `/^BoardTreeProvider\.ts$/u` (mirroring the existing `.config.js` / `main.tsx` exemptions) — NOT a weakening: all the vscode-free logic modules (`tree-model`/`decoration-model`/`room-uri`/`operator-handle`) stay kebab-case.

**Pre-existing test maintenance.** Story 10.3 made `activate()` register the native tree, so the Story-10.1/10.2 activation tests (`abi-proof.test.ts`, `bundle-and-activation.test.ts`) needed their `vscode` mock extended (`createTreeView`/`registerFileDecorationProvider`/`workspace.getConfiguration`/`EventEmitter`/`TreeItem`/`ThemeIcon`/`ThemeColor`/`FileDecoration`/`Uri.parse`/`TreeItemCollapsibleState`) and their brittle exact-subscription-count assertions (`toBe(1)`) relaxed to `toBeGreaterThanOrEqual(1)` + a `toContain` on the now-larger command set. No behavioral assertion was weakened — the cleanup contract (every disposable callable) is still asserted.

### File List

- `apps/vscode-extension/src/tree/tree-model.ts` (new)
- `apps/vscode-extension/src/tree/BoardTreeProvider.ts` (new)
- `apps/vscode-extension/src/tree/decoration-model.ts` (new)
- `apps/vscode-extension/src/tree/decorations.ts` (new)
- `apps/vscode-extension/src/tree/room-uri.ts` (new)
- `apps/vscode-extension/src/tree/operator-handle.ts` (new)
- `apps/vscode-extension/src/tree/tree-model.test.ts` (new)
- `apps/vscode-extension/src/tree/decoration-model.test.ts` (new)
- `apps/vscode-extension/src/tree/room-uri.test.ts` (new)
- `apps/vscode-extension/src/tree/operator-handle.test.ts` (new)
- `apps/vscode-extension/host-tests/tree-model.in-host.ts` (new)
- `apps/vscode-extension/src/extension.ts` (modified — wire the tree/decorations + refresh + lifecycle)
- `apps/vscode-extension/package.json` (modified — view container/view/commands/menus/configuration/colors)
- `apps/vscode-extension/host-tests/build-host-tests.cjs` (modified — bundle the tree probe)
- `apps/vscode-extension/host-tests/run-host-tests.cjs` (modified — run + assert the tree probe)
- `apps/vscode-extension/src/abi-proof.test.ts` (modified — extend the vscode mock; relax exact-count assertion)
- `apps/vscode-extension/src/bundle-and-activation.test.ts` (modified — extend the vscode mock; relax exact-count assertion)
- `eslint.config.js` (modified — narrow `BoardTreeProvider.ts` filename-case exemption)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — 10.3 ready-for-dev → review)

## Review Findings

Code review (2026-06-02, `/bmad-code-review` under `/epic-cycle`): **0 decision-needed, 0 patch, 4 defer (LOW/forward-risk), 0 HIGH/MED, 5 dismissed as noise.** Full disposition in `deferred-work.md` → "Deferred from: code review of story 10.3". AC1/AC2/AC3 satisfied with honest real-runtime evidence — the reviewer independently re-ran the `@vscode/test-electron` host probe GREEN (insiders electron 42.2.0 / ABI 146 / node 24.15.0; `protoRoomIsNavigableRow:true … needsYouFlagged:true`) and re-confirmed all three Rule-7 mutations RED (Rule-15 navigability, badge-cap boundary, NEEDS-YOU precedence), reverted byte-identical, ROOT `pnpm test` = 1295 passed. Rule 13 LOAD-BEARING confirmed (`git diff HEAD -- packages/core packages/mcp-server` EMPTY; composes core read ops only; NEEDS YOU = deterministic `needsYouRooms`). Rule 6 N/A.

- [x] [Review][Defer] open-room command (`agentbbs.openRoom`) is a thin registered SEAM (placeholder handler) [apps/vscode-extension/src/extension.ts] — deferred, by design (owner: Story 10.4 fills the WebviewPanel body; row contract final).
- [x] [Review][Defer] `＋ join a project…` (`agentbbs.joinProject`) is an INERT seam (registered command, info-message) — the VS Code analogue of the web's resolved `9.4-join-project-inert` [apps/vscode-extension/src/extension.ts] — deferred, by design (owner: a later Epic-10 / operator-initiate-parity story wires `joinBoard` via a QuickPick; recorded per Rule 13, not a silent no-op).
- [x] [Review][Defer] the uncapped exact unread count in `TreeItem.description` (`"N new"`) — AC3's description half — has no direct test assertion [apps/vscode-extension/src/tree/BoardTreeProvider.ts] — deferred, test-coverage gap (owner: Story 10.6, the live-fold consumer; code is correct, badge cap IS covered).
- [x] [Review][Defer] `tree/operator-handle.ts` canonicalization is DUPLICATED (not imported) from `packages/cli/src/ui.ts#resolveOperatorHandle` — forward drift risk [apps/vscode-extension/src/tree/operator-handle.ts] — deferred, behavior-verified byte-equivalent; hoist to a shared helper when the rule next changes on either surface.

**Dismissed as noise (not recorded):** (1) `getModel()` returns the live model reference not a copy — sole consumer (the decoration provider) is read-only; no mutation path. (2) `findRoom` searches only `project.rooms` not the needs-you bucket refs — investigated: every room is active-or-proto in a global-read project, so the lookup never misses (verified against core `listRooms`/`listAnnouncements` disjoint-by-`active` + global `listProjects`). (3) the 2s poll re-reads the full stream even when unchanged — forward-perf, already the named-10.6 live-fold concern (Rule 9 lineage, web-host-equivalent at V1). (4) de-dup-by-roomId never fires (core sets are disjoint) — intentional defensive mirror of the web, harmless. (5) `eslint` `BoardTreeProvider.ts` exemption — narrow additive ignore matching the ratified architecture name, not a weakening.
