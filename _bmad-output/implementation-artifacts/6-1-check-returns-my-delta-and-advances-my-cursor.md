---
baseline_commit: b17fa21
---

# Story 6.1: Check returns my delta and advances my cursor

Status: done

## Story

As an agent,
I want `check` to return what's new for me since my last dial-in and advance my cursor,
So that I catch up cheaply without re-reading everything.

## Acceptance Criteria

1. **Given** events have been appended since my per-identity cursor,
   **When** I call `check`,
   **Then** I receive new ANNOUNCEMENTS in my sub-boards (boards I am a MEMBER of) and new MESSAGES in rooms I PARTICIPATE in, scoped to me and ordered by `seq`, and my cursor ADVANCES to the max `seq` returned (NOT to the global `maxSeq` — only to what I actually saw),
   **And** `check` also marks my presence (appends `identity.seen` — `recordSeen`, Story 2.5; this is its first consumer), so my `last_seen` advances on every dial-in.

2. **Given** I call `check` again with NO new activity,
   **When** the call runs,
   **Then** I receive an EMPTY delta and my cursor is UNCHANGED (still the max `seq` it had).

3. **Given** a message lands CONCURRENTLY with my `check` and receives a `seq` HIGHER than what my `check` returned,
   **When** it is appended,
   **Then** it is NOT skipped — because the cursor advanced only to the max `seq` I RETURNED (not the global `maxSeq`), the higher-`seq` concurrent message has `seq > cursor` on my NEXT `check` and surfaces then.

4. **Given** the per-scope "no back-history flood" floors (Story 4.6),
   **When** a NEW member/participant's first `check` runs (cursor `0`),
   **Then** they are NOT flooded with a board's/room's pre-join back-history: an announcement surfaces only if `seq > max(cursor, boardJoinSeq(board))` and a room message only if `seq > max(cursor, roomJoinSeq(room))` (the join-event `seq` is the floor — full back-history remains available on demand via `list_announcements`/`read_room`).

5. **(Integration AC — real MCP server over the real SQLite ledger.)**
   **Given** the real `McpServer` + real SQLite ledger driven by a real MCP `Client` over `InMemoryTransport`,
   **When** identity A registers, joins board B (which already has old announcements), and calls `check`,
   **Then** A's first `check` does NOT flood A with B's pre-join announcements (floor), A's `last_seen` advanced, and A's cursor advanced;
   **And** a new announcement in B and a new reply in a room A participates in are returned by A's NEXT `check` (scoped + `seq`-ordered), after which the cursor advanced and a third `check` with no new activity returns an empty delta with the cursor unchanged;
   **And** a non-registered session → `NO_IDENTITY`.

## Review Findings

**Code review verdict (2026-05-31): APPROVED — all 5 ACs satisfied with genuine real-runtime evidence; full gate GREEN end-to-end (lint 0 / build 7-7 / typecheck 0 / test 606-84 / format --check clean). 0 HIGH / 0 MED / 0 decision-needed / 0 defer-to-backlog. 1 LOW (test-count doc drift) auto-resolved inline. No new deferred items.**

Reviewed via the adversarial 3-layer protocol (Blind Hunter, Edge Case Hunter, Acceptance Auditor) + the 9 directive verification points + an independent gate re-run.

### Independent verification (the 9 directive points + the marquee invariant)

1. **THE APPEND INVARIANT — VERIFIED.** No `UPDATE events` / `DELETE FROM events` / `DROP`/`ALTER events` anywhere in the new data-access code (grep-confirmed: the only matches for those tokens are inside `cursors.ts` comments explaining why the guard is NOT tripped). The sole mutation is the `cursors` UPSERT (`INSERT … ON CONFLICT(handle) DO UPDATE SET seq = excluded.seq`) against the SEPARATE `cursors` table — the architecture-sanctioned mutable-bookkeeping exception (line 253). The append-invariant lint guard regex requires the literal `events` token after `UPDATE`/`DELETE FROM`; the UPSERT has `DO UPDATE SET seq` (no `events` token) so it is genuinely not flagged — and `pnpm run lint` ran GREEN, proving it empirically. `cursors.test.ts` proves `setCursor` appends 0 rows to `events`. `check`/`recordSeen` append ONLY `identity.seen` to `events`; everything else is the cursors table or a derived read.
2. **AC #1/#3 — cursor advances to maxReturned, NOT maxSeq — VERIFIED.** `check.ts:218-224` computes `maxReturned` as the max `seq` over `announcements ∪ messages` (or the prior `cursor` if empty), never `maxSeq()`. The forked cross-process `check-race.test.ts` GENUINELY proves AC #3 under a real write-write race: ONE checker loops `core.check` while 8 real OS processes reply to its room concurrently; it regresses (a) NO in-scope message skipped — the UNION of every returned message ∪ the quiescent drain == exactly the landed appender replies (none lost, none phantom, none duplicated); (b) cursor MONOTONIC — never moved backward across successive checks; (c) UPSERT + recordSeen consistent under contention — whole loop completed with no error, exactly one `identity.seen` per check, final stored cursor == max in-scope seq. The worker forks the BUILT `dist/check-race-worker.js` (resolving core via package `exports` → `dist`, NOT the Vitest alias) with a `beforeAll` build-if-stale (`tsc -b --force`). Genuine.
3. **AC #4 — per-scope floors — VERIFIED.** Announcements `seq > max(cursor, boardFloor)`; messages `seq > max(cursor, roomFloor)`. A non-participant room is gated out on Map membership (the room key is simply absent from `roomFloors`, so the message loop never iterates it) — NEVER `?? 0`. `boardJoinSeq` = the MIN `seq` over the actor's `board.joined` for the board (the earliest join); a non-member → `undefined`. Confirmed the load-bearing invariant: `foldProjects` derives `members` EXCLUSIVELY from `board.joined` events, and `check.ts`'s inline `boardFloors` folds the SAME `board.joined` set, so every `memberBoardId` is guaranteed to have a `boardFloor` — the defensive `?? cursor` at `check.ts:189` is genuinely unreachable.
4. **AC #2 — empty delta → cursor unchanged — VERIFIED.** `maxReturned` starts at `cursor` and only advances on a returned item; an empty delta re-writes the same value. `recordSeen` is called UNCONDITIONALLY (`check.ts:233`) regardless of an empty delta, so presence STILL pings on a no-activity check (`last_seen` advances every dial-in — correct per AC #1). Proven by `check.test.ts` "empty delta leaves the cursor unchanged" + "presence advances on every dial-in" + the integration third-check.
5. **Scope correctness — VERIFIED.** Announcements by sub-board MEMBERSHIP (`project.members.includes(actor)`); messages by room PARTICIPATION (`roomFloors` keys, derived from the actor's `room.replied` ∪ `room.participant_added`). `check.multiscope.test.ts` proves the POSITIVE union (2 member boards' announcements + 2 participated rooms' messages merged seq-ordered in ONE check) WHILE a 3rd board + its room are excluded.
6. **DataAccess interface ripple — VERIFIED.** ~21 in-memory fakes gained `getCursor`/`setCursor` (Map-backed, or `Promise.resolve(0)`/`Promise.resolve()` reject-stubs for the broken-seam fakes). Typecheck is genuinely green (the SQLite adapter `satisfies DataAccess` in `data-access.ts`; the fakes match the port). No fake silently no-ops in a way that hides a real bug — the SQLite adapter is the real impl, exercised by `cursors.test.ts` (real SQLite) + the integration + the forked race.
7. **Task 6 measurement + 3.0-b/4.6-a resolution — VERIFIED.** The contained one-pass-floor + participated-rooms-only optimization is behaviour-IDENTICAL (same MIN-`seq` floors, same strict `>`, same scope) — all 9 check unit tests + the multiscope + integration + the forked race pass against it. The measurement methodology is sound (real `createDataAccess` SQLite, busy actor, 50 timed iters/size after warm-up, median + p95). Closing 3.0-b (recordSeen double-read does not show up at V1) and 4.6-a (measured + optimization landed) with-evidence is justified. The `deferred-work.md` reconciliation is accurate (both entries + the ledger snapshot + the Epic-5 carry-forward updated consistently; the OPEN set is now 1.5, 1.6, 5.1-roomid-cap-edge, E3-tool-names, 4.5-tool-label).
8. **AC #5 (Integration AC) + NFR5 — VERIFIED.** `check.integration.test.ts` drives a real `Client`↔`McpServer`↔SQLite (nothing mocked): first-check-no-flood + post-join-in-scope, delta on new activity (scoped + seq-ordered), empty-delta-unchanged-cursor, `last_seen` advances (cross-checked via `list_members` AND the `identity.seen` count), `NO_IDENTITY`, and the no-params discovery surface. `check` PUSHES nothing — grep confirms no `notification`/`sendLoggingMessage`/`createMessage`/`elicitInput` etc. in `check.ts` (the only `push` is the `announcements.push`/`messages.push` array ops; the only `notification` token is the "introduces NO push/notification" comment). NO new event type / error code (cursor is a table; `NO_IDENTITY` reused).
9. **Full gate (honest order) — RE-RUN GREEN.** lint 0 → build 7-7 (all packages Done) → typecheck 0 → test **606 passed / 84 files** (0 failed, 0 skipped; no `.only`/`.skip`/`.todo` in the new files) → format `--check` clean. `check` is the 14th registered tool and appears in the bootstrap exhaustive sorted tool-list assertion. (606 = Epic-5 baseline 575 + 31 new it-blocks: check 9, multiscope 1, boardJoinSeq 10, cursors 7, check-race 1, check.integration 3.)

### Adversarial layers

- **Blind Hunter (diff only):** 0 correctness defects. Notes (all non-defects): the `?? cursor` fallback at `check.ts:189` is unreachable (membership ⟺ `board.joined`); the announcement loop scans all proto-rooms (the participated-rooms-only optimization applies to the message scope only — consistent with the measured perf); `getCursor` is not wrapped in `runWithRetry` (correct — WAL readers don't block on the writer; pure SELECT).
- **Edge Case Hunter (diff + project read):** 0 genuinely-unhandled edge cases. Every boundary traced is explicitly guarded or test-covered: empty stream, cursor=0 first check, non-member board, non-participant room (Map-gate not `?? 0`), seeding announcement at the room floor (strict `>`), concurrent higher-seq, maxReturned-vs-maxSeq, empty-delta, member via all four join paths (announce/join/reply-auto-join/add_participant-auto-join), re-join MIN seq, cross-board/cross-room isolation, bigint seq coercion (`toCursorSeq` guards `> MAX_SAFE_INTEGER`), UPSERT-backward (the store doesn't enforce monotonicity; `check` does, and `cursors.test.ts` pins both).
- **Acceptance Auditor (diff + spec + context):** 0 AC violations. All 5 ACs + all 5 Design decisions satisfied; mapped each to its proving test above.

### Findings

- [x] [Review][Defer→resolved-inline] **LOW · Test-count doc drift (604 → 606).** The Dev Agent Record Validation/Change Log state "604 passed" (the dev's pre-QA count: dev's own 29 + the check-race 1 = 30 over a mis-stated baseline) and the QA cycle-log says `tests_added=3` (actual QA additions are check-race + multiscope = 2 it-blocks). The measured suite is **606 passed / 84 files** (575 Epic-5 baseline + 31). Code unaffected — identical in shape to the Story 4.4 / 5.3 review test-count corrections. **Resolved inline** at this review: the Validation + Change Log figures corrected to 606 / +31; the `sprint-status.yaml` story-6-1 note set to 606. Not carried forward.

_No HIGH/MED/decision-needed findings. No new deferred items. The OPEN deferred set is unchanged (1.5, 1.6, 5.1-roomid-cap-edge, E3-tool-names → Epic 7, 4.5-tool-label cosmetic)._

## Tasks / Subtasks

- [x] Task 1: Add the stored per-identity cursor to the persistence seam (AC: #1, #2)
  - [x] In `packages/data-access/src/sqlite/schema.ts`, add a `cursors(handle TEXT PRIMARY KEY, seq INTEGER NOT NULL)` table (`CREATE TABLE IF NOT EXISTS`). This is the architecture's "per-identity stored position … legitimate bookkeeping" (line 253) — a SEPARATE mutable table; THE APPEND INVARIANT governs `events` ONLY (no `UPDATE`/`DELETE` on `events`), so an UPSERT-able `cursors` table is allowed. Add a brief comment stating this is transient per-identity bookkeeping, NOT institutional memory (NOT part of the FR32 export — see Dev Notes).
  - [x] Add to the `DataAccess` interface (`packages/core/src/ports.ts`): `getCursor(handle: string): Promise<number>` (returns `0` if unset) and `setCursor(handle: string, seq: number): Promise<void>` (UPSERT — `INSERT … ON CONFLICT(handle) DO UPDATE SET seq = excluded.seq`). Document them as the per-identity check cursor. Implement in the SQLite adapter AND in every in-memory fake / test double used by `core` tests (grep for the existing fakes — they implement `DataAccess`; add the two methods, backed by a `Map<string, number>`).
  - [x] Unit-test the adapter (data-access): `getCursor` of an unset handle → `0`; `setCursor` then `getCursor` round-trips; `setCursor` again UPSERTs (overwrites, single row); two handles independent.
- [x] Task 2: Per-board join floor (AC: #4)
  - [x] In `packages/core/src/projects/` (or alongside `roomJoinSeq`), add `boardJoinSeq(events, projectId, handle): number | undefined` = the `seq` of the actor's EARLIEST `board.joined` for that `projectId` (the per-board announcement floor — the analogue of Story 4.6's `roomJoinSeq` for rooms). `undefined` if the actor never joined. Pure fold. Export from the barrel.
  - [x] Unit-test: a member's floor is their `board.joined` `seq`; a non-member → `undefined`; the announcer (who `board.joined` via `announceProject`) has a floor; cross-board isolation.
- [x] Task 3: Implement the `check` core op (AC: #1–#4)
  - [x] Create `packages/core/src/discovery/check.ts` (new module) exporting `check(dataAccess, actor): Promise<CheckResult>`. Steps: (1) `cursor = await dataAccess.getCursor(actor)`; (2) `events = await dataAccess.eventsSince(0)` (full stream — needed to fold the actor's memberships/participations/floors; this is the per-call full-stream fold the deferred-work 3.0-b/4.6-a items asked to MEASURE — see Task 6); (3) compute the actor's member sub-boards (via `findProject`/`Project.members` — `isMember`) and participated rooms (via `roomParticipants`); (4) `announcements` = `announcement.posted`-derived proto-rooms in the actor's member boards with `seq > max(cursor, boardJoinSeq(board))`; `messages` = room messages (`room.replied`, and consider whether the seeding `announcement.posted` counts) in the actor's participated rooms with `seq > max(cursor, roomJoinSeq(room))`; both `seq`-ordered; (5) `maxReturned` = the highest `seq` across `announcements ∪ messages` (or `cursor` if both empty); (6) `await dataAccess.setCursor(actor, maxReturned)`; (7) `await recordSeen(dataAccess, actor)` (presence — its first consumer); (8) return `{ announcements, messages, cursor: maxReturned }`.
  - [x] DECISION to make + document: does `check` advance the cursor to `maxReturned` even when the delta is non-empty but the highest in-scope event is below some out-of-scope higher event? Yes — `maxReturned` is the max of what was RETURNED (in-scope), so an out-of-scope or concurrent higher-`seq` event is NOT swallowed (AC #3). Do NOT use `maxSeq()`. (Implemented: `check` advances to `maxReturned` over `announcements ∪ messages`, never `maxSeq()`; proven by the AC #3 unit test + the integration `cursor advanced to maxReturned (< maxSeq)` assertion.)
  - [x] Export `check`, `boardJoinSeq`, and the `CheckResult` type from `packages/core/src/index.ts`. Unit-test (over the in-memory fake): empty delta → cursor unchanged (AC #2); new in-scope events → returned + cursor advanced; out-of-scope events (a board I'm not a member of, a room I don't participate in) → NOT returned; the floor excludes pre-join back-history (AC #4); a concurrent higher-`seq` event appended AFTER the fold is not swallowed (simulate: cursor advances only to maxReturned, the higher event surfaces next check) (AC #3); `recordSeen` advanced `last_seen`.
- [x] Task 4: Wire the `check` MCP tool (AC: #1, #2, #5)
  - [x] Create `packages/mcp-server/src/tools/check.ts`: an EMPTY Zod input schema (`check` takes no params — it acts as the session identity, like `list_projects`), the session `NO_IDENTITY` gate, delegate to `core.check(dataAccess, actor)`, return `{ announcements: [...], messages: [...], cursor }` (wire-mapped via `roomToWire`/`messageToWire`; each message also carries its `room_id`). Register in `server.ts` + extend the exhaustive tool-list assertion in `server.bootstrap.test.ts`.
- [x] Task 5: Integration AC (AC: #5)
  - [x] Add `packages/mcp-server/src/tools/check.integration.test.ts`: real `Client`↔`McpServer` over `InMemoryTransport` + real SQLite proving AC #5 — first-check-no-flood (join a board with old announcements → first check excludes them), delta on new activity, empty delta on no activity with cursor unchanged, `last_seen` advances, `NO_IDENTITY`. Cross-check `last_seen` via `list_members`.
- [x] Task 6: MEASURE the per-call full-stream fold cost (deferred-work 3.0-b + 4.6-a) (AC: #1)
  - [x] `check` reads `eventsSince(0)` (full stream) + folds memberships/participations/floors + `recordSeen` (which itself reads the actor's stream twice — the 3.0-b guard-before-append double-read) on EVERY dial-in. MEASURE this at a representative V1 ledger size (e.g. a few hundred–few thousand events; time the `check` op over the real SQLite ledger). Record the measurement in the Dev Agent Record. DECIDE: if the cost is acceptable at V1 scale, mark deferred-work **3.0-b** and **4.6-a** RESOLVED (closed-with-evidence: measured, acceptable at V1; the indexed cursor query + small ledgers keep it cheap); if it shows up, propose the optimization (a scoped/indexed read instead of `eventsSince(0)`, or a `recordSeen` skip-guard for the verified session holder) and either apply a contained fix or re-defer with the measurement. Reconcile `deferred-work.md` accordingly. (MEASURED → applied a contained one-pass-floor + participated-rooms-only optimization; 3.0-b + 4.6-a marked RESOLVED with evidence. See Dev Agent Record.)
  - [x] Run the full gate in honest order: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final count (Epic 5 closed at 575). (All green; suite 604 passed / 82 files — +29 over the 575 baseline.)

## Dev Notes

This is the marquee Epic 6 story: `check` — the pull-only dial-in that closes the zero-relay loop (SM1). It introduces the STORED per-identity cursor (the architecture's "stored position", line 253) as a SEPARATE `cursors` bookkeeping table (the append invariant governs `events` only), composes the Story 4.6 per-room floor + a new per-board floor, and is the FIRST consumer of `recordSeen` (Story 2.5). It is also where the carried `3.0-b`/`4.6-a` per-call-fold measurement items come DUE.

**Rule 1 (Integration ACs):** AC #5 is the real-runtime Integration AC (`check` over real MCP + real SQLite — no-flood, delta, empty-delta-unchanged-cursor, presence).
**Rule 3 (real-runtime evidence):** `check` ships with the real `Client`↔`McpServer`↔SQLite test.
**Rule 4 (verify source-facts):** the Source facts (no `getCursor`/`setCursor` today; `eventsSince`/`maxSeq`; `recordSeen`; `roomJoinSeq`/`roomMessagesSince`; the schema file) were verified at story creation; the dev re-confirms.
**Rule 5 (NFR):** `check` must be a CHEAP cursor query (NFR5) and NEVER push (the pull-only contract) — Story 6.2 documents the bound + dead-letter, but 6.1 must not introduce any push/notification. The measurement (Task 6) is the NFR5 evidence.
**Rule 6 (ADR):** N/A — no `docs/adr/`.

### Design decisions (grounded at story creation, baseline `b17fa21`)

1. **The cursor is a STORED per-identity position in a SEPARATE `cursors` table** (architecture line 253 — "per-identity stored position … legitimate bookkeeping, not understanding content"; the `maxSeq()` doc and the `roomJoinSeq` barrel comment both anticipate "the stored per-identity high-water-mark"). THE APPEND INVARIANT (lint-enforced) forbids `UPDATE`/`DELETE` on the `events` table — it does NOT forbid a separate mutable `cursors` table. The cursor is transient bookkeeping, NOT institutional memory: it is NOT part of the FR32 NDJSON export (on import, cursors reset to `0` and each identity re-catches-up via the floors). This is the ONE allowed mutable store; everything else stays append-only/derived.
2. **Flood-prevention is per-scope FLOORS, not cursor-initialization.** The cursor starts at `0` and only tracks "since my last check". The "no back-history flood" guarantee comes from the per-room floor (`roomJoinSeq`, Story 4.6) + a NEW per-board floor (`boardJoinSeq`, this story): an item surfaces only if `seq > max(cursor, joinFloor)`. So a brand-new member joining a board with 100 old announcements is NOT flooded (floor = their join `seq`); they browse the back-history on demand via `list_announcements`/`read_room`. This is exactly the `seq > max(checkCursor, roomJoinSeq)` composition the Story 4.6 barrel comment forward-declared.
3. **Advance the cursor to `maxReturned` (the max `seq` actually RETURNED), NOT `maxSeq()`.** This is what makes AC #3 hold: a message that lands concurrently with (or after the fold of) my `check` and gets a higher `seq` than anything I returned is NOT swallowed — my cursor sits at `maxReturned < its seq`, so it surfaces on my next `check`. Using `maxSeq()` would skip it.
4. **`check` is the first `recordSeen` consumer** (Story 2.5 forward-declared this). Every dial-in advances `last_seen` (presence). `recordSeen`'s guard-before-append double-read (deferred-work 3.0-b) is now on this hot path — MEASURE it (Task 6).
5. **Scope:** announcements by sub-board MEMBERSHIP (`isMember`); room messages by room PARTICIPATION (`roomParticipants`). A non-member sees neither that board's announcements nor its rooms' messages in `check` (though they can still OPEN-read via `list_*`/`read_room`/`read_contract` — `check` is the scoped pull, the open reads are unscoped).

### Source facts (verified at story creation, baseline `b17fa21`)

- **`DataAccess`** (`packages/core/src/ports.ts`): `append`, `appendGuarded`, `eventsSince(cursor)` (">cursor, seq-ordered — the basis for the pull-only check delta"), `eventsByType`, `eventsByActor`, `maxSeq()` ("used to set a fresh cursor"). NO `getCursor`/`setCursor` — ADD them. Every in-memory fake implementing `DataAccess` must gain the two methods.
- **SQLite schema** (`packages/data-access/src/sqlite/schema.ts`): `CREATE TABLE IF NOT EXISTS events (...)`; the file's header states it contains ONLY `CREATE TABLE`/`CREATE INDEX`. Add the `cursors` table here. `migrate.ts` runs the schema idempotently.
- **`recordSeen`** (`packages/core/src/identity/record-seen.ts`, Story 2.5): appends one `identity.seen`; `lastSeen` derived; via `appendIdentityEventOrThrow` (the 3.0-b guard-before-append double-read). `check` is its FIRST consumer.
- **`roomJoinSeq`/`roomMessagesSince`** (`packages/core/src/rooms/join-cursor.js`, Story 4.6) — the per-room floor + the `seq > sinceSeq` filter. The barrel comment: "the consumer combines this with the stored per-identity high-water-mark as `seq > max(checkCursor, roomJoinSeq)`."
- **`isMember`/`findProject`/`Project.members`** (Story 3.x) — sub-board membership. **`roomParticipants`** (Story 4.5) — room participation. **`foldRooms`/`roomMessages`** (4.x/5.2) — the rooms + messages projections (messages carry `reactions`).
- **Wire mappers** (`packages/mcp-server/src/tools/room-shared.ts`): `roomToWire`, `messageToWire`. Reuse for the `check` envelope.
- **`NO_IDENTITY`** in `BOARD_ERROR_CODES`. NO new error code, NO new event type (the cursor is a table, not an event).
- Toolchain (Epics 1–5): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers).

### Project Structure Notes

- data-access: `sqlite/schema.ts` (+ `cursors` table), the SQLite adapter (`getCursor`/`setCursor`), the in-memory fakes. core: `ports.ts` (the two methods), `projects/` (`boardJoinSeq`), new `discovery/check.ts` (`check`). mcp-server: `tools/check.ts` + integration test; register in `server.ts`. One barrel (`packages/core/src/index.ts`).
- THE APPEND INVARIANT: `events` stays append-only (no `UPDATE`/`DELETE`); the `cursors` table is the explicit mutable-bookkeeping exception (architecture line 253) — it is NOT the events table, so the lint guard is not violated. `check` PUSHES nothing (NFR5 pull-only). `core` imports only the `DataAccess` port.

## Dev Agent Record

### Context

Implemented Story 6.1 (`check` — the marquee pull-only dial-in) end-to-end: the STORED per-identity cursor (`cursors` table — the architecture-sanctioned mutable bookkeeping exception, line 253), the per-board join floor (`boardJoinSeq`), the `check` core op (first `recordSeen` consumer), the `check` MCP tool, the Integration AC test, and the deferred-work `3.0-b`/`4.6-a` measurement. Source facts re-confirmed against the repo before coding (Rule 4): no `getCursor`/`setCursor` existed; `recordSeen` via `appendIdentityEventOrThrow` (guard-before-append double-read); `roomJoinSeq`/`roomMessagesSince` per Story 4.6; the schema header; the in-memory fakes are per-test-file object literals. No `docs/adr/` (Rule 6 N/A).

### Implementation Plan / key decisions

1. **Cursor is a STORED `cursors(handle PK, seq)` table** (data-access), SEPARATE from the append-only `events` ledger. `getCursor`/`setCursor` added to the `DataAccess` port + the SQLite adapter (`sqlite/cursors.ts`, `INSERT … ON CONFLICT(handle) DO UPDATE SET seq = excluded.seq`) + EVERY in-memory fake (Map-backed). The append-invariant lint guard targets the literal `UPDATE events`/`DELETE FROM events` only — the cursors UPSERT (`DO UPDATE SET seq …`, no `events` token) is NOT flagged (verified: `pnpm run lint` green). Cursor is transient bookkeeping, deliberately OUTSIDE the FR32 export.
2. **Flood-prevention is per-scope FLOORS, not cursor-init.** Cursor starts at 0; an item surfaces only if `seq > max(cursor, joinFloor)`. `boardJoinSeq` (new, `projects/join-cursor.ts`) is the per-board announcement floor (analogue of 4.6's `roomJoinSeq`).
3. **Advance to `maxReturned`, NOT `maxSeq()`** (AC #3) — `maxReturned` is the max `seq` over `announcements ∪ messages` actually returned, or the unchanged cursor if empty. A concurrent/out-of-scope higher-`seq` event is not swallowed.
4. **Scope:** announcements by sub-board MEMBERSHIP; messages by room PARTICIPATION. A non-participant room is gated out on the floor being `undefined` (Map-membership), NEVER `?? 0` (the Story 4.6 forward-note — that would flood). The seeding announcement is not double-surfaced as a message (a participant's room floor ≥ their join seq > the announcement seq).
5. **`check` is `recordSeen`'s first consumer** — every dial-in appends one `identity.seen` (presence; `last_seen` advances).
6. **MCP tool:** EMPTY input schema (acts as session identity, like `list_projects`), NO_IDENTITY gate, delegate to `core.check`, wire-map announcements via `roomToWire` + messages via `messageToWire` (each annotated with `room_id`, since a `check` delta spans several rooms). Registered in `server.ts`; the exhaustive tool-list assertion in `server.bootstrap.test.ts` extended (`check` is the 14th registered tool; the bootstrap exhaustive sort is the source of truth).
7. **`CheckResult.messages` carry `roomId`** (a `CheckMessage extends RoomMessage`) — a bare `RoomMessage` has no room context, and `check` returns messages across many rooms, so the room is essential. The wire envelope is built as an inferred object literal (mirrors `read-room.ts`) to satisfy the SDK `structuredContent` index-signature constraint.

### Task 6 — per-call full-stream-fold cost MEASUREMENT (deferred-work 3.0-b + 4.6-a)

Measured the `check` op (which reads `eventsSince(0)` + folds memberships/participations/floors + `recordSeen`'s guard-before-append double-read) over the REAL `createDataAccess` SQLite ledger, for a "busy" actor (member of several boards, participant in many rooms), at representative V1 sizes (50 timed iterations per size after a warm-up; throwaway harness, deleted after). Median / p95 in ms:

| ledger events | NAIVE (per-room full-stream scans) median / p95 | AFTER one-pass-floor + participated-rooms-only median / p95 |
|---|---|---|
| 200  | 1.5 / 2.5  | 1.0 / 1.9 |
| 500  | 4.0 / 7.3  | 2.1 / 4.2 |
| 1000 | 10.4 / 19.0 | 3.3 / 5.9 |
| 2000 | 42.0 / 57.5 | 6.6 / 10.8 |
| 5000 | 140.7 / 167.9 | 17.8 / 26.8 |

The naive shape (calling `boardJoinSeq`/`roomJoinSeq`/`roomMessages` once PER ROOM, each a full-stream scan) was super-linear (≈ O(rooms × events)). A **contained optimization** was applied in `check.ts`: the actor's per-board + per-room join floors are computed in ONE pass over the stream (the batched equivalent of `boardJoinSeq`/`roomJoinSeq`, which remain the canonical single-scope primitives), and the message scope folds `roomMessages` ONLY for the actor's PARTICIPATED rooms (a `Map<roomId, floor>`), never every room. This made the fold ~8× faster at 5000 events and flattened the curve. Behaviour is IDENTICAL (same MIN-seq floors, same strict `>`) — all 9 `check` unit tests + the integration test still pass.

**DECISION:** acceptable at V1 scale (a few hundred–few thousand events → ~1–18 ms median; a pull-only dial-in, not a tight loop). Marked deferred-work **3.0-b RESOLVED** (the recordSeen double-read does not show up at V1 — closed without the optional `skipGuard` fast-path) and **4.6-a RESOLVED** (measured + contained optimization landed). `deferred-work.md` reconciled (ledger snapshot + both per-story entries updated; the OPEN set is now 1.5, 1.6, 5.1-roomid-cap-edge, E3-tool-names, 4.5-tool-label). The append invariant is preserved — the floors stay DERIVED-by-query, just batched; no persisted derived position beyond the sanctioned `cursors` table.

### Validation — full gate (honest order), all green

- `pnpm run lint` — clean (the cursors UPSERT is not caught by the append-invariant guard; one `no-useless-assignment` in the integration test fixed by hoisting the setup `oldRoomId` out of its block).
- `pnpm run build` — all 7 packages Done (the forked-worker `dist` is rebuilt so they resolve the extended `DataAccess` interface).
- `pnpm run typecheck` — 0 errors (every in-memory fake + the two `satisfies Record<keyof DataAccess, …>` spies updated; the `cursors` table compile-checked via `satisfies DataAccess` in `data-access.ts`).
- `pnpm test` — **606 passed / 84 files** (Epic 5 closed at 575; +31 new it-blocks: cursors adapter 7, boardJoinSeq 10, check unit 9, check integration 3, plus the QA additions check-race 1 + check.multiscope 1). [Dev draft stated 604/82 = the pre-QA-addition count; QA then added the forked check-race + the multiscope-union test (+2), reconciled to 606/84 at the code review.] One pre-existing schema-drift assertion (`record-seen.integration.test.ts`) updated to expect the now-two-table schema (`['cursors','events']`) while still proving `last_seen` is DERIVED (no `last_seen` column, the `cursors` table is exactly `(handle, seq)`).
- `pnpm run format` (`--check`) — clean (the three new files formatted with `prettier --write`).

### Completion Notes

- All 5 ACs satisfied (incl. the AC #5 Integration AC over real `Client`↔`McpServer`↔SQLite: first-check-no-flood + post-join-in-scope, `last_seen` advances cross-checked via `list_members` + the `identity.seen` count, cursor advances, delta on new activity scoped+seq-ordered, empty-delta-unchanged-cursor, NO_IDENTITY).
- NO new event type, NO new error code (cursor is a table, not an event; NO_IDENTITY reused). `check` PUSHES nothing (NFR5 pull-only) — no notification/push introduced; the Task 6 measurement is the NFR5 "cheap cursor query" evidence.
- THE APPEND INVARIANT preserved: `events` stays append-only; the `cursors` table is the architecture-sanctioned mutable exception (line 253) and is NOT the events table (lint guard not violated).
- Changes left UNCOMMITTED for the lead's smoke gate (no `git commit`/`push`; the throwaway measurement harness was deleted; `dist/` is git-ignored).

### File List

**New:**
- `packages/data-access/src/sqlite/cursors.ts` — the per-identity check-cursor store (getCursor/setCursor over the `cursors` table)
- `packages/data-access/src/sqlite/cursors.test.ts` — cursor adapter unit tests (real SQLite)
- `packages/core/src/projects/join-cursor.ts` — `boardJoinSeq` (per-board announcement floor)
- `packages/core/src/projects/join-cursor.test.ts` — `boardJoinSeq` unit tests
- `packages/core/src/discovery/check.ts` — the `check` core op (`check`, `CheckResult`, `CheckMessage`)
- `packages/core/src/discovery/check.test.ts` — `check` unit tests (every branch incl. AC #2/#3/#4 + presence)
- `packages/mcp-server/src/tools/check.ts` — the `check` MCP tool
- `packages/mcp-server/src/tools/check.integration.test.ts` — Integration AC #5 (real MCP + real SQLite)

**Modified:**
- `packages/core/src/ports.ts` — `getCursor`/`setCursor` added to the `DataAccess` port
- `packages/core/src/index.ts` — barrel exports: `boardJoinSeq`, `check`, `CheckMessage`, `CheckResult`
- `packages/data-access/src/sqlite/schema.ts` — `cursors` table + `CURSORS_TABLE` const + header note
- `packages/data-access/src/data-access.ts` — wire `createCursorQueries` into the composed `DataAccess`
- `packages/data-access/src/index.ts` — export `createCursorQueries`/`CursorQueries`/`CURSORS_TABLE`
- `packages/mcp-server/src/server.ts` — register `check` + the Epic 6 doc block
- `packages/mcp-server/src/server.bootstrap.test.ts` — `check` added to the exhaustive tool-list assertion + comment
- `packages/data-access/src/record-seen.integration.test.ts` — schema assertion updated for the two-table schema (still proves `last_seen` is DERIVED)
- In-memory `DataAccess` fakes gained `getCursor`/`setCursor` (Map-backed / reject-stub / spy as appropriate): `packages/core/src/ports.test.ts`, `identity/{login,register,update-focus,record-seen}.test.ts`, `projects/{announce-project,join-board,list-projects,membership,board-directory}.test.ts`, `rooms/{add-participant,list-rooms,post-announcement,react,read-contract,read-room,reply}.test.ts`, `packages/mcp-server/src/{server.test.ts,server.bootstrap.test.ts,tools/login.qa.test.ts,tools/register.qa.test.ts}`
- `_bmad-output/implementation-artifacts/deferred-work.md` — 3.0-b + 4.6-a marked RESOLVED with the measurement evidence
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 6-1 → in-progress (dev stage)

### Change Log

- 2026-05-31 — Story 6.1 dev complete. Added the STORED per-identity `check` cursor (`cursors` table + `getCursor`/`setCursor`), the per-board join floor (`boardJoinSeq`), the `check` core op (first `recordSeen` consumer; advances cursor to `maxReturned`, not `maxSeq`; per-scope floors prevent pre-join flood), and the `check` MCP tool (EMPTY schema, NO_IDENTITY, pull-only). Integration AC #5 proven over real MCP + real SQLite. Measured the per-call fold cost (deferred-work 3.0-b + 4.6-a) and applied a contained one-pass-floor + participated-rooms-only optimization (~8× at 5000 ev); both items RESOLVED. Full gate green; suite 604 passed at dev (+29 over the Epic 5 baseline of 575), reconciled to 606 / 84 files at the code review after the QA additions (check-race + multiscope-union, +2). Status → review.
