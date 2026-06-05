// END-TO-END webview↔host bridge round-trip under React StrictMode (Epic-10 defect-fix gap-closer).
//
// THE GAP THIS CLOSES (Rule 8/12): every other webview test injects a FAKE `Bridge` (the `request()`
// interface) directly, and the `@vscode/test-electron` probes call `dispatchRequest(...)` directly —
// NONE mounts the real React root and exercises `createPostMessageBridge` (webview side) ↔
// `createBridge` (host side) end-to-end over a real message channel UNDER STRICTMODE. That is exactly
// the path the HIGH manual-smoke defect lived on: the room webview hung on "opening room…" because
// the StrictMode mount→unmount→remount disposed the postMessage bridge's window 'message' listener
// and could not recreate it (acquireVsCodeApi throws on a second call), so the host's
// `{type:'response',…}` frames were dropped and `readRoom`/`readContract` never resolved.
//
// This test wires the REAL webview bridge to the REAL host bridge over an in-memory `node:sqlite`
// ledger (seeded with a room via core ops), mounts a root component that REPLICATES main.tsx's exact
// lifecycle under `<StrictMode>`, and asserts the room actually LOADS (the RoomView content renders;
// it is NOT stuck on "opening room…").
//
// NON-VACUITY / MUTATION GUARD (Rule 7): the test runs BOTH lifecycle variants over the same real
// channel — the FIXED module-scope-acquire lifecycle (the production main.tsx shape) AND the OLD
// acquire-in-render + dispose-on-`useEffect`-cleanup lifecycle (the defect). The FIXED variant must
// LOAD; the OLD variant must STAY STUCK on "opening room…". A test that passed for BOTH would guard
// nothing — pinning the OLD variant red proves the assertion discriminates the real bug.

import { StrictMode, useEffect, useRef } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  announceProject,
  postAnnouncement,
  register,
  reply,
} from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import { isHighlighterWarm, prewarmHighlighter } from '@agentbbs/ui-shared';

import { createBridge } from '../bridge.js';
import { createPostMessageBridge } from './bridge-client.js';
import { RoomApp } from './RoomApp.js';

import type { Bridge as HostBridge, Messaging } from '../bridge.js';
import type { Bridge, VsCodeWebviewApi } from './bridge-client.js';
import type { DataAccess } from '@agentbbs/core';
import type { ReactElement } from 'react';
import type { Root } from 'react-dom/client';

const ROOM_ID = 'calling-interface';

/** Seed an in-memory ledger with an ACTIVE room (announcement + one reply) via real core ops. */
async function seedLedger(): Promise<DataAccess> {
  const dataAccess = createDataAccessNodeSqlite({ dbPath: ':memory:' });
  await register(dataAccess, { handle: 'alice', currentFocus: 'seeding' });
  await register(dataAccess, { handle: 'bob', currentFocus: 'seeding' });
  const project = await announceProject(dataAccess, 'alice', {
    title: 'Acme',
    description: 'A project',
  });
  await postAnnouncement(dataAccess, 'alice', {
    projectId: project.projectId,
    subject: 'Calling interface',
    body: 'Should we use REST?',
  });
  // A reply ACTIVATES the proto-room and lands a recognizable body the assertion keys on.
  await reply(dataAccess, 'bob', {
    roomId: ROOM_ID,
    body: 'gRPC is faster than REST here',
  });
  return dataAccess;
}

/**
 * Wire a REAL host `createBridge` to a mock `acquireVsCodeApi` over an in-memory two-way channel:
 *   - webview→host: the mock api's `postMessage(req)` → the host messaging's onMessage handler.
 *   - host→webview: the host messaging's `postMessage(frame)` → a `window` 'message' MessageEvent
 *     (exactly what the real VS Code webview host delivers and `createPostMessageBridge` listens for).
 *
 * The mock `acquireVsCodeApi` THROWS on a second call — faithfully reproducing the real VS Code
 * constraint ("acquireVsCodeApi can only be invoked once") that makes the OLD lifecycle unrecoverable
 * under StrictMode. Returns the api factory + the live host bridge (disposed in afterEach).
 */
function wireRealBridges(dataAccess: DataAccess): {
  acquire: () => VsCodeWebviewApi;
  hostBridge: HostBridge;
} {
  let hostHandler: ((message: unknown) => void) | null = null;
  const messaging: Messaging = {
    postMessage(frame): void {
      // Deliver host→webview frames as real window 'message' events (the webview bridge listens here).
      window.dispatchEvent(new MessageEvent('message', { data: frame }));
    },
    onMessage(handler): () => void {
      hostHandler = handler;
      return () => {
        hostHandler = null;
      };
    },
  };
  // A long poll interval so the delta poller never fires during the synchronous test window (the
  // request/response correlation is what this test exercises, not the live poll).
  const hostBridge = createBridge({
    dataAccess,
    messaging,
    pollIntervalMs: 1_000_000,
  });

  let acquired = false;
  const acquire = () => {
    if (acquired) {
      // Faithful to real VS Code: a second acquire throws.
      throw new Error('acquireVsCodeApi can only be invoked once');
    }
    acquired = true;
    return {
      postMessage(message: unknown): void {
        hostHandler?.(message);
      },
    };
  };
  return { acquire, hostBridge };
}

// ---------------------------------------------------------------------------------------------
// Two root components mounting RoomApp over the REAL postMessage bridge — the FIXED (production)
// lifecycle and the OLD (defective) lifecycle. Both take an `acquire` factory so the test controls
// the once-only acquireVsCodeApi constraint.
// ---------------------------------------------------------------------------------------------

/** FIXED lifecycle (production main.tsx shape): acquire + create the bridge ONCE at module scope. */
function FixedRoot({
  acquire,
}: {
  acquire: () => VsCodeWebviewApi;
}): ReactElement {
  // Created once, outside the component tree — survives a StrictMode unmount/remount intact.
  const bridgeRef = useRef<Bridge | null>(null);
  if (bridgeRef.current === null) {
    const api = acquire();
    bridgeRef.current = createPostMessageBridge(api, {});
  }
  return (
    <RoomApp
      bridge={bridgeRef.current}
      roomId={ROOM_ID}
      operatorHandle="operator"
    />
  );
}

/** OLD lifecycle (the defect): acquire + create the bridge DURING RENDER, dispose on cleanup. */
function OldRoot({
  acquire,
}: {
  acquire: () => VsCodeWebviewApi;
}): ReactElement {
  const bridgeRef = useRef<(Bridge & { dispose(): void }) | null>(null);
  // Acquire-in-render: under StrictMode this runs on the throw-away first mount; the cleanup below
  // disposes it; on remount the ref still holds the DISPOSED bridge (not null) so it is NOT recreated
  // (and a second acquire would throw) → the window 'message' listener is gone → responses dropped.
  if (bridgeRef.current === null) {
    const api = acquire();
    bridgeRef.current = createPostMessageBridge(api, {});
  }
  useEffect(() => {
    return () => bridgeRef.current?.dispose();
  }, []);
  return (
    <RoomApp
      bridge={bridgeRef.current}
      roomId={ROOM_ID}
      operatorHandle="operator"
    />
  );
}

let container: HTMLElement;
let root: Root;
let liveHost: HostBridge | null = null;

beforeAll(async () => {
  await prewarmHighlighter();
  expect(isHighlighterWarm()).toBe(true);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  liveHost?.dispose();
  liveHost = null;
});

async function mountUnderStrictMode(node: ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<StrictMode>{node}</StrictMode>);
  });
  // Let the bridge round-trip (readRoom + readContract responses) settle through the message channel.
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('webview↔host bridge round-trip under StrictMode (Epic-10 defect-fix)', () => {
  it('FIXED lifecycle: the room LOADS over the real bridge (not stuck on "opening room…")', async () => {
    const dataAccess = await seedLedger();
    const { acquire, hostBridge } = wireRealBridges(dataAccess);
    liveHost = hostBridge;

    await mountUnderStrictMode(<FixedRoot acquire={acquire} />);

    // The room rendered: the seeded reply body is in the DOM and the loading placeholder is gone.
    expect(container.querySelector('[data-testid="room-loading"]')).toBeNull();
    expect(container.querySelector('[data-testid="room-app"]')).not.toBeNull();
    expect(container.textContent).toContain('gRPC is faster than REST here');
  });

  it('OLD lifecycle (mutation guard): STAYS STUCK on "opening room…" — proves the test discriminates', async () => {
    const dataAccess = await seedLedger();
    const { acquire, hostBridge } = wireRealBridges(dataAccess);
    liveHost = hostBridge;

    await mountUnderStrictMode(<OldRoot acquire={acquire} />);

    // The defect: the disposed-without-recreation bridge dropped the responses → still loading.
    expect(
      container.querySelector('[data-testid="room-loading"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain('opening room…');
    expect(container.textContent).not.toContain(
      'gRPC is faster than REST here',
    );
  });
});
