# Test Automation Summary — Story 9.11 (QA generate-e2e-tests stage)

Story: 9.11 — Start a negotiation (announce a project & open a room).
Stage: qa-generate-e2e-tests. Generated against the dev's uncommitted changeset.

## Generated Tests (QA hardening — gaps beyond the dev's coverage)

Added one describe block to `packages/cli/src/host/json-api.test.ts` (real in-memory
`createDataAccess` ledger, Rule 3 — nothing mocked):

`handleApiRequest — Story 9.11 qa: atomicity + gate-order (the load-bearing semantics)`
- [x] **announce_project atomicity by SPECIFIC event** — a duplicate-title announce appends
  NEITHER `project.announced` NOR `board.joined` from the re-announcing operator (sharpens the
  dev's maxSeq-only "nothing appended" to the faithful atomic-rollback property the AC promises);
  also asserts the original project is intact (still alice's, exactly one project).
- [x] **post_announcement NOT_A_MEMBER atomicity by SPECIFIC event** — a non-member post appends
  no `announcement.posted` by that actor (sharpens maxSeq to the specific missing event).
- [x] **post_announcement GATE ORDER** — a NON-member with an OVER-CAP body gets `NOT_A_MEMBER`
  (403, the join-first handoff), NOT `BODY_TOO_LARGE` (413). Pins that core runs the membership
  gate BEFORE the body cap (post-announcement.ts:123 before :129). PREVIOUSLY UNTESTED through
  the host — the dev's separate NOT_A_MEMBER / BODY_TOO_LARGE cases cannot catch an order flip.

## Mutation-tests (Rule 7 — non-vacuous proof, both reverted byte-identically)
- **Gate-order**: temporarily flipped `post-announcement.ts` (cap before membership) → the
  gate-order test went RED (403→413). Reverted via `git checkout`; `git diff HEAD` empty.
- **Rule 13 drift-guard**: temporarily appended a phantom code to `BOARD_ERROR_CODES` → the
  existing closed-set pin went RED. Reverted; core + mcp-server `git diff HEAD` empty.

## Coverage
- announce_project endpoint: happy + PROJECT_EXISTS(409) + NO_OPERATOR(403) + BAD_REQUEST(400)
  + atomicity-by-event — covered.
- post_announcement endpoint: happy + NOT_A_MEMBER(403) + BOARD_NOT_FOUND(404) +
  BODY_TOO_LARGE(413) + NO_OPERATOR(403) + BAD_REQUEST(400) + gate-order + atomicity-by-event
  — covered (unit + real-HTTP integration).
- ui-shared compose components + ApiError client surfacing: dev coverage adequate; not duplicated.

## Gate (canonical root `pnpm test`, Rule 12)
- `vitest run`: 137 files, 1136 passed, 0 failed, 0 skipped (was 1133; +3 new).
- eslint clean; `tsc --noEmit` clean (whole project); prettier clean. No `.only`/`.skip`/`.todo`.
- Rule 13: `git diff HEAD -- packages/core packages/mcp-server` EMPTY (contract byte-identical).

## Decision on concurrency (Rule 5 judgment)
No forked cross-process race added. `announceProject` title-uniqueness rides the `appendGuarded`
primitive already cross-process-proven by `data-access/register-race.test.ts` +
`concurrency.test.ts`; `postAnnouncement` room-id disambiguation by `post-announcement-race.test.ts`.
The 9.11 host endpoints are thin HTTP wrappers over those proven ops — a new fork here would
re-prove the data-access primitive, not the host. Atomicity (the host-level property) is pinned
in-process by the event-presence assertions above.
