# Test Automation Summary — Story 11.2 (Export the ledger to a logical archive)

QA stage: `qa-generate-e2e-tests`. Date: 2026-06-06.

## Scope

Story 11.2 ships `agentbbs export` (the logical NDJSON archive) + the shared `archive.ts`
codec. The dev's test suite was already strong (real `createDataAccess` ledger, header/round-trip/
read-state/empty-board/error coverage). This QA stage STRENGTHENED it along the five QA goals
without touching production code (`archive.ts` / `export.ts` byte-identical — the temporary Rule-7
mutation of `serializeArchive` was reverted byte-identical; `git diff` on `archive.ts` is empty).

## Generated / strengthened tests

### Lossless completeness — all 10 EVENT_TYPES (QA goal 4)

- [x] `packages/cli/src/export.test.ts` — the `seedBoard` helper now exercises **every one of the
  10 closed `EVENT_TYPES`** over the REAL ledger: added `identity.focus_updated` (alice
  `updateFocus`), `room.participant_added` (bob pulls carol in via `addParticipant`), and
  `message.unreacted` (alice 👍 her own reply then retracts it — bob's 👍 on the contract stays
  live). New test `LOSSLESS COMPLETENESS — every one of the 10 EVENT_TYPES serializes + round-trips`
  asserts every type is present in the archive AND the whole ledger round-trips `toEqual(eventsSince(0))`.
  This is the institutional-memory guarantee: no event type is dropped or mangled by the codec.

### Marquee non-vacuity — genuine codec discrimination (QA goal 2, Rule 7)

- [x] `packages/cli/src/archive.test.ts` — replaced the weak parsed-output-tamper "non-vacuous"
  test (which never exercised the codec) with THREE real discrimination tests that feed
  `parseArchive` a buggy archive and assert the round-trip equality the real test relies on goes
  FALSE: (1) event lines missing `actor`, (2) event lines missing `seq`, (3) a dropped read-state
  line. A vacuous round-trip would fail these.
- [x] **Mutation-tested the marquee end-to-end (Rule 7):** temporarily mutated the production
  `serializeArchive` to drop the `actor` field → the `export.test.ts` round-trips
  (`parsed.events).toEqual(eventsSince(0))`) + the codec serialize/parse test went **RED (4
  failures)** → reverted `archive.ts` **byte-identical** → green. Proven non-vacuous, not asserted.

### Populated real-spawn export (QA goal 1, Rule 3)

- [x] `packages/cli/src/bin-spawn.e2e.test.ts` — new test
  `export <file> --db <seeded>` **seeds a real on-disk ledger in-process** (registrations, a
  project, a room, two replies, a stored `check` cursor), **closes it**, then SPAWNS the BUILT
  bin (`packages/cli/dist/index.js`) to export it to a FILE, and **parses the file back**: asserts
  the event seqs equal the seeded ledger, the header `event_count` matches, and bob's non-zero
  read-state cursor was captured. (The pre-existing spawn test only exported an EMPTY board —
  header-only; this proves the real operator binary round-trips actual board DATA.)

## AC coverage confirmation (no change needed — dev already satisfied)

- **AC2 no-SQLite-leakage (Rule 18 precise-token):** the dev's leakage guard uses SQL-shaped
  matchers (`/FROM\s+events/i`, `/FROM\s+cursors/i`, `PRAGMA`, `rowid`, `sqlite`, `CREATE TABLE`,
  the `.db` path) and deliberately does NOT bare-substring-check the `events`/`cursors` table names
  (the legitimate header tokens `ndjson-events` ⊃ `events`, `cursor_count` ⊃ `cursor` would
  false-positive). The header is defined against `EVENT_TYPES` (`buildHeader` → `[...EVENT_TYPES].sort()`).
  Confirmed correct.
- **AC3 read-state losslessness:** the seed registers carol + alice who never `check` (cursor 0 →
  omitted as byte-equivalent to absent); only bob's non-zero cursor is captured. The test asserts
  exactly `[{ handle: 'bob', cursor }]`, proving the zero-sentinel omission is lossless.

## Gate

- ROOT `pnpm test` (the canonical gate — Rule 12, never per-package): **177 files / 1526 tests
  passed** (was 1522; +4 net new). All new tests are co-located `*.test.ts`, discoverable by the
  default suite (Rule 8).
- Production code byte-identical: `git diff HEAD -- packages/cli/src/archive.ts` empty; no edit to
  `export.ts` in this stage.

## Next steps

- Story 11.3 (import) will consume this archive format; the round-trip becomes export→import→derive.
- Story 11.4's `cursors` round-trip is now achievable (read-state captured + proven lossless here).
