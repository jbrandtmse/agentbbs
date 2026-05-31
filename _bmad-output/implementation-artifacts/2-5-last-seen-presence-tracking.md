---
baseline_commit: b8d080cbbe4935b6694655f6e92e19589c8a1c4e
---

# Story 2.5: Last-seen presence tracking

Status: done

## Story

As the board,
I want each identity's last-seen timestamp to advance on activity,
so that stale or inactive identities are visibly distinguishable in directories (FR8).

## Acceptance Criteria

1. **Given** an identity that performs a board action (e.g. `check` or a post),
   **When** the action is processed,
   **Then** an `identity.seen` event is appended and the identity's derived last-seen reflects the latest activity time,
   **And** last-seen is computed from the event stream, never stored as a mutable column.

2. **(Integration AC — real ledger)** **Given** the `recordSeen` presence primitive against a real `createDataAccess` SQLite ledger,
   **When** a registered identity's presence is recorded one or more times,
   **Then** each call appends exactly one `identity.seen` event, the directory-derived `last_seen` advances to (equals) the latest event's `created_at` while `current_focus`/`created_at` are unchanged, and `last_seen` is only ever DERIVED (no `UPDATE`/`DELETE`, no stored `last_seen` column — the append-invariant lint guard + a real-ledger assertion both hold).

## Integration ACs

This story introduces the **`recordSeen` presence primitive** (core) and completes the `identity.seen` arm of the last-seen projection. The canonical triggers named by the architecture — `check` (a read) and posts — are **future epics**, and the Epic-2 actions that already exist (`register`, `update_focus`) advance `last_seen` through their own events, so **there is no `identity.seen`-emitting MCP tool in this epic**. Per Rule 1's escape clause: **No MCP consumers in this story; the first consumers will be Story 6.1 (`check`) and the Epic 4 post tools, which call `recordSeen` to mark presence on actions that would otherwise leave no trace.** AC #2 is the binding real-runtime proof here — it exercises the primitive against the real SQLite ledger (Rule 3 is satisfied by real-ledger evidence; no new user-facing MCP surface is added this story, so there is no MCP-tool test to write).

## Consumes

- **Story 2.2 (identity projection)** — extends the directory fold with the `identity.seen` branch (the last of the three identity event types the 2.2 projection was pre-wired for).

## Consumed-by

- **Story 6.1 (`check`)** — first MCP consumer: `check` is a read that must still advance presence, so it calls `recordSeen`. [future epic]
- **Epic 4 post tools** (`reply` / `post_announcement`) — call `recordSeen` (or rely on their own posted event) to mark presence. [future epic]
- **Epic 3 directory (Story 3.4)** — surfaces `last_seen` per member (FR8) using this derived value.

## Tasks / Subtasks

- [x] Task 1: Complete the identity projection — fold `identity.seen` (AC: #1)
  - [x] In `packages/core/src/identity/projection.ts`: add `'identity.seen'` to `IDENTITY_EVENT_TYPES` and the reducer `switch` branch (the 2.2 dev marked exactly where; sibling to 2.4's `identity.focus_updated` branch). On `identity.seen`, advance the identity's presence WITHOUT changing `currentFocus` — since `lastSeen` is already derived as the latest event's `createdAt` and the fold processes in `seq` order, the seen branch only needs to ensure the identity record's `lastSeen` reflects this event (no `currentFocus` mutation). Keep `createdAt` (registration time) unchanged.
  - [x] An `identity.seen` for a handle with no prior `identity.registered` mints NO phantom identity (same IGNORE stance as Story 2.4 `identity.focus_updated`). Pin it with a unit test.
- [x] Task 2: `recordSeen` presence primitive in `core` (AC: #1, #2)
  - [x] Implement `recordSeen(dataAccess, handle): Promise<Identity>`: append exactly one `identity.seen` event (`actor: handle`, `payload: { handle }`) via plain `append` (no uniqueness guard — presence pings are not unique-constrained), then return the updated identity via `findIdentity(await dataAccess.eventsByActor(handle), handle)`. The returned `last_seen` is the new event's `created_at`; `current_focus`/`created_at` unchanged.
  - [x] Export `recordSeen` from the core barrel (beside `register`/`login`/`updateFocus` in `identity/`).
  - [x] `IdentitySeenPayload` already exists (`{ handle }`); wire mapping already handles it. Do NOT invent a payload field.
- [x] Task 3: Tests (AC: #1, #2)
  - [x] Unit: projection folds `identity.seen` → `lastSeen` advances to the latest seen event's `createdAt`, `currentFocus` and `createdAt` unchanged; interleaving `registered` → `focus_updated` → `seen` folds to the correct latest `lastSeen` and latest `currentFocus`; `seen`-before/without-`registered` mints no identity; ordering is by `seq` not `created_at` (same-`createdAt`/higher-`seq` wins).
  - [x] Integration (real `createDataAccess` SQLite ledger, Rule 3 evidence): register `H`, then `recordSeen(H)` one or more times → each appends exactly one `identity.seen`; the derived `last_seen` advances (monotonic non-regression) and equals the latest event's `created_at`; `current_focus`/`created_at` stay put; the prior `identity.registered`/`identity.focus_updated` rows are retained (append-only — assert the event count grows by exactly 1 per `recordSeen`); there is NO `last_seen` column anywhere (assert the only table is the `events` ledger / no schema drift).
  - [x] Rule 8: tests `*.test.ts`, default-discovered.
- [x] Task 4: Full-gate verification — build FIRST (cross-package tests resolve `@agentbbs/core` via built `dist/`), then `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run format` all green; no regression to the existing baseline (234 tests before this story; it grows).

## Review Findings

Code review (2026-05-31, `bmad-code-review` under `/epic-cycle`). Reviewed against the 2 ACs + the stage directive's critical checks. Three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) run analytically against the diff vs baseline `b8d080c`.

**Gate (build-first, per directive):** `pnpm run build` clean → `pnpm run lint` clean → `pnpm run typecheck` clean → `pnpm test` **259 passed / 38 files** (matches the expected suite size; no regression; the pre-existing `boundary-enforcement.test.ts` cold-start flake did NOT recur this run).

**Critical-check verdict — all PASS:**
- **`last_seen` DERIVED, never stored:** CONFIRMED. `schema.ts` defines exactly 5 append-only columns (`seq, type, actor, created_at, payload`) — no `last_seen` column anywhere; the real-ledger schema-probe test (`record-seen.integration.test.ts`) asserts the only user table is `events`, the column set is exactly those 5, `.not.toContain('last_seen')`, and no stored `identity.seen` payload carries a `last_seen` key. `recordSeen` uses plain `append` (INSERT-only, no mutation); the projection DERIVES `lastSeen` from the latest-by-`seq` event's `createdAt`. No `UPDATE`/`DELETE`/`ALTER` against the ledger (grep-confirmed across `data-access` source; lint append-invariant guard green).
- **Append-only / seq-ordering:** CONFIRMED. `recordSeen` → `dataAccess.append([...])`; the fold orders by `seq` (shared advancement takes the last-by-`seq` event's `createdAt`, never compares timestamps), pinned by the "orders by seq NOT createdAt" same-`createdAt`/higher-`seq` tests (unit + integration). Append-invariant lint guard covers `core` + `data-access`.
- **Rule 1 escape clause:** LEGITIMATE. Story declares no Epic-2 MCP consumer and names the future consumers (Story 6.1 `check`, Epic 4 post tools). Not a silent gap.
- **Rule 3:** EXEMPT — genuinely no new MCP tool (no `packages/mcp-server` changes; `recordSeen` not wired into any tool). Real-runtime evidence is the real-`createDataAccess` SQLite-ledger integration test under `os.tmpdir()`.
- **Module boundary:** CONFIRMED. `recordSeen` in `core` imports only `./projection.js` + the `DataAccess` port; the schema probe (better-sqlite3) lives in `data-access`. Core lint forbids better-sqlite3 (green).
- **Rule 6 (ADR):** N/A — no `docs/adr/` registry.

### Review Findings (triage)

- [x] [Review][Defer] `recordSeen` (and the mirrored `updateFocus`) appends an orphan event BEFORE the fail-loud guard throws on an unregistered handle [packages/core/src/identity/record-seen.ts:56] — deferred LOW, logged to deferred-work.md. **Judgment:** the orphan-append-then-throw is intentional and tested (mirrors Story 2.4 `updateFocus` exactly, per the Dev Notes; pinned by the unit + integration "still APPENDS exactly one orphan" tests). The path is UNREACHABLE in V1 (both ops are only ever called with a registered/established session handle; `recordSeen` has no consumer at all this story). The orphan is benign (the fold mints no phantom; it corrupts nothing). NOT auto-resolved because the clean fix (guard-before-append) must be applied to BOTH `recordSeen` and `updateFocus` as a class — fixing only `recordSeen` would break the deliberate symmetry, force rewriting the orphan-append QA tests, and leave the identical wart in `updateFocus`. Same shape as the Story 1.6 `wireToPayload` defensive-hardening deferral. Folded to the Epic 2 retro (spans 2.4 + 2.5).

**No `decision-needed` or `patch` findings.** The implementation is a clean, faithful mirror of the established `updateFocus` pattern; the projection fold is exhaustively edge-tested (seq-vs-createdAt ordering, multi-ping monotonicity, multi-identity isolation, three-way interleaving both directions, phantom-identity IGNORE, special-char handles, real-ledger schema introspection). Story remains `done`-eligible; the single finding is a deferred LOW.

## Dev Notes

### Scope decision (lead) — why no MCP tool this story

`identity.seen` is a presence heartbeat for board actions that don't otherwise record activity. The architecture names the triggers as **`check` and posts** (architecture.md#Identity & Trust: "`last_seen` updated via an appended event on `check`/post") — both FUTURE epics. The Epic-2 actions that exist (`register`, `update_focus`) already advance `last_seen` through their own `identity.registered` / `identity.focus_updated` events (folded in Stories 2.2 / 2.4). Adding a redundant `identity.seen` to those would double-write for no gain, and inventing a `check`/`ping`/`seen` MCP tool now is Epic-6 scope creep. So this story delivers the **`recordSeen` primitive + the `identity.seen` fold** — the reusable presence mechanism — and the first MCP consumer is Story 6.1 (`check`). This is the Rule 1 escape clause (declared in Integration ACs), not a silent gap.

Do NOT wire `recordSeen` into `login` (Story 2.3 committed `login`-writes-nothing, with tests asserting `maxSeq` unchanged) or add a redundant `identity.seen` to `update_focus`.

### Architecture compliance (mandatory)

- **`last_seen` is DERIVED, never stored.** It is folded as the latest identity-event `createdAt`. An `UPDATE identities SET last_seen = …` is the explicit anti-pattern the architecture forbids — it MUST be an appended `identity.seen` event. [Source: architecture.md#Implementation Patterns (line ~436); #Identity & Trust; AR8; epics.md FR8]
- **Append-only:** `recordSeen` APPENDS `identity.seen`; never mutates/deletes. The append-invariant lint guard covers `core`. [AR9; architecture.md#Data Architecture]
- **Closed event vocabulary:** use the existing `identity.seen` type + `IdentitySeenPayload = { handle }`; do not invent. [AR9; packages/core/src/events/types.ts, payloads.ts]
- **Ordering always `seq`** (the fold derives `last_seen` from the latest-by-`seq` event, never `created_at`). [NFR10; architecture.md#Format Patterns]
- **Module boundaries:** the primitive lives in `core`; better-sqlite3 stays in data-access. [architecture.md#Structure Patterns]

### Existing surfaces to build on (verified)

- `projection.ts` is pre-wired: `IDENTITY_EVENT_TYPES` + reducer `switch` with the marker comment; 2.4 added the `identity.focus_updated` branch, this story adds the sibling `identity.seen` branch. `Identity = { handle, currentFocus, createdAt, lastSeen }`; `lastSeen` doc already anticipates `identity.seen`. [packages/core/src/identity/projection.ts]
- `IdentitySeenPayload = { handle }` (camelCase); wire stores `{ handle }`. [packages/core/src/events/payloads.ts; packages/data-access/src/mapping.ts (identity.seen branch)]
- `core.updateFocus` (Story 2.4) is the exact pattern to mirror for `recordSeen` (plain `append` + read-back via `eventsByActor`/`findIdentity`). [packages/core/src/identity/update-focus.ts]
- `DataAccess.append`, `eventsByActor`. [packages/core/src/ports.ts]

### File structure (proposed)

- `packages/core/src/identity/projection.ts` — add `identity.seen` fold (UPDATE).
- `packages/core/src/identity/record-seen.ts` — `recordSeen` primitive (NEW); export from barrel (UPDATE `index.ts`).
- Tests co-located `*.test.ts` (projection + record-seen unit; a real-ledger integration test).
- No `mcp-server` changes this story (no new tool).

### Testing standards

- Vitest, co-located, default-discovered (Rule 8). AC #2 is the real-runtime evidence: a REAL `createDataAccess` SQLite ledger under `os.tmpdir()`, not a fake — exercising `recordSeen` + the fold against the actual storage engine. Assert append-only retention, `last_seen` derivation/advancement, and the absence of any stored `last_seen` column.

### References

- [Source: epics.md#Epic 2 / Story 2.5; FR8; AR8; AR9]
- [Source: architecture.md#Identity & Trust (V1) (last_seen on check/post); #Implementation Patterns (UPDATE-vs-append anti-pattern, ~line 436); #Data Architecture; #Format Patterns]
- [Source: packages/core/src/identity/projection.ts, update-focus.ts, events/payloads.ts, ports.ts]
- [Source: packages/data-access/src/mapping.ts (identity.seen)]
- [Source: _bmad/custom/skill-rules.md] — Rules 1 (escape clause used), 2, 3 (real-ledger evidence), 8.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — Claude Code dev-story workflow.

### Debug Log References

- Baseline (parent commit `b8d080c`): full suite 234 passed (36 files). After this story: 254 passed (38 files), +20 net new (8 projection + 7 `recordSeen` unit + 5 real-ledger integration). No regressions.
- RED→GREEN evidence: `projection.test.ts` failed 6/6 new+flipped before the fold change (`identity.seen` not in `IDENTITY_EVENT_TYPES`), green after; `record-seen.test.ts` failed on missing `./record-seen.js` import, green after the primitive landed.
- Full gate (story order): `pnpm run build` (clean) → `lint` (clean) → `typecheck` (clean) → `pnpm test` (254 green) → `build` (clean) → `format` (2 test files auto-formatted via `format:write`, then `--check` clean).

### Completion Notes List

- **Task 1 (projection fold):** Added `'identity.seen'` to `IDENTITY_EVENT_TYPES` and a presence-only reducer branch (sibling to 2.4's `identity.focus_updated`). The branch is intentionally a no-op on `currentFocus`; the shared `lastSeen` advancement at the foot of the fold loop carries the latest-by-`seq` event's `createdAt`. Phantom-identity stance = IGNORE (only `identity.registered` mints), pinned by a test. **Deliberately flipped** the Story 2.2 scope-pin test (which asserted `identity.seen` did NOT yet advance `lastSeen`) — its own comment licensed this review-and-flip when 2.5 lands.
- **Task 2 (`recordSeen` primitive):** New `packages/core/src/identity/record-seen.ts`, mirroring `update-focus.ts` exactly — plain `append` of ONE `identity.seen` (`actor: handle`, `payload: { handle }`, NO uniqueness guard), then read-back via `findIdentity(await dataAccess.eventsByActor(handle), handle)`. Exported from the core barrel. Used the existing `IdentitySeenPayload = { handle }`; invented no fields. Per the scope decision: NO new MCP tool, NOT wired into `login` or `update_focus` (Rule 1 escape clause — first consumers are Story 6.1 `check` + Epic 4 post tools).
- **Task 3 (tests):** Unit (projection + `recordSeen`) live in `core` against the in-memory `DataAccess` fake (core's lint forbids importing the storage adapter). The real-ledger integration test lives in `data-access` (it needs BOTH `@agentbbs/core` and `better-sqlite3`) — `createDataAccess` under `os.tmpdir()`, asserting: exactly one `identity.seen` per call, `last_seen` advances (monotonic, equals latest event `created_at`), `current_focus`/`created_at` unchanged, append-only (+1 row/call, prior rows retained), and — via a separate read-only `better-sqlite3` probe — that the on-disk schema is the single `events` ledger with NO `last_seen` column and no `last_seen` key in any stored payload (derived, never stored).
- **Architecture compliance:** `last_seen` is DERIVED via an appended `identity.seen` event; no `UPDATE`/`DELETE`, no stored derived-state column (the append-invariant lint guard covers `core`/`data-access` source; the integration test asserts the runtime schema directly). Ordering by `seq`, never `created_at`. Module boundary intact (better-sqlite3 stays in `data-access`).
- **No NFR tripwire (Rule 5) and no ADR registry (Rule 6 N/A).**

### File List

- `packages/core/src/identity/projection.ts` (modified — added `identity.seen` to `IDENTITY_EVENT_TYPES` + presence-only reducer branch)
- `packages/core/src/identity/projection.test.ts` (modified — flipped the 2.2 scope-pin test; added the `identity.seen` fold describe block)
- `packages/core/src/identity/record-seen.ts` (new — the `recordSeen` presence primitive)
- `packages/core/src/identity/record-seen.test.ts` (new — `recordSeen` unit tests, in-memory fake)
- `packages/core/src/index.ts` (modified — export `recordSeen` from the barrel)
- `packages/data-access/src/record-seen.integration.test.ts` (new — real `createDataAccess` SQLite ledger evidence, AC #2)

## Change Log

- 2026-05-31 — Story 2.5 implemented (dev): `identity.seen` projection fold + `recordSeen` presence primitive (core), real-ledger integration evidence (data-access). No MCP tool this story (Rule 1 escape clause). Full gate green; suite 234 → 254. Status → review.
