# Test Automation Summary — Story 11.0 (Epic-10 deferred cleanup; test-infra)

This story ships **no production code** — it stabilizes two long-carried intermittent flakes
(AC1 Windows `seed-protocol-race` teardown `EPERM`; AC2 Shiki full-suite tokenizer flake) and adds
one cap-edge unit test (AC3 `roomIdSchema`). The agent contract (`packages/core`,
`packages/mcp-server/src`) is **byte-identical** (Rule 13). QA scope here is verification +
non-vacuity hardening, NOT a new feature suite. All new/modified tests are discoverable by ROOT
`pnpm test` (Rule 8). The canonical gate is the ROOT `pnpm test` (Rule 12 corollary — never a
per-package run).

## What QA verified

### AC1 — `seed-protocol-race.test.ts` stabilization did NOT weaken the race assertions
- Diffed HEAD vs working: the change touches ONLY the teardown helpers (`reapChildren` now
  async-awaits each killed child's bounded exit; `removeTempTree` swallows a residual
  post-assertion removal error) and the `afterEach`/`finally` call sites. **Zero assertion lines
  changed.**
- The 8 race assertions (`results` length = N_WORKERS, every worker `seeded`, exactly-one
  `protocolAnnouncementCount`/`mainProjectCount`/`systemIdentityCount` === 1, `protocolRoomPresent`,
  `mainHasSystemMember`) are **byte-identical in substance** (content-grep of `expect(...)` lines
  identical, only line numbers shifted by added comments). `os.tmpdir()` discipline preserved.

### AC2 — `highlight.test.ts` stabilization did NOT weaken the NFR12 invariants
- Content-only diff (line numbers stripped): the ONLY substantive change is the import line gaining
  `beforeAll` + the added `beforeAll(prewarmHighlighter)` block. All 18 NFR12 assertions (class-spans
  only / never inline `style=`/`color:`; HTML-escaped token text; the four `.code-*` tints;
  unknown-lang inert fallback; `escapeHtml`) are **byte-identical**. Only singleton-init timing made
  deterministic via the established prewarm discipline.

### AC3 — `roomIdSchema` cap-edge test is non-vacuous (Rule 7), independently confirmed
- Ran the dev's 3-test file via ROOT vitest (node project) → green; the file IS discovered by the
  default suite (matches `packages/*/src/**/*.test.ts`, not a `.tsx`, not gitignored, no opt-out tag).
- **Independent mutation test:** set `ROOM_ID_MAX_LENGTH = 201` → all 3 dev tests RED (literal-200
  pin + at-cap accept + over-cap reject all discriminate). Reverted byte-identical
  (`git diff HEAD -- room-shared.ts` empty) → green.

## QA-added tests (genuinely-additive boundary completion — same `roomIdSchema`, no new surface)

### `packages/mcp-server/src/tools/room-shared.cap-edge.test.ts`
- [x] ACCEPTS a `room_id` of cap-1 length (199) — the just-inside point, so the at-cap (200) accept
  cannot pass merely because the schema accepts everything.
- [x] REJECTS an empty `room_id` (the lower length bound) — the symmetric other end of the cap RANGE
  `[1, 200]`. (Comment notes the rejection is enforced by `.min(1)` AND the slug `regex`; the test
  pins the observable contract that a zero-length id never reaches core.)

## Mutation tests (Rule 7 — RED under mutant, reverted byte-identical)
- `ROOM_ID_MAX_LENGTH = 201` → dev's 3 tests RED (upper-cap discrimination).
- `.min(0).max(ROOM_ID_MAX_LENGTH - 2)` → the new at-cap (200) + cap-1 (199) accept tests RED
  (upper-bound discrimination of the additive 199 case). Empty-rejection held under `.min(0)` because
  the slug regex also forbids zero length — comment adjusted to not overclaim it isolates `.min(1)`.
- All production mutations reverted; `git diff HEAD -- packages/mcp-server/src/tools/room-shared.ts`
  empty.

## Gate evidence
- ROOT `pnpm test`: **173 files / 1489 tests** green (1487 dev baseline + 2 QA-added cap-edge cases).
- **Flake corroboration (Rule 12 fidelity):** 3 consecutive clean ROOT runs this session (1489/1489
  each), no `EPERM`, no Shiki flake, no FAIL — on top of the dev's 5 prior runs = 8 consecutive green
  full-suite runs.
- Contract byte-identical (Rule 13): `git diff HEAD -- packages/core packages/mcp-server/src`
  (excluding the new untracked test file) is empty; the schema `room-shared.ts` is unchanged.

## Coverage
- `roomIdSchema` length boundary: lower edge (empty reject), just-inside (199 accept), at-cap (200
  accept), over-cap (201 reject), + the literal-200 constant pin — full range edge covered.
- AC1/AC2: no new assertions (stabilization only); existing race + NFR12 invariants confirmed intact
  and green under repeated parallel load.

## Next Steps
- The lead's per-story smoke gate re-runs `pnpm test` (the flakes are intermittent; more repetitions
  add confidence). No deferred items added by this story.
