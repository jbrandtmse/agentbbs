# Test Automation Summary — Story 10.2 (extension host opens the DB + bridges to the webview)

QA stage of `/epic-cycle`. The dev stage shipped a mutation-tested happy-path proof (14 adapter
contract tests, an 8-process forked race, 9 bridge tests, a real-Electron-host harness). The QA
value-add closes the SEAMS the happy path skipped (the Epic-9 pattern), plus Rule-5/7/12/13
re-confirmation. Canonical gate is ROOT `pnpm test` (Rule 8 / Rule 12 corollary) — green at
146 files / 1247 tests (dev baseline 1236 + 11 new).

## Generated Tests (QA value-add)

### Adapter parity gaps — node:sqlite vs better-sqlite3
- [x] `packages/data-access/src/node-sqlite/data-access-node-sqlite.qa.test.ts` (6 tests)
  - appendGuarded MULTI-guard: all-pass inserts the whole batch in input order; the LAST guard
    trips → conflict carries THAT guard + the WHOLE batch rolls back; a FIRST-guard trip inserts
    NONE of a multi-event batch (all guards gate before any insert).
  - EMPTY guards behaves exactly like `append` (the GUARDS gate, not the events).
  - Sequence integrity across rollback (NFR10 / never reused) — a rolled-back batch leaves a clean
    strictly-monotonic continuation; the property the cross-process race leans on.
  - THE APPEND INVARIANT — total order is `seq`, never `created_at` (descending-timestamp rows
    still read back in insertion order under the adapter's seq-ASC).
  - These mirror the better-sqlite3 `append.qa.test.ts` / `append-guarded.qa.test.ts` the dev's
    node:sqlite single-guard happy-path test did not cover.

### Bridge dispatch + delta-poll seams
- [x] `apps/vscode-extension/src/bridge.qa.test.ts` (5 tests)
  - A core BoardError OTHER than ROOM_NOT_FOUND (`BODY_TOO_LARGE`, a write-op error) round-trips
    its CLOSED agent-facing code — the closed-set mapping is not special-cased to one read code.
  - A write op (`reply`) with a MISSING required arg → host-surface `BAD_REQUEST`, persists nothing.
  - Delta poll DE-DUPS: exactly one delta per advance; idle ticks push nothing; a second distinct
    event advances maxSeq with no re-send of already-pushed events.
  - No-flood-on-connect: pre-existing back-history is NOT pushed on connect (lastSentSeq seeds to
    "now" — the NFR5 pull-only / `check` no-flood posture).
  - `dispose()` is idempotent (a second call is a no-op, no throw).

## Re-confirmations against the dev's claims
- **Rule 7 (mutation, non-vacuous; all reverted byte-identical, git diff clean):**
  - Adapter atomicity: `node-sqlite/tx.ts` ROLLBACK→COMMIT → the "rolls back the ENTIRE batch" test RED.
  - Bridge no-flood: poll seed `max`→`0` → no-flood + de-dup tests RED.
  - Bridge de-dup: removed the `lastSentSeq = max` advance → de-dup test RED.
- **Rule 5 (forked race):** confirmed `node-sqlite-register-race.test.ts` forks 8 real OS processes
  (`child_process.fork` of a BUILT worker dist), IPC ready/go start barrier, one shared file ledger;
  asserts the read-side derivation (`registeredCount === 1` / exactly 1 winner + 7 HANDLE_TAKEN), not just "no error".
- **Rule 12 (real-runtime):** the `@vscode/test-electron` host harness is genuinely runnable —
  `build-host-tests.cjs` produces a real bundle that `require`s `node:sqlite` (host builtin) and
  contains ZERO `better-sqlite3` require; the launcher reads JSON out-of-band and asserts. Not a stub.
  The Electron launch itself is the lead's per-story smoke (`pnpm --filter @agentbbs/vscode-extension test:host`).
- **Rule 13 (thin client):** `git diff HEAD` on `packages/core`, `packages/mcp-server`, and the
  better-sqlite3 source is EMPTY; `db.ts`/`bridge.ts` import `@agentbbs/data-access`+`@agentbbs/core`
  only (never a driver); the bridge maps every affordance to an existing core op; no agent push path.

## Coverage
- AC1 (host opens DB via data-access): dev in-host probe + the bridge/adapter QA exercise the same handle.
- AC2 (postMessage bridge): dev happy path + QA closed-set error mapping, missing-arg guard, delta de-dup,
  no-flood-on-connect, idempotent dispose.
- AC3 (node:sqlite adapter): dev contract + race + QA multi-guard / rollback-integrity / append-invariant parity.

## Notes / Next Steps
- Tests left UNCOMMITTED in the working tree per the stage protocol (lead commits after the smoke gate).
- Known baseline flake `seed-protocol-race.test.ts` (EPERM teardown under full Windows load) did NOT
  surface this run; passes in isolation (Rule 6) — not introduced by this story.
