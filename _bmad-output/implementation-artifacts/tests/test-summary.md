# Test Automation Summary — Story 3.4 (list_members)

QA stage of `/epic-cycle`. Judged the dev-authored coverage for Story 3.4
(`list_members` tool + `core.boardDirectory` — the projects-membership ⋈ identity
projection join, returning each member's `{ handle, current_focus, last_seen }`) and
closed the one genuine gap. No padding added.

## Verdict

Coverage was strong across every scrutiny point. The dev suite (4 core unit + 4
mcp-server integration) covers AC #1–#4 + the AC #5 real-runtime round-trip, with the
integration test running real-runtime (real `Client`↔`McpServer` over
`InMemoryTransport`, real `createDataAccess` SQLite ledger, nothing mocked) and
discoverable per Rule 8. One distinctness assertion (AC #2) was missing and was added.

## Coverage map (scrutiny checklist)

| Point | Status | Evidence |
|---|---|---|
| AC #1 join order announcer-FIRST then join order (not alphabetical / identity-fold order) | covered | `board-directory.test.ts` — registration order `[bob, ada]` deliberately DISAGREES with join order `[ada, bob]`; `toEqual` pins `[ada, bob]`. Integration: `members.map(handle)` `toEqual(['ada','bob'])` |
| AC #2 distinguishable last_seen — two members with DIFFERENT last_seen | covered + **gap closed** | integration NOW pins each member's `last_seen` to that member's OWN latest identity event `created_at` read out-of-band from the real ledger (`eventsByActor`), + monotonic `bob >= ada`. Previously only asserted each was a valid ISO string |
| AC #2 NO `stale` boolean emitted (DECISION 1) | covered | unit `expect(directory[0]).not.toHaveProperty('stale')`; integration `expect(m).not.toHaveProperty('stale')` per member |
| AC #1 current_focus = LATEST focus (not registration focus) | covered | unit focus-update test (`reviewing pr` replaces `announcing`); integration A+B both `update_focus` after register and the LATEST value is asserted |
| AC #3 unknown board → BOARD_NOT_FOUND, nothing appended | covered | unit (fake DA whose mutators throw → reaching BOARD_NOT_FOUND proves no append) + integration over real ledger |
| AC #4 THIRD identity (member of neither) reads successfully | covered | integration: `cleo` (member of neither board) reads both A+B; asserts cleo not in directory |
| AC #4 NO_IDENTITY with no session | covered | integration: fresh session `handle` null → `NO_IDENTITY` |
| Integration real-runtime, no SDK mock | confirmed | real `createDataAccess` (better-sqlite3) + `InMemoryTransport`, real register/announce/join/update_focus/list_members tools, core ops + both projections + ledger |
| Rule 8 discoverability | confirmed | both files `packages/*/src/**/*.test.ts`, matched by root vitest `include`, ran in the default 49-file suite |

## Gap closed (only genuine addition — no new test cases)

The story's AC #2 / AC #5 require the two members' `last_seen` to be DISTINGUISHABLE
("each last_seen reflecting that member's latest identity event (distinct…)"). The dev
integration test asserted each `last_seen` was a valid ISO string and carried no `stale`
flag, but never pinned the values as per-member distinct — a regression collapsing
`last_seen` to one shared timestamp (e.g. the board announce time) would have passed.

Strengthened the existing AC #5 round-trip `it` in `list-members.integration.test.ts`:
read each actor's latest identity event `created_at` out-of-band via the real
`dataAccess.eventsByActor(...)` and assert `members[0].last_seen === adaLatest`,
`members[1].last_seen === bobLatest`, plus the monotonic `bobLastSeen >= adaLastSeen`
(deterministic — no same-millisecond flake). This deterministically proves the directory
surfaces DISTINCT, per-member derived `last_seen` values reflecting each member's LATEST
identity event. No new `it` blocks — an existing real-runtime case strengthened in place.

## Result

- Full workspace suite: **315 passed (49 files)** — count unchanged (assertions
  strengthened in an existing case, no new file/case).
- Target files green in isolation: 4 core unit + 4 mcp-server integration = 8.

## Next steps

- Lead per-story smoke gate, then commit (QA does not commit).
