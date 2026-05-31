# Adversarial Review — AgentBBS PRD (2026-05-30)

**Reviewer stance:** Cynical, adversarial. Goal is to find what's wrong, weak, hand-wavy, or self-deceiving — not to be balanced.

**One-line verdict:** The "dumb board, smart agents" frame is doing enormous load-bearing work to dodge the exact failure modes the PRD itself cites as the #1 reason multi-agent systems fail — and the one differentiator (the negotiation layer) is shipped as *unenforced prose*, which is precisely the free-form-messaging approach the competitor research blames for those failures.

---

## Critical

- **[CRITICAL] The differentiator is unenforced prose — i.e., the documented #1 failure cause re-labeled.**
  Location: §1 thesis, FR25–FR27, Appendix A, Addendum §E.
  The PRD's whole differentiation claim rests on: "the multi-agent failure-mode literature… attributes roughly four in five failures to specification and inter-agent misalignment" and "every analog ships free-form messages and explicitly punts on data-contract negotiation." But AgentBBS's "negotiation layer" is *also* free-form messages — FR18 "Participants post **freeform prose** messages… parses nothing" — wrapped in a **convention agents follow, not a behavior the board enforces** (FR25, §6.7 header). The only structured signal in the entire system is 👍 (FR19: "the single structured signal"). So the answer to "how is this different from MCP Agent Mail?" is: *a seeded README post and a recommended prompt snippet*. That is not a "typed boundary-contract negotiation layer" (Addendum §E calls it exactly that — the word "typed" is unearned; nothing is typed). The thesis claims to attack the spec-misalignment failure class but ships a mechanism that cannot detect, prevent, or even notice spec misalignment. The board cannot tell a ratified contract from two agents 👍-ing different messages they each *think* is the contract.
  Suggested fix: Either (a) make *something* structured and enforced — e.g., a `propose_contract` tool that snapshots an immutable contract body and a `ratify` that references that snapshot by ID, so "the contract" is an unambiguous object, not "latest message with a live 👍 as computed by the reader"; or (b) drop the "typed"/"first-class"/"defensible thesis" language and honestly position V1 as "Agent Mail + a recommended protocol doc," which is a far weaker (but truthful) claim.

- **[CRITICAL] Two agents can claim the same handle and the PRD waves it away with "single operator, single machine."**
  Location: FR2, NFR7, Addendum §A, §C.
  "V1 auth is **claim-based**: an agent simply dials in and **claims a handle** — there is no secret token and the board does not authenticate." The handle *is* the credential (Addendum §A, §C). Nothing in the PRD says what happens when two agents `register`/`login` the same handle. On one machine running a fleet of agents, handle collisions are not exotic — FR39's default handle is derived from "persona/role and project scope (e.g. `amelia-dev@taskflow`)," so two BMad dev-agents on the same project get the *same default handle by construction*. The "single-operator/single-machine" trust model addresses *malice*, not *collision*; collision is an availability/correctness bug, not a security one, and the trust model doesn't touch it. Worse, FR21's "current contract" is computed from 👍 events keyed by `actor` handle — if two distinct agents share a handle, a 👍 from one is indistinguishable from a ratification by the other, silently corrupting the one structured signal the system has.
  Suggested fix: Specify collision semantics explicitly: is `register` of an existing handle an error, a no-op login, or a takeover? Given claim-based auth, the only safe answer is "register is idempotent-or-rejected; there is no way to *prove* you are the original claimant" — which should be stated as a known limitation. Add a uniqueness constraint and define the FR39 default to include a disambiguator so two agents never collide by default.

- **[CRITICAL] Pull-only + an agent whose workflow already ended = the blocking question that never gets answered.**
  Location: FR22–FR24, FR35–FR36, NFR9, UJ1.
  The core loop (UJ1) depends on Devi's DB agent calling `check` "at its next workflow-step boundary." But there is no guarantee Devi's agent *has* a next workflow-step boundary. If Devi's agent has finished its run, terminated, or is between sessions, the `.toml` post-condition hook (FR35) never fires — hooks only fire while a workflow is executing. Rae's agent posted a blocking question into the void. The PRD's only backstop is NFR9 / FR30: "the human's global read + UI stall-visibility… is the V1 deadlock backstop (escalate to a human peer)." **That is the human becoming the message bus again** — the exact thing §1 says AgentBBS removes. The PRD has reintroduced the relay as its deadlock recovery path and not noticed. The cited competitor research even flags the precedent for this (A2A's `input-required` state, Addendum §E) — the PRD acknowledges the precedent and then ships nothing analogous.
  Suggested fix: Add an explicit "pending question has no live responder" story. Options: a liveness/last-seen threshold (FR8 data exists) that lets a poster see "the peer I'm waiting on hasn't dialed in for N hours → escalate," surfaced *to the asking agent*, not only to the human UI. At minimum, state plainly that V1 cannot guarantee delivery to an agent that has stopped, and that human escalation is the (re-introduced) relay for that case.

---

## High

- **[HIGH] "The board stays dumb" is repeatedly used to avoid specifying behavior that the board is the only thing that *can* specify.**
  Location: §6 header, §6.7 header, NFR9, WON'T list.
  "The board enforces *bookkeeping* rules… it never enforces *meaning*" is a fine principle, but the PRD smuggles genuinely *mechanical* gaps under the *meaning* banner. Examples that are bookkeeping, not meaning, and are left unspecified: (1) conflicting 👍s on different messages by different participants — who is "agreed"? FR21 says "most recent message that currently holds a live 👍," so a junior agent's stray 👍 on a later throwaway message *silently becomes the contract* over the actual ratified one. (2) Deadlock under simultaneity — Addendum §E cites "0% sequential vs 25–95% simultaneous in DPBench" and says it "needs explicit turn/arbitration"; the PRD ships **no turn-taking and no arbitration**, only "escalate to a human." (3) A negotiation that never freezes — CM3 *measures* it but nothing *prevents* it. The board is the natural place for a minimal arbitration primitive (e.g., "a contract requires 👍 from all current room participants"), and "dumb board" is being used to dodge it.
  Suggested fix: Distinguish "enforces meaning" (genuinely out of scope) from "tracks agreement state" (in scope, and currently underspecified). Define what "agreed" means when multiple participants and multiple 👍s exist — e.g., contract = latest message holding live 👍s from ≥2 distinct participants, or from all current participants. This is bookkeeping, not meaning.

- **[HIGH] SM2 and SM3 are "I'll know it when I see it," not measurable.**
  Location: §2, SM1–SM4, CM1–CM3.
  SM2 "Real time saved" → "coordination overhead **measurably drops** vs. the manual-relay baseline ('I stopped being the message bus')." There is no baseline captured, no unit (tokens? wall-clock? human interventions?), and the parenthetical quote *is* the measurement, which means there isn't one. SM3 "≥1 instance where the operator or a fresh agent returns to a room to recover *why*… and **succeeds**" — "succeeds" is unjudged and N=1. SM1 and SM4 are at least binary-observable (one end-to-end no-relay negotiation; agents `check` unprompted), so they're the only honest metrics here. The counter-metrics are softer still: CM1 "spend more tokens coordinating than the relay cost they replaced" requires measuring the *counterfactual* relay cost that, by construction, never happened (you used the board instead). CM2/CM3 say "stay bounded"/"stay rare" with no number.
  Suggested fix: Define one concrete unit per metric and capture a baseline before first real use (e.g., SM2: count of human copy-paste relays per boundary, manual run vs. board run). For CM1, instrument coordination token spend per resolved boundary and pick a ceiling. For CM3, state the bound (e.g., "<20% of opened rooms remain unfrozen after the project's agents go idle").

- **[HIGH] "Indistinguishable at the protocol level" collides with the operator's god-read lens and the claim-based model.**
  Location: §3, FR9, FR28, FR2.
  §3: agents and humans are "**indistinguishable at the protocol level**." But the operator has a "**global read lens** ('operator sees all')" (§3, FR28) that no agent has. So they *are* distinguishable — one participant can read every private-by-membership room. The PRD says this is "read-only oversight, not a privileged control surface," but under claim-based auth (FR2) with no authentication, *nothing stops an agent from claiming the operator's handle / lens* if the lens is just another identity attribute. The PRD never says how the global-read lens is gated when there is no auth. If the lens is a UI-only affordance (the human reaches the DB directly, not via MCP), say so explicitly; if it's an identity capability, it's unprotected.
  Suggested fix: State that the global-read lens is a property of the *UI client's direct DB access*, not an MCP-grantable capability, and that no MCP identity can obtain it. Reconcile the "indistinguishable" claim by scoping it to "indistinguishable *among MCP clients*."

- **[HIGH] FR35's cadence hook is asserted to "deliver SM4" but the mechanism is aspirational and unscoped.**
  Location: FR35, FR36, SM4, Dependencies.
  SM4 ("Unprompted adoption") is "**delivered via** the BMad `.toml` cadence hook (FR35)" — stated as fact. But FR35 wires `check` as a "workflow-step post-condition," which only works (a) inside BMad, (b) while a workflow is running, and (c) if the operator enabled the per-workflow hook (FR36). So "unprompted adoption" is really "adoption that the operator explicitly configured per workflow," which is *prompted by configuration*. And it does nothing for non-BMad adopters — the very "outside developers who will evaluate, adopt, and contribute" §1 names. The success of the headline adoption metric is bolted to one optional config hook in one framework.
  Suggested fix: Separate "agents check on cadence" (the behavior) from "BMad `.toml` hook" (one delivery mechanism). Document the framework-agnostic path (the FR27 prompt snippet) as the primary driver of SM4, with the `.toml` hook as the BMad convenience. Re-word SM4 so it doesn't presuppose BMad.

- **[HIGH] Concurrency hand-wave: "one per agent" stdio processes + UI on one SQLite file, justified by a bare [ASSUMPTION].**
  Location: NFR3, NFR4, §9.
  "Multiple stdio MCP server processes (one per agent) plus the UI read and write one shared SQLite file concurrently without corruption or lost writes. [ASSUMPTION] V1 relies on SQLite's locking/WAL." WAL gives you single-writer/multi-reader; a fleet of agents all *posting* and *reacting* and *advancing read cursors* (FR24 writes on read) are *all writers*. Under contention SQLite returns `SQLITE_BUSY`, and the PRD specifies no retry/backoff policy, no busy_timeout, and no behavior on a lost write. "[ASSUMPTION]" is not a design. The append-only model helps (no update-in-place) but the read-cursor advance (FR22/FR24) is a mutating write on the hot path of *every* `check`, which is the most frequent operation in the system.
  Suggested fix: Specify the concurrency contract: WAL + `busy_timeout`, idempotent/retryable writes, and explicitly that cursor-advance is a write so it's contention-relevant. State the agent-count ceiling at which V1 is expected to hold before the HTTP backend is "earned."

---

## Medium

- **[MEDIUM] "The contract is computed by the reader" makes the single most important value in the system the least stable.**
  Location: FR21, FR20, Appendix A, OQ2-resolved.
  The agreed contract is never stored; it's "the most recent message that *currently* holds a live 👍," recomputed by every reader from the event stream. This is elegant but means: there is no notion of "*this* contract was agreed by *these* parties at *this* time" — only an ever-shifting head pointer. A later 👍 on any later message (even unrelated) moves the contract. Retraction (FR20) silently reverts it. For a system whose SM3 is "recover *why* a contract is shaped as it is," the contract has no identity, no provenance record, and no agreement-set — you get "latest live 👍" and must reconstruct everything else by reading.
  Suggested fix: Even without storing "the contract," record a derived-but-durable *ratification event* (who 👍'd what, when) so provenance is a queryable fact rather than a recomputation. Consider freezing requiring an explicit move rather than implicit "latest 👍 wins."

- **[MEDIUM] Scope is bigger than "dumb board" implies — five sub-deliverables that are each their own project.**
  Location: §5 MUST list, Addendum §F (scope promotions).
  The MUST list quietly contains: the core board + MCP server, an operator **UI** (FR28–30), a **backup/restore CLI** with a backend-agnostic logical export format (FR32–34), a **BMad `.toml` cadence hook** (FR35), and a **BMad identity-bootstrap workflow** that edits `AGENTS.md` (FR37–39). Addendum §F shows four of these were *promoted into V1 during planning*. For a solo open-source build, the UI alone (OQ4: web vs TUI vs desktop still unresolved) and the backend-agnostic export format (FR34: must survive a backend swap that doesn't exist yet) are each substantial. The riskiest FR is **FR34** — designing an export format guaranteed to import into a *future, unbuilt* HTTP backend is speculative architecture; you cannot validate "backend-agnostic" against a backend that doesn't exist, so it's untestable in V1.
  Suggested fix: Demote the UI to read-only-minimal (FR31 is already SHOULD; consider pushing more of FR28–30 to SHOULD). For FR34, drop "backend-agnostic guarantee" and ship "dump/replay the event log" — a format that round-trips on SQLite today. "Backend-agnostic" becomes a *non-goal validated later*, not a V1 MUST.

- **[MEDIUM] FR38 commits to editing the agent's `AGENTS.md` / always-loaded context — a fragile, framework-coupling side effect.**
  Location: FR37, FR38, OQ6.
  The identity-bootstrap workflow "**records that handle in the agent's own always-loaded instructions**" / "stores it in the agent's instruction file (e.g. `AGENTS.md`)." A board product that programmatically writes into the consumer's prompt/context file is a strong coupling and a footgun: it assumes a writable `AGENTS.md` at project root, assumes the agent re-reads it each session, and silently commits a handle into version control. It also makes identity *per-project* by construction (OQ6), which the PRD admits breaks cross-project continuity. This is a lot of mechanism to compensate for the fact that claim-based auth has nowhere durable to put identity.
  Suggested fix: Make handle persistence a *recommendation* with a pluggable location, not a hard write into `AGENTS.md`. Provide the handle via a config/env the operator controls. Keep "where the agent stores its handle" out of the board's MUST surface.

- **[MEDIUM] `check` cursor advances on read with no replay (FR24) — a single missed/duplicated check loses items.**
  Location: FR24, FR22.
  "The cursor advances on read; un-read / replay is out of V1 scope." If a `check` call returns items but the agent crashes/ignores them before acting, those items are *gone from future checks* — the cursor moved. For a coordination board whose entire job is "don't drop the boundary question," a fire-and-forget cursor with no replay is a correctness risk, not just a convenience gap. Combined with the CRITICAL pull-only issue, a blocking question can be both *under-delivered* (agent gone) and *consumed-and-lost* (cursor advanced past it).
  Suggested fix: Either make cursor-advance explicit (agent acknowledges consumption) rather than implicit-on-read, or keep `check` non-destructive and track "last acknowledged" separately. At minimum, document the data-loss window as a known V1 limitation.

- **[MEDIUM] NFR6 / "context collapse" mitigation is asserted, not designed.**
  Location: NFR6 [ASSUMPTION], Addendum §E.
  "Messages and `check` results are structured so an agent need not re-read an entire thread to catch up — directly mitigating the documented 'context collapse' failure mode. [ASSUMPTION]." But FR16 says a newly added participant "sees the **full prior history** with no catch-up step," and UJ2 celebrates "reads the full history instantly." Full-history-on-join is the *opposite* of context-collapse mitigation — a long-running room dumps its entire transcript into the new agent's context. The PRD claims both "small, individually fetchable entries" and "full history instantly" without reconciling them.
  Suggested fix: Pick one and design it: paginated/ranged `read_room`, or a "👍-frozen message + N most recent" default view (UJ3 already implies agents *want* to read just the frozen message first). Make NFR6 a real API shape, not an assumption.

---

## Low

- **[LOW] "Daemonless" (NFR4) is slightly oversold given the cursor/concurrency writes.**
  Location: NFR4. "No always-on server process is required" is true, but the absence of a daemon is exactly *why* the concurrency story (NFR3) is hard — there's no single serialization point. The PRD presents daemonless as pure upside; it's a tradeoff that creates the NFR3 problem. Note the tradeoff.

- **[LOW] OQ-numbering gap (OQ2 resolved, OQ3 open) and OQ4 form-factor still open will block UX/architecture.**
  Location: §10. The UI form factor (web/TUI/desktop) being unresolved while FR28–31 commit to a UI means the UI FRs can't be validated yet. Fine to defer to `bmad-ux`, but the UI MUSTs are riding on an unmade decision — flag the ordering dependency.

- **[LOW] "Tamper-evident" (NFR1) is claimed but no mechanism is specified.**
  Location: NFR1. "the ledger is tamper-evident" — appended-only ≠ tamper-evident. Tamper-evidence requires hashing/chaining (the "Git's immutable history" analogy actually *does* hash; this PRD doesn't say it will). Either specify a hash chain or downgrade the claim to "append-only / audit-friendly."

- **[LOW] Seeded protocol announcement placement is unresolved (OQ3) yet FR26 asserts "every agent encounters it."**
  Location: FR26 [ASSUMPTION], OQ3. FR26 guarantees every agent encounters the protocol post "on first `check` / on joining a sub-board," but OQ3 admits placement and re-surfacing are undecided. The guarantee is written as settled while the mechanism is open. Reconcile.

---

## Summary of the through-line

The PRD's recurring move is: cite a hard multi-agent failure mode (deadlock, misalignment, premature termination, context collapse), then "address" it with a *convention*, a *doc*, or *the human watching the UI* — and call the board's refusal to do more a virtue ("dumb board"). The two things that would actually differentiate this from the commoditized substrate it admits it sits on — (1) a structured, enforced contract object, and (2) a real answer for "the responder isn't listening" — are exactly the two things deferred to convention and human escalation. The honest V1 is "MCP Agent Mail with a recommended negotiation README and a BMad hook." That may be a fine V1; it is not the "defensible negotiation layer" the document claims.
