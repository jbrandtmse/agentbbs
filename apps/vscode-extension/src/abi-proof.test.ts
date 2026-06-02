// Story 10.1 — extension-scaffold + SQLite-driver ABI proof (AC1/AC2/AC3).
//
// This test is discoverable by the ROOT `pnpm test` (co-located
// apps/*/src/**/*.test.ts, node project — see vitest.config.ts). It proves the two
// load-bearing things 10.1 retires the AR2 risk on:
//
//   1. The SQLite DRIVER actually LOADS and runs `SELECT sqlite_version()` in a REAL
//      process (Rule 12 — real-runtime evidence, never a green stub). Two halves:
//        (a) the documented `node:sqlite` FALLBACK (AC2) — the V1 resolution on THIS
//            machine, where no Electron extension-host runtime is reachable to verify
//            a better-sqlite3 Electron rebuild (recorded in the Dev Agent Record);
//        (b) better-sqlite3 LOADS at the CURRENT runtime ABI (the primary driver,
//            proven to work at the ABI it was built for — what is UNVERIFIABLE here
//            is only the Electron-host ABI MATCH, not the driver itself).
//   2. The extension's `activate()` runs against a minimal ExtensionContext without
//      throwing, registering its command (the activation proof at the unit tier; the
//      real Extension Development Host smoke is the lead's separate gate).
//
// Rule 13 (thin client): this TEST may touch better-sqlite3 / node:sqlite directly as
// a DEV-ONLY probe; the extension's PRODUCTION source does not (it imports neither).

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// The extension imports `vscode`, which is provided by the host at runtime and is not
// an installed npm package — mock it so `activate()` is loadable/exercisable in the
// node test env. The mock records the registered command for the activation assertion.
const registeredCommands: string[] = [];
vi.mock('vscode', () => {
  // Story 10.3 added the native tree to activate() (a TreeView + FileDecorationProvider +
  // configuration read + extra commands), so the mock stubs those surfaces minimally so
  // `activate()` is exercisable in the node test env. The REAL tree behavior is proven by the
  // vscode-free unit tests + the @vscode/test-electron host harness (Rule 12).
  class EventEmitter {
    fire(): void {}
    get event() {
      return () => ({ dispose: () => {} });
    }
    dispose(): void {}
  }
  class TreeItem {
    constructor(
      public label: string,
      public collapsibleState?: number,
    ) {}
  }
  class ThemeIcon {
    constructor(public id: string) {}
  }
  class ThemeColor {
    constructor(public id: string) {}
  }
  class FileDecoration {
    constructor(
      public badge?: string,
      public tooltip?: string,
      public color?: unknown,
    ) {}
  }
  return {
    commands: {
      registerCommand: (id: string) => {
        registeredCommands.push(id);
        return { dispose: () => {} };
      },
    },
    window: {
      showInformationMessage: () => Promise.resolve(undefined),
      createTreeView: () => ({ dispose: () => {} }),
      registerFileDecorationProvider: () => ({ dispose: () => {} }),
      // Story 10.4 — the room WebviewPanel factory (a minimal panel stub; activate() does not
      // create a panel until openRoom is invoked).
      createWebviewPanel: () => ({
        title: '',
        webview: {
          html: '',
          options: {},
          cspSource: 'vscode-webview://test',
          asWebviewUri: (u: unknown) => ({ toString: () => String(u) }),
          postMessage: () => true,
          onDidReceiveMessage: () => ({ dispose: () => {} }),
        },
        reveal: () => {},
        onDidDispose: () => ({ dispose: () => {} }),
        dispose: () => {},
      }),
    },
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
    },
    Uri: {
      parse: (s: string) => ({ toString: () => s, scheme: s.split(':')[0] }),
      // Story 10.4 — extension.ts resolves the webview bundle/css refs via Uri.joinPath.
      file: (p: string) => ({ toString: () => p, fsPath: p, path: p }),
      joinPath: (base: { path?: string }, ...segs: string[]) => {
        const basePath = base.path ?? String(base);
        const joined = [basePath, ...segs].join('/');
        return { toString: () => joined, fsPath: joined, path: joined };
      },
    },
    // Story 10.4 — the column the room panel opens in.
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    EventEmitter,
    TreeItem,
    ThemeIcon,
    ThemeColor,
    FileDecoration,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  };
});

describe('AC2/AC3 — node:sqlite fallback loads in a real process', () => {
  it('require("node:sqlite") resolves, opens :memory:, and returns a sqlite_version() string', async () => {
    // node:sqlite is the documented AC2 fallback. Probe it the way the Dev Notes
    // require: it must be RUNTIME-probed (Electron can strip built-ins), so a real
    // require + open + query, not a static assumption.
    const sqlite = await import('node:sqlite');
    expect(typeof sqlite.DatabaseSync).toBe('function');

    const db = new sqlite.DatabaseSync(':memory:');
    try {
      const row = db.prepare('SELECT sqlite_version() AS v').get() as {
        v: string;
      };
      expect(typeof row.v).toBe('string');
      expect(row.v).toMatch(/^\d+\.\d+/u);
    } finally {
      db.close();
    }
  });

  it('records the observed runtime ABI (empirical, not web-claimed — AC3)', () => {
    // The empirical ABI evidence: read from the REAL runtime, never hard-coded.
    expect(typeof process.versions.modules).toBe('string');
    expect(process.versions.modules.length).toBeGreaterThan(0);
    // process.versions.electron is absent in standalone Node (the case on this
    // machine). The assertion does not pin a number — it pins that we READ it.
    const electron = process.versions.electron ?? 'none';
    expect(typeof electron).toBe('string');
  });
});

describe('AC1 — better-sqlite3 driver loads at the current runtime ABI', () => {
  it('better-sqlite3 opens :memory: and returns sqlite_version() (driver works at its built ABI)', () => {
    // Resolve better-sqlite3 the way @agentbbs/data-access does (it is the ONLY
    // package that depends on it; the extension reaches it transitively). This proves
    // the DRIVER loads/runs at the ABI it was compiled for. The Electron-HOST ABI
    // match is the part that cannot be verified on this machine (no Electron runtime)
    // — that is exactly why AC2's node:sqlite fallback above is the V1 resolution.
    // Anchor a require at the data-access package DIRECTORY (not via its `exports`,
    // which intentionally only publishes the `.` barrel) so better-sqlite3 resolves
    // through data-access's own node_modules — exactly the resolution path the
    // extension uses transitively at runtime. The extension's own node_modules has
    // @agentbbs/data-access symlinked next to this test file.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dataAccessDir = path.resolve(
      here,
      '..',
      'node_modules',
      '@agentbbs',
      'data-access',
    );
    const requireFromDataAccess = createRequire(
      path.join(dataAccessDir, 'package.json'),
    );
    const Database = requireFromDataAccess('better-sqlite3') as new (
      path: string,
    ) => {
      prepare: (sql: string) => { get: () => { v: string } };
      close: () => void;
    };
    const db = new Database(':memory:');
    try {
      const row = db.prepare('SELECT sqlite_version() AS v').get();
      expect(typeof row.v).toBe('string');
      expect(row.v).toMatch(/^\d+\.\d+/u);
    } finally {
      db.close();
    }
  });
});

describe('AC1 — extension activates without throwing', () => {
  it('activate() registers the proof command against a minimal ExtensionContext', async () => {
    registeredCommands.length = 0;
    const { activate, deactivate, ACTIVATION_LOG } =
      await import('./extension.js');

    // Story 10.2: activate() now OPENS the shared ledger via data-access. Point AGENTBBS_DB at
    // an isolated in-memory DB so this unit test never touches the repo's real `.agentbbs/`.
    const prev = process.env.AGENTBBS_DB;
    process.env.AGENTBBS_DB = ':memory:';
    try {
      const subscriptions: Array<{ dispose: () => void }> = [];
      // A minimal ExtensionContext — only the fields activate() touches (Story 10.4 added
      // extensionUri, used to resolve the room webview bundle/css refs).
      const fakeContext = {
        subscriptions,
        extensionUri: { path: '/ext', toString: () => '/ext' },
      } as unknown as Parameters<typeof activate>[0];

      expect(() => activate(fakeContext)).not.toThrow();
      expect(registeredCommands).toContain('agentbbs.helloAbiProof');
      // Story 10.3 added the native tree, so activate() now registers several disposables
      // (the hello command + the TreeView/FileDecorationProvider/board commands); assert at
      // least the proof command's disposable landed rather than a brittle exact count.
      expect(subscriptions.length).toBeGreaterThanOrEqual(1);
      expect(ACTIVATION_LOG).toContain('agentbbs');

      // deactivate closes the ledger handle opened above — must not throw.
      expect(() => deactivate()).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.AGENTBBS_DB;
      else process.env.AGENTBBS_DB = prev;
    }
  });
});
