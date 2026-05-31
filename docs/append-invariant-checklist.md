# THE APPEND INVARIANT — enforcement & review checklist

The append invariant is **load-bearing** (architecture.md, project-context.md): it is
what makes `seq` a correct total order and what makes the ledger replayable. A
violation is a build failure or a HIGH review finding, never a deferrable nit.

> Every state change is an event appended via `dataAccess.append`. **No `UPDATE`/`DELETE`
> against `events`, ever. Never persist derived state. Order always by `seq`, never
> `created_at`.**

Enforcement is split between an automated lint rule (mechanical patterns) and this
review checklist (semantic judgement the linter cannot make). Story 1.2 establishes
both; the SQL it guards lands in `data-access` in Story 1.4.

---

## Lint-caught (automatic — `eslint.config.js`)

Scoped to `packages/core` and `packages/data-access` via `no-restricted-syntax`:

| Pattern | Rule message |
| --- | --- |
| `UPDATE events …` in a string/template literal | no UPDATE against the events ledger |
| `DELETE FROM events …` in a string/template literal | no DELETE against the events ledger |
| `ORDER BY created_at` in a string/template literal | order by `seq`, never `created_at` |

These catch the common mechanical forms. They are deliberately conservative
(literal SQL text) to avoid false positives on unrelated code; they will NOT catch
SQL assembled from fragments, dynamic table names, or derived-state columns invented
with novel names. That is what the review checklist below is for.

## Checklist-caught (human review — required on every `core`/`data-access` PR)

Reviewer MUST confirm each of these before approving code that touches the schema,
SQL, or the event model. Any "no" is a HIGH finding.

- [ ] **No in-place mutation of `events`.** No `UPDATE`/`DELETE`/`REPLACE`/`UPSERT`
      against `events`, including via dynamic SQL, an ORM, or string concatenation
      the linter cannot see.
- [ ] **No persisted derived state.** No column that stores something computable from
      the ledger: e.g. `status`, `current_contract`, `last_seen`, `is_active`,
      `activated_at`, membership flags, cursors, reaction counts. These are computed
      by indexed read **every time** (FR20/FR21).
- [ ] **Schema is append-only in spirit.** The only base table is
      `events(seq, type, actor, created_at, payload)` (+ indexes). New "tables" that
      cache derived state are forbidden; if a read is slow, add an index, not a cache.
- [ ] **Ordering is by `seq`.** Every `ORDER BY`, every "latest"/"first"/"min"
      computation, every pagination cursor uses `seq` — never `created_at` (which is
      display-only ISO-8601 UTC text) and never wall-clock.
- [ ] **One writer path.** All appends flow `core → dataAccess.append`. No client
      (`mcp-server`, `cli`, `web`, `vscode-extension`) constructs SQL or events directly.
- [ ] **Invariant checks live inside the append transaction** (check-then-insert
      atomic) — not as a pre-read followed by an unguarded insert.
- [ ] **Event `type` is from the closed vocabulary** (`identity.registered`, … ).
      Renaming an existing type is a breaking, versioned export-format change.

## Why lint-where-feasible (AC2 latitude)

AC2 explicitly allows "lint where feasible, else a documented review checklist backed
by a lint rule." A general-purpose linter cannot reliably decide whether an arbitrary
new column *is* derived state, or whether dynamically-assembled SQL mutates `events` —
those need human semantic judgement. So the mechanical, high-confidence forms are
lint-enforced (above), and the semantic surface is this checklist, anchored by the
same lint rule so the two halves stay aligned. Revisit when real SQL lands in
Story 1.4: tighten the lint patterns against the actual queries written there.
