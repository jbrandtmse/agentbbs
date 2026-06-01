# Project Rules

Durable rules for AI dev + code-review agents working on this project. Rules are accumulated from completed epic retrospectives and any other moment where a general pattern is recognized. Each rule captures a reusable lesson, with a short citation of the bug, anti-pattern, or situation that motivated it.

**How rules land here:** every retrospective ends with a "Rules to codify" step. Any lesson with general-pattern shape (would prevent a recurrence of a class of issues in a future epic, not just the specific incident at hand) is added to this file. Narrow one-off fixes stay in the source retro/story document and do NOT become rules.

**Template usage:** this header and Rule #1 (the meta-rule below) are intentionally project-agnostic — they can be dropped into any new project's `.claude/rules/project-rules.md` as the starting template. Subsequent rules (#2 onwards) are project-specific and accumulate from that project's retrospectives.

---

## 1. Meta-rule — codify retrospective lessons as rules

**Context:** Every completed epic retrospective (and any other moment a reusable lesson is explicitly identified).

**Rule:** At the end of every retrospective, add a "Rules to codify" step. For each lesson with general-pattern shape, append a new rule to this file following the format below. Narrow one-off fixes stay in the retrospective document and do NOT become rules.

**Format per rule:**
- Numbered heading with short title
- `**Context:**` — when the rule applies
- `**Rule:**` — what to do (or not do)
- `**Why:**` — the bug, anti-pattern, or cost that motivated the rule (with commit hash or bug number from the source retro if useful)
- Optional code snippet or example

**Why:** Retrospectives without a codification step produce lessons that age. The next epic then re-learns them the hard way. The value of a retro compounds only when its lessons become durable guidance the next dev/review agent actually sees before making a decision. Story files, commit messages, and retrospective prose do not survive as agent-visible context beyond the session that wrote them — `.claude/rules/*.md` does.

**How to apply:** when closing any retrospective:
1. Review the retrospective's "What could've gone better" and "Lessons learned" sections.
2. For each lesson, ask: *does this prevent a class of future bugs, or is it specific to the one that already happened?*
3. If class-of-bugs → append to this file.
4. Commit the rule file update in the same commit as the retrospective document.

**Cross-project library note:** rules here are project-scoped by default. When multiple projects adopt this system, rules with evidence from 2+ projects can be elevated into a shared library (shared npm package, git submodule, or copy-and-curate sync). Tag rules with `id:` slugs and `scopes:` frontmatter when that cross-project moment arrives so merging is mechanical rather than manual.

---

## 2. ~~Build cross-package `dist/` before running cross-package tests~~ — SUPERSEDED (Story 3.0)

**Status:** SUPERSEDED by Story 3.0 (2026-05-31). The build-first dance is **no longer required** for tests. Story 3.0 (AC #1, deferred-work 2.4) added a `resolve.alias` to the root `vitest.config.ts` mapping each `@agentbbs/<pkg>` specifier to that package's `src/index.ts`, so cross-package tests now resolve against **live TypeScript source**, not each package's built `dist/`. A brand-new `core` export is visible to `mcp-server`/`cli`/`ui-shared` tests with **no prior `pnpm run build`** (proven by `packages/mcp-server/src/cross-package-alias.proof.test.ts`).

**Heading retained (not deleted)** so existing references (`deferred-work.md`, the Epic 2 retro, Story 3.0) don't dangle.

**Residual guidance — the build is still the `dist`-artifact guard, NOT a test prerequisite:** because tests now run against `src`, the test suite does not validate the shipped `dist`/`exports` artifact. Keep `pnpm run build` in the gate so a broken barrel `exports` still surfaces at build time. The alias maps package **roots** only (object-form exact match); if a test ever imports a deep `@agentbbs/<pkg>/<subpath>` specifier, alias that subpath explicitly too (none do today).

**One exception — forked cross-process tests still need `dist`:** the Vitest `resolve.alias` only governs imports resolved *inside* the Vitest process. The cross-process suites (`packages/data-access/src/register-race.test.ts`, `concurrency.test.ts`) `child_process.fork` a BUILT worker (`dist/*-worker.js`) that runs as a real Node process and resolves `@agentbbs/core` via the package `exports` → `dist` (NOT the alias). So when you add a `core` export that a forked worker consumes, you MUST `pnpm run build` first — and because `tsc -b` is incremental, a deleted/stale `core/dist` needs `--force` (or a cleaned `.tsbuildinfo`) to actually regenerate, else the worker dies with `ERR_MODULE_NOT_FOUND` and the test reports `worker N exited code=1`. Evidence: surfaced during the Story 3.0 lead smoke — deleting `core/dist` to prove the alias left the forked workers unable to resolve core until a forced rebuild. The standard gate (`pnpm run build` before `pnpm test`) covers this; the caveat matters only when iterating tests without a build.

**Historical motivation (why this rule existed):** Recurred across Epic 2 — the Story 2.4 dev hit a false-red `INTERNAL_ERROR` in the `mcp-server` integration tests because `core/dist` predated the new `updateFocus`/`NO_IDENTITY` exports; 2.5 and the per-story stdio smokes had to build-first for the same reason. It read as a real failure but was pure staleness. Rule 2 itself flagged the Vitest `resolve.alias` as the preferred permanent fix and said to supersede on landing — which Story 3.0 did.

## 3. Verify version-specific external API against the INSTALLED type definitions, not just web search

**Context:** Implementing against any third-party library/SDK/framework whose API is version-specific, when you are not 100% certain of the exact current signature (the Research-First trigger in `.claude/rules/research-first.md`).

**Rule:** Treat the **actual installed package's published types** (`node_modules/<pkg>/**/*.d.ts`) and the **official docs/source pinned to the installed version tag** as the authoritative source for signatures, parameter order, accepted input shapes, and return types. Use web search / Perplexity for discovery and trade-offs, but when a search result asserts a concrete API shape, **confirm it against the installed `.d.ts` before coding to it** — and when they disagree, the `.d.ts` wins. Record the verified signature (and any delta from what search claimed) in the story's Dev Notes / Dev Agent Record so the next agent doesn't re-litigate it.

**Why:** Epic 2 Story 2.1. A Perplexity pass on `@modelcontextprotocol/sdk@1.29.0` returned several confidently-wrong claims — that `registerTool` takes the tool name *inside* the config object, that you must hand-convert Zod to JSON Schema, and that you connect via `transport.listen(server)`. The published `dist/esm/server/mcp.d.ts` showed the opposite: name is a separate first argument, `inputSchema` natively accepts a Zod-4 raw shape / Standard Schema, and you connect via `await server.connect(transport)`. Coding to the search answer would have produced an API that does not compile, then a confused debugging loop. The installed types are generated from the exact code that runs — they cannot be out of date or hallucinated. (This sharpens, and is consistent with, `research-first.md`'s "confirm API and method signatures … prior to implementing".)

---

## 4. Verify a story's "Source facts" about EXISTING repo symbols before coding to them

**Context:** A story's Dev Notes assert that some internal symbol already exists — an error code, an event type, a function/type, a `file:line` reference, an exported name. Especially when the story was lead-authored quickly rather than via the full create-story artifact pass.

**Rule:** Treat every story Source-fact about EXISTING code as a **claim to confirm against the repo**, not a given. Before relying on "X already exists at `file:line`" / "the closed set already has CODE Y" / "helper Z is exported", `grep`/read the cited location. If the claim is wrong, make the smallest faithful additive correction (e.g. append the missing error code to the closed set — non-breaking), implement the story, and surface the corrected premise loudly in the Dev Agent Record / Change Log. This is the **internal-codebase analogue of Rule 3** (which covers external APIs): the same "don't code to an unverified asserted signature" discipline, applied to the project's own surface.

**Why:** Epic 4 Story 4.5. The lead-authored story claimed `HANDLE_NOT_FOUND` was "already in the closed set at `errors.ts:29`" — but line 29 was `BOARD_NOT_FOUND`; the code did not exist. The dev grepped, found the claim false, added `HANDLE_NOT_FOUND` additively (correct + non-breaking per the error-contract policy), and surfaced it. No harm done — *because the dev verified*. A confidently-wrong source-fact about an existing symbol can otherwise mis-scope a story (code to a missing import, assume a wrong shape) and produce a confused failure. Lead-authoring stories for speed is fine; skipping the dev-side verification of their asserted facts is not.

## 5. A concurrency-claiming AC requires a genuine cross-process race test — sequential coverage does not satisfy it

**Context:** A story has an AC asserting concurrent/parallel behavior ("two X arrive concurrently", "no lock, no error", "both land", "exactly one wins", "dedups to one"). The op may be a plain `append` OR an `appendGuarded`.

**Rule:** Prove the concurrency AC with a **genuine forked cross-process race** (mirror `packages/data-access/src/*-race.test.ts` / `concurrency.test.ts` — fork N real OS-process workers against a built `dist` worker, an IPC start-barrier, all hitting the real SQLite ledger), not merely a sequential `await a; await b` test. "It's a plain append, there's no `appendGuarded` contention to stress" is **not** a sufficient reason to skip it — the load-bearing guarantee is usually a *read-side derivation under concurrency* (a min-`seq` activator, a benign double-write that must dedup) that no sequential test exercises. The QA stage owns this; the dev should not defer it away.

**Why:** Epic 4 Stories 4.3 + 4.5. The dev twice argued the plain-`append` `reply`/`add_participant` ops needed no race beyond the sequential proof. QA overrode both; the forked races caught real, otherwise-untested guarantees — the `reply` activator min-`seq` derivation under an 8-way race, and the benign concurrent double-`board.joined` / double-`room.participant_added` collapsing to exactly one member/participant (empirically confirmed 8/8 raw double-writes → 1). Epic 1's `concurrency.test.ts` did NOT cover these (it only stresses `identity.seen`). Sequential tests pass while the real contention behavior stays unproven.

## 6. When a tool result contradicts committed/known state, verify against git ground-truth before acting

**Context:** Any agent stage (dev, QA, review, lead) receives a tool result that is surprising or inconsistent with what was just committed/observed — a file `Read` showing code that "shouldn't be there", a diff that doesn't match the changeset, a test failure referencing code nobody wrote, a batch of cancelled/garbled results.

**Rule:** Before acting on a surprising tool result — *especially* before editing code or recording a finding based on it — **confirm it against git ground-truth**: `git show <sha>:<path>`, `git diff HEAD -- <path>`, `git status --short`, `git log --oneline`. If the tool result disagrees with git, trust git and discard the phantom. Never apply a code change or log a defect whose entire basis is an unverified surprising read.

**Why:** Epic 4 Story 4.5 code review. A corrupted tool result fed the reviewer a fabricated `Read` of `append.ts` showing code that does not exist; the reviewer "found" a SQLite concurrency defect and began applying an `.immediate()` fix — then caught it via `git show`/`git diff` (the file was unchanged) and fully reversed it (the lead independently re-confirmed `git diff HEAD -- append.ts connection.ts` was empty before committing). A phantom tool result that survives into a code edit or a logged finding corrupts the changeset and the audit trail; git is the authoritative state.

## 7. Mutation-test a high-stakes semantic test to confirm it is not vacuous

**Context:** Adding a test that pins an easy-to-get-wrong SELECTION / ORDERING / PRECEDENCE / boundary semantic of a marquee feature (e.g. "the highest-`seq` live-👍'd message is the contract", "the min-`seq` reply is the activator", a tie-break, a sort key). Especially in the QA stage.

**Rule:** Once, before trusting such a test, **mutation-test it**: temporarily change the production code to a plausible WRONG implementation (e.g. "most reactors wins" instead of "highest seq", flip a comparator, off-by-one a boundary) and confirm the new test goes RED. Then revert the production code **byte-identically** (`git diff` on it must be empty) and confirm the test is green again. A test that passes against BOTH the right and a wrong implementation is vacuous and guards nothing. Do this for the core semantic of a marquee feature — not for every test (it has a cost).

**Why:** Epic 5 Story 5.3. The QA stage temporarily mutated `currentContract` (`contract.ts`) to a "most live reactors wins" selector and confirmed BOTH its new tests (highest-`seq`-not-most-reactors; ≥3-level reversion) went red — proving they discriminate, not merely pass — then reverted `contract.ts` byte-identically. This is the same class the Story 1.3 retro flagged (vacuous type assertions that pass regardless of correctness because Vitest ran them as runtime no-ops). A green test that does not fail when the code is wrong provides false assurance on exactly the load-bearing logic.

## 8. When a story's AC contradicts an earlier story's IMPLEMENTED design, reconcile explicitly — don't blindly implement it

**Context:** A later story's AC (from a planning doc authored before implementation) conflicts with the behavior an EARLIER story already shipped and proved — e.g. a gate the earlier story deliberately does not apply, a field shape since changed, an error the earlier design replaced with a side effect.

**Rule:** Do NOT mechanically implement the new AC over the established, shipped reality. STOP, determine which is correct (the implemented design is usually the ratified truth; the planning doc predates it), and **reconcile explicitly**: document the resolution in the story's Dev Notes / a "Design decision", adjust the AC's intent to fit the real surface, and surface it to the reviewer. If the earlier design is genuinely wrong, that is a `correct-course` change to the earlier surface — not a contradictory bolt-on in the new story. Either way the contradiction is resolved on purpose, in writing, never silently.

**Why:** Epic 5 Story 5.1. The epics.md AC said "a non-participant who posts a message → `NOT_A_MEMBER`", but Story 4.3 had already shipped `reply` as "acting = joining" (it GRANTS participation, by design, for the open-negotiation property). Blindly adding a `NOT_A_MEMBER` gate to `reply` would have broken Epic 4. The lead reconciled it in the 5.1 Dev Notes (the room-message post grants; the `NOT_A_MEMBER` gate the AC references is `post_announcement`'s sub-board gate, reaffirmed) instead of implementing the contradiction. BMad planning docs are written before implementation, so later-story ACs WILL sometimes contradict earlier-story reality; resolving it silently in either direction ships a defect.

## 9. Defer a performance/cost concern to its NAMED-CONSUMER story for measurement — not prematurely, not indefinitely

**Context:** Code review (or dev) surfaces a performance/cost concern (an extra read, an O(n) fold, a double-query) on a path whose real hot-path CONSUMER does not exist yet — so it cannot be sensibly measured or optimized at its origin.

**Rule:** Do NOT optimize it now (premature optimization, often the wrong tuning before the access pattern is real). Instead defer it in `deferred-work.md` with the explicit NAMED consumer story that will exercise the hot path ("→ Story X.Y, the `check` consumer"). When that consumer lands, it MUST actually MEASURE the cost (real timing at a representative scale) and CLOSE the item with evidence — either "measured, acceptable at V1" (close won't-fix-with-evidence) or a contained, behaviour-identical optimization. Never carry a perf item forever unmeasured, and never optimize it before its consumer exists.

**Why:** Epic 6 Story 6.1. Items 3.0-b (the `recordSeen` guard-before-append double-read) and 4.6-a (the `roomJoinSeq`/`roomMessagesSince` per-call full-stream fold) were flagged at the Story-3.0 / Story-4.6 code reviews and pointed at "Story 6.1, the `check` hot-path consumer". They were carried untouched for 2–3 epics (no premature optimization with no real access pattern), then Story 6.1 measured the actual per-call fold cost over the real SQLite ledger and applied a contained ~8× optimization, closing both with evidence. This avoided BOTH the class of premature optimization (tuning `recordSeen` before `check` existed) AND the class of silent perf debt (a perf concern that ships unmeasured because no story ever owned measuring it). The "→ named consumer" pointer in the deferred-work entry is what makes the measurement actually happen.

## 10. An open-source-facing or agent-CONSUMED doc/asset must ship a content-guard test pinning its machine-relevant claims to the code

**Context:** Authoring a doc or asset that a machine (an agent, a downstream installer, a contract consumer) relies on — a tool/API contract, a protocol spec agents follow, a prompt snippet inlined into an agent's system prompt, an event/error vocabulary doc. Distinct from prose docs a human merely reads.

**Rule:** Ship the doc WITH a content-guard test that pins its machine-relevant claims to the code's SOURCE OF TRUTH — not a hand-copy. Pin tool names to the live `McpServer.listTools()`; error codes to `BOARD_ERROR_CODES`; events to `EVENT_TYPES`; named moves/semantics to the documented constant; the referenced-tools of an inlined snippet to the live tool set. Parse the machine-relevant part from a clearly-delimited block (a sentinel pair like `AGENTBBS-*:BEGIN/END`, or a section-scoped table) so the parse is robust and prose mentions don't false-positive. Mutation-test the guard (Rule 7): a drift (a dropped name, a renamed code, a phantom tool added to the inlined block) must turn it RED. A doc that silently lies about the code is worse than no doc; for an agent-consumed asset (a prompt snippet the install kit inlines verbatim), a phantom tool becomes a runtime failure the agent hits.

**Why:** Epic 7. The tool contract (7.0), the Negotiation-Protocol doc (7.1), and the agent-prompt snippet (7.3) each shipped a content-guard pinning their claims to code (names↔`listTools()`, codes↔`BOARD_ERROR_CODES`, events↔`EVENT_TYPES`, the four moves + the FR21 "highest-`seq` live-👍'd" semantic, the snippet's tools↔the live set). In THREE of the four, the QA stage extended the guard and caught a REAL gap the dev's guard missed: the §5 event-vocab pin (7.0), the FR21-semantic pin (7.1 — a "most 👍s" rewrite passed every other guard), and the "no phantom tools" pin (7.3 — a fake tool inlined into an agent prompt). Each was mutation-tested non-vacuous. Without the code-pin, an open-source contract or an agent-configured snippet drifts the moment the surface changes, and nobody notices until an agent calls a tool that no longer exists.