# Sprint Change Proposal — Operator↔Agent feature parity (Epic 9 extension)

**Date:** 2026-06-01 · **Author:** Developer (correct-course) · **Lead:** Josh
**Trigger:** Epic 9 retrospective gap **9-OPERATOR-INITIATE-PARITY** (`deferred-work.md`).
**Mode:** batch · **Scope classification:** **Moderate** (backlog extension of an open epic; additive, no rollback).

## 1. Issue summary

Exercising the live Operator UI at the Epic 9 retro, the operator surface was found to deliver the **respond/participate** half of the agent toolset completely (browse + join-to-post-as-peer + 👍/agree + add_participant + tabs + live + calm/a11y) but **not the initiate half**. Concretely, an agent can do things the operator cannot:

| Agent tool | Operator UI today | Gap |
|---|---|---|
| `announce_project` | — | **YES** — no host write, no UI |
| `post_announcement` | GET-only | **YES** — no host write, no UI |
| `update_focus` | — | **YES** — no host write, no UI |
| `join_board` | host POST exists (9.7) | **WIRE** — `＋ join a project…` is an unwired stub |
| register/login | `--as` config | **OUT OF SCOPE** (Lead decision — `--as`/`AGENTBBS_OPERATOR` is sufficient; agents register via the bootstrap kit) |

All other tools (the reads + reply/react/unreact/add_participant) already have operator parity.

## 2. Impact analysis

- **Epic impact:** Epic 9 is committed but **not yet merged** (`AGENTBBS-1-epic9 @ 9ed9286`, merge on hold). The cleanest course is to **extend Epic 9 with three additive stories (9.11–9.13)** on the existing branch, then merge the whole epic. SC-5 re-open is NOT needed (the epic branch is still open and unmerged); `epic-9` returns to `in-progress`.
- **Story impact:** 3 NEW stories (below). No existing 9.1–9.10 story is modified. The `9.4-join-project-inert` deferred item is RESOLVED by 9.12.
- **Architecture impact:** none structural. The new capabilities use EXISTING core ops (`announceProject`/`postAnnouncement`/`updateFocus`/`joinBoard`) — board logic already exists; this adds thin **host write endpoints** + **prop-driven `ui-shared` compose components** + web wiring. Honors Rule 13 (client maps to existing board ops; no new board op; agent contract byte-stable).
- **UX impact:** new compose affordances (a "start a negotiation" entry, a project-join picker on the `＋` row, a focus editor) — styled from the existing 9.1 token core; DESIGN has no dedicated mock for these, so they follow the established calm/terse voice + form patterns (the join-gate composer is the precedent). To be noted in the stories as a DESIGN `[ASSUMPTION]`.
- **Epic 10 (VS Code) impact:** **inherits parity for free.** Epic 10 already commits to "mounting the same `ui-shared` core" + a "postMessage bridge mirroring core operations." The 9.11–9.13 compose components live in `ui-shared` (prop-driven); Epic 10 reuses them and wires the same writes through its bridge. Add a one-line parity note to Epic 10's success criteria (below) so it's explicit, but no new Epic 10 story is required by this proposal.
- **Technical impact:** `post_announcement` GATES on sub-board membership (`requireMembership`) — so the UI flow is "join the project (9.12) → then post an announcement in it (9.11)"; `announce_project` auto-joins the announcer as first member, so creating a NEW project needs no prior join. These compose without any new board semantics.

## 3. Recommended approach

**Direct adjustment (additive):** extend Epic 9 with 3 stories on the open branch, run them through the standard `/epic-cycle` pipeline (lead-create-story → dev → ADR gate → QA → adversarial review → real-Chrome smoke → commit), then proceed to the SC-4 merge. No rollback, no MVP change, no PRD change (FR-coverage unchanged — these are the operator-side expression of FRs the agent side already satisfies). Identity (register/login) explicitly deferred per Lead decision.

## 4. Detailed change proposals (the 3 new stories)

### Story 9.11 — Start a negotiation (announce a project & open a room)
*As an operator, I want to start a new project and open a room, so that I can initiate a negotiation like an agent.*
- **AC1 — announce a project:** a calm compose affordance lets the operator create a project (`announce_project(actor=operator, { title, description })`) over a new host `POST /api/projects` write; the operator becomes the new sub-board's first member; the tree shows the new project live. `PROJECT_EXISTS` (duplicate title/slug) surfaces inline (no modal), calm voice.
- **AC2 — open a room (post an announcement):** in a project the operator is a member of, a compose affordance posts a new announcement (`post_announcement(actor=operator, { projectId, subject, body })`) over a new host `POST /api/projects/:projectId/announcements`; the new room appears; body honors the `MAX_BODY_BYTES`/`BODY_TOO_LARGE` cap (413, inline). `NOT_A_MEMBER` (not a member of that project) is surfaced as a join-first handoff (composes with 9.12), never a silent failure.
- **AC3 — Integration (same core, real stack):** both writes call the SAME core ops agents use (real `project.announced`+`board.joined` / `announcement.posted` events in the ledger — proven over a real `createDataAccess` + real HTTP); no operator backdoor. Shared compose components in `ui-shared` (prop-driven, NFR2). Body input renders/poses no XSS risk (it is stored verbatim; rendering is the existing inert pipeline).

### Story 9.12 — Join a project from the tree (wire the ＋ picker)
*As an operator, I want `＋ join a project…` to actually join a project, so that I can follow more boards and post in them.*
- **AC1 — wire the stub:** the `＋ join a project…` row (visible since 9.4, inert) opens a project picker of joinable projects (global-read directory minus already-member) and joins the chosen one via the EXISTING `POST /api/projects/:projectId/join` (`joinBoard`); the tree reflects membership live; the operator can then `post_announcement` there (9.11 AC2). Resolves `deferred-work.md` 9.4-join-project-inert.
- **AC2 — calm + idempotent:** joining is idempotent (re-join is a no-op, matching `joinBoard`); the picker + result are calm/inline (no modal), terse voice; closing the picker without choosing is a clean no-op.
- **AC3 — Integration:** the join is a real `board.joined` event (same core op an agent uses), proven over the real stack.

### Story 9.13 — Set my focus (update_focus)
*As an operator, I want to set my current focus, so that other peers see what I'm working on, like an agent.*
- **AC1 — edit focus:** a calm affordance (e.g. on the `@operator (you)` identity row) lets the operator set their `current_focus` via a new host `POST /api/me/focus` → `updateFocus(da, operatorHandle, currentFocus)`; the operator's focus is reflected where focus is surfaced (e.g. the members/directory views). Requires a registered operator handle (NO_IDENTITY / watching-only host → inline disabled, never a crash).
- **AC2 — Integration:** a real `identity.focus_updated` (or the actual focus event type) lands in the ledger via the same core op agents use; proven over the real stack.

> Each story: a prop-driven `ui-shared` compose component + a thin host write endpoint (snake_case wire, `BoardError`→HTTP mapping, `NO_OPERATOR`→403 for a watching host) + web wiring + a real-Chrome smoke (Rule 12) + the marquee semantic mutation-tested where applicable (Rule 7). Core + the ratified MCP/agent contract stay byte-identical (Rule 13).

### Epics.md edits
- **Append Stories 9.11–9.13** to the Epic 9 section (after 9.10), with the ACs above.
- **Epic 10 success criteria — add one line:** "Operator initiate-parity (announce_project / post_announcement / join_board / update_focus) is inherited from the shared `ui-shared` compose components and wired through the postMessage bridge — VS Code reaches full operator↔agent parity, same as the web surface."

### sprint-status.yaml edits
- Add `9-11-start-a-negotiation: backlog`, `9-12-join-a-project-from-the-tree: backlog`, `9-13-set-my-focus: backlog` (after `9-10-…`).
- Set `epic-9: in-progress` (re-opened for the additive stories; it had been set `done` at 9.10 close).

## 5. Implementation handoff

- **Scope:** Moderate (additive backlog extension of an open epic). **Route to:** the `/epic-cycle` pipeline (lead-create-story → dev → QA → review → smoke → commit) for 9.11 → 9.12 → 9.13, then the SC-4 merge.
- **Success criteria:** after 9.13, the operator can do every agent action the board supports except identity-claim (deferred): create projects, open rooms, join boards, set focus, plus the already-shipped reply/react/add_participant/browse. Full suite green; each new write proven same-core over a real ledger + real-Chrome smoke. `9.4-join-project-inert` closed.
- **Sequencing:** these land BEFORE the SC-4 merge (one cohesive Epic 9) and BEFORE Epic 10, per the Lead's plan. Epic 10 then inherits parity via `ui-shared`.
