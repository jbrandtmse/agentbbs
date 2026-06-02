---
baseline_commit: f53b6432a07fbf499797af54a1acc9bfac7f581b
---

# Story 3.3: Join a sub-board (single and multiple)

Status: done

## Story

As an agent,
I want to `join_board`,
so that I become a member able to post and appear in the sub-board's directory.

## Acceptance Criteria

1. **Given** an existing sub-board I have not joined,
   **When** I call `join_board` (as an established session identity, with the board's `project_id`),
   **Then** a `board.joined` event is appended for me and I appear as a member of that sub-board (the projection lists me).

2. **Given** a non-existent sub-board (`project_id` that was never announced),
   **When** I call `join_board`,
   **Then** the call is rejected with `BOARD_NOT_FOUND` (see Decision) and no event is appended.

3. **Given** I am already a member of one sub-board,
   **When** I join another (different) sub-board,
   **Then** I am simultaneously a member of multiple sub-boards (a `board.joined` exists for me on each; the projection shows me in both directories).

4. **Given** I am already a member of a sub-board,
   **When** I call `join_board` again for the SAME board,
   **Then** the call succeeds idempotently — I remain a single member (no duplicate membership), and no redundant `board.joined` is appended (see Decision).

5. **Given** no established identity for the session,
   **When** I call `join_board`,
   **Then** the call is rejected with `NO_IDENTITY` and no event is appended.

## Integration ACs

6. **Integration AC (real-runtime, Rule 3).** **Given** a real `Client`↔`McpServer` pair over `InMemoryTransport` backed by a REAL `createDataAccess` SQLite ledger, **When** identity A announces two sub-boards (X, Y), then identity B `join_board`s X, then B `join_board`s Y, **Then** B appears as a member of BOTH X and Y (verified via `list_projects` / the projection over the real ledger — X.members and Y.members each include B, with A as first member of each), AND a `join_board` for an unknown `project_id` returns `BOARD_NOT_FOUND` with nothing appended, AND a second `join_board` of X by B appends NO additional `board.joined` (idempotent) — observed out-of-band via `eventsByType('board.joined')`.

   **Consumed-by:** `joinBoard` (core) + the membership the projection derives are consumed by Story 3.4 (sub-board member directory), Story 3.5 (post gating: membership is the write gate; reply/add_participant join as a side effect in Epic 4), and the Epic 4 room tools. The membership predicate is the foundation of the NOT_A_MEMBER gate.

## Tasks / Subtasks

- [x] Task 1: Add the `BOARD_NOT_FOUND` error code (additive) (AC: #2)
  - [x] Append `'BOARD_NOT_FOUND'` to `BOARD_ERROR_CODES` in `packages/core/src/errors.ts` with a doc comment ("Referenced sub-board (project_id) does not exist — join/post against an unannounced board"). Additive; the union derives automatically.
  - [x] Add `'BOARD_NOT_FOUND'` to the `required` list in `packages/core/src/errors.test.ts` (the membership test uses `toContain`, not an exact count — additive, no break).
- [x] Task 2: Core `joinBoard` board op (AC: #1, #2, #3, #4)
  - [x] Add `packages/core/src/projects/join-board.ts`: `joinBoard(dataAccess, actor, projectId): Promise<Project>`. Read the stream (`eventsSince(0)`), `findProject(events, projectId)`: if `undefined` → throw `BoardError('BOARD_NOT_FOUND', …)` (no append). If the project exists AND `actor` is already in `project.members` → return the project unchanged (idempotent no-op, NO append — AC #4). Otherwise append ONE `board.joined` (`actor`, payload `{ projectId }`) via plain `append` (membership is not uniqueness-constrained; a benign race producing two joins is de-duped by the projection), then read the project back and return it (now including `actor` as a member).
  - [x] `actor` is a parameter (the MCP tool supplies the session handle); core stays session-agnostic (mirror `updateFocus`/`announceProject`).
  - [x] Existence check + append need NOT be a single transaction: projects are append-only and never disappear, so a board that exists at the check still exists at append (document this — it's why plain `append` after `findProject` is safe, unlike register's atomic claim).
- [x] Task 3: `join_board` MCP tool (AC: #1, #2, #4, #5)
  - [x] Add `packages/mcp-server/src/tools/join-board.ts`: thin session-required tool via `registerCoreTool`. Zod input: `{ project_id: <slug schema> }` (a non-empty, slug-charset string — add/reuse a `projectIdSchema` in `project-shared.ts`). Session precondition: `session.handle === null` → `BoardError('NO_IDENTITY', …)` (mirror `announce_project`). Delegate to `core.joinBoard(dataAccess, session.handle, project_id)`. Map the returned `Project` → snake_case wire (reuse `projectToWire`, which already surfaces `members` as a `string[]` — no extension needed). Register in `server.ts`.
- [x] Task 4: Barrel export (AC: #1)
  - [x] Export `joinBoard` from `packages/core/src/index.ts`.
- [x] Task 5: Tests (AC: all + Integration AC #6)
  - [x] Unit (core): join an existing board → member appears + exactly one board.joined; unknown board → `BOARD_NOT_FOUND` + nothing appended; multi-board membership (join X then Y → member of both); idempotent re-join (already a member → no second board.joined, success). Use a faked DataAccess that records appends.
  - [x] Integration (mcp-server, real `Client`↔`McpServer` + real `createDataAccess`): the AC #6 round-trip (A announces X,Y; B joins both → member of both via list_projects/projection; unknown board → BOARD_NOT_FOUND; idempotent re-join appends nothing) + `NO_IDENTITY` (no session).
  - [x] Rule 8: co-located `*.test.ts`, discoverable.
- [x] Task 6: Full gate — lint, typecheck, test, build, format all green; note the count.

## Dev Notes

Service-introducing: adds the `join_board` tool, the `joinBoard` core op, and the `BOARD_NOT_FOUND` error code — the membership primitive every later board-write gate (NOT_A_MEMBER, Story 3.5 + Epic 4) builds on. The projection already derives `members` (Story 3.1); this story is the WRITE side that populates it for non-announcers.

- **Rule 1 (Integration ACs):** SATISFIED — AC #6 proves the announce→join→member round-trip + the unknown-board + idempotency edges over the real ledger; `Consumed-by` names Stories 3.4/3.5 + Epic 4.
- **Rule 3 (real-runtime):** `join_board` is user-facing → AC #6's real-runtime test is mandatory.
- **Rule 5/6:** N/A.

### DECISION 1 — error code for an unknown sub-board: add `BOARD_NOT_FOUND` (not reuse `ROOM_NOT_FOUND`)

The epic AC says "a clear error (e.g. `ROOM_NOT_FOUND`/board-not-found)". **Decision: add a new additive `BOARD_NOT_FOUND` code rather than overload `ROOM_NOT_FOUND`.** Rationale: a *sub-board* (a project) and a *room* (an announcement/thread within a board, Epic 4) are DISTINCT concepts in this product; Epic 4 introduces real rooms with their own `ROOM_NOT_FOUND`. Conflating "board not found" with `ROOM_NOT_FOUND` now would muddy the public error contract exactly when Epic 4 needs the room semantics clean. Adding a code is additive and safe (the error-map passes any `code` through; the error-code test uses `toContain`, not an exact count). If the user/architecture prefers strictly reusing `ROOM_NOT_FOUND`, that's a one-line change — but the precise code is the better default and is what the AC's "board-not-found" alternative signals.

### DECISION 2 — re-join is an idempotent no-op (no duplicate `board.joined`)

Membership is a STATE, not a presence ping (contrast `identity.seen`, which is meant to repeat). **Decision: `joinBoard` short-circuits when the actor is already a member — returns success WITHOUT appending a second `board.joined`** (AC #4). Keeps the ledger clean and makes "am I a member" unambiguous. The projection ALSO de-dups defensively (a stray double-join from a race stays one member), so correctness does not depend on the short-circuit — but the short-circuit avoids ledger bloat from repeated joins. (Append-only is preserved: we simply do not append a redundant event; nothing is mutated or deleted.)

### Source facts (verified at story creation, baseline `f53b643`)

- **Projection (`packages/core/src/projects/projection.ts`):** `Project.members: string[]` already derived from `board.joined` (announcer first, de-duped, phantom joins ignored). `findProject(events, projectId)` returns the folded project or `undefined` — the existence check `joinBoard` needs. `foldProjects`/`listProjects` already surface members.
- **Error model (`packages/core/src/errors.ts`):** closed `BOARD_ERROR_CODES` with `toContain`-style test (additive-safe). `NO_IDENTITY` present. No `BOARD_NOT_FOUND` yet — Task 1 adds it.
- **Wire helper (`packages/mcp-server/src/tools/project-shared.ts`):** `projectToWire` maps Project → `{ project_id, title, description, announcer }` — CHECK whether it already includes `members`; the join result should surface the member list so the caller sees they joined. Extend if needed (boundary plumbing only).
- **Patterns:** core write op with a domain-error throw = `announceProject` (minus the uniqueness guard — joinBoard uses plain `append` after an existence check). Session-required thin tool = `announce_project`/`update_focus`. Read-back-via-projection = `announceProject`. Integration harness = `announce-project.integration.test.ts` / `list-projects.integration.test.ts`.
- **`DataAccess`:** `eventsSince(0)` (seq-ordered full read), `append(events)` (plain append, returns seqs). No appendGuarded needed here.

### Project Structure Notes

- New `core` file `packages/core/src/projects/join-board.ts` + test; new tool `packages/mcp-server/src/tools/join-board.ts` + integration test; edits to `errors.ts`/`errors.test.ts`, `index.ts` barrel, `server.ts`, and possibly `project-shared.ts` (members in wire).
- core depends only on the DataAccess port; the tool stays thin (Zod + session check + delegate + wire map).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3] — join_board ACs (existing board → board.joined + member; non-existent → clear error; multi-board membership).
- [Source: _bmad-output/planning-artifacts/architecture.md] — FR6 membership, FR7 multi-board, #Error shape (closed additive codes), §7 thin tools.
- [Source: packages/core/src/projects/projection.ts] — `findProject`/`Project.members` (the consumed projection).
- [Source: packages/core/src/projects/announce-project.ts, packages/mcp-server/src/tools/announce-project.ts] — the core-op + thin-tool patterns to mirror.
- [Source: packages/core/src/errors.ts, errors.test.ts] — additive error-code pattern.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — `/bmad-dev-story` under `/epic-cycle`.

### Debug Log References

- One expected additive break: `server.bootstrap.test.ts` asserts the EXACT registered-tool list; adding `join_board` to the factory tripped it. Updated the expected list (additive, not a regression) — the test exists to catch silent surface drift, so updating it is the correct response.
- One prettier-only fix on `join-board.integration.test.ts` (auto-formatted via `prettier --write`); no logic change.

### Completion Notes List

- **DECISION 1 honored:** added `BOARD_NOT_FOUND` as a new additive code in `BOARD_ERROR_CODES` (NOT a reuse of `ROOM_NOT_FOUND`), and added it to the `toContain`-based `required` list in `errors.test.ts` — additive, no exact-count break. Sub-board (project) and room (Epic 4) stay distinct error contracts.
- **DECISION 2 honored:** `joinBoard` short-circuits when `actor` is already in `project.members` — returns the project unchanged, NO redundant `board.joined` appended (AC #4). Verified by unit test (re-join keeps bob's join count at 1) AND the integration test (re-join leaves `eventsByType('board.joined')` unchanged). The projection's de-dup is the defensive backstop; the short-circuit avoids ledger bloat.
- **Plain `append` vs atomic claim:** `joinBoard` does existence-check (`findProject` over `eventsSince(0)`) then plain `append` — NOT one transaction, unlike `announceProject`'s `appendGuarded`. Documented in the source: projects are append-only / never disappear (so existence holds through the append), and membership is not uniqueness-constrained (a benign concurrent double-join is de-duped by the projection), so no atomic guard is needed.
- **Wire `members` already surfaced:** `projectToWire` already returns `members: string[]` (Story 3.1) — no extension needed. The join result's `structuredContent.members` shows the caller they joined (announcer first), verified in the integration test.
- **`projectIdSchema` added to `project-shared.ts`:** non-empty, length-bounded, slug-charset (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) — matches `slugify`'s output exactly (verified against `core/src/projects/slug.ts`), so the boundary only ever hands core a well-formed id; an unknown-but-well-formed id is the `BOARD_NOT_FOUND` case core owns.
- **Rule 3 (SDK `.d.ts`):** no new SDK surface — reused the existing `registerCoreTool` / `registerTool` path already verified in Epic 2; confirmed against the in-repo helper types. AC #6 real-runtime test passes against a real `Client`↔`McpServer` + real `createDataAccess` SQLite ledger.
- **Full gate (Task 6):** build ✓, typecheck ✓, lint ✓, **test 307 passed (47 files)** ✓, format ✓. (Up from 298 at 3.2 review; +9 new tests: 6 core unit + 3 mcp-server integration.)

### File List

- `packages/core/src/errors.ts` (modified — added `BOARD_NOT_FOUND`)
- `packages/core/src/errors.test.ts` (modified — added `BOARD_NOT_FOUND` to required)
- `packages/core/src/projects/join-board.ts` (new — `joinBoard` op)
- `packages/core/src/projects/join-board.test.ts` (new — core unit tests)
- `packages/core/src/index.ts` (modified — barrel-export `joinBoard`)
- `packages/mcp-server/src/tools/project-shared.ts` (modified — `projectIdSchema` + `PROJECT_ID_MAX_LENGTH`)
- `packages/mcp-server/src/tools/join-board.ts` (new — `join_board` tool)
- `packages/mcp-server/src/tools/join-board.integration.test.ts` (new — AC #6 integration test)
- `packages/mcp-server/src/server.ts` (modified — register `join_board`)
- `packages/mcp-server/src/server.bootstrap.test.ts` (modified — expected tool list += `join_board`)

### Review Findings

**Code review (2026-05-31, baseline `f53b643`) — CLEAN.** 0 decision-needed, 0 patch, 0 defer, 1 dismissed as noise. Three adversarial lenses (Blind Hunter / Edge Case Hunter / Acceptance Auditor) found no correctness defect, no AC gap, and no rule violation. Full gate re-verified green by the reviewer: build ✓, typecheck ✓, lint ✓, **test 307 passed (47 files)** ✓.

Scrutiny checklist (all confirmed):
- (a) **Existence-check-then-plain-`append` is correct.** Projects are append-only and never disappear (no TOCTOU window); membership is not uniqueness-constrained (a benign concurrent double-join is de-duped by the projection at `projection.ts:101`), so no `appendGuarded` / spanning transaction is needed. Reasoning is documented in `join-board.ts` (the module header + inline comments contrast it with `announceProject`'s atomic dual guard).
- (b) **Idempotent re-join genuinely appends nothing AND returns success** — the `existing.members.includes(actor)` short-circuit returns the unchanged project before any `append`. Verified by core unit (`board.joined` count stays 1) and integration (`eventsByType('board.joined')` unchanged across the re-join).
- (c) **Unknown board → `BOARD_NOT_FOUND`, whole-ledger untouched** — integration snapshots BOTH `eventsByType('board.joined')` length AND `maxSeq()` before the rejected call and asserts both unchanged (catches an append of ANY type, not just a join).
- (d) **`BOARD_NOT_FOUND` added cleanly** — appended to `BOARD_ERROR_CODES`; the `errors.test.ts` required-list uses `toContain` (not an exact-count guard), so additive; the no-duplicate test still holds; `error-map.ts` passes any `BoardError.code` through verbatim (no special-casing).
- (e) **`NO_IDENTITY` mirrors the established pattern** — `session.handle === null` → `BoardError('NO_IDENTITY')` before any delegate call, identical to `announce_project`/`update_focus`.
- (f) **Tool is thin** — Zod boundary schema + session precondition + delegate + wire map; no board logic in the handler.
- (g) **`projectIdSchema` matches `slugify` output exactly** — regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` with `.min(1)` is precisely `slugify`'s non-empty output shape (verified against `core/src/projects/slug.ts`), so the boundary only ever hands core a well-formed id; an unknown-but-well-formed id is the `BOARD_NOT_FOUND` path core owns. `PROJECT_ID_MAX_LENGTH = PROJECT_TITLE_MAX_LENGTH` is sound (an id derived from a title is never longer than the title).
- (h) **Announcer stays first member after a non-announcer joins** — `announceProject` appends the announcer's `board.joined` atomically with `project.announced`, and the projection accretes members in `seq` order, so `members` is `[announcer, …joiners]`. Verified by integration: X.members and Y.members each `['ada','bob']`.

**Rule 3 (real-runtime):** SATISFIED — AC #6's integration test drives a real `Client`↔`McpServer` over `InMemoryTransport` backed by a real `createDataAccess` SQLite ledger in an OS temp dir; nothing is mocked. Rules 5/6: N/A (no NFR tripwire; no ADR registry).

- [x] [Review][Dismiss] `joinBoard` issues two full-stream `eventsSince(0)` reads (existence check + read-back) — dismissed as noise: intentional, documented, mirrors `announceProject`'s read-back pattern, and is V1-appropriate at current ledger scale. Project-wide pattern, not a story-3.3 regression; no `deferred-work.md` entry warranted.

## Change Log

| Date       | Change                                                                          |
|------------|---------------------------------------------------------------------------------|
| 2026-05-31 | Story 3.3 created by the /epic-cycle lead gate (service-introducing; adds BOARD_NOT_FOUND; Integration AC #6 present, consumers 3.4/3.5/Epic 4). Status → ready-for-dev. |
| 2026-05-31 | Dev complete: `join_board` tool + `core.joinBoard` op + additive `BOARD_NOT_FOUND`. Idempotent re-join no-op (DEC 2), plain append after existence check (no atomic claim), `projectIdSchema` (slug) at the boundary. Full gate green — 307 tests (47 files), +9 new (6 core unit + 3 integration). Status → review. |
