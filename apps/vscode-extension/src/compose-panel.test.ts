// ComposePanelManager + compose HTML/CSP shell tests (Story 10.7, AC2/AC3).
//
// Host-side tier (no `vscode`, no DOM): a FAKE ComposePanelFactory + a REAL node:sqlite data-access
// handle over a temp ledger (the same adapter the host uses). Proves the NATIVE PANEL-EXCLUSIVITY
// model (AC3: a SINGLE reused compose panel — opening any surface reveals+swaps the ONE panel, never
// a second; distinct from rooms-as-tabs), the composeSuccess→onSuccess (tree-refresh) +
// composeClose→close wiring, the per-panel bridge writes LANDING in the ledger over the SAME core
// ops (Rule 13), and the compose HTML shell content-guard (nonce CSP, NO unsafe-*, the compose kind
// + scope on the mount root). Discoverable by ROOT `pnpm test` (co-located .test.ts → node project;
// Rule 8). The real WebviewPanel lifecycle is the Rule-12 real-host evidence
// (host-tests/compose-panel.in-host.ts).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { register } from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ComposePanelManager } from './compose-panel.js';
import {
  buildComposeWebviewHtml,
  generateNonce,
} from './webview/webview-html.js';

import type { PanelLike } from './room-panel.js';
import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;
let da: DataAccessHandle | undefined;

/** A fake compose WebviewPanel that records html/title/reveal + lets a test fire dispose/inbound. */
type FakePanel = PanelLike & {
  revealCount: number;
  htmlSetCount: number;
  disposed: boolean;
  fireDispose(): void;
  inbound(msg: unknown): void;
  sent: unknown[];
};

function fakePanel(): FakePanel {
  const messageHandlers: Array<(m: unknown) => void> = [];
  const disposeHandlers: Array<() => void> = [];
  const sent: unknown[] = [];
  let htmlValue = '';
  const panel: FakePanel = {
    title: '',
    iconPath: undefined,
    revealCount: 0,
    htmlSetCount: 0,
    disposed: false,
    sent,
    webview: {
      get html() {
        return htmlValue;
      },
      set html(v: string) {
        htmlValue = v;
        panel.htmlSetCount += 1;
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
      panel.revealCount += 1;
    },
    dispose: () => {
      panel.disposed = true;
      for (const h of [...disposeHandlers]) h();
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
    fireDispose: () => {
      for (const h of [...disposeHandlers]) h();
    },
    inbound: (msg: unknown) => {
      for (const h of [...messageHandlers]) h(msg);
    },
  };
  return panel;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-compose-'));
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

/** Build a manager over a factory that records every created panel (to assert single-panel reuse). */
function makeManager(
  onSuccess?: (p?: { roomId?: string; projectId?: string }) => void,
): {
  manager: ComposePanelManager;
  created: FakePanel[];
} {
  const created: FakePanel[] = [];
  const manager = new ComposePanelManager({
    dataAccess: da!,
    createPanel: () => {
      const p = fakePanel();
      created.push(p);
      return p;
    },
    assetUris: { script: 'compose.js', styles: ['compose.css'] },
    resolveOperatorHandle: () => 'operator',
    resolveThemeKind: () => 'dark',
    onSuccess,
  });
  return { manager, created };
}

describe('ComposePanelManager — native panel-exclusivity (a SINGLE reused panel, AC3)', () => {
  it('opening DIFFERENT initiate surfaces reuses the ONE panel (reveal+swap, never a second)', () => {
    const { manager, created } = makeManager();
    manager.open('create-project');
    expect(created.length).toBe(1);
    expect(manager.currentKind).toBe('create-project');

    // Opening a DIFFERENT kind reveals + swaps the SAME panel — no second panel created.
    manager.open('focus');
    expect(created.length).toBe(1);
    expect(manager.currentKind).toBe('focus');
    expect(created[0].revealCount).toBeGreaterThan(0);
    // The HTML was re-set to the new surface (the swap).
    expect(created[0].webview.html).toContain('data-compose-kind="focus"');

    // Re-opening the SAME kind also just reveals the one panel.
    manager.open('focus');
    expect(created.length).toBe(1);
    manager.dispose();
  });

  it('the post-announcement surface carries its project scope into the HTML', () => {
    const { manager, created } = makeManager();
    manager.open('post-announcement', 'acme');
    expect(created[0].webview.html).toContain(
      'data-compose-kind="post-announcement"',
    );
    expect(created[0].webview.html).toContain('data-project-id="acme"');
    expect(created[0].webview.html).toContain(
      'data-operator-handle="operator"',
    );
    manager.dispose();
  });

  it('a composeClose frame closes the panel; a composeSuccess frame fires onSuccess (tree refresh)', () => {
    let successPayload: { roomId?: string } | undefined = undefined;
    const { manager, created } = makeManager((p) => {
      successPayload = p;
    });
    manager.open('create-project');
    const panel = created[0];

    // composeSuccess → onSuccess (the AC3 initiate→respond loop: the host refreshes the tree).
    panel.inbound({ type: 'composeSuccess', payload: { roomId: 'r1' } });
    expect(successPayload).toMatchObject({ roomId: 'r1' });

    // composeClose → the panel is disposed (the cancel/Esc path).
    panel.inbound({ type: 'composeClose' });
    expect(panel.disposed).toBe(true);
    expect(manager.isOpen).toBe(false);
  });

  it('postThemeKind pushes a live themeKind frame to the open compose panel', () => {
    const { manager, created } = makeManager();
    manager.open('focus');
    manager.postThemeKind('high-contrast');
    expect(created[0].sent).toContainEqual({
      type: 'themeKind',
      kind: 'high-contrast',
    });
    manager.dispose();
  });
});

describe('ComposePanelManager — the per-panel bridge writes LAND over the SAME core ops (Rule 13)', () => {
  it('an announceProject request injected over the panel channel creates a project in the ledger', async () => {
    await register(da!, { handle: 'operator', currentFocus: 'leading' });
    const { manager, created } = makeManager();
    manager.open('create-project');
    const panel = created[0];

    // The compose webview would post this request; inject it over the panel's message channel and
    // wait for the bridge to dispatch it to core + post a response back.
    panel.inbound({
      id: 'c1',
      op: 'announceProject',
      args: {
        actor: 'operator',
        title: 'Bridged Project',
        description: 'via the compose panel bridge',
      },
    });
    await waitFor(() =>
      (panel.sent as Array<{ type?: string; ok?: boolean }>).some(
        (m) => m.type === 'response' && m.ok === true,
      ),
    );

    // OUT-OF-BAND: the project is now in the ledger (a fresh read, not the response).
    const events = await da!.eventsSince(0);
    expect(events.some((e) => e.type === 'project.announced')).toBe(true);
    manager.dispose();
  });
});

describe('ComposePanelManager — a SWAPPED surface still dispatches over a live bridge (QA value-add)', () => {
  // QA value-add (Story 10.7 candidate c). The dev's exclusivity test proves the ONE panel is
  // reused + the HTML swaps. But `open()` ALSO disposes the old bridge and binds a FRESH one on the
  // swap (compose-panel.ts: `this.held.bridge.dispose(); this.held.bridge = this.bindBridge(...)`).
  // If that re-bind were dropped, the swapped surface would still SHOW the new kind but its writes
  // would dispatch over a DISPOSED bridge (no response) — a stale, broken surface that the
  // HTML-only assertion cannot see. This proves a write LANDS over the bridge AFTER a swap.

  it('after open(focus)→open(create-project), an announceProject over the (swapped) panel still LANDS', async () => {
    await register(da!, { handle: 'operator', currentFocus: 'leading' });
    const { manager, created } = makeManager();
    // Open one surface, then SWAP to a different one (the bridge is disposed + re-bound here).
    manager.open('focus');
    manager.open('create-project');
    expect(created.length).toBe(1); // still the one panel
    const panel = created[0];

    // Dispatch a write over the (post-swap) panel channel — it must reach core through the FRESH bridge.
    panel.inbound({
      id: 'swap1',
      op: 'announceProject',
      args: {
        actor: 'operator',
        title: 'Post-Swap Project',
        description: 'wired through the re-bound bridge',
      },
    });
    await waitFor(() =>
      (panel.sent as Array<{ type?: string; ok?: boolean }>).some(
        (m) => m.type === 'response' && m.ok === true,
      ),
    );
    // OUT-OF-BAND: the project landed (the swapped surface's bridge is live, not the disposed one).
    const events = await da!.eventsSince(0);
    expect(events.some((e) => e.type === 'project.announced')).toBe(true);
    manager.dispose();
  });

  it('a watching-only INITIATE write over the panel bridge yields the host-surface NO_OPERATOR (consistent gate)', async () => {
    // The manager resolves operator='operator' for the HTML, but the GATE lives in the bridge on the
    // actor arg — a request without an actor is the watching-only case, gated BEFORE core (Rule 13).
    const { manager, created } = makeManager();
    manager.open('create-project');
    const panel = created[0];
    const before = await da!.maxSeq();
    panel.inbound({
      id: 'wo1',
      op: 'announceProject',
      args: { title: 'No Actor', description: 'watching-only' },
    });
    await waitFor(() =>
      (panel.sent as Array<{ type?: string; ok?: boolean }>).some(
        (m) => m.type === 'response' && m.ok === false,
      ),
    );
    const resp = (
      panel.sent as Array<{ type?: string; error?: { code: string } }>
    ).find((m) => m.type === 'response');
    expect(resp?.error?.code).toBe('NO_OPERATOR');
    // The gate fired BEFORE core — nothing persisted.
    expect(await da!.maxSeq()).toBe(before);
    manager.dispose();
  });
});

describe('buildComposeWebviewHtml — strict CSP + mount-root attributes (content-guard)', () => {
  it('emits the strict nonce CSP with NO unsafe-inline/unsafe-eval and the compose kind on the root', () => {
    const nonce = generateNonce();
    const html = buildComposeWebviewHtml({
      cspSource: 'vscode-webview://abc',
      nonce,
      scriptUri: 'https://x/compose.js',
      styleUris: ['https://x/compose.css'],
      composeKind: 'join-project',
      operatorHandle: 'operator',
      projectId: '',
      themeKind: 'dark',
    });
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain(`script-src 'nonce-${nonce}'`);
    expect(html).toContain(`default-src 'none'`);
    expect(html).toContain(`connect-src 'none'`);
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toContain('unsafe-eval');
    expect(html).not.toContain('data:');
    expect(html).toContain('data-compose-kind="join-project"');
    expect(html).toContain('data-operator-handle="operator"');
  });
});

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
