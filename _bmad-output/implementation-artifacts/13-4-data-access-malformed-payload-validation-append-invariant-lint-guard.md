---
baseline_commit: c8688d2
---

# Story 13.4: data-access malformed-payload validation + append-invariant lint guard

Status: review

<!-- Epic 13 (deferred-work cleanup & hardening). Closes deferred-work.md 1.6 (P2 — mapping malformed-payload validation) + 1.5 (P3 — append-invariant lint guard in *.test.ts). NO new BOARD_ERROR_CODE — the malformed-row rejection is a data-access-local error. 17-tool agent contract byte-identical. -->

## Story

As a maintainer of the append-only ledger,
I want corrupt rows rejected at the read seam and the append-invariant enforced even in tests,
So that the ledger's integrity guarantees hold end-to-end.

## Acceptance Criteria

1. **(AC1 — malformed-payload validation, 1.6)** Given `wireToPayload` / the data-access mapping (`packages/data-access/src/mapping.ts`), when it reads a known-type-but-MALFORMED payload row, then it **validates the payload shape and rejects/surfaces the malformed row** (a clear data-access-local error) rather than returning a structurally-wrong object (today a missing string key silently becomes `"undefined"`, a missing `message_seq` becomes `NaN`) — with a test driving a **planted malformed row** (valid `type`, missing/wrong-typed payload key).

2. **(AC2 — append-invariant guard in tests, 1.5)** Given the append-invariant ESLint guard (`eslint.config.js` block 6) currently disabled in `*.test.ts`, when it is re-enabled (**AST-based where practical, not a string-literal regex**), then the append-only invariant (no raw `UPDATE`/`DELETE` against the ledger; order by `seq` never `created_at`) is **enforced in test files too**, any genuine test-only bypass is migrated to `append`, and the gate stays green. **Reconcile (Rule 8)** the AC's "no raw INSERT" wording against the SHIPPED invariant + the load-bearing proof tests — see Dev Notes "Reconciliation".

3. **(AC3 — contract frozen + items closed)** Given the changes, when tested, then the 17-tool agent contract + closed `BOARD_ERROR_CODES` are **byte-identical** (no new error code — the malformed-row rejection is a data-access-local error, NOT added to the closed set; `git diff HEAD -- packages/core/src/errors.ts packages/mcp-server/src` empty), and `deferred-work.md` `1.6` + `1.5` are **closed with evidence**. Both halves' new/changed guards are mutation-tested non-vacuous (Rule 7).

## Tasks / Subtasks

- [x] **Task 1 — Validate malformed payloads in `mapping.ts` (1.6)** (AC: #1, #3)
  - [x] In `wireToPayload` (`packages/data-access/src/mapping.ts:201`), add per-field shape validation so a known-type-but-malformed row throws a CLEAR data-access-local error instead of coercing `undefined → "undefined"` / `undefined → NaN`. RECOMMENDED approach: small dependency-free assertion helpers (e.g. `requireString(wire, 'handle', type)`, `requireInt(wire, 'message_seq', type)`) that throw `new Error('malformed <type> payload: …')`, mirroring the existing `asEventType` loud-failure stance at the SAME seam. **Do NOT add Zod to data-access** — its deps today are only `@agentbbs/core` + `better-sqlite3` (Zod lives in mcp-server only); a new boundary-validator dependency is unwarranted for ten flat payload shapes (confirm via Research-First if you disagree). Validate every required key per branch; coerce only after the presence/type check passes. — DONE: added `requireString`/`requireInt` + `MalformedPayloadError extends Error`; every branch's required keys validated; NO Zod added (deps unchanged).
  - [x] The error is a plain data-access `Error` (or a small local `MalformedPayloadError extends Error`) — it is NOT a `BoardError`/`BOARD_ERROR_CODE` (AC3: the closed 10-code agent set stays byte-identical). Keep `core/src/errors.ts` untouched. — DONE: `MalformedPayloadError extends Error`; `core/src/errors.ts` byte-identical (verified empty diff).
  - [x] Verify the happy path is unaffected: a well-formed row round-trips exactly as before (the all-10-type round-trip + the existing mapping tests stay green). The validation only fires on a genuinely malformed/foreign row. — DONE: all-10-type round-trip + existing mapping tests stay green; explicit happy-path test added.
- [x] **Task 2 — Test the malformed-row rejection (1.6)** (AC: #1)
  - [x] Add a test (in `packages/data-access/src/mapping.test.ts` or a focused new `*.test.ts`) that drives `rowToEvent`/`wireToPayload` with a planted malformed row: a valid `type` (e.g. `identity.registered`) whose stored JSON payload is missing a required key (e.g. no `handle`) or has a wrong-typed value (e.g. `message_seq: "x"` for `message.reacted`) → asserts it THROWS the clear seam error (not a `"undefined"`/`NaN` object). Cover a string-key case and the `message_seq` integer case. — DONE: new describe block in `mapping.test.ts` — missing string, wrong-typed string, missing int, wrong-typed (`"x"`) int, non-integer (1.5) int, malformed via `rowToEvent`, + happy-path.
  - [x] Rule-7: confirm the test discriminates — temporarily revert the validation (back to bare `String(...)`/`Number(...)`) → the test goes RED (it would have returned a malformed object); restore byte-identical → GREEN. — DONE: reverting both helpers to bare `String/Number` → 6 malformed-row assertions RED (happy-path green); restored → 16/16 GREEN.
- [x] **Task 3 — Re-enable the append-invariant guard in test files (1.5)** (AC: #2, #3)
  - [x] Replace `eslint.config.js` block 6 (`files: ['**/*.test.{ts,tsx}'] → no-restricted-syntax: 'off'`) with an AST-based guard that matches the forbidden invariant violations as EXECUTED SQL (a forbidden-SQL literal that is an ARGUMENT to a `db.prepare`/`.exec`/`.run`/`.pragma` call), so the rule fires on a REAL test write but NOT on the boundary-enforcement fixture's intentional assertion STRINGS. Verify the AST selectors against the installed eslint@10 / typescript-eslint@8. — DONE: block 6 now applies `APPEND_INVARIANT_TEST_FILE_SYNTAX` (CallExpression `prepare|exec|run|pragma` > Literal/TemplateElement regex selectors); empirically verified against installed eslint@10.4.1 / typescript-eslint@8.60.0 via a 9-case Linter probe (all correct).
  - [x] **Reconcile the legitimate proof tests (Rule 8):** … — DONE: the ONE executed `ORDER BY created_at` proof SELECT (`append.qa.test.ts`) carries a JUSTIFIED `/* eslint-disable no-restricted-syntax */` block carve-out (block pair, not -next-line, so Prettier reflow can't move it off the node). `data-access-node-sqlite.qa.test.ts` reads back via the adapter's seq-ASC `eventsSince` (no `ORDER BY created_at` SELECT) so needs NO carve-out; its raw INSERT is permitted (INSERT ≠ violation). Reconciliation surfaced in Dev Agent Record below.
  - [x] Survey ALL `*.test.ts` for genuine ledger-MUTATION bypasses … confirm exhaustively. — DONE: exhaustive grep over `**/*.test.{ts,tsx}` for `UPDATE events`/`DELETE FROM events`/`ORDER BY created_at` — NO executed UPDATE/DELETE mutation bypass exists. Matches are: the boundary-fixture bare assertion strings (permitted), the one proof SELECT (carved out), and comments (permitted).
- [x] **Task 4 — Mutation-test the re-enabled guard + close items** (AC: #2, #3)
  - [x] Rule-7: add (temporarily) a real `db.prepare('UPDATE events SET …').run(…)` in a test file → confirm the re-enabled guard flags it RED at `pnpm lint`; remove it → GREEN. Confirm the boundary-fixture assertion strings + the permitted ordering-proof SELECT do NOT trip it. Record both directions. — DONE: planted executed UPDATE → RED (1 problem), bare `const = 'UPDATE events…'` on next line NOT flagged; removing the proof-SELECT carve-out → that line RED; both reverted → guard GREEN on all legitimate test code (boundary fixture + proof SELECT clean).
  - [x] In `deferred-work.md`, flip `1.6` and `1.5` headings `OPEN → RESOLVED (Story 13.4)` with resolution sub-lines. Retain originals. — DONE: both canonical entries flipped OPEN → RESOLVED with detailed resolution sub-lines; original Summary/Rationale/Suggested-resolution retained.
- [x] **Task 5 — Contract-freeze + full gate** (AC: #3)
  - [x] Confirm `git diff HEAD -- packages/core/src/errors.ts packages/mcp-server/src` is EMPTY; tool-contract + error-code drift guards green. Run the FULL ROOT gate (Rule 20). — DONE: contract-freeze diff EMPTY; full ROOT gate all legs GREEN — lint 0 / typecheck 0 / build clean / `pnpm test` 186 files 1687 passed 0 failed / `prettier --check .` clean.

## Dev Notes

### Current state (READ FIRST — both files read in full by the lead)

- `packages/data-access/src/mapping.ts#wireToPayload` (lines 201-260): an exhaustive `switch` over the 10 event types; each branch reads keys POSITIONALLY and coerces with `String(wire.x)` / `Number(wire.message_seq)`. A row with a VALID `type` but a missing/wrong payload key maps SILENTLY: missing string → `"undefined"`, missing int → `NaN` (the `1.6` gap). `asEventType` (line 270) already throws loudly on an unknown `type` — the fix mirrors that stance for the payload shape. data-access deps = `@agentbbs/core` + `better-sqlite3` ONLY (no Zod).
- `eslint.config.js` block 6 (lines 240-245): `no-restricted-syntax: 'off'` for `**/*.test.{ts,tsx}`. Disabled because the boundary-enforcement fixture embeds forbidden SQL as bare string literals to assert the PRODUCTION rule fires, and `append.qa.test.ts` orders by `created_at` to prove ordering differs — the string-literal regex guard can't tell those apart from a real violation. The `APPEND_INVARIANT_RESTRICTED_SYNTAX` patterns (lines 95-115) flag `UPDATE events` / `DELETE FROM events` / `ORDER BY created_at` (NOT `INSERT` — append-only permits inserts).
- Test-file raw SQL (lead survey): reads/counts (`SELECT COUNT(*)`, `SELECT … ORDER BY seq`) everywhere (fine); two controlled-`created_at` `INSERT INTO events` proof inserts (`append.qa.test.ts:151`, `data-access-node-sqlite.qa.test.ts:191` — load-bearing, NOT migratable); the ordering-proof `SELECT … ORDER BY created_at ASC` (`append.qa.test.ts:176` — load-bearing); the boundary-fixture assertion STRINGS (`boundary-enforcement.test.ts` — not executed). NO `UPDATE events`/`DELETE FROM events` executed against a real DB was found in tests — confirm exhaustively before re-enabling.

### Reconciliation (Rule 8) — the AC's "no raw INSERT … migrate to append" vs shipped reality

The shipped append invariant (and the production guard) is **no UPDATE/DELETE of the ledger + never order BY created_at as the order key** — INSERT is exactly how `append` writes, so a raw INSERT is not itself a violation. Two proof tests INTENTIONALLY raw-INSERT rows with adversarial `created_at` and SELECT `ORDER BY created_at` to PROVE seq-ordering is independent of created_at — migrating them to `append` is impossible (append stamps created_at) and would DELETE the proof of the very invariant this guard protects. So do NOT mechanically strip those; reconcile by enforcing the real invariant (no UPDATE/DELETE; no created_at order-key in data-bearing queries) while permitting the documented proof instruments via a narrow justified carve-out. Surface this resolution to the reviewer (don't silently implement the literal AC over the shipped design).

### Constraints

- **Rule 13 / contract freeze:** the malformed-row rejection is a data-access-local `Error`, NOT a `BOARD_ERROR_CODE`. `core/src/errors.ts` + `packages/mcp-server/src` byte-identical; the 17-tool surface + closed 10-code/10-event sets unchanged. (AC3 explicitly forbids adding a new error code.)
- **NFR10 (ledger integrity):** AC1 hardens the read seam against corrupt/foreign rows (the same class as `asEventType` for the type column).
- Canonical gate is ROOT `pnpm test` + the full Rule-20 gate (the re-enabled lint rule is part of it — it must be GREEN on all legitimate test code and RED only on a genuine violation).

### Project Structure Notes

- Production change: `packages/data-access/src/mapping.ts` (validation helpers + per-branch checks). `eslint.config.js` (block 6 rewrite). Possibly tiny justified `eslint-disable` comments on the two proof tests' lines.
- Tests: `packages/data-access/src/mapping.test.ts` (malformed-row rejection). `deferred-work.md`.
- No core/mcp-server change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.4] — the three ACs.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — `1.6` (~line 38, suggests Zod but notes the failure-mode decision belongs to the consumer; hand-rolled is acceptable + lighter), `1.5` (~line 31, "AST-level matching of actual better-sqlite3 call sites instead of string-literal regex … that still permits the fixture/assertion strings").
- [Source: packages/data-access/src/mapping.ts:201-277] — `wireToPayload` + `asEventType` (the loud-failure template).
- [Source: eslint.config.js:95-115,240-245] — `APPEND_INVARIANT_RESTRICTED_SYNTAX` + the block-6 test-file disable to replace.
- [Source: packages/data-access/src/sqlite/append.qa.test.ts:151,176] + `data-access-node-sqlite.qa.test.ts:191` — the load-bearing controlled-`created_at` proof tests (Rule-8 reconciliation).
- [Source: packages/core/src/boundary-enforcement.test.ts:192,200,208,226] — the fixture assertion STRINGS the AST guard must NOT false-positive.
- [Source: .claude/rules/project-rules.md] — Rule 3 (installed types if Zod considered), Rule 7 (mutation, both halves), Rule 8 (reconcile AC vs shipped design), Rule 13 (no new error code), Rule 20 (full gate incl. lint).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context) — dev-story stage under /epic-cycle.

### Debug Log References

- AST-selector verification (Rule 3 — verify against installed types/behavior): a 9-case `eslint.Linter` probe against the INSTALLED eslint@10.4.1 + typescript-eslint@8.60.0 confirmed the test-file selectors before wiring them into the config. Executed UPDATE/DELETE/ORDER-BY-created_at + executed template forbidden → FLAGGED; bare `const sql = '…'` literals (the boundary-enforcement fixture strings) → NOT flagged; permitted executed INSERT + ORDER BY seq → NOT flagged; comment mention → NOT flagged. Probe removed after verification.
- ESLint self-lint trap: a `// eslint-disable-next-line carve-out.` phrase in `eslint.config.js`'s OWN comment was parsed by ESLint-on-the-config as a real disable directive for a rule named `carve-out.` → `pnpm lint` RED ("Definition for rule 'carve-out.' was not found"). Reworded the comment so `eslint-disable-next-line` is not the first token.
- Carve-out placement vs Prettier: `// eslint-disable-next-line` on the proof SELECT was unstable — Prettier reflowed the long SQL literal so the reported node moved off the directive's next-line target (warning "Unused eslint-disable directive" + the violation re-reported). Switched to a position-stable `/* eslint-disable no-restricted-syntax */ … /* eslint-enable */` block pair; Prettier reports the block "unchanged" and the carve-out holds.
- Full ROOT gate (Rule 20), every leg independently: `pnpm lint` 0 / `pnpm typecheck` 0 / `pnpm build` clean (all bundles incl. both VS Code webview bundles) / `pnpm test` 186 files 1687 passed 0 failed / `pnpm format` (`prettier --check .`) clean.

### Completion Notes List

- **AC1 (1.6 — malformed-payload validation):** `wireToPayload` (`packages/data-access/src/mapping.ts`) now validates each required payload key per branch via dependency-free `requireString`/`requireInt` BEFORE coercing. A known-type-but-malformed row throws a clear data-access-local `MalformedPayloadError` (a new local `class extends Error`, exported from the data-access barrel alongside `StoreBusyError`/`UniquenessConflictError`) instead of silently producing `"undefined"`/`NaN`. Mirrors `asEventType`'s loud-failure stance for the `type` column (NFR10). NO Zod added — data-access deps stay `@agentbbs/core` + `better-sqlite3` only; hand-rolled assertions are sufficient and lighter for ten flat shapes (the story's recommended approach; no Research-First disagreement). Coverage: missing string, wrong-typed string, missing int, wrong-typed-string int (`"x"`), non-integer number (1.5), and the malformed-via-`rowToEvent` path; plus an explicit happy-path-unaffected assertion.
- **AC2 (1.5 — append-invariant guard in tests):** `eslint.config.js` block 6 no longer disables `no-restricted-syntax`; it applies `APPEND_INVARIANT_TEST_FILE_SYNTAX` — AST selectors that flag forbidden SQL ONLY as an ARGUMENT to an executed `db.prepare/.exec/.run/.pragma(...)` call. Fires on a real test ledger-mutation bypass; permits the boundary-enforcement fixture's bare assertion strings (never executed) and the one proof SELECT (carved out). Production blocks 4/5 keep the original bare-literal `APPEND_INVARIANT_RESTRICTED_SYNTAX` UNCHANGED (so the `boundary-enforcement.test.ts` fixture, which lints virtual snippets as `dataAccessFilePath`, still proves the production rule fires).
- **AC3 (contract frozen + items closed):** `git diff HEAD -- packages/core/src/errors.ts packages/mcp-server/src` is EMPTY — the 17-tool agent contract + closed 10-code `BOARD_ERROR_CODES` are byte-identical; `MalformedPayloadError` is data-access-local, NOT a `BOARD_ERROR_CODE`. `deferred-work.md` 1.6 + 1.5 flipped OPEN → RESOLVED with evidence (originals retained). All drift guards green within the 1687-test suite.
- **Rule-8 RECONCILIATION (surfaced to reviewer):** The AC's "no raw INSERT … migrate to append" wording was reconciled against the SHIPPED invariant. The shipped append invariant is **append-only = no UPDATE/DELETE of the ledger + never ORDER BY created_at as an order key**; a raw INSERT is exactly how `append` writes, so INSERT is NOT a violation (the production guard never flagged it). Two proof tests INTENTIONALLY raw-INSERT rows with adversarial `created_at` to prove seq-ordering ≠ created_at-ordering — they CANNOT migrate to `append` (which stamps created_at) and are load-bearing. `append.qa.test.ts` additionally runs a `SELECT … ORDER BY created_at ASC` proof SELECT — the ONE legitimately-executed `ORDER BY created_at` in the repo — which receives a narrow JUSTIFIED block carve-out. `data-access-node-sqlite.qa.test.ts` reads back via the adapter's seq-ASC `eventsSince` (no `ORDER BY created_at` SELECT), so it needs no carve-out. The test-file guard therefore enforces no-UPDATE/DELETE + no-executed-`ORDER BY created_at` while permitting the documented proof instruments — NOT the literal "no raw INSERT" AC.
- **Rule-7 non-vacuity (both halves):** (a) reverting the `mapping.ts` validation helpers to bare `String/Number` → 6 malformed-row assertions RED (happy-path stayed green); restored byte-identical → 16/16 GREEN. (b) a planted `db.prepare('UPDATE events …').run()` → lint RED (exactly 1 problem; the bare `const = 'UPDATE events…'` on the next line NOT flagged); removing the proof-SELECT carve-out → that line RED; both reverted → guard GREEN, no false-positive on the boundary fixture or the proof SELECT.
- **Rules 5/6 N/A:** no NFR found unmeasurable/contradictory (no amendment); no `docs/adr/` registry exists (no ADR to match).
- Left UNCOMMITTED for the lead's per-story smoke gate (no `git commit`/`push` performed).

### File List

- `packages/data-access/src/mapping.ts` (modified — `requireString`/`requireInt`/`describe` helpers + `MalformedPayloadError`; `wireToPayload` branches validate before coercing)
- `packages/data-access/src/index.ts` (modified — export `MalformedPayloadError` from the barrel)
- `packages/data-access/src/mapping.test.ts` (modified — new malformed-payload-rejection describe block, 7 cases incl. happy-path; import `MalformedPayloadError`)
- `packages/data-access/src/sqlite/append.qa.test.ts` (modified — justified `/* eslint-disable no-restricted-syntax */` block carve-out on the proof `ORDER BY created_at` SELECT)
- `eslint.config.js` (modified — block 6 re-enabled with AST-based `APPEND_INVARIANT_TEST_FILE_SYNTAX` replacing `no-restricted-syntax: 'off'`)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — 1.6 + 1.5 flipped OPEN → RESOLVED with evidence, originals retained)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story 13-4 ready-for-dev → in-progress → review)

### Change Log

- 2026-06-10 — Story 13.4 implemented: data-access malformed-payload validation at the `wireToPayload` read seam (1.6) + AST-based append-invariant lint guard re-enabled in `*.test.ts` (1.5). 17-tool agent contract + closed error set byte-identical. Full Rule-20 gate green (lint 0 / typecheck 0 / build / test 1687 / prettier). Status → review.
- 2026-06-10 — Code review (`/bmad-code-review`): APPROVED. All 3 ACs verified; full ROOT gate independently re-run GREEN; one QA LOW adjudicated (dismissed with rationale + recorded in deferred-work). See Review Findings below.

## Review Findings (code-review stage, 2026-06-10)

**Verdict: APPROVED.** Two-half story (AC1 malformed-payload validation 1.6; AC2 append-invariant test-file guard 1.5) implemented cleanly. No HIGH/MED findings. One QA LOW adjudicated. Two minor documentation accuracy edits applied by the reviewer (no code change).

### AC verification

- **AC1 (1.6 — malformed-payload validation): PASS.** `wireToPayload` validates every required key of all 10 closed event types via dependency-free `requireString`/`requireInt` BEFORE coercing; a known-type-but-malformed row throws a clear data-access-local `MalformedPayloadError` (named class extending `Error`, not a `BoardError`). No Zod added (deps unchanged — correct per Rule 3, hand-rolled is sufficient + lighter for 10 flat shapes). Happy path unaffected. **Rule-7 independently re-verified by the reviewer:** reverted `requireString` to bare `String(value)` → 55 string-key assertions went RED (the QA matrix); restored byte-identical (`git diff --stat` matches original 97/22; mapping suite 86/86 GREEN). The validator is non-vacuous.
- **AC2 (1.5 — append-invariant guard in tests): PASS.** Block 6 is genuinely AST-based (`CallExpression[callee.property.name=/^(?:prepare|exec|run|pragma)$/]` parent with `Literal`/`TemplateElement` regex children), not a bare-literal regex. The durable `append-invariant-guard.test.ts` runs the REAL flat config via the ESLint Node API and proves BOTH directions: FIRES on executed UPDATE/DELETE/ORDER-BY-created_at in string AND template form (Rule-18 call-form lineage covered), repo-wide (data-access + core paths); does NOT false-positive on bare assertion strings, executed INSERT, ORDER BY seq, or the carved-out proof SELECT. Confirmed the `boundary-enforcement.test.ts` fixture strings (`export const sql = 'UPDATE events …'`) are bare (non-call-argument) literals the AST guard correctly permits while the production block-4/5 literal guard still flags them via the fixture's virtual `dataAccessFilePath` lint. **Rule-8 reconciliation sound:** append-only = no UPDATE/DELETE + never `ORDER BY created_at` as an order key; INSERT permitted (it is how `append` writes); the ONE executed proof `ORDER BY created_at` SELECT carries a narrow, justified `/* eslint-disable */ … /* eslint-enable */` block-pair carve-out (position-stable vs Prettier reflow) — NOT a blanket disable.
- **AC3 (contract frozen + items closed): PASS.** `git diff HEAD -- packages/core/src/errors.ts packages/mcp-server/src` EMPTY (independently confirmed). `MalformedPayloadError` is NOT in `BOARD_ERROR_CODES` and does not appear anywhere in `packages/core`/`packages/mcp-server` (`git grep` confirmed) — the data-access barrel export is data-access-local and does not leak into core/the agent surface (Rule 13 holds). Error-code + tool-contract drift guards green within the full suite. `deferred-work.md` 1.6 + 1.5 flipped OPEN → RESOLVED with evidence, originals retained.

### Rule-20 full gate (independently re-run by the reviewer)

- `pnpm lint` → 0 problems (the re-enabled rule is GREEN on all legitimate code).
- `pnpm typecheck` → 0 errors.
- `pnpm build` → clean (all bundles incl. both VS Code webview bundles).
- `pnpm test` → **187 files / 1769 passed / 0 failed** (higher than the dev-reported 1687 because the QA all-10-type × every-required-key parametrized matrix adds many cases — expected, not a discrepancy).
- `npx prettier --check .` → clean.

### Adjudicated finding

- **QA LOW — `requireInt` allows negative/zero `message_seq` (positivity not validated): DISMISSED with rationale.** No AC requires positivity (AC1 scopes to missing/wrong-typed); the gap is unreachable on the happy path (write path only stamps positive AUTOINCREMENT seq); the behavior is regression-pinned by the QA positivity tests. Recorded as a documented LOW (won't-fix-at-V1, with a suggested resolution path) in `deferred-work.md` under "Deferred from: code review of story 13.4". Per epic-cycle "auto-resolve HIGH/MED, document LOW" policy.

### Reviewer doc-accuracy edits (no code change)

1. `deferred-work.md` 1.5 resolution sub-line said the carve-out was an `eslint-disable-next-line` directive; the shipped implementation is a position-stable `/* eslint-disable */ … /* eslint-enable */` block pair (the Dev Debug Log explains the deliberate switch from `-next-line` due to Prettier reflow). Corrected the sub-line to match the code.
2. Added the QA-LOW disposition section to `deferred-work.md`.

### Stage rules (skill-rules.md) — N/A

- Rule 1 (Integration AC): N/A — no service introduced (data-access-local validation + a lint config change).
- Rule 3 (real-runtime test evidence): N/A for a user-facing surface — but note AC2's guard IS exercised by a real-runtime test (`append-invariant-guard.test.ts` runs the actual flat config via the ESLint Node API), which is the strongest available evidence for a lint-rule guarantee.
- Rule 5 (NFR tripwire): N/A — no unmeasurable NFR worked around.
- Rule 6 (ADR): N/A — `docs/adr/` has no entries; nothing to match.
