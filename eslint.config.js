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
  // ui-shared deliberately PUBLISHES CSS assets as `exports` subpaths
  // (`./tokens.css`, `./markdown.css`) — they are intended public entry points a
  // consumer imports as a side-effecting stylesheet (Story 9.1), NOT internal TS
  // deep paths. The barrel-only rule targets reaching into another package's TS
  // internals; a declared asset subpath is the package's public API, so those exact
  // specifiers are NEGATED out of the ban here (Story 9.3, apps/web's first
  // consumption of tokens.css). A negation glob in `group` is the minimatch-supported
  // way to exempt specific specifiers from a broader pattern.
  group: [
    '@agentbbs/*/*',
    '!@agentbbs/ui-shared/tokens.css',
    '!@agentbbs/ui-shared/markdown.css',
    '!@agentbbs/ui-shared/room.css',
    '!@agentbbs/ui-shared/chrome.css',
  ],
  message:
    "Cross-package imports must target the package barrel (@agentbbs/<x>) — except a package's PUBLISHED asset subpath (e.g. @agentbbs/ui-shared/tokens.css). Never reach a deep TS path; re-export from index.ts.",
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
    // The VS Code extension package is named UNSCOPED (`agentbbs-vscode-extension`) because
    // `vsce package` rejects npm-style scoped names (Story 11.5, AC3, verified empirically).
    'agentbbs-vscode-extension',
    'agentbbs-vscode-extension/*',
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

/**
 * THE APPEND INVARIANT — test-file half (Story 13.4, AC2; closes deferred-work 1.5).
 *
 * The PRODUCTION guard above (blocks 4/5) is a bare-LITERAL regex: it flags any
 * string/template literal containing forbidden SQL — correct for production source,
 * where every such literal IS an executed query. It cannot run in `*.test.ts` (block
 * 6 was `no-restricted-syntax: 'off'`) for two reasons the bare-literal regex cannot
 * tell apart from a real violation:
 *   1. `packages/core/src/boundary-enforcement.test.ts` embeds forbidden SQL as bare
 *      ASSERTION STRINGS (`const sql = 'UPDATE events …'`) — never executed; they are
 *      the inputs that PROVE the production rule fires. A literal regex flags them.
 *   2. `packages/data-access/src/sqlite/append.qa.test.ts` runs a documented PROOF
 *      `SELECT … ORDER BY created_at` to demonstrate seq-ordering ≠ created_at-ordering
 *      — load-bearing; it cannot move to `append` (which stamps created_at).
 *
 * Reconciliation (Rule 8): the SHIPPED invariant is append-only = NO UPDATE/DELETE of
 * the ledger + never ORDER BY created_at AS AN ORDER KEY. A raw INSERT is exactly how
 * `append` writes, so INSERT is NOT a violation (the production guard never flagged it).
 * So instead of the literal regex, the test-file guard is AST-BASED: it flags forbidden
 * SQL ONLY when that SQL is an ARGUMENT to an EXECUTED query call
 * (`db.prepare/.exec/.run/.pragma(...)`). This:
 *   - FIRES on a genuine ledger-mutation bypass in a test (a real `.prepare('UPDATE
 *     events …').run()`), so the invariant is enforced in tests too;
 *   - PERMITS the boundary-enforcement assertion STRINGS (bare `const sql = '…'`, not a
 *     query-call argument) — they are not executed;
 *   - PERMITS the one documented ordering-PROOF SELECT via a narrow, JUSTIFIED
 *     `eslint-disable-next-line` carve-out on that exact line (the only legitimately
 *     executed `ORDER BY created_at` in the whole repo).
 *
 * Selectors VERIFIED against installed eslint@10 + typescript-eslint@8 (esquery
 * descendant + regex-attribute matching), 2026-06-10. The Literal forms use the `>`
 * direct-child combinator (the SQL string is the call's direct argument); the
 * TemplateElement form uses the descendant combinator (the template literal nests a
 * TemplateLiteral between the call and its TemplateElements).
 */
const APPEND_INVARIANT_TEST_FILE_SYNTAX = [
  {
    // EXECUTED UPDATE/DELETE: a forbidden SQL string passed directly to a
    // better-sqlite3 / node:sqlite query call. A bare `const sql = 'UPDATE …'`
    // (the boundary-enforcement fixture's assertion strings) is NOT a call
    // argument, so it is permitted.
    selector:
      'CallExpression[callee.property.name=/^(?:prepare|exec|run|pragma)$/] > Literal[value=/(?:UPDATE\\s+events|DELETE\\s+FROM\\s+events)/i]',
    message:
      'THE APPEND INVARIANT (tests): no EXECUTED UPDATE/DELETE against the events ledger — append every state change via dataAccess.append.',
  },
  {
    // EXECUTED ORDER BY created_at: created_at is display-only, never an order key.
    // The one documented proof SELECT (append.qa.test.ts) carries a justified
    // scoped disable directive (see that file).
    selector:
      'CallExpression[callee.property.name=/^(?:prepare|exec|run|pragma)$/] > Literal[value=/ORDER\\s+BY\\s+created_at/i]',
    message:
      'THE APPEND INVARIANT (tests): order by seq, never created_at (display-only). The one documented seq≠created_at proof SELECT carries a justified eslint-disable.',
  },
  {
    // Template-literal SQL equivalents passed to an executed query call.
    selector:
      'CallExpression[callee.property.name=/^(?:prepare|exec|run|pragma)$/] TemplateElement[value.cooked=/(?:UPDATE\\s+events|DELETE\\s+FROM\\s+events|ORDER\\s+BY\\s+created_at)/i]',
    message:
      'THE APPEND INVARIANT (tests): no EXECUTED UPDATE/DELETE against events and never ORDER BY created_at (use seq). See docs/append-invariant-checklist.md.',
  },
];

export default tseslint.config(
  // 0. Global ignores (flat-config: a config object with only `ignores`).
  {
    ignores: [
      '**/dist/**',
      // The web client copied into the cli package for npm distribution (Story 11.5, AC2) —
      // a built artifact (apps/web/dist), never linted as source.
      '**/web-dist/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'coverage/**',
      // Downloaded VS Code builds for the @vscode/test-electron real-host harness
      // (Story 10.2). These contain VS Code's OWN source + many tsconfig.json files
      // which otherwise confuse the tseslint parser (multiple candidate TSConfigRootDirs)
      // and are not project code. Never lint them.
      '**/.vscode-test/**',
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
      // `BoardTreeProvider.ts` is the architecture.md-committed name for the native VS Code
      // `TreeDataProvider` class module (architecture.md l.558–560; Story 10.3) — a
      // class-per-file convention like a React component, so it is ignored by the kebab rule
      // (mirrors how `.config.js` / `main.tsx` are ignored). The vscode-free logic
      // (tree-model / decoration-model / room-uri / operator-handle) stays kebab-case.
      'unicorn/filename-case': [
        'error',
        {
          case: 'kebabCase',
          ignore: [/\.config\.js$/u, /^BoardTreeProvider\.ts$/u],
        },
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
  //    `main.tsx` is the conventional Vite/React APP ENTRY filename (lowercase) — it
  //    mounts the root, it is not a component module — so it is ignored by the
  //    PascalCase rule (mirrors how `.config.js` is ignored above). Story 9.3.
  //    `compose-main.tsx` (Story 10.7) is the SECOND webview ENTRY POINT (the compose
  //    bundle) — same role as `main.tsx` (mounts the root, not a component module), so
  //    it is ignored on the same grounds.
  {
    files: ['**/*.tsx'],
    rules: {
      'unicorn/filename-case': [
        'error',
        {
          case: 'pascalCase',
          ignore: [/^main\.tsx$/u, /^compose-main\.tsx$/u],
        },
      ],
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

  // 6. Test files. The append invariant is now ENFORCED in tests too (Story 13.4,
  //    AC2; closes deferred-work 1.5) — but via the AST-based
  //    APPEND_INVARIANT_TEST_FILE_SYNTAX guard, NOT the production bare-literal
  //    regex. The AST guard flags forbidden SQL only when it is an ARGUMENT to an
  //    EXECUTED query call (db.prepare/.exec/.run/.pragma), so it:
  //      - FIRES on a real ledger-mutation bypass in a test;
  //      - PERMITS boundary-enforcement.test.ts's bare ASSERTION STRINGS
  //        (`const sql = 'UPDATE events …'`, never executed — the inputs that
  //        prove the PRODUCTION rule in blocks 4/5 fires);
  //      - PERMITS the one documented ordering-PROOF `ORDER BY created_at` SELECT
  //        in append.qa.test.ts via a narrow justified eslint-disable on that line.
  //    The no-restricted-imports rule only matches real import statements, so the
  //    boundary fixture's import-specifier strings still need no relaxation.
  //    (Previously this block disabled no-restricted-syntax entirely, because the
  //    production literal regex could not tell the fixture/proof strings from a
  //    real violation; the AST guard resolves exactly that.)
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...APPEND_INVARIANT_TEST_FILE_SYNTAX],
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

  // 7b. Plain-JS build/tool scripts (e.g. apps/vscode-extension/esbuild.js, Story
  //     10.1) run under Node and use node globals (process, console). They are NOT
  //     package source and are not covered by the TS block's languageOptions, so the
  //     base recommended `no-undef` would flag those globals. Provide node globals
  //     here. Scoped to *.js tool scripts under apps/* / packages/* (not the linted
  //     TS source, which already has node globals in block 2). Story 10.2 adds the
  //     `.cjs` real-host test scripts under apps/*/host-tests/ (CommonJS Node scripts
  //     using __dirname/require/process/console — the @vscode/test-electron harness).
  {
    files: [
      'apps/*/esbuild.js',
      'packages/*/esbuild.js',
      'apps/*/host-tests/**/*.cjs',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // These are genuine CommonJS Node scripts (the .cjs real-host harness) — `require()`
      // is correct here, not the TS `import`. Relax the TS-recommended no-require-imports.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // 7c. ESM build/tool scripts (e.g. packages/cli/scripts/copy-web-dist.mjs, Story 11.5)
  //     run under Node as ES modules and use node globals (process). Like block 7b but
  //     sourceType: module (these use `import`, not `require`). NOT package source.
  {
    files: ['apps/*/scripts/**/*.mjs', 'packages/*/scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // 8. Prettier compatibility — MUST be last so it disables conflicting
  //    stylistic rules.
  prettier,
);
