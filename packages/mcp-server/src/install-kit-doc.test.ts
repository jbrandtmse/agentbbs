// Content-guard for the single self-contained installation kit
// (`integration/bmad/install-agentbbs.md`, Story 8.4, AC #1 / AC #2 / AC #3).
//
// `integration/bmad/install-agentbbs.md` is the operator ENTRYPOINT (AR27 / FR40): ONE
// self-contained, agent-executed Markdown kit an operator copies into a target BMad project
// and runs once. It is the FIRST and ONLY asset that INLINES all of the prior integration
// assets (Stories 7.3 / 8.1 / 8.2 / 8.3) so the operator ships a single file — no sibling
// files fetched. Because the kit's inlined copies are hand-maintained duplicates of the
// canonical sources, they can DRIFT the moment a source changes; and because the kit is the
// highest-stakes agent-CONSUMED asset (it WRITES files in a stranger's project), a phantom
// tool or a dropped safety statement becomes a real failure an agent hits. So this guard pins
// the kit to its canonical sources and to the live tool surface.
//
// Like the sibling doc-guards (`skill-rules-registry-doc.test.ts`, `cadence-hook-doc.test.ts`,
// `agent-prompt-snippet-doc.test.ts`, `identity-bootstrap-doc.test.ts`), this is a
// DOCUMENTATION/CONFIG content guard, NOT a code drift guard (that is
// `tool-contract.drift.test.ts`, which pins the live tool/error/event surface). There is no
// runtime "kit" object in the code to compare against — the kit is a recipe over the
// already-shipped tools. The COMPLEMENTARY real-runtime proof — that the kit's OWN file-surgery
// helper is idempotent / backup-safe / foreign-safe — is the executable safety-property test
// `packages/mcp-server/src/tools/install-kit-safety.integration.test.ts` (Rule 3 / Epic 7 retro
// Action A). Together they are "says-the-right-words" (here) vs. "the-words-actually-work"
// (there).
//
// This guard asserts, per the story's Task 3:
//   (a) DRIFT PINS — the kit INLINES each canonical artifact and the inlined text MATCHES the
//       source read AT TEST TIME (the skill-rules body, the agent-prompt-snippet sentinel
//       block, each of the four custom-templates TOMLs, the cadence-hook body, and the
//       identity-bootstrap sentinel block + the AGENTBBS-IDENTITY record block). So the kit
//       cannot silently drift from the assets it duplicates.
//   (b) SELF-CONTAINED — the kit carries the content INLINE; it issues NO network/sibling-file
//       FETCH for content (no `curl`/`wget`/`fetch(http…)` and no instruction to read a sibling
//       asset for its content). (Relative markdown LINK refs inside the inlined bodies — e.g.
//       `../../docs/...` — are content the kit copied verbatim, not fetch instructions, so they
//       are not forbidden.)
//   (c) NO PHANTOM TOOLS (Rule 10) — every backticked tool token the kit names is a REAL
//       registered tool, pinned to the SAME canonical §6 list the sibling guards use
//       (transitively bound to the live `McpServer` by `tool-contract.drift.test.ts`),
//       call-form-aware so a phantom introduced only as `tool{ … }` is still caught.
//   (d) SAFETY PROPERTIES + PREREQUISITE STATED — the kit STATES the three safety properties
//       (idempotent sentinel blocks, timestamped backup-before-overwrite, never-touch-foreign
//       incl. the `epic-cycle` kit) AND the AC #3 MCP-server prerequisite check (verify the
//       server first; if absent, REPORT and STOP — do not install the server).
//
// Where practical, the drift pins compare the canonical source's machine-relevant inner content
// (a sentinel block, or the source file's body) so ordinary rewording of the kit's surrounding
// prose does not fight the guard — only an actual drift from a pinned source, a phantom tool, or
// a dropped safety/prerequisite statement turns it RED.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The integration assets live at the repo root under `integration/bmad/`. This test file is at
// `packages/mcp-server/src/`, so three levels up from its directory is the repo root. Resolving
// relative to `import.meta.url` (not `process.cwd()`) keeps the test correct regardless of where
// the suite is launched from — same convention as `skill-rules-registry-doc.test.ts`.
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const BMAD_DIR = join(REPO_ROOT, 'integration', 'bmad');
const KIT_PATH = join(BMAD_DIR, 'install-agentbbs.md');
const REGISTRY_PATH = join(BMAD_DIR, 'skill-rules.md');
const CADENCE_HOOK_PATH = join(BMAD_DIR, 'cadence-hook.toml');
const SNIPPET_PATH = join(BMAD_DIR, 'agent-prompt-snippet.md');
const IDENTITY_BOOTSTRAP_PATH = join(BMAD_DIR, 'identity-bootstrap.md');
const TEMPLATES_DIR = join(BMAD_DIR, 'custom-templates');
const SKILLS_DIR = join(BMAD_DIR, 'skills');

// The four operator board skills the kit inlines + installs at USER scope (Story 12.4 read trio +
// 12.5 post). Each lives canonically at `integration/bmad/skills/<name>/SKILL.md`; the kit §3.10
// inlines each VERBATIM and installs it to `~/.claude/skills/<name>/SKILL.md` via `writeOwnedFile`.
const OPERATOR_SKILLS = [
  'agentbbs-check',
  'agentbbs-projects',
  'agentbbs-read',
  'agentbbs-post',
] as const;

// The four standard BMad dev-cycle skill overlay templates the kit inlines (mirror the live
// `_bmad/custom/` set + the Story 8.3 `custom-templates/`).
const TEMPLATE_SKILLS = [
  'bmad-dev-story',
  'bmad-create-story',
  'bmad-qa-generate-e2e-tests',
  'bmad-code-review',
] as const;

// The canonical registered-tool list lives in the contract doc's sentinel-delimited §6 block
// (one bare tool name per line). `tool-contract.drift.test.ts` asserts this SAME block equals the
// live `McpServer` tool set, so it is the authoritative answer to "is this a real tool?".
const CONTRACT_DOC_PATH = join(REPO_ROOT, 'docs', 'mcp-tool-contract.md');
const TOOL_LIST_BEGIN = '# AGENTBBS-TOOL-CONTRACT:BEGIN';
const TOOL_LIST_END = '# AGENTBBS-TOOL-CONTRACT:END';

/** Read the kit from disk. A separate helper so a missing/renamed file fails loudly. */
function readKit(): string {
  try {
    return readFileSync(KIT_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the installation kit at ${KIT_PATH}. Story 8.4 requires ` +
        `integration/bmad/install-agentbbs.md to exist (the single self-contained kit, AR27 / ` +
        `FR40).`,
      { cause },
    );
  }
}

/** Read a canonical source asset from disk, failing loudly if missing/renamed. */
function readSource(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the canonical source ${label} at ${path}. The install kit inlines it; the ` +
        `drift pin needs the source to compare against.`,
      { cause },
    );
  }
}

/**
 * Extract the inclusive text between a BEGIN/END sentinel pair (markers included), or throw if the
 * pair is absent — so a renamed/removed sentinel fails loudly rather than yielding undefined.
 */
function sentinelBlock(
  text: string,
  begin: string,
  end: string,
  where: string,
): string {
  const b = text.indexOf(begin);
  const e = text.indexOf(end);
  if (b === -1 || e === -1 || e < b) {
    throw new Error(
      `Could not locate the sentinel block ${begin} … ${end} in ${where}. It is the ` +
        `machine-relevant block the kit inlines / pins.`,
    );
  }
  return text.slice(b, e + end.length);
}

/**
 * Parse the canonical registered-tool names from the contract doc's sentinel-delimited §6 block
 * (one bare tool name per line). SAME source of truth the sibling guards use. Fails loudly if the
 * block is missing rather than vacuously yielding an empty set.
 */
function readCanonicalToolNames(): ReadonlySet<string> {
  const doc = readFileSync(CONTRACT_DOC_PATH, 'utf8');
  const begin = doc.indexOf(TOOL_LIST_BEGIN);
  const end = doc.indexOf(TOOL_LIST_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `Could not locate the canonical tool-name block (${TOOL_LIST_BEGIN} … ${TOOL_LIST_END}) in ` +
        `${CONTRACT_DOC_PATH}. The kit phantom-tool guard parses this block as the source of truth.`,
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
 * Backticked `snake_case` identifiers a piece of text presents as a callable name. SAME call-form
 * aware pattern the sibling guards use (a backtick, the snake token ≥ 3 chars, then EITHER a
 * closing backtick OR a `{`): the kit names tools bare (`` `check` ``) and in call form
 * (`` `login{ handle } ``), so matching both means a phantom introduced either way is caught.
 */
function backtickedTokens(text: string): string[] {
  return [...text.matchAll(/`([a-z][a-z_]{2,})(?:`|\{)/g)].map((m) => m[1]);
}

describe('integration/bmad/install-agentbbs.md kit content guard', () => {
  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (a) DRIFT PINS — the kit inlines each canonical artifact, MATCHING the source read at test
  // time. Each pin compares the source's machine-relevant content (a sentinel block, or the
  // source body) so the kit cannot silently drift from the asset it duplicates.
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it('inlines the agent-prompt-snippet sentinel block VERBATIM (drift pin → agent-prompt-snippet.md)', () => {
    const kit = readKit();
    const snippetSource = readSource(SNIPPET_PATH, 'agent-prompt-snippet.md');
    const snippetBlock = sentinelBlock(
      snippetSource,
      '<!-- AGENTBBS-PROMPT-SNIPPET:BEGIN -->',
      '<!-- AGENTBBS-PROMPT-SNIPPET:END -->',
      'agent-prompt-snippet.md',
    );
    expect(
      kit.includes(snippetBlock),
      'the kit must inline the agent-prompt-snippet sentinel block VERBATIM (Story 7.3). If the ' +
        'snippet changed, re-copy it into install-agentbbs.md so the kit does not drift (AC #1).',
    ).toBe(true);
  });

  it('inlines the identity-bootstrap sentinel block VERBATIM (drift pin → identity-bootstrap.md)', () => {
    const kit = readKit();
    const bootstrapSource = readSource(
      IDENTITY_BOOTSTRAP_PATH,
      'identity-bootstrap.md',
    );
    const bootstrapBlock = sentinelBlock(
      bootstrapSource,
      '<!-- AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN -->',
      '<!-- AGENTBBS-IDENTITY-BOOTSTRAP:END -->',
      'identity-bootstrap.md',
    );
    expect(
      kit.includes(bootstrapBlock),
      'the kit must inline the identity-bootstrap sentinel block VERBATIM (Story 8.1) and RUN it ' +
        'so the project ends with a stored handle. If the bootstrap changed, re-copy it (AC #1).',
    ).toBe(true);
  });

  it('inlines the AGENTBBS-IDENTITY record block the kit writes into AGENTS.md', () => {
    const kit = readKit();
    // The kit owns the `AGENTBBS-IDENTITY` block in the consuming project's AGENTS.md. It must
    // show both sentinels so the agent knows the exact markers to pass to applyBlock.
    expect(
      kit.includes('<!-- AGENTBBS-IDENTITY:BEGIN -->') &&
        kit.includes('<!-- AGENTBBS-IDENTITY:END -->'),
      'the kit must show the AGENTBBS-IDENTITY sentinel markers — the block it records the handle ' +
        'into (AC #1).',
    ).toBe(true);
    // And the recorded line is the plain handle only (claim-based auth, no secret).
    expect(
      /agentbbs_handle:/.test(kit),
      'the kit must record the plain `agentbbs_handle:` line in the AGENTBBS-IDENTITY block — only ' +
        'the handle, no secret (AC #1).',
    ).toBe(true);
  });

  it('inlines the skill-rules registry BODY (drift pin → skill-rules.md)', () => {
    const kit = readKit();
    const registry = readSource(REGISTRY_PATH, 'skill-rules.md');
    // The registry has no internal sentinel; the kit inlines the whole file body inside a fenced
    // block. Pin a substantial, load-bearing slice of the source (the two Rule headers through the
    // four protocol moves) so a drift in the registry's machine-relevant content turns this RED.
    // Using the source's own text (read at test time) means a reworded registry must be re-copied.
    const ruleA = registry.indexOf(
      '## Rule A — The post-step board-review obligation',
    );
    const ruleBEnd = registry.indexOf('## How this registry relates');
    expect(
      ruleA !== -1 && ruleBEnd !== -1 && ruleBEnd > ruleA,
      'expected to locate Rule A … "How this registry relates" in the canonical skill-rules.md ' +
        '(the slice the drift pin compares).',
    ).toBe(true);
    const registrySlice = registry.slice(ruleA, ruleBEnd).trimEnd();
    expect(
      kit.includes(registrySlice),
      'the kit must inline the skill-rules registry body VERBATIM (Story 8.3). If the registry ' +
        'changed, re-copy it into install-agentbbs.md so the kit does not drift (AC #1).',
    ).toBe(true);
  });

  it('inlines the cadence-hook BODY (drift pin → cadence-hook.toml)', () => {
    const kit = readKit();
    const hook = readSource(CADENCE_HOOK_PATH, 'cadence-hook.toml');
    // Pin the hook's machine-relevant core: the `[workflow]` table with the per-step
    // `persistent_facts` literal fact through the `on_complete` scalar. Comparing the source's own
    // text (read at test time) means a reworded hook must be re-copied into the kit.
    const wf = hook.indexOf('[workflow]');
    expect(
      wf !== -1,
      'expected `[workflow]` in the canonical cadence-hook.toml',
    ).toBe(true);
    const hookCore = hook.slice(wf).trimEnd();
    expect(
      kit.includes(hookCore),
      'the kit must inline the cadence-hook `[workflow]` body VERBATIM (Story 8.2). If the hook ' +
        'changed, re-copy it into install-agentbbs.md so the kit does not drift (AC #1).',
    ).toBe(true);
  });

  it.each(TEMPLATE_SKILLS)(
    'inlines the %s.toml overlay template VERBATIM (drift pin → custom-templates/%s.toml)',
    (skill) => {
      const kit = readKit();
      const template = readSource(
        join(TEMPLATES_DIR, `${skill}.toml`),
        `custom-templates/${skill}.toml`,
      );
      // Pin the template's `[workflow]` body (the resolvable fragment) — the part the resolver
      // merges and the part that must not drift. Comparing the source text read at test time means
      // a changed template must be re-copied into the kit.
      const wf = template.indexOf('[workflow]');
      expect(
        wf !== -1,
        `expected \`[workflow]\` in the canonical custom-templates/${skill}.toml`,
      ).toBe(true);
      const body = template.slice(wf).trimEnd();
      expect(
        kit.includes(body),
        `the kit must inline custom-templates/${skill}.toml's [workflow] body VERBATIM (Story ` +
          `8.3). If the template changed, re-copy it into install-agentbbs.md (AC #1).`,
      ).toBe(true);
    },
  );

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (a2) OPERATOR-SKILL DRIFT PINS (Story 12.6 §3.10, Rule 10) — the kit INLINES each of the four
  // canonical operator-skill bodies VERBATIM and installs them to USER scope `~/.claude/skills/`.
  // A skill is a STANDALONE whole file (its YAML frontmatter is line 1, so it CANNOT be
  // sentinel-wrapped); the drift pin therefore compares the canonical SKILL.md's whole body. A
  // drift between an inlined skill and its canonical source must turn RED; re-copying it byte-
  // identical turns it GREEN (mutation-tested at the QA stage).
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it.each(OPERATOR_SKILLS)(
    'inlines the %s operator-skill body VERBATIM (drift pin → skills/%s/SKILL.md)',
    (skill) => {
      const kit = readKit();
      const skillBody = readSource(
        join(SKILLS_DIR, skill, 'SKILL.md'),
        `skills/${skill}/SKILL.md`,
      );
      // The canonical SKILL.md is a whole file with no internal sentinel. The kit inlines the whole
      // body inside a fenced ```markdown block, so its full content must appear verbatim. We compare
      // the trimmed body (the kit's fence boundary adds no inner bytes) so a trailing-newline
      // difference at the fence does not false-positive while any real drift does.
      expect(
        kit.includes(skillBody.trimEnd()),
        `the kit must inline the canonical skills/${skill}/SKILL.md body VERBATIM (Story 12.6 §3.10, ` +
          `Rule 10). If the canonical skill changed, re-copy it into install-agentbbs.md §3.10 so the ` +
          `kit does not drift (AC1/AC3).`,
      ).toBe(true);
    },
  );

  it('installs the four operator skills at USER scope via writeOwnedFile → ~/.claude/skills/<name>/SKILL.md (Story 12.6 §3.10)', () => {
    const kit = readKit();
    // §3.10 must exist as the operator-skills install section.
    expect(
      /###?\s*3\.10\b/.test(kit) && /operator board skills/i.test(kit),
      'the kit must carry a §3.10 operator-skills install section (Story 12.6 AC1).',
    ).toBe(true);

    // It must use writeOwnedFile (NOT applyBlock — a whole-owned file cannot be sentinel-wrapped).
    expect(
      /\bwriteOwnedFile\b/.test(kit),
      'the kit must install the operator skills with `writeOwnedFile` (§1) — a whole owned file, not ' +
        'an applyBlock sentinel block (Story 12.6 §3.10 / Task 2).',
    ).toBe(true);

    // It must install at USER scope under ~/.claude/skills/.
    expect(
      /user scope/i.test(kit) && /\.claude\/skills\//.test(kit),
      'the kit must install the operator skills at USER scope under `~/.claude/skills/` (one install ' +
        'serves every repo against the one global board) — Story 12.6 §3.10.',
    ).toBe(true);

    // Each skill's user-scope SKILL.md target path must be named.
    for (const skill of OPERATOR_SKILLS) {
      expect(
        kit.includes(`.claude/skills/${skill}/SKILL.md`) ||
          kit.includes(`${skill}', 'SKILL.md'`),
        `the kit must name the user-scope install target for ${skill} ` +
          `(~/.claude/skills/${skill}/SKILL.md) — Story 12.6 §3.10.`,
      ).toBe(true);
    }
  });

  it('writeOwnedFile is part of the kit helper block (Story 12.6 Task 2)', () => {
    const kit = readKit();
    // The whole-owned-file helper must be EXPORTED from the §1 helper block (the same block the
    // safety test extracts), alongside applyBlock + mergeMcpServer — so an agent can call it and the
    // Rule-11 safety test can extract + execute it.
    expect(
      /export function writeOwnedFile\b/.test(kit),
      'the kit §1 helper block must export `writeOwnedFile` (the whole-owned-file write path the ' +
        'operator skills use) — Story 12.6 Task 2.',
    ).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (a3) QA STRENGTHENING — ENCODING INTEGRITY (Rule 21). The drift pins above are STRUCTURALLY
  // blind to multibyte-glyph corruption: a `kit.includes(skillBody)` byte-compare proves the kit's
  // copy MATCHES the canonical source, but if the canonical source ITSELF were mojibake-corrupted
  // (or the kit picked up a BOM/CRLF during a rewrite), the pin stays GREEN while the human-facing
  // prose is garbage. Rule 21: a prose rewrite of a file with non-ASCII glyphs (these inlined skill
  // bodies + the kit carry 👍 / em-dash `—` / arrow `→`) must be encoding-verified OUT-OF-BAND.
  // This guard is that out-of-band check, automated: no BOM, no CRLF, no mojibake lead-byte
  // sequences in the kit OR any canonical operator-skill source — and the intended glyphs survive.
  // Distinct concern from the token drift pins (Rule 10): orthogonal, both required for an
  // OSS-facing agent-consumed asset.
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it('the kit + the four canonical operator-skill sources are encoding-clean — no BOM / CRLF / mojibake (Rule 21)', () => {
    // Read RAW BYTES (not decoded) so a BOM or a mojibake double-encode is visible. `readFileSync`
    // without an encoding returns a Buffer.
    const targets: ReadonlyArray<readonly [string, string]> = [
      [KIT_PATH, 'install-agentbbs.md'],
      ...OPERATOR_SKILLS.map(
        (s) =>
          [join(SKILLS_DIR, s, 'SKILL.md'), `skills/${s}/SKILL.md`] as const,
      ),
    ];

    // The deterministic mojibake LEAD-BYTE sequences a UTF-8→Latin-1→UTF-8 double-encode produces
    // for the glyphs these files actually carry: em-dash `—` → `â€"` (0xC3 0xA2 0xE2…),
    // arrow `→` → `â†'`, 👍 → `ðŸ‘` (0xC3 0xB0 0xC5 0xB8…). Matching the two lead bytes `â`(0xC3 0xA2)
    // and `ð`(0xC3 0xB0) catches the whole class without false-positiving on legitimate UTF-8 (a real
    // `—` is bytes 0xE2 0x80 0x94, which never contains 0xC3 0xA2). See Epic 11 Story 11.5 / Rule 21.
    const MOJIBAKE_LEADS = [
      Buffer.from([0xc3, 0xa2]), // â — the em-dash / arrow / smart-quote mojibake lead
      Buffer.from([0xc3, 0xb0]), // ð — the emoji (👍) mojibake lead
    ];
    const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

    for (const [path, label] of targets) {
      const raw = readFileSync(path); // Buffer (raw bytes)

      expect(
        raw.subarray(0, 3).equals(BOM),
        `${label} must NOT begin with a UTF-8 BOM (Rule 21) — a spurious BOM corrupts an OSS-facing ` +
          `agent-consumed asset and is invisible to the token drift pins.`,
      ).toBe(false);

      expect(
        raw.includes(Buffer.from('\r\n')),
        `${label} must use LF line endings, not CRLF (Rule 21 / the kit's documented-LF assumption). ` +
          `A CRLF round-trip is exactly the lossy path that introduces mojibake.`,
      ).toBe(false);

      for (const lead of MOJIBAKE_LEADS) {
        expect(
          raw.includes(lead),
          `${label} must contain NO mojibake lead-byte sequence ${JSON.stringify([...lead])} ` +
            `(Rule 21) — the inlined skill bodies + kit carry 👍 / em-dash / arrows, and a rewrite ` +
            `through an encoding-lossy path double-encodes them into garbage the token drift pins ` +
            `cannot see. If this fails, reverse the encoding per-character + strip the BOM + ` +
            `normalize to LF, then reconfirm the machine tokens are byte-intact.`,
        ).toBe(false);
      }
    }
  });

  it('the intended non-ASCII glyphs SURVIVE in the kit (converse non-vacuity for the Rule-21 guard)', () => {
    // The absence-of-mojibake guard above would pass vacuously on a file that had been stripped of
    // ALL non-ASCII content. Pin that the intended glyphs are actually PRESENT (decoded), so the
    // encoding guard means "the glyphs are here AND correct", not "the glyphs are gone". The kit
    // carries 👍 (the FR21 agreed-mark), em-dash `—`, and arrow `→` (counts from the dev's Rule-21
    // out-of-band verification: 👍×18, em-dash×290, arrow×21 at authoring time — pin a conservative
    // floor so ordinary editing does not fight the guard while a wholesale strip turns it RED).
    const kit = readKit(); // decoded UTF-8
    expect(
      (kit.match(/\u{1F44D}/gu) ?? []).length,
      'the kit must still carry the 👍 agreed-mark glyph (decoded) — converse of the mojibake guard.',
    ).toBeGreaterThan(0);
    expect(
      (kit.match(/—/g) ?? []).length, // em-dash —
      'the kit must still carry em-dash `—` glyphs (decoded).',
    ).toBeGreaterThan(0);
    expect(
      (kit.match(/→/g) ?? []).length, // arrow →
      'the kit must still carry arrow `→` glyphs (decoded).',
    ).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (b) SELF-CONTAINED — the kit carries the content inline; it issues NO fetch for content.
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it('is SELF-CONTAINED — no network fetch / sibling-file read for content', () => {
    const kit = readKit();
    // No network fetch tooling. (The kit configures an MCP server but never fetches its own
    // content over the network.) These are FETCH instructions, distinct from the relative markdown
    // LINK refs the kit legitimately copies verbatim inside the inlined bodies.
    expect(
      /\bcurl\b/i.test(kit),
      'the kit must NOT instruct a `curl` fetch — it carries every artifact INLINE (AC #1).',
    ).toBe(false);
    expect(
      /\bwget\b/i.test(kit),
      'the kit must NOT instruct a `wget` fetch — it carries every artifact INLINE (AC #1).',
    ).toBe(false);
    expect(
      /fetch\s*\(\s*['"`]?https?:/i.test(kit),
      'the kit must NOT `fetch()` content over the network — every artifact is INLINE (AC #1).',
    ).toBe(false);
    // It must not tell the agent to READ a sibling integration asset for its content (the whole
    // point of "self-contained" is that nothing sibling is needed). A read instruction would name
    // the sibling and a read verb in the same breath.
    expect(
      /\b(read|open|load|fetch|copy)\b[^.\n]{0,40}\bintegration\/bmad\/(skill-rules|cadence-hook|agent-prompt-snippet|identity-bootstrap)/i.test(
        kit,
      ),
      'the kit must NOT instruct reading a sibling integration/bmad asset for its content — it ' +
        'inlines them all (AC #1).',
    ).toBe(false);

    // CONVERSE (so the above is not vacuously true on a stripped kit): the kit must actually CARRY
    // each artifact's content inline. The drift-pin tests already assert verbatim matches; here we
    // re-assert presence at a coarse grain so "self-contained" means "content is here", not
    // "content is absent".
    const registry = readSource(REGISTRY_PATH, 'skill-rules.md');
    expect(
      kit.includes('# AgentBBS skill-rules registry (board behavior)') &&
        kit.includes(
          registry.slice(
            registry.indexOf('## Rule A'),
            registry.indexOf('## Rule B'),
          ),
        ),
      'the kit must CARRY the skill-rules registry inline (self-contained means content present).',
    ).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (c) NO PHANTOM TOOLS (Rule 10) — every backticked tool token is a real registered tool.
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it('names no phantom tools — every backticked tool token in the kit is a real registered tool', () => {
    const kit = readKit();
    const realTools = readCanonicalToolNames();

    // Sanity: the source of truth is non-empty (a bad parse would make this guard vacuous).
    expect(
      realTools.size,
      'expected the contract §6 canonical tool list to parse to a non-empty set',
    ).toBeGreaterThan(0);

    // Backticked tokens in the kit that are NOT tool calls. These mirror the sibling guards'
    // allowlists, plus the kit-specific non-tool identifiers it backticks: `seq` (the message
    // SEQUENCE NUMBER named in the FR21 Frozen semantic), the two `[workflow]` SCHEMA KEYS the
    // inlined templates document (`persistent_facts`, `on_complete`), `current_focus` (a
    // `register` PARAM, not a tool), `agentbbs_handle` (the recorded AGENTS.md key), and
    // `agentbbs` (the MCP-SERVER NAME / the owned `.mcp.json` key — emphatically not a tool; the
    // tools are `register`/`check`/… which it advertises). Keep this list minimal and explicit —
    // growing it should be a deliberate act (a phantom hides only behind an entry added here).
    const NON_TOOL_TOKENS = new Set([
      'seq',
      'persistent_facts',
      'on_complete',
      'current_focus',
      'agentbbs_handle',
      'agentbbs',
      // MCP-server connection-record CONFIG KEYS (Story 12.1 §3.9), not tools — the `{ command,
      // args, env }` shape of an `.mcp.json` / user-scope server entry. Backticked in the §3.9 prose
      // and JSON examples; emphatically not callable AgentBBS tools.
      'command',
      'args',
      'env',
      // Announce-or-join sub-board step (Story 12.2 §2 bootstrap Step 5), not tools — `project_id`
      // (the derived id / `join_board` param), `title`/`description` (`announce_project` params),
      // `origin` (the git-remote NAME the id is derived from), and `taskflow` (the worked-example
      // project_id/slug). The TOOLS the step composes (`announce_project`, `join_board`) ARE real §6
      // tools, so they pass the scan without an allowlist entry.
      'project_id',
      'title',
      'description',
      'origin',
      'taskflow',
      // Operator-skill RESPONSE-SHAPE fields + the writeOwnedFile param (Story 12.6 §3.10), not
      // tools — the backticked field names the four inlined operator skills document for the data
      // the REAL tools return / accept. `content` is the `writeOwnedFile(path, content)` param;
      // `announcements`/`messages`/`protocol` are `check` result fields; `projects`/`members`/`room`/
      // `room_id`/`subject`/`body` are `list_*`/`read_room`/`post_announcement` shape fields. The
      // TOOLS the skills compose (`check`, `list_projects`, `list_members`, `list_announcements`,
      // `list_rooms`, `read_room`, `reply`, `post_announcement`, `join_board`, `login`) ARE real §6
      // tools and pass the scan without an allowlist entry.
      'content',
      'announcements',
      'messages',
      'protocol',
      'room_id',
      'projects',
      'members',
      'room',
      'subject',
      'body',
    ]);

    const candidates = backtickedTokens(kit);
    const phantom = candidates.filter(
      (tok) => !realTools.has(tok) && !NON_TOOL_TOKENS.has(tok),
    );
    expect(
      phantom,
      `the kit references tool-looking token(s) that are NOT registered tools and are not ` +
        `allowlisted non-tool tokens: ${JSON.stringify([...new Set(phantom)])}. The kit is the ` +
        `highest-stakes agent-consumed asset — a phantom tool here becomes an instruction an agent ` +
        `tries to call against a stranger's project (AC #1, Rule 10). If a token is a real new ` +
        `tool, it will be in docs/mcp-tool-contract.md §6; if it is a non-tool identifier, add it ` +
        `to NON_TOOL_TOKENS.`,
    ).toEqual([]);

    // Converse sanity: the kit's headline tools must actually appear as backticked tokens, so a
    // future reword that strips ALL backticks (making the phantom scan vacuously pass on an empty
    // candidate set) is caught here too.
    for (const tool of [
      'register',
      'login',
      'check',
      'read_room',
      'reply',
      'react',
      'read_contract',
    ] as const) {
      expect(
        candidates.includes(tool),
        `the kit must backtick the \`${tool}\` tool name (AC #1) — its absence would also make ` +
          `the phantom-tool scan vacuous`,
      ).toBe(true);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (d) SAFETY PROPERTIES + PREREQUISITE STATED.
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it('STATES the three safety properties — idempotent / backup-before-overwrite / never-touch-foreign (incl. epic-cycle)', () => {
    const kit = readKit();

    // 1. Idempotent sentinel blocks (a re-run with no change is a no-op).
    expect(
      /idempotent/i.test(kit) &&
        /(no-?op|byte-?level no-?op|no diff)/i.test(kit),
      'the kit must STATE that its edits are IDEMPOTENT — a re-run with identical content is a ' +
        'no-op (AC #2).',
    ).toBe(true);

    // 2. Timestamped backup BEFORE overwrite.
    expect(
      /backup/i.test(kit) &&
        /(timestamp|UTC|agentbbs-bak)/i.test(kit) &&
        /before/i.test(kit),
      'the kit must STATE that it writes a TIMESTAMPED BACKUP BEFORE any overwrite (AC #2).',
    ).toBe(true);

    // 3. Never touch foreign assets — explicitly naming the epic-cycle kit as off-limits.
    expect(
      /epic-cycle/i.test(kit),
      'the kit must STATE the never-touch-foreign rule and NAME the `epic-cycle` installation kit ' +
        'as off-limits (AC #2, Rule 8 foreign-asset boundary).',
    ).toBe(true);
    expect(
      /never\s+touch|does not touch|do(es)? not (modify|touch)|foreign-?safe|left\s+byte-?identical/i.test(
        kit,
      ),
      'the kit must STATE that it never touches assets it does not own (foreign-safe) — AC #2.',
    ).toBe(true);
    // And the JSON analogue: only the owned `agentbbs` key in `.mcp.json` is touched.
    expect(
      /\.mcp\.json/.test(kit) && /\bagentbbs\b/.test(kit),
      'the kit must STATE the `.mcp.json` key-scoped merge — only the owned `agentbbs` server key ' +
        'is touched, foreign servers preserved (AC #2).',
    ).toBe(true);
  });

  it('STATES the AC #3 MCP-server prerequisite — verify the server first; if absent, REPORT and STOP (do not install it)', () => {
    const kit = readKit();

    // It frames the server as a PREREQUISITE.
    expect(
      /prerequisite/i.test(kit),
      'the kit must frame the AgentBBS MCP server as a PREREQUISITE (AC #3).',
    ).toBe(true);

    // It must do the check FIRST and STOP if not met.
    expect(
      /\bstop\b|\bhalt\b/i.test(kit),
      'the kit must STOP/HALT when the prerequisite is not met (AC #3).',
    ).toBe(true);

    // It must explicitly NOT install the server itself.
    expect(
      /(does\s+not|do\s+not|never)[^.\n]{0,40}install[^.\n]{0,30}server|not\s+install\s+the\s+(agentbbs\s+)?(mcp\s+)?server/i.test(
        kit,
      ),
      'the kit must STATE it does NOT install the MCP server itself — it only reports the ' +
        'prerequisite (AC #3).',
    ).toBe(true);

    // The connection record it writes names the server binary/entrypoint + the AGENTBBS_DB env.
    expect(
      /agentbbs-mcp-server/.test(kit) &&
        /dist\/main\.js/.test(kit) &&
        /AGENTBBS_DB/.test(kit),
      'the kit must record the MCP-server connection (binary `agentbbs-mcp-server` / ' +
        '`node <path>/dist/main.js`, env `AGENTBBS_DB`) — AC #1 / AC #3.',
    ).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // (e) GLOBAL-BOARD CONNECTION RECORD (Story 12.1 — AC1 / AC2, Rule 10). Pins the §3.9 topology
  // reconciliation: register ONCE at user scope against ONE global DB (`~/.agentbbs/board.db`); the
  // old per-project `${PROJECT_ROOT}/.agentbbs/agentbbs.db` default is GONE; no unresolved
  // `${PROJECT_ROOT}` literal survives as an active AGENTBBS_DB value; the per-project DB is demoted
  // to a documented OVERRIDE. A drift (reintroducing the per-project default, or the broken
  // placeholder as a live value) must turn these RED.
  // ──────────────────────────────────────────────────────────────────────────────────────────

  it('records the GLOBAL board DB default `~/.agentbbs/board.db` (Story 12.1 AC1)', () => {
    const kit = readKit();
    expect(
      kit.includes('~/.agentbbs/board.db'),
      'the kit must name the single global-board DB default `~/.agentbbs/board.db` — Epic 12 makes ' +
        'the board global per machine (each project a sub-board), so the connection record points at ' +
        'one shared DB (Story 12.1 AC1).',
    ).toBe(true);
  });

  it('registers the server ONCE at USER scope (Story 12.1 AC1)', () => {
    const kit = readKit();
    // The primary registration path is user-scope, not a per-project `.mcp.json` write. Pin both the
    // user-scope flag and the framing so a regression back to per-project-as-default turns this RED.
    expect(
      /--scope\s+user/.test(kit),
      'the kit must register the `agentbbs` server at USER scope (`claude mcp add --scope user …`) so ' +
        'every project on the machine reaches the SAME global board (Story 12.1 AC1).',
    ).toBe(true);
    expect(
      /\buser scope\b/i.test(kit),
      'the kit must frame the registration as user-scope (register ONCE at user scope → one global ' +
        'board) — Story 12.1 AC1.',
    ).toBe(true);
  });

  it('does NOT make the per-project DB the default — the old `${PROJECT_ROOT}/.agentbbs/agentbbs.db` default is GONE (Story 12.1 AC1/AC2)', () => {
    const kit = readKit();
    // The literal old per-project DEFAULT value must not appear anywhere — that exact string was the
    // pre-12.1 connection-record default and the thing this story removes.
    expect(
      kit.includes('${PROJECT_ROOT}/.agentbbs/agentbbs.db'),
      'the old per-project default `${PROJECT_ROOT}/.agentbbs/agentbbs.db` must be GONE from the kit — ' +
        'Story 12.1 makes the global board the default and demotes the per-project DB to an explicit ' +
        'override (AC1).',
    ).toBe(false);
  });

  it('leaves NO unresolved `${PROJECT_ROOT}` placeholder as an active AGENTBBS_DB value (Story 12.1 AC2 — portability fix)', () => {
    const kit = readKit();
    // `${PROJECT_ROOT}` is not a Claude-Code-provided variable, so it never expands → a broken
    // AGENTBBS_DB. It may appear ONCE in the explanatory note that documents the fixed bug, but it must
    // NOT appear as a live `AGENTBBS_DB` assignment (env value, --env flag, or JSON value). Match the
    // placeholder ONLY where it sits in an AGENTBBS_DB position (precise — Rule 18 — so the explanatory
    // mention does not false-positive and a real reintroduction does not slip through).
    const activePlaceholder =
      /AGENTBBS_DB["'\s:=]+[^\n]*\$\{PROJECT_ROOT\}/.test(kit);
    expect(
      activePlaceholder,
      'no active `AGENTBBS_DB` value may contain the unresolved `${PROJECT_ROOT}` placeholder — it is ' +
        'not a Claude-Code-defined variable and never expands, so it produces a literally-broken DB ' +
        'path (Story 12.1 AC2). The kit resolves an absolute path at install time instead.',
    ).toBe(false);
  });

  it('preserves the per-project DB as an explicit documented OVERRIDE (Story 12.1 AC1)', () => {
    const kit = readKit();
    expect(
      /\boverride\b/i.test(kit) && /isolated/i.test(kit),
      'the kit must keep the per-project DB as an explicit documented OVERRIDE (an isolated per-project ' +
        'board), not the default — mirroring AR6 (Story 12.1 AC1).',
    ).toBe(true);
  });

  // ── QA strengthening (Story 12.1, this stage) — extend group (e) where the dev guards were thin ──
  // The dev pinned that user-scope + the global default + the override all PRESENT, and that the
  // broken placeholder is GONE. These add the load-bearing AC1 precedence/collision claims the dev
  // guards did not pin, and harden the Rule-18 "absence" assertion against a position the dev's
  // AGENTBBS_DB-positional regex does not reach. Each is mutation-confirmed non-vacuous (Rule 7) at
  // the QA stage (see the test-summary); none touches the Rule-13-frozen connection integration test.

  it('frames the per-project board as explicitly NOT the default — global/user-scope is PRIMARY (Story 12.1 AC1 precedence)', () => {
    const kit = readKit();
    // The dev's override guard proves the word "override" + "isolated" are present, but NOT that the
    // override is DEMOTED below the global default. A drift that promotes the per-project board back to
    // the default while still using the word "override" elsewhere would slip past the dev guard. Pin the
    // demotion explicitly: the per-project/isolated board must be stated to NOT be the default, and the
    // global board must be stated to BE the default.
    expect(
      /isolated[^\n]*\bNOT\b[^\n]*default|\bNOT\b[^\n]*default[^\n]*isolated|override[^\n]*\bNOT\b[^\n]*default|\bNOT\b the default/i.test(
        kit,
      ),
      'the kit must state the isolated per-project board is NOT the default (it is an explicit ' +
        'override). Global/user-scope is the PRIMARY path; demoting the per-project DB is the AC1 ' +
        'precedence claim (Story 12.1 AC1).',
    ).toBe(true);
    expect(
      /(single )?global board is the default|global board[^\n]*default|default[^\n]*global board/i.test(
        kit,
      ),
      'the kit must state the single global board IS the default — the converse of the override being ' +
        'demoted, so the precedence is pinned in both directions (Story 12.1 AC1).',
    ).toBe(true);
  });

  it('STATES the same-key collision avoidance — do NOT also register a project-scope `agentbbs` alongside the user-scope one (Story 12.1 AC1)', () => {
    const kit = readKit();
    // AC1's second clause: "the same-key collision with a user-scope server is avoided." The dev guards
    // never pinned this. The kit must warn that a project-scope `agentbbs` server with the SAME KEY as
    // the user-scope registration is a redundant collision to avoid. Tie the collision concept to the
    // CONNECTION-RECORD context (same-key / project-scope vs user-scope) — NOT a bare mention of the
    // word "collision" anywhere (the kit also mentions an unrelated handle-suffix collision and an
    // identity collision, so a bare /collision/ test would be vacuous — Rule 7 / Rule 18 scoping).
    expect(
      /same[\s-]*key collision|key collision|collision[^\n]*(user[\s-]*scope|project[\s-]*scope)|(user[\s-]*scope|project[\s-]*scope)[^\n]*collision/i.test(
        kit,
      ),
      'the kit must name the SAME-KEY COLLISION risk in the connection-record context (a project-scope ' +
        '`agentbbs` server colliding with the user-scope one) — not merely the unrelated handle/identity ' +
        'collisions elsewhere (Story 12.1 AC1).',
    ).toBe(true);
    expect(
      /do\s+(\*\*)?not(\*\*)?\s+also\s+register|not\s+also\s+register[^\n]*(project|user)[\s-]*scope/i.test(
        kit,
      ),
      'the kit must instruct NOT to ALSO register a project-scope `agentbbs` server alongside the ' +
        'user-scope one (the same-key collision AC1 requires be avoided).',
    ).toBe(true);
  });

  it('Rule-18 hardening — the broken per-project placeholder DB path appears NOWHERE as a live value, in any config position (Story 12.1 AC2)', () => {
    const kit = readKit();
    // The dev's "no active placeholder" guard matches `${PROJECT_ROOT}` ONLY in an AGENTBBS_DB-prefixed
    // position. That correctly covers the kit's live positions today (the DB always sits under
    // AGENTBBS_DB). But to harden against a future reintroduction that puts the placeholder path in a
    // DIFFERENT live position (e.g. an `args` entry, or a bare command path) — which the positional
    // regex would MISS (false-negative) — pin the specific broken DB-path STRING as forbidden anywhere
    // EXCEPT inside the single explanatory note that documents the fixed bug. We strip the explanatory
    // block-quote lines (the `>`-prefixed §3.9 note + the override-prose mention of the fallback) and
    // assert the active body carries no `${PROJECT_ROOT}`-rooted .agentbbs DB path.
    //
    // Strip markdown block-quote (explanatory) lines so the documented-bug mention is excluded.
    const activeBody = kit
      .split('\n')
      .filter((line) => !/^\s*>/.test(line))
      .join('\n');
    expect(
      /\$\{PROJECT_ROOT\}[\\/]\.agentbbs/.test(activeBody),
      'the broken `${PROJECT_ROOT}/.agentbbs/...` DB path must not appear as a live value ANYWHERE in ' +
        'the kit body (only inside the explanatory `>`-quoted note about the fixed bug). This is the ' +
        'position-independent companion to the AGENTBBS_DB-positional guard — it catches a reintroduction ' +
        'in an `args` entry or a command path the positional regex would miss (Story 12.1 AC2, Rule 18).',
    ).toBe(false);
    // Converse non-vacuity: the strip must NOT have removed the entire kit (a stripped-to-empty body
    // would make the absence assertion vacuously pass). The active body must still carry the live
    // user-scope registration command.
    expect(
      /--scope\s+user/.test(activeBody),
      'sanity: stripping `>`-quoted lines must leave the live user-scope registration command intact ' +
        '(else the placeholder-absence assertion above would be vacuous).',
    ).toBe(true);
  });

  it('the §4 verify step confirms the USER-SCOPE global registration (resolved `~/.agentbbs/board.db`) and no stray per-project entry (Story 12.1 AC1/AC4)', () => {
    const kit = readKit();
    // AC4's installed-state expectation is documented in the §4 verify step. The dev guards pin the §3.9
    // WRITE side; this pins the §4 VERIFY side so the kit tells the operator to confirm the user-scope
    // global registration end-to-end (and that no per-project `.mcp.json agentbbs` entry was created
    // unless they chose the override). A drift that leaves §4 verifying a per-project registration would
    // contradict the §3.9 rewrite and slip past the §3.9-only guards.
    expect(
      /at user scope[^\n]*AGENTBBS_DB|AGENTBBS_DB[^\n]*at user scope|registered\s+(\*\*)?at user scope/i.test(
        kit,
      ),
      'the §4 verify step must tell the operator to confirm the `agentbbs` server is registered at USER ' +
        'scope with AGENTBBS_DB set (Story 12.1 AC1/AC4).',
    ).toBe(true);
    expect(
      /no per-project[^\n]*\.mcp\.json[^\n]*agentbbs|no per-project[^\n]*agentbbs[^\n]*entry/i.test(
        kit,
      ),
      'the §4 verify step must have the operator confirm NO per-project `.mcp.json` `agentbbs` entry was ' +
        'created (unless the explicit isolated-board override was chosen) — Story 12.1 AC1.',
    ).toBe(true);
  });
});
