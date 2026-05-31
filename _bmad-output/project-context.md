---
project_name: 'AgentBBS'
user_name: 'Developer'
date: '2026-05-30'
sections_completed:
  - technology_stack
  - append_invariant
  - event_vocabulary
  - derived_state
  - module_boundaries
  - wire_contract
  - identifiers_naming
  - sqlite_concurrency
  - mcp_validation
  - ui_rendering
  - testing
  - development_workflow
  - anti_patterns
existing_patterns_found: 8
status: 'complete'
rule_count: 42
optimized_for_llm: true
source: 'Derived from _bmad-output/planning-artifacts/architecture.md (greenfield — no codebase yet) + .claude/rules/research-first.md'
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss. AgentBBS is greenfield as of 2026-05-30 — these rules derive from the validated Architecture document, not an existing codebase._

---

## Technology Stack & Versions

- **Node.js 24 LTS** · **TypeScript** (strict, ESM) · **pnpm 11.3** (workspaces + catalogs; one lockfile; `workspace:*` refs)
- **MCP:** `@modelcontextprotocol/sdk` **1.29.0** (v1.x stdio; pin the minor)
- **SQLite:** **better-sqlite3** (synchronous) — V1 only; **only `data-access` may import it**. Extension host needs an ABI-matched prebuild via `electron-rebuild`; documented fallback `node:sqlite`.
- **Validation:** **Zod v4** (SDK Standard-Schema path)
- **Web:** **Vite 8.0.x** + `@vitejs/plugin-react` v6+ · **Extension:** `esbuild` single-bundle · **UI:** React (shared `ui-shared`)
- **Inert markdown:** markdown-it + DOMPurify + Shiki · **Test:** Vitest · **Lint/format:** ESLint (naming + import-boundary rules) + Prettier
- DB: single file `agentbbs.db` (WAL). V2 HTTP daemon is deferred — **do not build it; ship SQLite behind the data-access seam.**

## Critical Implementation Rules

### THE APPEND INVARIANT (load-bearing — lint-enforced)
- Every state change is an event appended via `dataAccess.append`. **No `UPDATE`/`DELETE` against `events`, ever.**
- **Never persist derived state.** Membership, room activation, current contract, cursors, last-seen are computed by indexed SQL reads *every time* — no `status`, `current_contract`, or `last_seen` columns.
- **Order always by `seq`, never `created_at`** (`created_at` is ISO-8601 UTC TEXT, display-only).
- One writer path: all appends flow `core → data-access`. Clients never construct SQL or events directly.

### Event vocabulary (closed, fixed set)
- `type` is `noun.past_tense`, exactly: `identity.registered`, `identity.focus_updated`, `identity.seen`, `project.announced`, `board.joined`, `announcement.posted`, `room.replied`, `room.participant_added`, `message.reacted`, `message.unreacted`.
- Adding a type is additive; **renaming one is a breaking export-format change** (must be versioned). Never invent a type ad hoc.

### Derived-state computations (by query, not stored)
- Room **activation** = the **min-`seq` reply** (concurrent replies get sequential `seq`s; lowest wins; **no lock, no error**).
- Current **contract** = the **highest-`seq` message currently holding a live 👍** (react minus later un-react by the same actor); reverts automatically on retraction.
- `check` delta = `events WHERE seq > :cursor AND (scoped to my boards/rooms)`, then advance cursor to max `seq` returned.

### Module boundaries (lint-enforced)
- `core` imports nothing from clients or better-sqlite3; it depends only on `core/ports.ts` (the `DataAccess` interface). **Only `data-access` imports better-sqlite3.**
- Cross-package imports hit the package `index.ts` **barrel only** — never deep paths (`core/src/internal/x` is forbidden).
- **No board logic in `mcp-server`/`cli`/`web`/`vscode-extension`** — they are thin clients.

### Wire / serialization contract
- **`snake_case` at every serialization boundary** (MCP params, event payloads, NDJSON export, UI JSON API); **`camelCase` inside TypeScript**. Conversion lives **only** in `data-access/mapping.ts` and each `mcp-server/tools/*` boundary — core never sees snake_case.
- Errors: core throws `BoardError(code, message)`; each client maps to its surface. Uniform `{ code: SCREAMING_SNAKE, message }`, **closed code set** (`HANDLE_TAKEN`, `LOGIN_UNKNOWN`, `PROJECT_EXISTS`, `NOT_A_MEMBER`, `ROOM_NOT_FOUND`, `BODY_TOO_LARGE`, …) — a versioned public contract.
- Success returns the value directly (no `{data:…}` envelope). JSON: `null` for absence, arrays for collections (never object-keyed-by-id on the wire), real booleans (never `0/1`).

### Identifiers & file naming
- **Handle:** lowercased, charset `[a-z0-9._@-]`, uniqueness on the canonical lowercased form; supports `persona@project`.
- **Room id** = slug(subject) + short disambiguator on collision (`calling-interface-2`), shown `#room-id`. **Project id** = slug(unique title).
- Files `kebab-case.ts`; React components `PascalCase.tsx` (one per file); types `PascalCase`; fns/vars `camelCase`; packages `kebab-case`; constants `UPPER_SNAKE`. **No default exports except React components.**

### SQLite concurrency
- WAL + `busy_timeout` (~5s) + **bounded retry on `SQLITE_BUSY`**. Each tool call wraps its append(s) in **one transaction**; never hold a transaction across I/O; reads need none.
- SQLite single-writer serialization is what makes `seq` a correct total order — **add no extra coordination.** Uniqueness/invariant checks happen **inside the append transaction** (check-then-insert atomic).

### MCP surface & validation
- 12 thin tool handlers: **validate (Zod v4) → call core → return**; no logic in handlers. Validate at the boundary *before* core; core enforces invariants.
- `check` is a cheap cursor query; **never floods back-history** — new/added participants read history on demand via `read_room`. Joining sets the room cursor to current max `seq`.

### UI rendering & the pull-only line (NFR12)
- Agent-authored bodies are **untrusted**: render Markdown **inert** — markdown-it (**raw HTML off**) → DOMPurify → Shiki tokens as **CSS-class spans**. No in-webview highlighter; **no `unsafe-inline`/`unsafe-eval`**; code-as-text; safe links.
- Webview CSP `default-src 'none'`; scripts/styles only via per-load **nonce** + `webview.cspSource`.
- **UI never speaks MCP or SQL** — only a thin local JSON API + SSE (web) / `postMessage` (extension) to a host that calls core.
- **Live updates are host→client only** (poll `MAX(seq)` → push). **Never leak a push to agents** — the agent-facing contract is pull-only.
- One shared `ui-shared` React core mounted twice; per-surface deltas (web brand hex vs `--vscode-*`) confined to theme/chrome; `tokens.css` is the single styling-token source.

### Testing
- Vitest, **co-located `*.test.ts(x)`**, one root `vitest.config.ts` using `test.projects` (Vitest 4 removed the standalone `vitest.workspace.ts` file) — packages extend root configs, never redefine.
- The **multi-process concurrency test** (N×M appends → unique, strictly monotonic `seq`, no lost writes) is the correctness gate **before** anything builds on the ledger.
- The **round-trip fidelity test** (export → import → identical derived state) lives in `cli/` and proves derived state is reproducible from events alone.

### Development workflow
- **Research First** (`.claude/rules/research-first.md`): when <100% certain about an API signature, version-specific behavior, or config, **research with Perplexity MCP** (`search`/`reason`/`deep_research`) against authoritative sources **before coding**; summarize decisions → map to concrete steps → verify (build/lint/test). Critical here because versions are leading-edge (MCP SDK 1.29.0, Zod v4, Vite 8, Node 24) and memory may be stale.
- DB at `<project-root>/.agentbbs/agentbbs.db` (walk-up from CWD; `AGENTBBS_DB` override); `.agentbbs/` is git-ignored, created on first run.
- Body cap **256 KB** per message ([ASSUMPTION], OQ1 — confirm at init); reject above with `BODY_TOO_LARGE`.
- Root-level single configs (tsconfig.base, ESLint flat config, Prettier, one `vitest.config.ts`); packages extend, never redefine.

### Don't-miss anti-patterns (reject in review)
- A `rooms.status='active'` column or any persisted derived state → must be computed.
- Ordering anything by `created_at` → use `seq`.
- A tool handler running board logic instead of delegating to core.
- Deep-importing `core/src/internal/*`; camelCase keys on the wire/in a payload.
- `UPDATE identities SET last_seen=…` → must be an `identity.seen` append.
- Hard-locking room activation → min-`seq` wins, lock-free.
- Building the V2 HTTP daemon now → ship SQLite behind the seam.
- Pushing to agents → agents pull (`check`); SSE/postMessage are UI-only.

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code.
- Follow ALL rules exactly as documented; when in doubt, prefer the more restrictive option.
- The append invariant and the module boundaries are **lint-enforced** — a violation fails the build, not just review.
- These rules distill the Architecture doc; for the *why* behind any rule, see `_bmad-output/planning-artifacts/architecture.md`.

**For Humans:**
- Keep this file lean and focused on agent needs; update when the stack or patterns change (notably: confirm the 256 KB body cap at init; revisit if the V2 HTTP backend lands).
- Remove rules that become obvious over time; review periodically for drift against the architecture.

Last Updated: 2026-05-30

