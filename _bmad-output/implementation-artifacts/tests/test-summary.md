# Test Automation Summary — Story 10.5 (Webview CSP hardening + state serialization)

QA stage: `qa-generate-e2e-tests`. Value-add focused on the SEAMS the dev's per-AC tests skipped
(Rules 7/10/14/16). The dev's coverage was already strong: per-directive CSP mutation guard
(`webview-html.csp.test.ts` + `webview-html.qa.test.ts`), LRU cap/eviction/MRU (`room-lru.test.ts`),
serializer no-op/adopt/replace (`serializer.test.ts`), inert-render corpus + canary
(`RoomApp.inert.test.tsx`), retain/re-render (`room-panel.test.ts`), and the real-host probe.

## Generated Tests (new)

### Host-tier unit (node project, root `pnpm test`)
- [x] `apps/vscode-extension/src/room-panel.qa.test.ts` — two skipped seams:
  - FRESH per-load nonce on every (re)set HTML: a non-retained panel re-rendered on focus, and an
    adopted (serializer-restored) panel, each get a nonce DISTINCT from the prior render (the dev
    asserted only `htmlSetCount`, not nonce freshness — a cached shell would silently reuse a nonce).
    Mutation: hard-coded/cached nonce in `setPanelHtml` → both tests RED.
  - LRU touch on REVEAL: re-opening an already-open room PROMOTES it back into the retain window
    (the `openRoom` reveal branch's `lru.touch`; the dev tested touch only via the view-state focus
    path). Mutation: drop `lru.touch` from the reveal branch → reveal-promotion test RED.

- [x] `apps/vscode-extension/src/webview/state-roundtrip.qa.test.ts` — the producer→consumer SEAM:
  the bundle (`main.tsx`) persists `setState({ roomId })` and the serializer's `roomIdFromState`
  reads it back on reload; the two halves were tested in isolation, nothing crossed the seam. A
  Rule-10 content guard parses main.tsx's actual `setState(...)` shape and runs it through the REAL
  consumer. Mutation: drift main.tsx to `setState({ room })` → seam resolves null → RED.

## Non-vacuity (Rule 7)
All three new guards mutation-tested against the REAL production source: each turned RED on a
plausible-wrong implementation, then production reverted byte-identically. Post-revert `git diff HEAD`
on `room-panel.ts` / `main.tsx` confirmed back to the dev's source; `packages/core` /
`packages/mcp-server` / `packages/ui-shared` diff EMPTY (Rule 13 — pure client hardening).

## Aggregate gate (Rule 12 — the 10.3 full-gate lesson, not just vitest)
- Root `pnpm test`: 1398 passed (164 files) — dev baseline 1391 → +7.
- `pnpm --filter @agentbbs/vscode-extension typecheck`: clean. Root `pnpm typecheck`: clean.
- `pnpm lint`: clean.
- `pnpm format`: flagged the new round-trip file (the 10.3 drift reproduced) → `prettier --write` →
  re-check clean.
- Real-host `@vscode/test-electron` smoke: re-run to confirm cspStrict / serializerRegistered /
  deserializeReattached. TRUE window-reload restore remains the documented MANUAL lead step — NOT
  asserted green on a stub (Rule 12 honored; the in-host probe documents it).
- Known baseline flake `seed-protocol-race.test.ts` teardown EPERM (not ours) did not surface.

## Coverage
- AC1 strict CSP: per-directive + whole-CSP mutation (dev) + fresh-nonce-on-re-set (QA) + real-host.
- AC1 inert render: script / img-onerror / js-link / fetch corpus + canary (dev).
- AC2 LRU/retain: cap / eviction / MRU / re-render (dev) + reveal-promotion (QA).
- AC2 serializer: deserialize no-op / adopt / replace (dev) + producer↔consumer state seam (QA) +
  real-host register + deserialize round-trip.

## Decisions
- Round-trip seam pinned via a source content-guard (Rule 10), not a live import of main.tsx, because
  main.tsx imports side-effecting ui-shared `.css` subpaths the unit resolver can't load — the same
  reason the dev's inert test mounts `RoomApp.js`, not `main.js`.

## Next Steps
- Manual lead window-reload smoke (the one half @vscode/test-electron cannot trigger headlessly).
