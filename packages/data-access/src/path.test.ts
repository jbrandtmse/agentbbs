// DB path discovery tests (Story 1.4, AC1) — real filesystem in OS temp dirs.
//
// Never touches the repo's real `.agentbbs/`: every test builds its own temp
// tree under `os.tmpdir()` and removes it afterward. Discovery is exercised by
// injecting `startDir` / `env`, so no DB is opened here.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AGENTBBS_DIR,
  DB_FILENAME,
  DB_PATH_ENV,
  ensureDbDirectory,
  findProjectRoot,
  resolveDbPath,
} from './path.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentbbs-path-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveDbPath — AGENTBBS_DB override (AC1)', () => {
  it('uses the env override verbatim and ignores walk-up', () => {
    const override = join(root, 'custom', 'elsewhere.db');
    const resolved = resolveDbPath({
      env: { [DB_PATH_ENV]: override },
      startDir: root,
    });
    expect(resolved).toBe(override);
  });

  it('ignores an empty override and falls back to discovery', () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    const resolved = resolveDbPath({
      env: { [DB_PATH_ENV]: '' },
      startDir: root,
    });
    expect(resolved).toBe(join(root, AGENTBBS_DIR, DB_FILENAME));
  });
});

describe('resolveDbPath — walk-up discovery (AC1)', () => {
  it('resolves to <project-root>/.agentbbs/agentbbs.db at a pnpm-workspace.yaml marker', () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    const nested = join(root, 'packages', 'data-access', 'src');
    mkdirSync(nested, { recursive: true });

    const resolved = resolveDbPath({ env: {}, startDir: nested });
    expect(resolved).toBe(join(root, AGENTBBS_DIR, DB_FILENAME));
  });

  it('walks up to a .git marker when no workspace file exists', () => {
    mkdirSync(join(root, '.git'), { recursive: true });
    const nested = join(root, 'a', 'b');
    mkdirSync(nested, { recursive: true });

    // stopDir bounds the walk at the temp root so a marker in a real ancestor
    // (e.g. a user-level ~/.agentbbs above os.tmpdir()) can't shadow this case.
    expect(findProjectRoot(nested, { stopDir: root })).toBe(root);
  });

  it('prefers an existing .agentbbs/ over higher-up markers', () => {
    // Outer workspace marker, inner already-initialised ledger dir.
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    const inner = join(root, 'sub');
    mkdirSync(join(inner, AGENTBBS_DIR), { recursive: true });

    const resolved = resolveDbPath({ env: {}, startDir: inner });
    expect(resolved).toBe(join(inner, AGENTBBS_DIR, DB_FILENAME));
  });

  it('falls back to the start dir when no marker is found', () => {
    const lonely = join(root, 'no', 'markers', 'here');
    mkdirSync(lonely, { recursive: true });
    // No marker within [lonely, root]; stopDir bounds the walk at the temp root
    // so it cannot escape to a real ancestor marker (e.g. a user-level
    // ~/.agentbbs above os.tmpdir()) and must fall back to the start dir.
    expect(findProjectRoot(lonely, { stopDir: root })).toBe(lonely);
  });

  it('does not search above stopDir — a marker in an ancestor is ignored', () => {
    // Marker sits ABOVE the boundary; the walk must stop at stopDir and fall
    // back to the start dir rather than discovering the higher-up marker.
    mkdirSync(join(root, '.git'), { recursive: true });
    const boundary = join(root, 'project');
    const nested = join(boundary, 'a', 'b');
    mkdirSync(nested, { recursive: true });

    expect(findProjectRoot(nested, { stopDir: boundary })).toBe(nested);
    // Without the boundary it would find root's .git (sanity check).
    expect(findProjectRoot(nested)).toBe(root);
  });
});

describe('ensureDbDirectory — .agentbbs/ created on first run (AC1)', () => {
  it('creates the parent directory recursively when absent', () => {
    const dbPath = join(root, 'fresh', AGENTBBS_DIR, DB_FILENAME);
    expect(existsSync(join(root, 'fresh', AGENTBBS_DIR))).toBe(false);

    const dir = ensureDbDirectory(dbPath);
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(root, 'fresh', AGENTBBS_DIR));
  });

  it('is a no-op for :memory:', () => {
    expect(ensureDbDirectory(':memory:')).toBe(':memory:');
  });
});
