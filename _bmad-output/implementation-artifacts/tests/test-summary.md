# Test Automation Summary — Story 9.12 (join a project from the tree)

Stage: qa-generate-e2e-tests. Generated against the dev's uncommitted changeset.
Focus: the load-bearing joinable-filter semantics + calm-UX invariants a naive test misses.
All run under the `ui-shared-dom` (happy-dom) Vitest project; canonical gate is ROOT `pnpm test`
(Rule 12 corollary).

## Generated Tests

### ui-shared picker DOM (`packages/ui-shared/src/compose/JoinProjectPicker.test.tsx`, +3)
- [x] NOT a modal — role-based assertion (`role="group"`; no `role="dialog"`/`alertdialog`/`aria-modal`)
- [x] inline error slot renders WITH the list intact AND fires no `onChoose`/`onCancel` (no silent side effect)
- [x] a disabled (pending) choose row does NOT fire `onChoose` on click (behavioral no-double-submit)

### apps/web integration DOM (`apps/web/src/App.test.tsx`, +5)
- [x] canonical compare — operator a member under a DIFFERENT CASE is STILL excluded (mutation-tested RED vs raw `.includes`)
- [x] watching-only host (`operatorHandle === null`) lists ALL projects (host enforces the gate at choose-time)
- [x] empty-joinable calm state — operator already in EVERY project → calm "no projects to join" line (not an error)
- [x] choose → `postJoin` NO_OPERATOR (403) surfaces calm INLINE error, picker STILL open, no silent swallow / no crash
- [x] re-opening after a FAILED join still offers the project (no false optimistic membership)

## Production hardening (QA — Rule 8 reconcile, Rule 7 proven)
- `apps/web/src/App.tsx` joinable filter: raw `members.includes(operator)` → canonical
  `members.some(m => m.toLowerCase() === operator)`, so the filter does not silently depend on the
  distant board-canonicalization invariant. Matches the story's stated "canonical-handle compare".
  Mutation-tested non-vacuous (Rule 7): reverting to raw `.includes` turns the canonical-compare
  test RED (mixed-case `Ops` member leaks into the picker); restored byte-identically; suite green.

## Coverage
- Joinable filter: canonical compare + null-operator + empty-set + idempotent-no-re-offer (dev) covered.
- Calm UX: no-modal (role), inline error + picker-stays-open, disabled-behavioral, failed-join no false membership.
- Rule 13 drift-guard: `git diff HEAD -- packages/core packages/mcp-server packages/cli/src/host`
  EMPTY (byte-identical agent contract; picker reuses the existing `join_board` endpoint, no new op).

## Gate (canonical root `pnpm test`, Rule 12)
- `vitest run`: 138 files, 1157 passed, 0 failed, 0 skipped (baseline 1149 → +8).
- eslint 0; `tsc --noEmit` clean (whole project); prettier --check clean. No `.only`/`.skip`/`.todo` (Rule 8).

## Next Steps
- Lead per-story real-Chrome smoke (informational gate) — see story §Smoke.
