// Discoverability drift-guard for the Story 13.2 Shiki serialization fix (Rule 8).
//
// WHY THIS EXISTS — the failure mode this guard catches:
//   Story 13.2 killed the `@shikijs/primitive` full-suite tokenizer flake
//   (deferred-work 9.5/10.5/10.6: `TypeError: …reading 'startIndex'`,
//   RED-under-parallel-load / GREEN-in-isolation) by collecting EVERY test file that
//   tokenizes via the `ui-shared` markdown renderer into ONE serialized Vitest
//   project (`markdown-serial`, `fileParallelism: false`) and EXCLUDING those files
//   from the two parallel projects. The fix is correct ONLY while that list — the
//   `highlighterSuites` array in the root `vitest.config.ts` — stays in sync with the
//   real set of highlighter-using test files. The dangerous, SILENT regression is a
//   NEW test file that mounts the renderer (imports `prewarmHighlighter`,
//   `renderMarkdown`, mounts `RoomApp`, …) but is NOT added to `highlighterSuites`:
//   it would land in a PARALLEL project, tokenize concurrently again, and resurrect
//   the flake — with nothing red until the flake recurs in CI weeks later.
//
//   A one-time empirical "ran each file once" check (the QA collection evidence)
//   cannot catch that future drift; this static guard can, and runs in the default
//   `pnpm test` suite (Rule 8 — discoverable, not opted out).
//
// HOW IT WORKS — pin the config list to the filesystem:
//   1. Import `highlighterSuites` from vitest.highlighter-suites.ts (the single
//      source of truth, also consumed by vitest.config.ts — Rule 10: pin to the
//      actual list, never a hand-copy).
//   2. Statically scan every `*.test.ts(x)` in the repo for a HIGHLIGHTER-TRIGGER
//      signal (an import of a renderer symbol, or a JSX mount of a renderer
//      component). The signal is import/JSX-anchored so a mere PROSE mention of the
//      symbol (like this very comment) does not match.
//   3. Assert the two sets are EQUAL: every triggering file is serialized, and every
//      serialized file actually triggers (no stale entries). A drift in EITHER
//      direction is RED.
//
// This complements (does not replace) the QA empirical collection evidence (each of
// the 12 files runs in exactly `markdown-serial`, never twice, recorded in the
// story). That proved the CURRENT mapping; this guards it FORWARD.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { highlighterSuites } from '../../../../vitest.highlighter-suites.js';

// Repo root = four levels up from packages/ui-shared/src/markdown/.
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

// Directories that can hold renderer-using tests. Scanning these (not node_modules /
// dist) keeps the walk fast and avoids matching built artifacts.
const scanRoots = ['packages', 'apps'];
const skipDirs = new Set([
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '.git',
]);

/** Recursively collect every `*.test.ts` / `*.test.tsx` under `dir`. */
function collectTestFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (skipDirs.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTestFiles(full, out);
    } else if (/\.test\.tsx?$/.test(entry)) {
      // Skip THIS guard file: it deliberately names every renderer symbol in prose
      // (and imports `highlighterSuites`), so it would self-trigger. It does not
      // tokenize, so it correctly belongs in the parallel node project, not the
      // serial one.
      if (entry === 'highlighter-serialization.guard.test.ts') continue;
      out.push(full);
    }
  }
}

// A test file TRIGGERS the highlighter when it imports a renderer symbol OR mounts a
// renderer component in JSX. Anchored to `import`/JSX so a prose/comment mention does
// not false-positive (this guard file mentions all of them in comments yet must NOT
// match itself). The renderer symbols (`prewarmHighlighter`, `renderMarkdown`, …) and
// the renderer components (`MarkdownView`, `CodeBlock`, `RoomView`, `RoomApp`) all
// drive `highlight.ts` → `codeToTokens({ includeExplanation: true })`, the concurrent
// tokenize that flaked.
const IMPORT_TRIGGER =
  /import[\s\S]*?\b(prewarmHighlighter|isHighlighterWarm|highlightToInertHtmlSync|renderMarkdownSync|renderMarkdown)\b[\s\S]*?from/;
const JSX_TRIGGER = /<(MarkdownView|CodeBlock|RoomView|RoomApp)\b/;

function triggersHighlighter(source: string): boolean {
  return IMPORT_TRIGGER.test(source) || JSX_TRIGGER.test(source);
}

/** Normalize to a repo-root-relative POSIX path (matches the config's glob style). */
function toRel(abs: string): string {
  return path.relative(repoRoot, abs).split(path.sep).join('/');
}

describe('Story 13.2 — Shiki serialization discoverability guard (Rule 8)', () => {
  const allTestFiles: string[] = [];
  for (const root of scanRoots) {
    collectTestFiles(path.join(repoRoot, root), allTestFiles);
  }

  const triggering = new Set<string>();
  for (const abs of allTestFiles) {
    const src = readFileSync(abs, 'utf8');
    if (triggersHighlighter(src)) triggering.add(toRel(abs));
  }

  const serialized = new Set(highlighterSuites);

  it('discovered the repo test files (sanity — the scan is not empty)', () => {
    // Guards against a broken walk silently passing the set-equality below.
    expect(allTestFiles.length).toBeGreaterThan(100);
    expect(serialized.size).toBe(12);
  });

  it('every highlighter-using test file is in the serialized markdown-serial project', () => {
    const missing = [...triggering].filter((f) => !serialized.has(f)).sort();
    expect(
      missing,
      `These test files USE the markdown highlighter but are NOT in ` +
        `\`highlighterSuites\` (vitest.highlighter-suites.ts). They would tokenize ` +
        `CONCURRENTLY in a parallel project and can resurrect the Story 13.2 flake. ` +
        `Add them to \`highlighterSuites\`.`,
    ).toEqual([]);
  });

  it('every serialized file actually uses the highlighter (no stale entries)', () => {
    const stale = [...serialized].filter((f) => !triggering.has(f)).sort();
    expect(
      stale,
      `These files are serialized in \`highlighterSuites\` but no longer import/mount ` +
        `the renderer. Remove them so the serial project stays minimal (or fix the ` +
        `path if it was renamed/moved).`,
    ).toEqual([]);
  });

  it('the two sets are exactly equal (config list === highlighter-using files)', () => {
    expect([...serialized].sort()).toEqual([...triggering].sort());
  });
});
