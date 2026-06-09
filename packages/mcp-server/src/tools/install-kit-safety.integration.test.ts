// EXECUTABLE safety-property proof for the Story 8.4 installation kit's OWN file-surgery helper
// (`integration/bmad/install-agentbbs.md` → its inline ```js block). REAL-RUNTIME evidence
// (skill-rules Rule 3 + Epic 7 retro Action A), complementary to the dev's CONTENT-GUARD
// (`packages/mcp-server/src/install-kit-doc.test.ts`).
//
// The content-guard proves the kit SAYS the right words (it inlines the canonical assets, names
// only real tools, states the three safety properties + the prerequisite). It does NOT prove the
// kit's helper actually BEHAVES safely. This test closes that gap on the highest-stakes
// agent-consumed asset in the project — a kit that WRITES files in a stranger's project — by
// EXTRACTING the kit's inline Node helper (the exact ```js block an operator would save and run)
// and EXECUTING it against a throwaway temp project. Nothing is mocked: the real `applyBlock` /
// `mergeMcpServer` from the shipped kit run against real files in an OS temp dir.
//
// It proves, on the KIT'S ACTUAL CODE (story Task 4 / AC #2):
//   (i)   IDEMPOTENCY — a first applyBlock INSERTS; an immediate second with identical content is
//         a byte-level no-op (target unchanged; NO new backup created).
//   (ii)  BACKUP-BEFORE-OVERWRITE — changing the owned block's content produces a timestamped
//         backup AND replaces ONLY the bytes between the sentinels (surrounding bytes intact).
//   (iii) NEVER-TOUCH-FOREIGN — a planted fake `epic-cycle` kit file AND an unrelated key in the
//         same edited file survive BYTE-IDENTICAL (only the owned block/key changed).
//   (iv)  .mcp.json KEY-SCOPING — a pre-existing FOREIGN MCP server stays untouched while the
//         owned `agentbbs` key is added/updated.
//
// The helper is the deterministic safety-critical surface; this is the "the-words-actually-work"
// half of the Epic 7 retro Action A pairing. Discoverable by the default `pnpm test` (skill-rules
// Rule 8): co-located `*.integration.test.ts` under `packages/mcp-server/src/tools/`, no skip/only.
//
// Hermetic: the extracted helper is written to a temp `.mjs` and dynamically imported (real ESM
// module), and every temp artifact lives under os.tmpdir() and is removed in afterEach. It never
// touches the repo or the real `.agentbbs/`.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Repo root: this file is at `packages/mcp-server/src/tools/`, so FOUR levels up.
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const KIT_PATH = join(REPO_ROOT, 'integration', 'bmad', 'install-agentbbs.md');

/**
 * Extract the kit's HELPER ```js block — the one fenced code block that defines the file-surgery
 * functions. There are several ```js blocks in the kit (the module + short example calls); the
 * helper module is uniquely identified by exporting `applyBlock` + `mergeMcpServer` +
 * `writeOwnedFile` (the three file-surgery functions; `writeOwnedFile` is the Story-12.6
 * whole-owned-file path the operator skills use). Returns the raw JS source between the fences.
 * Throws loudly if not found (a renamed/removed helper must fail the proof, not silently skip it).
 */
function extractHelperSource(kit: string): string {
  // Match each ```js … ``` fenced block (non-greedy), then pick the one with the helper exports.
  const blocks = [...kit.matchAll(/```js\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const helper = blocks.find(
    (b) =>
      b.includes('export function applyBlock') &&
      b.includes('export function mergeMcpServer') &&
      b.includes('export function writeOwnedFile'),
  );
  if (!helper) {
    throw new Error(
      `Could not find the kit's helper \`\`\`js block (the one exporting applyBlock + ` +
        `mergeMcpServer + writeOwnedFile) in ${KIT_PATH}. Story 8.4/12.6 requires the kit to carry ` +
        `that helper inline.`,
    );
  }
  return helper;
}

// Loaded once: the extracted helper module's exports (the kit's ACTUAL code).
let applyBlock: (
  targetPath: string,
  begin: string,
  end: string,
  content: string,
) => { action: string; backup: string | null };
let mergeMcpServer: (
  targetPath: string,
  serverName: string,
  serverConfig: unknown,
) => { action: string; backup: string | null };
let writeOwnedFile: (
  targetPath: string,
  content: string,
) => { action: string; backup: string | null };

// A dedicated temp dir to host the extracted helper module for the whole suite.
let helperDir: string;

beforeAll(async () => {
  const kit = readFileSync(KIT_PATH, 'utf8');
  const source = extractHelperSource(kit);
  helperDir = mkdtempSync(join(tmpdir(), 'agentbbs-kit-helper-'));
  const modPath = join(helperDir, 'apply-agentbbs.mjs');
  writeFileSync(modPath, source, 'utf8');
  // Import the EXACT extracted code as a real ESM module — this is the kit's helper running.
  const mod = await import(pathToFileURL(modPath).href);
  applyBlock = mod.applyBlock;
  mergeMcpServer = mod.mergeMcpServer;
  writeOwnedFile = mod.writeOwnedFile;
  expect(
    typeof applyBlock,
    'the kit helper must export an applyBlock function',
  ).toBe('function');
  expect(
    typeof mergeMcpServer,
    'the kit helper must export a mergeMcpServer function',
  ).toBe('function');
  expect(
    typeof writeOwnedFile,
    'the kit helper must export a writeOwnedFile function (Story 12.6 whole-owned-file path)',
  ).toBe('function');
});

// A throwaway "consuming project" dir per test.
let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'agentbbs-kit-proj-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

/** List the timestamped backups the helper made for a given target (basename prefix match). */
function backupsFor(targetPath: string): string[] {
  const dir = dirname(targetPath);
  const base = targetPath.slice(dir.length + 1);
  return readdirSync(dir).filter((f) => f.startsWith(`${base}.agentbbs-bak-`));
}

const BEGIN = '<!-- AGENTBBS-IDENTITY:BEGIN -->';
const END = '<!-- AGENTBBS-IDENTITY:END -->';

describe('install-agentbbs.md helper — executable safety properties (the kit’s own code)', () => {
  it('(i) IDEMPOTENT: first applyBlock inserts; an identical second is a byte no-op with NO new backup', () => {
    const target = join(projectDir, 'AGENTS.md');
    writeFileSync(target, '# Agents\n\nExisting project notes.\n', 'utf8');
    const before = readFileSync(target, 'utf8');

    // First apply → INSERT (existing file gains the owned block).
    const r1 = applyBlock(
      target,
      BEGIN,
      END,
      'agentbbs_handle: amelia-dev@taskflow',
    );
    expect(
      ['inserted', 'replaced'].includes(r1.action) || r1.action === 'created',
    ).toBe(true);
    const afterFirst = readFileSync(target, 'utf8');
    expect(afterFirst).not.toBe(before); // it actually changed
    expect(afterFirst).toContain('agentbbs_handle: amelia-dev@taskflow');
    expect(afterFirst).toContain('Existing project notes.'); // pre-existing content preserved
    // First write of an existing file makes exactly one backup (backup-before-overwrite).
    const backupsAfterFirst = backupsFor(target);
    expect(backupsAfterFirst.length).toBe(1);

    // Second apply with IDENTICAL content → byte-level no-op.
    const r2 = applyBlock(
      target,
      BEGIN,
      END,
      'agentbbs_handle: amelia-dev@taskflow',
    );
    expect(
      r2.action,
      'an identical re-apply must be a no-op (idempotent) — AC #2',
    ).toBe('noop');
    expect(r2.backup, 'a no-op must NOT create a backup — AC #2').toBeNull();

    // Target unchanged byte-for-byte, and NO new backup was created.
    const afterSecond = readFileSync(target, 'utf8');
    expect(
      afterSecond,
      'the target must be byte-identical after an identical re-apply',
    ).toBe(afterFirst);
    expect(
      backupsFor(target).length,
      'no NEW backup may be created on an idempotent no-op',
    ).toBe(backupsAfterFirst.length);
  });

  it('(ii) BACKUP-BEFORE-OVERWRITE: changed content makes a timestamped backup AND replaces only between the sentinels', () => {
    const target = join(projectDir, 'AGENTS.md');
    // Seed with content BEFORE and AFTER where the owned block will live, so we can prove the
    // surrounding bytes are untouched by a replace.
    applyBlock(target, BEGIN, END, 'agentbbs_handle: amelia-dev@taskflow');
    // Add unrelated content after the block to prove a later replace leaves it intact.
    const withTail =
      readFileSync(target, 'utf8') +
      '\n## Unrelated section\nkeep me exactly as-is\n';
    writeFileSync(target, withTail, 'utf8');
    const beforeChange = readFileSync(target, 'utf8');
    const backupsBefore = backupsFor(target);

    // Change ONLY the owned block's content.
    const r = applyBlock(
      target,
      BEGIN,
      END,
      'agentbbs_handle: amelia-dev@taskflow-2',
    );
    expect(
      r.action,
      'a real content change to an existing file is a replace',
    ).toBe('replaced');

    // A timestamped backup was made (named <file>.agentbbs-bak-<UTC>), and it holds the PRIOR bytes.
    expect(
      r.backup,
      'a changed overwrite must produce a backup path',
    ).not.toBeNull();
    expect(r.backup as string).toMatch(/\.agentbbs-bak-/);
    expect(backupsFor(target).length).toBe(backupsBefore.length + 1);
    expect(readFileSync(r.backup as string, 'utf8')).toBe(beforeChange);

    // Only the bytes between the sentinels changed: the new handle is present, the old is gone,
    // and the unrelated tail survives byte-identical.
    const afterChange = readFileSync(target, 'utf8');
    expect(afterChange).toContain('agentbbs_handle: amelia-dev@taskflow-2');
    expect(afterChange).not.toContain('agentbbs_handle: amelia-dev@taskflow\n');
    expect(afterChange).toContain(
      '## Unrelated section\nkeep me exactly as-is\n',
    );
  });

  it('(iii) NEVER-TOUCH-FOREIGN: a planted epic-cycle kit file + an unrelated key survive byte-identical', () => {
    // Plant a fake `epic-cycle` installation kit file — the foreign asset the kit must NEVER touch.
    const epicCycleKit = join(projectDir, 'install-epic-cycle.md');
    const epicCycleContent =
      '# epic-cycle kit (FOREIGN)\n\nThis belongs to a DIFFERENT installation kit.\n' +
      'The AgentBBS kit must never touch it.\n';
    writeFileSync(epicCycleKit, epicCycleContent, 'utf8');

    // Plant an unrelated foreign key block in the SAME file the AgentBBS kit edits.
    const target = join(projectDir, 'AGENTS.md');
    const foreignBlock =
      '<!-- SOMEONE-ELSES-BLOCK:BEGIN -->\nforeign_setting: do-not-touch\n' +
      '<!-- SOMEONE-ELSES-BLOCK:END -->\n';
    writeFileSync(
      target,
      `# Agents\n\n${foreignBlock}\nProse below.\n`,
      'utf8',
    );

    // Run the AgentBBS-owned edit (insert its identity block).
    applyBlock(target, BEGIN, END, 'agentbbs_handle: amelia-dev@taskflow');
    // Run it again with a change (forces a replace path too).
    applyBlock(target, BEGIN, END, 'agentbbs_handle: amelia-dev@taskflow-2');

    // The foreign epic-cycle kit file is BYTE-IDENTICAL (and the helper never created a backup for
    // it — it was never opened).
    expect(
      readFileSync(epicCycleKit, 'utf8'),
      'the epic-cycle kit must be byte-identical — the AgentBBS kit must never touch it (AC #2)',
    ).toBe(epicCycleContent);
    expect(backupsFor(epicCycleKit).length).toBe(0);

    // The unrelated foreign block in the edited file survived byte-identical.
    expect(
      readFileSync(target, 'utf8'),
      'the unrelated foreign block in AGENTS.md must survive byte-identical (AC #2)',
    ).toContain(foreignBlock);
  });

  it('(iv) .mcp.json KEY-SCOPING: a pre-existing foreign server stays untouched while `agentbbs` is added then updated', () => {
    const target = join(projectDir, '.mcp.json');
    // A pre-existing `.mcp.json` with a FOREIGN server + an unrelated top-level key.
    const original = {
      mcpServers: {
        'some-other-server': {
          command: 'other-bin',
          args: ['--flag'],
          env: { OTHER: '1' },
        },
      },
      unrelatedTopLevelKey: { keep: 'me' },
    };
    writeFileSync(target, `${JSON.stringify(original, null, 2)}\n`, 'utf8');

    // ADD the owned `agentbbs` server.
    const cfg = {
      command: 'agentbbs-mcp-server',
      args: [],
      env: { AGENTBBS_DB: '${PROJECT_ROOT}/.agentbbs/agentbbs.db' },
    };
    const rAdd = mergeMcpServer(target, 'agentbbs', cfg);
    expect(rAdd.action).toBe('replaced'); // existing file changed
    let doc = JSON.parse(readFileSync(target, 'utf8'));
    // Foreign server + unrelated key preserved EXACTLY.
    expect(doc.mcpServers['some-other-server']).toEqual(
      original.mcpServers['some-other-server'],
    );
    expect(doc.unrelatedTopLevelKey).toEqual(original.unrelatedTopLevelKey);
    // Owned key added.
    expect(doc.mcpServers['agentbbs']).toEqual(cfg);

    // Re-adding the SAME config is a no-op (idempotent), no new backup.
    const backupsAfterAdd = backupsFor(target);
    const rNoop = mergeMcpServer(target, 'agentbbs', cfg);
    expect(
      rNoop.action,
      'identical mergeMcpServer must be a no-op (AC #2)',
    ).toBe('noop');
    expect(backupsFor(target).length).toBe(backupsAfterAdd.length);

    // UPDATE the owned key (change the DB path) — foreign server STILL untouched.
    const cfg2 = { ...cfg, env: { AGENTBBS_DB: '/custom/path/agentbbs.db' } };
    const rUpd = mergeMcpServer(target, 'agentbbs', cfg2);
    expect(rUpd.action).toBe('replaced');
    expect(rUpd.backup as string).toMatch(/\.agentbbs-bak-/);
    doc = JSON.parse(readFileSync(target, 'utf8'));
    expect(
      doc.mcpServers['some-other-server'],
      'the foreign MCP server must stay untouched across an agentbbs update (AC #2)',
    ).toEqual(original.mcpServers['some-other-server']);
    expect(doc.unrelatedTopLevelKey).toEqual(original.unrelatedTopLevelKey);
    expect(doc.mcpServers['agentbbs']).toEqual(cfg2);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Story 12.6 — Rule-11 re-proof over the EXPANDED install set: the whole-owned-file path
// (`writeOwnedFile`) the kit's §3.10 uses to install the four operator skills to user-scope
// `~/.claude/skills/<name>/SKILL.md`. The same EXTRACT + IMPORT + EXECUTE discipline as above, run
// against the kit's OWN helper (not a re-implementation), over real temp fixtures that mirror the new
// whole-owned-file targets:
//   (v)   IDEMPOTENT — writing a SKILL.md, then re-writing IDENTICAL content, is a byte no-op with
//         NO new backup; a NON-existent target is created (with its kit-owned parent dir).
//   (vi)  BACKUP-BEFORE-OVERWRITE — changing an existing owned SKILL.md writes a timestamped backup
//         FIRST (holding the prior bytes), then writes the new whole-file content.
//   (vii) NEVER-TOUCH-FOREIGN — a planted FOREIGN `.claude/skills/<other>/SKILL.md` AND a foreign
//         top-level file survive BYTE-IDENTICAL after all four `agentbbs-*` skills are written; the
//         helper never opens/backs-up the foreign assets.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// A minimal but realistic operator-skill body (frontmatter at line 1 — the reason these are whole
// owned files written via writeOwnedFile, NOT sentinel-wrapped via applyBlock).
const SKILL_BODY_V1 =
  '---\nname: agentbbs-check\ndescription: catch up on the board\n---\n\n' +
  '# /agentbbs-check\n\nThe read-only board review skill.\n';
const SKILL_BODY_V2 =
  '---\nname: agentbbs-check\ndescription: catch up on the board (v2)\n---\n\n' +
  '# /agentbbs-check\n\nThe read-only board review skill, revised.\n';

/** The user-scope skill target the kit writes (mirrors `~/.claude/skills/<name>/SKILL.md`). */
function skillTarget(root: string, name: string): string {
  return join(root, '.claude', 'skills', name, 'SKILL.md');
}

describe('install-agentbbs.md helper — writeOwnedFile whole-owned-file safety (Story 12.6 §3.10)', () => {
  it('(v) IDEMPOTENT: writeOwnedFile creates a new owned SKILL.md (+ its parent dir); an identical re-write is a byte no-op with NO new backup', () => {
    const target = skillTarget(projectDir, 'agentbbs-check');
    // The parent `.claude/skills/agentbbs-check/` dir does NOT exist yet — the helper must create it.

    // First write → CREATED (the file + its kit-owned parent chain).
    const r1 = writeOwnedFile(target, SKILL_BODY_V1);
    expect(
      r1.action,
      'first writeOwnedFile of a new owned file is a create',
    ).toBe('created');
    expect(r1.backup, 'creating a new file makes no backup').toBeNull();
    expect(
      readFileSync(target, 'utf8'),
      'the created file holds the exact whole-file content',
    ).toBe(SKILL_BODY_V1);
    // No backup for a creation.
    expect(backupsFor(target).length).toBe(0);

    // Second write with IDENTICAL content → byte no-op.
    const r2 = writeOwnedFile(target, SKILL_BODY_V1);
    expect(
      r2.action,
      'an identical re-write must be a no-op (idempotent) — AC2',
    ).toBe('noop');
    expect(r2.backup, 'a no-op must NOT create a backup — AC2').toBeNull();
    expect(
      readFileSync(target, 'utf8'),
      'the file is byte-identical after an identical re-write',
    ).toBe(SKILL_BODY_V1);
    expect(
      backupsFor(target).length,
      'no NEW backup may be created on an idempotent re-write',
    ).toBe(0);
  });

  it('(vi) BACKUP-BEFORE-OVERWRITE: changing an existing owned SKILL.md writes a timestamped backup (prior bytes) FIRST, then the new content', () => {
    const target = skillTarget(projectDir, 'agentbbs-check');
    writeOwnedFile(target, SKILL_BODY_V1);
    const beforeChange = readFileSync(target, 'utf8');
    expect(backupsFor(target).length).toBe(0);

    // Change the whole-file content.
    const r = writeOwnedFile(target, SKILL_BODY_V2);
    expect(
      r.action,
      'a real content change to an existing owned file is a replace',
    ).toBe('replaced');
    // A timestamped backup was made and holds the PRIOR bytes.
    expect(
      r.backup,
      'a changed overwrite must produce a backup path',
    ).not.toBeNull();
    expect(r.backup as string).toMatch(/\.agentbbs-bak-/);
    expect(backupsFor(target).length).toBe(1);
    expect(
      readFileSync(r.backup as string, 'utf8'),
      'the backup must hold the prior whole-file bytes (backup-before-overwrite)',
    ).toBe(beforeChange);
    // The file now holds the new whole-file content.
    expect(readFileSync(target, 'utf8')).toBe(SKILL_BODY_V2);
  });

  it('(vii) NEVER-TOUCH-FOREIGN: a planted foreign `.claude/skills/<other>/SKILL.md` + a foreign top-level file survive byte-identical after all four agentbbs-* skills are written', () => {
    // Plant a FOREIGN skill dir under the same `.claude/skills/` root the kit writes into — a
    // different vendor's operator skill the kit must NEVER touch.
    const foreignSkill = skillTarget(projectDir, 'someone-elses-skill');
    const foreignContent =
      '---\nname: someone-elses-skill\ndescription: NOT ours\n---\n\n' +
      '# A FOREIGN skill\n\nThe AgentBBS kit must never touch this.\n';
    // Create its dir + file out-of-band (not via the kit helper).
    mkdirSync(dirname(foreignSkill), { recursive: true });
    writeFileSync(foreignSkill, foreignContent, 'utf8');

    // Plant a foreign top-level file too.
    const foreignTop = join(projectDir, 'UNRELATED.md');
    const foreignTopContent = '# Unrelated\n\nLeave me exactly as-is.\n';
    writeFileSync(foreignTop, foreignTopContent, 'utf8');

    // Write ALL FOUR of the kit's own operator skills (the §3.10 install set).
    for (const name of [
      'agentbbs-check',
      'agentbbs-projects',
      'agentbbs-read',
      'agentbbs-post',
    ] as const) {
      writeOwnedFile(
        skillTarget(projectDir, name),
        `---\nname: ${name}\ndescription: ${name} body\n---\n\n# /${name}\n`,
      );
    }
    // Re-write one with a CHANGE too (forces the replace+backup path through the foreign-safety run).
    writeOwnedFile(
      skillTarget(projectDir, 'agentbbs-check'),
      '---\nname: agentbbs-check\ndescription: changed\n---\n\n# /agentbbs-check changed\n',
    );

    // The foreign skill is BYTE-IDENTICAL, and the helper never created a backup for it.
    expect(
      readFileSync(foreignSkill, 'utf8'),
      'a foreign `.claude/skills/<other>/SKILL.md` must survive byte-identical — the kit only writes ' +
        'its own agentbbs-* skill dirs (Story 12.6 §3.10 foreign-safety)',
    ).toBe(foreignContent);
    expect(backupsFor(foreignSkill).length).toBe(0);

    // The foreign top-level file is BYTE-IDENTICAL.
    expect(
      readFileSync(foreignTop, 'utf8'),
      'a foreign top-level file must survive byte-identical (Story 12.6 foreign-safety)',
    ).toBe(foreignTopContent);
    expect(backupsFor(foreignTop).length).toBe(0);

    // Sanity: the kit's OWN skills WERE written (so the foreign-safety assertion is not vacuous on a
    // no-write run).
    expect(
      readFileSync(skillTarget(projectDir, 'agentbbs-post'), 'utf8'),
    ).toContain('name: agentbbs-post');
  });

  it('(viii) REAFFIRM existing foreign-safety holds with the expanded set: epic-cycle kit + .mcp.json foreign server + a .toml overlay all survive byte-identical alongside the skill writes', () => {
    // Plant the foreign epic-cycle kit + a foreign .mcp.json + a foreign .toml key.
    const epicCycleKit = join(projectDir, 'install-epic-cycle.md');
    const epicCycleContent =
      '# epic-cycle kit (FOREIGN)\n\nA DIFFERENT installation kit. Never touch it.\n';
    writeFileSync(epicCycleKit, epicCycleContent, 'utf8');

    const mcp = join(projectDir, '.mcp.json');
    const mcpOriginal = {
      mcpServers: {
        'some-other-server': { command: 'other-bin', args: [], env: {} },
      },
      keepMe: { x: 1 },
    };
    writeFileSync(mcp, `${JSON.stringify(mcpOriginal, null, 2)}\n`, 'utf8');

    // Run the FULL expanded install: AGENTS.md identity block + the agentbbs .mcp.json key + all four
    // skills.
    applyBlock(
      join(projectDir, 'AGENTS.md'),
      BEGIN,
      END,
      'agentbbs_handle: amelia-dev@taskflow',
    );
    mergeMcpServer(mcp, 'agentbbs', {
      command: 'agentbbs-mcp-server',
      args: [],
      env: { AGENTBBS_DB: '/abs/board.db' },
    });
    for (const name of [
      'agentbbs-check',
      'agentbbs-projects',
      'agentbbs-read',
      'agentbbs-post',
    ] as const) {
      writeOwnedFile(
        skillTarget(projectDir, name),
        `---\nname: ${name}\n---\n\n# /${name}\n`,
      );
    }

    // The epic-cycle kit is byte-identical (never opened).
    expect(
      readFileSync(epicCycleKit, 'utf8'),
      'the epic-cycle kit must remain byte-identical across the whole expanded install (AC2)',
    ).toBe(epicCycleContent);
    expect(backupsFor(epicCycleKit).length).toBe(0);

    // The foreign .mcp.json server + unrelated key survive.
    const mcpDoc = JSON.parse(readFileSync(mcp, 'utf8'));
    expect(mcpDoc.mcpServers['some-other-server']).toEqual(
      mcpOriginal.mcpServers['some-other-server'],
    );
    expect(mcpDoc.keepMe).toEqual(mcpOriginal.keepMe);
    expect(mcpDoc.mcpServers['agentbbs']).toBeDefined();
  });

  // ── QA STRENGTHENING (Story 12.6, this stage) — cases (ix)/(x). The dev proved the four base
  // writeOwnedFile properties (v–viii). These add (ix) the 8.4-helper-crlf resolution as an
  // EXECUTABLE proof — the resolution was previously only an empirical reviewer note from Story 8.4
  // (which predates writeOwnedFile), never an automated test — and (x) the full "coherent installed
  // project" end-to-end simulation the QA brief calls for (all owned writers into ONE temp project
  // with planted foreign assets incl. an epic-cycle file AND a foreign skill dir). Each is
  // mutation-confirmed non-vacuous (Rule 7) at the QA stage (see test-summary).

  it('(ix) 8.4-helper-crlf RESOLUTION (executable): writeOwnedFile over a pre-existing CRLF owned file — backs up the prior CRLF bytes, converges to its own LF content, then re-runs are byte-stable no-ops', () => {
    // The deferred 8.4-helper-crlf item was RESOLVED in 12.6 via the documented-LF branch. The dev's
    // Dev Notes assert idempotency "holds regardless of the target's prevailing newline". writeOwnedFile
    // is a WHOLE-FILE byte compare (`content === original`), NOT indexOf-based like applyBlock — so the
    // PRECISE load-bearing property is: the kit OWNS the whole skill file and writes LF, so it CONVERGES
    // a foreign-EOL file to its own LF content (a real change → backed up first), after which re-runs of
    // the kit's OWN LF output are byte-stable no-ops. Prove that exact behaviour on the kit's OWN helper,
    // so the documented-LF resolution is regression-guarded, not just prose.
    const target = skillTarget(projectDir, 'agentbbs-check');
    const lfBody = SKILL_BODY_V1; // the kit's own LF-canonical content
    const crlfBody = lfBody.replace(/\n/g, '\r\n'); // a foreign CRLF version of the same logical text

    // Seed the owned path out-of-band with a CRLF file (simulates a consuming project whose tooling
    // wrote CRLF), so we exercise the helper against a real foreign-EOL on-disk state.
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, crlfBody, 'utf8');

    // First kit write of its LF content over the CRLF file → a REAL change (CRLF !== LF bytes), so it
    // must back up the prior CRLF bytes FIRST, then write LF.
    const r1 = writeOwnedFile(target, lfBody);
    expect(
      r1.action,
      'a CRLF→LF whole-file change is a real overwrite (replaced), not a no-op',
    ).toBe('replaced');
    expect(
      r1.backup,
      'the prior CRLF bytes must be backed up first',
    ).not.toBeNull();
    expect(
      readFileSync(r1.backup as string, 'utf8'),
      'the backup must hold the EXACT prior CRLF bytes (backup-before-overwrite holds under CRLF)',
    ).toBe(crlfBody);
    // The on-disk file is now the kit's own LF content (no CRLF survives in the owned file).
    const onDisk = readFileSync(target, 'utf8');
    expect(onDisk).toBe(lfBody);
    expect(
      onDisk.includes('\r\n'),
      'after the kit writes its own content the owned file is LF (the documented-LF assumption)',
    ).toBe(false);

    // SECOND write with the SAME LF content → byte no-op, NO new backup. This is the idempotency the
    // documented-LF note promises: once converged, re-runs are byte-stable regardless of the file's
    // ORIGINAL prevailing newline.
    const backupsAfterConverge = backupsFor(target).length;
    const r2 = writeOwnedFile(target, lfBody);
    expect(
      r2.action,
      'a re-run with identical LF content is a byte no-op (idempotency holds after CRLF→LF convergence)',
    ).toBe('noop');
    expect(r2.backup).toBeNull();
    expect(backupsFor(target).length).toBe(backupsAfterConverge);
  });

  it('(x) END-TO-END coherent install: ALL owned writers (AGENTS.md block + a .toml overlay + the agentbbs .mcp.json key + all four SKILL.md whole files) into ONE temp project — every planted foreign asset survives byte-identical AND the full owned set is present', () => {
    // The "coherent installed project" angle the QA brief asks for: drive the WHOLE owned write set
    // through the kit's OWN helpers into a single temp project that ALSO holds a realistic spread of
    // foreign assets (the project's epic-cycle kit, a foreign MCP server + unrelated key, a foreign
    // block inside a .toml the kit also edits, AND a foreign vendor's `.claude/skills/<other>/` dir),
    // then assert (a) every foreign asset is BYTE-IDENTICAL and un-backed-up, and (b) the full owned
    // set landed coherently. This crosses the seams BETWEEN the individual safety cases (v–viii / i–iv)
    // — the integrated install, not one writer at a time.

    // ── Plant the foreign assets ──
    // 1. The project's OTHER installation kit (epic-cycle) — must never be touched.
    const epicCycleKit = join(projectDir, 'install-epic-cycle.md');
    const epicCycleContent =
      '# epic-cycle kit (FOREIGN)\n\nThe project owns this; the AgentBBS kit must never touch it.\n';
    writeFileSync(epicCycleKit, epicCycleContent, 'utf8');

    // 2. A foreign vendor's operator skill under the SAME .claude/skills/ root the kit writes into.
    const foreignSkill = skillTarget(projectDir, 'vendorx-helper');
    const foreignSkillContent =
      '---\nname: vendorx-helper\ndescription: a DIFFERENT vendor’s skill\n---\n\n# vendorx\n';
    mkdirSync(dirname(foreignSkill), { recursive: true });
    writeFileSync(foreignSkill, foreignSkillContent, 'utf8');

    // 3. A foreign top-level file.
    const foreignTop = join(projectDir, 'UNRELATED.md');
    const foreignTopContent = '# Unrelated\n\nLeave me exactly as-is.\n';
    writeFileSync(foreignTop, foreignTopContent, 'utf8');

    // 4. A .toml the kit also edits (an overlay file), pre-seeded with a FOREIGN block the kit must
    //    preserve while inserting its own sentinel-bounded block.
    const tomlTarget = join(
      projectDir,
      '_bmad',
      'custom',
      'bmad-dev-story.toml',
    );
    mkdirSync(dirname(tomlTarget), { recursive: true });
    const foreignTomlBlock =
      '# someone-elses-overlay\n[unrelated_table]\nkeep = "me"\n';
    writeFileSync(tomlTarget, foreignTomlBlock, 'utf8');

    // 5. A .mcp.json with a foreign server + an unrelated top-level key.
    const mcp = join(projectDir, '.mcp.json');
    const mcpOriginal = {
      mcpServers: {
        'vendorx-server': {
          command: 'vendorx',
          args: ['--go'],
          env: { V: '1' },
        },
      },
      unrelatedKey: { keep: 'this' },
    };
    writeFileSync(mcp, `${JSON.stringify(mcpOriginal, null, 2)}\n`, 'utf8');

    // ── Run the FULL owned install through the kit's OWN helpers ──
    // (a) the AGENTS.md identity block (applyBlock)
    const agentsMd = join(projectDir, 'AGENTS.md');
    writeFileSync(agentsMd, '# Agents\n\nProject notes.\n', 'utf8');
    applyBlock(agentsMd, BEGIN, END, 'agentbbs_handle: amelia-dev@taskflow');
    // (b) a .toml overlay block (applyBlock with a DIFFERENT sentinel pair) into the foreign-seeded toml
    const TOML_BEGIN = '# AGENTBBS-OVERLAY:BEGIN';
    const TOML_END = '# AGENTBBS-OVERLAY:END';
    applyBlock(
      tomlTarget,
      TOML_BEGIN,
      TOML_END,
      '[workflow]\npersistent_facts = ["file:skill-rules.md"]',
    );
    // (c) the agentbbs .mcp.json key (mergeMcpServer)
    mergeMcpServer(mcp, 'agentbbs', {
      command: 'agentbbs-mcp-server',
      args: [],
      env: { AGENTBBS_DB: '/abs/board.db' },
    });
    // (d) all four operator skills as whole owned files (writeOwnedFile)
    for (const name of [
      'agentbbs-check',
      'agentbbs-projects',
      'agentbbs-read',
      'agentbbs-post',
    ] as const) {
      writeOwnedFile(
        skillTarget(projectDir, name),
        `---\nname: ${name}\ndescription: ${name}\n---\n\n# /${name}\n`,
      );
    }

    // ── (a) EVERY foreign asset is byte-identical and was never backed up ──
    expect(readFileSync(epicCycleKit, 'utf8')).toBe(epicCycleContent);
    expect(backupsFor(epicCycleKit).length).toBe(0);

    expect(
      readFileSync(foreignSkill, 'utf8'),
      'the foreign vendor skill must survive byte-identical alongside the four agentbbs-* skills',
    ).toBe(foreignSkillContent);
    expect(backupsFor(foreignSkill).length).toBe(0);

    expect(readFileSync(foreignTop, 'utf8')).toBe(foreignTopContent);
    expect(backupsFor(foreignTop).length).toBe(0);

    // The foreign block inside the kit-edited .toml survives byte-identical (only the owned sentinel
    // block was inserted).
    const tomlAfter = readFileSync(tomlTarget, 'utf8');
    expect(
      tomlAfter.includes(foreignTomlBlock),
      'the foreign block inside the kit-edited .toml must survive byte-identical',
    ).toBe(true);
    expect(tomlAfter).toContain('# AGENTBBS-OVERLAY:BEGIN');

    // The foreign MCP server + unrelated key survive exactly.
    const mcpDoc = JSON.parse(readFileSync(mcp, 'utf8'));
    expect(mcpDoc.mcpServers['vendorx-server']).toEqual(
      mcpOriginal.mcpServers['vendorx-server'],
    );
    expect(mcpDoc.unrelatedKey).toEqual(mcpOriginal.unrelatedKey);

    // ── (b) the full OWNED set landed coherently ──
    expect(readFileSync(agentsMd, 'utf8')).toContain(
      'agentbbs_handle: amelia-dev@taskflow',
    );
    expect(mcpDoc.mcpServers['agentbbs']).toEqual({
      command: 'agentbbs-mcp-server',
      args: [],
      env: { AGENTBBS_DB: '/abs/board.db' },
    });
    for (const name of [
      'agentbbs-check',
      'agentbbs-projects',
      'agentbbs-read',
      'agentbbs-post',
    ] as const) {
      expect(
        readFileSync(skillTarget(projectDir, name), 'utf8'),
        `the owned operator skill ${name} must be installed in the coherent project`,
      ).toContain(`name: ${name}`);
    }
  });
});
