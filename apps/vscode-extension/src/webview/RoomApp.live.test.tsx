// DOM test for the RoomApp LIVE FOLD + theme + footer (Story 10.6, AC1/AC2/AC3).
//
// Runs in the happy-dom project (the webview mounts the SAME ui-shared RoomView the web does,
// byte-shared, Rule 13). A FAKE Bridge answers readRoom/readContract/reply/react and a capturable
// `subscribeToDeltas` lets the test PUSH host delta frames (RAW CORE Events, camelCase) so the
// assertions exercise the live fold the way main.tsx wires it to the postMessage bridge's `onDelta`.
// This is the Rule-12 NECESSARY-NOT-SUFFICIENT DOM tier; the load-bearing real-runtime proof (a real
// pushed delta lands+folds, ColorThemeKind detection) is host-tests/room-panel.in-host.ts.
//
// prewarmHighlighter (9.5-shiki carry, now MATERIAL per the 10.5 full-suite flake): RoomView renders
// inert markdown bodies; warm the highlighter once + ASSERT it is warm (the 9.5 hardening the item
// suggested) so a cold-highlighter flake is caught deterministically here rather than intermittently.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isHighlighterWarm, prewarmHighlighter } from '@agentbbs/ui-shared';

import { RoomApp } from './RoomApp.js';

import type {
  Bridge,
  ReadContractResult,
  ReadRoomResult,
} from './bridge-client.js';
import type { Root } from 'react-dom/client';

/** An ACTIVE room: announcement (#5) + one reply (#7); the operator is a participant (peer). */
const ROOM: ReadRoomResult = {
  room: {
    roomId: 'calling-interface',
    projectId: 'acme',
    subject: 'Calling interface',
    body: 'Should we use REST?',
    postedBy: 'alice',
    seq: 5,
    active: true,
  },
  messages: [
    {
      seq: 5,
      actor: 'alice',
      body: 'Should we use REST?',
      kind: 'announcement',
      reactions: [],
    },
    {
      seq: 7,
      actor: 'bob',
      body: 'gRPC is faster',
      kind: 'reply',
      reactions: [],
    },
  ],
  participants: ['alice', 'bob', 'operator'],
};

const NO_CONTRACT: ReadContractResult = {
  roomId: 'calling-interface',
  contract: null,
};

/** A fake bridge with a mutable readRoom snapshot the test can advance + recorded writes. */
function liveBridge(): Bridge & {
  snapshot: ReadRoomResult;
  replyCount: number;
} {
  const state = { snapshot: ROOM, replyCount: 0 };
  const bridge: Bridge & typeof state = {
    ...state,
    request<T = unknown>(
      op: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      switch (op) {
        case 'readRoom':
          return Promise.resolve(bridge.snapshot as T);
        case 'readContract':
          return Promise.resolve(NO_CONTRACT as T);
        case 'reply': {
          bridge.replyCount += 1;
          // The re-read after a reply carries the confirmed post (mirrors the host grant-on-act).
          bridge.snapshot = {
            ...bridge.snapshot,
            messages: [
              ...bridge.snapshot.messages,
              {
                seq: 11,
                actor: 'operator',
                body: args['body'] as string,
                kind: 'reply',
                reactions: [],
              },
            ],
          };
          return Promise.resolve({ room: bridge.snapshot.room } as T);
        }
        case 'react':
        case 'unreact':
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

/** A capturable delta channel: the test pushes raw core events through `emit`. */
function deltaChannel() {
  let handler: ((events: unknown[]) => void) | null = null;
  return {
    subscribe(h: (events: unknown[]) => void): () => void {
      handler = h;
      return () => {
        handler = null;
      };
    },
    async emit(events: unknown[]): Promise<void> {
      await act(async () => {
        handler?.(events);
        await Promise.resolve();
      });
    },
  };
}

let container: HTMLElement;
let root: Root;

beforeAll(async () => {
  await prewarmHighlighter();
  // 9.5 hardening: assert the highlighter is warm so a cold-highlighter flake fails deterministically.
  expect(isHighlighterWarm()).toBe(true);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mountApp(
  bridge: Bridge,
  opts: {
    operatorHandle?: string | null;
    subscribeToDeltas?: (h: (events: unknown[]) => void) => () => void;
    highContrast?: boolean;
    connectionStatus?: 'connected' | 'reconnecting';
  } = {},
): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <RoomApp
        bridge={bridge}
        roomId="calling-interface"
        operatorHandle={opts.operatorHandle ?? 'operator'}
        subscribeToDeltas={opts.subscribeToDeltas}
        highContrast={opts.highContrast}
        connectionStatus={opts.connectionStatus}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('RoomApp live fold — a pushed delta folds into the open thread (AC1)', () => {
  it('a room.replied delta APPENDS the new post LIVE (no reload)', async () => {
    const channel = deltaChannel();
    await mountApp(liveBridge(), { subscribeToDeltas: channel.subscribe });
    expect(container.textContent).not.toContain('I prefer gRPC streaming');

    await channel.emit([
      {
        seq: 9,
        type: 'room.replied',
        actor: 'carol',
        createdAt: '2026-06-02T00:00:00.000Z',
        payload: {
          roomId: 'calling-interface',
          body: 'I prefer gRPC streaming',
        },
      },
    ]);

    // The new reply is in the thread WITHOUT a re-read (the fold appended it).
    expect(container.textContent).toContain('I prefer gRPC streaming');
  });

  it('a message.reacted delta MOVES the agreed mark to the highest-seq live-👍 post (FR21)', async () => {
    const channel = deltaChannel();
    await mountApp(liveBridge(), { subscribeToDeltas: channel.subscribe });
    // No agreed mark initially (no live 👍).
    expect(container.querySelector('[data-testid^="agreed-mark"]')).toBeNull();

    // 👍 on the higher-seq reply (#7) → the agreed mark appears on it.
    await channel.emit([
      {
        seq: 100,
        type: 'message.reacted',
        actor: 'alice',
        payload: { messageSeq: 7 },
      },
    ]);
    expect(
      container.querySelector('[data-testid^="agreed-mark"]'),
    ).not.toBeNull();
  });

  it('OUT-OF-ORDER deltas (a higher seq then a lower one) still RENDER in seq order (QA seam)', async () => {
    // The reducer appends in arrival order; the webview-mounted ui-shared MessageThread sorts by seq
    // defensively at render. This pins that the VS Code mount inherits that sort — a lower-seq reply
    // delivered AFTER a higher-seq one still appears in the correct thread position, not at the bottom.
    const channel = deltaChannel();
    await mountApp(liveBridge(), { subscribeToDeltas: channel.subscribe });
    // Higher seq (#11) arrives first…
    await channel.emit([
      {
        seq: 11,
        type: 'room.replied',
        actor: 'carol',
        payload: { roomId: 'calling-interface', body: 'ZZ higher-seq later' },
      },
    ]);
    // …then a lower seq (#9) arrives.
    await channel.emit([
      {
        seq: 9,
        type: 'room.replied',
        actor: 'dave',
        payload: { roomId: 'calling-interface', body: 'AA lower-seq earlier' },
      },
    ]);
    const text = container.textContent ?? '';
    // The lower-seq body (#9) must appear BEFORE the higher-seq body (#11) in the rendered DOM order,
    // despite arriving second — the render sort keys on seq, not arrival.
    expect(text).toContain('AA lower-seq earlier');
    expect(text).toContain('ZZ higher-seq later');
    expect(text.indexOf('AA lower-seq earlier')).toBeLessThan(
      text.indexOf('ZZ higher-seq later'),
    );
  });

  it('a delta for a DIFFERENT room does not change the thread (no-op fold)', async () => {
    const channel = deltaChannel();
    await mountApp(liveBridge(), { subscribeToDeltas: channel.subscribe });
    const before = container.textContent;
    await channel.emit([
      {
        seq: 9,
        type: 'room.replied',
        actor: 'z',
        payload: { roomId: 'other', body: 'elsewhere' },
      },
    ]);
    expect(container.textContent).toBe(before);
  });
});

describe('RoomApp optimistic reply → reconcile (AC1)', () => {
  it('the reply echoes immediately then reconciles to ONE confirmed post (no duplicate)', async () => {
    const bridge = liveBridge();
    await mountApp(bridge, {});
    // Reveal the field (peer operator can send; for a peer the composer is already joined).
    const field = container.querySelector(
      '[data-testid="composer-field"]',
    ) as HTMLInputElement;
    expect(field).not.toBeNull();
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
    // Let the reply write + re-read settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.replyCount).toBe(1);
    // Exactly ONE copy of the sent body (echo reconciled to the confirmed post — no duplicate).
    const matches =
      container.textContent?.match(/Let us go with gRPC\./g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe('RoomApp connection footer + high-contrast (AC2/AC3)', () => {
  it('renders the calm ConnectionFooter LED reflecting the channel status', async () => {
    await mountApp(liveBridge(), { connectionStatus: 'connected' });
    const footer = container.querySelector('[data-testid="connection-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.getAttribute('data-status')).toBe('connected');
  });

  it('passes highContrast through to RoomView (the agreed-wash → transparent gate)', async () => {
    // Under HC, the converged post's translucent wash must render TRANSPARENT (the ui-shared
    // MessagePost gate). Push a 👍 delta so the agreed mark appears, then assert no rgba wash.
    const channel = deltaChannel();
    await mountApp(liveBridge(), {
      highContrast: true,
      subscribeToDeltas: channel.subscribe,
    });
    await channel.emit([
      {
        seq: 100,
        type: 'message.reacted',
        actor: 'alice',
        payload: { messageSeq: 7 },
      },
    ]);
    const agreed = container.querySelector('[data-testid^="agreed-mark"]');
    expect(agreed).not.toBeNull();
    // The MessagePost wrapper background under HC is transparent (NOT the rgba green wash).
    expect(container.innerHTML).not.toContain('rgba(78, 192, 122, 0.07)');
  });

  it('renders the agreed WASH (rgba tint) when NOT high-contrast — proves the gate is real', async () => {
    // The mirror of the HC test (mutation guard): without HC the wash IS the rgba tint, so the
    // HC assertion above is non-vacuous (it would also pass if the wash never rendered at all).
    const channel = deltaChannel();
    await mountApp(liveBridge(), {
      highContrast: false,
      subscribeToDeltas: channel.subscribe,
    });
    await channel.emit([
      {
        seq: 100,
        type: 'message.reacted',
        actor: 'alice',
        payload: { messageSeq: 7 },
      },
    ]);
    expect(
      container.querySelector('[data-testid^="agreed-mark"]'),
    ).not.toBeNull();
    expect(container.innerHTML).toContain('rgba(78, 192, 122, 0.07)');
  });
});
