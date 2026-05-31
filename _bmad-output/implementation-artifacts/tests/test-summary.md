# Test Automation Summary — Story 3.3 (join_board)

QA stage of `/epic-cycle`. Judged the dev-authored coverage for Story 3.3
(`join_board` tool + `core.joinBoard` + additive `BOARD_NOT_FOUND`) and closed the
one genuine real-ledger gap. No padding added.

## Verdict

Coverage was already comprehensive across every scrutiny point. The dev suite (6 core
unit + 3 mcp-server integration) covers AC #1–#6 + NO_IDENTITY, with the integration
test running real-runtime (real `Client`↔`McpServer` over `InMemoryTransport`, real
`createDataAccess` SQLite ledger, nothing mocked) and discoverable per Rule 8.

## Coverage map (scrutiny checklist)

| Point | Status | Evidence |
|---|---|---|
| AC #3 multi-board: B is member of BOTH X and Y, real ledger | covered | `join-board.integration.test.ts` — `list_projects` asserts `x.members` AND `y.members` each `['ada','bob']` |
| AC #4 idempotent re-join: 2nd join appends nothing + success, real ledger | covered | integration: re-join `isError` falsy + `board.joined` count unchanged; unit: count stays 1 |
| AC #2 unknown board → BOARD_NOT_FOUND, nothing appended | covered + **tightened** | integration: `BOARD_NOT_FOUND` + `board.joined` count unchanged + (added) whole-ledger `maxSeq` unchanged; unit: `eventsSince(0)` length unchanged |
| AC #5 NO_IDENTITY (no session) | covered + **tightened** | integration test 2: `NO_IDENTITY` + `board.joined` count + (added) `maxSeq` unchanged |
| Announcer-first member order after a non-announcer joins | covered | order-sensitive `toEqual(['ada','bob'])` in both unit + integration |
| Non-announcer join appears (auto-join was only the announcer) | covered | B (`bob`) is a different identity on a fresh connection |
| Integration is real-runtime, no SDK mock | confirmed | real `createDataAccess` + `InMemoryTransport`, real tools/core/projection/ledger |
| Rule 8 discoverability | confirmed | both files `packages/*/src/**/*.test.ts`, matched by root vitest `include`, ran in default suite |

## Gap closed (only genuine addition — no new test cases)

Tightened the two rejected-path assertions in `join-board.integration.test.ts` to snapshot
the **whole-ledger `maxSeq`** (not only the `board.joined` count) around the
unknown-board (AC #2) and NO_IDENTITY (AC #5) calls. The brief explicitly calls for
"real ledger maxSeq unchanged"; the prior assertion (join-only count) would miss a
regression that appended a non-join event on a rejected path. `maxSeq` is on the real
`DataAccessHandle` (`packages/data-access/src/sqlite/queries.ts`), so this is a real-ledger
whole-stream guard. No new `it` blocks — existing assertions strengthened in place.

## Result

- Full workspace suite: **307 passed (47 files)** — count unchanged (assertions tightened,
  no new cases), lint + prettier clean on the edited file.

## Next steps

- Lead per-story smoke gate, then commit (QA does not commit).
