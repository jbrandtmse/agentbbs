---
baseline_commit: ff488338189a9d4ced78cb59921e5f1c090d2a5e
---

# Story 3.4: Sub-board directory with focus and last-seen

Status: done

## Story

As any identity,
I want to read a sub-board's member directory,
so that I can see who is on the project, what each is working on, and whether they are stale.

## Acceptance Criteria

1. **Given** a sub-board with members,
   **When** I request its directory (`list_members` with the board's `project_id`),
   **Then** I receive each member's `handle`, `current_focus`, and `last_seen` — all computed from the event stream (the projects membership fold ⋈ the identity directory fold), with members in join order (announcer first).

2. **Given** members whose `last_seen` differs (one active recently, one not),
   **When** I read the directory,
   **Then** each member's `last_seen` (ISO-8601, derived) is returned so old-vs-recent members are distinguishable — staleness itself is a DISPLAY value computed by the consumer/UI (architecture: "staleness is a derived display value"), NOT a flag computed in core (see Decision).

3. **Given** a `project_id` that was never announced,
   **When** I call `list_members`,
   **Then** the call is rejected with `BOARD_NOT_FOUND` and no event is appended (it is a pure read).

4. **Given** I am not a member of the sub-board,
   **When** I read its directory,
   **Then** the read succeeds (board-wide open read — no membership required; only an established identity, per the Story 3.2/3.5 model). With no established identity → `NO_IDENTITY`.

## Integration ACs

5. **Integration AC (real-runtime, Rule 3).** **Given** a real `Client`↔`McpServer` pair over `InMemoryTransport` backed by a REAL `createDataAccess` SQLite ledger, **When** A announces a board (auto-joining as first member) and updates its focus, B `join_board`s and updates a DIFFERENT focus, then a THIRD identity C (a member of NEITHER) calls `list_members` for that board, **Then** C receives both A and B with their correct `handle`/`current_focus`/`last_seen` in join order (A first), each `last_seen` reflecting that member's latest identity event — proving the cross-projection join (membership ⋈ identity) over the real ledger and the open-read-without-membership property. AND `list_members` for an unknown `project_id` → `BOARD_NOT_FOUND`.

   **Consumed-by:** the directory read op (`boardDirectory` / `list_members`) is a terminal read surface (its result is consumed by the agent + the Epic 9/10 UI that greys out stale members). It reuses the Story 3.1 projects projection + the Epic 2 identity projection; no new projection primitive that a later MCP story consumes.

## Tasks / Subtasks

- [x] Task 1: Core `boardDirectory` read op (AC: #1, #2, #3)
  - [x] Add `packages/core/src/projects/board-directory.ts`: `boardDirectory(dataAccess, projectId): Promise<DirectoryMember[]>` where `DirectoryMember = { handle, currentFocus, lastSeen }`. Read `eventsSince(0)`; `findProject(events, projectId)` → if `undefined` throw `BoardError('BOARD_NOT_FOUND', …)`. Otherwise `foldIdentities(events)` once, and for each `handle` in `project.members` (join order, announcer first) emit `{ handle, currentFocus, lastSeen }` from the folded `Identity`. Pure board logic in core; no SQL.
  - [x] Edge: a member handle present in `project.members` but with no folded `Identity` (should not happen in V1 — you must register before join, and join requires a session identity — but be defensive): either skip it or surface the handle with empty focus. PREFER: such a handle cannot occur given the tool gates (join requires an established, hence registered, identity); if defensive handling is added, document why and keep it from masking a real bug (don't silently fabricate).
  - [x] Reuse `foldIdentities`/`Identity` (Epic 2) and `findProject`/`Project` (Story 3.1) — do NOT duplicate either fold.
- [x] Task 2: `list_members` MCP tool (AC: #1, #3, #4)
  - [x] Add `packages/mcp-server/src/tools/list-members.ts`: thin session-required read tool via `registerCoreTool`. Zod input: `{ project_id: projectIdSchema }` (reuse from `project-shared.ts`). Session precondition: `session.handle === null` → `NO_IDENTITY` (no membership check — open read). Delegate to `core.boardDirectory(dataAccess, project_id)`. Map each `DirectoryMember` → snake_case wire `{ handle, current_focus, last_seen }` (reuse `identityToWire`'s field convention; a member entry is a subset of the identity wire — extract/reuse a `memberToWire` helper rather than duplicate the rename). Envelope the array as `{ members: [...] }` in `structuredContent` + a JSON `text` block (structuredContent must be an object). Register in `server.ts`.
- [x] Task 3: Barrel export (AC: #1)
  - [x] Export `boardDirectory` (+ the `DirectoryMember` type) from `packages/core/src/index.ts`.
- [x] Task 4: Tests (AC: all + Integration AC #5)
  - [x] Unit (core): directory for a board with 2+ members reflects each member's folded currentFocus + lastSeen in join order; a focus update advances that member's lastSeen and changes currentFocus in the directory; unknown board → `BOARD_NOT_FOUND`; an empty (announcer-only) board returns just the announcer.
  - [x] Integration (mcp-server, real `Client`↔`McpServer` + real `createDataAccess`): AC #5 round-trip (A + B with distinct focuses, C non-member reads both in order; distinct last_seen observable); unknown board → BOARD_NOT_FOUND; NO_IDENTITY with no session.
  - [x] Rule 8: co-located `*.test.ts`, discoverable.
- [x] Task 5: Full gate — lint, typecheck, test, build, format all green; note the count.

## Dev Notes

A read story that JOINS two existing projections: the Story 3.1 projects membership (who is on the board) ⋈ the Epic 2 identity directory (each member's current focus + last-seen). No new event type, no write. The "staleness" requirement is satisfied by returning the derived `last_seen`; the greying-out is a UI concern.

- **Rule 1 (Integration ACs):** SATISFIED — AC #5 proves the cross-projection join over the real ledger + open-read-without-membership.
- **Rule 3 (real-runtime):** `list_members` is user-facing → AC #5's real-runtime test mandatory.
- **Rule 5/6:** N/A.

### DECISION 1 — staleness is NOT computed in core; the directory returns `last_seen`

The epic AC says "members whose last-seen is old are distinguishable (the staleness signal **the UI greys out**)" and the architecture states "**staleness is a derived display value**" (architecture.md ~line 268). **Decision: core returns each member's derived `last_seen` (ISO-8601); it does NOT compute a `stale` boolean.** Rationale: a `stale` flag needs a "now" clock + a threshold — both are display/policy concerns, and core deliberately never fabricates time (it only surfaces the `created_at` that data-access stamped). Returning `last_seen` makes members distinguishable (the consumer/UI thresholds against now). If a future story needs a server-computed staleness policy, it is added then with an explicit clock injection — out of scope here.

### DECISION 2 — tool name `list_members` (not canonically pinned)

The PRD addendum (§C) fixed FIELD SHAPES, not the full 12-tool NAME list, so the directory tool's exact name is not contract-pinned. **Decision: name it `list_members`** — parallels `list_projects` (the established read-tool naming), takes a `project_id`, returns the member directory. If the user/architecture prefers `get_board_directory` or another name, it is a rename only. Document the choice; the reviewer may flag.

### Source facts (verified at story creation, baseline `ff48833`)

- **Identity projection (Epic 2, `packages/core/src/identity/projection.ts`):** `foldIdentities(events): Map<handle, Identity>`; `Identity { handle, currentFocus, createdAt, lastSeen }` — `lastSeen` is the derived `createdAt` of the identity's latest event by `seq` (advances on registered/focus_updated/seen). This is the per-member focus + last-seen the directory surfaces. (`identity.seen` has no MCP consumer until Story 6.1, so in V1 `last_seen` advances via register/`update_focus` — distinct focuses give distinct last_seens for the test.)
- **Projects projection (Story 3.1, `projection.ts`):** `findProject(events, projectId): Project | undefined`; `Project.members: string[]` in join order, announcer first, de-duped. This is the membership list to iterate.
- **Error model:** `BOARD_NOT_FOUND` exists (Story 3.3) — reuse for the unknown-board read. `NO_IDENTITY` for no-session.
- **Wire helpers:** `identity-shared.ts` `identityToWire` → `{ handle, current_focus, created_at, last_seen }`; a member entry is `{ handle, current_focus, last_seen }` (no `created_at` needed, though including it is harmless). Reuse the field convention; do not invent a second snake_case rename.
- **Tool/read patterns:** `list_projects` (`tools/list-projects.ts`) is the closest template — session-required read, empty-ish schema, `{ items: [...] }` envelope. `list_members` adds a `project_id` param.
- **Integration harness:** `list-projects.integration.test.ts` / `join-board.integration.test.ts` — real `Client` + `InMemoryTransport` + real `createDataAccess`; register identities, call tools, assert results + out-of-band ledger.

### Project Structure Notes

- New `core` file `packages/core/src/projects/board-directory.ts` + test; new tool `packages/mcp-server/src/tools/list-members.ts` + integration test; barrel + `server.ts` edits; possibly a small `memberToWire` in `project-shared.ts` or reuse `identity-shared`.
- core depends only on the DataAccess port; the tool is thin.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4] — directory returns handle/current-focus/last-seen computed from the stream; stale members distinguishable (UI greys out).
- [Source: _bmad-output/planning-artifacts/architecture.md] — FR8 directory with last-seen; "staleness is a derived display value" (~line 268); "Identity/directory/last-seen — latest values folded from identity + last-seen events" (~line 249); board-wide open read (FR9).
- [Source: packages/core/src/identity/projection.ts] — `foldIdentities`/`Identity` (consumed).
- [Source: packages/core/src/projects/projection.ts] — `findProject`/`Project.members` (consumed).
- [Source: packages/mcp-server/src/tools/list-projects.ts, identity-shared.ts] — the read-tool + wire patterns to mirror.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Full gate (final): lint ✓ (`eslint .`), typecheck ✓ (`tsc --noEmit -p tsconfig.typecheck.json`), test ✓ **315 passed / 49 files** (`vitest run`), build ✓ (`pnpm -r build`, 7 projects), format ✓ (`prettier --check .`).
- One pre-existing manifest test (`server.bootstrap.test.ts`) legitimately broke because the registered tool surface grew by `list_members`; updated the expected sorted tool list (and its comment) to include `list_members`. Not a regression — the test pins the exact surface, which intentionally changed.
- New tests green in isolation: core `board-directory.test.ts` (4) + mcp-server `list-members.integration.test.ts` (4) = 8.

### Completion Notes List

- **Task 1 (core `boardDirectory`):** `packages/core/src/projects/board-directory.ts`. Reads `eventsSince(0)` once; `findProject` → `undefined` ⇒ `BoardError('BOARD_NOT_FOUND')`; else `foldIdentities` once and joins membership against it, emitting `{ handle, currentFocus, lastSeen }` for each handle in `project.members` (join order, announcer first). Both folds REUSED, not duplicated. Pure read — no append.
- **DECISION 1 honored:** core returns each member's derived `lastSeen` (ISO-8601) and does NOT compute a `stale` boolean (no clock/threshold in core). Pinned by a unit assertion + the integration assertion (`m` has no `stale` property).
- **Edge (member with no folded identity):** SKIPPED rather than fabricated (no phantom `{ '', '' }` row). Documented in the source why — an absent row is an observable, non-fabricating signal that would surface an upstream bug; a blank-focus phantom would mask it. Not reachable in V1 (join requires a registered session).
- **Task 2 (`list_members` tool):** `packages/mcp-server/src/tools/list-members.ts` — thin, session-required (`session.handle === null` → `NO_IDENTITY`), NO membership check (open read). Zod `{ project_id: projectIdSchema }` reused from `project-shared.ts`. Delegates to `core.boardDirectory`; envelope `{ members: [...] }` in `structuredContent` + JSON `text` block. Registered in `server.ts` (after `join_board`).
- **DECISION 2 honored:** tool named `list_members` (parallels `list_projects`, `project_id` param). Not contract-pinned — a reviewer may rename to e.g. `get_board_directory` (rename-only). Documented in the tool header.
- **Wire helper reuse:** added `MemberWire` + `memberToWire` to `identity-shared.ts` (the owner of the identity wire convention) rather than inventing a second snake_case rename — a member entry is a subset of `IdentityWire` (`{ handle, current_focus, last_seen }`, no `created_at`).
- **Rule 3 (real-runtime) SATISFIED:** AC #5 integration test exercises a real `Client`↔`McpServer` over `InMemoryTransport` + real `createDataAccess` SQLite ledger — A announces+updates focus, B joins+updates a DIFFERENT focus, C (member of neither) reads `list_members` and sees both A and B in join order with correct `handle`/`current_focus`/`last_seen`; plus unknown board → `BOARD_NOT_FOUND` and no-session → `NO_IDENTITY`, and the discovery-surface shape (`project_id` required).
- **Rule 3 (installed `.d.ts`) on `structuredContent`:** kept the verified-object envelope `{ members: [...] }` consistent with `list_projects` (which documents the SDK check that `structuredContent` is an object, not a bare array).
- 🚫 Left ALL changes uncommitted per the stage instruction — the lead commits after the per-story smoke gate.

### File List

- `packages/core/src/projects/board-directory.ts` (new)
- `packages/core/src/projects/board-directory.test.ts` (new)
- `packages/core/src/index.ts` (barrel: export `boardDirectory` + `DirectoryMember`)
- `packages/mcp-server/src/tools/list-members.ts` (new)
- `packages/mcp-server/src/tools/list-members.integration.test.ts` (new)
- `packages/mcp-server/src/tools/identity-shared.ts` (added `MemberWire` + `memberToWire`)
- `packages/mcp-server/src/server.ts` (register `list_members`)
- `packages/mcp-server/src/server.bootstrap.test.ts` (manifest: add `list_members` to expected tool surface)

### Review Findings

Code review (bmad-code-review, 2026-05-31, baseline `ff48833`). Three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) run against the uncommitted changeset. **Clean review — 0 decision-needed, 0 patch, 0 defer, 3 dismissed as noise.** No HIGH/MED findings; no auto-resolved fixes; no `deferred-work.md` entries.

Verification performed:
- Build green (`pnpm -r build`, 7 projects) — cross-package barrel freshness per Rule 2 confirmed before running consumer tests.
- Targeted suite green: `board-directory.test.ts` (4) + `list-members.integration.test.ts` (4) + `server.bootstrap.test.ts` = 14 passed.
- Scrutiny (a)–(h) all satisfied: membership ⋈ identity JOIN reads `project.members` (join order, announcer first) joined against a single `foldIdentities` fold (neither fold duplicated); DECISION 1 honored (core returns derived `lastSeen`, no `stale` boolean, no `Date.now()`/clock in core); `current_focus`/`last_seen` reflect the LATEST folded values (focus-update unit test pins `reviewing pr` over `announcing`, integration pins per-member `last_seen` against `eventsByActor` out-of-band); unknown board → `BOARD_NOT_FOUND` as a pure read (fake-DA mutators throw, proving no append); open read verified (non-member `cleo` reads both members) with `NO_IDENTITY` mirroring `list_projects`; tool is thin (session gate + delegate + wire map only); the "member with no folded identity" edge SKIPS rather than fabricating `{ '', '' }` and is genuinely unreachable in V1 (every `board.joined` actor is a registered handle via the tool's identity gate), so it masks no current bug; `memberToWire` reuses `IdentityWire`'s exact field names (`current_focus`/`last_seen`) — no second snake_case rename.
- Rule 1 (Integration AC): SATISFIED — AC #5 is a genuine cross-projection round-trip over a real `Client`↔`McpServer` + real `createDataAccess` SQLite ledger, not a stub.
- Rule 3 (real-runtime): SATISFIED — `list_members` is user-facing; AC #5 exercises the full real stack (no SDK mock), verified passing.
- Rule 5 (NFR tripwire): N/A — DECISION 1 (staleness = UI display value) is the spec's own intent (architecture "staleness is a derived display value"), not a worked-around NFR.
- Rule 6 (ADR): N/A — no `docs/adr/` registry.

Dismissed (noise, not defects):
1. DECISION 2 tool name `list_members` — flagged by dev as reviewer-renameable; reviewer concurs the name correctly parallels `list_projects` and is consistent. No rename.
2. Defensive skip of an identity-less member — verified unreachable in V1 and the correct non-fabricating choice; masks no current bug.
3. Two folds over one `eventsSince(0)` array — O(n), matches every other read op; no V1-scale concern.

## Change Log

| Date       | Change                                                                          |
|------------|---------------------------------------------------------------------------------|
| 2026-05-31 | Story 3.4 created by the /epic-cycle lead gate (read tool; joins projects-membership ⋈ identity projection; staleness = display value; Integration AC #5 present). Status → ready-for-dev. |
| 2026-05-31 | Dev implemented: `core.boardDirectory` (membership ⋈ identity join, BOARD_NOT_FOUND, no-`stale` per DECISION 1) + `list_members` MCP tool (session-required open read, DECISION 2 name) + `memberToWire` helper + barrel/server wiring. Tests: 4 core unit + 4 mcp-server integration (AC #5 real-runtime). Full gate green (lint/typecheck/315 tests/build/format). Status → review. |
