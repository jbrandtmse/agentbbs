# Epic 9 Addendum Retrospective — operator↔agent parity (Stories 9.11–9.14)

**Date:** 2026-06-02 · **Facilitator:** Amelia (Developer) · **Project Lead:** Josh · **Mode:** interactive, lead-facilitated

> Focused retrospective on the correct-course parity addendum. Epic 9's MVP work (9.1–9.10) had its own full retrospective after the 9.10 capstone (rules 12–13 codified). This session covers only the four parity stories added via `/bmad-correct-course`.

## Scope & delivery

| Story | Surface | Result |
| --- | --- | --- |
| 9.11 | `announce_project` + `post_announcement` (start a negotiation) | done — smoke caught + fixed a HIGH open-a-room defect |
| 9.12 | `join_board` picker (join a project from the tree) | done — clean; resolved `9.4-join-project-inert` |
| 9.13 | `update_focus` (set my focus) | done — 1 MED auto-fixed in CR |
| 9.14 | proto-room respond-parity + 4 UI-polish fixes | done — closed the parity gap found in the lead's heavy smoke |

- Tests: 1185 → **1202** green (0 failed / 0 skipped throughout).
- **Rule 13 held on every story** — each parity feature mapped to an EXISTING core op; core + MCP wire + `BOARD_ERROR_CODES` byte-identical (`git diff` 0 verified per story). No new core op, no agent-contract drift, no backdoor.
- Commits: `e0d0f1f` (9.11) · `c98d2bf` (9.12) · `76ce2bc` (9.13) · `b99e01f` (correct-course 9.14) · `f3c1f03` (9.14).

## What went well

- **The smoke gate earned its keep again (Rule 12).** Story 9.11 passed dev + QA + code-review all green; the lead-side smoke caught a HIGH defect — `＋ open a room` was gated behind an already-open room, so a member of a room-less project could never post its first announcement. Three green automated tiers missed a broken headline flow.
- **QA added real value on every story**, not just coverage: gate-order (`NOT_A_MEMBER` before `BODY_TOO_LARGE`), canonical-handle filter, three-distinct-operator-states, and the AC1 dedupe mutation-proof the dev had missed — each mutation-tested non-vacuous (Rule 7).
- **Rule 13 discipline was automatic** — every dev/QA/CR stage verified the empty core/MCP diff; the thin-client contract never drifted across four stories.

## What could've gone better — the sharp lesson

The **proto-room respond-parity gap** slipped past a *clean* code-review approval AND every per-story smoke, and a real user (Josh) hit it within minutes of free-form testing: a posted announcement creates a proto-room (`active:false`) that the tree only counted, never rendered as a navigable row — so the operator could **post** an announcement but never **open, read, or reply-to-activate** it.

Root cause (team consensus): **the entire test pyramid is AC-shaped.** Unit, DOM, host-integration, and per-story smoke all ask "did THIS story do what it said?" — none asks "is the integrated surface whole at the SEAMS between stories?" 9.11's smoke proved "I can post" ✅; 9.13's proved "I can set focus" ✅; the gap lived in the space *between* "post" (9.11) and "browse/respond" (the earlier Epic-9 surface), where no AC-shaped test looks. It took a heavy, free-form exploratory smoke to surface it.

## Rules codified (→ `.claude/rules/project-rules.md`)

- **Rule 14 — A multi-story user FLOW needs an end-of-epic INTEGRATED exploratory smoke.** Per-story AC smokes miss the seams; after the last story's smoke and before the merge, drive the assembled product like a real user across the whole flow, free-form. A gap it finds is HIGH.
- **Rule 15 — A parity/mirror surface must be audited in BOTH directions against the mirrored capability's full op set.** Enumerate the mirrored actor's ops; cover the initiate AND the respond/consume halves. A partial parity ships green and feels broken (the operator could announce but not answer).
- **Rule 16 — A per-story smoke must cross the story's CONSUMER seam.** After the produce step succeeds, open/read/act on what was just created in the integrated app — don't stop at "post succeeded + counter incremented." The narrow, per-story version of Rule 14.

## Action items / Epic 10 carries (added to `epics.md` Epic 10 success criteria)

1. **Integrated exploratory smoke before the Epic 10 merge (Rule 14).** Operator↔agent parity now rides the shared `ui-shared` compose/picker/proto-room components; the whole-flow seam smoke MUST be re-run on the VS Code webview host — a new host over the same components; the seam test does not transfer for free.
2. **Proto-room navigability (9.14) is part of the operator parity CONTRACT** Epic 10 must honor in the native TreeView + webview, not just a web-surface affordance (Rule 15).
3. **Panel-exclusivity is web-DOM-specific.** The 9.14 single-open-initiate-panel model won't carry to VS Code; `WebviewPanel` / native surfaces need their own exclusivity handling.

## Readiness

- Epic 9 complete (9.1–9.14), all `done`, branch `AGENTBBS-1-epic9` pushed, 1202 tests green, contract byte-identical. Heavy exploratory smoke verified the full operator flow end-to-end in real Chrome (create → join → post → open proto-room → reply-to-activate → react/agreed → focus → watching-only disable).
- No blocking debt carried. The four polish findings (2–5) were all fixed in 9.14, not deferred.
- Cleared for the SC-4 merge into `feature/AGENTBBS-1_agentbbs-mvp`.

---
*Generated from the interactive retrospective; lessons codified as Rules 14–16 in the same change.*
