---
baseline_commit: b304af7
---

# Story 9.0: Epic 8 Deferred Cleanup (lead-side, no-code triage)

Status: done

<!-- Retrospective-Review gate artifact — NOT in epics.md. Created by the /epic-cycle gate. -->
<!-- Triages the Epic 8 retrospective Action Items + deferred-work.md OPEN items before Epic 9 feature work. -->

## Outcome

**TRIAGE-ONLY retro-review gate.** The OPEN deferred set carrying out of Epic 8 is four perennial, low-value LOWs — **1.5**, **1.6**, **5.1-roomid-cap-edge**, **8.4-helper-crlf** — and Epic 9 ships the **Operator UI** (a NEW `ui-shared` React package, a Vite/React web app, an on-demand Node HTTP/SSE host, browser-surface concerns), NOT board `core`/`data-access`/`mcp-server` code and NOT the BMad installation kit, so **none of the four has an Epic-9 trigger**. There is **no actionable cleanup code/test for Story 9.0** — it is handled lead-side as a triage record (no dev/QA/code-review/smoke pipeline; no production-source or test change; the gate is unchanged at 709 tests baseline). The `deferred-work.md` ledger was already reconciled at the Story 8.4 code review (Epic 8 close); this story records the disposition.

The two substantive Epic-8 retro **Action Items (A, B)** are NOT Story 9.0 cleanup items — they are **feature guidance** that specific Epic 9 feature stories own (A → Story 9.2 inert-rendering NFR12 XSS guard; B → Stories 9.1+ test-tier wiring + the browser smoke shift). Recorded here so those stories carry them; the lead also carries A and B forward into the per-story spawn context.

## Retro-Review Triage (Epic 8 → Story 9.0)

Triage covers the **Epic 8 retrospective** (`epic-8-retro-2026-05-31.md`, Action Items A–C) + the OPEN items in `deferred-work.md`, at the `/epic-cycle` Retrospective Review gate before Epic 9 feature work.

| Item | Source (retro or deferred-work.md) | Triage Decision |
|---|---|---|
| **1.5** — append-invariant lint guard disabled in `*.test.ts` (string-literal regex, not AST) | Epic 1 / deferred-work | **DEFER (OPEN)** — board-code lint concern requiring AST-level matching of real `better-sqlite3` call sites; NO Epic-9 trigger (Epic 9 is `ui-shared`/web, which appends nothing via raw SQL — the UI never speaks SQL). |
| **1.6** — `wireToPayload` does not validate the payload shape of a known-type-but-malformed row | Epic 1 / deferred-work | **DEFER (OPEN)** — corruption-tolerance hardening at the `data-access` seam; no Epic-9 trigger (the UI's thin JSON API wraps the EXISTING read projections; it adds no new event-folding path). |
| **5.1-roomid-cap-edge** — residual `room_id` `ROOM_ID_MAX_LENGTH`=200 cap-edge call test | Epic 5 / deferred-work | **DEFER (OPEN, low-value)** — `room_id` is op-allocated, never user-supplied at the cap edge, so the boundary is effectively unreachable via the tools; no Epic-9 trigger (Epic 9 adds no new MCP room tool / Zod validator). Best closed won't-fix at a future room-tool touch. |
| **8.4-helper-crlf** — install-kit helper appends an LF-terminated block to a CRLF target (mixed endings in that one file) | Epic 8 retro / deferred-work | **DEFER (OPEN, low-value)** — empirically NOT a safety defect (idempotency / backup / foreign-safety all hold under CRLF; marker re-detection is newline-agnostic, proven at the 8.4 review). Lives in the BMad installation kit, which Epic 9 does NOT touch. Fold into any future install-kit helper hardening. |
| **Epic 8 retro Action A** — apply Rule 10 to Epic 9's inert-rendering security claim (NFR12): ship an XSS-corpus guard test asserting Markdown renders inert (no script executes, code-as-text, links safe), mutation-tested non-vacuous | Epic 8 retro | **CARRY INTO Epic 9 feature work (Story 9.2)** — NOT a 9.0 item; it is guidance Story 9.2 (the inert Markdown renderer + code block) implements and its QA/code-review stages enforce. Recorded here so 9.2 owns it; lead passes it into the 9.2 spawn context. |
| **Epic 8 retro Action B** — wire the new `ui-shared`/web test tier into the default `pnpm test` + the build-before-test graph (Rule 8 discoverability); shift the per-story smoke to a browser smoke via chrome-devtools-mcp | Epic 8 retro | **CARRY INTO Epic 9 feature work (Stories 9.1+)** — NOT a 9.0 item; Story 9.1 (the `ui-shared` scaffold) owns the test-tier wiring + build-graph integration, and EVERY Epic 9 story's per-story smoke is a lead-driven browser smoke (chrome-devtools-mcp). Recorded here so 9.1 owns the wiring; lead enforces the browser-smoke method at each story's smoke gate. |
| **Epic 8 retro Action C** — remaining perennial LOWs (1.5, 1.6, 5.1-roomid-cap-edge) + the new 8.4-helper-crlf LOW | Epic 8 retro | **= the four DEFER rows above.** Triaged at this gate; all deferred (no Epic-9 trigger). |

**Summary:** included in Story 9.0 = 0 (no actionable code), deferred = 4 (the perennial low-value LOWs: 1.5, 1.6, 5.1-roomid-cap-edge, 8.4-helper-crlf), carried-as-feature-guidance = 2 (Action A → Story 9.2 inert-render XSS guard; Action B → Stories 9.1+ test-tier wiring + browser smoke). The retro-review gate triage is complete; Epic 9 feature work (Stories 9.1–9.10 — the Operator UI) proceeds.

## Dev / QA / Review

N/A — lead-side triage record. No code, no tests, no pipeline stages. The four deferred items remain **OPEN** in `deferred-work.md` and carry to the next applicable trigger (a board-code touch for 1.5/1.6, a room-tool touch for 5.1-roomid-cap-edge, an install-kit helper touch for 8.4-helper-crlf).
