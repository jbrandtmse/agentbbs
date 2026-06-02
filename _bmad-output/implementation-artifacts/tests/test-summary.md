# Test Automation Summary — Story 10.7 (operator initiate-parity compose surfaces)

QA value-add tests on the SEAMS the dev's AC-shaped suite did not exercise. All mutation-tested
non-vacuous (Rule 7) and reverted byte-identical. Discoverable by ROOT `pnpm test` (Rule 8); the
`.tsx` runs under the root `ui-shared-dom` happy-dom project (Rule 12). No production drift — the
Rule-13 contract drift-guard (`packages/core` / `mcp-server` / `ui-shared`) stays EMPTY.

## Generated Tests

### Bridge tier — `apps/vscode-extension/src/bridge.test.ts`
New `describe('bridge dispatch — INITIATE seams …')`:
- [x] `whoami` (the new host-read FocusAffordance gate driver) in all 3 shapes: watching-only (no actor → all-null), registered (handle+focus+registered:true), unregistered-but-configured (registered:false), and reflects a LIVE updateFocus.
- [x] `joinBoard` IDEMPOTENCY — a re-join succeeds, appends NO second membership event (maxSeq unchanged), operator appears exactly once.
- [x] `updateFocus` POSITIVE trim — a valid focus with surrounding whitespace persists TRIMMED (candidate b; the dev only covered whitespace-ONLY rejection).
- [x] `announceProject` POSITIVE trim — a valid title with surrounding whitespace lands trimmed.

### Host tier — `apps/vscode-extension/src/compose-panel.test.ts`
New `describe('ComposePanelManager — a SWAPPED surface still dispatches …')`:
- [x] After open(focus)→open(create-project), an announceProject over the SWAPPED panel still LANDS (proves the fresh per-kind bridge re-bind on swap — the HTML-only assertion cannot see a stale/disposed bridge).
- [x] A watching-only INITIATE write over the panel bridge → host-surface NO_OPERATOR, nothing persists (the gate fires through the real per-panel bridge path).

### DOM tier — `apps/vscode-extension/src/webview/ComposeApp.test.tsx`
New `describe('ComposeApp — JoinProjectPicker joinable filter seam …')`:
- [x] EXCLUDES projects the operator already belongs to (canonical-handle compare, mixed-case directory handle proves case-insensitivity) — the load-bearing filter the dev's members:[] test never exercised.
- [x] The calm "no projects to join" empty state when the operator belongs to all (NOT surfaced as an error; no phantom choices).

## Mutation tests (Rule 7 — all RED under mutant, reverted byte-identical)
- Drop the joinable exclude-already-member filter (push every project) → both filter tests RED.
- Drop the `updateFocus` host-side trim → the positive-trim test RED.
- Drop the per-kind bridge re-bind on swap → the swapped-surface-still-LANDS test RED (timeout, no response).
- (joinBoard idempotency: NOT mutated — core dedup is Rule-13-protected; the test pins documented behavior.)

## Gate evidence
- ROOT `pnpm test`: 1470/1470 (baseline 1459 + 11 new). No known flakes triggered (seed-protocol-race EPERM + Shiki both passed in the full run).
- typecheck exit 0; lint exit 0; prettier `--check` clean on the 3 files.

## Coverage
- INITIATE bridge writes (4) + gate + whoami + idempotency + trim: covered.
- Compose surfaces (4) mount + right op + gate + join-first + no-modal + joinable filter + empty state: covered.
- Panel-exclusivity (single reused panel, swap re-bind, gate over real bridge): covered.
- Real-host evidence (the 4 writes land + navigable proto-room loop + gate): the dev's `host-tests/compose-panel.in-host.ts` (run via `pnpm --filter @agentbbs/vscode-extension test:host`).

## Next Steps
- The lead's end-of-epic Rule-14 integrated exploratory smoke + the real-browser/real-host Rule-12 smoke run after this story.
