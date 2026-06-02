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
type FakePanel = PanelLike & {
  revealCount: number;
  htmlSetCount: number;
  retain: boolean;
  visible: boolean;
  fireDispose(): void;
  fireViewState(visible: boolean): void;
  inbound(msg: unknown): void;
  sent: unknown[];
};

function fakePanel(retain = false): FakePanel {
  const messageHandlers: Array<(m: unknown) => void> = [];
  const disposeHandlers: Array<() => void> = [];
  const viewStateHandlers: Array<() => void> = [];
  const sent: unknown[] = [];
  let revealCount = 0;
  let htmlSetCount = 0;
  let htmlValue = '';
  const panel: FakePanel = {
    title: '',
    iconPath: undefined,
    retain,
    visible: true,
    webview: {
      get html() {
        return htmlValue;
      },
      set html(v: string) {
        htmlValue = v;
        htmlSetCount += 1;
        panel.htmlSetCount = htmlSetCount;
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
    onDidChangeViewState: (handler: () => void) => {
      viewStateHandlers.push(handler);
      return {
        dispose: () => {
          const i = viewStateHandlers.indexOf(handler);
          if (i >= 0) viewStateHandlers.splice(i, 1);
        },
      };
    },
    revealCount: 0,
    htmlSetCount: 0,
    fireDispose: () => {
      for (const h of [...disposeHandlers]) h();
    },
    fireViewState: (visible: boolean) => {
      panel.visible = visible;
      for (const h of [...viewStateHandlers]) h();
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
function makeManager(retainCap?: number): {
  manager: RoomPanelManager;
  created: Map<string, FakePanel>;
  retainArgs: Map<string, boolean>;
} {
  const created = new Map<string, FakePanel>();
  const retainArgs = new Map<string, boolean>();
  const manager = new RoomPanelManager({
    dataAccess: da!,
    createPanel: (roomId, _title, retain) => {
      retainArgs.set(roomId, retain);
      const p = fakePanel(retain);
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
    ...(retainCap !== undefined ? { retainCap } : {}),
  });
  return { manager, created, retainArgs };
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
    expect((first as FakePanel).revealCount).toBe(1); // revealed once
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

describe('RoomPanelManager — retainContextWhenHidden + LRU (Story 10.5 AC2)', () => {
  it('the first N panels are created RETAINED; beyond N a fresh open is NON-retained (bounded live DOM)', () => {
    const { manager, retainArgs } = makeManager(2); // cap = 2 live-DOM panels
    manager.openRoom('a'); // retainedCount 0 < 2 → retained
    manager.openRoom('b'); // retainedCount 1 < 2 → retained
    manager.openRoom('c'); // retainedCount 2, NOT < 2 → NON-retained
    expect(retainArgs.get('a')).toBe(true);
    expect(retainArgs.get('b')).toBe(true);
    expect(retainArgs.get('c')).toBe(false); // beyond the cap → not retained
    expect(manager.isRetained('a')).toBe(true);
    expect(manager.isRetained('c')).toBe(false);
    // At most `cap` panels hold their DOM alive — the bounded-memory guarantee.
    expect(manager.retainedCount).toBe(2);
  });

  it('closing a retained panel frees a warm slot for the NEXT opened room', () => {
    const { manager, created, retainArgs } = makeManager(2);
    manager.openRoom('a'); // retained
    manager.openRoom('b'); // retained (cap reached)
    manager.openRoom('c'); // NON-retained
    expect(retainArgs.get('c')).toBe(false);
    created.get('a')!.fireDispose(); // a closes → retainedCount drops to 1
    expect(manager.retainedCount).toBe(1);
    manager.openRoom('d'); // now 1 < 2 → retained again
    expect(retainArgs.get('d')).toBe(true);
    expect(manager.retainedCount).toBe(2);
  });

  it('a NON-retained panel re-renders (re-sets its HTML) on a hidden→visible focus transition', () => {
    const { manager, created } = makeManager(1); // cap = 1 → second+ rooms are NON-retained
    manager.openRoom('a'); // retained (first, within cap)
    manager.openRoom('b'); // NON-retained (cap reached)
    const b = created.get('b')!;
    expect(manager.isRetained('b')).toBe(false);
    const htmlSetsBefore = b.htmlSetCount; // set once at open
    // Hide b, then focus it again → non-retained must re-mount (re-set HTML).
    b.fireViewState(false);
    b.fireViewState(true);
    expect(b.htmlSetCount).toBe(htmlSetsBefore + 1);
  });

  it('a RETAINED panel does NOT re-render on focus (its DOM is kept alive)', () => {
    const { manager, created } = makeManager(2);
    manager.openRoom('a'); // retained
    const a = created.get('a')!;
    const htmlSetsBefore = a.htmlSetCount;
    a.fireViewState(false);
    a.fireViewState(true);
    // Retained → no re-mount; the HTML was set only once (at open).
    expect(a.htmlSetCount).toBe(htmlSetsBefore);
    expect(manager.isRetained('a')).toBe(true);
  });

  it('a repeated visible→visible view-state change does NOT spuriously re-render a non-retained panel', () => {
    const { manager, created } = makeManager(1);
    manager.openRoom('a');
    manager.openRoom('b'); // non-retained
    const b = created.get('b')!;
    const before = b.htmlSetCount;
    // Already-visible → a no-op view-state fire must not re-mount (only hidden→visible does).
    b.fireViewState(true);
    expect(b.htmlSetCount).toBe(before);
  });
});

describe('RoomPanelManager — adoptPanel (serializer restore, Story 10.5 AC2)', () => {
  it('adopts an externally-created panel into the map so reveal-not-duplicate holds post-reload', () => {
    const { manager } = makeManager();
    // Simulate VS Code handing the serializer a fresh panel after a reload.
    const restored = fakePanel(true);
    manager.adoptPanel('room-x', restored);
    expect(manager.has('room-x')).toBe(true);
    expect(manager.openCount).toBe(1);
    expect(restored.title).toBe('#room-x');
    expect(restored.iconPath).toEqual({ id: 'comment-discussion' });
    // The HTML shell was (re)set with the nonce CSP + the room id.
    expect(restored.webview.html).toContain('data-room-id="room-x"');
    expect(restored.htmlSetCount).toBe(1);
  });

  it('a subsequent openRoom for an adopted room REVEALS it (no duplicate)', () => {
    const { manager, created } = makeManager();
    const restored = fakePanel(true);
    manager.adoptPanel('room-x', restored);
    const again = manager.openRoom('room-x');
    expect(again).toBe(restored);
    expect(manager.openCount).toBe(1);
    expect(created.has('room-x')).toBe(false); // the factory was NOT called for the adopted room
    expect((restored as FakePanel).revealCount).toBe(1);
  });

  it('adopting a room that is already held replaces the held panel (never duplicates the map)', () => {
    const { manager } = makeManager();
    manager.openRoom('room-x');
    expect(manager.openCount).toBe(1);
    const restored = fakePanel(true);
    manager.adoptPanel('room-x', restored);
    expect(manager.openCount).toBe(1); // still one entry — the incoming panel replaced the held one
    // A reveal now targets the adopted panel.
    const revealed = manager.openRoom('room-x');
    expect(revealed).toBe(restored);
  });

  it("the adopted panel's bridge round-trips a readRoom request (the restored data path works)", async () => {
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
    const { manager } = makeManager();
    const restored = fakePanel(true);
    manager.adoptPanel(room.roomId, restored);
    restored.inbound({
      id: 'q1',
      op: 'readRoom',
      args: { roomId: room.roomId },
    });
    await waitFor(() =>
      restored.sent.some((m) => (m as { id?: string }).id === 'q1'),
    );
    const response = restored.sent.find(
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
