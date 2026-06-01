---
baseline_commit: 21b2f46
---

# Story 7.0: Ratify the MCP tool contract (Epic 6 deferred — E3-tool-names DUE)

Status: done

<!-- Retro-Review gate artifact — NOT in epics.md. Created by the /epic-cycle gate. -->
<!-- Resolves the long-carried E3-tool-names + 4.5-tool-label deferrals (DUE in Epic 7 per the Epic 6 retro) + triages 1.5/1.6/5.1-roomid-cap-edge. -->

## Story

As an agent author (and as the project),
I want the now-complete ~17-tool MCP surface ratified in a single authoritative contract doc with a drift guard,
so that the agent-facing tool names, parameters, result envelopes, and the closed error-code + event vocabulary are pinned (resolving the E3-tool-names / 4.5-tool-label deferrals that have drifted since Epic 3 and reached a user-facing doc in Epic 6), and so future tool additions/renames are caught against the contract rather than silently drifting.

## Acceptance Criteria

1. **Given** the MCP server now registers 17 tools (verified: `register`, `login`, `update_focus`, `announce_project`, `list_projects`, `join_board`, `list_members`, `post_announcement`, `list_announcements`, `list_rooms`, `reply`, `read_room`, `add_participant`, `react`, `unreact`, `read_contract`, `check`),
   **When** the contract is authored,
   **Then** `docs/mcp-tool-contract.md` enumerates ALL 17 tools with — for each — its name, a one-line purpose, its input params (snake_case wire), its result envelope, and the error codes it can return, plus the CLOSED 10-code error set (`HANDLE_TAKEN`, `LOGIN_UNKNOWN`, `PROJECT_EXISTS`, `NOT_A_MEMBER`, `ROOM_NOT_FOUND`, `BOARD_NOT_FOUND`, `BODY_TOO_LARGE`, `NO_IDENTITY`, `HANDLE_NOT_FOUND`, `MESSAGE_NOT_FOUND`) and the CLOSED 10-event vocabulary, and the open-read (FR9) vs membership/participation-gated-write model,
   **And** the doc is open-source-ready (NFR8) and cross-linked from the README.

2. **Given** the contract doc must not silently drift from the code,
   **When** a DRIFT-GUARD test runs,
   **Then** it asserts the set of tool NAMES documented in `docs/mcp-tool-contract.md` EQUALS the set of tools actually registered by the server (and equals the closed `BOARD_ERROR_CODES` for the error section) — so adding/renaming a tool or error code without updating the contract FAILS the gate.

3. **Given** the remaining OPEN deferrals are out of scope,
   **When** `deferred-work.md` is reconciled,
   **Then** **E3-tool-names** is marked **RESOLVED** (this story — the contract is ratified) and **4.5-tool-label** is marked **RESOLVED** (the tool count is pinned at 17 + the drift guard),
   **And** **1.5**, **1.6**, **5.1-roomid-cap-edge** remain **OPEN** (carried — no trigger / low value),
   **And** the ledger snapshot is updated.

4. **Given** the full quality gate,
   **When** it is run in honest order,
   **Then** `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, `pnpm test`, `pnpm run format` (`--check`) are all GREEN,
   **And** the test count grows by the drift-guard test(s) (note the final count).

## Review Findings

**Code-review outcome (2026-05-31, Story 7.0):** APPROVED — clean review. 0 decision-needed, 0 patch, 0 defer, 1 dismissed (narrative nit). Reviewed proportionately (DOC + drift-guard, zero production-logic change); all directive verification points confirmed by independent audit, not by trusting QA.

1. **[Review][Verified] ZERO production-logic change — confirmed.** `git diff 21b2f46` touches only: `docs/mcp-tool-contract.md` (new), `packages/mcp-server/src/tool-contract.drift.test.ts` (new test), `README.md`, `deferred-work.md`, `sprint-status.yaml` (+ the untracked story file & lead-written `cycle-log-epic-7.md`). NO change to any `packages/*/src/**` non-test `*.ts` — the tool surface itself is untouched; this story only documents it. `server.ts` registers the same 17 tools (lines 196–212).

2. **[Review][Verified] Contract accuracy — independently spot-checked 5 tools + both closed sets, all MATCH.** Verified each against the actual Zod schema + `successResult` envelope in `packages/mcp-server/src/tools/*.ts` (and the shared wire maps in `identity-shared.ts` / `room-shared.ts`):
   - `register` → in `{ handle, current_focus }`, out `{ handle, current_focus, created_at, last_seen }` (= `identityToWire`), err `HANDLE_TAKEN`. ✓
   - `post_announcement` → in `{ project_id, subject, body }`, out `{ room }` (= `roomToWire`: `room_id, project_id, subject, body, posted_by, seq, active` + activator fields when active), err `NO_IDENTITY / BOARD_NOT_FOUND / NOT_A_MEMBER / BODY_TOO_LARGE`. ✓
   - `read_room` → in `{ room_id }`, out `{ room, messages }` (messages = `messageToWire`: `seq, actor, body, kind, reactions`), err `NO_IDENTITY / ROOM_NOT_FOUND`. ✓
   - `react` → in `{ message_seq }`, out `{ message_seq, reactions }`, err `NO_IDENTITY / MESSAGE_NOT_FOUND / NOT_A_MEMBER`. ✓
   - `check` → in `{}`, out `{ announcements, messages, cursor }` (messages add `room_id`), err `NO_IDENTITY`. ✓
   - §4 closed-code table == `BOARD_ERROR_CODES` (10, exact). §5 event table == `EVENT_TYPES` (10, exact). The access-model section (open-read FR9 / membership-gated-write / participation-gated-action / grant-on-act) matches the per-tool session gates + core delegation in the handlers.

3. **[Review][Verified] Drift guard genuinely enforces (non-vacuous) — empirically mutation-tested.** Ran each parser against the live doc AND against in-memory mutations: dropping/renaming a §6 tool name → 16≠17 (FAIL); dropping a §4 code row → 9≠10 (FAIL); dropping a §5 event row → 9≠10 (FAIL). All three set-equality assertions break on divergence. The test derives the registered set from the REAL `McpServer` via a live `Client.listTools()` over `InMemoryTransport` (Rule 3 real-runtime), not a hand-copied constant; the §4/§5 parsers are scoped to their section (heading→next `## `) and anchored on table-row `|`, so inline backticked codes/names in §3 prose and the §5 "Appended by" cells are correctly excluded. No off-by-one / no empty-or-partial silent match (the fence markers sit outside the BEGIN/END slice; duplicate-checks + hard `=== 17` / `=== 10` floors guard the vacuous case).

4. **[Review][Verified] deferred-work reconciliation + README accuracy.** E3-tool-names → RESOLVED (evidence: ratified contract + drift guard). 4.5-tool-label → RESOLVED (count pinned at 17 + drift guard; "12 tools" prose corrected). 1.5 / 1.6 / 5.1-roomid-cap-edge remain OPEN (original sections intact). Story 7.0 ledger snapshot accurate. README "these 12 tools" → count-agnostic + cross-link to `docs/mcp-tool-contract.md` + the 4 missing headline rows (`update_focus`, `list_members`, `unreact`, `read_contract`) added; stale "(the 12 tools)" tree comment made count-agnostic.

5. **[Review][Verified] Full gate (honest order) — all GREEN.** lint (`eslint .`, clean) · build (7 packages, clean) · typecheck (`tsc --noEmit`, clean) · **test 618 passed / 89 files** · format `--check` ("All matched files use Prettier code style!").

6. **[Review][Dismiss] Stale +2/617 count in the dev's Completion Notes — narrative nit, no defect.** The Dev Agent Record says "615 → 617 (+2 tests / +1 file)", but the suite is **618 (+3 tests / +1 file)** — the QA-added §5 event-vocab assertion is a third `it()` in the new drift-test file. The gate-authoritative count is 618/89 (matches QA's own report and this review's run). No code/contract impact; left the dev's historical prose unchanged to avoid churn — this Review Findings count (618/89) is the accurate durable record.

**Rules:** Rule 1 N/A (documents the existing surface; not service-introducing). Rule 3 satisfied (drift guard derives the surface from the real server via `listTools()`). Rule 4 satisfied (every documented tool fact verified against the code — the accuracy audit IS this). Rule 7 satisfied (drift guard mutation-tested non-vacuous). Rule 5 / Rule 6 N/A (no NFR amendment; no `docs/adr/`).

## Tasks / Subtasks

- [x] Task 1: Author `docs/mcp-tool-contract.md` (AC: #1)
  - [x] Enumerate the 17 tools. For each: name; one-line purpose; input params (snake_case wire — read each tool's Zod schema in `packages/mcp-server/src/tools/*.ts` to get the EXACT param names, e.g. `register{handle, current_focus}`, `post_announcement{project_id, subject, body}`, `reply{room_id, body}`, `react/unreact{message_seq}`, `read_contract{room_id}`, `check{}`); result envelope (the `structuredContent` shape, e.g. `{ projects: [...] }`, `{ room, messages }`, `{ room_id, contract|null }`, `{ announcements, messages, cursor }`); error codes it can return. Group by area (identity / projects / rooms / messaging / discovery).
  - [x] Document the CLOSED 10-code error set (from `packages/core/src/errors.ts` `BOARD_ERROR_CODES`) with one line each, and the CLOSED 10-event vocabulary (`packages/core/src/events/types.ts`), and the model: OPEN reads (any established identity, FR9 — `list_*`/`read_*`/`check`-scope), membership-GATED writes (`post_announcement`), participation-GATED actions (`add_participant`/`react`), GRANT-on-act (`reply`/`add_participant` — "acting = joining"). State the contract is the versioned public surface (adding is additive; renaming/removing is breaking).
  - [x] Include a MACHINE-READABLE canonical tool-name list (e.g. a fenced ```text block or a table column) the drift-guard test can parse. Cross-link from the README (and `docs/pull-only-delivery.md` if natural).
- [x] Task 2: Drift-guard test (AC: #2)
  - [x] Add a test (e.g. `packages/mcp-server/src/tool-contract.drift.test.ts`) that (a) reads `docs/mcp-tool-contract.md`, parses the canonical tool-name list, and asserts it EQUALS the set of tools the server registers (derive the registered set from the real `McpServer` — connect a `Client` and `listTools()`, OR reuse the canonical list the bootstrap assertion uses); and (b) asserts the documented error-code list EQUALS `BOARD_ERROR_CODES`. So any future tool/code add-or-rename without a doc update fails. Keep the parse simple + robust (a clearly-delimited block).
- [x] Task 3: Reconcile `deferred-work.md` (AC: #3)
  - [x] Mark **E3-tool-names** RESOLVED (this story — `docs/mcp-tool-contract.md` ratifies the 17-tool surface + names + envelopes + closed codes; drift-guarded) and **4.5-tool-label** RESOLVED (count pinned at 17). Keep **1.5**, **1.6**, **5.1-roomid-cap-edge** OPEN. Update the ledger snapshot.
- [x] Task 4: Full-gate verification (AC: #4)
  - [x] Run lint → build → typecheck → test → format (`--check`). All green. Note the final count (Epic 6 closed at 615).

## Dev Notes

This is the Epic-7 retro-review cleanup that RATIFIES the agent-facing MCP tool contract — the long-carried `E3-tool-names` (Epic 3 retro) + `4.5-tool-label`, now DUE (the Epic 6 retro flagged the 12→17 tool-count drift reaching a user-facing doc). It is a DOCUMENTATION + drift-guard-test story; NO new tool, event, error code, or production-logic change. The contract documents the EXISTING surface (verify each tool's params/envelope against the code — Rule 4).

**Rule 1 (Integration ACs):** N/A — not service-introducing (documents the existing surface).
**Rule 3 (real-runtime evidence):** the drift-guard test should derive the registered tool set from the REAL `McpServer` (`listTools()`) so it pins the actual runtime surface, not a hand-copy.
**Rule 4 (verify source-facts):** the 17 tool names + 10 error codes were verified at story creation; the dev re-confirms each tool's params/envelope by reading `packages/mcp-server/src/tools/*.ts` + the Zod schemas (do NOT hand-wave the envelopes).
**Rule 5 / Rule 6:** N/A (no NFR; no `docs/adr/`).

### Source facts (verified at story creation, baseline `21b2f46`)

- **17 registered tools** (from `server.bootstrap.test.ts`'s exhaustive sorted assertion + `server.ts`): register, login, update_focus, announce_project, list_projects, join_board, list_members, post_announcement, list_announcements, list_rooms, reply, read_room, add_participant, react, unreact, read_contract, check.
- **10 closed error codes** (`packages/core/src/errors.ts` `BOARD_ERROR_CODES`): HANDLE_TAKEN, LOGIN_UNKNOWN, PROJECT_EXISTS, NOT_A_MEMBER, ROOM_NOT_FOUND, BOARD_NOT_FOUND, BODY_TOO_LARGE, NO_IDENTITY, HANDLE_NOT_FOUND, MESSAGE_NOT_FOUND.
- **10 closed event types** (`packages/core/src/events/types.ts`): identity.registered, identity.focus_updated, identity.seen, project.announced, board.joined, announcement.posted, room.replied, room.participant_added, message.reacted, message.unreacted.
- **Per-tool params/envelopes** live in `packages/mcp-server/src/tools/*.ts` (each tool's Zod input schema + `successResult`/envelope). Read them for the exact wire shapes — do not infer.
- **README** has a tool-surface section to cross-link. `docs/` holds `append-invariant-checklist.md` + `pull-only-delivery.md` (Epic 6).
- Toolchain (Epics 1–6): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers).

### Project Structure Notes

- New `docs/mcp-tool-contract.md` + a README cross-link; one drift-guard test (`packages/mcp-server/src/tool-contract.drift.test.ts`). NO production-logic change, NO new tool/event/error code.
- The drift guard makes the contract SELF-ENFORCING — the bootstrap exhaustive tool-list assertion already pins the registered set; this story pins the DOC to that set so the open-source-facing contract can't silently lie.

## Dev Agent Record

### Context & approach

DOCUMENTATION + drift-guard-test story; NO production-logic change (no new tool / event / error
code / handler logic). The existing surface was re-confirmed against the code (Rule 4): every tool's
exact `snake_case` params + `structuredContent` envelope were read from each
`packages/mcp-server/src/tools/*.ts` Zod schema and `successResult` (plus the shared
`identity-shared.ts` / `project-shared.ts` / `room-shared.ts` wire mappings), the closed error set
from `packages/core/src/errors.ts` (`BOARD_ERROR_CODES`), the closed event vocabulary from
`packages/core/src/events/types.ts` (`EVENT_TYPES`), and the registered set from `server.ts` +
`server.bootstrap.test.ts`'s exhaustive sorted assertion.

### Implementation Plan (what was done)

- **Task 1 — `docs/mcp-tool-contract.md`:** authored the ratified contract. §1 the surface shape +
  a 17-row at-a-glance table; §2 the access model (open-read FR9 / membership-gated-write /
  participation-gated-action / grant-on-act "acting = joining"); §3 every tool grouped by area
  (identity / projects / rooms / messaging / discovery) with exact params, envelope, and per-tool
  error codes; §4 the CLOSED 10-code error table (one line each); §5 the CLOSED 10-event vocabulary
  + which tool appends each; §6 the MACHINE-READABLE canonical tool-name list inside
  `# AGENTBBS-TOOL-CONTRACT:BEGIN`/`END` sentinels (one bare name per line); §7 versioning/stability
  (additive-safe, rename/remove-breaking, storage-not-in-contract). NFR8 open-source-ready.
  Cross-linked from the README (and the README "12 tools" prose + stale tree comment corrected to
  17 / count-agnostic).
- **Task 2 — `packages/mcp-server/src/tool-contract.drift.test.ts`:** the drift guard. (a) Parses
  the §6 sentinel block and asserts it EQUALS the tools the REAL `McpServer` registers — derived at
  runtime by connecting a real `Client` over `InMemoryTransport` and calling `listTools()` (Rule 3
  real-runtime evidence, mirroring the bootstrap test; a throwing fake `DataAccess` since
  `listTools` never touches persistence). (b) Parses the §4 closed-code table and asserts it EQUALS
  `BOARD_ERROR_CODES` from `@agentbbs/core`. Both directions are exact set-equality (+ no-duplicate
  + a 17-floor sanity), so adding/removing/renaming a tool or error code without a doc edit FAILS
  the gate.
- **Task 3 — `deferred-work.md`:** marked **E3-tool-names RESOLVED** (Story 7.0 — contract ratified
  + drift-guarded) and **4.5-tool-label RESOLVED** (count pinned at 17 + drift guard; user-facing
  "12 tools" prose corrected). Added a Story 7.0 ledger-snapshot paragraph. **1.5**, **1.6**,
  **5.1-roomid-cap-edge** remain OPEN (untouched).
- **Task 4 — full gate:** lint → build → typecheck → test → format(`--check`), all green.

### Decisions

- **Machine-readable list = sentinel-delimited fenced `text` block** (`# AGENTBBS-TOOL-CONTRACT:
  BEGIN`/`END`, one bare tool name per line) rather than a parsed table column — the simplest,
  most robust parse target (trim + drop-blanks), resilient to surrounding prose moving (story
  Task 1 offered either; chose the block).
- **Drift test derives the registered set from the REAL server** (`Client.listTools()` over the
  in-memory transport), not a copied constant — pins the actual runtime surface (the mandatory
  Rule-3 requirement in the directive), independent of (and complementary to) the bootstrap test's
  exhaustive assertion.
- **Error-code parse is scoped to the §4 section** (between the `## 4.` heading and the next `## `)
  so the inline `NO_IDENTITY`/`ROOM_NOT_FOUND` etc. mentioned in §3 per-tool prose are NOT picked
  up — the assertion is exactly "the §4 closed-set table equals `BOARD_ERROR_CODES`".
- **README count corrected to 17 + cross-linked.** The story scope is "cross-link from the README";
  since AC #1 + the deferred ledger explicitly flag the "12 tools" user-facing drift as the thing
  4.5-tool-label resolves, the count was corrected in the same edit (added `update_focus` /
  `list_members` / `unreact` / `read_contract` to the headline table) and the stale "(the 12
  tools)" tree comment made count-agnostic.
- **Code-comment "12th/final V1 tool" mentions left as-is.** The "12"/"13" narrative in
  `server.ts` / `server.bootstrap.test.ts` comments and historical story files is internal; its
  authoritative gate (the bootstrap exhaustive assertion, now joined by the drift guard) lists all
  17 and is green. Churning them adds no value and risks noise; the drift guard is the durable
  source of truth. (The "Under construction / no code written" README banner is also historical and
  out of this story's documentation scope.)

### Completion Notes

- All 4 ACs satisfied: (1) `docs/mcp-tool-contract.md` enumerates all 17 tools with name / purpose /
  snake_case params / envelope / error codes + the closed 10-code set + closed 10-event vocabulary +
  the open-read/gated-write model, NFR8-ready, README cross-linked; (2) the drift-guard test pins
  the documented tool-name set to the live `listTools()` set AND the documented codes to
  `BOARD_ERROR_CODES`; (3) `deferred-work.md` reconciled (E3-tool-names + 4.5-tool-label RESOLVED;
  1.5/1.6/5.1-roomid-cap-edge OPEN; snapshot updated); (4) full gate green.
- **NO production-logic change** — zero `core`/`data-access`/tool-handler/`server.ts` edits; the
  append-only events ledger is untouched. Verified the parse extracts exactly the 17 names + 10
  codes (negative-evidence check) so the guard compares meaningful sets, not empty ones.
- **Final gate (honest order):** lint clean (`eslint .`, 0) · build clean (7 packages) · typecheck
  clean (`tsc --noEmit`, 0) · **test 617 passed / 89 files** (Epic 6 closed at 615; the drift guard
  added exactly +2 tests / +1 file) · format `--check` clean ("All matched files use Prettier code
  style!").

### File List

- `docs/mcp-tool-contract.md` (new) — the ratified MCP tool contract.
- `packages/mcp-server/src/tool-contract.drift.test.ts` (new) — the drift-guard test.
- `README.md` (modified) — "The MCP tool surface" section cross-linked to the contract + count
  corrected to 17; stale "(the 12 tools)" tree comment made count-agnostic.
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified) — E3-tool-names +
  4.5-tool-label marked RESOLVED (Story 7.0); ledger snapshot updated; 1.5/1.6/5.1-roomid-cap-edge
  kept OPEN.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — story
  `7-0-ratify-mcp-tool-contract` → `review`.
- `_bmad-output/implementation-artifacts/7-0-ratify-mcp-tool-contract.md` (modified) — this story
  file (Tasks/Subtasks checked, Dev Agent Record, Status → review).

### Change Log

- 2026-05-31 — Story 7.0 implemented (dev stage). Authored `docs/mcp-tool-contract.md` (the ratified
  17-tool agent-facing contract: names, snake_case params, result envelopes, closed 10-code error
  set, closed 10-event vocabulary, open-read/gated-write/grant-on-act access model, machine-readable
  canonical tool-name list, versioning policy; NFR8 open-source-ready) and a drift-guard test
  (`tool-contract.drift.test.ts`) that pins the documented tool-name list to the live
  `McpServer.listTools()` set and the documented error codes to `BOARD_ERROR_CODES`. Cross-linked
  the contract from the README and corrected the "12 tools" → 17 user-facing drift. Reconciled
  `deferred-work.md` (E3-tool-names + 4.5-tool-label RESOLVED; 1.5/1.6/5.1-roomid-cap-edge OPEN).
  NO production-logic change. Full gate green; test count 615 → 617.
