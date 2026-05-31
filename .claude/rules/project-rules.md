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

## 2. Build cross-package `dist/` before running cross-package tests

**Context:** Any story that adds or changes a `@agentbbs/*` package's PUBLIC export (a new symbol in a `src/index.ts` barrel) that another workspace package consumes — and then runs the test suite, the typecheck, or a lead smoke that exercises the consumer.

**Rule:** After editing a package's barrel and BEFORE running the full `pnpm test` / `pnpm run typecheck` / a cross-package lead smoke, run `pnpm run build` (or at least build the changed producer package). Cross-package tests resolve `@agentbbs/<pkg>` through its built `dist/` (the package `exports` map points at `./dist`), NOT the TypeScript source — so a brand-new `core` export is invisible to `mcp-server`/`cli`/`ui-shared` tests until the producer is rebuilt. Intra-package unit tests are unaffected; only cross-package consumers see the stale surface.

**Why:** Recurred across Epic 2. The Story 2.4 dev hit a false-red `INTERNAL_ERROR` in the `mcp-server` integration tests because `core/dist` predated the new `updateFocus`/`NO_IDENTITY` exports; 2.5 had to build-first for the same reason; the lead rebuilt before every per-story stdio smoke for the same reason. It reads as a real failure but is pure staleness — wasted a debugging cycle each time. **Preferred permanent fix (tracked in `deferred-work.md`, do it when the test tooling is next touched):** add a Vitest `resolve.alias` mapping `@agentbbs/*` → each package's `src/index.ts`, or a `pretest`/`pretypecheck` build step, so the build-first dance becomes unnecessary. Until that lands, build-first is mandatory and this rule stands; **delete or supersede this rule** once the alias/pretest fix is in.

## 3. Verify version-specific external API against the INSTALLED type definitions, not just web search

**Context:** Implementing against any third-party library/SDK/framework whose API is version-specific, when you are not 100% certain of the exact current signature (the Research-First trigger in `.claude/rules/research-first.md`).

**Rule:** Treat the **actual installed package's published types** (`node_modules/<pkg>/**/*.d.ts`) and the **official docs/source pinned to the installed version tag** as the authoritative source for signatures, parameter order, accepted input shapes, and return types. Use web search / Perplexity for discovery and trade-offs, but when a search result asserts a concrete API shape, **confirm it against the installed `.d.ts` before coding to it** — and when they disagree, the `.d.ts` wins. Record the verified signature (and any delta from what search claimed) in the story's Dev Notes / Dev Agent Record so the next agent doesn't re-litigate it.

**Why:** Epic 2 Story 2.1. A Perplexity pass on `@modelcontextprotocol/sdk@1.29.0` returned several confidently-wrong claims — that `registerTool` takes the tool name *inside* the config object, that you must hand-convert Zod to JSON Schema, and that you connect via `transport.listen(server)`. The published `dist/esm/server/mcp.d.ts` showed the opposite: name is a separate first argument, `inputSchema` natively accepts a Zod-4 raw shape / Standard Schema, and you connect via `await server.connect(transport)`. Coding to the search answer would have produced an API that does not compile, then a confused debugging loop. The installed types are generated from the exact code that runs — they cannot be out of date or hallucinated. (This sharpens, and is consistent with, `research-first.md`'s "confirm API and method signatures … prior to implementing".)

---