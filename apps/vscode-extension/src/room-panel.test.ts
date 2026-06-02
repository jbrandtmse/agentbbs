// RoomPanelManager + HTML/CSP shell tests (Story 10.4, AC1/AC2/AC5).
//
// Host-side tier (no `vscode`, no DOM): a FAKE PanelFactory + a REAL node:sqlite data-access handle
// over a temp ledger (the same adapter the host uses). Proves the keyed open/reveal/dispose Map
// logic (AC1: one panel per room, re-open reveals not duplicates, dispose cleans up) and the
// nonce-CSP HTML shell content-guard (AC2: nonce present, NO unsafe-inline/unsafe-eval, the
// bundle + the vscode-tokens theme layer linked LAST). Discoverable by ROOT `pnpm test`
// (co-located .test.ts → node project; Rule 8). The real WebviewPanel lifecycle is the Rule-12
// real-host evidence (host-tests/room-panel.in-host.ts).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { announceProject, postAnnouncement, register } from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RoomPanelManager, type PanelLike } from './room-panel.js';
import { buildRoomWebviewHtml, generateNonce } from './webview/webview-html.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;
let da: DataAccessHandle | undefined;

/** A fake WebviewPanel that records html/title/reveal calls + lets a test fire dispose/inbound. */
function fakePanel(): PanelLike & {
  revealCount: number;
  fireDispose(): void;
  inbound(msg: unknown): void;
  sent: unknown[];
} {
  const messageHandlers: Array<(m: unknown) => void> = [];
  const disposeHandlers: Array<() => void> = [];
  const sent: unknown[] = [];
  let revealCount = 0;
  const panel: PanelLike & {
    revealCount: number;
    fireDispose(): void;
    inbound(msg: unknown): void;
    sent: unknown[];
  } = {
    title: '',
    iconPath: undefined,
    webview: {
      html: '',
      options: {},
      cspSource: 'vscode-webview://fake',
      asWebviewUri: (r: unknown) => ({
        toString: () => `https://fake.vscode-webview/${String(r)}`,
      }),
      postMessage: (m: unknown) => {
        sent.push(m);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (handler: (m: unknown) => void) => {
        messageHandlers.push(handler);
        return {
          dispose: () => {
            const i = messageHandlers.indexOf(handler);
            if (i >= 0) messageHandlers.splice(i, 1);
          },
        };
      },
    },
    reveal: () => {
      revealCount += 1;
      panel.revealCount = revealCount;
    },
    onDidDispose: (handler: () => void) => {
      disposeHandlers.push(handler);
      return {
        dispose: () => {
          const i = disposeHandlers.indexOf(handler);
          if (i >= 0) disposeHandlers.splice(i, 1);
        },
      };
    },
    revealCount: 0,
    fireDispose: () => {
      for (const h of [...disposeHandlers]) h();
    },
    inbound: (msg: unknown) => {
      for (const h of [...messageHandlers]) h(msg);
    },
    sent,
  };
  return panel;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-panel-'));
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

/** Build a manager over a fake factory that hands out fresh fake panels (recording them). */
function makeManager(): {
  manager: RoomPanelManager;
  created: Map<string, ReturnType<typeof fakePanel>>;
} {
  const created = new Map<string, ReturnType<typeof fakePanel>>();
  const manager = new RoomPanelManager({
    dataAccess: da!,
    createPanel: (roomId) => {
      const p = fakePanel();
      created.set(roomId, p);
      return p;
    },
    assetUris: {
      script: 'dist/webview/main.js',
      styles: [
        'tokens.css',
        'markdown.css',
        'room.css',
        'chrome.css',
        'vscode-tokens.css',
      ],
    },
    iconPath: { id: 'comment-discussion' },
  });
  return { manager, created };
}

describe('RoomPanelManager — one panel per room, reveal-not-duplicate, dispose-cleanup (AC1/AC5)', () => {
  it('opening a room creates a panel, sets its title + html + icon', () => {
    const { manager, created } = makeManager();
    const panel = manager.openRoom('calling-interface');
    expect(manager.openCount).toBe(1);
    expect(panel.title).toBe('#calling-interface');
    expect(panel.iconPath).toEqual({ id: 'comment-discussion' });
    expect(panel.webview.html).toContain('data-room-id="calling-interface"');
    expect(created.get('calling-interface')).toBe(panel);
  });

  it('re-selecting an OPEN room REVEALS the existing panel — does NOT create a duplicate', () => {
    const { manager, created } = makeManager();
    const first = manager.openRoom('calling-interface');
    const again = manager.openRoom('calling-interface');
    expect(again).toBe(first); // same panel instance
    expect(manager.openCount).toBe(1); // still one panel
    expect(created.size).toBe(1); // the factory was called ONCE
    expect((first as ReturnType<typeof fakePanel>).revealCount).toBe(1); // revealed once
  });

  it('different rooms get SEPARATE panels (rooms-as-tabs — multiple open tabs allowed)', () => {
    const { manager } = makeManager();
    manager.openRoom('room-a');
    manager.openRoom('room-b');
    expect(manager.openCount).toBe(2);
    expect(manager.has('room-a')).toBe(true);
    expect(manager.has('room-b')).toBe(true);
  });

  it('closing a panel (onDidDispose) removes it from the map; re-open creates a fresh panel', () => {
    const { manager, created } = makeManager();
    manager.openRoom('room-a');
    const p = created.get('room-a')!;
    p.fireDispose();
    expect(manager.has('room-a')).toBe(false);
    expect(manager.openCount).toBe(0);
    // Re-open after close → a brand-new panel (the factory is called again).
    manager.openRoom('room-a');
    expect(manager.openCount).toBe(1);
  });

  it('dispose() tears down every open panel bridge/listener', () => {
    const { manager } = makeManager();
    manager.openRoom('room-a');
    manager.openRoom('room-b');
    manager.dispose();
    expect(manager.openCount).toBe(0);
  });

  it('the per-panel bridge round-trips a readRoom request over the webview channel (AC2/AC4)', async () => {
    // Seed a proto-room and prove the panel's bridge answers a readRoom request inbound from the
    // webview with the room — the AC2/AC4 mount data path (open a proto-room → see it).
    await register(da!, { handle: 'alice', currentFocus: 'seeding' });
    const project = await announceProject(da!, 'alice', {
      title: 'Proj',
      description: 'd',
    });
    const room = await postAnnouncement(da!, 'alice', {
      projectId: project.projectId,
      subject: 'Subj',
      body: 'Body',
    });
    const { manager, created } = makeManager();
    manager.openRoom(room.roomId);
    const panel = created.get(room.roomId)!;
    // The webview sends a readRoom request; the bridge dispatches to core + posts a response back.
    panel.inbound({ id: 'q1', op: 'readRoom', args: { roomId: room.roomId } });
    await waitFor(() =>
      panel.sent.some((m) => (m as { type?: string; id?: string }).id === 'q1'),
    );
    const response = panel.sent.find(
      (m) => (m as { id?: string }).id === 'q1',
    ) as { ok: boolean; result: { room: { roomId: string } } };
    expect(response.ok).toBe(true);
    expect(response.result.room.roomId).toBe(room.roomId);
    manager.dispose();
  });
});

describe('buildRoomWebviewHtml — nonce CSP content-guard (AC2)', () => {
  const html = buildRoomWebviewHtml({
    cspSource: 'vscode-webview://abc',
    nonce: 'deadbeefcafef00d',
    scriptUri: 'https://x/main.js',
    styleUris: ['https://x/tokens.css', 'https://x/vscode-tokens.css'],
    roomId: 'calling-interface',
    operatorHandle: 'operator',
  });

  it('embeds a Content-Security-Policy with the per-load nonce on the script', () => {
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain(`script-src 'nonce-deadbeefcafef00d'`);
    expect(html).toContain('nonce="deadbeefcafef00d"');
  });

  it('does NOT contain unsafe-inline or unsafe-eval (the inert-markdown / 10.5 precondition)', () => {
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toContain('unsafe-eval');
  });

  it('links every stylesheet (vscode-tokens theme layer LAST) + the bundle, and the mount root', () => {
    expect(html).toContain('href="https://x/tokens.css"');
    // The theme layer is the LAST <link> so its :root overrides win (AC3).
    const tokensIdx = html.indexOf('tokens.css"');
    const vscodeTokensIdx = html.lastIndexOf('vscode-tokens.css"');
    expect(vscodeTokensIdx).toBeGreaterThan(tokensIdx);
    expect(html).toContain('src="https://x/main.js"');
    expect(html).toContain('data-room-id="calling-interface"');
  });

  it('default-src is none (baseline; full hardening is 10.5)', () => {
    expect(html).toContain(`default-src 'none'`);
  });
});

describe('generateNonce — CSPRNG hex', () => {
  it('produces a 32-char hex string', () => {
    const n = generateNonce();
    expect(n).toMatch(/^[0-9a-f]{32}$/);
  });
  it('is unique per call', () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });
});

function delayMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await delayMs(5);
  }
}
