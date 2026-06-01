---
baseline_commit: e66fe6c
---

# Story 5.1: Post a verbatim message with a size cap

Status: review

## Story

As a participant,
I want to post a freeform message that the board stores verbatim,
So that I can negotiate in long-form Markdown without the board ever parsing my content.

## Acceptance Criteria

1. **Given** I am a participant in a room (I post via `reply` — the room-message surface; there is no separate `message.posted` event — and the announcer posts the seeding body via `post_announcement`),
   **When** I post a message body (CommonMark by convention) at or below the 256 KB cap,
   **Then** the event (`room.replied` / `announcement.posted`) is appended storing the body VERBATIM with NO parsing or transformation, and `read_room` returns it BYTE-FOR-BYTE.

2. **Given** a body whose UTF-8 byte length exceeds the **256 KB** cap (`MAX_BODY_BYTES = 256 * 1024 = 262144` bytes),
   **When** I post it (via `reply` OR `post_announcement`),
   **Then** the call is rejected with `BODY_TOO_LARGE` (the closed error code, already in `BOARD_ERROR_CODES`) and NOTHING is appended,
   **And** the check is on BYTE length (not character count) and lives in CORE (so the closed `BODY_TOO_LARGE` code is returned for every client — a Zod `.max` boundary rejection would carry no closed code).

3. **Given** the Epic 3/4 posting gates,
   **When** a NON-member of a sub-board calls `post_announcement` (the membership-GATED post — broadcasting a need),
   **Then** the call is rejected with `NOT_A_MEMBER` (reaffirming the Story 4.1 gate — this IS "the Epic 3/4 gating"),
   **And** `reply` (the room-message post) GRANTS participation by design ("acting = joining", Story 4.3) — so a previously-non-participant who replies simply becomes a participant; the room-message surface therefore has NO `NOT_A_MEMBER` path (see Dev Notes "Design decision: the NOT_A_MEMBER reconciliation").

4. **(Integration AC — real MCP server over the real SQLite ledger.)**
   **Given** the real `McpServer` + real SQLite ledger driven by a real MCP `Client` over `InMemoryTransport`,
   **When** a member posts a `reply` AND a `post_announcement` with a near-cap (just under 256 KB) multi-paragraph Markdown/unicode body,
   **Then** each is stored verbatim and `read_room` returns the body byte-for-byte (`===` + exact UTF-8 byte length),
   **And** a `reply` AND a `post_announcement` with a body just OVER 256 KB are each rejected with `BODY_TOO_LARGE` and append NOTHING (event counts unchanged),
   **And** a non-member's `post_announcement` is rejected with `NOT_A_MEMBER` (Epic 3/4 gating reaffirmed).

## Review Findings

**Code review — 2026-05-31 — APPROVED (0 HIGH / 0 MED; 1 LOW residual deferred, 1 LOW auto-fixed). Reviewer: Claude Opus 4.8 (1M).**

Adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) + the 7 directive verifications all clean. Full honest gate re-run GREEN: lint 0 / build 7-7 / typecheck 0 / test **500 passed (71 files)** / format `--check` clean. (Dev recorded 496; QA's added multi-byte-boundary straddle tests in `body-cap.test.ts` + the ROOM_NOT_FOUND-collision case in `reply.test.ts` bring it to 500 — count reconciled.)

**Independent verification results:**

1. **Append invariant + module boundary (V1) — PASS.** The cap throws BEFORE any append for BOTH ops: `reply` builds `toAppend` then calls `assertBodyWithinCap(body)` (line 122) before `dataAccess.append` (line 127) — an over-cap reply lands NOTHING, not even the conditional `board.joined` (proven: `reply.test.ts` over-cap case asserts `room.replied`=0 AND `board.joined` unchanged at 2 — no auto-join leak). `post_announcement` calls `assertBodyWithinCap` (line 129) after `requireMembership` and before the `appendGuarded` loop. Bodies stored verbatim — confirmed end-to-end through the code: `payloadToWire` (`body: p.body`) → INSERT-only `append.ts` → `wireToPayload` (`String(wire.body)`, identity on a string) → `roomMessages` (`event.payload.body`) → `messageToWire` (pass-through). No transform/truncation/normalize anywhere. `core` imports only the `DataAccess` port (lint rule `NO_CLIENT_FROM_CORE` enforces it; `body-cap.ts` imports only `../errors.js`). **CRITICAL Buffer check:** the ambient `declare const Buffer` did NOT pull `@types/node` into core — VERIFIED LOAD-BEARING by probe: compiling core with a `Buffer` use but no ambient decl fails `TS2591: Cannot find name 'Buffer'. Do you need to install type definitions for node?`, proving `@types/node` is genuinely absent from core's TS type closure (the runtime `require.resolve` hoist does not leak into `tsc`'s `types`). The minimal ambient exposes ONLY `Buffer.byteLength` — narrower than `"types":["node"]` or a triple-slash ref — so the boundary is preserved and the core type surface is not widened. `pnpm run build` green across 7 packages (core compiles WITHOUT @types/node).

2. **AC #2 — BODY_TOO_LARGE correctness (V2) — PASS.** The cap is a CORE `BoardError('BODY_TOO_LARGE')` (closed code at `errors.ts:36`, routed generically by `error-map.ts`), NOT a Zod `.max`. The interim char `.max` was DROPPED from `announcementBodySchema` (now `z.string().min(1)`); `.min(1)` kept; subject `.max(200)` kept; `ANNOUNCEMENT_BODY_MAX_LENGTH` cleanly retired (grep: zero production-source references — only historical doc mentions + one "was retired" comment). Cap on UTF-8 BYTE length (`Buffer.byteLength(body,'utf8')`). Multi-byte edge GENUINELY proves byte semantics: exact-at-cap with a 4-byte emoji tail AND a 3-byte CJK tail both PASS (total === MAX_BODY_BYTES, boundary lands ON the multi-byte unit); +1 whole emoji crosses by exactly its 4 bytes and THROWS. Integration test confirms the closed code over the real stack (`readErrorPayload(...).code === 'BODY_TOO_LARGE'`).

3. **AC #1 — verbatim (V3) — PASS.** The integration test round-trips an AT-CAP (exactly 262144-byte) multi-paragraph Markdown/unicode body (code fences, emoji, CJK, RTL, combining marks, ZWJ, trailing whitespace+tab) through `reply` AND `post_announcement` → ledger → `read_room`, asserting `=== ` byte-for-byte + exact UTF-8 byte length + exact code-unit length, AND the durable `room.replied`/`announcement.posted` event carries the identical body. No parse/transform.

4. **AC #3 — NOT_A_MEMBER reconciliation (V4) — PASS, sound (not a missing gate).** `reply` has NO membership gate (verified: no `requireMembership` import/call — it GRANTS participation per 4.3 "acting = joining", appending a conditional `board.joined`). The NOT_A_MEMBER path is `post_announcement`'s sub-board gate (4.1 `requireMembership` runs first), reaffirmed in the integration test (non-member → NOT_A_MEMBER, nothing appended). The reconciliation is correct: a reply-side gate would break 4.3's open-negotiation property.

5. **Gate/cap ordering (V5) — PASS, intentional & correct.** `post_announcement` non-member + over-cap → NOT_A_MEMBER (gate before cap: `requireMembership` line 123 precedes `assertBodyWithinCap` line 129; unit test `cleo` non-member over-cap → NOT_A_MEMBER, integration test confirms). `reply` over-cap to UNKNOWN room → ROOM_NOT_FOUND (findRoom lines 93-99 precede the cap line 122; QA's collision test locks it). Ordering is right — a non-member / unknown-room caller should not learn their body's cap fate first. No `board.joined` auto-join leaks on an over-cap reply (asserted).

6. **Existing Epic 4 tests still green (V6) — PASS.** Dropping the Zod char cap + adding the core check broke no reply/post_announcement/read_room test; full suite 500/71 green.

7. **Full gate, honest order (V7) — PASS.** lint → build → typecheck → test → format, all green (500/71).

**Rules:** Rule 1 (AC #4 Integration AC) — GENUINE over real `Client`↔`McpServer`↔SQLite (nothing mocked; DB in os.tmpdir). Rule 3 — the cap + verbatim proven on the real runtime, not a mock. Rule 4 — the dev correctly caught that the source-fact "Buffer allowed in core" was FALSE at build time (TS2591) and handled it with the ambient decl; re-verified here. Rule 5 — the 256 KB cap is the specified NFR6/AR7; implementing it IS the story, no NFR-tripwire dodge. Rule 6 — N/A (no `docs/adr/`).

**Decisions:**
- **LOW · auto-RESOLVED (fixed in this review):** stale "defers the formal cap / introduces no body-size code" header comments in `packages/mcp-server/src/tools/reply.ts` and `post-announcement.ts` were FALSE post-landing — rewritten to state the cap is enforced in core before append. Comment-only; gate stayed green.
- **LOW · DEFERRED (residual of 4.3-b):** no cap-edge test for `room_id` `ROOM_ID_MAX_LENGTH`=200 (unaffected by the body-cap work; a `room_id` is op-allocated so 200 chars is unreachable via post). Tracked as `5.1-roomid-cap-edge` in deferred-work.md.
- **deferred-work.md reconciled:** 4.3-b's body-cap half marked RESOLVED by Story 5.1 (with evidence); ledger snapshot + the carried-forward block updated; new "code review of story 5.1" section added.

## Tasks / Subtasks

- [x] Task 1: Core body-cap primitive → `BODY_TOO_LARGE` (AC: #2)
  - [x] Add `packages/core/src/rooms/body-cap.ts` (or a sensibly-placed core module): export `MAX_BODY_BYTES = 256 * 1024` and `assertBodyWithinCap(body: string): void` that throws `BoardError('BODY_TOO_LARGE', …)` iff `Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES`. Pure, no I/O. Message should state the cap + the actual size. Export from `packages/core/src/index.ts`.
  - [x] Unit-test: a body exactly AT the cap (`byteLength === MAX_BODY_BYTES`) passes; one byte over throws `BODY_TOO_LARGE`; a multi-byte-UTF-8 body (emoji/CJK) is measured by BYTES not chars (a string of N chars whose UTF-8 length exceeds the cap is rejected; N chars under the byte cap pass) — this pins the byte-vs-char decision.
- [x] Task 2: Enforce the cap in the body-bearing core ops (AC: #1, #2)
  - [x] In `packages/core/src/rooms/reply.ts` and `packages/core/src/rooms/post-announcement.ts`, call `assertBodyWithinCap(body)` BEFORE any append (nothing is appended on over-cap). For `reply`: after `findRoom`/gate resolution is fine, but ensure the throw precedes `dataAccess.append`. For `post_announcement`: before the `appendGuarded` room-id allocation loop. Do NOT change the verbatim storage (the body is already appended unchanged).
  - [x] In `packages/mcp-server/src/tools/room-shared.ts`, replace the interim `announcementBodySchema` char cap: drop `.max(ANNOUNCEMENT_BODY_MAX_LENGTH)` (the 16 000-char interim) so a large body REACHES core and is rejected with the closed `BODY_TOO_LARGE` code rather than a generic Zod error; keep `.min(1)` (non-empty). (Keep the `announcementSubjectSchema` `.max(200)` — subjects are short lines, a Zod rejection is correct there; only the BODY gets the core byte-cap + closed code.) Update the now-stale comments + remove/retire `ANNOUNCEMENT_BODY_MAX_LENGTH` if no longer referenced (or repoint it at `MAX_BODY_BYTES` with a note that the boundary no longer caps chars).
  - [x] Confirm the existing `reply`/`post_announcement` unit + integration tests still pass (the happy path is unchanged; only over-cap behavior is added).
- [x] Task 3: Verbatim guarantee (AC: #1, #4)
  - [x] Add/strengthen a test proving a body is stored byte-for-byte through the FULL path (`reply`/`post_announcement` → ledger → `read_room`): a multi-paragraph CommonMark body with code fences, unicode (emoji/CJK/RTL/ZWJ), control chars, and trailing whitespace round-trips `===` with identical UTF-8 byte length. (Epic 4's NFR6 tests already cover much of this for `read_room`; ensure the near-cap size dimension is covered.)
- [x] Task 4: Integration AC + full gate (AC: #4)
  - [x] Add `packages/mcp-server/src/tools/body-cap.integration.test.ts` (or extend `reply`/`post-announcement` integration tests): real `Client`↔`McpServer` over `InMemoryTransport` + real SQLite proving AC #4 — near-cap reply AND announcement stored verbatim (byte-identical via `read_room`); just-over-cap reply AND announcement → `BODY_TOO_LARGE`, event counts unchanged; non-member `post_announcement` → `NOT_A_MEMBER`. Build the near-cap/over-cap bodies programmatically (e.g. `'a'.repeat(MAX_BODY_BYTES)` for an ASCII at-cap body; `+ 'a'` for over).
  - [x] Run the full gate in honest order: `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` → `pnpm test` → `pnpm run format` (`--check`). All green. Note the final count (Epic 5 at 478 after Story 5.0).

## Dev Notes

This story finalizes the **message body-size cap** (the formal 256 KB `BODY_TOO_LARGE`, which Epic 4 explicitly deferred — see deferred-work 4.3-b and the interim `room-shared.ts` cap) and pins the **verbatim-storage** guarantee. A "message" is a `reply` (`room.replied`); the announcement body (`announcement.posted`) is the same body class — the cap applies to both. NO new event type; reuses the existing closed `BODY_TOO_LARGE` code.

**Rule 1 (Integration ACs):** AC #4 is the real-runtime Integration AC (the cap + verbatim + the reaffirmed gate over real MCP + real SQLite). Not a new service — it hardens the existing posting surface; the Integration AC covers the changed behavior.
**Rule 3 (real-runtime evidence):** the cap + verbatim round-trip proven over the real `Client`↔`McpServer`↔SQLite stack.
**Rule 4 (verify source-facts):** the Source facts below were verified against the repo at story creation (neither core op currently checks body size; the cap is the interim Zod `.max`). The dev should re-confirm before coding.
**Rule 5 (NFR tripwire):** N/A — the 256 KB cap is a MEASURABLE, specified NFR (NFR6/AR7); implementing it is the story, not a workaround.
**Rule 6 (ADR):** N/A — no `docs/adr/`.

### Design decisions (grounded at story creation, baseline `e66fe6c`)

1. **The cap check lives in CORE and returns the closed `BODY_TOO_LARGE` code — NOT a Zod `.max`.** A Zod boundary rejection carries no closed `{code}` (it is an `InvalidParams`, proven by Story 5.0's `readErrorPayload === undefined` discriminator). The architecture commits `BODY_TOO_LARGE` as a closed, versioned error code, so the cap must be a `core` `BoardError('BODY_TOO_LARGE')`, enforced for every client. The interim Zod char `.max` is therefore REPLACED (dropped, not lowered) so a large body reaches core and gets the proper code.
2. **The cap is on UTF-8 BYTE length, not character count.** "256 KB per message body" (NFR6/AR7) is bytes; `Buffer.byteLength(body, 'utf8')`. A char-count cap would let a multibyte (emoji/CJK) body exceed 256 KB or wrongly reject a long-but-small ASCII body. The unit test pins the byte semantics.
3. **The cap applies to BOTH `reply` and `post_announcement` bodies** (both are the same body class; `announcement.posted.body` and `room.replied.body`). A shared `assertBodyWithinCap` called by both core ops.
4. **The NOT_A_MEMBER reconciliation (AC #3).** "Post a verbatim message" is `reply` (`room.replied`) — and `reply` GRANTS participation by design ("acting = joining", Story 4.3: a non-participant who replies auto-joins as participant + sub-board member). So the room-MESSAGE surface has NO `NOT_A_MEMBER` rejection path. The `NOT_A_MEMBER` gate the AC references ("per Epic 3/4 gating") is `post_announcement`'s sub-board membership gate (Story 4.1 — broadcasting a NEED requires membership). This story reaffirms that gate in the integration test and does NOT add a contradictory gate to `reply` (which would break 4.3's open-negotiation property). This is the lead's reconciliation of an epics.md AC written before 4.3's "acting = joining" was finalized; surfaced here so the reviewer does not read the absence of a reply-side NOT_A_MEMBER as a gap.
5. **Verbatim is already the behavior** (no path parses/transforms a body; it is appended and read back unchanged). This story ADDS the cap + a near-cap-size verbatim test; it does not change storage.

### Source facts (verified at story creation, baseline `e66fe6c`)

- **`reply` core op** (`packages/core/src/rooms/reply.ts`): destructures `{ roomId, body }`, appends `{ type: 'room.replied', payload: { roomId, body } }` — NO body-size check today (the interim cap is purely the Zod boundary). Add `assertBodyWithinCap(body)` before the append.
- **`postAnnouncement` core op** (`packages/core/src/rooms/post-announcement.ts`): destructures `{ projectId, subject, body }`, appends `announcement.posted` — NO body check today. Add `assertBodyWithinCap(body)` before the `appendGuarded` loop.
- **Shared body schema** (`packages/mcp-server/src/tools/room-shared.ts`): `announcementBodySchema = z.string().min(1).max(ANNOUNCEMENT_BODY_MAX_LENGTH=16_000)` — used by BOTH `reply` and `post_announcement` tools. Drop the `.max` (keep `.min(1)`). `announcementSubjectSchema` `.max(200)` stays. `ANNOUNCEMENT_BODY_MAX_LENGTH` becomes unused → remove or repoint.
- **`BODY_TOO_LARGE`** is ALREADY in `BOARD_ERROR_CODES` (`packages/core/src/errors.ts:35` — "Message body exceeds the configured size cap"). `error-map.ts` routes any `BoardError.code` generically (Story 5.0 confirmed). NO new error code.
- **`read_room`** (`packages/core/src/rooms/read-room.ts` / `room-history.ts`) returns message bodies verbatim (no transform) — the verbatim read path. Story 4.4's NFR6 tests already prove byte-identity for hostile bodies; add the near-cap SIZE dimension.
- Toolchain (Epics 1–5): Node v24.16.0, pnpm 11.3.0; `python3` not on PATH (use `py`/`python`). Build before the full suite (forked workers); newly-added `core` exports visible from `src` (Story 4.0).

### Project Structure Notes

- New `packages/core/src/rooms/body-cap.ts` (`MAX_BODY_BYTES`, `assertBodyWithinCap`) (+ test); modify `reply.ts` + `post-announcement.ts` (call the cap); modify `tools/room-shared.ts` (drop the body char cap); new/extended integration test. One barrel (`packages/core/src/index.ts`).
- THE APPEND INVARIANT: the cap throws BEFORE the append (nothing appended on over-cap); bodies stored verbatim (no transform); `core` imports only the `DataAccess` port. The `Buffer` global is a Node builtin (allowed in `core` — it is not a client/SQLite import).

## Dev Agent Record

### Source-fact verification (Rule 4)

All Source facts re-confirmed against the repo at the start (baseline `e66fe6c`), before coding:

- `reply.ts` destructures `{ roomId, body }`, appends `room.replied` `{ roomId, body }` via PLAIN `append` — NO body-size check today. ✅
- `post-announcement.ts` destructures `{ projectId, subject, body }`, runs `requireMembership` FIRST, then the `appendGuarded` disambiguator loop — NO body check today. ✅
- `room-shared.ts`: `announcementBodySchema = z.string().min(1).max(ANNOUNCEMENT_BODY_MAX_LENGTH = 16_000)`; `announcementSubjectSchema.max(200)`. ✅ `ANNOUNCEMENT_BODY_MAX_LENGTH` was referenced ONLY inside `room-shared.ts` (decl + doc + usage) — no other production source — so it was safely removed.
- `BODY_TOO_LARGE` already in `BOARD_ERROR_CODES` — at `errors.ts:36` (the story said `:35`; the code IS present, off-by-one on the line). NO new error code. `error-map.ts` routes any `BoardError.code` generically, so a core `BoardError('BODY_TOO_LARGE')` surfaces as `readErrorPayload(result).code === 'BODY_TOO_LARGE'` (verified by the integration test).

### Implementation notes

- **Core primitive** (`packages/core/src/rooms/body-cap.ts`): `MAX_BODY_BYTES = 256 * 1024` (262144) + `assertBodyWithinCap(body)` throwing `BoardError('BODY_TOO_LARGE', …)` iff `Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES`. Exported from the barrel.
- **Enforcement**: `assertBodyWithinCap(body)` called in `reply.ts` (after room resolution, immediately before the `dataAccess.append`) and in `post-announcement.ts` (after `requireMembership`, before the `appendGuarded` loop). Both placements guarantee NOTHING is appended on over-cap (THE APPEND INVARIANT) and keep the existing gates' precedence (`reply`: ROOM_NOT_FOUND first; `post_announcement`: NOT_A_MEMBER first — reaffirmed by a core unit test and the integration test).
- **Boundary schema**: dropped `.max` from `announcementBodySchema` (now `z.string().min(1)`); kept `announcementSubjectSchema.max(200)`; removed the now-unused `ANNOUNCEMENT_BODY_MAX_LENGTH`. A large body now reaches core and gets the closed `BODY_TOO_LARGE` code instead of a code-less Zod rejection.
- **NOT_A_MEMBER reconciliation (Design decision 4) — implemented as specified**: NO reply-side gate was added (reply GRANTS participation, "acting = joining", Story 4.3). The NOT_A_MEMBER path is `post_announcement`'s sub-board gate (Story 4.1), reaffirmed in the integration test.

### KEY DECISION — `Buffer.byteLength` typing in core (deviation surfaced, design preserved)

The story's Source-fact/Project-Structure note "the `Buffer` global is a Node builtin (allowed in `core`)" holds at RUNTIME but NOT at compile time as `core` is configured: `core`'s tsconfig inherits `lib: ["ES2023"]` with `types` unset, and `@types/node` is NOT in `core`'s pnpm closure (core declares no Node dependency — deliberately keeping `fs`/`process`/better-sqlite3 types unreachable). So `tsc -b` failed with `TS2591: Cannot find name 'Buffer'` (the unit tests passed under Vitest, whose type resolution differs — the failure only appeared at the `pnpm run build` gate). This is exactly the Rule 3 / Rule 4 trap: a CLAIM that is true at runtime but not under the build config.

Resolution (research-first, verified against the installed compiler per Rule 3): empirically probed under core's exact flags — `TextEncoder` is NOT in `lib: ["ES2023"]` (`TS2304`), and `import { Buffer } from 'node:buffer'` needs node types too (`TS2591`). A Perplexity pass recommended `TextEncoder` "as the best, no-types option", but the installed `.d.ts`/lib disagreed — so per Rule 3 the types win and `TextEncoder` was rejected. Chosen fix: a **minimal local ambient declaration** in `body-cap.ts` for the SINGLE builtin used — `declare const Buffer: { byteLength(string: string, encoding: 'utf8'): number }`. This honors the story's explicit `Buffer.byteLength(body, 'utf8')` design (Design decision 2), adds NO `@types/node` (so `fs`/`process`/better-sqlite3 stay unreachable — the module boundary is preserved, stronger than `"types": ["node"]` or a triple-slash reference, both of which would expose ALL Node types), and the runtime value is Node's real global `Buffer` (exercised directly by the 8 unit tests). Build now clean across all 7 packages. Surfaced here per Rule 4 since it is a (typing-only) deviation from the literal "Buffer is allowed in core" framing.

### Tests + gate

- Core unit tests: `body-cap.test.ts` (8 — at-cap pass, +1 byte throws, empty passes, emoji/CJK byte-vs-char both directions); `reply.test.ts` (+2 — at-cap verbatim; over-cap throws + nothing appended incl. no auto-join); `post-announcement.test.ts` (+3 — at-cap verbatim; member over-cap throws; non-member over-cap → NOT_A_MEMBER gate-first).
- Integration (`packages/mcp-server/src/tools/body-cap.integration.test.ts`, 5): real `Client`↔`McpServer`↔SQLite — at-cap reply verbatim via `read_room` (`===` + exact byte length); at-cap announcement verbatim (message #1); over-cap reply → `BODY_TOO_LARGE` + counts unchanged; over-cap announcement → `BODY_TOO_LARGE` + counts unchanged; non-member `post_announcement` → `NOT_A_MEMBER`. Bodies built programmatically to an exact byte target (a unicode/Markdown prefix padded with ASCII).
- Full gate (honest order) ALL GREEN: `pnpm run lint` (clean) → `pnpm run build` (7 packages) → `pnpm run typecheck` (clean) → `pnpm test` (**496 passed / 71 files**, up from 478 after 5.0; +18) → `pnpm run format --check` (clean).

### File List

New:
- `packages/core/src/rooms/body-cap.ts`
- `packages/core/src/rooms/body-cap.test.ts`
- `packages/mcp-server/src/tools/body-cap.integration.test.ts`

Modified:
- `packages/core/src/index.ts` (barrel: export `assertBodyWithinCap`, `MAX_BODY_BYTES`)
- `packages/core/src/rooms/reply.ts` (call `assertBodyWithinCap` before the append)
- `packages/core/src/rooms/post-announcement.ts` (call `assertBodyWithinCap` after the membership gate, before the append loop)
- `packages/core/src/rooms/reply.test.ts` (+2 body-cap cases)
- `packages/core/src/rooms/post-announcement.test.ts` (+3 body-cap cases)
- `packages/mcp-server/src/tools/room-shared.ts` (drop body `.max`; remove `ANNOUNCEMENT_BODY_MAX_LENGTH`; refresh comments; keep subject `.max(200)`)

### Change Log

- 2026-05-31 — Story 5.1 implemented. Finalized the 256 KB `BODY_TOO_LARGE` body cap as a CORE check on UTF-8 byte length (`assertBodyWithinCap`/`MAX_BODY_BYTES`), enforced in `reply` + `postAnnouncement` before any append; dropped the interim Zod char cap (`ANNOUNCEMENT_BODY_MAX_LENGTH`) so over-cap bodies reach core for the closed code. +18 tests (478 → 496). Full gate green. Status → review.
