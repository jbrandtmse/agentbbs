# Test Automation Summary — Story 12.6 (Epic 12 CAPSTONE), QA stage

Install-kit integration + safety re-proof. QA strengthening over the dev's capstone coverage.
NO board-engine change (Rule 13): only the two named test files differ in the frozen
`packages/core` / `packages/data-access` / `packages/mcp-server/src` paths; the kit + helper are
assets under `integration/bmad/`.

## Generated / Strengthened Tests (all in the dev-touched files; discoverable by default `pnpm test`, Rule 8)

### `packages/mcp-server/src/install-kit-doc.test.ts` (Rule 10 + Rule 21)
- [x] **Rule-21 encoding-integrity guard** — reads RAW BYTES of the kit + all four canonical
  operator-skill sources; asserts no UTF-8 BOM, no CRLF, no mojibake lead-byte sequences
  (`0xC3 0xA2` em-dash/arrow, `0xC3 0xB0` emoji). This is the out-of-band check the token drift
  pins are STRUCTURALLY BLIND to (a byte-compare of inlined-vs-canonical stays GREEN even if the
  canonical source itself is mojibake-corrupted). Mutation-verified RED on an injected BOM and on
  an injected em-dash mojibake double-encode.
- [x] **Glyph-survival converse** — pins that the intended 👍 / em-dash / arrow glyphs are PRESENT
  (decoded) in the kit, so the absence-of-mojibake guard is not vacuous on a glyph-stripped file.
  Mutation-verified RED on stripping 👍.

### `packages/mcp-server/src/tools/install-kit-safety.integration.test.ts` (Rule 11, executable, EXTRACTS + EXECUTES the kit's OWN helper)
- [x] **(ix) 8.4-helper-crlf RESOLUTION (executable proof)** — runs the kit's own `writeOwnedFile`
  against a pre-existing CRLF owned file: proves it backs up the prior CRLF bytes FIRST, converges
  the file to the kit's own LF content (no CRLF survives), then re-runs of the kit's LF output are
  byte-stable no-ops. Turns the previously-prose-only documented-LF resolution into a regression
  guard, pinning the PRECISE property (whole-file `content === original` compare → convergence +
  byte-stable idempotency), not the loose "no-op regardless of newline" phrasing.
- [x] **(x) END-TO-END coherent install** — drives ALL owned writers (AGENTS.md identity block via
  applyBlock + a `.toml` overlay block + the `agentbbs` `.mcp.json` key via mergeMcpServer + all
  four SKILL.md whole files via writeOwnedFile) into ONE temp project pre-seeded with foreign
  assets: the project's `epic-cycle` kit, a foreign vendor `.claude/skills/<other>/` skill, a
  foreign top-level file, a foreign block inside the kit-edited `.toml`, and a foreign `.mcp.json`
  server + key. Asserts every foreign asset is BYTE-IDENTICAL + un-backed-up AND the full owned set
  landed coherently. Crosses the seams BETWEEN the individual safety cases.

## Rule-7 mutation runs (each reverted byte-identical; kit `cmp`-confirmed clean)
- BOM injected -> encoding guard RED.
- em-dash mojibake injected -> encoding guard RED.
- 👍 stripped -> glyph-survival converse RED.
- `writeOwnedFile` backup-before-overwrite defeated -> cases (vi) + (ix) RED.
- `writeOwnedFile` idempotency short-circuit defeated -> cases (v) + (ix) RED.
- `mergeMcpServer` drops foreign servers -> cases (iv) + (viii) + (x) RED.

## Coverage assessment vs the QA brief
- Rule 11 executable safety proof — STRONG (dev cases v–viii + QA ix–x; extracts/executes the kit's
  OWN writeOwnedFile; mutation-non-vacuous; end-to-end coherent-install angle added).
- Rule 10 drift pins (4 inlined skills byte-exact + user-scope target) — present (dev), confirmed
  non-vacuous; re-confirmed encoding-clean here.
- AC1 install completeness — pinned (user-scope MCP §3.9 + user-scope skills §3.10 + project-scope
  overlays/identity); the end-to-end (x) exercises every owned writer together.
- 8.4-helper-crlf — documented-LF note present in kit §1; deferred item marked RESOLVED; the
  resolution now has an EXECUTABLE regression guard (case ix). The dev's loose claim that
  idempotency "holds regardless of the target's prevailing newline" is sharpened by (ix): a CRLF
  target is correctly a CHANGE on first write (backed up); idempotency holds for the kit's OWN
  converged LF output thereafter.
- Rule 21 — automated encoding guard added (was prose-only / out-of-band before).

## Gate (Rule 20 — full canonical ROOT gate, independently re-run)
- lint 0 · typecheck 0 · build OK · `pnpm test` 1663 passed (184 files, 0 failed) · prettier --check clean.
- NOTE (Rule-20 false-green class): `prettier --check` initially flagged BOTH modified test files;
  fixed via `prettier --write`, then re-ran lint + format -> all green.

## Next steps (lead)
- Post-CR AC3 lead smoke: install end-to-end into a temp project; confirm global-board connection +
  operator skills resolve. All changes left uncommitted (lead commits after the smoke gate).
