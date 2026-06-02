// DOM render test for the VS Code webview RoomApp (Story 10.4, AC2/AC4).
//
// Runs in the happy-dom project (the SECOND cross-package DOM consumer of ui-shared — the webview
// mounts the SAME RoomView the web does, byte-shared, Rule 13). A FAKE Bridge stands in for the
// host↔webview postMessage channel; it answers readRoom/readContract and records reply/react
// writes (the bridge dispatch itself is proven host-side in bridge.test.ts + the real Electron
// host). This is the Rule-12 NECESSARY-NOT-SUFFICIENT DOM tier; the load-bearing real-runtime
// proof is host-tests/room-panel.in-host.ts (panel opens, bridge round-trip, proto-room reply
// activates). prewarmHighlighter (9.5-shiki carry) — RoomView renders inert markdown post bodies.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prewarmHighlighter } from '@agentbbs/ui-shared';

import { RoomApp } from './RoomApp.js';

import type {
  Bridge,
  ReadContractResult,
  ReadRoomResult,
} from './bridge-client.js';
import type { Root } from 'react-dom/client';

/** A proto-room (active:false, only the announcement, no participants) — the AC4 starting state. */
const PROTO_ROOM: ReadRoomResult = {
  room: {
    roomId: 'calling-interface',
    projectId: 'acme',
    subject: 'Calling interface',
    body: 'Should we use **REST** or gRPC?',
    postedBy: 'alice',
    seq: 5,
    active: false,
  },
  messages: [
    {
      seq: 5,
      actor: 'alice',
      body: 'Should we use **REST** or gRPC?',
      kind: 'announcement',
      reactions: [],
    },
  ],
  participants: [],
};

/** The SAME room AFTER the operator replies — active:true, operator is now a participant (peer). */
const ACTIVATED_ROOM: ReadRoomResult = {
  room: {
    ...PROTO_ROOM.room,
    active: true,
    activatedBy: 'operator',
    activatedAtSeq: 9,
  },
  messages: [
    ...PROTO_ROOM.messages,
    {
      seq: 9,
      actor: 'operator',
      body: 'Let us go with gRPC.',
      kind: 'reply',
      reactions: [],
    },
  ],
  participants: ['operator'],
};

const NO_CONTRACT: ReadContractResult = {
  roomId: 'calling-interface',
  contract: null,
};

/**
 * A scripted fake bridge: returns the CURRENT readRoom snapshot (proto until a reply lands, then
 * activated), records reply/react writes. `replyCount` proves the AC4 reply fired through the
 * EXISTING `reply` op (not a fabricated activate op).
 */
function scriptedBridge(): Bridge & {
  replyCount: number;
  reactCalls: Array<{ op: string; messageSeq: number }>;
  activated: boolean;
} {
  const state = {
    replyCount: 0,
    reactCalls: [] as Array<{ op: string; messageSeq: number }>,
    activated: false,
  };
  const bridge: Bridge & typeof state = {
    ...state,
    request<T = unknown>(
      op: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      switch (op) {
        case 'readRoom':
          return Promise.resolve(
            (bridge.activated ? ACTIVATED_ROOM : PROTO_ROOM) as T,
          );
        case 'readContract':
          return Promise.resolve(NO_CONTRACT as T);
        case 'reply':
          bridge.replyCount += 1;
          bridge.activated = true; // the min-seq activator flips the room active (Epic-4)
          return Promise.resolve({ room: ACTIVATED_ROOM.room } as T);
        case 'react':
        case 'unreact':
          bridge.reactCalls.push({
            op,
            messageSeq: args['messageSeq'] as number,
          });
          return Promise.resolve({
            messageSeq: args['messageSeq'],
            reactions: op === 'react' ? ['operator'] : [],
          } as T);
        default:
          return Promise.reject(new Error(`unexpected op "${op}"`));
      }
    },
  };
  return bridge;
}

let container: HTMLElement;
let root: Root;

beforeAll(async () => {
  await prewarmHighlighter();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mountApp(
  bridge: Bridge,
  operatorHandle: string | null,
): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <RoomApp
        bridge={bridge}
        roomId="calling-interface"
        operatorHandle={operatorHandle}
      />,
    );
  });
  // Let the mount-time load (readRoom + readContract) settle.
  await act(async () => {
    await Promise.resolve();
  });
}

describe('RoomApp — mounts the byte-shared RoomView fed by the bridge (AC2)', () => {
  it('renders the RoomView breadcrumb + the announcement message from the bridge', async () => {
    await mountApp(scriptedBridge(), 'operator');
    expect(container.querySelector('[data-testid="room-view"]')).not.toBeNull();
    expect(container.querySelector('.breadcrumb-room')?.textContent).toContain(
      'calling-interface',
    );
    // The announcement body renders inert (markdown → DOM) inside the thread.
    expect(container.textContent).toContain('REST');
  });

  it('a WATCHING operator (not a participant) sees the join-gate composer + watching posture', async () => {
    await mountApp(scriptedBridge(), 'operator');
    const posture = container.querySelector('[data-testid="operator-posture"]');
    expect(posture?.getAttribute('data-posture')).toBe('watching');
    // The proto-room composer shows the `[ join room to post ]` gate (not the field).
    const composer = container.querySelector('[data-testid="composer"]');
    expect(composer?.getAttribute('data-joined')).toBe('false');
    expect(
      container.querySelector('[data-testid="composer-join"]'),
    ).not.toBeNull();
  });
});

describe('RoomApp — proto-room reply-to-activate (AC4, Rule 15 respond-parity)', () => {
  it('clicking the gate reveals the field; sending a reply ACTIVATES the room (peer + active) via the existing reply op', async () => {
    const bridge = scriptedBridge();
    await mountApp(bridge, 'operator');

    // 1. Click `[ join room to post ]` → the composer reveals the field (local intent).
    const joinBtn = container.querySelector(
      '[data-testid="composer-join"]',
    ) as HTMLButtonElement;
    await act(async () => {
      joinBtn.click();
    });
    const field = container.querySelector(
      '[data-testid="composer-field"]',
    ) as HTMLInputElement;
    expect(field).not.toBeNull();

    // 2. Type + send → fires the EXISTING `reply` op through the bridge (NOT a fabricated op).
    // Use the native value setter so React's tracked value updates (the Composer.test.tsx pattern).
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'Let us go with gRPC.');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const send = container.querySelector(
      '[data-testid="composer-send"]',
    ) as HTMLButtonElement;
    await act(async () => {
      send.click();
    });
    // Let the reply write + the re-read settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 3. The reply fired through `reply` exactly once (the activation IS a reply — Rule 13/15).
    expect(bridge.replyCount).toBe(1);
    // 4. The re-read shows the room ACTIVATED: the operator is now a peer + the reply is in the thread.
    const posture = container.querySelector('[data-testid="operator-posture"]');
    expect(posture?.getAttribute('data-posture')).toBe('peer');
    expect(container.textContent).toContain('gRPC');
  });
});
