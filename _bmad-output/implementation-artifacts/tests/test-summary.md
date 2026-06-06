# Test Automation Summary — Story 11.1 (Operator CLI scaffold)

QA stage: `qa-generate-e2e-tests`. Date: 2026-06-06.

## Generated Tests

### Real-runtime CLI spawn test (Rule 3)

- [x] `packages/cli/src/bin-spawn.e2e.test.ts` — spawns the BUILT `agentbbs` bin
  (`packages/cli/dist/index.js`) as a real `node` child process and asserts on real
  stdout, stderr, and the real process exit code. 7 tests:
  - built bin exists (root gate builds dist first)
  - `--help` → usage listing export/import/ui on **stdout**, exit **0**, stderr empty
  - no args → usage on **stdout**, exit **0**
  - unknown command → `Unknown command` + usage on **stdout**, exit **1** (AC2)
  - `export` recognized → inert "not yet implemented" + "Story 11.2" on **stderr**,
    **stdout empty**, exit **1** (AC3 marquee)
  - `import` recognized → inert message + "Story 11.3" on **stderr**, stdout empty, exit 1 (AC3)
  - `export --db <path> out.ndjson` → seam parsed, body still inert (stderr, exit 1)

## Why the spawn test (gap it closes)

The dev's `index.test.ts` injects a `write` sink and reads `process.exitCode` in-process —
correct and fast, but it structurally cannot prove: (1) the REAL process exit code (the
`process.exitCode = 1` side effect only becomes a real non-zero exit when the node process
exits), and (2) STREAM ROUTING — that the AC2 unknown-command path lands on **stdout** while
the AC3 export/import inert scaffold lands on **stderr** (the unit tests inject one sink per
call, so they cannot witness two paths on different real streams). The spawn test is the
appropriate Rule-3 real-runtime evidence for a CLI surface and mirrors the
spawn-the-real-binary pattern used by the mcp-server connection test.

## Mutation verification (Rule 7)

Marquee assertion spot-checked non-vacuous: temporarily changed `exportCommand`'s default
sink from `process.stderr` to `process.stdout`, rebuilt, and confirmed the spawn test went
**RED** (`expected '' to match /not yet implemented/i` — the stderr assertions failed because
the message moved to stdout). Reverted `export.ts` **byte-identically** (`git diff` empty),
rebuilt, test green again. The stream-routing distinction is genuinely guarded.

## AC coverage

- **AC1** (usage lists export/import/ui, --help/-h exit 0): unit (`index.test.ts`) + spawn.
- **AC2** (unknown → error + exit 1, on stdout): unit + spawn.
- **AC3** (export/import recognized, inert stderr message + exit 1, distinct from AC2): unit
  + spawn (the spawn test adds the real stdout/stderr separation + real exit code).
- **AC5** (operator-only — export/import/ui NOT MCP tools): covered at the correct layer by
  the existing `packages/mcp-server/src/tool-contract.drift.test.ts` (line 220 asserts the
  live `listTools()` set EXACTLY equals the documented set — any leak goes RED) +
  `server.bootstrap.test.ts`, both green in the full run. The CLI never imports the MCP
  server, so no genuine gap exists in the CLI package; a redundant CLI-side assertion would
  not strengthen the source-of-truth pin. NOT added (no gold-plating).

## Discoverability (Rule 8)

`bin-spawn.e2e.test.ts` is a `.test.ts` co-located under `packages/cli/src/`, matched by the
root `agentbbs` node project's `include` (`packages/*/src/**/*.test.{ts,tsx}`), not in the
`exclude` (which is `*.test.tsx` DOM files only), and `git check-ignore` confirms it is not
gitignored. Collected by the canonical ROOT `pnpm test`.

## Gate

Canonical ROOT `pnpm test`: **175 files / 1508 tests passed / 0 failed** (was 174/1501; +1
file, +7 tests = the spawn suite). `pnpm run build` clean. Prettier `--check` clean on the
new file. No production code changed (the mutation was reverted byte-identically).

## Scope respected

No export/import logic implemented; no `ui.ts`/core/data-access/MCP-surface change; no new
dependency. Only the one spawn test file was added.
