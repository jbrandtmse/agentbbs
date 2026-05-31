// Boundary-enforcement fixture test (Story 1.2, Task 4).
//
// This is the discoverable Vitest test that PROVES the load-bearing import-boundary
// lint rules actually fire — it runs ESLint programmatically (the Node API) against
// inline source snippets and asserts the expected rule IDs are reported. It is the
// Integration-AC verification surface for this internal-tooling story: the gate
// itself is the thing under test.
//
// Co-located `*.test.ts` beside source (project-context.md#Testing); discovered by
// the root vitest.config.ts `projects` glob (Rule 8 — runs in the default suite).

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Repo root = three levels up from packages/core/src/.
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/** A virtual file under packages/core/src so the core-scoped overrides apply. */
const coreFilePath = path.join(repoRoot, 'packages/core/src/__fixture__.ts');
/** A virtual file under packages/data-access/src (better-sqlite3 is allowed there). */
const dataAccessFilePath = path.join(
  repoRoot,
  'packages/data-access/src/__fixture__.ts',
);
/**
 * A virtual file under packages/mcp-server/src — a package that is neither `core`
 * nor `data-access`. Proves the "ANY package other than data-access" half of the
 * better-sqlite3 ban (AC1) fires via the global default rule, not just the
 * core-scoped override.
 */
const mcpServerFilePath = path.join(
  repoRoot,
  'packages/mcp-server/src/__fixture__.ts',
);

function makeESLint(): ESLint {
  // Use the repo's real flat config (single source of truth). No fixes applied.
  return new ESLint({ cwd: repoRoot });
}

async function lint(code: string, filePath: string): Promise<string[]> {
  const eslint = makeESLint();
  const results = await eslint.lintText(code, { filePath });
  return results.flatMap((r) => r.messages.map((m) => m.ruleId ?? '<fatal>'));
}

describe('import-boundary lint enforcement (AC1)', () => {
  it('rejects a better-sqlite3 import from core', async () => {
    const ruleIds = await lint(
      `import 'better-sqlite3';\nexport const x = 1;\n`,
      coreFilePath,
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('rejects a deep cross-package import (bypassing the barrel)', async () => {
    const ruleIds = await lint(
      `import { y } from '@agentbbs/data-access/src/internal/x';\nexport const z = y;\n`,
      coreFilePath,
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('rejects core importing a client/app package', async () => {
    const ruleIds = await lint(
      `import '@agentbbs/mcp-server';\nexport const x = 1;\n`,
      coreFilePath,
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('ALLOWS data-access importing the core barrel (the permitted adapter -> port direction)', async () => {
    // Dependencies flow adapter -> core. data-access legitimately imports the
    // @agentbbs/core barrel (for the DataAccess type, Event shapes, etc.); a
    // non-deep barrel import in that direction must NOT trip the boundary rule.
    const ruleIds = await lint(
      `import { EVENT_TYPES } from '@agentbbs/core';\nexport const x = EVENT_TYPES;\n`,
      dataAccessFilePath,
    );
    expect(ruleIds).not.toContain('no-restricted-imports');
  });

  it('ALLOWS better-sqlite3 in data-access (the one permitted package)', async () => {
    const ruleIds = await lint(
      `import Database from 'better-sqlite3';\nexport const make = () => new Database(':memory:');\n`,
      dataAccessFilePath,
    );
    expect(ruleIds).not.toContain('no-restricted-imports');
  });

  it('rejects better-sqlite3 from a non-core, non-data-access package (the "any package other than data-access" clause)', async () => {
    // mcp-server has no package-scoped override, so this proves the GLOBAL
    // default better-sqlite3 ban fires — not merely the core-scoped one.
    const ruleIds = await lint(
      `import Database from 'better-sqlite3';\nexport const x = Database;\n`,
      mcpServerFilePath,
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });
});

// Story 1.6, AC2 — "core depends only on the port": core imports the DataAccess
// interface from its own ports.ts and NEVER imports @agentbbs/data-access (the
// concrete adapter) or better-sqlite3 directly. These assertions make AC2
// PROVABLY guarded by the lint, not merely incidentally true — if a future change
// relaxes the boundary rule, this fails.
describe('AC2 — core depends only on the DataAccess port (Story 1.6)', () => {
  it('rejects core importing the @agentbbs/data-access adapter barrel', async () => {
    const ruleIds = await lint(
      `import { createDataAccess } from '@agentbbs/data-access';\nexport const x = createDataAccess;\n`,
      coreFilePath,
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('rejects core importing a deep path into @agentbbs/data-access', async () => {
    const ruleIds = await lint(
      `import { rowToEvent } from '@agentbbs/data-access/src/mapping';\nexport const x = rowToEvent;\n`,
      coreFilePath,
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('rejects core importing better-sqlite3 directly', async () => {
    const ruleIds = await lint(
      `import Database from 'better-sqlite3';\nexport const x = Database;\n`,
      coreFilePath,
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('ALLOWS core importing its own DataAccess port (the only persistence dependency)', async () => {
    // The permitted shape: core depends on its OWN ports.ts, a relative import
    // within the package — never on the adapter package. This proves the guard
    // does not over-reach and ban core's legitimate self-import.
    const ruleIds = await lint(
      `import type { DataAccess } from './ports.js';\nexport type X = DataAccess;\n`,
      coreFilePath,
    );
    expect(ruleIds).not.toContain('no-restricted-imports');
  });
});

describe('append-invariant lint guard (AC2)', () => {
  it('flags UPDATE against the events ledger in data-access', async () => {
    const ruleIds = await lint(
      `export const sql = 'UPDATE events SET payload = ? WHERE seq = ?';\n`,
      dataAccessFilePath,
    );
    expect(ruleIds).toContain('no-restricted-syntax');
  });

  it('flags DELETE against the events ledger in data-access', async () => {
    const ruleIds = await lint(
      `export const sql = 'DELETE FROM events WHERE seq = ?';\n`,
      dataAccessFilePath,
    );
    expect(ruleIds).toContain('no-restricted-syntax');
  });

  it('flags ORDER BY created_at in data-access', async () => {
    const ruleIds = await lint(
      `export const sql = 'SELECT * FROM events ORDER BY created_at DESC';\n`,
      dataAccessFilePath,
    );
    expect(ruleIds).toContain('no-restricted-syntax');
  });

  it('ALLOWS ORDER BY seq (the correct ordering)', async () => {
    const ruleIds = await lint(
      `export const sql = 'SELECT * FROM events ORDER BY seq DESC';\n`,
      dataAccessFilePath,
    );
    expect(ruleIds).not.toContain('no-restricted-syntax');
  });

  it('flags UPDATE events inside a TEMPLATE literal (not just a plain string)', async () => {
    // The config has a separate TemplateElement selector; the plain-string tests
    // above do not exercise it. SQL is commonly built with template literals.
    const ruleIds = await lint(
      'export const sql = `UPDATE events SET payload = ${p} WHERE seq = ${s}`;\n',
      dataAccessFilePath,
    );
    expect(ruleIds).toContain('no-restricted-syntax');
  });
});

describe('naming lint enforcement (AC1)', () => {
  it('flags a non-kebab-case .ts filename', async () => {
    const ruleIds = await lint(
      `export const x = 1;\n`,
      path.join(repoRoot, 'packages/core/src/BadName.ts'),
    );
    expect(ruleIds).toContain('unicorn/filename-case');
  });

  it('flags a default export from a .ts file', async () => {
    const ruleIds = await lint(
      `const x = 1;\nexport default x;\n`,
      coreFilePath,
    );
    expect(ruleIds).toContain('import-x/no-default-export');
  });

  it('flags a non-PascalCase .tsx component filename', async () => {
    // The .tsx override switches filename-case to pascalCase; kebab-case .tsx
    // (valid for .ts) must be rejected for components.
    const ruleIds = await lint(
      `export const Widget = () => null;\n`,
      path.join(repoRoot, 'packages/ui-shared/src/my-widget.tsx'),
    );
    expect(ruleIds).toContain('unicorn/filename-case');
  });

  it('ALLOWS a default export from a PascalCase .tsx (the React-component exception)', async () => {
    // AC1: "rejects default exports EXCEPT for React components." Proves the
    // .tsx override (default-export allowed + PascalCase filename) does not
    // false-positive.
    const ruleIds = await lint(
      `const Widget = () => null;\nexport default Widget;\n`,
      path.join(repoRoot, 'packages/ui-shared/src/MyWidget.tsx'),
    );
    expect(ruleIds).not.toContain('import-x/no-default-export');
    expect(ruleIds).not.toContain('unicorn/filename-case');
  });
});
