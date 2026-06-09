// Content-guard for the identity-bootstrap workflow (Story 8.1, AC #4).
//
// `integration/bmad/identity-bootstrap.md` ships a self-contained, AGENT-EXECUTED Markdown workflow
// (FR37–39) that resolves an agent's AgentBBS identity once per project and records it: look for a
// recorded handle in the project's `AGENTS.md` (in an `AGENTBBS-IDENTITY` sentinel block); a recorded
// handle → `login`; no recorded handle → derive `persona@project`, `register`, disambiguate a
// `HANDLE_TAKEN` collision, then record the plain handle. The Epic 8 installation kit
// (`install-agentbbs.md`) INLINES the workflow's sentinel-delimited block VERBATIM, so the text reaches
// a real agent — which makes a wrong tool name a runtime failure the agent hits, not just a doc typo.
//
// Like the agent-prompt-snippet guard (`agent-prompt-snippet-doc.test.ts`) and the Negotiation
// Protocol doc guard (`negotiation-protocol-doc.test.ts`), this is a DOCUMENTATION content guard, NOT
// a code drift guard (that is `tool-contract.drift.test.ts`, which pins the live tool/error/event
// surface). There is no runtime "bootstrap" object in the code to compare against — the bootstrap is a
// recipe over the already-shipped `register`/`login` tools. So this test asserts the workflow CONTAINS,
// by simple presence check, the load-bearing things AC #4 requires it to keep: the three identity
// cases (no-handle→register, recorded→login, taken→disambiguate), the plain-handle-no-secret /
// claim-based rule, the `AGENTBBS-IDENTITY` block name, and the inlinable-block markers — PLUS the
// stronger "no phantom tools" pin (Rule 10) that every tool-looking token in the inlined block is a
// real registered tool. Presence checks (not exact-text matches) are deliberate: the surrounding prose
// may be reworded freely; only the load-bearing tokens are pinned, so the guard does not fight ordinary
// editing while still failing loudly if an identity case or a tool reference disappears.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The workflow lives at the repo root under `integration/bmad/`. This test file is at
// `packages/mcp-server/src/`, so three levels up from its directory is the repo root. Resolving
// relative to `import.meta.url` (not `process.cwd()`) keeps the test correct regardless of where the
// suite is launched from — same convention as `agent-prompt-snippet-doc.test.ts`.
const BOOTSTRAP_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'integration',
  'bmad',
  'identity-bootstrap.md',
);

// The ratified tool contract (doc §6 carries the machine-readable canonical tool-name list). The
// inlinable block is INLINED VERBATIM into an agent's workflow/system prompt by the Epic 8 install
// kit, so a tool name the workflow invents (e.g. a phantom `signup`/`authenticate`) would propagate
// into real agent behaviour — a defect the presence checks below structurally cannot catch (they
// assert the REQUIRED names are present, never that no UNEXPECTED ones appear). The `no-phantom-tools`
// case closes that by parsing the contract's canonical list as the source of truth. It lives three
// levels up under `docs/`, same as the workflow — same resolution convention as
// `agent-prompt-snippet-doc.test.ts` / `tool-contract.drift.test.ts`.
const CONTRACT_DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'mcp-tool-contract.md',
);

// Core's SINGLE SOURCE OF TRUTH for the project/sub-board slug derivation (AR10):
// `packages/core/src/projects/slug.ts`. `announceProject` keys `project_id` on `slugify(title)`,
// so the bootstrap's Step-5 `project_id` derivation (AC2) MUST describe THIS rule — not a divergent
// one — or a second session could announce a distinct title that slugs to the same id with a
// mismatched handle scope (the exact AC2 hazard). We bind the asset's stated slug rule to this
// file's ACTUAL regex literals, read at test time (the content-guard reads files as text — no deep
// cross-package import, so zero typecheck/resolution risk; same `import.meta.url` convention as the
// bootstrap/contract reads above). Three levels up from this dir is the repo root.
const SLUG_SOURCE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'core',
  'src',
  'projects',
  'slug.ts',
);

// Sentinels delimiting the machine-readable canonical tool-name list in the contract doc (§6). Kept
// in lockstep with the markers in `docs/mcp-tool-contract.md` (and with `tool-contract.drift.test.ts`,
// which pins that same block to the live `McpServer` registration — so this list is transitively
// bound to the real registered surface without this doc-only test needing to boot a server).
const TOOL_LIST_BEGIN = '# AGENTBBS-TOOL-CONTRACT:BEGIN';
const TOOL_LIST_END = '# AGENTBBS-TOOL-CONTRACT:END';

// The sentinel markers delimiting the inlinable block in the workflow — the text the install kit
// inlines verbatim into an agent's workflow/system prompt. Mirrors the snippet's
// `AGENTBBS-PROMPT-SNIPPET:BEGIN/END` convention.
const BLOCK_BEGIN = 'AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN';
const BLOCK_END = 'AGENTBBS-IDENTITY-BOOTSTRAP:END';

// The sentinel block name the bootstrap records the handle into, inside the project's `AGENTS.md`. The
// Story 8.4 installation kit owns/updates ONLY this block (idempotent sentinel edit), so its name must
// not silently drift from the workflow that defines it.
const IDENTITY_BLOCK_NAME = 'AGENTBBS-IDENTITY';

/**
 * Read the workflow from disk. A separate helper so a missing/renamed file fails loudly with a clear
 * message rather than an opaque ENOENT mid-assertion.
 */
function readBootstrap(): string {
  try {
    return readFileSync(BOOTSTRAP_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the identity-bootstrap workflow at ${BOOTSTRAP_PATH}. ` +
        `Story 8.1 requires integration/bmad/identity-bootstrap.md to exist (it is the ` +
        `agent-executed identity-bootstrap workflow, FR37–39).`,
      { cause },
    );
  }
}

/**
 * Parse the canonical registered-tool names from the contract doc's sentinel-delimited §6 block
 * (one bare tool name per line). This is the SAME block `tool-contract.drift.test.ts` asserts equals
 * the live `McpServer` tool set, so it is the authoritative answer to "is this a real tool?". Fails
 * loudly if the block is missing/renamed rather than silently yielding an empty set (which would make
 * the phantom-tool guard vacuously pass).
 */
function readCanonicalToolNames(): ReadonlySet<string> {
  const doc = readFileSync(CONTRACT_DOC_PATH, 'utf8');
  const begin = doc.indexOf(TOOL_LIST_BEGIN);
  const end = doc.indexOf(TOOL_LIST_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `Could not locate the canonical tool-name block (${TOOL_LIST_BEGIN} … ${TOOL_LIST_END}) in ` +
        `${CONTRACT_DOC_PATH}. The workflow phantom-tool guard parses this block as the source of ` +
        `truth for which tools exist.`,
    );
  }
  const names = doc
    .slice(begin + TOOL_LIST_BEGIN.length, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return new Set(names);
}

/**
 * Extract the text BETWEEN the workflow's own `AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END` markers — the
 * block the install kit inlines verbatim into an agent's workflow/system prompt. Scoping the
 * phantom-tool scan to this block (not the whole file) keeps it focused on the text that actually
 * reaches an agent, and keeps the surrounding operator-facing prose free to reference future/other
 * identifiers without tripping the guard.
 */
function readInlinedBlock(bootstrap: string): string {
  const begin = bootstrap.indexOf(BLOCK_BEGIN);
  const end = bootstrap.indexOf(BLOCK_END);
  expect(
    begin !== -1 && end !== -1 && begin < end,
    'the workflow must keep its `AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END` markers delimiting the ' +
      'inlinable block the install kit inlines (AC #4)',
  ).toBe(true);
  return bootstrap.slice(begin, end);
}

/**
 * Read core's slug-derivation source (`packages/core/src/projects/slug.ts`) as TEXT — the AR10
 * source of truth `announceProject` derives `project_id` through. Read as text (not imported) so the
 * guard binds to the actual core file with no deep cross-package import (which would risk the gate's
 * typecheck leg, Rule 20). Fails loudly if the file is missing/renamed so the AC2 slug-rule pin can
 * never go vacuous on an empty read.
 */
function readSlugSource(): string {
  try {
    return readFileSync(SLUG_SOURCE_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read core's slug derivation at ${SLUG_SOURCE_PATH}. The Story 12.2 AC2 slug-rule ` +
        `guard binds the bootstrap's stated project_id derivation to THIS file (AR10 source of truth).`,
      { cause },
    );
  }
}

describe('integration/bmad/identity-bootstrap.md content guard', () => {
  // (b) IDENTITY TOOLS — the workflow drives identity entirely through the two shipped tools. Dropping
  // either move would leave the bootstrap ambiguous about how an agent claims vs re-establishes its
  // handle.
  const IDENTITY_TOOLS = ['register', 'login'] as const;

  it('keeps the inlinable-block sentinel markers (AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END)', () => {
    // (e) The install kit inlines the block between these markers VERBATIM. If a future edit renames
    // or drops them the kit silently inlines nothing (or the wrong span), so pin their presence and
    // ordering directly. readInlinedBlock also asserts this, but pin it as its own case so the failure
    // is unambiguous when the markers — not a downstream assertion — are what broke.
    const bootstrap = readBootstrap();
    const begin = bootstrap.indexOf(BLOCK_BEGIN);
    const end = bootstrap.indexOf(BLOCK_END);
    expect(
      begin !== -1 && end !== -1 && begin < end,
      `the workflow must keep its \`${BLOCK_BEGIN}\` / \`${BLOCK_END}\` markers, in order, ` +
        'delimiting the block the Story 8.4 install kit inlines verbatim (AC #4)',
    ).toBe(true);
  });

  it('names the AGENTBBS-IDENTITY sentinel block the handle is recorded into', () => {
    // (d) The bootstrap records the handle into a sentinel-bounded `AGENTBBS-IDENTITY` block in the
    // project's `AGENTS.md`; the Story 8.4 kit owns/updates ONLY that block (idempotent edit). The name
    // is the contract between this workflow and that kit, so a rename must fail loudly. Scope the check
    // to the INLINED block (the text the kit inlines and acts on), not the whole file — a file-wide
    // `includes` would survive a rename of the operative occurrence as long as ANY mention remained
    // (e.g. in the operator notes), making the pin non-discriminating. Asserting it INSIDE the inlined
    // block is what makes a rename of the kit-contract name turn this red.
    const block = readInlinedBlock(readBootstrap());
    // CAREFUL: a plain `block.includes('AGENTBBS-IDENTITY')` would be VACUOUS — `AGENTBBS-IDENTITY` is
    // a substring of the inlinable block's own `AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN/END` markers, so the
    // substring is present whenever the markers are, and the check could never fail. Pin the RECORDED-
    // HANDLE block name as a token that is NOT the `-BOOTSTRAP` marker, via a negative-lookahead: this
    // matches its `AGENTBBS-IDENTITY:BEGIN/END` marker form and the bare backticked `AGENTBBS-IDENTITY`
    // references, but is NOT satisfied by `AGENTBBS-IDENTITY-BOOTSTRAP`. Renaming the operative block
    // name therefore turns this red even though the BOOTSTRAP marker substring survives. (Mutation-
    // verified: renaming every bare `AGENTBBS-IDENTITY` → RED with this pin; GREEN with a plain
    // includes.)
    expect(
      /AGENTBBS-IDENTITY(?!-BOOTSTRAP)/.test(block),
      `the inlined block must name the \`${IDENTITY_BLOCK_NAME}\` recorded-handle sentinel block it ` +
        'records the handle into — as a distinct token, not merely the AGENTBBS-IDENTITY-BOOTSTRAP ' +
        'marker (the Story 8.4 kit owns/updates only that block) — AC #4',
    ).toBe(true);
    // And it must say the handle lands in the project's AGENTS.md (FR38) — the WHERE, not just the
    // block name. A reword that drops the file reference would leave the recording target ambiguous.
    expect(
      block.includes('AGENTS.md'),
      'the inlined block must record the handle into the project’s `AGENTS.md` (FR38) — AC #1/#4',
    ).toBe(true);
  });

  it('covers the NO-RECORDED-HANDLE case — derive a persona@project handle and `register` it (AC #1)', () => {
    const block = readInlinedBlock(readBootstrap());
    // The first identity case: nothing recorded → derive a default handle and register it.
    expect(
      block.includes('register'),
      'the workflow must tell an agent to `register` a derived handle when none is recorded (AC #1)',
    ).toBe(true);
    // The derived handle is persona/role + project scope, of the form `persona@project`. Pin the BASE
    // `persona@project` form via a negative-lookahead for a trailing `-` so the pin is NOT satisfied by
    // the disambiguation example `persona@project-2` alone: a derivation-step rewrite to a non-`@` form
    // (e.g. `persona-project`) that left only `persona@project-2` behind must still turn this red. It is
    // the FR39 shape the whole "one stable per-project handle" property rests on. (Mutation-verified:
    // rewriting the base-form derivation → RED with `(?!-)`; GREEN without it, since `persona@project-2`
    // contains `persona@project`.)
    expect(
      /persona@project(?!-)/i.test(block),
      'the workflow must derive the default handle in the base `persona@project` form (FR39), not ' +
        'only as the `persona@project-2` disambiguation example — AC #1',
    ).toBe(true);
  });

  it('covers the RECORDED-HANDLE case — `login` with it, do not register a second handle (AC #2)', () => {
    const block = readInlinedBlock(readBootstrap());
    // The second identity case: a handle is recorded → login with it (reuse the stable handle).
    expect(
      block.includes('login'),
      'the workflow must tell an agent to `login` with the recorded handle (reuse it, do not ' +
        'register a second one) when one is recorded (AC #2)',
    ).toBe(true);
  });

  it('covers the HANDLE_TAKEN case — disambiguate with a bounded discriminator and retry (AC #3)', () => {
    const block = readInlinedBlock(readBootstrap());
    // The third identity case: the derived handle is taken → disambiguate by appending a discriminator
    // and retry. Pin the `HANDLE_TAKEN` trigger (the exact closed error code register surfaces) so the
    // case stays bound to the real failure it handles.
    expect(
      block.includes('HANDLE_TAKEN'),
      'the workflow must handle the `HANDLE_TAKEN` collision (the closed error `register` surfaces ' +
        'when the handle is already claimed) — AC #3',
    ).toBe(true);
    // And it must DISAMBIGUATE (append a discriminator and retry). Accept the natural phrasings of
    // "append a discriminator / retry" — any one is enough; all absent means the collision-handling
    // step was lost.
    expect(
      /disambiguat|discriminator|retr(y|ies|ying)/i.test(block),
      'the workflow must disambiguate a `HANDLE_TAKEN` collision (append a short discriminator and ' +
        'retry, bounded) before recording the final handle — AC #3',
    ).toBe(true);
  });

  it('states the PLAIN-HANDLE-NO-SECRET / claim-based rule (NFR7) — the recorded handle is safe to commit (AC #3)', () => {
    const bootstrap = readBootstrap().toLowerCase();
    // (c) The load-bearing security claim: V1 auth is CLAIM-BASED — the handle is the credential, there
    // is no secret/token — so ONLY the plain handle is recorded, and it is SAFE TO COMMIT. All three
    // ideas must survive a reword: claim-based, no-secret, safe-to-commit. Dropping any one would let
    // the workflow imply a secret exists or that the handle must be hidden — the exact mischaracteriza-
    // tion this guard exists to catch.
    expect(
      bootstrap.includes('claim-based') || bootstrap.includes('claim based'),
      'the workflow must state V1 auth is CLAIM-BASED (the handle is the credential; NFR7) — AC #3',
    ).toBe(true);
    // No secret/token is recorded — accept "no secret", "no token", "without a secret", etc. The
    // workflow records ONLY the plain handle.
    expect(
      /no\s+secret|no\s+(password\s+or\s+)?token|without\s+a\s+secret|there\s+is\s+none/.test(
        bootstrap,
      ),
      'the workflow must state that NO secret/token is recorded — only the plain handle (NFR7) — AC #3',
    ).toBe(true);
    // The recorded handle is SAFE TO COMMIT (the direct consequence of claim-based auth). This is the
    // operator-facing reassurance the whole "record it in the repo" design depends on.
    expect(
      bootstrap.includes('safe to commit'),
      'the workflow must state the recorded handle is SAFE TO COMMIT (claim-based auth, no secret) — AC #3',
    ).toBe(true);
  });

  it('states EXPLICITLY that it is documentation only — the board enforces none of it', () => {
    const bootstrap = readBootstrap().toLowerCase();
    // The load-bearing caveat (mirrors the snippet / protocol-doc guards): this is RECOMMENDED,
    // agent-executed text the board ENFORCES NONE of. Both ideas must be present — an explicit
    // "documentation only" framing AND an "enforce(s) none / not enforced" style statement — so a
    // reword cannot quietly drop the disclaimer while keeping a softer half of it.
    expect(
      bootstrap.includes('documentation only') ||
        bootstrap.includes('documentation-only'),
      'the workflow must state it is DOCUMENTATION ONLY (an agent follows it; not enforced code)',
    ).toBe(true);
    const enforcementDisclaimer =
      /enforces?\s+none|not\s+enforced|enforces?\s+nothing|no\s+enforcement/.test(
        bootstrap,
      );
    expect(
      enforcementDisclaimer,
      'the workflow must state EXPLICITLY that the board does NOT enforce any of it ' +
        '(e.g. "enforces none of it", "not enforced", "no enforcement")',
    ).toBe(true);
  });

  // (f) ANNOUNCE-OR-JOIN sub-board step (Story 12.2, AC #1/#2/#3). After identity is established the
  // bootstrap publishes THIS project as a sub-board: `announce_project` it, or — on `PROJECT_EXISTS` —
  // `join_board` the one already announced (idempotent). The tools it composes are existing, shipped
  // ones (Rule 13 — no new op); these pins are the Rule-10 source-of-truth bind for the new step.
  const SUBBOARD_TOOLS = ['announce_project', 'join_board'] as const;

  it('covers the ANNOUNCE-OR-JOIN sub-board step — announce_project, on PROJECT_EXISTS → join_board (AC #1/#3)', () => {
    const block = readInlinedBlock(readBootstrap());
    // Both halves of the announce-or-join move must be named: the produce verb (announce the project →
    // create the sub-board) and the idempotent fallback (join the one that already exists).
    expect(
      block.includes('announce_project'),
      'the workflow must tell an agent to `announce_project` to publish its project as a sub-board ' +
        '(Story 12.2 / FR41 / AC #1)',
    ).toBe(true);
    expect(
      block.includes('join_board'),
      'the workflow must fall back to `join_board` when the sub-board already exists (AC #1/#3)',
    ).toBe(true);
    // The branch is keyed off the EXACT closed error code `announce_project` surfaces on a duplicate
    // title / same-derived-id. Pinning `PROJECT_EXISTS` keeps the idempotent second-session path bound
    // to the real signal it handles — dropping it would leave the announce-or-join ambiguous about WHEN
    // to join instead of announce (AC #3 — no dup, no error on a second session/agent).
    expect(
      block.includes('PROJECT_EXISTS'),
      'the workflow must branch on `PROJECT_EXISTS` (the closed error `announce_project` surfaces when ' +
        'the sub-board already exists) → `join_board` — the idempotent second-session path (AC #3)',
    ).toBe(true);
  });

  it('states the stable project_id derivation (git-remote slug else folder name) and handle `@<project>` consistency (AC #2)', () => {
    const block = readInlinedBlock(readBootstrap());
    // AC #2: project_id is derived STABLY — git-remote slug if present, else the repo folder name. Both
    // halves of the derivation must survive a reword (drop either and the "stable id" property is lost).
    expect(
      /git[- ]?remote|origin/i.test(block),
      'the workflow must derive `project_id` from the git-remote (origin) slug when present (AC #2)',
    ).toBe(true);
    expect(
      /folder name|directory name|repo(?:sitory)? (?:folder|directory) name/i.test(
        block,
      ),
      'the workflow must fall back to the repo folder name for `project_id` when there is no remote (AC #2)',
    ).toBe(true);
    // The load-bearing AR10 consistency: the derived `project_id` is the SAME `<project>` as the
    // `@<project>` in the handle. A reword that decouples them would let a second session announce a
    // distinct title that slugs to the same id with a mismatched handle scope — the exact AC #2 hazard.
    expect(
      /@<project>|@\{?project\}?|same `?<?project>?`?|@<project> in your handle|handle/i.test(
        block,
      ) && block.includes('project_id'),
      'the workflow must state the derived `project_id` equals the handle’s `@<project>` (AR10 / AC #2)',
    ).toBe(true);
  });

  it('states core’s ACTUAL slug rule (AR10) — not a divergent one — bound to packages/core/src/projects/slug.ts (AC #2)', () => {
    // QA strengthening (Story 12.2, this stage). The dev's derivation test pins that the asset
    // MENTIONS git-remote/origin, folder name, `@<project>`, and `project_id`. It does NOT pin that
    // the asset describes core's ACTUAL slug algorithm. That gap is the AC2 hazard the story Dev Notes
    // call out verbatim: "Get the slug rule from core … do not invent a divergent one, or a second
    // session could announce a distinct title that slugs to the same id … with a mismatched display
    // title." `announceProject` keys `project_id` on `slugify(title)` (slug.ts), so the bootstrap MUST
    // describe THAT rule. We bind to slug.ts's real regex literals, read at test time: a divergent
    // slug DESCRIPTION in the asset (e.g. only-spaces→`-`, no lowercasing, no strip) OR a future
    // change to core's slug rule the asset fails to follow turns this RED.
    const block = readInlinedBlock(readBootstrap());
    const slugSrc = readSlugSource();

    // First, confirm slug.ts still carries the three operations we're about to require the asset to
    // describe — so this guard cannot pass vacuously against a slug.ts whose algorithm moved out from
    // under it. (These are the exact transforms `slugify` applies: lowercase → collapse non-[a-z0-9]
    // runs to a single `-` → strip leading/trailing `-`.)
    expect(
      slugSrc.includes('.toLowerCase()'),
      'sanity: core slug.ts must lowercase the title (the rule the asset is pinned to describe)',
    ).toBe(true);
    expect(
      slugSrc.includes('/[^a-z0-9]+/g'),
      'sanity: core slug.ts must collapse every non-[a-z0-9] RUN to a single `-` (the rule the asset ' +
        'is pinned to describe)',
    ).toBe(true);
    expect(
      slugSrc.includes('/^-+|-+$/g'),
      'sanity: core slug.ts must strip leading/trailing `-` (the rule the asset is pinned to describe)',
    ).toBe(true);

    // (1) LOWERCASE — the first transform. A slug rule that omits lowercasing would let `Taskflow`
    // derive `Taskflow` (≠ the lowercase `project_id` the board stores), so the handle/board would
    // disagree. The asset must say it lowercases.
    expect(
      /lowercase/i.test(block),
      'the bootstrap must state the project_id is LOWERCASED (core slug.ts `.toLowerCase()`) — a ' +
        'rule that skips lowercasing diverges from AR10 and breaks the @<project> ↔ project_id ' +
        'consistency (AC #2).',
    ).toBe(true);

    // (2) COLLAPSE NON-[a-z0-9] RUNS TO `-` — the load-bearing transform. Pin BOTH that the asset
    // names the `[a-z0-9]` charset AND that it says NON-matching characters become `-` (a "run" /
    // "every"/"each" of them → a single `-`). A divergent description (e.g. "replace SPACES with `-`",
    // which would mis-slug `a.b` to `a.b` not `a-b`) omits the `[^a-z0-9]`/"non-" framing and turns
    // this RED. The asset writes the charset as `` `[a-z0-9]` `` (negated in prose as "non-`[a-z0-9]`").
    expect(
      /\[a-z0-9\]/.test(block),
      'the bootstrap must name the core slug charset `[a-z0-9]` (AR10) — AC #2.',
    ).toBe(true);
    expect(
      /non-?`?\[a-z0-9\]|every run of[^.\n]*\[a-z0-9\]|each[^.\n]*\[a-z0-9\]/i.test(
        block,
      ) &&
        /\bwith a single `?-`?|\bto a `?-`?|replace[^.\n]*`?-`?/i.test(block),
      'the bootstrap must state that every RUN of NON-`[a-z0-9]` characters collapses to a single ' +
        '`-` (core slug.ts `/[^a-z0-9]+/g` → `-`) — not a divergent "replace spaces" rule that would ' +
        'mis-derive an id for a title with punctuation (AC #2).',
    ).toBe(true);

    // (3) STRIP LEADING/TRAILING `-` — the final transform. The asset must say it strips a leading or
    // trailing `-` (core slug.ts `/^-+|-+$/g`). A rule that omits this would leave `" Taskflow "`
    // deriving `-taskflow-` (≠ the board's `taskflow`).
    expect(
      /strip[^.\n]*(leading|trailing)[^.\n]*`?-`?|(leading|trailing)[^.\n]*`?-`?/i.test(
        block,
      ),
      'the bootstrap must state it strips a LEADING/TRAILING `-` (core slug.ts `/^-+|-+$/g`) — ' +
        'omitting it diverges from AR10 and could derive an id with edge `-` the board would not (AC #2).',
    ).toBe(true);
  });

  it('the worked example is slug-consistent — title→project_id→@<project> all agree under core’s rule (AC #2)', () => {
    // QA strengthening: pin the asset's WORKED EXAMPLE as a concrete three-way consistency anchor.
    // The asset uses project_id `taskflow`, title `Taskflow`, and the handle `amelia-dev@taskflow`.
    // Apply core's ACTUAL slug algorithm (read from slug.ts at test time, so this stays bound to the
    // real rule — not a re-implementation that could drift) to the example title and assert it yields
    // BOTH the stated project_id AND the handle's `@<project>` scope. A future edit that changed the
    // example title to one that does NOT slug to `taskflow` (silently breaking the AC2 invariant the
    // example is meant to demonstrate) turns this RED.
    const bootstrap = readBootstrap();
    const slugSrc = readSlugSource();

    // Re-derive core's slug operations from slug.ts's own literals so the cross-check uses the REAL
    // rule. We assert the literals are present (the sanity above also does), then apply them — if core
    // ever changes the algorithm, this local mirror must be updated alongside, and the sanity pins in
    // the test above force that update to be conscious.
    expect(slugSrc).toContain('/[^a-z0-9]+/g');
    expect(slugSrc).toContain('/^-+|-+$/g');
    const coreSlug = (title: string): string =>
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    // The asset's worked-example title is `Taskflow` and its example handle is `amelia-dev@taskflow`.
    // These are present in the doc; assert their three-way consistency under core's rule.
    expect(
      bootstrap.includes('amelia-dev@taskflow'),
      'sanity: the asset must keep its worked-example handle `amelia-dev@taskflow` (the AC2 anchor).',
    ).toBe(true);
    const exampleTitle = 'Taskflow';
    const exampleProjectId = 'taskflow';
    expect(
      bootstrap.includes(exampleTitle) && bootstrap.includes(exampleProjectId),
      'sanity: the asset must keep its worked-example title `Taskflow` and id `taskflow` (AC2 anchor).',
    ).toBe(true);
    // THE three-way invariant: slug(title) === project_id === the handle's @<project> scope.
    expect(coreSlug(exampleTitle)).toBe(exampleProjectId);
    expect('amelia-dev@taskflow'.endsWith(`@${exampleProjectId}`)).toBe(true);
  });

  it('names both sub-board tools `announce_project` and `join_board` in the inlinable block', () => {
    // Companion to the register/login naming pin: both shipped sub-board tools the announce-or-join
    // step composes must be NAMED in the block the kit inlines (Rule 13 — existing tools, no new op).
    const block = readInlinedBlock(readBootstrap());
    for (const tool of SUBBOARD_TOOLS) {
      expect(
        block.includes(tool),
        `the inlinable block must name the \`${tool}\` tool — the announce-or-join sub-board step ${
          tool === 'announce_project'
            ? 'publishes the project as a sub-board'
            : 'joins the sub-board that already exists (PROJECT_EXISTS)'
        } with it (Story 12.2 / AC #4)`,
      ).toBe(true);
    }
  });

  it('names both identity tools `register` and `login` in the inlinable block', () => {
    // (b) Both shipped identity tools must be NAMED in the block the kit inlines — the bootstrap drives
    // identity entirely through them. (The per-case tests above pin each tool to its own case; this
    // pins both are present in the inlined text regardless of how the cases are worded.)
    const block = readInlinedBlock(readBootstrap());
    for (const tool of IDENTITY_TOOLS) {
      expect(
        block.includes(tool),
        `the inlinable block must name the \`${tool}\` identity tool — the bootstrap ${
          tool === 'register'
            ? 'claims a new handle'
            : 're-establishes an existing handle'
        } with it (AC #4)`,
      ).toBe(true);
    }
  });

  // NO PHANTOM TOOLS (Rule 10) — every tool the inlined block tells an agent to CALL must be a real,
  // registered tool. The presence checks above are necessary but not sufficient for AC #4's "pins its
  // claims … to the code's source of truth": they pin that the REQUIRED tools are NAMED, but a future
  // edit could ADD a sentence inventing a tool that does not exist (e.g. `signup` to claim a handle, or
  // `authenticate` to log in) and every assertion above would still pass. Because the Story 8.4 install
  // kit inlines this block VERBATIM into an agent's workflow/system prompt, a phantom tool here becomes
  // a real instruction an agent tries to call — a runtime failure. This case closes that gap: it scans
  // the backticked `snake_case` tokens in the inlined block and asserts each is either a real tool
  // (from the contract's canonical §6 list, transitively pinned to the live `McpServer`) or one of a
  // small, explicit allowlist of known NON-tool tokens the workflow legitimately backticks. A
  // newly-backticked unknown token fails loudly, forcing a conscious "is this a real tool, or add it to
  // the allowlist?" decision rather than letting a fake tool slip into the shipped workflow text.
  it('names no phantom tools — every backticked tool token in the inlined block is a real registered tool', () => {
    const block = readInlinedBlock(readBootstrap());
    const realTools = readCanonicalToolNames();

    // Sanity: the source of truth is non-empty (a bad parse would make this guard vacuous).
    expect(
      realTools.size,
      'expected the contract §6 canonical tool list to parse to a non-empty set',
    ).toBeGreaterThan(0);

    // Tokens the workflow backticks that are NOT tool calls: the `register`/`login` PARAMETER names
    // (`current_focus`, `handle`), plus the Story 12.2 announce-or-join step's non-tool identifiers —
    // `project_id` (the derived/param id and `join_board`'s param), `title`/`description`
    // (`announce_project`'s params), `origin` (the git-remote NAME the project_id is derived from), and
    // `taskflow` (the worked-example project_id/slug). Anything else backticked in the inlined block is
    // treated as a tool claim. Keep this list minimal and explicit — growing it should be a deliberate
    // act, which is the point (mirrors the agent-prompt-snippet guard's NON_TOOL_TOKENS).
    const NON_TOOL_TOKENS = new Set([
      'current_focus',
      'handle',
      'project_id',
      'title',
      'description',
      'origin',
      'taskflow',
    ]);

    // Backticked `snake_case` identifiers in the inlined block (lowercase letters/underscores, len ≥ 3
    // to skip incidental short spans). Tool names are all lowercase snake/word tokens, so this is the
    // candidate set of "things presented as a callable name". This goes one step BEYOND the snippet
    // guard's `` `token` ``-only pattern: this workflow presents its tool invocations primarily in the
    // CALL form `` `tool{ args }` `` (e.g. `register{ handle, current_focus }`, `login{ handle }`), so
    // the candidate must also capture the leading token of a backticked call-form — otherwise a phantom
    // introduced ONLY as `` `provision{ … }` `` (a form this asset uses heavily) would never become a
    // candidate and would slip the scan. Match a backtick, the snake token, then EITHER a closing
    // backtick (bare reference) OR a `{` (call form). (Code-review hardening — the snippet guard's
    // bare-only pattern has this blind spot; this asset's prominent call-form makes closing it matter.)
    const candidates = [...block.matchAll(/`([a-z][a-z_]{2,})(?:`|\{)/g)].map(
      (m) => m[1],
    );

    // Every candidate must be a real tool OR an allowlisted non-tool token — never an unknown name.
    const phantom = candidates.filter(
      (tok) => !realTools.has(tok) && !NON_TOOL_TOKENS.has(tok),
    );
    expect(
      phantom,
      `the inlined workflow block references tool-looking token(s) that are NOT registered tools and ` +
        `are not allowlisted non-tool tokens: ${JSON.stringify([...new Set(phantom)])}. A workflow ` +
        `inlined into an agent's system prompt must not instruct it to call a tool that does not ` +
        `exist (AC #4, Rule 10). If a token is a real new tool, it will be in docs/mcp-tool-contract.md ` +
        `§6; if it is a non-tool identifier, add it to NON_TOOL_TOKENS.`,
    ).toEqual([]);

    // And the converse sanity: both identity tools AND both sub-board tools must actually appear as
    // backticked tokens in the inlined block (so a future reword that strips ALL backticks — making the
    // phantom scan vacuously pass on an empty candidate set — is caught here too). The two sub-board
    // tools are presented in CALL form (`announce_project{ title, description }`, `join_board{ project_id }`),
    // which the broadened `` /`([a-z][a-z_]{2,})(?:`|\{)/g `` candidate pattern captures (Rule 18 — the
    // Story 8.1 call-form blind spot was that a `` `tool{ … }` ``-only reference must still be a candidate).
    for (const tool of [
      'register',
      'login',
      'announce_project',
      'join_board',
    ]) {
      expect(
        candidates.includes(tool),
        `the inlined block must backtick the \`${tool}\` tool name (AC #4) — its absence would also ` +
          `make the phantom-tool scan vacuous`,
      ).toBe(true);
    }
  });
});
