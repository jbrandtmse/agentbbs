---
baseline_commit: 21eb763
---

# Story 13.5: Operator-handle canonicalization de-duplication

Status: review

<!-- Epic 13 (deferred-work cleanup & hardening). Closes deferred-work.md 10.3-operator-handle-dup. A thin-client refactor (Rule 13). NO change to the 17-tool agent contract / closed error/event sets. -->

## Story

As a maintainer of the two operator surfaces,
I want one shared handle-canonicalization util,
So that the trim+lowercase rule cannot drift between the web host and the VS Code extension.

## Acceptance Criteria

1. **(AC1 — one shared canonicalization)** Given `resolveOperatorHandle` / `canonicalizeOperatorHandle` duplicated in `packages/cli/src/ui.ts` and `apps/vscode-extension/src/tree/operator-handle.ts` (`10.3-operator-handle-dup`), when the duplication is removed, then the canonicalization (**trim + lowercase → `null` on empty**, the operator-handle rule) lives in **ONE shared location both surfaces import** — neither carries its own copy — and the behavior is **byte-identical to today** (a test pins the shared util's output for the canonical cases).

2. **(AC2 — surfaces green, contract untouched)** Given the refactor, when tested, then **both surfaces' existing tests stay green**, the **17-tool agent contract is untouched** (the tool/error/event drift guards stay green; the agent-facing MCP surface, closed `BOARD_ERROR_CODES`, and `EVENT_TYPES` are unchanged), and `deferred-work.md` `10.3-operator-handle-dup` is **closed with evidence**.

## Tasks / Subtasks

- [x] **Task 1 — Add the shared operator-handle canonicalize util** (AC: #1, #2)
  - [x] Add a single exported pure function — `canonicalizeOperatorHandle(raw: string | undefined | null): string | null` (trim + lowercase; `''`/whitespace/`undefined`/`null` → `null`) — to **`@agentbbs/core`** and re-export it from the core barrel (`packages/core/src/index.ts`). RATIONALE for core as the home (Dom Notes): it is the ONE package BOTH `@agentbbs/cli` and the `agentbbs-vscode-extension` app already depend on — apps are leaf packages (no app↔app / app↔cli dependency, enforced by `eslint.config.js` `NO_CLIENT_FROM_CORE` + the leaf-app boundary), so the shared util cannot live in `cli` or the extension. `ui-shared` (browser/React) and `data-access` (storage adapter) are wrong-layer. The dependency direction client → core is correct (core must not import clients; clients importing a core helper is fine). Place it near the identity helpers (e.g. `packages/core/src/identity/operator-handle.ts` or a suitable existing module) with a clear doc comment that it is the OPERATOR-handle normalization (trim+lowercase→null), distinct from the register/login `canonicalize` (which only `toLowerCase()`s already-validated input — DO NOT merge those; different semantics).
  - [x] **Scope discipline:** unify ONLY the duplicated operator-handle canonicalize. Do NOT fold core's own `register.ts#canonicalize` / `login.ts#canonicalize` (`handle.toLowerCase()`, no trim/null — pre-validated input) into the new helper — that would change their contract. They stay as-is.
- [x] **Task 2 — Consume the shared util from both surfaces** (AC: #1, #2)
  - [x] `apps/vscode-extension/src/tree/operator-handle.ts`: delete the local `canonicalizeOperatorHandle` body; import the shared one from `@agentbbs/core`. Keep the extension's `resolveOperatorHandle(settingValue, env)` precedence wrapper (setting → env) — it delegates to the shared canonicalize. Update the file's header comment (the "duplicated here because the extension must not depend on @agentbbs/cli" note is now resolved — both import the shared core util).
  - [x] `packages/cli/src/ui.ts`: delete the inline `raw.trim().toLowerCase()` body in `resolveOperatorHandle`; import + delegate to the shared `canonicalizeOperatorHandle` from `@agentbbs/core`. Keep the cli wrapper's signature (`resolveOperatorHandle(raw: string | undefined): string | null`) and call-site behavior identical (`options.operatorHandle ?? process.env.AGENTBBS_OPERATOR` is passed in by the caller at `ui.ts:127`).
  - [x] Confirm the canonical-case behavior is byte-identical end-to-end on both surfaces (same inputs → same outputs as before): `'  Alice '` → `'alice'`, `''`/`'   '`/`undefined` → `null`, `'BOB'` → `'bob'`.
- [x] **Task 3 — Pin the shared util + close the item** (AC: #1, #2)
  - [x] Add a focused test (in core, e.g. `packages/core/src/identity/operator-handle.test.ts`) pinning `canonicalizeOperatorHandle` for the canonical cases (trim, lowercase, empty→null, whitespace→null, undefined/null→null, already-canonical passthrough). Mutation-test it non-vacuous (Rule 7): break the trim or the null-on-empty → the test goes RED; revert byte-identical → GREEN.
  - [x] Verify both surfaces' EXISTING tests still pass (the cli `ui.test.ts` operator-handle cases; the extension's operator-handle / NEEDS-YOU tests). No behavior change.
  - [x] In `deferred-work.md`, flip `10.3-operator-handle-dup` (line ~394) heading `OPEN → RESOLVED (Story 13.5)` with a resolution sub-line (one shared `@agentbbs/core` util; both surfaces import; byte-identical behavior pinned). Retain the original.
- [x] **Task 4 — Contract-freeze verification** (AC: #2)
  - [x] Confirm the 17-tool agent contract is untouched: the tool-contract drift guard + error-code/event drift guards stay green; `git diff HEAD -- packages/mcp-server/src` empty (the only core change is the additive helper export — NOT a tool/error/event). Run the FULL ROOT gate (lint + typecheck + build + test + prettier, Rule 20).

## Dev Notes

### Current state (READ FIRST — all three sites read by the lead)

- `apps/vscode-extension/src/tree/operator-handle.ts`: `canonicalizeOperatorHandle(raw) = raw.trim().toLowerCase()` → `null` on empty; `resolveOperatorHandle(settingValue, env)` precedence (setting → `env.AGENTBBS_OPERATOR`). Header comment explicitly notes it is "duplicated here because the extension must not depend on @agentbbs/cli."
- `packages/cli/src/ui.ts#resolveOperatorHandle(raw)`: inline `raw.trim().toLowerCase()` → `null` on empty (the SAME operator-handle rule). Consumed at `ui.ts:127` (`options.operatorHandle ?? process.env.AGENTBBS_OPERATOR`).
- `packages/core/src/identity/register.ts:60` + `login.ts:28`: `canonicalize(handle) = handle.toLowerCase()` — NO trim, NO null (input is Zod-pre-validated). A DIFFERENT function; out of scope (do not merge).

### Why core is the shared home (boundary analysis)

`@agentbbs/cli` (the web host) and `agentbbs-vscode-extension` (a leaf app) are the two surfaces. The eslint boundary bans an app importing `@agentbbs/cli` and bans core importing any client; both surfaces already depend on `@agentbbs/core`. So the only no-new-dependency shared home reachable by both — without inverting a boundary — is core. The util is a pure string normalization (no board state), so it sits cleanly as a core identity helper exported from the barrel. This is an ADDITIVE core export; it does NOT touch the agent-facing tool/error/event contract (AC2 — the drift guards confirm).

### Constraints (Rule 13)

- The 17-tool agent contract, closed `BOARD_ERROR_CODES`, and `EVENT_TYPES` are UNTOUCHED. The new core export is an internal helper, not a tool/error/event — the drift guards (which pin the tool surface, the closed code set, and the event vocab) stay green. `git diff HEAD -- packages/mcp-server/src` must be empty.
- Behavior byte-identical: this is a pure refactor (extract-and-share), no functional change. Both surfaces' existing tests are the regression guard; AC1's new core test pins the canonical cases.
- Operator handle is a CLIENT concept (a claimed `--as`/`AGENTBBS_OPERATOR`/setting handle, not a board "operator" type); the shared util is just the canonicalization transform. Each surface keeps its OWN `resolveOperatorHandle` precedence wrapper (the cli takes a single raw; the extension takes settingValue + env) — only the canonicalize step is shared.

### Project Structure Notes

- New: `packages/core/src/identity/operator-handle.ts` (+ barrel export in `packages/core/src/index.ts`) + `operator-handle.test.ts`.
- Changed: `apps/vscode-extension/src/tree/operator-handle.ts` (delete local body, import shared), `packages/cli/src/ui.ts` (delete inline body, import shared). `deferred-work.md`.
- core's register/login canonicalize: UNCHANGED.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.5] — the two ACs.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — `10.3-operator-handle-dup` (~line 394).
- [Source: apps/vscode-extension/src/tree/operator-handle.ts] — the extension copy (+ the "duplicated because no app↔cli dep" note to resolve).
- [Source: packages/cli/src/ui.ts:45-47,125-139] — the cli copy + its call site.
- [Source: packages/core/src/identity/register.ts:60, login.ts:28] — core's DIFFERENT `canonicalize` (out of scope).
- [Source: eslint.config.js] — `NO_CLIENT_FROM_CORE` + the leaf-app boundary (why core is the only shared home).
- [Source: .claude/rules/project-rules.md] — Rule 7 (mutation), Rule 13 (thin client / frozen agent contract), Rule 20 (full gate).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Mutation 1 (break trim — `raw.toLowerCase()` instead of `raw.trim().toLowerCase()`): `operator-handle.test.ts` RED (whitespace-only `'   '` and `'  Alice '` cases fail). Reverted.
- Mutation 2 (break null-on-empty — `return canonical` instead of `canonical === '' ? null : canonical`): `operator-handle.test.ts` RED (empty `''`/`'   '` cases fail). Reverted byte-identical → 3/3 GREEN.
- Contract freeze: `git diff HEAD -- packages/mcp-server/src` EMPTY. `git diff HEAD --stat -- packages/core/src` = only `index.ts` +7 (the additive barrel export); 2 new untracked files. 36/36 drift-guard tests green (`vitest -t "drift"`).
- Full Rule-20 ROOT gate: lint 0, typecheck 0, build clean (both VS Code bundles built), `pnpm test` 188 files / 1772 passed / 0 failed, `prettier --check` clean.

### Completion Notes List

- Extracted the duplicated operator-handle canonicalization (trim + lowercase → `null` on empty) into ONE shared `@agentbbs/core` util, `canonicalizeOperatorHandle(raw: string | undefined | null): string | null` (`packages/core/src/identity/operator-handle.ts`), re-exported from the core barrel. Closes `10.3-operator-handle-dup`.
- Both surfaces now IMPORT the shared util: `packages/cli/src/ui.ts#resolveOperatorHandle` delegates to it (single-`raw` signature preserved, call site at `ui.ts` unchanged); `apps/vscode-extension/src/tree/operator-handle.ts#resolveOperatorHandle` delegates to it (local `canonicalizeOperatorHandle` body DELETED; the precedence wrapper `settingValue → env` kept; header comment updated — the "duplicated because no app↔cli dep" note now records the resolution).
- The extension's existing test (`operator-handle.test.ts`) imported `canonicalizeOperatorHandle` from the now-deleted local export; updated it to import the shared rule from `@agentbbs/core` (its `resolveOperatorHandle` precedence tests are unchanged and still import locally). Both surfaces' existing tests stay green.
- SCOPE DISCIPLINE held: core's own `register.ts#canonicalize` / `login.ts#canonicalize` (`handle.toLowerCase()` only, no trim/null, pre-validated input — DIFFERENT semantics) were NOT merged; left byte-identical.
- AC2 contract freeze verified: the new core export is an internal helper, NOT a tool/event/error. `git diff HEAD -- packages/mcp-server/src` empty; the only core change is the additive barrel line + two new files; tool-contract / error-code / event drift guards all green.
- Behavior byte-identical: `'  Alice '`→`'alice'`, `'BOB'`→`'bob'`, `''`/`'   '`/`undefined`/`null`→`null` (pinned in the new core test, Rule-7 mutation-confirmed non-vacuous).
- Left UNCOMMITTED for the lead's post-CR smoke gate (no commit per dev-stage instruction).

### File List

- `packages/core/src/identity/operator-handle.ts` (new — shared `canonicalizeOperatorHandle`)
- `packages/core/src/identity/operator-handle.test.ts` (new — pins the shared rule; Rule-7 mutation-confirmed)
- `packages/core/src/index.ts` (modified — additive barrel export of `canonicalizeOperatorHandle`)
- `packages/cli/src/ui.ts` (modified — `resolveOperatorHandle` delegates to the shared core util; inline body removed)
- `apps/vscode-extension/src/tree/operator-handle.ts` (modified — local `canonicalizeOperatorHandle` deleted, imports the shared core util; header comment updated)
- `apps/vscode-extension/src/tree/operator-handle.test.ts` (modified — imports the shared `canonicalizeOperatorHandle` from `@agentbbs/core`)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — `10.3-operator-handle-dup` OPEN → RESOLVED with evidence; original retained)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story 13-5 → review + last_updated log)

### Change Log

- 2026-06-10: Story 13.5 implemented. De-duplicated the operator-handle canonicalization into one shared `@agentbbs/core` `canonicalizeOperatorHandle` util consumed by both operator surfaces; byte-identical behavior; 17-tool agent contract untouched; `10.3-operator-handle-dup` closed. Full Rule-20 gate green (1772 tests). Status → review.

## Review Findings (code-review, 2026-06-10)

**Outcome: APPROVE — 0 HIGH / 0 MED / 0 LOW. No auto-resolutions needed.**

Reviewer (claude-opus-4-8[1m]) independently verified every review-focus point against repo ground truth:

- **AC1 — ONE definition (verified):** `git grep "trim().toLowerCase()"` across `packages/cli/src` + `apps/vscode-extension/src` returns NOTHING — both local canonicalize bodies are deleted. Both surfaces `import { canonicalizeOperatorHandle } from '@agentbbs/core'`. The cli `resolveOperatorHandle(raw)` is a one-line delegate; the extension `resolveOperatorHandle(settingValue, env)` calls the shared rule twice and keeps ONLY its setting→env precedence. The shared util in `packages/core/src/identity/operator-handle.ts` is the single source.
- **Behavior byte-identical / matrix non-vacuous (Rule 7 — INDEPENDENTLY mutation-tested):** Reviewer mutated the shared rule (`raw.trim().toLowerCase()` → `raw.toLowerCase()`, dropping `.trim()`) and re-ran the affected tests: 18 failures across BOTH `packages/core/src/identity/operator-handle.test.ts` (single source of truth) AND `packages/cli/src/ui.test.ts` (cli surface) — the whitespace/internal-whitespace rows went RED on both. Reverted byte-identical → 36/36 GREEN. The matrices discriminate; they are not vacuous. (Dev/QA additionally documented a null-on-empty mutation.)
- **Three matrices consistent (verified):** core (12 rows incl. the `null` input row) ≡ extension (12 rows) ≡ cli (11 rows — `null` row correctly omitted, documented, because the cli wrapper signature is `string | undefined`). A drift on any one surface would go RED against the same shared behavior table. Boundary-forbidden single-import correctly worked around by duplicating the table as a SPEC.
- **AC2 / Rule 13 — agent contract FROZEN (verified):** `git diff HEAD -- packages/mcp-server/src` EMPTY. The new core export is an internal client-layer helper, NOT a tool/event/error. Core change is purely additive (one barrel line + two new files). `BOARD_ERROR_CODES` / `EVENT_TYPES` / tool-contract drift guards all green in the full root suite. Scope discipline HELD: core's `register.ts#canonicalize` / `login.ts#canonicalize` remain `handle.toLowerCase()`-only (no trim, no null) and were NOT merged — confirmed unchanged and absent from the diff.
- **Existing tests / precedence wrappers (verified):** extension setting→env precedence preserved (falls through a whitespace-only setting to `AGENTBBS_OPERATOR`, canonicalizes env value, setting wins); cli single-raw wrapper preserved. All existing tests green.
- **Rule 20 — FULL canonical ROOT gate re-run independently:** lint 0 / typecheck 0 / build 0 (both VS Code bundles built) / `pnpm test` 188 files, **1814 passed**, 0 failed / `prettier --check` clean. (The dev record's 1772 predates the QA matrix tests landing; 1814 is the current full-suite count — not a regression.)
- **deferred-work.md:** `10.3-operator-handle-dup` correctly flipped OPEN → RESOLVED with a complete, accurate evidence block; original entry retained. The `operator-skills-doc.test.ts` prose references to the slug are an unrelated doc-guard (still green) and out of scope.

Rules 1 / 3 / 5 / 6 N/A: pure internal refactor — no new service (no Integration AC owed), no new user-facing surface (behavior pinned by mutation-tested equivalence matrices, the correct evidence for a behavior-preserving de-dup), no unmeasurable NFR, no ADR in `docs/adr/`.
