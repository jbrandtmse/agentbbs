# Test Automation Summary — Story 8.2 (post-step board-review cadence hook)

## Generated Tests

### Integration / Real-runtime (MCP Client ↔ McpServer over InMemoryTransport)

- [x] `packages/mcp-server/src/tools/check.cadence-post-condition.integration.test.ts`
      — Rule 3 real-runtime evidence for the cadence asset `integration/bmad/cadence-hook.toml`.
      One focused test framing the cadence hook's CENTRAL PROMISED BEHAVIOR (its `check`
      heartbeat) as Story 8.2's post-condition, over the real stack (real MCP `Client` ↔
      `createBoardServer` `McpServer` over `InMemoryTransport` + real `createDataAccess`
      better-sqlite3 ledger under `os.tmpdir()`; nothing mocked).

## Coverage (what this test pins)

The cadence hook's `persistent_facts` step 1 promises `check` is a pull-only, cursor-advancing,
bounded delta ("a quiet board needs no action; you are done in one call ... the board never
pushes"). This test proves that promise at runtime:

- **POST-CONDITION A.1 — delta on step activity:** after a workflow step produces board activity
  in the agent's scope (a new announcement in its member board + a new reply in a room it
  participates in), the agent's post-step `check` RETURNS exactly that new delta (both scopes the
  hook's review walks), and the cursor advances past the baseline.
- **POST-CONDITION A.2 — quiet review is empty, cursor UNCHANGED, no re-flood:** an
  immediately-following `check` (nothing new) returns `[]` / `[]` with the cursor unchanged —
  proving the heartbeat advanced the cursor and the same items are NOT re-flooded review after
  review. (Load-bearing pin; mutation-tested — see below.)
- **POST-CONDITION B — pull-only, no push:** the bounded-delta envelope
  `{ announcements, messages, cursor }` is what `check` RETURNS (a request→response
  `CallToolResult`), and a `fallbackNotificationHandler` counter stays at 0 across the whole
  register→join→reply→check→step-activity→check→check exchange — the board pushed nothing
  (FR35 / NFR5).

This does NOT duplicate the generic bounded-delta mechanics already covered by
`check.integration.test.ts` and `check.bounded.integration.test.ts`; it adds the Story-8.2-named
behavioral proof of the cadence's heartbeat.

## Verification

- Tool name (`check`), input (`{}`), and envelope field names (`announcements`, `messages`,
  `cursor`) verified against the live `check.ts` registration + `docs/mcp-tool-contract.md` §3/§6
  before authoring.
- Rule 7 mutation test (non-vacuity of the A.2 cursor-advance / no-re-flood pin): temporarily
  changed core `check.ts` `setCursor(actor, maxReturned)` → `setCursor(actor, cursor)` (cursor does
  not advance) → the test went RED at `expect(quiet.announcements).toEqual([])` (the quiet check
  re-flooded the step's announcements). Restored `check.ts` byte-identically (`git diff` empty).
- Discoverable by the default `pnpm test` run (Rule 8): `*.integration.test.ts` co-located under
  `packages/mcp-server/src/tools/`, not excluded, not tagged out.

## Gate (honest order, repo root, pnpm)

lint ✅ → build ✅ (7 packages) → typecheck ✅ → test ✅ **670 passed / 98 files** (was 669 after the
dev stage; +1, no regressions) → format `--check` ✅ ("All matched files use Prettier code style!").

## Next Steps

- Lead per-story smoke gate, then commit (QA leaves all changes uncommitted by design).
