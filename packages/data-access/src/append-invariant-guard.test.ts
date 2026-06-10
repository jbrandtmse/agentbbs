// Append-invariant TEST-FILE lint-guard behavior test (Story 13.4, AC2; QA stage).
//
// Story 13.4 re-enabled the append-invariant ESLint guard in `*.test.ts` files via
// the AST-based `APPEND_INVARIANT_TEST_FILE_SYNTAX` block (eslint.config.js block 6),
// replacing the prior `no-restricted-syntax: 'off'`. The dev verified the new guard
// empirically with a throwaway `eslint.Linter` probe that was REMOVED after use — so
// the guarantee had no DURABLE regression test. This file makes it durable: it runs
// the repo's REAL flat config (single source of truth, via the ESLint Node API) over
// inline `*.test.ts` snippets and asserts the AST guard fires on a genuine executed
// ledger-mutation bypass while permitting the boundary-fixture assertion strings and
// the permitted append-only / seq-ordered queries.
//
// Mirrors packages/core/src/boundary-enforcement.test.ts (same `ESLint.lintText`
// against a virtual file path so the path-scoped flat-config overrides apply).
// Co-located `*.test.ts`; discovered by the root vitest.config.ts projects glob
// (Rule 8 — runs in the default suite).
//
// WHY a virtual *.test.ts path: block 6 (`files: ['**/*.test.{ts,tsx}']`) is the
// only block that applies the AST `APPEND_INVARIANT_TEST_FILE_SYNTAX`. Linting a
// virtual `…/foo.test.ts` path makes ESLint apply block 6, exercising the EXACT rule
// re-enabled by this story. A data-access `*.test.ts` matches BOTH block 5 (the
// production bare-literal guard) and block 6 (the AST test guard); flat-config
// last-wins means block 6's rule definition is the active one — confirmed
// empirically here (a bare `const sql = 'UPDATE events …'` in a data-access test
// path does NOT fire, which only the AST guard permits; the bare-literal block-5
// guard would have flagged it).

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/** Generous per-test timeout for ESLint cold-compile headroom (mirrors 3.0). */
const ESLINT_TEST_TIMEOUT_MS = 30_000;

// Repo root = three levels up from packages/data-access/src/.
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/**
 * Virtual `*.test.ts` paths so block 6 (the AST test-file guard) applies. One under
 * `data-access/src` (also matches block 5 — proves the AST guard WINS over the
 * production bare-literal guard for test files) and one under `core/src` (a package
 * scoped only by the global test block) so the guard is shown to apply repo-wide,
 * not just where the production SQL guard already lives.
 */
const dataAccessTestPath = path.join(
  repoRoot,
  'packages/data-access/src/append-invariant-guard.fixture.test.ts',
);
const coreTestPath = path.join(
  repoRoot,
  'packages/core/src/append-invariant-guard.fixture.test.ts',
);

// A single shared ESLint instance, compiled once (Story 3.0 cold-start fix).
let sharedESLint: ESLint | undefined;

beforeAll(() => {
  sharedESLint = new ESLint({ cwd: repoRoot });
});

/** Return the rule IDs reported by the repo's real flat config for `code` at `filePath`. */
async function lint(code: string, filePath: string): Promise<string[]> {
  if (!sharedESLint) {
    throw new Error('append-invariant-guard: shared ESLint not initialized');
  }
  const results = await sharedESLint.lintText(code, { filePath });
  return results.flatMap((r) => r.messages.map((m) => m.ruleId ?? '<fatal>'));
}

describe(
  'append-invariant test-file guard — FIRES on an executed ledger-mutation bypass (AC2)',
  { timeout: ESLINT_TEST_TIMEOUT_MS },
  () => {
    it('flags an EXECUTED UPDATE events via .prepare(...).run() (string literal)', async () => {
      const ruleIds = await lint(
        "const db = {};\ndb.prepare('UPDATE events SET payload = ? WHERE seq = ?').run('p', 1);\n",
        dataAccessTestPath,
      );
      expect(ruleIds).toContain('no-restricted-syntax');
    });

    it('flags an EXECUTED DELETE FROM events via .exec(...)', async () => {
      const ruleIds = await lint(
        "const db = {};\ndb.exec('DELETE FROM events WHERE seq = 1');\n",
        dataAccessTestPath,
      );
      expect(ruleIds).toContain('no-restricted-syntax');
    });

    it('flags an EXECUTED ORDER BY created_at via .prepare(...).all()', async () => {
      const ruleIds = await lint(
        "const db = {};\ndb.prepare('SELECT * FROM events ORDER BY created_at ASC').all();\n",
        dataAccessTestPath,
      );
      expect(ruleIds).toContain('no-restricted-syntax');
    });

    // Rule-18 call-form blind spot: the guard must catch the forbidden SQL in BOTH
    // a plain string literal (above) AND a TEMPLATE literal passed to .prepare —
    // a separate TemplateElement selector. SQL is commonly built with templates.
    it('flags an EXECUTED UPDATE events inside a TEMPLATE literal (.prepare`...`-arg)', async () => {
      const ruleIds = await lint(
        'const db = {}; const p = 1, s = 2;\n' +
          'db.prepare(`UPDATE events SET payload = ${p} WHERE seq = ${s}`).run();\n',
        dataAccessTestPath,
      );
      expect(ruleIds).toContain('no-restricted-syntax');
    });

    it('flags an EXECUTED DELETE FROM events inside a TEMPLATE literal', async () => {
      const ruleIds = await lint(
        'const db = {}; const s = 1;\n' +
          'db.prepare(`DELETE FROM events WHERE seq = ${s}`).run();\n',
        dataAccessTestPath,
      );
      expect(ruleIds).toContain('no-restricted-syntax');
    });

    it('fires repo-wide — also flags an executed UPDATE in a CORE test file path', async () => {
      const ruleIds = await lint(
        "const db = {};\ndb.prepare('UPDATE events SET x = 1').run();\n",
        coreTestPath,
      );
      expect(ruleIds).toContain('no-restricted-syntax');
    });
  },
);

describe(
  'append-invariant test-file guard — does NOT false-positive on legit test code (AC2)',
  { timeout: ESLINT_TEST_TIMEOUT_MS },
  () => {
    // The boundary-enforcement fixture embeds forbidden SQL as BARE ASSERTION
    // STRINGS (never executed) to prove the PRODUCTION rule fires. The AST guard
    // must permit them — they are not arguments to a query call. (This is the exact
    // case that forced the old `no-restricted-syntax: 'off'`; the AST guard fixes it.)
    it('PERMITS a bare `const sql = "UPDATE events …"` assertion string (not executed)', async () => {
      const ruleIds = await lint(
        "export const sql = 'UPDATE events SET payload = ? WHERE seq = ?';\n",
        dataAccessTestPath,
      );
      expect(ruleIds).not.toContain('no-restricted-syntax');
    });

    it('PERMITS a bare `const sql = "DELETE FROM events …"` assertion string', async () => {
      const ruleIds = await lint(
        "export const sql = 'DELETE FROM events WHERE seq = ?';\n",
        dataAccessTestPath,
      );
      expect(ruleIds).not.toContain('no-restricted-syntax');
    });

    it('PERMITS a bare `const sql = "… ORDER BY created_at …"` assertion string', async () => {
      const ruleIds = await lint(
        "export const sql = 'SELECT * FROM events ORDER BY created_at DESC';\n",
        dataAccessTestPath,
      );
      expect(ruleIds).not.toContain('no-restricted-syntax');
    });

    // INSERT is exactly how `append` writes — append-only PERMITS inserts (the
    // Rule-8 reconciliation: the invariant is no UPDATE/DELETE + no created_at
    // order-key, NOT "no raw INSERT"). The two proof tests' controlled-created_at
    // INSERTs rely on this.
    it('PERMITS an EXECUTED INSERT INTO events (append-only permits inserts)', async () => {
      const ruleIds = await lint(
        "const db = {};\ndb.prepare('INSERT INTO events (type, actor, created_at, payload) VALUES (?, ?, ?, ?)').run('t', 'a', 'c', 'p');\n",
        dataAccessTestPath,
      );
      expect(ruleIds).not.toContain('no-restricted-syntax');
    });

    it('PERMITS an EXECUTED SELECT … ORDER BY seq (the correct ordering key)', async () => {
      const ruleIds = await lint(
        "const db = {};\ndb.prepare('SELECT actor FROM events ORDER BY seq ASC').all();\n",
        dataAccessTestPath,
      );
      expect(ruleIds).not.toContain('no-restricted-syntax');
    });

    it('PERMITS the documented ORDER BY created_at PROOF SELECT under its justified eslint-disable carve-out', async () => {
      // This mirrors append.qa.test.ts's load-bearing seq≠created_at proof: an
      // executed `ORDER BY created_at` wrapped in the position-stable scoped disable.
      // Without the carve-out it would (correctly) fire; with it, it is permitted —
      // proving the documented carve-out is the ONLY way to execute this query.
      const ruleIds = await lint(
        'const db = {};\n' +
          '/* eslint-disable no-restricted-syntax */\n' +
          "db.prepare('SELECT actor FROM events ORDER BY created_at ASC').all();\n" +
          '/* eslint-enable no-restricted-syntax */\n',
        dataAccessTestPath,
      );
      expect(ruleIds).not.toContain('no-restricted-syntax');
    });
  },
);
