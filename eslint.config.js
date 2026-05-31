// Root ESLint flat config (ESLint 10, the current-supported format).
//
// Story 1.2 — the load-bearing enforcement layer. The architecture.md mention of
// `.eslintrc.cjs` is descriptive of an earlier era; ESLint 9 removed eslintrc as
// the default and ESLint 10 ships flat config (`eslint.config.js`) as the only
// built-in format, so this story uses flat config and documents the choice
// (verified against the installed eslint@10 + typescript-eslint@8 package APIs,
// 2026-05-30).
//
// This is the SINGLE root ESLint config; packages do NOT define their own. Run
// from the repo root via `pnpm lint` (`eslint .`).
//
// What it enforces (all load-bearing, per project-context.md + architecture.md):
//   1. Module boundaries (NFR2): `core` imports nothing from clients or
//      better-sqlite3; only `data-access` imports better-sqlite3; cross-package
//      imports hit the `@agentbbs/<x>` barrel only — never a deep path.
//   2. Naming: source files kebab-case.ts; React components PascalCase.tsx;
//      no default exports except React components (.tsx).
//   3. THE APPEND INVARIANT guard (lint-where-feasible): flags UPDATE/DELETE
//      against the ledger, persisted-derived-state column names, and ordering by
//      created_at, in data-access/core. See docs/append-invariant-checklist.md
//      for the human-review half.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Deep-import / forbidden-package patterns shared by the boundary rules.
 * `no-restricted-imports` is resolver-free and deterministic — it matches the
 * import *specifier string*, which is exactly what the barrel-only and
 * better-sqlite3 rules need (we never need to resolve to a file on disk).
 */
const NO_DEEP_CROSS_PACKAGE = {
  group: ['@agentbbs/*/*'],
  message:
    'Cross-package imports must target the package barrel (@agentbbs/<x>), never a deep path. Re-export from the package index.ts.',
};

const NO_BETTER_SQLITE3 = {
  group: ['better-sqlite3', 'better-sqlite3/*'],
  message:
    'Only @agentbbs/data-access may import better-sqlite3 (NFR2 swap seam). core and clients must depend on the DataAccess port instead.',
};

const NO_CLIENT_FROM_CORE = {
  group: [
    // data-access is the concrete storage ADAPTER behind the DataAccess port
    // (Story 1.6, AC2): core depends ONLY on its own `ports.ts` interface, never
    // on the adapter. Banning the barrel (not just `better-sqlite3`) makes AC2
    // provably enforced rather than incidentally true.
    '@agentbbs/data-access',
    '@agentbbs/data-access/*',
    '@agentbbs/mcp-server',
    '@agentbbs/mcp-server/*',
    '@agentbbs/cli',
    '@agentbbs/cli/*',
    '@agentbbs/ui-shared',
    '@agentbbs/ui-shared/*',
    '@agentbbs/web',
    '@agentbbs/web/*',
    '@agentbbs/vscode-extension',
    '@agentbbs/vscode-extension/*',
  ],
  message:
    'core must not import from any client/app package OR from @agentbbs/data-access (the concrete storage adapter). core depends only on its own ports (the DataAccess interface); dependencies flow client/adapter -> core, never the reverse.',
};

/**
 * THE APPEND INVARIANT — lint-caught half (AC2). These flag the most common
 * mechanical violations in SQL string literals and TS. The human-review half
 * lives in docs/append-invariant-checklist.md. Scoped to data-access + core,
 * where SQL and the event model live (data-access SQL lands in Story 1.4; the
 * guard is in place beforehand by design).
 */
const APPEND_INVARIANT_RESTRICTED_SYNTAX = [
  {
    // UPDATE / DELETE targeting the events ledger.
    selector: 'Literal[value=/(?:UPDATE\\s+events|DELETE\\s+FROM\\s+events)/i]',
    message:
      'THE APPEND INVARIANT: no UPDATE/DELETE against the events ledger — every state change is an appended event via dataAccess.append.',
  },
  {
    // ORDER BY created_at — ordering must always be by seq.
    selector: 'Literal[value=/ORDER\\s+BY\\s+created_at/i]',
    message:
      'THE APPEND INVARIANT: order by seq, never created_at (created_at is display-only ISO-8601 text).',
  },
  {
    // Template-literal SQL equivalents of the two patterns above.
    selector:
      'TemplateElement[value.cooked=/(?:UPDATE\\s+events|DELETE\\s+FROM\\s+events|ORDER\\s+BY\\s+created_at)/i]',
    message:
      'THE APPEND INVARIANT: no UPDATE/DELETE against events and never ORDER BY created_at (use seq). See docs/append-invariant-checklist.md.',
  },
];

export default tseslint.config(
  // 0. Global ignores (flat-config: a config object with only `ignores`).
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'coverage/**',
      // Non-code BMad assets and planning artifacts are not linted.
      '_bmad/**',
      '_bmad-output/**',
      'integration/**',
      'docs/**',
    ],
  },

  // 1. Base recommended JS + TS (non-type-checked: fast, no project graph needed
  //    for this enforcement-only story; type-aware rules can be layered later).
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 2. Plugins + language options for all TS/TSX source.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'import-x': importX,
      unicorn,
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Naming: source files kebab-case (.ts) — .tsx handled in override below.
      'unicorn/filename-case': [
        'error',
        { case: 'kebabCase', ignore: [/\.config\.js$/u] },
      ],
      // No default exports (barrels re-export named; React .tsx overridden below).
      'import-x/no-default-export': 'error',
      // Barrel-only cross-package imports: forbid deep paths INTO @agentbbs/* AND
      // forbid better-sqlite3 everywhere by default (data-access re-enables it).
      'no-restricted-imports': [
        'error',
        { patterns: [NO_DEEP_CROSS_PACKAGE, NO_BETTER_SQLITE3] },
      ],
    },
  },

  // 3. React components: PascalCase.tsx, one per file, default export allowed.
  {
    files: ['**/*.tsx'],
    rules: {
      'unicorn/filename-case': ['error', { case: 'pascalCase' }],
      'import-x/no-default-export': 'off',
    },
  },

  // 4. `core` boundary: must not import clients/apps OR better-sqlite3.
  {
    files: ['packages/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            NO_DEEP_CROSS_PACKAGE,
            NO_BETTER_SQLITE3,
            NO_CLIENT_FROM_CORE,
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...APPEND_INVARIANT_RESTRICTED_SYNTAX],
    },
  },

  // 5. `data-access`: the ONE package allowed to import better-sqlite3, so the
  //    default better-sqlite3 ban is relaxed here (deep-path ban still applies).
  //    The append-invariant SQL guard is most relevant here (SQL lands in 1.4).
  {
    files: ['packages/data-access/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [NO_DEEP_CROSS_PACKAGE] }],
      'no-restricted-syntax': ['error', ...APPEND_INVARIANT_RESTRICTED_SYNTAX],
    },
  },

  // 6. Test files. The boundary-enforcement fixture test embeds forbidden SQL
  //    and import specifiers AS STRING LITERALS to assert the rules fire. The
  //    no-restricted-imports rule only matches real import statements, so it
  //    needs no relaxation — but the append-invariant no-restricted-syntax guard
  //    matches string/template literals by design, so it WOULD flag the fixture
  //    strings. Disable that guard in test files only; the rule's real coverage
  //    is over production core/data-access source, which tests are not.
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // 7. Config files (eslint.config.js, vitest.config.ts, *.config.*) are tool
  //    entry points whose contract is a DEFAULT export — exempt them from the
  //    no-default-export rule. They are not package source.
  {
    files: ['**/*.config.{js,ts,mts,cts}', 'eslint.config.js'],
    rules: {
      'import-x/no-default-export': 'off',
    },
  },

  // 8. Prettier compatibility — MUST be last so it disables conflicting
  //    stylistic rules.
  prettier,
);
