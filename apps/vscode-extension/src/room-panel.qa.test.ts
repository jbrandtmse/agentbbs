// Story 10.5, AC2 — QA SEAM coverage for RoomPanelManager: the FRESH-NONCE-on-re-attach guarantee
// and the LRU touch-on-REVEAL promotion the dev tests skipped.
//
// The dev's room-panel.test.ts proves: retain decisions at the cap boundary, non-retained re-render
// on focus, adoptPanel maps + reveals-not-duplicates. Two load-bearing seams are NOT pinned there:
//
//   (1) FRESH NONCE per HTML (re)set. AC1 requires a PER-LOAD nonce; the serializer-restore /
//       non-retained-re-render paths both RE-SET the panel HTML, and a security regression that
//       reused the ORIGINAL nonce (e.g. caching the shell string) would defeat the per-load
//       guarantee. The dev asserts only `htmlSetCount` (that html was re-set), NOT that the new
//       nonce DIFFERS from the prior one. This pins it: every (re)set mints a fresh nonce.
//
//   (2) LRU touch on REVEAL. `openRoom`'s reveal branch (re-opening an already-open room) calls
//       `lru.touch(roomId)` so a re-revealed room is PROMOTED back into the retain window. The dev
//       tests touch via the view-state focus path, but not via the reveal path — yet that is the
//       primary way an operator re-focuses a room (re-running the open command). This proves a
//       stale room, re-revealed, climbs back to most-recent (so it stays warm).
//
// Host-side tier: a minimal fake PanelFactory + a REAL node:sqlite handle (the same adapter the host
// uses), mirroring room-panel.test.ts. Discoverable by ROOT `pnpm test` (Rule 8). The real
// WebviewPanel lifecycle is the Rule-12 in-host evidence (host-tests/room-panel.in-host.ts).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RoomPanelManager, type PanelLike } from './room-panel.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;
let da: DataAccessHandle | undefined;

/** A fake WebviewPanel recording html sets + letting a test fire dispose/view-state transitions. */
type FakePanel = PanelLike & {
  retain: boolean;
  visible: boolean;
  htmlLog: string[];
  fireDispose(): void;
  fireViewState(visible: boolean): void;
};

function fakePanel(retain = false): FakePanel {
  const disposeHandlers: Array<() => void> = [];
  const viewStateHandlers: Array<() => void> = [];
  const htmlLog: string[] = [];
  let htmlValue = '';
  const panel: FakePanel = {
    title: '',
    iconPath: undefined,
    retain,
    visible: true,
    htmlLog,
    webview: {
      get html() {
        return htmlValue;
      },
      set html(v: string) {
        htmlValue = v;
        htmlLog.push(v);
      },
      options: {},
      cspSource: 'vscode-webview://fake',
      asWebviewUri: (r: unknown) => ({
        toString: () => `https://fake.vscode-webview/${String(r)}`,
      }),
      postMessage: () => Promise.resolve(true),
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    },
    reveal: () => {},
    onDidDispose: (handler: () => void) => {
      disposeHandlers.push(handler);
      return { dispose: () => {} };
    },
    onDidChangeViewState: (handler: () => void) => {
      viewStateHandlers.push(handler);
      return { dispose: () => {} };
    },
    fireDispose: () => {
      for (const h of [...disposeHandlers]) h();
    },
    fireViewState: (visible: boolean) => {
      panel.visible = visible;
      for (const h of [...viewStateHandlers]) h();
    },
  };
  return panel;
}

function makeManager(retainCap?: number): {
  manager: RoomPanelManager;
  created: Map<string, FakePanel>;
} {
  const created = new Map<string, FakePanel>();
  const manager = new RoomPanelManager({
    dataAccess: da!,
    createPanel: (roomId, _title, retain) => {
      const p = fakePanel(retain);
      created.set(roomId, p);
      return p;
    },
    assetUris: { script: 'dist/webview/main.js', styles: ['main.css'] },
    iconPath: { id: 'comment-discussion' },
    ...(retainCap !== undefined ? { retainCap } : {}),
  });
  return { manager, created };
}

/** Pull the script-src nonce out of a generated HTML shell. */
function nonceOf(html: string): string {
  const m = html.match(/script-src 'nonce-([0-9a-f]+)'/u);
  expect(m, 'the HTML shell must carry a script-src nonce').not.toBeNull();
  return m![1];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-panel-qa-'));
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

describe('RoomPanelManager — FRESH per-load nonce on every (re)set HTML (AC1 seam)', () => {
  it('a NON-retained panel re-rendered on focus gets a DIFFERENT nonce than its first render', () => {
    const { manager, created } = makeManager(1); // cap=1 → b is non-retained
    manager.openRoom('a'); // retained (within cap)
    manager.openRoom('b'); // NON-retained → re-renders on focus
    const b = created.get('b')!;
    const firstNonce = nonceOf(b.htmlLog[0]!);
    b.fireViewState(false);
    b.fireViewState(true); // hidden→visible → re-mount → fresh HTML
    expect(b.htmlLog.length).toBe(2); // re-set once
    const reRenderNonce = nonceOf(b.htmlLog[1]!);
    // A reused nonce here would mean the shell was cached, defeating the per-load nonce guarantee.
    expect(reRenderNonce).not.toBe(firstNonce);
    expect(reRenderNonce).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('an ADOPTED (serializer-restored) panel mints a fresh nonce distinct from a prior open', () => {
    const { manager, created } = makeManager();
    // Open the room once, capture its nonce, then simulate a window-reload restore via adoptPanel
    // with a FRESH panel for the same room. The restored panel must get a brand-new per-load nonce.
    manager.openRoom('room-x');
    const firstNonce = nonceOf(created.get('room-x')!.htmlLog[0]!);
    const restored = fakePanel(true);
    manager.adoptPanel('room-x', restored);
    expect(restored.htmlLog.length).toBe(1);
    const restoredNonce = nonceOf(restored.htmlLog[0]!);
    expect(restoredNonce).not.toBe(firstNonce);
    expect(restoredNonce).toMatch(/^[0-9a-f]{32}$/u);
  });
});

describe('RoomPanelManager — LRU touch on REVEAL promotes a re-opened room (AC2 seam)', () => {
  it('re-opening (revealing) an already-open room moves it back to most-recent (stays warm)', () => {
    const { manager } = makeManager(2); // retain window of 2
    manager.openRoom('a'); // [a]
    manager.openRoom('b'); // [b, a]
    manager.openRoom('c'); // [c, b, a] — a falls out of the top-2 window
    expect(manager.retainedRooms()).toEqual(['c', 'b']);
    // Re-open (reveal) 'a' — the reveal branch must touch the LRU and promote it to most-recent.
    manager.openRoom('a');
    expect(manager.has('a')).toBe(true);
    expect(manager.openCount).toBe(3); // still 3 panels — reveal, not a new open
    // 'a' is now most-recent; the retain window is [a, c].
    expect(manager.retainedRooms()).toEqual(['a', 'c']);
  });

  it('a re-revealed room does NOT create a duplicate panel (reveal-not-duplicate, with LRU touch)', () => {
    const { manager, created } = makeManager(2);
    const first = manager.openRoom('room-a');
    expect(created.size).toBe(1);
    const again = manager.openRoom('room-a');
    expect(again).toBe(first); // same panel instance
    expect(created.size).toBe(1); // the factory was NOT called again
    expect(manager.openCount).toBe(1);
    // The reveal still touched the LRU (room-a is the single most-recent room).
    expect(manager.retainedRooms()).toEqual(['room-a']);
  });
});
