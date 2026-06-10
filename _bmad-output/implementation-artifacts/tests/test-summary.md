# Test Automation Summary — Story 13.5 (operator-handle canonicalization de-duplication)

QA stage: `qa-generate-e2e-tests`. Date: 2026-06-10. Epic 13 (deferred-work cleanup & hardening).

Pure refactor (Rule 13 thin-client). The duplicated operator-handle canonicalization
(trim + lowercase → `null` on empty) is now ONE shared `@agentbbs/core` util
(`canonicalizeOperatorHandle`), imported by both the cli web host (`packages/cli/src/ui.ts`)
and the VS Code extension (`apps/vscode-extension/src/tree/operator-handle.ts`). Marquee risk =
BEHAVIORAL DRIFT from the extract-and-share. QA added a pre-refactor **equivalence matrix** on
all three surfaces.

## Generated Tests (QA additions — extensions to existing co-located test files)

### Equivalence matrix (documented pre-refactor behavior spec, pinned on each surface)
- [x] `packages/core/src/identity/operator-handle.test.ts` — `OPERATOR_HANDLE_EQUIVALENCE_MATRIX`
  (12 rows) + internal-whitespace-preservation case. The single source-of-truth behavior spec.
- [x] `packages/cli/src/ui.test.ts` — cli wrapper (`resolveOperatorHandle(raw)`) asserted against
  the same matrix (11 rows; the `null`-input row is omitted — the cli signature is
  `string | undefined`, matching the call site `--as ?? AGENTBBS_OPERATOR`).
- [x] `apps/vscode-extension/src/tree/operator-handle.test.ts` — extension `canonicalizeOperatorHandle`
  import asserted against the matrix (12 rows) + 4 precedence edges (tab/newline-only setting falls
  through to `AGENTBBS_OPERATOR`; env value canonicalized; whitespace-only env → null; setting wins).

The matrix is duplicated as a behavior SPEC (not a shared symbol) in each surface's discoverable
test because the eslint leaf-app / `NO_CLIENT_FROM_CORE` boundary forbids one file importing all
three wrappers. Drift on either surface goes red against the same table.

### Edge coverage beyond the dev's existing tests
- Tab / newline / mixed whitespace trimmed (`'\tAlice\n'`, `' \t \n MixedCase \r\n '`).
- INTERNAL whitespace PRESERVED (`'  Two   Words  '` → `'two   words'`, `'a\tb'`) — core canonicalize
  trims ends only, does NOT collapse/strip interior.
- Mixed-whitespace-only → null (`'\t\n\r '`).
- Extension precedence: a whitespace-only (tab/newline, not just spaces) setting canonicalizes to
  null and falls through to the env.

## Mutation testing (Rule 7 — non-vacuous confirmed)
- Mutation A (break trim → `raw.toLowerCase()`): 32 matrix/edge tests RED across all 3 surfaces.
  Reverted.
- Mutation B (break lowercase + null-on-empty → `return raw.trim()`): 41 tests RED. Reverted
  byte-identical; suite GREEN.

## De-dup verified (AC1)
- The ONLY `canonicalizeOperatorHandle` definition / operator-handle `raw.trim().toLowerCase()` is
  in `packages/core/src/identity/operator-handle.ts`. The extension surface has NO local canonicalize
  body (imports the shared util); the cli wrapper delegates. Genuinely ONE definition.

## Contract freeze verified (AC2)
- `git diff HEAD -- packages/mcp-server/src` EMPTY. 36/36 drift-guard tests green (tool / error /
  event vocab unchanged). The new core export is an additive internal helper, not a tool/error/event.

## Gate (Rule 20 — full ROOT)
- lint 0 / typecheck 0 / prettier --check clean (fixed one prettier warning on the extension test
  file via `prettier --write`) / `vitest run` 188 files / **1814 passed, 0 failed**
  (dev baseline 1772; +42 QA tests).

## Discoverability (Rule 8)
- All additions are in co-located `*.test.ts` files already in the default `vitest run` suite; the
  new rows ran in the full-suite invocation above. Nothing excluded or opted out.

## Next Steps
- Lead per-story smoke gate, then commit (QA left all changes uncommitted per stage instruction).
