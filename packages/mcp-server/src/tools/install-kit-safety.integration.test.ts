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
 * helper module is uniquely identified by containing `export function applyBlock`. Returns the raw
 * JS source between the fences. Throws loudly if not found (a renamed/removed helper must fail the
 * proof, not silently skip it).
 */
function extractHelperSource(kit: string): string {
  // Match each ```js … ``` fenced block (non-greedy), then pick the one with the helper exports.
  const blocks = [...kit.matchAll(/```js\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const helper = blocks.find(
    (b) =>
      b.includes('export function applyBlock') &&
      b.includes('export function mergeMcpServer'),
  );
  if (!helper) {
    throw new Error(
      `Could not find the kit's helper \`\`\`js block (the one exporting applyBlock + ` +
        `mergeMcpServer) in ${KIT_PATH}. Story 8.4 requires the kit to carry that helper inline.`,
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
  expect(
    typeof applyBlock,
    'the kit helper must export an applyBlock function',
  ).toBe('function');
  expect(
    typeof mergeMcpServer,
    'the kit helper must export a mergeMcpServer function',
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
