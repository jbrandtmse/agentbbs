---
baseline_commit: de152561972dfe8e1cbf8ef10963977f95894b27
---

# Story 11.1: Operator CLI scaffold

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want the `agentbbs` CLI with argument parsing and the `ui` launcher,
so that I have a single entrypoint for operator-only commands (`export`, `import`, `ui`).

## Acceptance Criteria

**From epics.md (Epic 11, Story 11.1):**

**Given** the `cli` package,
**When** I run `agentbbs` with no/invalid arguments,
**Then** it prints usage for `export`, `import`, and `ui`, and exits with a clear code,
**And** `agentbbs ui` launches the on-demand web host (Epic 9),
**And** these are operator-only commands — never exposed as MCP tools to agents.

### Refined / testable ACs

**AC1 — usage lists all three operator commands.**
**Given** the built `agentbbs` binary (or `dispatch([])` / `dispatch(['--help'])`),
**When** invoked with no command, `--help`, or `-h`,
**Then** the printed usage lists `export`, `import`, and `ui` (each with a one-line describe), and the process exits with code **0** for the explicit `--help`/`-h` help request.

**AC2 — unknown command → clear error + non-zero exit.**
**Given** `agentbbs <unknown>`,
**When** dispatched,
**Then** it writes `Unknown command: <unknown>` followed by the usage, and sets `process.exitCode = 1` (the existing dispatch contract — preserve it).

**AC3 — `export` and `import` are registered subcommands (the scaffold).**
**Given** `agentbbs export` / `agentbbs import` in THIS story,
**When** dispatched,
**Then** each is a recognized subcommand (NOT "Unknown command") whose handler is an **honest, explicitly-inert scaffold**: it writes a clear "not yet implemented — arriving in Story 11.2 (export) / 11.3 (import)" message to **stderr** and sets a clear non-zero `process.exitCode` (1),
**And** the handler establishes the command module + minimal arg-parse seam (e.g. `--db <path>` / output- or input-path positional) that Stories 11.2/11.3 fill in — mirroring the `ui.ts` `parseUiArgs` hand-rolled pattern (NO new CLI-framework dependency),
**And** the inert stubs are recorded in `deferred-work.md` with named consumers (11.2 / 11.3) so the deferred bodies are tracked (Rule 13 — a visible affordance whose op is deferred is an explicitly-recorded inert stub, never an unrecorded no-op that lies).

**AC4 — `agentbbs ui` still launches the Epic-9 host (no regression).**
**Given** `agentbbs ui [--port n] [--db path] [--as handle]`,
**When** dispatched,
**Then** it launches the on-demand web host exactly as Story 9.3/9.4 shipped (byte-identical behavior — this story does not change `ui.ts` semantics; at most it is untouched).

**AC5 — operator-only: export/import/ui are NOT MCP tools.**
**Given** the MCP server's registered tool set,
**When** the contract drift-guard (`packages/mcp-server/src/tool-contract.drift.test.ts`) and `server.bootstrap.test.ts` run,
**Then** the live `Client.listTools()` set is **unchanged** (still the 17 agent tools) — `export`, `import`, `ui` appear **nowhere** as MCP tools (architecture.md: "Operator-only; never exposed as MCP tools"). The agent contract stays byte-identical (Rule 13).

**AC6 — gate green.**
**Given** the changes,
**When** the canonical root gate runs (`pnpm run lint` · `typecheck` · `build` · `pnpm test` · `pnpm run format --check`),
**Then** all green, with new tests covering AC1–AC3/AC5, and `git diff HEAD -- packages/core packages/mcp-server/src` production-logic-clean.

## Integration ACs

This story IS service-introducing: it adds the `export`/`import` subcommand scaffold into the `@agentbbs/cli` dispatch table — the seam Stories 11.2 (export) and 11.3 (import) consume.

- **Consumed-by:** the `export` scaffold's first real consumer is **Story 11.2**; the `import` scaffold's is **Story 11.3** (they replace the inert handler body with the real logic, reusing the registered command + arg-parse seam).
- **Integration AC satisfied now (Rule 1):** AC3 is itself an integration assertion testable in THIS story — `dispatch(['export'])` / `dispatch(['import'])` produce an **observable effect** (the recognized-subcommand path: the not-yet-implemented stderr message + the non-zero `exitCode`), distinguishable from the AC2 unknown-command path. AC1 asserts the same commands surface in usage. So the producer (the scaffold) has observable, tested behavior in this story even before 11.2/11.3 fill the bodies.

## Tasks / Subtasks

- [x] **Task 1 — register `export` + `import` in the SUBCOMMANDS table** (AC: 1, 2, 3)
  - [x] Add `export` and `import` entries to `SUBCOMMANDS` in `packages/cli/src/index.ts` with a one-line `describe` each, so `usage()` lists all three (ordered sensibly: `export`, `import`, `ui`).
  - [x] Create `packages/cli/src/export.ts` and `packages/cli/src/import.ts` exporting an `exportCommand` / `importCommand` (`(argv) => Promise<void>`) that, in THIS story, writes the inert "not yet implemented (Story 11.2/11.3)" message to stderr and sets `process.exitCode = 1`. Establish a minimal `parseExportArgs` / `parseImportArgs` seam (mirror `parseUiArgs`) that 11.2/11.3 will use — at minimum the `--db <path>`/`--db=<path>` flag (delegating DB discovery to `resolveDbPath`, like `ui.ts`).
  - [x] Re-export the new command entry points from the `index.ts` barrel (so they are importable + testable, like `uiCommand`).
- [x] **Task 2 — preserve `ui` + the dispatch contract** (AC: 2, 4)
  - [x] Do NOT change `ui.ts` semantics. Confirm `dispatch` still: no-cmd/`--help`/`-h` → usage (exit 0); unknown → `Unknown command` + usage + `exitCode = 1`.
- [x] **Task 3 — assert operator-only (no MCP leakage)** (AC: 5)
  - [x] Confirm (and, if useful, add a focused test) that `export`/`import`/`ui` are NOT in the MCP tool set: the existing `tool-contract.drift.test.ts` + `server.bootstrap.test.ts` must stay green and the 17-tool set unchanged.
- [x] **Task 4 — tests + deferred-work record** (AC: 1, 2, 3, 5, 6)
  - [x] Unit tests in `packages/cli/src/index.test.ts` (or a new `dispatch.test.ts`): usage lists export/import/ui; `--help`/`-h` exit 0; unknown → exit 1; `export`/`import` recognized (not "Unknown command") + inert message + exitCode 1; `export`/`import` arg-parse seam parses `--db`.
  - [x] Record the two inert stubs in `deferred-work.md` (Story 11.1; named consumers 11.2/11.3).
- [x] **Task 5 — gate** (AC: 6)
  - [x] Full canonical root gate green; confirm contract byte-identical.

## Dev Notes

### Current state (verified this session — Rule 4)
- `packages/cli/src/index.ts` ALREADY has the subcommand dispatch: a `Subcommand` interface (`name`/`describe`/`run`), a `SUBCOMMANDS` table currently holding ONLY `ui`, a `usage(write)` that iterates the table, and an exported `dispatch(argv, write?)` that handles no-cmd/`--help`/`-h` → usage, unknown → `Unknown command: <name>` + usage + `process.exitCode = 1`, else `await command.run(rest)`. The header comment explicitly names this table as the Epic-11 export/import extension seam ("they slot in as new entries here later; this story does NOT build them"). **This story builds the scaffold entries.**
- The bin entry (`isDirectRun` guard at the bottom) runs `dispatch(process.argv.slice(2))` only when executed directly; the barrel re-exports keep the commands importable for tests. Follow that pattern for `export`/`import`.
- `packages/cli/src/ui.ts` is the model: `parseUiArgs(argv)` hand-rolls `--port`/`--db` (both `--flag v` and `--flag=v` forms; unknown flags ignored for forward-compat; invalid `--port` throws for a clear error); `uiCommand` opens the ledger via `createDataAccess` + `resolveDbPath` and delegates. **No CLI-framework dependency** — keep export/import the same (hand-rolled).
- `packages/cli/package.json` `bin` maps `agentbbs` → `./dist/index.js`. `files: ["dist"]`. The published-surface implication (npm) is Story 11.5's concern, not this story.

### What this story is NOT
- NOT the export/import LOGIC — that is Stories 11.2/11.3. The handlers here are honest inert scaffolds (clear message + non-zero exit), recorded in deferred-work with named consumers. Do NOT implement NDJSON dump/replay here.
- NOT a change to `ui.ts` behavior, core, data-access, or the MCP surface. The agent contract is byte-identical (Rule 13). No new MCP tool/event/error code.

### Architecture compliance
- [Source: architecture.md:294] "Export/import (FR32–34): operator CLI in the `cli` package — `export` dumps the logical NDJSON ledger; `import` replays into an empty board. **Operator-only; never exposed as MCP tools.**" → AC5.
- [Source: architecture.md:113] the `cli` is a distinct surface over the shared layer (NFR2 thin client — no board logic in the CLI; it dispatches to core/data-access).
- AR23 (CLI) — the `agentbbs` operator binary is the single entrypoint for operator-only commands.

### Testing standards (verified)
- Tests are `*.test.ts` co-located under `packages/cli/src/**`; canonical gate is ROOT `pnpm test` (Rule 12 — never a per-package `vitest` run). Existing CLI tests: `ui.test.ts`, `host/*.test.ts`. Add `index.test.ts` / `dispatch.test.ts` for the dispatch + scaffold behavior; inject the `write` sink and capture `process.exitCode` (reset it between cases).
- `dispatch` is already injectable (`write` param) — test usage output + exit codes without spawning a process. For the bin-level behavior, a focused unit test on `dispatch` is sufficient; a real `agentbbs --help` spawn smoke is the lead's per-story gate.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 11 — Story 11.1 (and 11.2/11.3 as the named consumers)]
- [Source: packages/cli/src/index.ts — the existing dispatch + SUBCOMMANDS seam]
- [Source: packages/cli/src/ui.ts — parseUiArgs / uiCommand pattern to mirror]
- [Source: _bmad-output/planning-artifacts/architecture.md:294, :113 — operator-only CLI, never MCP tools]
- [Source: .claude/rules/project-rules.md — Rule 13 (byte-identical contract; recorded inert stub for a deferred op), Rule 1 (Integration AC), Rule 12 (root gate)]

### Review Findings

**Code review: 2026-06-06 — APPROVED; CLEAN REVIEW.** 0 HIGH / 0 MED / 0 decision-needed / 0 patch / 0 defer; 2 LOW dismissed (noted below). Status stays `review` for the lead's post-CR per-story smoke gate (no commit at this stage).

All 6 ACs + Rules 1/3/13 re-confirmed with evidence:

- **AC1 (usage lists export/import/ui; --help/-h exit 0):** `usage()` iterates `SUBCOMMANDS` in order `[export, import, ui]`; unit (`index.test.ts`) + the real-spawn e2e (`bin-spawn.e2e.test.ts`) both confirm all three listed and exit 0 for `--help`/`-h`/no-args.
- **AC2 (unknown → message + usage + exit 1):** preserved; unit + spawn assert `Unknown command: <name>` + usage on STDOUT and real exit code 1.
- **AC3 (recognized inert scaffolds, stderr + exit 1, arg-parse seam, deferred-work record):** `export`/`import` are recognized (NOT "Unknown command"), write the honest "not yet implemented — arriving in Story 11.2/11.3" message to STDERR, set `exitCode = 1`; `parseExportArgs`/`parseImportArgs` mirror `parseUiArgs` (`--db`/`--db=` + positional, unknown flags ignored, NO new dependency). Both inert stubs recorded in `deferred-work.md` with named consumers 11.2/11.3 (entries verified accurate).
- **AC4 (`ui` byte-identical):** `git diff HEAD -- packages/cli/src/ui.ts` EMPTY; the `ui` `describe` carries no "not yet implemented" suffix.
- **AC5 / Rule 13 (operator-only — no MCP leakage):** `git diff HEAD -- packages/core packages/mcp-server/src` EMPTY; grep of `packages/mcp-server/src` finds the 17 agent tool files only — `export`/`import`/`ui` appear NOWHERE as MCP tools; `tool-contract.drift.test.ts` + `server.bootstrap.test.ts` green in the full suite. CLI imports neither the MCP server nor board logic (NFR2 thin client preserved).
- **AC6 (gate green):** canonical ROOT gate — lint 0 · typecheck 0 · build clean · `pnpm test` **1508 passed / 175 files / 0 failed** · `pnpm run format` (prettier --check) clean.
- **Rule 1 (Integration AC):** story HAS an `## Integration ACs` section naming consumers 11.2/11.3 + the observable AC3 producer behavior (recognized-subcommand path distinct from the AC2 unknown path) — satisfied.
- **Rule 3 (real-runtime evidence):** `bin-spawn.e2e.test.ts` SPAWNS the BUILT `dist/index.js` as a real `node` child and asserts real exit codes + stdout/stderr ROUTING (unknown→stdout usage; export/import→stderr inert msg, stdout empty). **Rule 7 mutation (reviewer):** flipped the export stub's default sink stderr→stdout, rebuilt the cli dist, re-ran the spawn suite → **2 tests RED** (`not yet implemented` no longer on stderr, stdout no longer empty); reverted byte-identical (`git diff --stat packages/cli/src/export.ts` empty), rebuilt, re-ran → 7/7 GREEN. The real-runtime assertion is non-vacuous.

**LOW (dismissed, not defects):**
1. `parseExportArgs`/`parseImportArgs` are near-duplicates of each other and of `parseUiArgs` — deliberate parity with the established hand-rolled model per AC3 (a shared helper adds indirection for no behaviour gain; the parsers diverge in 11.2/11.3). Dismissed.
2. The `--db=` (empty inline value) edge sets `dbPath = ''` — identical to the pre-existing `parseUiArgs` behavior (same dismissed-LOW recorded at the Story 9.3 code review: "parseUiArgs empty --db= operator-typo edge"); inert in this scaffold scope, owned by consumers 11.2/11.3. Dismissed.

**Adversarial:** Blind Hunter 0 correctness findings; Edge Case Hunter 0 unhandled (exitCode side-effect bleed handled by per-describe capture/reset; spawn dist-dependency documented + root-gate-built); Acceptance Auditor 0 AC violations. Rule 5 N/A (no NFR amendment); Rule 6 N/A (no `docs/adr`). No new deferred items introduced.

## Dev Agent Record

### Context Reference

- Story spec: `_bmad-output/implementation-artifacts/11-1-operator-cli-scaffold.md`
- Model: existing `packages/cli/src/ui.ts` (`parseUiArgs` / `uiCommand` pattern) + `packages/cli/src/index.ts` (`SUBCOMMANDS` dispatch seam, Story 9.3).

### Agent Model Used

claude-opus-4-8 (Opus 4.8, 1M context)

### Debug Log References

- Typecheck initially RED: `process.exitCode` is typed `string | number | null | undefined` (Node 24 types), so capturing it into `let savedExitCode: number | undefined` failed TS2322. Fixed by typing the test capture as `typeof process.exitCode`. No production-code change.
- `parseExportArgs(['--future', 'x'])` does NOT yield `{}` (unlike `parseUiArgs`) because export/import carry a positional, so the bare `x` is captured as the output path. Test expectations corrected to assert against `['--future']` alone (and `['--db=…','--future']`) — the honest behavior.

### Completion Notes

- Registered `export` + `import` in the `SUBCOMMANDS` table (ordered `export`, `import`, `ui`); `usage()` now lists all three with a one-line describe each. The describe carries a "(Story 11.2/11.3 — not yet implemented.)" suffix that the consumer stories drop.
- New command modules `export.ts` / `import.ts`: each exports a `parse{Export,Import}Args` hand-rolled seam (`--db <path>`/`--db=<path>` + an output/input positional; unknown flags ignored for forward-compat — mirrors `parseUiArgs`, NO CLI-framework dependency) and an `{export,import}Command(argv, write?)` handler that exercises the parse seam, writes the inert "not yet implemented — arriving in Story 11.2/11.3" message to STDERR (injectable sink, defaults to `process.stderr`), and sets `process.exitCode = 1`. Bodies are HONEST inert scaffolds — Story 11.2/11.3 fill them, reusing the seam + `resolveDbPath`.
- Barrel re-exports added to `index.ts` (`exportCommand`/`parseExportArgs`/`ExportOptions`, `importCommand`/`parseImportArgs`/`ImportOptions`) so they are importable + testable like `uiCommand`.
- `ui.ts` UNCHANGED (byte-identical); the `dispatch` contract preserved (no-cmd/`--help`/`-h` → usage exit 0; unknown → `Unknown command` + usage + `exitCode = 1`; recognized → `command.run(rest)`). The `Subcommand.run` signature `(argv) => Promise<void>` is structurally satisfied by the handlers' extra optional `write` param; `dispatch` calls `run(rest)` with one arg so the default stderr sink applies.
- **Rule 13 (thin client / byte-identical contract):** `git diff HEAD -- packages/core packages/mcp-server/src` is EMPTY. `export`/`import`/`ui` are OPERATOR-ONLY — grep confirms ZERO MCP tool registration for them in `packages/mcp-server/src`; the existing `tool-contract.drift.test.ts` + `server.bootstrap.test.ts` (17-tool agent contract) stayed green in the full suite.
- **Rule 13 (recorded inert stub):** both deferred bodies recorded in `deferred-work.md` with named consumers (export→11.2, import→11.3).
- New unit tests (`index.test.ts`): usage lists export/import/ui in order; `--help`/`-h` → usage, exitCode unset (0); unknown → `Unknown command` + usage + exitCode 1; `export`/`import` recognized (NOT "Unknown command") + inert stderr message (`Story 11.2`/`Story 11.3`) + exitCode 1; the arg-parse seam parses `--db` (spaced + inline) + positional + ignores unknown flags. `process.exitCode` captured + reset per describe to avoid bleed.
- **Gate (canonical ROOT, Rule 12):** lint 0 · typecheck 0 · build clean (all packages) · `pnpm test` **1501 passed / 174 files / 0 failed** · `pnpm run format` clean (after `prettier --write` on the new test file).

### File List

- `packages/cli/src/index.ts` (modified — register export/import in SUBCOMMANDS + barrel re-exports + header comment)
- `packages/cli/src/export.ts` (new — `parseExportArgs` + inert `exportCommand` scaffold)
- `packages/cli/src/import.ts` (new — `parseImportArgs` + inert `importCommand` scaffold)
- `packages/cli/src/index.test.ts` (new — dispatch + scaffold + arg-parse unit tests)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — recorded the two inert stubs, consumers 11.2/11.3)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — 11.1 → in-progress → review)
- `_bmad-output/implementation-artifacts/11-1-operator-cli-scaffold.md` (modified — frontmatter baseline_commit, task checkboxes, Dev Agent Record, status)

### Change Log

- 2026-06-06 — Story 11.1 dev-story: operator CLI scaffold. Registered `export`/`import` as recognized operator-only subcommands with honest inert handler bodies + hand-rolled arg-parse seams (mirroring `parseUiArgs`, no CLI-framework dep); barrel re-exports; `ui.ts` + the agent MCP contract byte-identical (Rule 13). Added `index.test.ts` unit coverage (dispatch + scaffold + seam). Recorded the two inert stubs in deferred-work.md (consumers 11.2/11.3). Full canonical root gate green (lint 0 / typecheck 0 / build clean / 1501 tests / format clean).
