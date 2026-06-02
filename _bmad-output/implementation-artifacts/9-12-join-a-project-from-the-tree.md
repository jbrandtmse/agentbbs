---
baseline_commit: e0d0f1f36fc11dd9d403248c96c0d8fc9034f0e1
---
<!-- Story 9.12 — created 2026-06-01 by the Lead (epic-cycle resume; correct-course parity story). -->
<!-- Wire the inert `＋ join a project…` row to a real picker → EXISTING join_board endpoint. Resolves deferred 9.4-join-project-inert. Client/ui-shared only; core + MCP + host endpoints byte-identical (Rule 13). -->

# Story 9.12: Join a project from the tree

Status: done

## Story

As an operator,
I want `＋ join a project…` to actually join a project,
so that I can follow more boards and post in them.

## Acceptance Criteria

**AC1 — The picker + the join.**
**Given** the `＋ join a project…` row (visible since Story 9.4, currently inert),
**When** I click it,
**Then** a calm picker of joinable projects (global-read directory MINUS those I already belong to) opens, and choosing one joins it via the EXISTING `POST /api/projects/:projectId/join` (`join_board`); the tree reflects my new membership live; I can then post an announcement there (Story 9.11),
**And** this resolves the `9.4-join-project-inert` deferred item.

**AC2 — Join semantics + calm UX.**
**Given** the join,
**When** it runs,
**Then** it is idempotent (a re-join is a no-op, matching `join_board`), calm/inline (no modal, terse voice), closing the picker without choosing is a clean no-op, and the join is a real `board.joined` event (the SAME core op an agent uses), proven over the real stack.

## Tasks / Subtasks

- [x] **Task 1 — ui-shared: prop-driven `JoinProjectPicker`** (AC: 1, 2 / NFR2)
  - [x] Add a calm, prop-driven picker component in `packages/ui-shared/src/…` (mirror the Story 9.11 compose components + `room/Composer.tsx`): props for the list of `joinable` projects (`{ projectId, title }[]`), `onChoose(projectId)`, `onCancel`/`onEscape`, `pending`, an inline `error` slot. Terse lowercase voice, NO modal (inline panel like the 9.11 compose). Empty-list state: a calm "no projects to join" line (not an error). Import ONLY React (NFR2 — no `@agentbbs/core` / `@agentbbs/data-access`).
  - [x] Barrel-export the component + its prop types from `packages/ui-shared/src/index.ts`.
- [x] **Task 2 — apps/web: wire the inert row to the picker** (AC: 1, 2)
  - [x] Replace the `handleJoinProject` stub (`apps/web/src/App.tsx:407` — currently a `console.info` no-op) so clicking the `＋ join a project…` row OPENS the picker. Compute the `joinable` list = the global-read directory (`fetchDirectory`, already in `api-client.ts:125`) MINUS the projects the operator already belongs to (filter `members` against the operator handle from `/api/me` / `model.operatorHandle`; canonical-handle compare — lowercased, matching how memberships are stored).
  - [x] On choose → `postJoin(projectId)` (already in `api-client.ts:584`, the SAME `join_board` endpoint), then `loadTreeModel()` to refresh so the new membership shows LIVE; close the picker. On `postJoin` failure surface the calm inline error (never a silent swallow). Closing the picker without choosing = clean no-op (no board write).
  - [x] Watching-only host (no operator handle): the join cannot resolve an actor (the endpoint returns `NO_OPERATOR` 403). Keep the affordance calm — the picker opens and choosing surfaces the host's `NO_OPERATOR` calmly in the inline `error` slot (never a crash). [When `model.operatorHandle === null` the joinable filter shows ALL projects (the host enforces the real gate at choose-time); the calm inline error explains the watching-only state. Story 9.13 had not landed; this is the consistent handling.]
- [x] **Task 3 — Resolve the deferred item + tests** (AC: 1, 2)
  - [x] Update `_bmad-output/implementation-artifacts/deferred-work.md`: mark `9.4-join-project-inert` RESOLVED by Story 9.12 (the row is now wired to the picker → real `join_board`).
  - [x] **ui-shared DOM** (`*.test.tsx`): the picker renders the joinable list, choosing fires `onChoose(projectId)`, cancel/Esc fires `onCancel`/`onEscape` (clean no-op), the empty-list calm state renders, the inline error slot renders. NFR2 (React-only imports). [`packages/ui-shared/src/compose/JoinProjectPicker.test.tsx` — 7 tests.]
  - [x] **apps/web DOM** (`App.test.tsx`): clicking `＋ join a project…` opens the picker with the directory MINUS already-member projects; choosing calls `postJoin` with the right id then refreshes the tree so membership reflects live; closing without choosing writes nothing. Mutation-test (Rule 7) the "minus already-member" filter once (a member project must NOT appear) to prove it's non-vacuous. [3 tests; mutation-tested RED by flipping `!members.includes` → `members.includes` (calling-interface appeared / payments dropped), then reverted byte-identically — git diff confirmed.]
  - [x] **Host integration** (real stack, Rule 3): RELY ON + CITE the existing Story 9.7 coverage — `packages/cli/src/host/json-api.test.ts:725` (join → operator becomes a SUB-BOARD member over real `createDataAccess`), `:753` (idempotent re-join → 200, NO extra event), `:773` (unknown board → 404 BOARD_NOT_FOUND), `:785` (watching-only → 403 NO_OPERATOR, nothing appended); plus `host.integration.test.ts:585,614` (real `board.joined` lands). The picker uses the SAME endpoint; no new host-integration assertion sharpens it (the picker→`postJoin`→refresh path is exercised end-to-end by the apps/web DOM integration tests above). Idempotency (re-join = no double-write) is core-proven + host-proven by 9.7; the apps/web "choose → refresh → re-open → empty" test confirms the picker path doesn't re-offer a joined project.
  - [x] **Rule 13 drift-guard**: this story adds NO new host endpoint and NO core change — confirmed `git diff HEAD -- packages/core packages/mcp-server packages/cli/src/host` is EMPTY (byte-identical). No host wire touched; the drift-guarded agent contract is unchanged.

## Dev Notes

### What this story IS (and is NOT)

- **IS:** a prop-driven `ui-shared` picker + apps/web wiring of the existing-but-inert `＋ join a project…` row to the EXISTING `POST /api/projects/:id/join` (`join_board`) endpoint and the EXISTING `fetchDirectory` read. Resolves `9.4-join-project-inert`.
- **IS NOT:** any new host endpoint, core op, or MCP/agent-contract change. `join_board` + its host POST + `postJoin` already exist (Story 9.7); `fetchDirectory` + `getMe` already exist (Story 9.4). **Rule 13** governs: client/ui-shared only; the drift-guarded agent contract + the host endpoint set stay byte-identical. Do NOT invent a "leave project" op or a client-only join backdoor — the picker calls the same `join_board` an agent uses.
- **IS NOT:** identity (register/login) — OUT of scope; `--as`/`AGENTBBS_OPERATOR` stands.

### Source facts to VERIFY before coding (Rule 4 — verified by the Lead at story creation)

- **Inert row + handler stub** — `packages/ui-shared/src/tree/NavTree.tsx`: the `＋ join a project…` button (`:483` class `nav-join-project`, `:485` `onClick={onJoinProject}`, prop at `:99`). `apps/web/src/App.tsx:407` `handleJoinProject()` is currently a `console.info` STUB wired at `:777` `onJoinProject={handleJoinProject}`. [Verified by Lead.]
- **Existing join endpoint + client** — `packages/cli/src/host/json-api.ts:422-430` `POST /api/projects/:projectId/join` → `joinBoard(dataAccess, actor, projectId)` → `{ project }`; `requireOperator` → `NO_OPERATOR` 403 (watching-only); idempotent (joinBoard no-op re-join). Client: `apps/web/src/api-client.ts:584` `postJoin(projectId)`. [Verified by Lead — REUSE; do NOT add a new endpoint.]
- **Existing directory + me reads** — `apps/web/src/api-client.ts:125` `fetchDirectory()` → `{ projects: [{ project_id, title, description, announcer, members }] }` (confirmed live: the `/api/directory` envelope carries `members`); `api-client.ts:154` `getMe()` → `{ handle }`. The "joinable" set = `directory.projects.filter(p => !p.members.includes(operatorCanonicalHandle))`. [Verified by Lead — I read the live `/api/directory` envelope during the 9.11 smoke: `{"projects":[{"project_id","title","description","announcer","members":[…]}]}`.]
- **`joinBoard`** — `packages/core/src/projects/join-board.ts:56` `joinBoard(dataAccess, actor, projectId) → Promise<Project>`; emits `board.joined` (plain append, idempotent re-join returns unchanged). [Verified by Lead.]
- **Canonical handle compare** — memberships store the canonical (lowercased) handle; `apps/web/src/ui.ts#resolveOperatorHandle` lowercases `--as`. Filter the joinable set with the canonical operator handle (the tree model already carries `operatorHandle` canonical). [Verified by Lead.]

### READ-BEFORE-EDIT (UPDATE files)

`apps/web/src/App.tsx` (the `handleJoinProject` stub + the tree mount + how `loadTreeModel`/`model.operatorHandle` are used + the 9.11 compose-panel pattern to mirror for the picker's calm inline placement), `packages/ui-shared/src/index.ts` (barrel), `packages/ui-shared/src/tree/NavTree.tsx` (the row — likely unchanged; the prop is already there). Document current behavior + what changes + what to preserve (don't break 9.4–9.11 tree/SSE/compose behavior).

### Design reconciliation (Rule 8 / Rule 13)

The board has NO standalone "join this room" op and NO "leave" op (Epics 3–5; reaffirmed 9.7/9.8). `join_board` grants SUB-BOARD membership. The picker maps the affordance to `join_board` exactly — it does not fabricate a board op or a backdoor. A joined project that has rooms becomes postable via Story 9.11's compose; the two compose cleanly.

### Testing standards

- Canonical gate is ROOT `pnpm test` (Rule 12 corollary): `.test.tsx` runs under the `ui-shared-dom` happy-dom vitest project; a per-package `vitest` run FALSELY reports `.tsx` as `document is not defined` — use `pnpm test` + git as ground truth (Rule 6). Use `python` not `python3`.
- Host integration over real `createDataAccess` (Rule 3). Honest gate before done: lint 0 / typecheck 0 / build / `pnpm test` all green (0 failed/0 skipped, no `.only`/`.skip`/`.todo`) / `format --check` clean.

### Smoke (lead-side gate — informational)

Lead will drive real Chrome: click `＋ join a project…` → calm picker lists ONLY projects the operator is NOT a member of (no modal) → choose one → tree shows the new membership LIVE + a real `board.joined` lands (asserted out-of-band) → the operator can then post there (composes with 9.11) → re-open the picker: the just-joined project is GONE from the list (idempotency/filter) → closing the picker without choosing writes nothing. **Note the 9.11 smoke already exercised the join-first handoff's `postJoin`; this story's picker is the dedicated discovery path.**

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.12]
- [Source: .claude/rules/project-rules.md#13] (thin-client: existing board ops, no fabricated op/backdoor), [#8] (reconcile vs shipped design), [#4] (verify source-facts)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] (9.4-join-project-inert — this story resolves it)
- [Source: apps/web/src/App.tsx:407,777], [Source: packages/ui-shared/src/tree/NavTree.tsx:99,483-499]
- [Source: packages/cli/src/host/json-api.ts:422-430], [Source: apps/web/src/api-client.ts:125,154,584], [Source: packages/core/src/projects/join-board.ts:56]
- [Source: 9-11-start-a-negotiation.md] (the compose-panel pattern + ApiError code-surfacing to mirror)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — dev-story stage under /epic-cycle.

### Debug Log References

- Honest gate: lint 0 / typecheck 0 / build green / `pnpm test` 1149 passed (138 files, 0 failed, 0 skipped) / `prettier --check` clean. Baseline after 9.11 was 1139; +10 (7 picker DOM + 3 apps/web integration).
- ONE full-suite run showed a single `render-markdown.xss.test.ts` failure (`@shikijs/primitive` `_tokenizeWithTheme` `startIndex` TypeError) — a pre-existing Shiki concurrency/warmup flake (tracked: 9.5 Shiki-warmup analysis in deferred-work), NOT caused by this story (zero markdown/highlight code touched). Verified per Rule 6: the file passes 43/43 in isolation, and the very next full `pnpm test` was 1149/1149 green. No retry-in-sleep-loop; root-caused as flake.
- Rule 7 mutation-test (apps/web "minus already-member" filter): flipped `!p.members.includes(operator)` → `p.members.includes(operator)` → the 9.12 filter test went RED (calling-interface appeared, payments dropped; the choose test's joinWrite became undefined). Reverted byte-identically (`git diff` on App.tsx confirmed the `!members.includes` line restored); 9.12 tests green again.

### Completion Notes List

- **Source-fact correction (Rule 4):** the story cited `apps/web/src/ui.ts#resolveOperatorHandle` and `api-client.ts:584` `postJoin`. Verified against the repo: `resolveOperatorHandle` actually lives in **`packages/cli/src/ui.ts:45`** (the HOST, not apps/web) — confirmed it `.trim().toLowerCase()`s the handle, so `model.operatorHandle` IS canonical (lowercased), matching how `members` are stored (`projectToWire` → `project.members`, canonicalized on register). `postJoin` is at **`api-client.ts:628`** (not :584 — that's `postReact`). The cited semantics were all correct; only the file paths/line numbers were slightly off. Coded to the verified locations.
- **Rule 13 (load-bearing) honored:** NO new host endpoint, NO core/MCP change. The picker wires the previously-inert `＋ join a project…` row to the EXISTING `POST /api/projects/:id/join` (`join_board`) + EXISTING `fetchDirectory`. `git diff HEAD -- packages/core packages/mcp-server packages/cli/src/host` is EMPTY (byte-identical agent contract). No fabricated/leave op, no operator backdoor — the operator joins via the SAME `join_board` an agent uses.
- **NFR2:** `JoinProjectPicker` imports ONLY React (a type-only `react` import) — no `@agentbbs/core` / `@agentbbs/data-access`. Prop-driven + presentation-only; the surface (apps/web) owns the directory→joinable filter, the `joinBoard` write, the error wiring, and the live tree refresh — so the VS Code surface (Epic 10) can reuse it.
- **Calm UX (AC2):** inline panel (NOT a modal), terse lowercase voice, `[ join ] <title>` rows; empty list → calm `no projects to join` line (not an error); `error` slot renders host errors (e.g. NO_OPERATOR) under the list with the panel intact; cancel/Esc dismiss as a clean no-op; `pending` disables controls. Mirrors the 9.11 `CreateProjectCompose` pattern.
- **No NFR tripwire (Rule 5), no ADRs (Rule 6):** `docs/adr/` does not exist; no ADR commitments. No NFR found un-implementable.

### File List

- `packages/ui-shared/src/compose/JoinProjectPicker.tsx` (NEW — the prop-driven picker)
- `packages/ui-shared/src/compose/JoinProjectPicker.test.tsx` (NEW — 7 DOM tests)
- `packages/ui-shared/src/index.ts` (MODIFIED — barrel-export `JoinProjectPicker` + `JoinProjectPickerProps` + `JoinableProject`)
- `apps/web/src/App.tsx` (MODIFIED — import wiring; picker state; `handleJoinProject` opens the picker w/ joinable filter; `handleChooseJoin` → `postJoin` + tree refresh; render the picker in the sidebar)
- `apps/web/src/App.test.tsx` (MODIFIED — Story 9.12 describe block, 3 integration tests incl. the Rule-7 mutation target)
- `_bmad-output/implementation-artifacts/deferred-work.md` (MODIFIED — `9.4-join-project-inert` marked RESOLVED by 9.12)

### Change Log

- 2026-06-01 — Story 9.12 implemented (dev-story). Added `JoinProjectPicker` (ui-shared, prop-driven, NFR2-clean) + barrel export; wired the inert `＋ join a project…` row in apps/web to it → EXISTING `join_board` endpoint + `fetchDirectory` (joinable = directory MINUS already-member, canonical-handle compare); resolved `9.4-join-project-inert`. 7 picker DOM tests + 3 apps/web integration tests (Rule-7 mutation-proven non-vacuous). Rule 13 drift-guard: core/mcp/host byte-identical. Honest gate green (1149 tests). Status → review.

## Review Findings

### Code Review — 2026-06-01 (bmad-code-review, /epic-cycle)

**Outcome: ✅ CLEAN — 0 HIGH / 0 MED / 0 LOW actionable. APPROVED.** 0 decision-needed, 0 patch, 0 defer, 4 dismissed-as-noise.

Three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) run against the combined dev+QA diff (baseline `e0d0f1f` = 9.11 HEAD; all 9.12 work uncommitted in the working tree).

**Honest gate — all green:**
- lint 0 / typecheck 0 / `prettier --check` clean / `pnpm -r build` green.
- ROOT `pnpm test` = **1157 passed (138 files), 0 failed, 0 skipped** (baseline 1139 + 10 dev + 8 QA = 1157, exactly as predicted). No `.only`/`.skip`/`.todo` in the changed test files. The known Shiki-warmup flake (`render-markdown.xss.test.ts`, unrelated to 9.12) did NOT surface this run; git is ground truth (Rule 6) — zero markdown/highlight code touched.

**Rule 13 (LOAD-BEARING) — PASS.** `git diff HEAD -- packages/core packages/mcp-server packages/cli/src/host` is **EMPTY (byte-identical)**. NO new host endpoint (the picker reuses the EXISTING `POST /api/projects/:id/join` via `postJoin`), NO core/MCP change, NO fabricated "leave"/"join-room" op, NO operator backdoor — the operator joins via the SAME `join_board` an agent uses. Client/ui-shared-only as specified.

**Joinable filter (marquee semantic) — PASS, mutation re-verified independently (Rule 7).** Reviewer flipped `!p.members.some(m => m.toLowerCase() === operator)` → `p.members.some(...)` in `App.tsx`; **4 filter/calm-UX tests went RED** (the dev "minus already-member" pin + the QA canonical-compare + empty-joinable + the live-refresh re-offer). Reverted **byte-identically** (`git diff HEAD -- apps/web/src/App.tsx` shows only the original `!p.members.some` story line; no mutation residue) and all 8 Story-9.12 App tests green again. The canonical (lowercased-both-sides) compare correctly excludes a mixed-case member (`Ops` vs `ops`).

**Calm UX (AC2 / Rule 13 / 9.10) — PASS.** No-modal asserted by ROLE (`role="group"`, negative `role="dialog"/"alertdialog"/[aria-modal]`), not a substring. cancel/Esc = clean no-op (no `postJoin`, verified `writes.length === 0`). choose→NO_OPERATOR(403) → calm INLINE `role="status"` error, picker stays OPEN, never silent. Failed join does NOT optimistically flip membership (re-open still offers the project — pinned).

**Idempotency / no re-offer — PASS.** After join + live `loadTreeModel()` refresh the joined project is GONE from the picker (apps/web "choose → refresh → re-open → empty" test). Idempotent re-join is core+host-proven by 9.7.

**9.4-inert resolution — PASS.** `deferred-work.md` marks `9.4-join-project-inert` ✅ RESOLVED by 9.12, and the row is GENUINELY wired (`nav-join-project` → `onJoinProject` → `handleJoinProject` opens the picker → `handleChooseJoin` → `postJoin` + refresh) — not still a stub.

**Rule 3 (real-runtime evidence) — SATISFIED.** The picker→`postJoin`→refresh path is exercised end-to-end by the apps/web DOM integration block (real `App`, stubbed fetch over the real `loadTreeModel`/`api-client`). The real `board.joined` + the join/idempotent/404/403 host behavior is covered by LEGITIMATE REUSE of the cited Story 9.7 host-integration tests — all citations VERIFIED real: `json-api.test.ts:725` (join→sub-board member), `:753` (idempotent re-join, no extra event), `:773` (unknown→404 BOARD_NOT_FOUND), `:785` (watching-only→403 NO_OPERATOR, nothing appended); `host.integration.test.ts:585,614` (real `board.joined` lands). Reuse is sound because NO new endpoint was added (Rule 1: not service-introducing).

**`handleChooseJoin` pattern — PASS.** Faithful mirror of the shipped `handleCreateProject`/reply success-refetch discipline (`.then(loadTreeModel).then(setModel + close + clearError).catch(setError).finally(clearPending)`); `model.operatorHandle` is canonical (host `resolveOperatorHandle` lowercases), members compared canonically. No ADRs (`docs/adr/` absent — Rule 6 N/A). No NFR tripwire (Rule 5 N/A).

**Dismissed as noise (4):**
1. `error !== null && error !== undefined` is slightly redundant vs `error != null` — correct as written; stylistic.
2. Directory-read failure sets both `joinable=[]` (→ calm empty line) and `joinPickerError` (→ error slot); both render together. Calm, never silent, never a crash — acceptable per AC2.
3. Operator handle sourced from mount-time `model.operatorHandle` while `members` come from a fresh `fetchDirectory()` — theoretical stale-handle window only; the handle is session-stable. No defect.
4. Double-clicking the join row re-fetches + re-opens — harmless, idempotent.

No items deferred to `deferred-work.md` (0 defer findings).
