---
baseline_commit: 25f3d44d9cdc30ef17642f00ab2abac4a254e35f
---

# Story 3.2: Browse the main board

Status: done

## Story

As any registered identity,
I want to `list_projects`,
so that I can discover the projects (sub-boards) available to join.

## Acceptance Criteria

1. **Given** zero or more announced projects,
   **When** I call `list_projects` (as an established session identity),
   **Then** I receive the directory of sub-boards — each entry carrying `title`, `project_id` (slug), `description`, and `announcer` — ordered deterministically by `seq` (announcement order, never `created_at`).

2. **Given** I am not a member of any sub-board,
   **When** I call `list_projects`,
   **Then** the read still succeeds (no membership required to browse) — the only thing required is an established identity, not membership.

3. **Given** no announced projects yet,
   **When** I call `list_projects`,
   **Then** I receive an empty list (`[]`), not an error.

4. **Given** no established identity for the session,
   **When** I call `list_projects`,
   **Then** the call is rejected with `NO_IDENTITY` (see Decision below — reading requires a registered identity but NOT membership; this matches Story 3.5's "registered identity, not a member → read succeeds").

## Integration ACs

5. **Integration AC (real-runtime, Rule 3).** **Given** a real `Client`↔`McpServer` pair over `InMemoryTransport` backed by a REAL `createDataAccess` SQLite ledger, **When** identity A announces two projects (in a known order) and identity B (a DIFFERENT identity that is a member of NEITHER) calls `list_projects`, **Then** B receives both projects ordered by `seq` (announcement order), each with the correct `title`/`project_id`/`description`/`announcer`, proving the cross-tool wire-up (`announce_project` writes → `list_projects` reads the folded directory) and the board-wide-open-read-without-membership property — observed against the real ledger.

   **Consumed-by:** `list_projects` is the first consumer of the Story 3.1 projects projection (`foldProjects`). It is itself a terminal read surface (the operator/agent is the consumer of its result); the new `core.listProjects` read op may be reused by the Story 3.4 directory and the Epic 9 UI.

## Tasks / Subtasks

- [x] Task 1: Core `listProjects` read op (AC: #1, #3)
  - [x] Add `packages/core/src/projects/list-projects.ts`: `listProjects(dataAccess): Promise<Project[]>` — read the full event stream (`dataAccess.eventsSince(0)`, which returns events `seq`-ordered), fold via `foldProjects`, and return the projects as an array sorted by `Project.seq` ascending (deterministic announcement order). Empty ledger → `[]`. Board logic (the read+fold) lives in core, not the tool.
  - [x] Reuse the existing `foldProjects`/`Project` from `projection.ts` — do NOT duplicate the fold. (`Map` iteration already preserves announcement order; still sort by `seq` explicitly so the contract is order-independent of Map internals.)
- [x] Task 2: `list_projects` MCP tool (AC: #1, #2, #4)
  - [x] Add `packages/mcp-server/src/tools/list-projects.ts`: thin tool via `registerCoreTool`. Input schema is EMPTY (`{}` — no params; it lists the whole main board). Session precondition: if `session.handle === null` throw `BoardError('NO_IDENTITY', …)` (mirror `update_focus`/`announce_project`). Delegate to `core.listProjects(dataAccess)`. Map each `Project` → snake_case wire (`project_id`, `title`, `description`, `announcer` — reuse/extend `project-shared.ts`'s `projectToWire`; do NOT invent a second mapping). Return the array in BOTH `structuredContent` (e.g. `{ projects: [...] }` — note `structuredContent` must be an object, so wrap the array) and a JSON `text` block.
  - [x] Decide the result envelope: `structuredContent` per MCP must be a JSON object, not a bare array — wrap as `{ projects: [...] }`. The `text` block may carry the same `{ projects: [...] }`. Document the shape.
  - [x] Register it in `server.ts` (`registerListProjectsTool(server, deps.dataAccess, sessionIdentity)`).
- [x] Task 3: Barrel export (AC: #1)
  - [x] Export `listProjects` from `packages/core/src/index.ts` (the `Project` type is already exported by Story 3.1).
- [x] Task 4: Tests (AC: all + Integration AC #5)
  - [x] Unit (core): `listProjects` over a faked DataAccess — empty → `[]`; multiple announces → seq-ordered array; members accreted but the directory entry shape is correct; a `board.joined` for an unknown project does not create a phantom.
  - [x] Integration (mcp-server, real `Client`↔`McpServer` + real `createDataAccess`): AC #5 round-trip (A announces 2, B — a non-member, different identity — lists both seq-ordered with correct fields); empty-board → `[]`; `NO_IDENTITY` with no session; the discovery surface advertises `list_projects` with no required params.
  - [x] Rule 8: co-located `*.test.ts`, discoverable by the root vitest glob.
- [x] Task 5: Full gate — `pnpm run lint`, `typecheck`, `test`, `build`, `format` all green; note the final count.

## Dev Notes

Small read story consuming Story 3.1's projection. It introduces one read tool (`list_projects`) + one core read op (`listProjects`). Most of the machinery (the `Project` record, `foldProjects`, the project wire helper, the session pattern) already exists.

- **Rule 1 (Integration ACs):** SATISFIED — AC #5 is an Integration AC proving the `announce_project → list_projects` cross-tool wire-up over the real ledger.
- **Rule 3 (real-runtime):** `list_projects` is a user-facing tool → AC #5's real-runtime test is mandatory.
- **Rule 5/6:** N/A (no NFR work; no ADRs).

### DECISION — does `list_projects` require an established identity? (resolve before coding; documented)

**Decision: YES, require an established session identity (throw `NO_IDENTITY` if none) — but require NO membership.** Rationale: (1) the user story is literally "As any *registered* identity"; (2) Story 3.5's read-open AC is worded "Given any *registered identity* that is not a member … the read succeeds" — so the gate the board removes for reads is the **membership** gate, not the **identity** gate; reads still presuppose a registered identity. (3) Every agent registers/logs in before browsing, so a session always exists in the real flow; (4) consistency with every existing session-aware tool. The KEY property this story proves (AC #2/#5) is that browsing does NOT require membership — a non-member identity sees the full main-board directory. If the dev finds a concrete reason the architecture intends truly identity-free reads, STOP and raise it (it would also change 3.5); otherwise implement the NO_IDENTITY gate as decided.

### Source facts (verified at story creation, baseline `25f3d44`)

- **Projection (Story 3.1, `packages/core/src/projects/projection.ts`):** `Project { projectId, title, description, announcer, members: string[], seq }`; `foldProjects(events): Map<projectId, Project>` folds `project.announced` (+ `board.joined`) in `seq` order, announcer-first members, ignores phantom joins. `findProject` also available. `listProjects` just reads `eventsSince(0)` + folds + sorts by `seq`.
- **`DataAccess.eventsSince(0)`** returns ALL events `seq`-ordered (the read basis). `Project` is already exported from the core barrel.
- **Wire helper (`packages/mcp-server/src/tools/project-shared.ts`, Story 3.1):** has the project Zod schema(s) + `projectToWire` (camelCase Project → snake_case `{ project_id, title, description, announcer }`). Reuse it for the list entries.
- **Session pattern:** `update_focus`/`announce_project` show the `session.handle === null → NO_IDENTITY` gate; `registerCoreTool` routes the BoardError. Empty input schema is `{}`.
- **`structuredContent` must be a JSON object** (MCP), so wrap the array as `{ projects: [...] }`.
- **Integration test harness:** `packages/mcp-server/src/tools/announce-project.integration.test.ts` (Story 3.1) is the closest template — real `Client` + `InMemoryTransport` + real `createDataAccess` temp DB; register an identity, call tools, assert results + out-of-band ledger.

### Patterns to mirror

- Read op: a thin core function over `eventsSince(0)` + `foldProjects` (no SQL in core; the port does the read).
- Tool: `packages/mcp-server/src/tools/announce-project.ts` (session-required thin tool) — copy structure, swap the delegate + the (empty) schema + the array result envelope.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2] — list_projects returns the directory (title/slug/description/announcer) ordered by seq, readable without membership.
- [Source: _bmad-output/planning-artifacts/architecture.md] — FR9 board-wide open read; #Identifiers project slug; §7 thin tools; ordering always `seq` never `created_at`.
- [Source: packages/core/src/projects/projection.ts] — `foldProjects`/`Project` (the consumed projection).
- [Source: packages/mcp-server/src/tools/announce-project.ts, project-shared.ts] — the tool + wire-helper pattern to mirror.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`

### Debug Log References

- Typecheck initially failed (`Module '"@agentbbs/core"' has no exported member 'listProjects'`) because `tsc` resolves `@agentbbs/core` from its built `dist/` (per package `exports`), not the vitest `src` alias — Rule 2. Resolved by `pnpm run build` before re-running typecheck; no code change needed.
- `server.bootstrap.test.ts` failed once as an expected-list regression: it asserts the exact registered-tool set, which now legitimately includes `list_projects`. Updated the expected array (not a defect).
- `prettier --check` flagged `list-projects.test.ts`; applied `prettier --write` (formatting only).

### Completion Notes List

- Implemented `core.listProjects(dataAccess): Promise<Project[]>` as a thin read over the Story 3.1 projection: `eventsSince(0)` → `foldProjects` → `[...values()].sort((a,b)=>a.seq-b.seq)`. Did NOT duplicate the fold. Empty ledger → `[]` (AC #3). Sort by `seq` is explicit so ordering does not depend on `Map` iteration internals (AC #1).
- Added the `list_projects` thin MCP tool via `registerCoreTool` with an EMPTY input schema (`{}`). Session gate: `session.handle === null` → `BoardError('NO_IDENTITY')`, mirroring `update_focus`/`announce_project` (AC #4). NO membership required (AC #2) — a non-member identity reads the full directory. Reused `project-shared.ts`'s `projectToWire` (no second mapping).
- **DECISION (per story): NO_IDENTITY gate retained.** Found no architectural reason for identity-free reads; consistent with Story 3.5's "registered identity, not a member → read succeeds". The membership gate is what reads remove, not the identity gate.
- **Rule 3 — result envelope verified against the installed SDK `.d.ts`:** `node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.4.3/.../dist/esm/types.d.ts` types `structuredContent` as `ZodOptional<ZodObject<{}>>` / `ZodRecord<string, unknown>` — a JSON OBJECT, never a bare array. So the array is wrapped as `{ projects: [...] }` in both `structuredContent` and the JSON `text` block.
- **Integration AC #5 (Rule 3 real-runtime):** real `Client`↔`McpServer` over `InMemoryTransport` + real `createDataAccess` SQLite temp DB. A (`ada`) announces 2 projects; B (`bob`, a different identity, member of neither) calls `list_projects` and receives both seq-ordered with correct `project_id`/`title`/`description`/`announcer`, and `bob` is NOT in either `members` — proving cross-tool wire-up + board-wide-open-read-without-membership.
- **Rule 5/6:** N/A (no NFR work touched; no `docs/adr/`).
- Full gate: lint clean, typecheck clean (after build), **298 tests passed (45 files)** incl. 8 new, build all-Done, prettier all-clean.

### File List

- packages/core/src/projects/list-projects.ts (new)
- packages/core/src/projects/list-projects.test.ts (new)
- packages/core/src/index.ts (modified — export `listProjects`)
- packages/mcp-server/src/tools/list-projects.ts (new)
- packages/mcp-server/src/tools/list-projects.integration.test.ts (new)
- packages/mcp-server/src/server.ts (modified — register `list_projects`)
- packages/mcp-server/src/server.bootstrap.test.ts (modified — expected tool list now includes `list_projects`)

## Change Log

| Date       | Change                                                                          |
|------------|---------------------------------------------------------------------------------|
| 2026-05-31 | Story 3.2 created by the /epic-cycle lead gate (read tool; consumes the Story 3.1 projection; Integration AC #5 present). Status → ready-for-dev. |
| 2026-05-31 | Dev complete: `core.listProjects` read op + `list_projects` thin MCP tool (empty schema, NO_IDENTITY gate, no membership). Reused Story 3.1 `foldProjects`/`projectToWire`. Wire envelope `{ projects: [...] }` (Rule 3-verified: `structuredContent` must be an object). 8 new tests (4 unit + 4 integration incl. AC #5 real-runtime). Full gate green — 298 tests. Status → review. |
| 2026-05-31 | Code review (`bmad-code-review`) — **CLEAN, APPROVED**. Three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) raised 4 candidates, all dismissed as noise (see Review Findings). All 5 ACs satisfied; Rule 3 real-runtime integration test re-run live and green (9 Story-3.2 tests pass). Status → done. |

## Review Findings

**`bmad-code-review` — Story 3.2 — 2026-05-31 (baseline `25f3d44`, uncommitted working tree).**

Outcome: **✅ Clean review — all layers passed.** 0 decision-needed, 0 patch, 0 defer, 4 dismissed.

Test evidence re-run live (not trusted from summary): `vitest run` of `list-projects.test.ts` + `list-projects.integration.test.ts` → **9 passed**; `server.bootstrap.test.ts` → 6 passed. The integration suite is genuine real-runtime (real `Client`↔`McpServer` over `InMemoryTransport` + real `createDataAccess` SQLite temp DB, no SDK mock) — **Rule 3 satisfied**.

Stage-scrutiny verdict (all confirmed end-to-end):
- (a) Ordering strictly by `seq`: core sorts `a.seq - b.seq`; the tool does NOT re-sort; integration test "orders the wire list by announcement seq, NOT alphabetically by title" proves seq≠title across the full `announce_project → core → projectToWire` path. ✓
- (b) THIN: core reuses `foldProjects` (no inline fold); tool reuses `projectToWire` from `project-shared.ts` (no second wire mapping). ✓
- (c) `NO_IDENTITY` gate mirrors `update_focus`/`announce_project` exactly (`session.handle === null` → `BoardError('NO_IDENTITY', …)`). ✓
- (d) `{ projects: [...] }` envelope correct per installed SDK `.d.ts` (`structuredContent` must be a JSON object; array wrapped). ✓
- (e) Empty board → `[]` not error (AC #3): unit + integration. ✓
- (f) Board-wide-open read WITHOUT membership: AC #5 — `bob` (different identity, member of neither) sees both projects and is absent from `members`; no accidental membership gate. ✓

Dismissed candidates (4):
- [Review][Dismiss] Wire `members` field exceeds AC #1's four named fields — AC #1 says each entry "carries" the four fields, not "only" them; `members` is reused verbatim from Story 3.1's `projectToWire` and is load-bearing for the AC #2/#5 non-membership proof. Not a defect.
- [Review][Dismiss] `eventsSince(0)` re-reads the full event stream per call — this IS the architecture's derived-state-by-query design (no `projects` table; directory recomputed from events every call). Correct and in-scope, not an efficiency defect at V1 scale.
- [Review][Dismiss] Tool has no try/catch; relies on `registerCoreTool` to map the thrown `BoardError` — that is the established thin-tool contract; the helper catches and maps to the closed `{ code, message }` result. Correct.
- [Review][Dismiss] Possible off-by-one in `eventsSince(0)` (`seq > 0`) — `seq` is monotonic from 1, so `> 0` captures all events; verified against the ledger/fake. No defect.

Rule 5 (NFR tripwire): N/A — no NFR work. Rule 6 (ADR): N/A — `docs/adr/` absent. Rule 1 (Integration AC): AC #5 is a genuine cross-tool round-trip (announce → list over the real ledger), not a stub.

No items added to `deferred-work.md` (zero deferrals).
