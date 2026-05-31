# Test Automation Summary — Story 3.5 (Board-wide read with join-to-post gating)

QA stage of the `/epic-cycle` for Story 3.5. The dev stage already shipped strong coverage; this QA pass judged it and added ONE genuine gap (no padding).

## Dev-stage tests judged (kept as-is, all real-runtime)

### Core unit — `packages/core/src/projects/membership.test.ts` (6 tests)
- `isMember` true for announcer (auto-joined) + joined non-announcer; false for registered-not-joined + unregistered (pure, matches `Project.members`).
- `requireMembership`: member → resolves (announcer + joined non-announcer); non-member of an EXISTING board → `NOT_A_MEMBER`; unknown board → `BOARD_NOT_FOUND`; **BOARD_NOT_FOUND precedence over NOT_A_MEMBER** (the distinction is explicitly locked).
- Fake DataAccess mutators all throw, so reaching a `BoardError` proves the gate appends nothing (pure authorization).

### Integration (real Client↔McpServer + InMemoryTransport + real createDataAccess) — `packages/mcp-server/src/tools/board-read-open.fr9.integration.test.ts`
- FR9 read-open lock-in: non-member B reads BOTH `list_projects` AND `list_members` over the real transport; B provably NOT a member yet reads succeed.
- Gate-agrees-with-real-ledger: `requireMembership` run against the SAME ledger the tools wrote — member `ada` authorized, non-member `bob` → `NOT_A_MEMBER`, unknown board → `BOARD_NOT_FOUND`.

## QA-added test (the one genuine gap)

### `packages/mcp-server/src/tools/board-read-open.fr9.integration.test.ts` (+1 test)
- **Join-via-real-tool flips the gate verdict.** The dev integration cases only proved the gate authorizes the ANNOUNCER (auto-joined). The membership-acquisition path Epic 4 actually depends on — "you became a member by JOINING, so the gate now lets you post" — was untested over the real ledger. New test: B registers (gate rejects B `NOT_A_MEMBER`), B joins via the **real `join_board` tool** (appends a real `board.joined`), then `requireMembership` for the SAME handle on the SAME real ledger now **resolves**. Locks in NOT_A_MEMBER → authorized purely from a real tool-written join — the precise Epic 4 contract.

## Coverage assessment
- Gate's three outcomes (member→resolve / non-member→NOT_A_MEMBER / unknown→BOARD_NOT_FOUND): covered, incl. the BOARD_NOT_FOUND-vs-NOT_A_MEMBER distinction.
- Announcer auto-member / joined non-announcer / never-joined: covered (unit + integration, incl. join-via-real-tool).
- FR9 read-open over real transport (both read tools, non-member reader): covered.
- Gate verdict agrees with the real ledger: covered.
- `isMember` pure + matches `Project.members`: covered.
- Real-runtime (no SDK mock): all integration tests use real `createBoardServer` + `InMemoryTransport` + real `createDataAccess` (better-sqlite3). Rule 8 (discoverability): both files are co-located `*.test.ts`, matched by the root vitest glob `packages/*/src/**/*.test.{ts,tsx}`, not excluded.
- No post tool to test end-to-end (correctly deferred to Epic 4) — none invented.

## Result
- Full suite: 51 files / **324 tests pass** (+1 from the 323 dev baseline).
- Typecheck clean; ESLint clean on the modified file.
