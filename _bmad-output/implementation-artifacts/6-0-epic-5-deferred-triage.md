---
baseline_commit: d55fd5d
---

# Story 6.0: Epic 5 Deferred Triage (lead-side, no-code)

Status: done

<!-- Retrospective-Review gate artifact — NOT in epics.md. Created by the /epic-cycle gate. -->
<!-- Triages the Epic 5 retrospective Action Items (A–D) + deferred-work.md OPEN items before Epic 6 feature work. -->

## Outcome

**This is a TRIAGE-ONLY retro-review gate.** Every carried-forward OPEN item routes to a destination OTHER than a Story-6.0 code change, so there is **no actionable cleanup code/test for Story 6.0** — it is handled lead-side as a triage record (no dev/QA/code-review/smoke pipeline; no production-source or test change; the gate is unchanged at 575 tests). The `deferred-work.md` ledger was already accurately reconciled at the Story 5.3 code review (Epic 5 close), so no ledger edit was required — this story records the disposition.

The two performance-measurement items (3.0-b, 4.6-a) are explicitly **Story 6.1's** to measure (6.1 `check` is the named consumer that wires `recordSeen` + `roomJoinSeq`/`roomMessagesSince` into the per-dial-in hot path) — they are NOT Story 6.0's. The new STORED cursor decision is also Story 6.1's (architecture line 253).

## Retro-Review Triage (Epic 5 → Story 6.0)

Triage covers the **Epic 5 retrospective** (`epic-5-retro-2026-05-31.md`, Action Items A–D) + the OPEN items in `deferred-work.md`, at the `/epic-cycle` Retrospective Review gate on **2026-05-31** before Epic 6 feature work.

| Item | Source | Triage Decision |
|---|---|---|
| **3.0-b** — guard-before-append doubles the `recordSeen`/`updateFocus` per-call read | Epic 3 / deferred-work | **DEFER → Story 6.1 (measure)** — 6.1 `check` calls `recordSeen` per dial-in (the named hot-path consumer). Measure the double-read there; optimize or close-with-evidence. NOT a 6.0 item. |
| **4.6-a** — `roomJoinSeq`/`roomMessagesSince` per-call full-stream fold cost | Epic 4 / deferred-work | **DEFER → Story 6.1 (measure)** — 6.1 `check` composes the join-cursor floor + delta per dial-in. Same per-call full-stream-fold class as `currentContract`. Measure there. NOT a 6.0 item. |
| **1.5** — append-invariant lint guard excludes `*.test.ts` (string-literal regex, not AST) | Epic 1 / deferred-work | **DEFER (OPEN)** — needs AST-level matching; no Epic 6 trigger. |
| **1.6** — `wireToPayload` payload-shape validation for a known-type-but-malformed row | Epic 1 / deferred-work | **DEFER (OPEN)** — corruption-tolerance for FOREIGN rows; `check` folds only board-produced events (the write→read round-trip holds), so no Epic 6 trigger. |
| **5.1-roomid-cap-edge** — residual `room_id` `ROOM_ID_MAX_LENGTH`=200 cap-edge test | Epic 5 / deferred-work | **DEFER (OPEN, low-value)** — a `room_id` is op-ALLOCATED (subject slug + disambiguator), never user-supplied at the cap edge, so the 200-char boundary is effectively unreachable via the tools. Fold into the next room-tool touch / the Epic 7 contract, or close won't-fix then. |
| **E3-tool-names** — MCP tool names/envelopes not contract-pinned | Epic 3 / deferred-work | **DEFER → Epic 7 (OPEN)** — `mcp-tool-contract.md`; now ~16 tools incl. `check` (6.1). Ratify the complete surface in Epic 7. |
| **4.5-tool-label** — cosmetic tool-count label drift in comments | Epic 4 / deferred-work | **DEFER (OPEN, cosmetic)** — reconcile when the Epic 7 tool-contract enumerates the full surface. |

**Summary:** included in Story 6.0 = 0 (no actionable code), deferred = 7 (2 to Story 6.1's measurement, 4 to later epics/no-trigger, 1 cosmetic), dropped = 0. The retro-review gate triage is complete; Epic 6 feature work (Story 6.1) proceeds, owning the 3.0-b/4.6-a measurement + the new cursor-storage decision.
