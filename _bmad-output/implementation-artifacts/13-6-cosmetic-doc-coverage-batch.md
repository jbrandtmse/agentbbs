---
baseline_commit: d1b32d9
---

# Story 13.6: Cosmetic / doc / coverage batch

Status: done

<!-- Epic 13 capstone (deferred-work cleanup & hardening). Closes deferred-work.md 10.3-unread-count-test-gap + 9.1-L2 + 9.10-tree.css-comment + 9.10-no-modal-substring. Cosmetic/doc/test-only. 17-tool agent contract byte-identical. -->

## Story

As a maintainer,
I want the small recorded nits cleared in one pass,
So that the backlog reflects only items that genuinely need a decision.

## Acceptance Criteria

1. **(AC1 — four items addressed)** Given the four P4 items, when each is addressed, then:
   - **(a) `10.3-unread-count-test-gap`** — the uncapped `"N new"` unread count in the VS Code tree's `TreeItem.description` (`BoardTreeProvider.ts:163` `item.description = \`${row.unreadCount} new\``) gains a **direct test assertion**.
   - **(b) `9.1-L2`** — DESIGN.md's text-body-light contrast reference is corrected **`17.4:1` → `~16.7:1`** (the true WCAG value 16.671:1) at `_bmad-output/planning-artifacts/ux-designs/ux-AgentBBS-2026-05-30/DESIGN.md:339`.
   - **(c) `9.10-tree.css-comment`** — the `SidebarTreeItem.tsx` header comment (line 18) is corrected to say the focus-ring rule ships in **`chrome.css`** (not `tree.css` — confirmed: `.nav-row:focus-visible` lives in `packages/ui-shared/src/chrome/chrome.css`).
   - **(d) `9.10-no-modal-substring`** — the brittle raw-substring no-modal sweep in `apps/web/src/App.test.tsx` (lines ~2081-2084: `not.toContain('modal'|'backdrop'|'scrim'|'overlay')`) is made **precise-token** (Rule 18 — a legit longer class like `overlay-none` must not false-positive), with the role-based assertions (`[role="dialog"]`/`[role="alertdialog"]`/`[role="alert"]`/`<dialog>`) confirmed authoritative and the substring narrowing documented as belt-and-suspenders; **mutation-tested non-vacuous**.

2. **(AC2 — gate green + items closed)** Given the batch, when tested, then the full ROOT gate is green and `deferred-work.md` items `10.3-unread-count-test-gap`, `9.1-L2`, `9.10-tree.css-comment`, `9.10-no-modal-substring` are **closed with evidence**. The 17-tool agent contract is untouched (these are doc/comment/test-only changes; any production touch is a comment or a tiny vscode-free extraction for testability).

## Tasks / Subtasks

- [x] **Task (a) — direct test for the uncapped `"N new"` description** (AC: #1a)
  - [x] Extracted the description-string format into a vscode-free helper `unreadDescription(count: number): string` returning `\`${count} new\`` in `decoration-model.ts` (alongside `unreadBadge` — the established vscode-free testability home). `BoardTreeProvider.getTreeItem` now calls it (`item.description = unreadDescription(row.unreadCount)`). Added direct assertions in `decoration-model.test.ts`: `unreadDescription(1)==='1 new'`, `unreadDescription(7)==='7 new'`, and the uncapped `unreadDescription(150)==='150 new'` (vs `unreadBadge(150)==='•'`) — proving NO 2-char cap. Rule-7 mutation (helper → `\`${unreadBadge(count)} new\``) turned the 150-case RED; reverted byte-identical → 11/11 GREEN.
  - [x] Badge (`decoration-model.ts#unreadBadge` ≤2-char `•`-fallback) unchanged — only the uncapped description count touched.
- [x] **Task (b) — DESIGN.md contrast number** (AC: #1b)
  - [x] `DESIGN.md:339` LIGHT column `**17.4:1**` → `**~16.7:1**` (true WCAG 16.671:1). Dark `11.3:1` left correct. Doc-only; Rule-21 ASCII-token match left the line's `→`/`—` glyphs byte-intact.
- [x] **Task (c) — SidebarTreeItem comment** (AC: #1c)
  - [x] `SidebarTreeItem.tsx:18` "… rule in tree.css" → "… in chrome.css" (grep-confirmed `.nav-row:focus-visible` lives in `chrome/chrome.css:33`). Comment-only.
- [x] **Task (d) — precise-token the no-modal sweep** (AC: #1d)
  - [x] In `apps/web/src/App.test.tsx` `assertNoModalAnywhere`, kept the AUTHORITATIVE role/element checks; replaced the four brittle `not.toContain` raw-substring checks with a PRECISE-TOKEN class-token scan (split each element's class list, assert no token EXACTLY equals a forbidden word — Rule 18: `overlay-none` no longer false-positives). Documented role checks as authoritative + token scan as belt-and-suspenders.
  - [x] **Rule 7 (both directions):** (1) planted `class="modal"` (no role) → token check RED across all 4 states; planted `role="dialog"` → role check RED; (2) planted `class="overlay-none scrim-free modal-dismissed"` → stayed GREEN (no false-positive). App.tsx reverted byte-identical each time (`git diff` empty); suite re-GREEN 59/59.
- [x] **Task (e) — close the four items + gate** (AC: #2)
  - [x] In `deferred-work.md`, flipped `10.3-unread-count-test-gap`, `9.1-L2`, `9.10-tree.css-comment`, `9.10-no-modal-substring` headings `OPEN/DEFERRED → RESOLVED (Story 13.6)` with resolution sub-lines; originals retained.
  - [x] FULL ROOT gate GREEN (Rule 20): lint 0 · typecheck 0 · build clean · `pnpm test` **1816 passed (188 files, 0 failed)** · `prettier --check` clean. `git diff HEAD -- packages/core/src packages/mcp-server/src` EMPTY — agent contract byte-identical.

## Dev Notes

### Current state (READ FIRST — all four sites located by the lead)

- (a) `apps/vscode-extension/src/tree/BoardTreeProvider.ts:161-163`: `// The exact unread count rides in description (no 2-char cap, unlike the badge).` then `item.description = \`${row.unreadCount} new\`;`. vscode-coupled → extract `unreadDescription(count)` to a vscode-free module + assert it. The badge cap lives in `decoration-model.ts#unreadBadge` (unchanged).
- (b) `DESIGN.md:339` table row: `| body text on surface-base (text-body / text-body-light) | #d4d4d4 on #1e1e1e → **11.3:1** | #1e1e1e on #ffffff → **17.4:1** |`. Only the light value (`17.4:1`) is wrong; true = 16.671 → `~16.7:1`. (The `11.3:1` dark value is correct — leave it.)
- (c) `SidebarTreeItem.tsx:18`: "The visible focus ring (AA, ≥3:1) is the `.nav-row:focus-visible` rule in tree.css." — `.nav-row:focus-visible` is in `chrome/chrome.css` (grep-confirmed). Fix the one word.
- (d) `App.test.tsx` `assertNoModal` (~2073-2085): authoritative role checks + 4 brittle substring checks. Rule-18 lineage (the `wasm-unsafe-eval ⊃ unsafe-eval` / `overlay-none ⊃ overlay` class).

### Constraints

- These are doc/comment/test-quality fixes — the 17-tool agent contract, core, and MCP wire are untouched. The only production touch is the vscode-free `unreadDescription` extraction (a refactor-for-testability, behavior identical) + the SidebarTreeItem comment word.
- Rule 7 applies to (a) the new unread-description test (mutation: change the helper to cap/format wrong → RED) and (d) the no-modal sweep (both directions above). (b)/(c) are doc/comment — no mutation needed.
- The canonical gate is ROOT `pnpm test` (Rule 12 — the App.test.tsx is a happy-dom DOM-project test; run via root, not per-package). Full Rule-20 gate.
- DESIGN.md lives under `_bmad-output/` (eslint/test-ignored) — a doc edit; no content-guard pins this number (it's prose), so just correct it.

### Project Structure Notes

- Touched: a new vscode-free helper module (or `decoration-model.ts`) + `BoardTreeProvider.ts` (call it) + its test; `DESIGN.md`; `SidebarTreeItem.tsx` (comment); `apps/web/src/App.test.tsx` (precise-token sweep); `deferred-work.md`.
- This is the Epic 13 capstone — after it, the P1–P4 backlog is fully retired (P5 + the 2 SCP-unenumerated residuals stay OPEN per Story 13.0's triage).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.6] — the four sub-items.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — `10.3-unread-count-test-gap` (~388), `9.1-L2` (~269/277), `9.10-tree.css-comment`, `9.10-no-modal-substring`.
- [Source: apps/vscode-extension/src/tree/BoardTreeProvider.ts:161-163] — the uncapped description.
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-AgentBBS-2026-05-30/DESIGN.md:339] — the 17.4:1 value.
- [Source: packages/ui-shared/src/tree/SidebarTreeItem.tsx:18] + [packages/ui-shared/src/chrome/chrome.css] — the comment vs the real rule location.
- [Source: apps/web/src/App.test.tsx:2073-2085] — the no-modal sweep.
- [Source: .claude/rules/project-rules.md] — Rule 7 (mutation), Rule 18 (precise-token when a legit token contains the forbidden substring), Rule 12 (root gate / DOM project), Rule 20 (full gate).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — dev-story stage under /epic-cycle.

### Debug Log References

- decoration-model.test.ts via root vitest: 11/11 GREEN; Rule-7 mutation (`unreadBadge(count)` wrap) → 150-case RED; reverted byte-identical → GREEN.
- App.test.tsx via root vitest (happy-dom DOM project): 59/59 GREEN. Rule-7 dir-1: planted `class="modal"` → 4 RED on the token check (line 2093); planted `role="dialog"` → role check RED. Rule-7 dir-2: planted `class="overlay-none scrim-free modal-dismissed"` → GREEN (no false-positive). App.tsx `git diff` empty after each revert.
- FULL ROOT gate: lint 0 / typecheck 0 / build clean / `pnpm test` 1816 passed (188 files, 0 failed) / `prettier --check` clean (after one `--write` reflow of the new `Set([...])` literal in App.test.tsx — semantically identical, re-verified GREEN).
- `git diff HEAD -- packages/core/src packages/mcp-server/src` EMPTY (17-tool agent contract byte-identical).

### Completion Notes List

- **(a) 10.3-unread-count-test-gap RESOLVED:** vscode-free `unreadDescription(count)` helper in `decoration-model.ts` (additive, behavior-identical refactor-for-testability), called from `BoardTreeProvider`; direct uncapped-count tests added + mutation-proven non-vacuous. Badge cap unchanged.
- **(b) 9.1-L2 RESOLVED:** DESIGN.md light contrast `17.4:1 → ~16.7:1` (doc-only).
- **(c) 9.10-tree.css-comment RESOLVED:** SidebarTreeItem header comment `tree.css → chrome.css` (comment-only).
- **(d) 9.10-no-modal-substring RESOLVED:** precise-token (Rule 18) class-token sweep replaces raw-substring checks; Rule-7 proven both directions.
- All four `deferred-work.md` items flipped OPEN/DEFERRED → RESOLVED with evidence, originals retained.
- ADR registry (`docs/adr/`) absent → Rule 6 N/A (confirmed; story is doc/comment/test-only). No NFR tripwire (Rule 5 N/A).

### File List

- apps/vscode-extension/src/tree/decoration-model.ts (new `unreadDescription` helper)
- apps/vscode-extension/src/tree/decoration-model.test.ts (direct uncapped-count tests)
- apps/vscode-extension/src/tree/BoardTreeProvider.ts (call `unreadDescription`)
- apps/web/src/App.test.tsx (precise-token no-modal sweep)
- packages/ui-shared/src/tree/SidebarTreeItem.tsx (comment tree.css → chrome.css)
- _bmad-output/planning-artifacts/ux-designs/ux-AgentBBS-2026-05-30/DESIGN.md (17.4:1 → ~16.7:1)
- _bmad-output/implementation-artifacts/deferred-work.md (4 items OPEN → RESOLVED)

## Review Findings

### Code review (2026-06-10, claude-opus-4-8[1m]) — APPROVED, clean

Proportionate review of a cosmetic/doc/coverage batch. Every item independently verified against ground truth; zero findings (0 HIGH / 0 MED / 0 LOW); nothing deferred. Auto-resolved: none needed.

- **(a) 10.3 — `unreadDescription` extraction + test.** Confirmed `unreadDescription(count)` returns `` `${count} new` `` (vscode-free, in `decoration-model.ts`); `BoardTreeProvider` delegates (`item.description = unreadDescription(row.unreadCount)`) — behavior byte-identical to the prior inline template. Direct test asserts the UNCAPPED case `unreadDescription(150) === '150 new'` vs `unreadBadge(150) === '•'` (verified `UNREAD_BADGE = '•'`, `BADGE_MAX_LENGTH = 2`, so "150" → 3 chars > cap → '•'). No 2-char cap on the description. ✔
- **(b) 9.1-L2 — DESIGN.md contrast.** Independently recomputed WCAG for `#1e1e1e on #ffffff` = **16.671** → `~16.7:1` correct; the old `17.4:1` was wrong. Dark `11.3:1` untouched. ✔
- **(c) 9.10-tree.css-comment.** Confirmed `.nav-row:focus-visible` lives in `packages/ui-shared/src/chrome/chrome.css:33`; comment now reads "in chrome.css". ✔
- **(d) 9.10-no-modal-substring (marquee).** Precise-token scan uses whitespace-split + exact `Set` membership (correct — a `\b` regex WOULD wrongly match `modal-dismissed` since `-` is a word boundary). Role/element checks (`[role="dialog"]`/`[role="alertdialog"]`/`[aria-modal]`/`[role="alert"]`/`<dialog>`) preserved as authoritative. **Rule 7 re-verified independently this review:** mutated `offendingModalTokens` to a raw-substring scan → the "no false-positive on a legit superstring" discrimination test went RED; reverted byte-identical (`git diff` shows only the additive story changeset, +65/-7). The "FIRES on a real modal class, any case" direction passes in the green suite. Both directions non-vacuous. ✔
- **AC2 / Rule 13:** `git diff HEAD -- packages/core packages/mcp-server` EMPTY — 17-tool agent contract byte-identical; drift guards green in the suite. ✔
- **Rule 21 (prose):** DESIGN.md edited line — no BOM, 0 mojibake markers, `→`/`—` glyphs byte-intact (UTF-8 verified out-of-band). ✔
- **Rule 20 (full gate, independently re-run):** lint **0** · typecheck **0** · build **clean** · `pnpm test` **1818 passed (188 files, 0 failed)** · `prettier --check` **clean**. (Test count 1816→1818 reflects QA's +2 discrimination tests added after the dev File List was written — expected, not a discrepancy.) ✔
- **Deferred-work:** all four items (lines 277, 307, 313, 395) flipped to RESOLVED (Story 13.6) with evidence-backed resolution sub-lines; originals retained. ✔
- **Rules 3/5/6/1:** N/A — no new user-facing surface lacking a real-runtime test (the vscode helper is unit-tested; no new service/NFR; no ADR registry under `docs/adr/`).
- **Minor (left, by judgment):** the deferred-work resolution prose for item (d) cites a point-in-time per-package count "59/59"; the scope-dependent count is now 61 per-package / 1818 root. Cosmetic narrative annotation in a resolution sub-line, not a guard — left as-is to avoid churn on a cosmetic batch.

**Outcome: APPROVED.** No patches, no decisions, no deferrals.

## Change Log

- 2026-06-10 — Story 13.6 (Epic 13 capstone) implemented: 4 cosmetic/doc/coverage nits cleared. (a) vscode-free `unreadDescription` helper extracted + direct uncapped-count test (10.3 gap); (b) DESIGN.md contrast 17.4→~16.7; (c) SidebarTreeItem comment tree.css→chrome.css; (d) precise-token (Rule 18) no-modal sweep, Rule-7 both directions. 4 deferred-work items closed RESOLVED. FULL ROOT gate green (1816 tests); 17-tool agent contract byte-identical.
