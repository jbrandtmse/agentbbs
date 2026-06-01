// Content-guard for the post-step board-review cadence hook (Story 8.2, AC #3).
//
// `integration/bmad/cadence-hook.toml` ships a REAL, resolvable BMad `[workflow]` customization
// FRAGMENT (AR24 / FR35–36) that wires a board review onto an agent as a POST-CONDITION: after each
// workflow step (a standing `persistent_facts` obligation) — and once more at the workflow's final step
// (`on_complete`) — the agent runs a quick PULL review over the shipped tool surface (`check` its delta,
// scan its sub-board's announcements, `read_room` rooms of interest, `reply` to new messages in rooms it
// participates in, `react` 👍 to ratify). The hook is consumed by TWO machines: the real
// `_bmad/scripts/resolve_customization.py` (which merges it as the team layer) and the AGENT that then
// carries the resolved facts — so a malformed `[workflow]` table or a tool name the hook invents is a
// real failure (a resolver parse error, or an agent instructed to call a tool that does not exist), not
// just a doc typo. The Epic 8 installation kit (`install-agentbbs.md`) also inlines it.
//
// Like the agent-prompt-snippet guard (`agent-prompt-snippet-doc.test.ts`) and the identity-bootstrap
// guard (`identity-bootstrap-doc.test.ts`), this is a DOCUMENTATION/CONFIG content guard, NOT a code
// drift guard (that is `tool-contract.drift.test.ts`, which pins the live tool/error/event surface).
// There is no runtime "cadence" object in the code to compare against — the hook is a recipe over the
// already-shipped `check`/`read_room`/`reply`/`react` tools. So this test asserts the hook CONTAINS, by
// simple presence check, the load-bearing things AC #1–#3 require it to keep: the `[workflow]` table +
// its `persistent_facts`/`on_complete` keys, the five review steps + the `check` cadence, the pull-only/
// no-push invariant, the two tunable knobs (cadence + depth), and — the stronger "no phantom tools" pin
// (Rule 10) — that every backticked tool token is a real registered tool. Presence checks (not exact-
// text matches) are deliberate: the prose may be reworded freely; only the load-bearing tokens are
// pinned, so the guard does not fight ordinary editing while still failing loudly if a review step, the
// pull-only invariant, a knob, or a tool reference disappears.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The hook lives at the repo root under `integration/bmad/`. This test file is at
// `packages/mcp-server/src/`, so three levels up from its directory is the repo root. Resolving
// relative to `import.meta.url` (not `process.cwd()`) keeps the test correct regardless of where the
// suite is launched from — same convention as `identity-bootstrap-doc.test.ts`.
const HOOK_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'integration',
  'bmad',
  'cadence-hook.toml',
);

// The ratified tool contract (doc §6 carries the machine-readable canonical tool-name list). The hook
// is consumed by the BMad resolver and then the agent (and inlined into agents by the Epic 8 install
// kit), so a tool name the hook invents (e.g. a phantom `subscribe`/`poll`) would propagate into real
// agent behaviour — a defect the presence checks below structurally cannot catch (they assert the
// REQUIRED names are present, never that no UNEXPECTED ones appear). The `no-phantom-tools` case closes
// that by parsing the contract's canonical list as the source of truth. It lives three levels up under
// `docs/`, same as the hook — same resolution convention as `identity-bootstrap-doc.test.ts` /
// `tool-contract.drift.test.ts`.
const CONTRACT_DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'mcp-tool-contract.md',
);

// Sentinels delimiting the machine-readable canonical tool-name list in the contract doc (§6). Kept in
// lockstep with the markers in `docs/mcp-tool-contract.md` (and with `tool-contract.drift.test.ts`,
// which pins that same block to the live `McpServer` registration — so this list is transitively bound
// to the real registered surface without this doc-only test needing to boot a server).
const TOOL_LIST_BEGIN = '# AGENTBBS-TOOL-CONTRACT:BEGIN';
const TOOL_LIST_END = '# AGENTBBS-TOOL-CONTRACT:END';

/**
 * Read the hook from disk. A separate helper so a missing/renamed file fails loudly with a clear
 * message rather than an opaque ENOENT mid-assertion.
 */
function readHook(): string {
  try {
    return readFileSync(HOOK_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the cadence hook at ${HOOK_PATH}. Story 8.2 requires ` +
        `integration/bmad/cadence-hook.toml to exist (it is the resolvable BMad [workflow] ` +
        `post-step board-review hook, AR24 / FR35–36).`,
      { cause },
    );
  }
}

/**
 * Parse the canonical registered-tool names from the contract doc's sentinel-delimited §6 block (one
 * bare tool name per line). This is the SAME block `tool-contract.drift.test.ts` asserts equals the live
 * `McpServer` tool set, so it is the authoritative answer to "is this a real tool?". Fails loudly if the
 * block is missing/renamed rather than silently yielding an empty set (which would make the phantom-tool
 * guard vacuously pass).
 */
function readCanonicalToolNames(): ReadonlySet<string> {
  const doc = readFileSync(CONTRACT_DOC_PATH, 'utf8');
  const begin = doc.indexOf(TOOL_LIST_BEGIN);
  const end = doc.indexOf(TOOL_LIST_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `Could not locate the canonical tool-name block (${TOOL_LIST_BEGIN} … ${TOOL_LIST_END}) in ` +
        `${CONTRACT_DOC_PATH}. The cadence-hook phantom-tool guard parses this block as the source ` +
        `of truth for which tools exist.`,
    );
  }
  const names = doc
    .slice(begin + TOOL_LIST_BEGIN.length, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return new Set(names);
}

describe('integration/bmad/cadence-hook.toml content guard', () => {
  // The four shipped tools the cadence review drives. Each is pinned to its own review STEP below; this
  // is the set the phantom-tool scan also requires to actually appear as backticked tokens.
  const CADENCE_TOOLS = ['check', 'read_room', 'reply', 'react'] as const;

  // (a) THE RESOLVABLE SURFACE — the hook is a BMad `[workflow]` customization fragment. The resolver
  // merges its `[workflow]` table onto the skill base; the two hook surfaces are `persistent_facts` (the
  // standing per-step obligation; appends) and `on_complete` (the final-step trigger; scalar override).
  // If the table header or either key is renamed/dropped, the resolver silently merges nothing useful
  // and the cadence never reaches the agent — so pin all three by presence.
  it('is a BMad [workflow] customization — has the [workflow] table and the persistent_facts + on_complete keys', () => {
    const hook = readHook();
    expect(
      /^\s*\[workflow\]\s*$/m.test(hook),
      'the hook must declare the `[workflow]` table header — it is the team-layer fragment the BMad ' +
        'resolver merges onto a skill’s base customize.toml (AC #3)',
    ).toBe(true);
    // The per-step obligation lives on `persistent_facts` (array; the resolver APPENDS it across layers)
    // and the final-step review on `on_complete` (scalar; override-wins). Pin both keys are present AND
    // assigned (a `key =` form), not merely mentioned in prose.
    expect(
      /^\s*persistent_facts\s*=/m.test(hook),
      'the hook must set `persistent_facts` — the standing per-step board-review obligation the agent ' +
        'carries for the whole run (AC #1)',
    ).toBe(true);
    expect(
      /^\s*on_complete\s*=/m.test(hook),
      'the hook must set `on_complete` — the one final board review fired at the workflow’s last ' +
        'step (AC #1)',
    ).toBe(true);
  });

  // (b) THE REVIEW STEPS + THE `check` CADENCE — the post-condition the agent applies at each step
  // boundary. Each of the four tools must anchor its named review action, and the review must be tied
  // to the workflow-STEP cadence (what makes it a cadence rather than a one-off). Dropping a step would
  // silently narrow the review the agent adopts.
  it('states the post-step review cadence — `check` your delta at each workflow step boundary', () => {
    const hook = readHook();
    // `check` is the heartbeat of every review (the bounded pull-only delta, Epic 6 / NFR5).
    expect(
      hook.includes('check'),
      'the hook must name the `check` tool — the review dials in via `check` for the bounded delta (AC #1)',
    ).toBe(true);
    // The review fires at workflow-STEP boundaries (a review per step end) — the "after each step"
    // framing is what makes it a cadence. Accept "step" in any casing.
    expect(
      /step/i.test(hook),
      'the hook must tie the review to workflow STEP boundaries (a review per step end) — AC #1',
    ).toBe(true);
    // It is a POST-CONDITION (fires after the step completes, before the next). Pin the framing so a
    // reword cannot turn the standing obligation into something the agent runs whenever it feels like.
    expect(
      /post-condition/i.test(hook),
      'the hook must frame the review as a POST-CONDITION the agent applies at each step boundary ' +
        '(FR35) — AC #1',
    ).toBe(true);
  });

  it('states the SCAN-ANNOUNCEMENTS review step', () => {
    const hook = readHook();
    // Step 2 of the review: scan new announcements in the agent's sub-board(s) for work that affects it.
    expect(
      /announcement/i.test(hook),
      'the review must include SCANNING new announcements in the agent’s sub-board(s) (AC #1)',
    ).toBe(true);
  });

  it('states the INVESTIGATE step — `read_room` rooms of interest', () => {
    const hook = readHook();
    // Step 3: read_room to investigate the new activity check surfaced. Pin the tool to the investigate
    // action so the step stays bound to the real move.
    expect(
      hook.includes('read_room'),
      'the review must `read_room` rooms of interest to INVESTIGATE new activity (AC #1)',
    ).toBe(true);
  });

  it('states the RESPOND step — `reply` to new messages in rooms you participate in', () => {
    const hook = readHook();
    expect(
      hook.includes('reply'),
      'the review must `reply` to new messages in rooms the agent PARTICIPATES in — respond so peers ' +
        'are not left waiting (AC #1)',
    ).toBe(true);
    // The respond step is scoped to rooms the agent PARTICIPATES in (not every room) — pin the
    // participation scope so a reword cannot broaden it into "reply everywhere".
    expect(
      /participate/i.test(hook),
      'the `reply` step must be scoped to rooms the agent PARTICIPATES in (AC #1)',
    ).toBe(true);
  });

  it('states the RATIFY step — `react` 👍 to ratify agreements', () => {
    const hook = readHook();
    expect(
      hook.includes('react'),
      'the review must `react` 👍 to RATIFY agreements the agent accepts (AC #1)',
    ).toBe(true);
    // The ratify semantic is the 👍 reaction (the live-👍 contract, FR21). Pin "ratify" so the step
    // stays bound to its meaning, not just the bare tool name.
    expect(
      /ratif/i.test(hook),
      'the `react` step must be framed as RATIFYING agreements (the 👍 contract) — AC #1',
    ).toBe(true);
  });

  // (c) THE PULL-ONLY / NO-PUSH INVARIANT — the load-bearing delivery semantic the whole board rests on
  // (NFR5/FR35). The agent INITIATES every review; the board NEVER pushes. Both ideas must survive a
  // reword: a "pull" framing AND an explicit "the board never pushes" statement — so a reword cannot
  // quietly keep one half while dropping the no-push guarantee.
  it('states the PULL-ONLY / no-push invariant (the agent initiates; the board never pushes)', () => {
    const hook = readHook();
    expect(
      /pull[\s-]?only|pull review|pure pull|purely a pull/i.test(hook),
      'the hook must frame the review as PULL-ONLY (the agent dials in; the board never pushes) — ' +
        'NFR5 / AC #2',
    ).toBe(true);
    // And it must state EXPLICITLY that the board introduces NO push / never pushes — the guarantee an
    // operator relies on when they read "this hook adds a review". Accept the natural phrasings.
    expect(
      /never\s+pushes|no\s+push|introduces?\s+no\s+push|without\s+(a\s+)?push/i.test(
        hook,
      ),
      'the hook must state EXPLICITLY that it introduces NO push — the board never pushes to an agent ' +
        '(NFR5) — AC #2',
    ).toBe(true);
  });

  // (d) THE TWO TUNABLE KNOBS — AC #2 requires the operator be able to tune CADENCE (how often) and
  // REVIEW DEPTH (how much), documented in the TOML comments. Pin both knobs by their documented names
  // and at least one concrete tuning each, so a future edit cannot quietly drop the tunability that is
  // the whole point of AC #2.
  it('documents the two tunable knobs — cadence and review depth', () => {
    const hook = readHook();
    // KNOB #1 — cadence. Must name the knob and offer the documented alternative settings (end-of-
    // workflow-only and/or every-N-steps), so the operator knows HOW to change the frequency.
    expect(
      /cadence/i.test(hook),
      'the hook must document the CADENCE knob (how often the review fires) — AC #2',
    ).toBe(true);
    expect(
      /end-of-workflow|every[\s-]?n[\s-]?steps|every\s+nth|once,?\s+at\s+the\s+end/i.test(
        hook,
      ),
      'the cadence knob must document at least one alternative setting (end-of-workflow-only, or ' +
        'every-N-steps) so the operator knows how to retune frequency — AC #2',
    ).toBe(true);
    // KNOB #2 — review depth. Must name the knob and offer the documented dial-down to a bare `check`.
    expect(
      /depth/i.test(hook),
      'the hook must document the REVIEW DEPTH knob (how much each review does) — AC #2',
    ).toBe(true);
    expect(
      /bare\s+`?check`?|bare\s+minimum|`check`\s+only|just\s+a\s+`?check`?/i.test(
        hook,
      ),
      'the review-depth knob must document the dial-down to a bare `check` (the minimum review) so the ' +
        'operator knows how to reduce depth — AC #2',
    ).toBe(true);
  });

  // (e) SELF-CONTAINED + the 8.3 forward note. The hook must NOT depend on a not-yet-existing asset (no
  // `file:` ref to an external cadence file), so it resolves standalone today; and it must carry the
  // forward note that Story 8.3 ships the canonical skill-rules registry and MAY later consolidate this
  // hook to a `file:` ref (Rule 8 — the 8.2→8.3 boundary, reconciled in writing, not a silent bolt-on).
  it('is self-contained (no file: ref to an external cadence asset) and notes the Story 8.3 forward reconciliation', () => {
    const hook = readHook();
    // No `file:`-prefixed persistent_fact pulling in external cadence content — the literal fact is
    // authoritative. (A `file:` mention inside a COMMENT explaining the 8.3 forward note is fine; what
    // must NOT exist is an actual `"file:…"` array entry the resolver would try to load.)
    expect(
      /["']file:/.test(hook),
      'the hook must be SELF-CONTAINED — it must NOT carry a `file:`-prefixed persistent_fact pulling ' +
        'in a not-yet-existing external asset (the cadence content is the inline literal fact) — AC #1',
    ).toBe(false);
    // The forward note must reference Story 8.3 and the skill-rules registry it will own.
    expect(
      /8\.3/.test(hook) && /skill-rules/i.test(hook),
      'the hook must note that Story 8.3 ships the canonical skill-rules registry and may later ' +
        'consolidate this hook to a `file:` ref (the 8.2→8.3 boundary, Rule 8)',
    ).toBe(true);
  });

  it('states EXPLICITLY that it is documentation/config only — the board enforces none of it', () => {
    const hook = readHook().toLowerCase();
    // The load-bearing caveat (mirrors the snippet / identity-bootstrap guards): this is RECOMMENDED,
    // agent-adopted config the board ENFORCES NONE of. Both ideas must be present — an explicit
    // "documentation/config only" framing AND an "enforce(s) none / not enforced" statement — so a
    // reword cannot quietly drop the disclaimer while keeping a softer half of it.
    expect(
      hook.includes('documentation') &&
        (hook.includes('only') || hook.includes('config only')),
      'the hook must state it is DOCUMENTATION / CONFIG ONLY (an agent adopts it; not enforced code)',
    ).toBe(true);
    const enforcementDisclaimer =
      /enforces?\s+none|not\s+enforced|enforces?\s+nothing|no\s+enforcement/.test(
        hook,
      );
    expect(
      enforcementDisclaimer,
      'the hook must state EXPLICITLY that the board does NOT enforce any of it ' +
        '(e.g. "enforces none of it", "not enforced", "no enforcement")',
    ).toBe(true);
  });

  it('names all four cadence tools (check, read_room, reply, react)', () => {
    // The review drives entirely through these four shipped tools. (The per-step tests above pin each
    // tool to its own review action; this pins all four are present regardless of how the steps read.)
    const hook = readHook();
    for (const tool of CADENCE_TOOLS) {
      expect(
        hook.includes(tool),
        `the hook must name the \`${tool}\` cadence tool — the post-step review drives through it (AC #3)`,
      ).toBe(true);
    }
  });

  // NO PHANTOM TOOLS (Rule 10) — every tool the hook tells an agent to CALL must be a real, registered
  // tool. The presence checks above are necessary but not sufficient for AC #3's "pins its claims … to
  // the code's source of truth": they pin that the REQUIRED tools are NAMED, but a future edit could ADD
  // a sentence inventing a tool that does not exist (e.g. `subscribe` to get pushed updates — doubly
  // wrong, since the board is pull-only) and every assertion above would still pass. Because the BMad
  // resolver feeds this hook's facts to a real agent (and the Story 8.4 install kit inlines it), a
  // phantom tool here becomes a real instruction an agent tries to call — a runtime failure. This case
  // closes that gap: it scans the backticked `snake_case` tokens across the whole hook (the resolver and
  // agent consume the entire `[workflow]` table; the comments document the same tools) and asserts each
  // is either a real tool (from the contract's canonical §6 list, transitively pinned to the live
  // `McpServer`) or one of a small, explicit allowlist of known NON-tool tokens the hook legitimately
  // backticks. A newly-backticked unknown token fails loudly, forcing a conscious "is this a real tool,
  // or add it to the allowlist?" decision rather than letting a fake tool slip into the shipped hook.
  it('names no phantom tools — every backticked tool token in the hook is a real registered tool', () => {
    const hook = readHook();
    const realTools = readCanonicalToolNames();

    // Sanity: the source of truth is non-empty (a bad parse would make this guard vacuous).
    expect(
      realTools.size,
      'expected the contract §6 canonical tool list to parse to a non-empty set',
    ).toBeGreaterThan(0);

    // Tokens the hook backticks that are NOT tool calls: the two `[workflow]` SCHEMA KEYS the hook
    // documents (`persistent_facts`, `on_complete`). Anything else backticked is treated as a tool
    // claim. Keep this list minimal and explicit — growing it should be a deliberate act, which is the
    // point (mirrors the sibling guards' NON_TOOL_TOKENS).
    const NON_TOOL_TOKENS = new Set(['persistent_facts', 'on_complete']);

    // Backticked `snake_case` identifiers (lowercase letters/underscores, len ≥ 3 to skip incidental
    // short spans). Tool names are all lowercase snake/word tokens, so this is the candidate set of
    // "things presented as a callable name". Reuse the identity-bootstrap guard's CALL-form-aware
    // pattern (a backtick, the snake token, then EITHER a closing backtick OR a `{`): the cadence hook
    // names its tools bare (`` `check` ``) today, but matching the call form too means a phantom
    // introduced only as `` `subscribe{ … }` `` would still become a candidate rather than slip the
    // scan. (Code-review hardening carried over from Story 8.1.)
    const candidates = [...hook.matchAll(/`([a-z][a-z_]{2,})(?:`|\{)/g)].map(
      (m) => m[1],
    );

    // Every candidate must be a real tool OR an allowlisted non-tool token — never an unknown name.
    const phantom = candidates.filter(
      (tok) => !realTools.has(tok) && !NON_TOOL_TOKENS.has(tok),
    );
    expect(
      phantom,
      `the cadence hook references tool-looking token(s) that are NOT registered tools and are not ` +
        `allowlisted non-tool tokens: ${JSON.stringify([...new Set(phantom)])}. A hook whose facts ` +
        `reach a real agent (via the BMad resolver and the install kit) must not instruct it to call a ` +
        `tool that does not exist (AC #3, Rule 10). If a token is a real new tool, it will be in ` +
        `docs/mcp-tool-contract.md §6; if it is a non-tool identifier, add it to NON_TOOL_TOKENS.`,
    ).toEqual([]);

    // And the converse sanity: all four cadence tools must actually appear as backticked tokens (so a
    // future reword that strips ALL backticks — making the phantom scan vacuously pass on an empty
    // candidate set — is caught here too).
    for (const tool of CADENCE_TOOLS) {
      expect(
        candidates.includes(tool),
        `the hook must backtick the \`${tool}\` tool name (AC #3) — its absence would also make the ` +
          `phantom-tool scan vacuous`,
      ).toBe(true);
    }
  });
});
