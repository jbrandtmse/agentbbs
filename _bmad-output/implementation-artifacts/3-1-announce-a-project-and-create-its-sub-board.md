---
baseline_commit: 4d4aa8659b37d0f9ef21e8c207ad6af640db0844
---

# Story 3.1: Announce a project and create its sub-board

Status: review

## Story

As an agent,
I want to `announce_project` with a title and description,
so that a new project sub-board exists for coordination, with me as its first member.

## Acceptance Criteria

1. **Given** a title unique on the main board,
   **When** I call `announce_project` (as an established session identity),
   **Then** a `project.announced` event is appended (carrying `project_id` slug, `title`, `description`), the sub-board exists with a slug id derived from the title (AR10), **and** a `board.joined` membership event is recorded for me (the announcer) as the first member — both events appended ATOMICALLY in one transaction.

2. **Given** a title that already exists on the main board,
   **When** I call `announce_project`,
   **Then** the call is rejected with `PROJECT_EXISTS` and **no** event is appended (neither `project.announced` nor `board.joined`) — the uniqueness check and the (would-be) insert are atomic across processes, mirroring `register`'s `appendGuarded` model.

3. **Given** no established identity for the session (neither `register` nor `login` has run),
   **When** I call `announce_project`,
   **Then** the call is rejected with `NO_IDENTITY` and no event is appended (the actor is the session handle, not a tool param — same session-precondition pattern as `update_focus`).

4. **Given** the `announce_project` tool is registered on the board MCP server,
   **When** a client inspects the tool surface (`tools/list`) and calls it with invalid input (missing/empty `title` or `description`),
   **Then** the tool advertises `snake_case` params (`title`, `description`) and invalid input is rejected by the SDK Zod validation BEFORE the core delegate runs (no event appended).

## Integration ACs

5. **Integration AC (real-runtime, Rule 3).** **Given** a real `Client`↔`McpServer` pair over `InMemoryTransport` backed by a REAL `createDataAccess` SQLite ledger (nothing mocked), **When** an established identity calls `announce_project` once and then a second time with the SAME title (and a different identity also tries the same title), **Then** the first call succeeds and the ledger holds exactly one `project.announced` (with the derived `project_id`) plus one `board.joined` for the announcer, the directory-derived project record shows the announcer as first member, and BOTH duplicate attempts fail with `PROJECT_EXISTS` having appended nothing further — observed out-of-band via the real ledger (`maxSeq` / `eventsByType`).

   **Consumed-by:** the projects projection (`foldProjects`/`findProject`) and the `announceProject` core op introduced here are consumed by Story 3.2 (`list_projects` reads the directory), Story 3.3 (`join_board` appends a second `board.joined` against an existing `project_id`, and must reject an unknown board), and Story 3.4 (sub-board member directory). The first cross-story consumer is **Story 3.2** (`list_projects`).

## Tasks / Subtasks

- [x] Task 1: Slug derivation helper (AR10) (AC: #1)
  - [x] Add a `core` slug helper (e.g. `packages/core/src/projects/slug.ts`) that derives a project/sub-board id from the title: lowercase, trim, collapse non-`[a-z0-9]+` runs to single `-`, strip leading/trailing `-`. Mirror the architecture's identifier rule ("slug of the unique project title", AR10) and the room-id convention (`calling-interface`). Keep it pure + unit-tested (empty/whitespace/punctuation/unicode-fold edge cases).
  - [x] Decide + document the slug-collision policy: AC #2 makes the **title** unique on the main board (the guard predicate), so two *different* titles that slug to the same id is the only residual collision. Simplest faithful reading: guard uniqueness on BOTH the title AND the derived `project_id` (two `appendGuarded` guards), so a slug collision from a distinct title also surfaces `PROJECT_EXISTS` rather than silently sharing a board. (A disambiguator suffix like room ids — `-2` — is NOT required by this story's ACs; if chosen instead, it must be deterministic and documented. Prefer the dual-guard reject for V1 simplicity unless the dev finds a concrete reason.)
- [x] Task 2: Core `announceProject` board op (AC: #1, #2)
  - [x] Add `packages/core/src/projects/announce-project.ts`: `announceProject(dataAccess, actor, input: { title, description }): Promise<Project>`. Derive `projectId` via the slug helper; build TWO events — `project.announced` (`actor`, payload `{ projectId, title, description }`) and `board.joined` (`actor`, payload `{ projectId }`) — and append them in ONE `appendGuarded` call with the uniqueness guard(s) from Task 1 (`{ type: 'project.announced', field: 'title', value: title }` and `{ type: 'project.announced', field: 'project_id', value: projectId }` — note the at-rest payload is snake_case, so the guard `field` is `project_id`/`title`). On a uniqueness conflict (duck-typed `UNIQUENESS_CONFLICT` discriminant, exactly like `register`), throw `BoardError('PROJECT_EXISTS', …)`. On success, read the project back through the projection and return it.
  - [x] `actor` is passed in by the caller (the MCP tool supplies the session handle) — core stays session-agnostic, mirroring `updateFocus`/`recordSeen` (the actor is a parameter, not derived in core).
  - [x] Both events share the single transaction so AC #2's "nothing appended on conflict" holds atomically.
- [x] Task 3: Projects projection (AC: #1; foundation for 3.2/3.3/3.4)
  - [x] Add `packages/core/src/projects/projection.ts`: a `Project` record (`projectId`, `title`, `description`, `announcer` handle, and `members: string[]` or at least the announcer as first member; `seq` for deterministic ordering per Story 3.2's "ordered by seq") folded from `project.announced` (+ `board.joined`) events. Provide `foldProjects(events): Map<projectId, Project>` and `findProject(events, projectId): Project | undefined`, mirroring `foldIdentities`/`findIdentity`. Fold in `seq` order (never `createdAt`). Members derive from `board.joined` events for that `projectId` (announcer is the first via the Task-2 `board.joined`).
  - [x] Keep membership-derivation minimal here (announcer as first member); Story 3.3 extends it (multiple joins) and 3.4 adds focus/last-seen — design the fold additively so those slot in without reshaping (mirror the identity projection's extension-seam note).
- [x] Task 4: `announce_project` MCP tool (AC: #1, #2, #3, #4)
  - [x] Add `packages/mcp-server/src/tools/announce-project.ts`: thin tool via `registerCoreTool`. Zod input schema (snake_case): `{ title: z.string().min(1).max(…), description: z.string().min(1).max(…) }` (add sane length caps; define a shared project-field schema if useful). Session precondition: if `session.handle === null` throw `BoardError('NO_IDENTITY', …)` (copy the `update_focus` pattern). Delegate to `core.announceProject(dataAccess, session.handle, { title, description })`. Map the returned `Project` → snake_case wire result (`project_id`, `title`, `description`, `announcer`, plus members if surfaced) in BOTH `structuredContent` and a JSON `text` block (mirror `successResult` in the identity tools).
  - [x] Register it in `packages/mcp-server/src/server.ts` (`registerAnnounceProjectTool(server, deps.dataAccess, sessionIdentity)`), alongside the identity tools, with an updated factory comment naming the Epic 3 surface.
  - [x] Add a project wire-mapping helper if the shape is reused (`projectToWire`) — boundary plumbing only, no board logic.
- [x] Task 5: Barrel exports (AC: #1)
  - [x] Export from `packages/core/src/index.ts`: `announceProject`, `AnnounceProjectInput` (type), `Project` (type), `foldProjects`, `findProject`, and the slug helper if it should be public (it can stay private to core if only `announceProject` uses it — prefer private unless a consumer needs it). **Rule 2 is superseded (Story 3.0): the Vitest `src` alias means mcp-server tests see new `core` exports without a build — but the FORKED cross-process tests still need `dist` (see project-rules.md §2 caveat). This story adds no forked-worker consumer, so no build-first is needed for its tests; still run `pnpm run build` in the final gate as the dist-artifact guard.**
- [x] Task 6: Tests (AC: all + Integration AC #5)
  - [x] Unit (core): slug helper edge cases; `announceProject` happy path (two events appended, correct payloads, returned Project), `PROJECT_EXISTS` on duplicate title (and on slug collision if dual-guarded) with nothing appended; projection fold (announcer is first member, seq-ordered).
  - [x] Integration (mcp-server, real `Client`↔`McpServer` over `InMemoryTransport` — mirror `server.bootstrap.test.ts` / the login integration test): the AC #5 round-trip against a real SQLite ledger. Also a `NO_IDENTITY` case (no session) and an invalid-input case (empty title) over the real transport.
  - [x] Ensure all tests are discoverable (co-located `*.test.ts`, matched by the root `vitest.config.ts` glob — Rule 8).
- [x] Task 7: Full gate
  - [x] `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run format` — all green. Note the final test count.

## Dev Notes

This story is **service-introducing**: it adds the first board (non-identity) MCP tool (`announce_project`), a `core` board op (`announceProject`), and the projects projection — all consumed by Stories 3.2–3.4. The Integration AC (#5) is the binding real-runtime proof.

- **Rule 1 (Integration ACs):** SATISFIED — AC #5 is an explicit Integration AC (consumer round-trip over the real transport + real ledger) with a `Consumed-by` note (first consumer Story 3.2).
- **Rule 3 (real-runtime test evidence):** the `announce_project` tool is a user-facing surface → it MUST have a real-runtime test in the QA suite (AC #5 over `InMemoryTransport` + real `createDataAccess`). The lead's per-story smoke (a real stdio MCP call) is a separate later gate.
- **Rule 5 (NFR tripwire):** none expected.
- **Rule 6 (ADR):** N/A — no `docs/adr/` registry.

### Source facts (verified at story creation, baseline `4d4aa86`)

**The lower layers are ALREADY pre-wired — this story is mostly core op + projection + thin tool:**

- **Event vocabulary** (`packages/core/src/events/types.ts`): `project.announced` and `board.joined` are already in the closed `EVENT_TYPES` tuple (positions 4–5). No vocabulary change needed.
- **Payloads** (`packages/core/src/events/payloads.ts`): `ProjectAnnouncedPayload { projectId, title, description }` and `BoardJoinedPayload { projectId }` already defined and in `EventPayloadMap`.
- **Wire mapping** (`packages/data-access/src/mapping.ts`): BOTH directions already handle `project.announced` (↔ `{ project_id, title, description }`) and `board.joined` (↔ `{ project_id }`). At-rest payload keys are snake_case (`project_id`) — this matters for the `appendGuarded` guard `field`.
- **Error code** (`packages/core/src/errors.ts`): `PROJECT_EXISTS` already in `BOARD_ERROR_CODES`. `NO_IDENTITY` also present (reused for AC #3).
- **`appendGuarded`** (`packages/core/src/ports.ts`): appends one-or-more events in ONE transaction with N data-described `UniquenessGuard`s (`{ type, field, value }`); on any guard violation it rolls back and rejects with the adapter's `UNIQUENESS_CONFLICT` (duck-typed discriminant). This is the exact primitive `register` uses — `announceProject` reuses it with project guards. Multi-event atomic append (project.announced + board.joined together) is supported (`append`/`appendGuarded` take `NewEvent[]`).

**Patterns to mirror (do NOT reinvent):**

- **Core op:** `packages/core/src/identity/register.ts` — `appendGuarded` + duck-typed `isUniquenessConflict` → `BoardError`, then read-back via projection. `announceProject` is the same shape with two events + project guards + `PROJECT_EXISTS`.
- **Projection:** `packages/core/src/identity/projection.ts` — `foldIdentities`/`findIdentity`, `seq`-ordered fold, additive extension seams. `foldProjects`/`findProject` mirror it.
- **Session-required MCP tool:** `packages/mcp-server/src/tools/update-focus.ts` — `session.handle === null → NO_IDENTITY`, actor = session handle, thin delegate via `registerCoreTool`. `announce_project` copies this.
- **Tool wiring:** `packages/mcp-server/src/server.ts` registers each tool closing over `deps.dataAccess` + the shared `sessionIdentity`. Add the new registration there.
- **Wire/result helper:** `packages/mcp-server/src/tools/identity-shared.ts` (`identityToWire`, `handleSchema`, length caps) — add a parallel `projectToWire` / project-field schema (snake_case boundary; core never sees snake_case).
- **Integration test:** `packages/mcp-server/src/server.bootstrap.test.ts` and `tools/login.integration.test.ts` — real `Client` + `InMemoryTransport`; for the real-ledger variant use `createDataAccess` over an `os.tmpdir()` DB (see `packages/data-access/src/record-seen.integration.test.ts` for the temp-DB harness).

### Identifier / slug guidance (AR10)

- Project / sub-board id = slug of the unique title (architecture.md#Identifiers, line ~349). Lowercase, `[a-z0-9]` words joined by `-`. The **title** is the uniqueness key for `PROJECT_EXISTS` (AC #2 wording: "a title that already exists"). Guard the derived `project_id` too (dual guard) so distinct-title→same-slug collisions also reject cleanly rather than two projects sharing a board id (which would corrupt the projection keyed by `projectId`). Document the chosen policy in the Dev Agent Record.

### Project Structure Notes

- New `core` subpackage dir `packages/core/src/projects/` (mirrors `identity/`): `slug.ts`, `announce-project.ts`, `projection.ts` + co-located tests. Keep cross-package imports to the barrel only.
- New `mcp-server` tool `tools/announce-project.ts` + its registration in `server.ts`.
- core depends ONLY on the DataAccess port (no storage driver); the tool is thin (Zod + map + session check), all board logic in core.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1] — ACs (unique title → project.announced + slug + board.joined first member; duplicate → PROJECT_EXISTS no event).
- [Source: _bmad-output/planning-artifacts/architecture.md] — #Identifiers (AR10 project slug, line ~349), #Naming Patterns (event vocab + snake_case wire), #Error shape (PROJECT_EXISTS), §7 thin MCP tools.
- [Source: packages/core/src/identity/register.ts] — the appendGuarded + uniqueness→BoardError pattern to mirror.
- [Source: packages/mcp-server/src/tools/update-focus.ts] — the session-required thin-tool pattern (NO_IDENTITY, actor=session).
- [Source: packages/core/src/events/payloads.ts, packages/data-access/src/mapping.ts] — pre-wired project.announced/board.joined payloads + wire mapping.
- [Source: .claude/rules/project-rules.md#2] — Rule 2 SUPERSEDED (src alias) + the forked-worker dist caveat (not triggered by this story).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Integration test (`a DIFFERENT identity … PROJECT_EXISTS`) initially red: captured `maxSeq` BEFORE the second identity's `register`, so the `identity.registered` append legitimately advanced `maxSeq` by 1 (`expected 4 to be 3`). The `announce_project` itself appended nothing — the assertion, not the code, was wrong. Fixed by capturing `maxBefore` AFTER `bob` registers, isolating the announce's (zero) effect.
- Typecheck initially red on `mcp-server` (`@agentbbs/core has no exported member announceProject / Project`). Expected per Rule 2 / Story 3.0 caveat: typecheck resolves `@agentbbs/core` via the package `exports` map → `dist` (the Vitest `src` alias is test-only). Ran `pnpm run build` (Task 5 / Task 7's dist-artifact guard) → exports visible → clean. Also fixed one genuine TS error: a narrowed-payload `as Record<string, unknown>` cast in the core unit-test fake needed `as unknown as` (the discriminated `NewEvent` payload union does not overlap a string-index record).

### Completion Notes List

- **Slug policy (Task 1 DECISION):** `slugify` is a PURE function of the title (lowercase → collapse non-`[a-z0-9]+` to `-` → strip edge `-`); it does NOT append a `-2` disambiguator. Collision handling lives in `announceProject` as a DUAL `appendGuarded` guard on BOTH `title` AND the at-rest `project_id` — so a distinct title that slugs to an existing id rejects with `PROJECT_EXISTS` rather than silently sharing a board id. Guard `field`s are the at-rest snake_case keys (`title`, `project_id`), matching `data-access/mapping.ts`.
- **Atomic two-event append (AC #1/#2):** `announceProject` appends `project.announced` + the announcer's `board.joined` in ONE `appendGuarded` call, so on a uniqueness conflict NEITHER lands (verified by maxSeq/eventsByType in both unit and integration tests).
- **Session-required thin tool (AC #3):** `announce_project` mirrors `update_focus` exactly — actor = `session.handle`; `null` → `BoardError('NO_IDENTITY')`, no append. core stays session-agnostic (actor is a parameter).
- **Wire boundary (AC #4):** snake_case params (`title`, `description`) advertised on `tools/list`; the SDK Zod validation rejects empty/missing input before the delegate (no append). Result mapped to `{ project_id, title, description, announcer, members[] }` in both `structuredContent` and a JSON `text` block; `members` is a real array (announcer first), never object-keyed.
- **Projection (Task 3):** `foldProjects`/`findProject` mirror `foldIdentities`/`findIdentity`, fold in `seq` order, carry `Project.seq` for Story 3.2's "ordered by seq", and accrete members from `board.joined` additively (Story 3.3 multi-join slots in with no reshape; an unknown-project join mints no phantom).
- **Barrel (Task 5):** exported `announceProject`, `AnnounceProjectInput`, `Project`, `foldProjects`, `findProject`. `slugify` kept PRIVATE to core (only `announceProject` consumes it) per the prefer-private guidance.
- **Rules:** Rule 3 satisfied — `announce-project.integration.test.ts` is the real-runtime evidence (real Client↔McpServer over InMemoryTransport + real `createDataAccess` SQLite ledger, nothing mocked) covering AC #5 + NO_IDENTITY + invalid-input + discovery-surface. Rule 5: no NFR tripwire hit. Rule 6: N/A (no `docs/adr/`).
- **Final gate:** `lint` clean · `typecheck` clean · `pnpm test` **287 passed / 43 files** (was 272; +15 core unit, +5 integration, −1 net from editing one bootstrap assertion to include `announce_project`) · `build` green · `format` clean.

### File List

New:
- `packages/core/src/projects/slug.ts`
- `packages/core/src/projects/slug.test.ts`
- `packages/core/src/projects/projection.ts`
- `packages/core/src/projects/projection.test.ts`
- `packages/core/src/projects/announce-project.ts`
- `packages/core/src/projects/announce-project.test.ts`
- `packages/mcp-server/src/tools/project-shared.ts`
- `packages/mcp-server/src/tools/announce-project.ts`
- `packages/mcp-server/src/tools/announce-project.integration.test.ts`

Modified:
- `packages/core/src/index.ts` (barrel: project op + projection exports)
- `packages/mcp-server/src/server.ts` (wire `registerAnnounceProjectTool`; Epic 3 factory comment)
- `packages/mcp-server/src/server.bootstrap.test.ts` (expected tool-name set now includes `announce_project`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (3-1 → in-progress → review)
- `_bmad-output/implementation-artifacts/3-1-announce-a-project-and-create-its-sub-board.md` (this story file)

## Review Findings (code review, 2026-05-31)

Reviewed the uncommitted working-tree changeset against baseline `4d4aa86` via `/bmad-code-review` (Blind Hunter / Edge Case Hunter / Acceptance Auditor layers, run analytically). The implementation is faithful and the specific-scrutiny items all check out:

- **(a) Atomicity** — VERIFIED. `project.announced` + `board.joined` share ONE `appendGuarded` call; on a tripped guard the immediate transaction rolls back and NOTHING lands. Proven against the REAL ledger (`maxSeq` unchanged, `eventsByType` lengths held) in the integration suite, plus the in-memory unit test.
- **(b) Dual-guard uniqueness** — VERIFIED. Guards on BOTH `title` and `project_id`, with `field` set to the at-rest snake_case keys (`title`/`project_id`) matching `data-access/mapping.ts`. The real-ledger `json_extract(payload, '$.project_id')` probe enforces the second guard end-to-end (distinct-title→same-slug test).
- **(c) UNIQUENESS_CONFLICT discriminant** — VERIFIED. `code === 'UNIQUENESS_CONFLICT'` duck-type matches `register.ts` exactly and the real `UniquenessConflictError.code` (`data-access/errors.ts`).
- **(d) Projection fold** — VERIFIED. Folds in `seq` order (never `createdAt`), announcer is first member, unknown-project joins mint no phantom, members de-dup, first-announcement-wins is defensive.
- **(e) NO_IDENTITY precondition** — VERIFIED. Mirrors `update-focus.ts` byte-for-byte (session.handle === null → BoardError, no append).
- **(f) Thin tool** — VERIFIED. The MCP handler holds only Zod schema + session check + delegate + wire map; all board logic in core.
- **Rule 1 / Rule 3** — SATISFIED. AC #5 is a genuine Integration AC with real-runtime evidence (real `createDataAccess` SQLite ledger + real `Client`↔`McpServer` over `InMemoryTransport`, no SDK mock).
- **Rule 5 / Rule 6** — N/A (no NFR tripwire; no `docs/adr/`).

### MED — RESOLVED inline: whitespace/punctuation-only title slugs to an empty `project_id`

- **Finding (scrutiny item (g) — "without producing an empty or unsafe id"):** `projectTitleSchema` enforced only `.min(1)` on the RAW string. A title of pure non-`[a-z0-9]` characters (`"!!!"`, `"日本語"`, whitespace) passes Zod yet `slugify` collapses it to `''`, so the FIRST such announce would succeed and mint a project with an empty, unaddressable `project_id`. The dual `project_id` guard bounds the blast radius (a SECOND empty-slug project rejects) but does not prevent the first. `slug.ts`'s own module note delegated empty-title rejection to "the MCP boundary," but the boundary did not enforce it — the code documented coverage it did not have.
- **Fix:** added a `.refine((title) => /[a-z0-9]/i.test(title), …)` to `projectTitleSchema` (`packages/mcp-server/src/tools/project-shared.ts`), mirroring `slugify`'s charset so the boundary cannot accept a title core would slug to empty. Rejection is a Zod validation error BEFORE the core delegate (consistent with AC #4). Added a real-runtime regression test (`announce-project.integration.test.ts`): a `"!!!"` title is rejected at the boundary, `maxSeq` unchanged, zero `project.announced` appended.
- **Gate after fix:** `pnpm exec vitest` (announce-project integration) 8/8 pass (was 7) · `typecheck` exit 0 · `lint` exit 0 · `format` clean.

**Triage tally:** 1 finding (MED) — resolved inline. 0 deferred · 0 dismissed · 0 decisions needed. No HIGH findings.

## Change Log

| Date       | Change                                                                          |
|------------|---------------------------------------------------------------------------------|
| 2026-05-31 | Story 3.1 created by the /epic-cycle lead gate (service-introducing; Integration AC #5 present, first consumer Story 3.2). Status → ready-for-dev. |
| 2026-05-31 | Dev implementation: slug helper + dual-guard `announceProject` (project.announced + board.joined atomic) + projects projection + session-required `announce_project` MCP tool, wired into `createBoardServer`. 14 new tests (9 core unit, 5 mcp-server integration incl. AC #5 real-runtime). Full gate green (287 tests). Status → review. |
| 2026-05-31 | QA: +2 real-runtime gap tests (dual-guard slug collision + two-event ordering over the real ledger). 289 tests green. |
| 2026-05-31 | Code review (`/bmad-code-review`): all specific-scrutiny items (a)–(f) + Rules 1/3 verified. 1 MED resolved inline — `projectTitleSchema` now `.refine`s against a slug-to-empty title (`"!!!"`/non-Latin), closing scrutiny item (g) "no empty/unsafe id"; +1 real-runtime regression test. typecheck/lint/format/targeted-test green. 0 deferred, 0 dismissed. |
