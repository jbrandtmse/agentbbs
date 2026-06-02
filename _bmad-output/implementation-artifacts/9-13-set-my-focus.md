---
baseline_commit: c98d2bf7e5c6497497e2030efb4b962108a89bde
---
<!-- Story 9.13 — created 2026-06-01 by the Lead (epic-cycle resume; correct-course parity story). -->
<!-- Operator INITIATE-surface parity (update_focus). New host POST /api/me/focus + host-layer /api/me focus reflection over the EXISTING core updateFocus op; prop-driven affordance. Core + MCP + BOARD_ERROR_CODES byte-identical (Rule 13). -->

# Story 9.13: Set my focus

Status: done

## Story

As an operator,
I want to set my current focus,
so that other peers see what I'm working on, like an agent.

## Acceptance Criteria

**AC1 — Set focus via the same core op.**
**Given** a calm affordance (e.g. on the `@operator (you)` identity row),
**When** I set my current focus,
**Then** it is persisted via the SAME core `updateFocus` op (over a NEW host `POST /api/me/focus` → `updateFocus(operatorHandle, focus)`), and my focus is reflected where focus is surfaced (the operator identity row / members/directory views),
**And** a watching-only host (no operator handle) OR an unregistered operator handle shows the affordance disabled inline (never a crash).

**AC2 — Real event, real stack.**
**Given** the write,
**When** it runs,
**Then** a real `identity.focus_updated` event lands in the ledger via the SAME core op an agent uses, proven over the real stack.

## Tasks / Subtasks

- [x] **Task 1 — Host: `POST /api/me/focus` + reflect focus on `/api/me`** (AC: 1, 2)
  - [x] Add a body-carrying POST route to the `ROUTES` table in `packages/cli/src/host/json-api.ts`: `pattern: '/api/me/focus'`, validate `requireOperator(operatorHandle)` → `requireBodyString(body, 'focus')` → `updateFocus(dataAccess, actor, focus)` → return the updated focus in a host wire envelope (`{ handle, focus }`).
  - [x] **Unregistered-operator guard (no crash, AC1):** detect the unregistered operator via `findIdentity(await dataAccess.eventsSince(0), actor)` BEFORE calling `updateFocus`, returning a calm `HostApiError(403, 'OPERATOR_NOT_REGISTERED', …)` so the plain `Error` `updateFocus` throws never surfaces as a 500. (Used `OPERATOR_NOT_REGISTERED` — a NEW host-surface code — NOT `NO_IDENTITY`, because `NO_IDENTITY` is ALREADY a core `BOARD_ERROR_CODES` member [mapped to 401 in `statusForCode`] meaning the MCP no-session condition; reusing it would conflate two distinct meanings. See Decisions.)
  - [x] **Reflect focus (host-layer additive) on `GET /api/me`:** enhanced the `/api/me` handler to return `{ handle, focus: string | null, registered: boolean }`, folding the operator's identity from `dataAccess.eventsSince(0)` via `findIdentity`. `handle === null` (watching-only) OR a `findIdentity` miss → `focus: null, registered: false`. HOST-LAYER additive (like 9.5's `created_at`); the agent-facing MCP wire is untouched (Rule 13).
- [x] **Task 2 — Client: `postFocus` helper + `/api/me` types** (AC: 1)
  - [x] Added `postFocus(focus, …)` to `apps/web/src/api-client.ts` (mirrors the 9.11 `postAnnouncement` body-carrying helper via `postJsonBody` + `ApiError`) + a `FocusResponse` type. Extended `MeResponse` with the additive `focus` + `registered` fields (`fetchMe` carries them through).
- [x] **Task 3 — ui-shared: prop-driven focus affordance** (AC: 1 / NFR2)
  - [x] Added `packages/ui-shared/src/compose/FocusAffordance.tsx` (a SIBLING component the App mounts near the identity row — NavTree kept presentation-only/untouched per the "OR a sibling component" option): shows the current focus (or "set your focus…" placeholder), inline `[ edit ]` → field + submit (`onSubmit(focus)`), `onCancel`/`onEscape`, `pending`, inline `error` slot; `disabled` renders inert + a terse `disabledReason` line ("watching-only …" / "handle not registered") — never a crash. Imports ONLY React (NFR2). Barrel-exported.
- [x] **Task 4 — apps/web wiring + live reflection** (AC: 1, 2)
  - [x] Wired into `apps/web/src/App.tsx`: a mount-time `fetchMe()` reads `focus` + `registered`; `FocusAffordance` mounts after `<NavTree>` in the sidebar. On submit → `postFocus(focus)` → reflect the new focus immediately from the write response, then re-`fetchMe()` (live source of truth). DISABLED when `model.operatorHandle === null` (watching-only) OR `registered === false` (unregistered) — inline, never a crash.
- [x] **Task 5 — Tests** (AC: 1, 2)
  - [x] **Host integration** (real stack, Rule 3, `host.integration.test.ts`): (a) REGISTERED operator `POST /api/me/focus` → real `identity.focus_updated` lands (out-of-band `eventsSince`), `GET /api/me` reflects the new `focus`; (b) watching-only host → 403 `NO_OPERATOR`, nothing appended, `/api/me` `{ focus:null, registered:false }`; (c) UNREGISTERED handle → 403 `OPERATOR_NOT_REGISTERED` (NOT 500), nothing appended, `/api/me` `registered:false`. Plus json-api unit tests (the same three + missing-field → 400 BAD_REQUEST + the enhanced `/api/me` reflection) and the Rule 13 drift-guard pin.
  - [x] **ui-shared DOM** (`FocusAffordance.test.tsx`): renders current focus / placeholder, `[ edit ]` reveals the prefilled field, submit fires `onSubmit` trimmed, empty/whitespace no-submit, inline error slot (no modal), cancel/Esc callbacks, the `disabled` inert state (no edit control + terse reason, current focus stays). NFR2 (React-only).
  - [x] **apps/web DOM** (`App.test.tsx`): REGISTERED operator sets focus → `postFocus` POSTed `{ focus }` → reflected live on the row; watching-only / unregistered → affordance disabled (no POST, no crash).
  - [x] **Rule 13 drift-guard**: `git diff HEAD -- packages/core packages/mcp-server` is EMPTY (reuses `updateFocus`; no new core code). Mutation-tested the unregistered-guard (defeated the `findIdentity` check with `if (false && …)` → the unregistered case returned 500 → test RED; reverted byte-identical → green).

## Dev Notes

### What this story IS (and is NOT)

- **IS:** a NEW host endpoint `POST /api/me/focus` + a host-layer `focus`/`registered` reflection on `GET /api/me` + a prop-driven `ui-shared` focus affordance + apps/web wiring, all over the EXISTING core `updateFocus` op (the SAME op an agent uses — no backdoor).
- **IS NOT:** any change to core, the MCP tool surface, the agent-facing wire, or `BOARD_ERROR_CODES`. **Rule 13** governs: client/host-layer only. The `/api/me` additions are host-surface display fields (like Story 9.5's `created_at`, Story 9.6's `NO_OPERATOR`); the drift-guarded agent contract stays byte-identical. Confirm `git diff` on `packages/core` + `packages/mcp-server` is empty.
- **IS NOT:** identity registration in the UI — OUT of scope. The operator reuses an EXISTING registered handle (`--as`); the UI does NOT register it (`packages/cli/src/ui.ts:30` comment). That is exactly WHY AC1 requires the unregistered-handle disabled state.

### Source facts to VERIFY before coding (Rule 4 — verified by the Lead at story creation)

- **`updateFocus`** — `packages/core/src/identity/update-focus.ts:51`: `updateFocus(dataAccess, handle, currentFocus) → Promise<Identity>`. Appends ONE `identity.focus_updated` (plain `append`, no guard). **GUARDS existence first:** an UNREGISTERED handle throws a PLAIN `Error` ("identity X is not registered — refusing to append…", `append-identity-event.ts:58`) WITHOUT appending. Returns the `Identity` with the new `currentFocus`. [Verified by Lead.]
- **`findIdentity`** — `packages/core/src/identity/projection.ts:163`: `findIdentity(events, handle) → Identity | undefined` (folds the event stream). `Identity.currentFocus` at `projection.ts:45`. Use to fold the operator's focus + existence for `/api/me`. [Verified by Lead.]
- **Host `/api/me`** — `packages/cli/src/host/json-api.ts:264-270`: currently returns `{ handle: operatorHandle }` only. The host already reads the full stream via `dataAccess.eventsSince(0)` (`:341`). [Verified by Lead — enhance host-layer.]
- **Host write pattern** — `json-api.ts`: `ROUTES` (`:262`), `requireOperator` → `NO_OPERATOR` 403 (`:224`), `requireBodyString` → `BAD_REQUEST` 400 (`:244`), `HostApiError` host-surface codes (`:96-110`), `statusForCode` (`:473-494`). The Story 9.11 `POST /api/projects` body-carrying handler is the closest template. [Verified by Lead.]
- **Client** — `apps/web/src/api-client.ts`: `getMe()` (`:154`, `MeResponse` `:81`), `postJsonBody`/`ApiError` (added Story 9.11). [Verified by Lead.]
- **Focus is NOT currently surfaced** anywhere in `ui-shared` (no `currentFocus` consumer) — so "reflected where focus is surfaced" is satisfied minimally by reflecting the OPERATOR's OWN focus on the `@operator (you)` row (the natural members surface for the operator). Surfacing other agents' focus in a broader members view is NOT required by this story. [Verified by Lead.]
- **NavTree operator row** — `packages/ui-shared/src/tree/NavTree.tsx:78-79` `operatorHandle: string | null`; the `@handle (you)` row. NavTree is presentation-only/prop-driven (NFR2) — keep it so (add an optional prop, or mount a sibling affordance in App). [Verified by Lead.]

### READ-BEFORE-EDIT (UPDATE files)

`packages/cli/src/host/json-api.ts` (`/api/me` handler + ROUTES + helpers), `apps/web/src/api-client.ts` (`getMe`/`MeResponse` + the 9.11 `postJsonBody`/`ApiError` pattern), `apps/web/src/App.tsx` (how `getMe`/`model.operatorHandle` flow + the 9.11/9.12 compose-panel placement to mirror), `packages/ui-shared/src/tree/NavTree.tsx` (the identity row — keep presentation-only), `packages/ui-shared/src/index.ts` (barrel). Document current behavior + what changes + what to preserve (don't break 9.4–9.12).

### Testing standards

- Canonical gate is ROOT `pnpm test` (Rule 12 corollary): `.test.tsx` under the `ui-shared-dom` happy-dom project; a per-package `vitest` run FALSELY reports `.tsx` as `document is not defined` — use `pnpm test` + git as ground truth (Rule 6). Use `python` not `python3`.
- Host integration over real `createDataAccess` (Rule 3). Honest gate: lint 0 / typecheck 0 / build / `pnpm test` all green (0 failed/0 skipped, no `.only`/`.skip`/`.todo`) / `format --check` clean. Baseline after 9.12: 1157 tests.
- NOTE a pre-existing transient Shiki-warmup flake in `render-markdown.xss.test.ts` (unrelated; passes in isolation/next full run) — do NOT chase as a regression; git is ground truth.

### Smoke (lead-side gate — informational)

Lead will drive real Chrome with a REGISTERED operator: set focus on the `@operator (you)` row → it persists + reflects live; assert a real `identity.focus_updated` landed out-of-band (`/api/me` reflects the new focus + the ledger carries the event). Then a WATCHING-ONLY host (no `--as`) → the affordance is disabled inline (no crash). (Possibly also an unregistered `--as` handle → disabled.)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.13]
- [Source: .claude/rules/project-rules.md#13] (thin-client: host-layer fields + existing board op, contract byte-identical), [#4] (verify source-facts), [#8] (reconcile vs shipped design)
- [Source: packages/core/src/identity/update-focus.ts:51], [Source: packages/core/src/identity/append-identity-event.ts:58], [Source: packages/core/src/identity/projection.ts:45,163]
- [Source: packages/cli/src/host/json-api.ts:264-270,224-254,473-494], [Source: apps/web/src/api-client.ts:81,154]
- [Source: packages/ui-shared/src/tree/NavTree.tsx:78-79], [Source: packages/cli/src/ui.ts:25-49]
- [Source: 9-11-start-a-negotiation.md] (host write + ApiError + compose-panel pattern to mirror)

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — claude-opus-4-8[1m]

### Debug Log References

- Rule 4 source-fact verification (all confirmed against the repo before coding): `updateFocus(dataAccess, handle, currentFocus)` at `update-focus.ts:51` throws a PLAIN `Error` for an unregistered handle via `append-identity-event.ts:58` (guard-before-append, no orphan); `findIdentity` at `projection.ts:163`; `Identity.currentFocus` at `projection.ts:45`; `/api/me` at `json-api.ts:264-270`; both `updateFocus` + `findIdentity` exported from core's barrel (`core/src/index.ts:40,47`).
- Rule 7 mutation test: defeated the host unregistered-guard (`if (false && findIdentity(...) === undefined)`) → the json-api `UNREGISTERED → 403 OPERATOR_NOT_REGISTERED` test went RED (got 500, the plain-Error fall-through). Reverted byte-identical (`git diff` shows no `false &&`) → green.
- Honest gate: `pnpm test` 1181 passed (139 files, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo`) = 1157 baseline → 1181 (+24); lint 0; typecheck 0 (`tsc --noEmit`); build green (all 7 packages + apps/web); `format --check` clean (3 files auto-formatted then re-checked). The pre-existing Shiki-warmup flake did NOT surface.
- Rule 13: `git diff HEAD -- packages/core packages/mcp-server` EMPTY (verified twice).

### Completion Notes List

- **Rule 13 LOAD-BEARING — held.** All new code is client/host-layer; core + the MCP tool surface + `BOARD_ERROR_CODES` are byte-identical. The new `POST /api/me/focus` maps to the EXISTING core `updateFocus` (the SAME op an agent uses — no operator backdoor, no fabricated board op); the `/api/me` `focus`/`registered` fields are host-layer display fields (the 9.5 `created_at` precedent). `OPERATOR_NOT_REGISTERED` + `NO_OPERATOR` are HOST-surface codes, pinned OUT of core's closed ten by the drift-guard test.
- **Unregistered = calm 403, never 500 (AC1 backstop).** `updateFocus` throws a plain `Error` (not a `BoardError`) for an unregistered handle, which the host's catch would otherwise map to 500. The route detects the unregistered handle via `findIdentity` BEFORE core and returns a calm `403 OPERATOR_NOT_REGISTERED`. The PRIMARY guard is the client disabling the affordance when watching-only OR unregistered.
- **Live reflection.** On a successful set, the shell reflects the new focus immediately from the write response, then re-reads `/api/me` as the authoritative source (mirrors the 9.9/9.11 success-refetch discipline).
- **NavTree untouched** (kept presentation-only per its NFR2 contract) — the affordance is a sibling component mounted by App after `<NavTree>` in the sidebar.

### File List

- packages/cli/src/host/json-api.ts (MODIFIED — `findIdentity`/`updateFocus` imports; `/api/me` folds `focus`+`registered`; new `POST /api/me/focus` route with the unregistered backstop; header doc)
- apps/web/src/api-client.ts (MODIFIED — `MeResponse` `focus`+`registered`; new `FocusResponse` + `postFocus` helper)
- apps/web/src/App.tsx (MODIFIED — `FocusAffordance`+`postFocus`+`fetchMe` imports; operator focus/registered state + mount-time read; `handleSetFocus`; affordance mounted after NavTree with the disabled gate)
- packages/ui-shared/src/compose/FocusAffordance.tsx (NEW — the prop-driven set-my-focus affordance)
- packages/ui-shared/src/index.ts (MODIFIED — barrel-export `FocusAffordance` + its props type)
- packages/cli/src/host/host.integration.test.ts (MODIFIED — Story 9.13 real-stack integration block: a/b/c)
- packages/cli/src/host/json-api.test.ts (MODIFIED — updated 2 `/api/me` tests for the new shape; +1 registered-reflection test; Story 9.13 route unit block + Rule 13 host-code drift-guard)
- packages/ui-shared/src/compose/FocusAffordance.test.tsx (NEW — DOM tests for the affordance)
- apps/web/src/App.test.tsx (MODIFIED — Story 9.13 shell-wiring block: registered set→POST→live; watching-only/unregistered disabled)

### Change Log

- 2026-06-01 — Story 9.13 implemented: operator "set my focus" INITIATE-surface parity. New host `POST /api/me/focus` + host-layer `/api/me` `focus`/`registered` reflection over the EXISTING core `updateFocus` op; client `postFocus` helper; prop-driven `FocusAffordance` (ui-shared) wired into apps/web with the watching-only/unregistered disabled gate. Rule 13 held (core + mcp-server byte-identical; new host code `OPERATOR_NOT_REGISTERED` kept out of the closed set). +24 tests (1157 → 1181). Rule 7 mutation-tested the unregistered backstop. Status → review.

## Review Findings

### Code Review — 2026-06-01 (epic-cycle code-review stage, Opus 4.8 1M)

**Outcome:** APPROVED. Honest gate green (lint 0 / typecheck 0 / build green / `pnpm test` 1185 passed, 0 failed / 0 skipped, no `.only`/`.skip`/`.todo` / `prettier --check` clean). Baseline 1157 → 1183 (dev+QA) → 1185 (review +2). Rule 13 LOAD-BEARING held; AC1 + AC2 met; Rule 3 real-runtime evidence present.

**Rule 13 verification (load-bearing):** `git diff HEAD -- packages/core packages/mcp-server` is EMPTY (confirmed). `OPERATOR_NOT_REGISTERED` is a HOST-surface code (`HostApiError`), NOT in core's closed `BOARD_ERROR_CODES` — pinned out by the drift-guard test (the closed ten are byte-identical). The new `POST /api/me/focus` maps to the EXISTING core `updateFocus` (the same op an agent uses — no backdoor, no fabricated board op); the `/api/me` `focus`/`registered` fields are host-layer additive (the 9.5 `created_at` precedent), agent MCP wire untouched.

**Unregistered backstop (AC1 "never a crash") — mutation re-confirmed:** the host folds `findIdentity` BEFORE `updateFocus` and returns a calm 403 `OPERATOR_NOT_REGISTERED`, so the plain `Error` `updateFocus` throws for an unregistered handle never reaches the 500 fall-through. Re-mutated the guard (`if (false && …)`) → BOTH the dev guard test AND the QA distinct-states test went RED (`expected 500 to be 403`); reverted byte-identical (`git diff` shows no `false &&`) → green. The three operator states map to three DISTINCT host responses (200 / NO_OPERATOR 403 / OPERATOR_NOT_REGISTERED 403), proven side-by-side and asserted ≠ NO_IDENTITY/401/500.

**Append-only / latest-wins:** the QA test asserts the DERIVED current value (`/api/me` folds to `second focus`) AND the event COUNT growing to 2 (both `identity.focus_updated` events remain) — not a vacuous count==1. Correct.

- [x] [Review][Patch] FIXED — live SET-failure error was invisible (calm-UX, MED) [packages/ui-shared/src/compose/FocusAffordance.tsx] — `handleSubmit` closes the editor synchronously on submit; on a FAILED async focus write the parent passes the `error` prop while the affordance is back in the RESTING view, but the error slot previously rendered ONLY inside the open editor (`editing && !disabled`). So a real POST failure (e.g. a race that hits the host `NO_OPERATOR`/`OPERATOR_NOT_REGISTERED` backstop, or any network error) closed the editor and showed NO feedback — contradicting the component's own `error`-prop contract. AC1's "never a crash" still held (no crash), but the advertised calm inline-error feedback was not delivered on the live failure path, and no test covered submit→fail→show-error. **Auto-resolved:** render the `focus-error` slot in the resting view too (guarded `!disabled` so the terse disabled reason still owns its line). Added 2 ui-shared DOM tests: (a) error-while-resting surfaces the calm line (no modal); (b) a disabled affordance suppresses the error (the reason owns the slot). Full root suite green (1185).
- [x] [Review][Defer] Whitespace-only focus persists via a DIRECT API call (LOW, benign) [packages/cli/src/host/json-api.ts] — `requireBodyString` accepts a non-empty string but does NOT trim, so a direct `POST /api/me/focus { focus: "   " }` would persist a whitespace `identity.focus_updated`. Benign: the client (`FocusAffordance`) trims before POST, and on read `restingFocus`/`/api/me` consumers treat a whitespace focus as the placeholder (invisible). Not a defect for this story (the affordance is the gate); deferred for a future host-side trim hardening if a non-UI caller ever appears. Recorded in deferred-work.md (9.13).
