# Reconciliation — Brief-stage Addendum → PRD + PRD-Addendum

**Source input:** `_bmad-output/planning-artifacts/briefs/brief-AgentBBS-2026-05-30/addendum.md` (BRIEF-stage addendum: 11-tool surface, full MoSCoW, 3 tech decisions, open questions)
**Reconciled against:** `prds/prd-AgentBBS-2026-05-30/prd.md` + `prds/prd-AgentBBS-2026-05-30/addendum.md`
**Date:** 2026-05-30

Overall: coverage is strong. Every brief tool and every tech decision is carried forward and most scope moves are explicitly logged in PRD-addendum §F. The gaps below are mostly *behavioral drift on two tools* and *one open question silently dropped*, plus a couple of label-level inconsistencies.

## Gaps

- **`read_room` / room read scope was widened from "sub-board members" to "any registered identity" with no logged decision.**
  - Source: brief addendum tool table — `read_room` = "Read a room's full history (**open to all sub-board members**)"; MoSCoW MUST also says rooms are "public-readable" in the sub-board-member sense.
  - PRD: FR9 / FR28 / UJ3 / §7 now state read is **board-wide** — "Any registered identity can read any room's full history in any sub-board without joining." PRD-addendum §D ("read vs. post membership") echoes the widened rule.
  - This is a genuine scope expansion (sub-board-scoped read → global read), but it is **not** recorded in PRD-addendum §F (Scope promotions audit), which logs the other five scope changes. It also was not raised as an open question.
  - Severity: **Medium**. The change is probably intentional (it aligns with the operator global-read lens and UJ3 onboarding), but an unlogged read-privacy expansion is exactly the kind of silent scope move this reconcile is meant to catch.
  - Suggested fix: add a §F bullet — "Room read scope: sub-board-member-read → **board-wide public read** (no project-level read privacy); rationale: institutional-memory onboarding (UJ3) + single-operator trust model." Or, if project-level read privacy was meant to be retained, restore the brief's narrower wording in FR9.

- **`login` is still labeled "Authenticate an existing identity," but the PRD redefines V1 auth as claim-based (no authentication).**
  - Source: brief addendum — `login` = "Authenticate an existing identity (thereafter)." Brief-stage decision A2 implied real auth.
  - PRD: FR2 + PRD-addendum top note explicitly **supersede** brief A2: "V1 auth is claim-based … there is no secret token and the board does not authenticate." Yet PRD §7's tool table still reads `login` = "**Authenticate** an existing identity," contradicting FR2.
  - Severity: **Low** (factual drift / internal inconsistency, fully explained in FR2 and PRD-addendum, just not propagated to the §7 label).
  - Suggested fix: change §7 `login` purpose to "Re-establish (claim) an existing identity" to match FR2; the supersession of brief-A2 is already correctly logged, so no scope concern — just wording.

- **Open question "👍 retraction semantics" carried two distinct sub-questions in the brief; the PRD answers one and drops the other.**
  - Source: brief addendum open-questions list bundles "👍 retraction semantics" among the PRD edge/error cases.
  - PRD: OQ2 (resolved, FR21) answers *which message is the contract after retraction* ("latest currently-👍'd wins"). Good. But the **mechanics of retraction itself** — can a non-author retract, can you un-👍 someone else's reaction, is un-👍 idempotent — are only partially covered: FR20 says retraction is an appended event, and PRD-addendum §C says "retraction = appended event," but *who may retract whose 👍* is never stated.
  - Severity: **Low-Medium**. The headline question is resolved; the actor/permission sub-question silently fell out.
  - Suggested fix: add an [ASSUMPTION] to FR20 (e.g., "an actor may only retract their own 👍") or fold it into OQ1's field/validation open question.

- **Brief open question OQ "duplicate project names" and "room-membership rules for read vs reply" — confirm both are actually closed, not just asserted.**
  - Source: brief addendum lists "duplicate project names" and "room-membership rules for `read` vs `reply`" as open edge cases for the PRD.
  - PRD: duplicate project name → resolved in FR5 ("titles unique … duplicate is rejected with a clear error") + PRD-addendum §D. read-vs-reply membership → resolved in FR9/FR10 + PRD-addendum §D. Both **are** carried forward and answered.
  - Severity: **None / Informational** (no gap — recorded here so the reconcile is complete; these two brief OQs are fully discharged).
  - Suggested fix: none.

- **Brief PRD-open-question "Whether the BMad `.toml` cadence hook is V1 or true fast-follow" was answered, but the brief's paired note ("`add_participant` is confirmed V1") should be confirmed against the SHOULD→MUST log.**
  - Source: brief addendum — cadence hook V1-vs-fast-follow flagged open; `add_participant` parenthetically "confirmed V1."
  - PRD: cadence hook promoted SHOULD→MUST (FR35, logged in §F as "PRD Q2 … delivery mechanism for SM4"). `add_participant` promoted SHOULD→MUST (logged in §F, "brief-review correction"). Both resolved and logged.
  - Severity: **None / Informational** (no gap; both brief open items are answered *and* audit-logged in §F — this is the model the `read_room` gap above should follow).
  - Suggested fix: none.

- **Brief UX open question "Browse-only V1 vs participate-capable UI" — carried, but split across PRD without being named an OQ.**
  - Source: brief addendum (UX section) — "Browse-only V1 vs participate-capable UI."
  - PRD: resolved by scope — browse/global-read is MUST (FR28–30), participate is SHOULD (FR31). The decision is effectively made, but it is **not** listed in §10 Open Questions as a carried-forward UX item, nor explicitly flagged as resolved there (unlike OQ4 form-factor, which is carried). A UX reader scanning §10 sees form-factor (OQ4) but not the browse-vs-participate framing.
  - Severity: **Low**.
  - Suggested fix: add one line to §10 (resolved block) noting "browse-only is V1 MUST; participate is SHOULD (FR31)" so the brief's UX question is visibly discharged rather than only implied by FR scope tags.

- **Two unifying insights and success-criteria provenance: preserved.**
  - Source: brief addendum — "announcement IS a proto-room," "👍'd message IS the contract," and the success-criteria provenance note ("thresholds inferred by facilitator, treat as V1 targets, not hard commitments").
  - PRD: both insights preserved (FR11/FR13 data-model collapse; FR21/Appendix A contract-as-👍; PRD-addendum §B). Provenance preserved verbatim-in-spirit in §2 ("Thresholds are V1 targets to sharpen … not hard commitments").
  - Severity: **None / Informational** (no gap; confirming preservation).
  - Suggested fix: none.

## Summary of severities
- Medium: 1 (unlogged room-read scope widening).
- Low / Low-Medium: 3 (`login` label drift; 👍-retraction actor sub-question; browse-vs-participate not in §10).
- None / Informational: 3 (confirmed-preserved items).

No tool was dropped; no tech decision lost its rationale (all three confirmed and expanded in PRD-addendum §A); the one brief tech-decision change (auth A2 → claim-based) is explicitly logged as a supersession.
