// DB path discovery (Story 1.4, AC1) — AR6.
//
// Resolves where the single SQLite ledger lives. Order:
//   1. `AGENTBBS_DB` env var, if set and non-empty → use it VERBATIM (override).
//      The caller is fully responsible for that path (it may be `:memory:`, an
//      absolute path, or a relative one); we do not reinterpret it.
//   2. Otherwise discover the project root by walking UP from a starting dir
//      (CWD by default) and use `<project-root>/.agentbbs/agentbbs.db`.
//
// PROJECT-ROOT RULE (documented per Task 2): walking up from the start dir, the
// first directory that satisfies ANY marker below is the project root, checked in
// this priority:
//   (a) an existing `.agentbbs/` directory  — an already-initialised ledger wins,
//       so a nested CWD reuses the established DB rather than creating a new one;
//   (b) a `pnpm-workspace.yaml` file         — the workspace root (this repo);
//   (c) a `.git` directory or file           — the repository root fallback.
// If no marker is found up to the filesystem root, fall back to the START dir
// (never the filesystem root) so a stray invocation creates `.agentbbs/` locally
// rather than at `/`.
//
// This module is PURE path resolution: it reads env + the filesystem for markers
// but opens no database. The starting dir and env are injectable for tests.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The fixed ledger directory + filename under the project root (AR6). */
export const AGENTBBS_DIR = '.agentbbs';
/** The fixed ledger filename (AR6). */
export const DB_FILENAME = 'agentbbs.db';
/** The env var that overrides discovery with a verbatim path. */
export const DB_PATH_ENV = 'AGENTBBS_DB';

/** Options for {@link resolveDbPath}; both injectable for deterministic tests. */
export interface ResolveDbPathOptions {
  /** Directory to begin the walk-up from. Defaults to `process.cwd()`. */
  startDir?: string;
  /** Environment to read the override from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Find the project root by walking up from `startDir`. Returns the first dir
 * matching a marker (existing `.agentbbs/`, then `pnpm-workspace.yaml`, then
 * `.git`), or `startDir` itself if no marker is found before the filesystem root.
 */
export function findProjectRoot(startDir: string): string {
  let current = resolve(startDir);

  for (;;) {
    if (isDir(join(current, AGENTBBS_DIR))) return current;
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    if (existsSync(join(current, '.git'))) return current;

    const parent = dirname(current);
    if (parent === current) break; // reached the filesystem root
    current = parent;
  }

  return resolve(startDir);
}

/**
 * Resolve the absolute path to the SQLite ledger.
 *
 * - If `AGENTBBS_DB` is set to a non-empty value, returns it verbatim (the
 *   override; the directory, if any, is NOT created here — the caller owns it).
 * - Otherwise returns `<project-root>/.agentbbs/agentbbs.db`.
 *
 * This function does not create directories; use {@link ensureDbDirectory} to
 * create `.agentbbs/` on first run before opening the database.
 */
export function resolveDbPath(options: ResolveDbPathOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env[DB_PATH_ENV];
  if (override !== undefined && override.length > 0) {
    return override;
  }

  const startDir = options.startDir ?? process.cwd();
  const root = findProjectRoot(startDir);
  return join(root, AGENTBBS_DIR, DB_FILENAME);
}

/**
 * Ensure the parent directory of `dbPath` exists (recursive mkdir), creating
 * `.agentbbs/` on first run. No-op for in-memory databases (`:memory:`) and for
 * any path whose parent already exists. Returns the directory that now exists.
 */
export function ensureDbDirectory(dbPath: string): string {
  if (dbPath === ':memory:') return dbPath;
  const dir = dirname(dbPath);
  mkdirSync(dir, { recursive: true });
  return dir;
}
