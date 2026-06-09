// Host-side theme-kind plumbing (Story 10.6, AC2).
//
// Proves the HOST half of the high-contrast pipeline (the webview half — the CSS overrides + the
// data-theme-kind application + the live RoomView highContrast prop — is covered by
// webview/vscode-tokens.qa.test.ts + webview/RoomApp.live.test.tsx):
//
//   (a) RoomPanelManager.resolveThemeKind() flows into the panel's HTML as the INITIAL
//       `data-theme-kind` attribute on #root (so the HC overrides apply on FIRST paint).
//   (b) RoomPanelManager.postThemeKind(kind) pushes a `{type:'themeKind', kind}` frame to EVERY
//       open panel (the live re-theme on onDidChangeActiveColorTheme — host→its-own-webviews only,
//       NFR5: this never touches an agent/MCP path).
//
// Host-side tier (no `vscode`, no DOM): a recording fake PanelFactory + a REAL node:sqlite handle.
// Discoverable by ROOT `pnpm test` (Rule 8). The real ColorThemeKind read + onDidChangeActiveColorTheme
// is the Rule-12 in-host evidence (host-tests/room-panel.in-host.ts).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RoomPanelManager, type PanelLike } from './room-panel.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;
let da: DataAccessHandle | undefined;

/** A fake panel that RECORDS its postMessage frames + its html. */
type FakePanel = PanelLike & { sent: unknown[]; htmlValue: string };

function fakePanel(): FakePanel {
  const sent: unknown[] = [];
  let htmlValue = '';
  const panel: FakePanel = {
    title: '',
    iconPath: undefined,
    sent,
    get htmlValue() {
      return htmlValue;
    },
    webview: {
      get html() {
        return htmlValue;
      },
      set html(v: string) {
        htmlValue = v;
      },
      options: {},
      cspSource: 'vscode-webview://fake',
      asWebviewUri: (r: unknown) => ({
        toString: () => `https://fake.vscode-webview/${String(r)}`,
      }),
      postMessage: (m: unknown) => {
        sent.push(m);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    },
    reveal: () => {},
    onDidDispose: () => ({ dispose: () => {} }),
    onDidChangeViewState: () => ({ dispose: () => {} }),
  };
  return panel;
}

function makeManager(themeKind: () => string): {
  manager: RoomPanelManager;
  created: Map<string, FakePanel>;
} {
  const created = new Map<string, FakePanel>();
  const manager = new RoomPanelManager({
    dataAccess: da!,
    createPanel: (roomId) => {
      const p = fakePanel();
      created.set(roomId, p);
      return p;
    },
    assetUris: { script: 'dist/webview/main.js', styles: ['main.css'] },
    iconPath: { id: 'comment-discussion' },
    resolveThemeKind: themeKind,
  });
  return { manager, created };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-theme-qa-'));
  da = createDataAccessNodeSqlite({
    dbPath: join(dir, '.agentbbs', 'agentbbs.db'),
  });
});

afterEach(() => {
  try {
    da?.close();
  } catch {
    /* already closed */
  }
  da = undefined;
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

describe('RoomPanelManager — theme-kind plumbing (Story 10.6, AC2)', () => {
  it('the resolved theme-kind flows into the panel HTML as the initial data-theme-kind attribute', () => {
    const { manager, created } = makeManager(() => 'high-contrast');
    manager.openRoom('calling-interface');
    const html = created.get('calling-interface')!.htmlValue;
    expect(html).toContain('data-theme-kind="high-contrast"');
  });

  it('defaults the panel HTML to data-theme-kind="dark" when no resolver is supplied', () => {
    const created = new Map<string, FakePanel>();
    const manager = new RoomPanelManager({
      dataAccess: da!,
      createPanel: (roomId) => {
        const p = fakePanel();
        created.set(roomId, p);
        return p;
      },
      assetUris: { script: 'dist/webview/main.js', styles: ['main.css'] },
      // no resolveThemeKind → defaults to 'dark'
    });
    manager.openRoom('r');
    expect(created.get('r')!.htmlValue).toContain('data-theme-kind="dark"');
  });

  it('postThemeKind pushes a themeKind frame to EVERY open panel (live re-theme)', () => {
    const { manager, created } = makeManager(() => 'dark');
    manager.openRoom('a');
    manager.openRoom('b');
    // The operator switches to a high-contrast theme → the host pushes the new kind to all panels.
    manager.postThemeKind('high-contrast-light');
    for (const roomId of ['a', 'b']) {
      const frames = created.get(roomId)!.sent;
      expect(frames).toContainEqual({
        type: 'themeKind',
        kind: 'high-contrast-light',
      });
    }
  });

  it('postThemeKind on no open panels is a harmless no-op (never throws)', () => {
    const { manager } = makeManager(() => 'dark');
    expect(() => manager.postThemeKind('light')).not.toThrow();
  });
});
