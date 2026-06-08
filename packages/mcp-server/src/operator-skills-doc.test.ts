// Content-guard for the operator READ skills (Story 12.4, AC #4).
//
// Story 12.4 authors three NEW user-scope, operator-invoked, AGENT-EXECUTED slash-command skills
// (markdown `SKILL.md` assets) that drive the board READ-ONLY on demand (FR43), composing the
// already-shipped read tools (Rule 13 — no new tool/event/error code):
//   - `agentbbs-check`    — resolve identity → `login` → `check` → render the delta (first-run protocol).
//   - `agentbbs-projects` — resolve identity → `login` → `list_projects` (+ `list_members` for focus).
//   - `agentbbs-read`     — resolve identity → `login` → `list_announcements`/`list_rooms` (a project)
//                           or `read_room` (a room).
// Story 12.6 (capstone) inlines/installs these into the kit; THIS story authors the canonical sources
// (`integration/bmad/skills/<name>/SKILL.md`) plus this guard.
//
// Like the identity-bootstrap / agent-prompt-snippet / negotiation-protocol doc guards, this is a
// DOCUMENTATION content guard, NOT a code drift guard (that is `tool-contract.drift.test.ts`, which
// pins the live tool/error/event surface). There is no runtime "skill" object to compare against — a
// skill is a recipe over the already-shipped read tools. So this guard asserts each SKILL.md:
//   (1) has YAML frontmatter with `name` + `description` (the Claude Code skill contract);
//   (2) NAMES the read tools AC1/AC2 require it to call, pinned to the live §6 source of truth;
//   (3) is READ-ONLY (NFR5) — it names NO write tool in CALL FORM (`tool{ … }`); the read skills are
//       pull-only and introduce no push (a write tool may appear ONLY as a bare backticked token in
//       the explicit "never call a write tool" forbid-list, never as an invocation);
//   (4) names NO phantom tools (Rule 10/18) — every backticked tool-looking token, in either bare or
//       call form, is a real registered tool (from the contract's canonical §6 list, transitively
//       pinned to the live `McpServer` by `tool-contract.drift.test.ts`) or an allowlisted non-tool
//       token (a result field / param / arg name the skill legitimately backticks);
//   (5) resolves identity from the repo's `AGENTS.md` `AGENTBBS-IDENTITY` block and degrades
//       gracefully when none exists (AC3 — per-repo identity for a user-scope install on the global
//       board), reusing the recorded handle as-is (no third canonicalization — do not worsen the
//       deferred `10.3-operator-handle-dup`).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The skill sources live at the repo root under `integration/bmad/skills/<name>/SKILL.md`. This test
// file is at `packages/mcp-server/src/`, so three levels up from its directory is the repo root.
// Resolving relative to `import.meta.url` (not `process.cwd()`) keeps the test correct regardless of
// where the suite is launched from — same convention as the other `*-doc.test.ts` guards.
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const SKILLS_DIR = join(REPO_ROOT, 'integration', 'bmad', 'skills');

// The ratified tool contract carries the machine-readable canonical tool-name list in §6 — the SAME
// block `tool-contract.drift.test.ts` asserts equals the live `McpServer` registered set, so it is the
// authoritative answer to "is this a real tool?". A phantom token here (e.g. a renamed `chek`) would
// become a real instruction an agent tries to call when Story 12.6 installs the skill — a runtime
// failure. Resolved the same way as the contract/bootstrap reads.
const CONTRACT_DOC_PATH = join(REPO_ROOT, 'docs', 'mcp-tool-contract.md');

const TOOL_LIST_BEGIN = '# AGENTBBS-TOOL-CONTRACT:BEGIN';
const TOOL_LIST_END = '# AGENTBBS-TOOL-CONTRACT:END';

// The sentinel block name the bootstrap records the handle into (project `AGENTS.md`). Each read skill
// resolves the operator's handle from THIS block, so its name is the contract between the skills and
// the install/bootstrap — a rename must fail loudly.
const IDENTITY_BLOCK_NAME = 'AGENTBBS-IDENTITY';

// The three read skills this story authors, each with the read tools it MUST name (Rule 13 — existing
// tools only). `login` is the identity tool every skill calls first; the rest are the open reads each
// composes.
interface SkillSpec {
  readonly name: string;
  /** Tools the skill MUST name (so a future edit cannot silently drop the read it is built on). */
  readonly requiredTools: readonly string[];
}

const SKILLS: readonly SkillSpec[] = [
  { name: 'agentbbs-check', requiredTools: ['login', 'check'] },
  {
    name: 'agentbbs-projects',
    requiredTools: ['login', 'list_projects', 'list_members'],
  },
  {
    name: 'agentbbs-read',
    requiredTools: ['login', 'list_announcements', 'list_rooms', 'read_room'],
  },
];

// The closed set of WRITE tools (everything on the §6 surface that is NOT a read/login). NFR5: a read
// skill is pull-only — it must NEVER CALL any of these. They may appear ONLY as bare backticked tokens
// in the skill's explicit "never call a write tool" forbid-list — never in CALL form `tool{ … }`.
const WRITE_TOOLS = [
  'register',
  'update_focus',
  'announce_project',
  'join_board',
  'post_announcement',
  'reply',
  'add_participant',
  'react',
  'unreact',
] as const;

// Backticked non-tool tokens the skills legitimately reference: identity-block field, the read tools'
// params, and the result-envelope field names the skills render. Anything else backticked is treated as
// a tool claim (Rule 10). Keep this list minimal and explicit — growing it is a deliberate act (Rule
// 18: never weaken the scan to silence a real phantom).
const NON_TOOL_TOKENS = new Set([
  'agentbbs_handle', // the recorded-handle field in the AGENTBBS-IDENTITY block
  'project_id', // param of list_members/list_announcements/list_rooms; the project arg
  'room_id', // param of read_room; the room arg
  'current_focus', // a member-directory result field
  'last_seen', // a member-directory result field
  'announcements', // a check / list_announcements result field
  'messages', // a check / read_room result field
  'projects', // a list_projects result field
  'members', // a list_projects / list_members result field
  'protocol', // the additive first-check result field
  'room', // a read_room result field
  'description', // a list_projects result field
  'title', // a list_projects result field
  'subject', // a room/announcement field
  'posted_by', // a room/announcement field
  'reactions', // a read_room message field
  'actor', // a read_room message field
  'active', // a room field
  'seq', // the order key / a message field
  'kind', // a read_room message field
]);

function readSkill(name: string): string {
  const path = join(SKILLS_DIR, name, 'SKILL.md');
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the operator read skill at ${path}. Story 12.4 requires ` +
        `integration/bmad/skills/${name}/SKILL.md to exist (an operator-invoked, READ-ONLY ` +
        `slash-command skill composing the shipped read tools, FR43).`,
      { cause },
    );
  }
}

/**
 * Parse the canonical registered-tool names from the contract doc's sentinel-delimited §6 block (one
 * bare tool name per line) — the SAME block `tool-contract.drift.test.ts` asserts equals the live
 * `McpServer` set, so it is the authoritative "is this a real tool?" source. Fails loudly if the block
 * is missing/renamed rather than silently yielding an empty set (which would make the phantom guard
 * vacuous).
 */
function readCanonicalToolNames(): ReadonlySet<string> {
  const doc = readFileSync(CONTRACT_DOC_PATH, 'utf8');
  const begin = doc.indexOf(TOOL_LIST_BEGIN);
  const end = doc.indexOf(TOOL_LIST_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `Could not locate the canonical tool-name block (${TOOL_LIST_BEGIN} … ${TOOL_LIST_END}) in ` +
        `${CONTRACT_DOC_PATH}. The skills' phantom-tool guard parses this block as the source of ` +
        `truth for which tools exist.`,
    );
  }
  return new Set(
    doc
      .slice(begin + TOOL_LIST_BEGIN.length, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

/**
 * Extract the YAML frontmatter (between the leading `---` fences) from a SKILL.md. Claude Code skills
 * require frontmatter carrying `name` + `description`; returns the raw frontmatter text or null if the
 * file does not open with a frontmatter block.
 */
function readFrontmatter(skill: string): string | null {
  if (!skill.startsWith('---')) return null;
  const end = skill.indexOf('\n---', 3);
  if (end === -1) return null;
  return skill.slice(3, end);
}

describe('integration/bmad/skills operator read-skill content guard (Story 12.4)', () => {
  const realTools = readCanonicalToolNames();

  it('sanity: the contract §6 canonical tool list parses to a non-empty set', () => {
    // A bad parse (empty set) would make the phantom-tool guard vacuously pass — guard against it.
    expect(realTools.size).toBeGreaterThan(0);
  });

  it('sanity: every required read tool is a real registered tool (Rule 13 — no new tool)', () => {
    // The skills compose ONLY existing read tools. If any required tool is not in the live §6 set, the
    // story would be inventing a tool (Rule 13 violation) — fail loudly here.
    for (const { name, requiredTools } of SKILLS) {
      for (const tool of requiredTools) {
        expect(
          realTools.has(tool),
          `${name} requires the \`${tool}\` tool, which must be a real registered tool (§6) — ` +
            `Story 12.4 composes existing read tools only (Rule 13)`,
        ).toBe(true);
      }
    }
  });

  for (const { name, requiredTools } of SKILLS) {
    describe(name, () => {
      it('has YAML frontmatter with `name` and `description`', () => {
        const fm = readFrontmatter(readSkill(name));
        expect(
          fm,
          `${name}/SKILL.md must open with a YAML frontmatter block (--- … ---) — the Claude Code ` +
            `skill contract`,
        ).not.toBeNull();
        const frontmatter = fm as string;
        // `name:` must be present and equal the skill directory name (so the slash-command matches).
        expect(
          new RegExp(`(^|\\n)\\s*name:\\s*${name}\\b`).test(frontmatter),
          `${name}/SKILL.md frontmatter must declare \`name: ${name}\``,
        ).toBe(true);
        expect(
          /(^|\n)\s*description:\s*\S/.test(frontmatter),
          `${name}/SKILL.md frontmatter must declare a non-empty \`description\` (the trigger phrasing)`,
        ).toBe(true);
      });

      it('names every read tool it is built on (AC1/AC2)', () => {
        const skill = readSkill(name);
        for (const tool of requiredTools) {
          expect(
            skill.includes(tool),
            `${name}/SKILL.md must name the \`${tool}\` tool it composes — dropping it would leave ` +
              `the skill missing the read it is built on (AC1/AC2, Rule 13)`,
          ).toBe(true);
        }
      });

      it('resolves identity from the AGENTBBS-IDENTITY block and degrades gracefully (AC3)', () => {
        const skill = readSkill(name);
        // (5) Per-repo identity: the skill reads the recorded handle from this repo's AGENTS.md
        // AGENTBBS-IDENTITY block — what lets ONE user-scope install work in any repo on the global
        // board (AC3). Pin both the block name and the AGENTS.md file reference.
        expect(
          skill.includes(IDENTITY_BLOCK_NAME),
          `${name}/SKILL.md must resolve identity from the \`${IDENTITY_BLOCK_NAME}\` sentinel block ` +
            `(per-repo identity for a user-scope install — AC3)`,
        ).toBe(true);
        expect(
          skill.includes('AGENTS.md'),
          `${name}/SKILL.md must read the recorded handle from the repo's \`AGENTS.md\` (AC3)`,
        ).toBe(true);
        // It must reuse the recorded handle AS-IS (no third canonicalization — do not worsen the
        // deferred 10.3-operator-handle-dup). Accept the natural phrasings of "use it as written / do
        // not re-derive or invent".
        expect(
          /as written|as-is|verbatim|do not re-?derive|do not (re-?case|invent)/i.test(
            skill,
          ),
          `${name}/SKILL.md must reuse the recorded handle as written (no third canonicalization — ` +
            `do not worsen the deferred 10.3-operator-handle-dup)`,
        ).toBe(true);
        // It must degrade gracefully when no identity block exists (not crash / not invent a handle).
        expect(
          /degrade gracefully|not yet (been )?onboarded|not yet on the board|run the .*(install|bootstrap)/i.test(
            skill,
          ),
          `${name}/SKILL.md must degrade gracefully when there is no AGENTBBS-IDENTITY block (point ` +
            `the operator at the install/bootstrap; do not crash or invent a handle) — AC3`,
        ).toBe(true);
      });

      it('states it is READ-ONLY / pull-only (NFR5)', () => {
        const skill = readSkill(name).toLowerCase();
        expect(
          skill.includes('read-only'),
          `${name}/SKILL.md must state it is READ-ONLY (NFR5 — these skills are pull-only)`,
        ).toBe(true);
        expect(
          skill.includes('pull-only'),
          `${name}/SKILL.md must state it is pull-only and pushes nothing (NFR5)`,
        ).toBe(true);
      });

      it('calls NO write tool — read-only/pull-only (NFR5)', () => {
        // THE load-bearing NFR5 pin: a read skill must never CALL a write tool. A write tool may appear
        // ONLY as a bare backticked token in the explicit "never call a write tool" forbid-list — never
        // as an invocation. We detect an invocation as the tool name in CALL FORM: a backticked
        // `tool{ … }`. The bare forbid-list form `` `reply` `` (closing backtick, no `{`) is allowed;
        // `` `reply{ `` is not. This is exactly the call-form awareness Rule 18 requires — a write tool
        // smuggled in as a CALL must turn this red even though it would pass a bare-name scan.
        const skill = readSkill(name);
        const offenders = WRITE_TOOLS.filter((tool) =>
          new RegExp('`' + tool + '\\{').test(skill),
        );
        expect(
          offenders,
          `${name}/SKILL.md calls write tool(s) ${JSON.stringify(offenders)} in CALL form ` +
            `(\`tool{ … }\`). A read skill is pull-only (NFR5) — it may only CALL \`login\` and the ` +
            `read tools. Name a write tool only as a bare token in the "never call a write tool" ` +
            `forbid-list, never as an invocation.`,
        ).toEqual([]);
      });

      it('names no phantom tools — every backticked tool-looking token is a real tool or allowlisted (Rule 10/18)', () => {
        // (4) Scan backticked snake_case tokens in BOTH bare (`` `tok` ``) and call (`` `tok{ ``) form —
        // the Rule-18 call-form-aware pattern (the Story 8.1 blind spot was a bare-only scan missing a
        // phantom introduced only as `` `tok{ … }` ``). Each candidate must be a real §6 tool or an
        // allowlisted non-tool token; anything else is a phantom that would become a real (failing)
        // agent instruction once Story 12.6 installs the skill.
        const skill = readSkill(name);
        const candidates = [
          ...skill.matchAll(/`([a-z][a-z_]{2,})(?:`|\{)/g),
        ].map((m) => m[1]);
        const phantom = candidates.filter(
          (tok) => !realTools.has(tok) && !NON_TOOL_TOKENS.has(tok),
        );
        expect(
          phantom,
          `${name}/SKILL.md references tool-looking token(s) that are NOT registered tools and are ` +
            `not allowlisted non-tool tokens: ${JSON.stringify([...new Set(phantom)])}. A skill ` +
            `installed into an agent's command set must not instruct it to call a tool that does not ` +
            `exist (AC4, Rule 10). If a token is a real new tool it will be in docs/mcp-tool-contract.md ` +
            `§6; if it is a non-tool identifier, add it to NON_TOOL_TOKENS.`,
        ).toEqual([]);

        // Converse sanity: every required tool actually appears as a backticked candidate (so a reword
        // that strips ALL backticks — making the phantom scan vacuously pass on an empty set — is caught
        // here too). Required tools are presented in CALL form (`login{ … }`, `check{}`, …), which the
        // broadened candidate pattern captures (Rule 18).
        for (const tool of requiredTools) {
          expect(
            candidates.includes(tool),
            `${name}/SKILL.md must backtick the \`${tool}\` tool name (AC4) — its absence would also ` +
              `make the phantom-tool scan vacuous`,
          ).toBe(true);
        }
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// QA-stage strengthening (Story 12.4, qa-generate-e2e-tests).
//
// The dev's guard above is sound but thin on three load-bearing properties the QA focus calls out:
//
//   (A) NFR5 READ-ONLY is THE safety property of these skills — and the dev's write-tool scan only
//       matched the backtick-CALL form (`` `tool{ ``). Rule 18's lesson is that a forbid-scan must
//       match EVERY invocation form the asset could plausibly carry, not just one. A write call
//       smuggled in as a PAREN call (`` `react(room_id)` ``) or a BARE (non-backticked) `reply{ … }`
//       both slip the dev's scan GREEN (empirically confirmed during QA). For a pull-only skill the
//       correct, strongest pin is: no write tool appears in ANY call form anywhere in any skill.
//   (B) AC1 first-run protocol — the dev allowlists `protocol` as a non-tool token but never PINS that
//       /agentbbs-check actually surfaces it on the first-ever run (mapped to check's additive
//       `protocol` field, NOT a new mechanism). A reword dropping the first-run protocol behavior
//       would pass every dev case.
//   (C) AC3 LOGIN_UNKNOWN — the dev pins the missing-block degrade but not the recorded-but-
//       unregistered (`LOGIN_UNKNOWN`) degrade, which must point at the bootstrap and must NOT
//       register (registering would break read-only/NFR5).
//
// Each pin below is mutation-non-vacuous (Rule 7) — see the QA mutation log in the test summary.

// Tighter, call-form-AGNOSTIC write-tool detector (Rule 18). For a pull-only skill the only safe
// guarantee is that NO write tool is invoked in ANY form. We scan three plausible invocation forms,
// in or out of backticks:
//   - backtick + brace:   `` `reply{ ``        (the dev's original form)
//   - bare/backtick brace: `reply{` or `reply{`  (a fenced/bare object-arg call)
//   - paren call:          `react(` or `react(`  (a function-style call)
// A write tool is ALLOWED to appear ONLY as a bare token (`` `reply` `` — closing backtick, no `{`/`(`)
// inside the explicit "never call a write tool" forbid-list. Anything that looks like an INVOCATION is
// an offender. Read-tool call forms (`login{`, `check{`, …) are never write tools, so this scan cannot
// false-positive on the skills' legitimate reads.
function writeToolCallOffenders(skill: string): string[] {
  return WRITE_TOOLS.filter((tool) =>
    // tool name (optionally opened by a backtick) immediately followed by `{` or `(` = an invocation.
    new RegExp('`?' + tool + '\\s*[\\{(]').test(skill),
  );
}

describe('operator read-skill content guard — QA strengthening (Story 12.4)', () => {
  describe('NFR5 read-only — no write tool in ANY call form, across every skill (Rule 18)', () => {
    for (const { name } of SKILLS) {
      it(`${name} invokes no write tool in backtick / bare-brace / paren form`, () => {
        const skill = readSkill(name);
        const offenders = writeToolCallOffenders(skill);
        expect(
          offenders,
          `${name}/SKILL.md invokes write tool(s) ${JSON.stringify(offenders)} in some call form ` +
            `(\`tool{ … }\`, tool{ … }, or tool( … )). These skills are pull-only (NFR5): they may ` +
            `CALL only \`login\` and the read tools. A write tool may appear ONLY as a bare token in ` +
            `the "never call a write tool" forbid-list — never as an invocation in any form.`,
        ).toEqual([]);
      });
    }

    it('the forbid-list bare-token form (`reply`, `react`, …) is NOT mis-flagged as a call', () => {
      // Converse / non-vacuity guard: the skills DO legitimately name every write tool as a bare
      // backticked token in their forbid-list. Confirm the call-form scan stays GREEN on that — proving
      // it discriminates an invocation from a bare mention, not just "the word appears". (If this ever
      // goes red, the scan has become a bare-name scan and would forbid the forbid-list itself.)
      for (const { name } of SKILLS) {
        expect(writeToolCallOffenders(readSkill(name))).toEqual([]);
        // And every write tool really is present as a bare mention (the forbid-list exists).
        const skill = readSkill(name);
        for (const tool of WRITE_TOOLS) {
          expect(
            new RegExp('`' + tool + '`').test(skill),
            `${name}/SKILL.md should name \`${tool}\` as a bare token in its "never call a write ` +
              `tool" forbid-list (so the read-only contract is explicit to the executing agent)`,
          ).toBe(true);
        }
      }
    });
  });

  describe('agentbbs-check first-run protocol (AC1)', () => {
    it('surfaces the first-run `protocol` field on the first-ever check (existing behavior, not a new mechanism)', () => {
      const skill = readSkill('agentbbs-check');
      // Must reference check's additive `protocol` result field by name…
      expect(
        /`protocol`/.test(skill),
        `agentbbs-check/SKILL.md must name check's additive \`protocol\` result field (AC1) — the ` +
          `first-run protocol is surfaced via that existing field, not a new mechanism`,
      ).toBe(true);
      // …and tie it explicitly to the FIRST run / first-ever check (the Story 7.2 first-check floor).
      expect(
        /first[- ]ever|first run|first-ever check|on the first/i.test(skill),
        `agentbbs-check/SKILL.md must state the \`protocol\` is surfaced on the FIRST-ever check ` +
          `(AC1 — maps to the existing first-check protocol floor, not a new mechanism)`,
      ).toBe(true);
    });
  });

  describe('LOGIN_UNKNOWN graceful degrade — points at bootstrap, never registers (AC3, NFR5)', () => {
    for (const { name } of SKILLS) {
      it(`${name} handles LOGIN_UNKNOWN by pointing at install/bootstrap and does NOT register`, () => {
        const skill = readSkill(name);
        // The recorded-but-unregistered case: login returns LOGIN_UNKNOWN. A read-only skill must point
        // the operator at the install/bootstrap and MUST NOT register (registering is a write — NFR5).
        expect(
          skill.includes('LOGIN_UNKNOWN'),
          `${name}/SKILL.md must handle the \`LOGIN_UNKNOWN\` case (handle recorded but never ` +
            `registered) — AC3 graceful degrade`,
        ).toBe(true);
        // Scope the remaining assertions to the SENTENCE that handles LOGIN_UNKNOWN, so a no-register /
        // bootstrap mention from a DIFFERENT path (e.g. the missing-block "Do not register or guess")
        // cannot vacuously satisfy them. The LOGIN_UNKNOWN clause runs from its mention to the next
        // blank-line / heading boundary.
        const idx = skill.indexOf('LOGIN_UNKNOWN');
        // Window from the start of the LOGIN_UNKNOWN clause to the end of that paragraph.
        const tail = skill.slice(idx);
        const para = tail.slice(
          0,
          tail.search(/\n\s*\n|\n#/) + 1 || tail.length,
        );
        // Must point at the install/bootstrap on the LOGIN_UNKNOWN path itself…
        expect(
          /run the .*(install|bootstrap)/i.test(para),
          `${name}/SKILL.md must point the operator at the install/bootstrap IN the LOGIN_UNKNOWN ` +
            `clause itself (AC3) — clause was: ${JSON.stringify(para.trim())}`,
        ).toBe(true);
        // …and must explicitly NOT register ON THAT path (read-only — registering would be a write,
        // NFR5). Scoped to the LOGIN_UNKNOWN clause so a missing-block "do not register" cannot stand
        // in for it.
        expect(
          /do \*?\*?not\*?\*? register|never register|not register (it|here)/i.test(
            para,
          ),
          `${name}/SKILL.md must explicitly NOT register on the LOGIN_UNKNOWN path (read-only — ` +
            `registering is a write tool, NFR5) — clause was: ${JSON.stringify(para.trim())}`,
        ).toBe(true);
      });
    }
  });
});
