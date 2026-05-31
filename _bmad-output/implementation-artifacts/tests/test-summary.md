# Test Automation Summary — Story 5.0 (Epic 4 deferred cleanup — deferred-work 4.3-a)

QA stage of the `/epic-cycle` for Story 5.0. This is a LEAN test-hardening story whose entire purpose is closing ONE specific test gap (deferred-work **4.3-a**: malformed-`room_id`/`handle` Zod-boundary-rejection coverage for the room WRITE tools). The dev stage already closed it with 3 negative-path cases. This QA pass ASSESSED whether the boundary coverage is now complete and sound — and concluded **adding 0 tests is the correct call** (closing a specific, already-closed gap; padding would be gold-plating).

## Dev-stage tests judged (kept as-is, all real-runtime — `Client`↔`McpServer`↔`InMemoryTransport`↔real `createDataAccess`/SQLite)

### `packages/mcp-server/src/tools/reply.integration.test.ts` (+1 case)
- "rejects a malformed room_id (empty / whitespace / non-slug charset) at the Zod boundary BEFORE core". Establishes a GENUINE active room first (announce → post → a real reply ⇒ real `room.replied` count = 1), then drives `reply` with `room_id` ∈ `['', '   ', 'Bad Room!', 'UPPER', '--leading', 'a..b']`. Each: `isError === true`, `readErrorPayload(result) === undefined` (a Zod rejection carries NO closed board code — the discriminator vs the `ROOM_NOT_FOUND` case, where a well-formed-but-unknown id reaches core), `maxSeq` unchanged, real `room.replied` stays 1.

### `packages/mcp-server/src/tools/add-participant.integration.test.ts` (+1 case, covers BOTH charset params)
- "rejects a malformed room_id OR a malformed handle at the Zod boundary BEFORE core". Establishes a real `room.participant_added` (B replies → B pulls in C ⇒ count = 1), then drives malformed `room_id` (valid handle) AND malformed `handle` (valid room_id) ∈ `['', '   ', 'Bad Handle!', 'has space', 'UPPER!']` against the shared `handleSchema` (`^[a-z0-9._@-]+$`). Each rejected at the boundary, `maxSeq` unchanged, real `room.participant_added` stays 1.

### `packages/mcp-server/src/tools/read-room.integration.test.ts` (+1 READ-side parity case)
- "rejects a malformed room_id … isError, NOT ROOM_NOT_FOUND (READ-side parity)". `read_room` reuses the same `roomIdSchema`; a pure read never appends, so the boundary guarantee here is "rejected, no closed code" (not a ledger delta). Genuine new coverage — `read_room`'s suite previously had only the well-formed-but-unknown `ROOM_NOT_FOUND` semantic path.

## QA-added test
- **NONE.** This story exists to close deferred-work 4.3-a (the room WRITE tools' malformed-`room_id`/`handle` boundary-rejection gap). The dev closed it completely; there is no genuine remaining room-tool boundary gap to fill. Adding a test would either duplicate the dev's coverage or creep outside the 4.3-a scope.

## Coverage assessment (why 0 is right)
- **Both write tools × both malformed dimensions: COVERED.** `reply`'s only charset-validated param (`room_id`) and `add_participant`'s BOTH charset params (`room_id` AND `handle`) are each exercised with empty/whitespace/uppercase/spaces/punctuation/leading-or-double-hyphen inputs. `reply`'s `body` is the deferred 256 KB cap — explicitly **Story 5.1's** (deferred-work 4.3-b), correctly NOT touched here.
- **"Nothing appended" assertion is GENUINE (not `=== 0`).** Both write-tool tests establish a REAL prior event (real `room.replied`/`room.participant_added` count = 1) via real tool calls, capture `maxSeq()` before each rejected call, and assert both `maxSeq` unchanged AND the real event count stays at 1 — the stronger "a valid op DID append, a malformed one does NOT" guarantee the AC asked for.
- **Boundary-vs-core discriminator is correct.** Every malformed case asserts `readErrorPayload(result) === undefined` (Zod rejection, no closed code), distinguishing it from the `ROOM_NOT_FOUND`/`HANDLE_NOT_FOUND` core paths (which DO carry a closed code) — proving the rejection happened at the Zod boundary BEFORE the core delegate (so no append path was reached).
- **`list_*` `project_id` parity: OUT OF SCOPE (scope discipline).** 4.3-a / AC #1 scope this to the room WRITE tools (`reply`/`add_participant`). A `list_announcements`/`list_rooms` `project_id` rejection is a different (READ) tool family, and codebase-wide precedent (documented across the 4.3/4.4/4.5 deferral notes) is that no `list_*` tool pins a syntactic slug-rejection call test. The dev already added one optional in-scope READ parity (`read_room`); reaching into `list_*` would be scope creep, not a genuine room-tool gap.
- **Rule 3 (real-runtime evidence):** all three cases run over the real `Client`↔`McpServer`↔SQLite stack (nothing mocked).
- **Rule 8 (discoverability):** all three files are co-located `*.integration.test.ts`, matched by the root vitest `include` glob `packages/*/src/**/*.test.{ts,tsx}`, not excluded; no `.only`/`.skip`/`.todo` anywhere in the tools dir (grep-verified).

## Result
- Target suites (the 3 touched files): **3 files / 28 tests pass** (`vitest run`). The 3 new boundary-rejection cases isolated by `-t "boundary"` → 3 passed / 25 skipped (one new case per file).
- Build clean (7/7) before the run (forked cross-process workers resolve `@agentbbs/core` via `dist`).
- No production source changed; no new test files; full-suite delta from the story's dev run is +3 (475 → 478).
