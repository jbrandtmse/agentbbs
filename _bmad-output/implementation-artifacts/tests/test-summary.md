# Test Automation Summary — Story 9.14 (View + respond to announced proto-rooms + operator-UI polish)

QA stage of `/epic-cycle`. The dev stage already shipped strong coverage for all five ACs; the QA
value-add is (1) two new HARDENING tests filling specific load-bearing gaps the dev's tests
under-covered, and (2) three Rule-7 MUTATION proofs confirming the most load-bearing assertions are
non-vacuous (all reverted byte-identical). Canonical gate is ROOT `pnpm test` (Rule 12).

## Generated / Hardened Tests

### DOM (happy-dom, `ui-shared-dom` project — Rule 12)
- [x] `apps/web/src/App.test.tsx` — **AC5 "the open room stays LEGIBLE"** (new `describe`). The dev's
  exclusivity tests prove opening one panel CLOSES another; this pins AC5's *second* half they do not:
  opening an initiate panel WHILE a room is open does NOT destroy/overlay the room view — `room-view`
  AND `open-room-panel` coexist, and the room's message stays readable. Mutation-proven RED (gated the
  room render on `!announceComposeOpen` → test failed) then reverted.
- [x] `packages/ui-shared/src/chrome/A11yFloor.test.tsx` — **AC4 full pending→reconciled LIFECYCLE is
  silent** (new test). The dev's AC4 test jumps to the reconciled steady-state; this models the ACTUAL
  bug path: operator post appears PENDING (excluded as pending), THEN reconciles to a confirmed `ops`
  post (excluded as operator) → NO "1 new post" at EITHER phase, while another actor's reply still
  announces.

## Rule-7 mutation proofs (non-vacuity; all reverted byte-identical)
- [x] **AC1 dedupe** (`api-client.ts` — removed the `!seenRoomIds.has` filter) → the dev's
  proto-room/dedupe test went RED (duplicate `active-room` row). The QA-focus-requested discriminator
  proof the dev did not run (dev mutated only the reply-flip).
- [x] **AC4 self-post exclusion** (`MessageThread.tsx` — dropped the `m.actor === operatorHandle`
  exclusion) → the dev's AC4 test went RED ("1 new post" for the operator's own post). Confirms the
  exclusion is the load-bearing assertion (both sides — own-silent + other-announced — were pinned).
- [x] **AC5 room legibility** (`App.tsx` — hid the room when the panel opens) → the new legibility test
  went RED.

## Drift-guards verified
- [x] **Rule 13** — `git diff HEAD -- packages/core packages/mcp-server` is EMPTY (no core op, no MCP
  wire change, no `BOARD_ERROR_CODES` change). The proto-room navigability is a CLIENT-layer
  tree-model change; reply-to-activate reuses the EXISTING `reply` (Epic-4 min-seq activator). Verified
  before AND after all QA work.
- [x] No markdown code touched (the pre-existing transient Shiki-warmup flake is unrelated).

## Coverage (AC ↔ test tier)
- **AC1** (proto-rooms navigable + dedupe + pending→active flip): api-client unit (dedupe, bucket
  count), NavTree DOM (distinct pending row + still selectable), App DOM (navigable row + open + reply
  flips pending→active live), host integration over REAL `createDataAccess` (Rule 3 — proto-room served
  `active:false`, listed under /announcements not /rooms; reply activates → `active:true` + appears
  under /rooms + real `room.replied` + grant-on-act participant). Dedupe mutation-proven.
- **AC2** (join-first prominence): PostAnnouncementCompose DOM (labelled callout names project + "kept").
- **AC3** (watching-only): App DOM — both states pinned (disabled+reason for watching-only; ENABLED for
  a registered operator).
- **AC4** (self-post not announced): A11yFloor DOM — both sides (own silent, other announced) + the new
  full-lifecycle variant. Exclusion mutation-proven.
- **AC5** (panel exclusivity): App DOM — two close-pairs (start→open-room, open-room→join-picker) + the
  new "open room stays legible" hardening test. Legibility mutation-proven.

## Honest gate
- Root `pnpm test`: **1202 passed / 139 files / 0 failed / 0 skipped** (baseline 1200 → +2 QA tests).
- `pnpm run typecheck`: exit 0. ESLint on both touched test files: 0. `prettier --check`: clean.
- No `.only`/`.skip`/`.todo` (Rule 8 discoverability — both new tests run under the default `pnpm test`).

## Next steps
- Lead's real-Chrome smoke (per story §Smoke) is the separate downstream gate. Left UNCOMMITTED.
