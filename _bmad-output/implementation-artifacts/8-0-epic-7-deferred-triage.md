---
baseline_commit: eefcf51
---

# Story 8.0: Epic 7 Deferred Triage (lead-side, no-code)

Status: done

<!-- Retrospective-Review gate artifact — NOT in epics.md. Created by the /epic-cycle gate. -->
<!-- Triages the Epic 7 retrospective Action Items + deferred-work.md OPEN items before Epic 8 feature work. -->

## Outcome

**TRIAGE-ONLY retro-review gate.** The OPEN deferred set carrying out of Epic 7 is just three perennial, low-value LOWs — **1.5**, **1.6**, **5.1-roomid-cap-edge** — and Epic 8 ships agent-executed INTEGRATION ASSETS (`integration/bmad/` Markdown + `.toml` + the installation kit), NOT board code, so NONE of the three has an Epic-8 trigger. There is **no actionable cleanup code/test for Story 8.0** — it is handled lead-side as a triage record (no dev/QA/code-review/smoke pipeline; no production-source or test change; the gate is unchanged at 645 tests). The `deferred-work.md` ledger was already reconciled at the Story 7.3 code review (Epic 7 close); this story records the disposition.

The big Epic-7 retro action — **E3-tool-names + 4.5-tool-label** — was already RESOLVED at Story 7.0 (the ratified, drift-guarded `docs/mcp-tool-contract.md`), so it carries nothing into Epic 8.

## Retro-Review Triage (Epic 7 → Story 8.0)

Triage covers the **Epic 7 retrospective** (`epic-7-retro-2026-05-31.md`, Action Items A–C) + the OPEN items in `deferred-work.md`, at the `/epic-cycle` Retrospective Review gate before Epic 8 feature work.

| Item | Source | Triage Decision |
|---|---|---|
| **1.5** — append-invariant lint guard excludes `*.test.ts` (string-literal regex, not AST) | Epic 1 / deferred-work | **DEFER (OPEN)** — needs AST-level matching of real `better-sqlite3` call sites; a board-code lint concern with NO Epic-8 trigger (Epic 8 is integration assets, not `data-access`/`core` code). |
| **1.6** — `wireToPayload` payload-shape validation for a known-type-but-malformed row | Epic 1 / deferred-work | **DEFER (OPEN)** — corruption-tolerance hardening at the data-access seam; no Epic-8 trigger (the kit adds no new event-folding path). |
| **5.1-roomid-cap-edge** — residual `room_id` `ROOM_ID_MAX_LENGTH`=200 cap-edge test | Epic 5 / deferred-work | **DEFER (OPEN, low-value)** — the `room_id` is op-allocated, never user-supplied at the cap edge, so the boundary is effectively unreachable via the tools; no Epic-8 trigger. Best closed won't-fix at a future room-tool touch. |
| **E3-tool-names, 4.5-tool-label** | Epic 3/4 / deferred-work | **ALREADY RESOLVED (Story 7.0)** — the ratified + drift-guarded tool contract. Nothing to carry. |
| **Epic 7 retro Action A** — apply Rule 10 (content-guards) to the Epic-8 kit/asset claims; test the kit's idempotency + never-touch-foreign-assets + backup-before-overwrite safety | Epic 7 retro | **CARRY INTO Epic 8 feature work (8.3/8.4)** — NOT a 8.0 item; it is guidance the 8.1–8.4 stories implement (content-guards on the assets; the kit's safety-property tests). Recorded here so the feature stories own it. |
| **Epic 7 retro Action B** — operationalize the identity bootstrap + cadence the 7.3 snippet recommends | Epic 7 retro | **= Epic 8 Stories 8.1/8.2** (the feature work itself). NOT a 8.0 item. |

**Summary:** included in Story 8.0 = 0 (no actionable code), deferred = 3 (the perennial low-value LOWs), already-resolved = 2 (E3-tool-names, 4.5-tool-label), carried-as-feature-guidance = 2 (Rule-10 content-guards + the bootstrap/cadence, owned by Stories 8.1–8.4). The retro-review gate triage is complete; Epic 8 feature work (Stories 8.1–8.4 — the installation kit) proceeds.
