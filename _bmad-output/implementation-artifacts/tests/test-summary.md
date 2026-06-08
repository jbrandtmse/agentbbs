# Test Automation Summary — Story 12.1 (Global-board default & framing reconciliation)

QA stage: `qa-generate-e2e-tests`. Story is a configuration/asset + planning-doc reconciliation
(install-kit `.mcp.json` registration moved from a broken per-project `${PROJECT_ROOT}` board to a
user-scope registration against ONE global `AGENTBBS_DB`, default `~/.agentbbs/board.db`). NO
board-engine change (Rule 13). The deliverable is the agent-CONSUMED install kit, so the test tier is
a Rule-10 content-guard pinning the kit's machine-relevant claims to source-of-truth — not a UI/API
E2E. The complementary real-runtime proof already exists (`install-kit-connection.integration.test.ts`,
which spawns the real `dist/main.js`).

## Generated / Strengthened Tests

### Content-guards (extended) — `packages/mcp-server/src/install-kit-doc.test.ts`
The dev added 5 group-(e) guards (global default present, user-scope present, old `${PROJECT_ROOT}`
default GONE, no active-`AGENTBBS_DB` placeholder, override present). QA added 4 more pinning the
load-bearing AC1/AC2 claims the dev guards left thin:

- [x] **Precedence** — the per-project board is explicitly stated NOT to be the default, and the
  global board IS the default (pins the AC1 demotion in both directions; the dev's override guard only
  proved the words "override"+"isolated" present, not the demotion).
- [x] **Same-key collision avoidance (AC1 clause 2)** — the kit must name the same-key collision in the
  connection-record context (project-scope vs user-scope) AND instruct "do not also register" a
  project-scope `agentbbs` alongside the user-scope one. The dev had NO collision guard. The collision
  word-pin is scoped to the connection-record context so the two unrelated `collision` mentions
  (handle-suffix collision, identity collision) cannot make it vacuous.
- [x] **Rule-18 hardening (AC2)** — the broken `${PROJECT_ROOT}/.agentbbs/...` DB path must appear
  NOWHERE as a live value in the kit body (only inside the `>`-quoted explanatory note). This is the
  POSITION-INDEPENDENT companion to the dev's `AGENTBBS_DB`-positional regex: it catches a
  reintroduction in an `args` entry or a command path the positional regex would MISS (false-negative).
  Includes a converse non-vacuity check (the `>`-quote strip must leave the live `--scope user` command).
- [x] **§4 verify side (AC1/AC4)** — the verify step must confirm the user-scope global registration
  and that no stray per-project `.mcp.json agentbbs` entry was created. Pins the VERIFY side of the
  §3.9 WRITE the dev guards covered.

## Mutation testing (Rule 7) — every new assertion proven non-vacuous

| New guard | Mutation applied to kit | Result |
|---|---|---|
| Rule-18 hardening | placeholder DB path injected into override `args` as `${PROJECT_ROOT}/.agentbbs/board.db` (NOT the dev's exact old-default literal, so the dev's two literal-string guards stay GREEN) | only the hardening guard RED — proves it adds coverage the positional + literal guards miss |
| Precedence | removed "NOT the default" / "global board is the default" framing from the override section | precedence guard RED |
| Same-key collision | removed BOTH connection-record collision callouts (primary + override) | collision guard RED (the discriminating "do not also register" assertion) |
| §4 verify | rewrote §4 verify to a per-project framing (dropped "at user scope" + "no per-project entry") | §4-verify guard RED |

All mutations reverted byte-identical → 22/22 GREEN. The kit working-tree state after QA = the dev's
§3.9 rewrite, with zero mutation residue (all guard-target phrases confirmed intact).

## Rule-13-frozen path (untouched)
`packages/mcp-server/src/tools/install-kit-connection.integration.test.ts` (real `dist/main.js` spawn)
stays GREEN — the kit's PRIMARY path is user-scope; the illustrative explicit-Node JSON form (which
that frozen test pins) remains the documented fallback, not a regression to per-project.

## Coverage
- Install-kit content-guards: 22/22 (18 dev + 4 QA), all mutation-confirmed.
- Rule-13 board engine (`packages/core`, `packages/data-access`, `packages/mcp-server/src`): byte-identical
  except the permitted `install-kit-doc.test.ts`.

## Canonical ROOT gate (Rule 20, all legs)
- lint: 0 findings (exit 0)
- typecheck: exit 0
- build: clean (exit 0)
- test: 182 files / **1597 passed** / 0 failed
- format --check: clean (exit 0)

## Test discoverability (Rule 8)
New tests are added to the existing `*-doc.test.ts` content-guard file (correct Vitest naming, not
ignored, not tagged) — discovered and run by the canonical ROOT `pnpm test` (confirmed in the 1597-count).
