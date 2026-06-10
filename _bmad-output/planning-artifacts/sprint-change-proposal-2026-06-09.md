# Sprint Change Proposal — Epic 13: Deferred-work cleanup & hardening

**Date:** 2026-06-09
**Author:** Developer (lead) · **Skill:** `/bmad-correct-course`
**Trigger source:** post-MVP deferred-work prioritization (2026-06-09) after Epics 1–12 merged to `main`
**Change scope classification:** **Moderate** — additive new epic that pays down accumulated `deferred-work.md` debt. **No rollback; no PRD/UX change; the 17-tool agent contract stays byte-identical.** Unlike Epic 12, this epic DOES modify board-engine internals (`packages/cli`, `packages/data-access`, lint config) — but only internals + tests; no new MCP tool / event / error code, no agent-facing surface change.

---

## Section 1 — Issue Summary

The AgentBBS MVP is feature-complete (Epics 1–12 merged to `main` @ `19ea6a4`, 1663 tests green). A prioritization pass over `deferred-work.md` (2026-06-09) found, after marking 5 stale consumer-resolved items closed, **16 genuinely-open items**. Three of them are P5 (need a product decision — `9.4-mention`, `9.13-trim`, `10.5-retain-context`) and are explicitly OUT of this epic. The remaining **13 items (P1–P4) are hardening/tech-debt** that a single cleanup epic can retire:

- **P1 — test-gate reliability (highest leverage; taxes every CI run, can mask real regressions).** Two root-cause clusters, each fixable once: (a) Windows temp-dir teardown races under full-suite parallel load (`E10-baseline-seedrace-eperm` + `E12-postmerge`); (b) Shiki full-suite tokenizer warmup flakes (`9.5-shiki-warmup` + `10.5-shiki-flake` + `10.6-shiki-flake`).
- **P2 — correctness-assurance gaps** (real but low-likelihood / corruption-path): `11.3` import replay non-atomicity (a non-contiguous archive leaves a partial ledger), `1.6` `wireToPayload` malformed-payload validation, `11.2` DB-open-failure path not directly asserted.
- **P3 — maintainability / drift risk**: `10.3-operator-handle-dup` (duplicated canonicalization across web + VS Code surfaces), `1.5` append-invariant lint guard disabled in `*.test.ts`.
- **P4 — cosmetic / doc / coverage batch**: `10.3-unread-count-test-gap`, `9.1-L2` (DESIGN.md contrast number), `9.10-tree.css-comment`, `9.10-no-modal-substring`.

These accumulated as honest, recorded deferrals across Epics 1–12 (Rule-9 "defer to the named consumer" discipline). With the MVP shipped and no Epic 13 previously planned, this is the natural moment to retire the P1–P4 set in one focused hardening epic before any post-MVP feature work.

## Section 2 — Impact Analysis

**Epic impact**
- **New Epic 13** appended after Epic 12. No dependency on unshipped work — every item references already-shipped code. Schedulable immediately via `/epic-cycle 13`.
- **No change to Epics 1–12.** Their deliverables are hardened, not reopened.

**Story impact** — six new stories (13.1–13.6); none modify existing stories.

**Artifact conflicts (to reconcile)**
- **`epics.md`** — add Epic 13 + its six stories. *(Applied by this proposal on approval.)*
- **PRD / Architecture / UX / Brief** — **no change.** No new FR/NFR; the items reinforce existing NFR3 (resilience/retry), NFR10 (ledger integrity), and test-suite reliability. One DOC edit lands inside Epic 13 itself (`9.1-L2` DESIGN.md contrast number) as a story task, not a planning-artifact amendment.
- **`deferred-work.md`** — each story CLOSES its items with evidence (status-update lines), the same close-with-evidence discipline Epic 12 used for `7.3`/`8.4`.
- **`.claude/rules/project-rules.md`** — no new rule expected up-front; the retro's Rule-1 step may add one if a general pattern emerges.

**Technical impact (the Rule-13 boundary — important)**
- **The 17-tool agent contract stays byte-identical.** No new MCP tool / event / error code; `packages/core/src/errors.ts` (closed `BOARD_ERROR_CODES`) and the MCP wire are untouched. Verify with the existing drift guards.
- **Board-engine internals ARE modified** (this is the point of a hardening epic): `packages/cli` (import atomicity + CLI-error coverage), `packages/data-access` (`mapping.ts` malformed-payload validation), `eslint.config.js` (append-invariant guard), `apps/vscode-extension` + `packages/cli` (shared operator-handle util). All changes are internal hardening + tests; none alters agent-observable behavior of the shipped tools.
- **The `11.3` atomicity fix uses the EXISTING batched-atomic `append([])`** (`data-access/src/sqlite/append.ts` `db.transaction(...).immediate`) — no new affordance, no contract change (the fix was pre-designed in the `11.3` deferred entry).

## Section 3 — Recommended Approach

**Direct Adjustment — append a new Epic 13.** Additive, low-risk, all items reference shipped code. No rollback (nothing shipped is wrong — these are recorded deferrals, not defects). No replan (engine architecture unchanged; the agent contract is frozen).

**Sequencing within the epic (highest-leverage first):** 13.1 → 13.2 (the P1 flake fixes — they make every subsequent story's gate trustworthy) → 13.3 → 13.4 (P2 correctness) → 13.5 (P3 drift) → 13.6 (P4 batch).

**Effort / risk:** ~6 stories, mostly test-infra + small internal hardening + one cross-surface refactor + a doc/test batch → low technical risk; the main risk is a flake fix that masks rather than fixes (mitigated by the Rule-7 "mutation-test the fix is non-vacuous" discipline + re-running the full suite N times to confirm the flake is gone, not just hidden).

## Section 4 — Detailed Change Proposals

### 4a. NEW — Epic 13 (full text appended to `epics.md`)

_(See the appended Epic 13 below — Goal, Success criteria, Stories 13.1–13.6 with Given/When/Then ACs, each naming the `deferred-work.md` item(s) it closes.)_

### 4b. NO requirement / PRD / architecture changes

No FR/NFR added or amended. The DESIGN.md contrast-number fix (`9.1-L2`) is a Story-13.6 task, not a planning amendment.

## Section 5 — Implementation Handoff

- **Scope:** Moderate (additive epic; internal hardening + test reliability; no contract/PRD/UX change).
- **Applied on approval (this proposal):** `epics.md` — Epic 13 + the Epic-List row + Stories 13.1–13.6.
- **Routed to:** the standard dev pipeline — Epic 13 runs as a normal epic via `/epic-cycle 13`. Each story CLOSES its named `deferred-work.md` item(s) with evidence, mutation-tests any flake fix / new guard non-vacuous (Rule 7), keeps the 17-tool agent contract byte-identical (Rule 13 — verify the drift guards), and runs the full ROOT gate (Rule 20). The P1 stories additionally re-run the full suite multiple times to confirm a flake is eliminated, not masked.
- **Success criteria:** the P1–P4 deferred set is retired (13 items closed with evidence); the canonical `pnpm test` gate is reliably green across repeated full-suite runs on Windows (no temp-dir / Shiki flake recurrence); the agent contract + closed error/event sets remain byte-identical; P5 (3 items) remains explicitly open pending a product decision.
