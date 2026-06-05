// QA seam coverage (Story 10.4, AC2/AC4) — DOM-tier proofs the dev's RoomApp.test.tsx skipped.
//
// Runs in the happy-dom (ui-shared-dom) project — root `pnpm test` maps it via the
// apps/vscode-extension/src/**/*.test.tsx glob (Rule 12 corollary; a per-package vitest run would
// FALSELY report `document is not defined`). A FAKE Bridge stands in for the postMessage channel.
// prewarmHighlighter (9.5-shiki carry) — RoomView renders inert markdown bodies.
//
// SEAMS the dev DOM test skipped (Rule-12 NECESSARY-NOT-SUFFICIENT tier; the load-bearing real
// proof stays host-tests/room-panel.in-host.ts):
//   (d) the 👍 ReactionChip is NOT a dead click — clicking it in the MOUNTED RoomApp fires the
//       EXISTING `react`/`unreact` bridge op for the CORRECT message seq, and toggles react↔unreact
//       from the operator's CURRENT live state (the bridge-client/bridge tiers prove dispatch +
//       core mapping; THIS proves the component actually wires the chip onClick through to it);
//   (agreedSeq render) a readContract-derived agreedSeq actually paints the ✓ AgreedMark on the
//       converged post (bridge-client.test.ts proves the NUMBER is computed; this proves it RENDERS);
//   (watching dead-click) a WATCHING operator's chip is the disabled "join to react" hand-off — it
//       does NOT fire a bridge react (no backdoor for a non-participant; Rule 13).

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

/** An ACTIVE room with a reply the operator has NOT yet 👍'd — operator IS a participant (peer). */
function activeRoom(operatorReactedSeqs: number[] = []): ReadRoomResult {
  return {
    room: {
      roomId: 'calling-interface',
      projectId: 'acme',
      subject: 'Calling interface',
      body: 'Should we use **REST** or gRPC?',
      postedBy: 'alice',
      seq: 5,
      active: true,
      activatedBy: 'bob',
      activatedAtSeq: 7,
    },
    messages: [
      {
        seq: 5,
        actor: 'alice',
        body: 'Should we use **REST** or gRPC?',
        kind: 'announcement',
        reactions: [],
      },
      {
        seq: 7,
        actor: 'bob',
        body: 'gRPC — final.',
        kind: 'reply',
        reactions: operatorReactedSeqs.includes(7) ? ['operator'] : [],
      },
    ],
    participants: ['alice', 'bob', 'operator'],
  };
}

/** A contract pointing at seq 7 (the converged message → the ✓ agreed mark target). */
const CONTRACT_ON_7: ReadContractResult = {
  roomId: 'calling-interface',
  contract: {
    seq: 7,
    actor: 'bob',
    body: 'gRPC — final.',
    kind: 'reply',
    reactions: ['operator'],
  },
};

const NO_CONTRACT: ReadContractResult = {
  roomId: 'calling-interface',
  contract: null,
};

/**
 * A scripted fake bridge whose readRoom snapshot reflects the operator's 👍 state, flipped by the
 * recorded react/unreact writes — so a re-read after a toggle shows the authoritative result.
 */
function reactBridge(opts: { contract?: ReadContractResult } = {}): Bridge & {
  reactCalls: Array<{ op: string; messageSeq: number }>;
  operatorReactedSeqs: Set<number>;
} {
  const state = {
    reactCalls: [] as Array<{ op: string; messageSeq: number }>,
    operatorReactedSeqs: new Set<number>(),
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
            activeRoom([...bridge.operatorReactedSeqs]) as T,
          );
        case 'readContract':
          return Promise.resolve((opts.contract ?? NO_CONTRACT) as T);
        case 'react': {
          const seq = args['messageSeq'] as number;
          bridge.reactCalls.push({ op, messageSeq: seq });
          bridge.operatorReactedSeqs.add(seq);
          return Promise.resolve({
            messageSeq: seq,
            reactions: ['operator'],
          } as T);
        }
        case 'unreact': {
          const seq = args['messageSeq'] as number;
          bridge.reactCalls.push({ op, messageSeq: seq });
          bridge.operatorReactedSeqs.delete(seq);
          return Promise.resolve({ messageSeq: seq, reactions: [] } as T);
        }
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
  await act(async () => {
    await Promise.resolve();
  });
}

/** Click a reaction chip + let the write + re-read settle. */
async function clickChip(chip: Element): Promise<void> {
  await act(async () => {
    (chip as HTMLButtonElement).click();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('RoomApp — 👍 ReactionChip is NOT a dead click (AC2/Rule 13 seam d)', () => {
  it('a PEER clicking the chip fires the existing `react` op for that message seq, then a SECOND click fires `unreact`', async () => {
    const bridge = reactBridge();
    await mountApp(bridge, 'operator');

    // Target the REPLY post (body "gRPC — final.", seq 7) and its (enabled, peer-reactable) chip —
    // both posts are reactable for a peer, so we pin the SPECIFIC post to prove the chip wires the
    // correct seq through (not whichever chip happens to be first).
    const replyPost = [
      ...container.querySelectorAll('[data-testid="message-post"]'),
    ].find((p) => p.textContent?.includes('final'));
    expect(replyPost, 'the reply post must render').toBeDefined();
    const replyChip = replyPost!.querySelector('[data-testid="reaction-chip"]');
    expect(replyChip?.getAttribute('data-state')).not.toBe('cannot-react');

    // 1st click → react(messageSeq:7). Not a dead click: the bridge records the call for seq 7.
    await clickChip(replyChip!);
    expect(bridge.reactCalls).toEqual([{ op: 'react', messageSeq: 7 }]);

    // The re-read reflects the 👍 — the reply post's chip now reads `reacted`.
    const afterReact = [
      ...container.querySelectorAll('[data-testid="message-post"]'),
    ]
      .find((p) => p.textContent?.includes('final'))!
      .querySelector('[data-testid="reaction-chip"]')!;
    expect(afterReact.getAttribute('data-reacted')).toBe('true');

    // 2nd click → unreact (decided from the CURRENT live state, not a fixed op).
    await clickChip(afterReact);
    expect(bridge.reactCalls).toEqual([
      { op: 'react', messageSeq: 7 },
      { op: 'unreact', messageSeq: 7 },
    ]);
  });

  it('a WATCHING operator (non-participant) cannot react — the chip is the disabled join hand-off, no bridge write', async () => {
    const bridge = reactBridge();
    // `null` handle → watching; the operator is not in participants → canReact=false.
    await mountApp(bridge, null);
    const chip = container.querySelector('[data-testid="reaction-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('cannot-react');
    // Clicking the disabled chip fires NO bridge react (Rule 13 — no non-participant backdoor).
    await clickChip(chip!);
    expect(bridge.reactCalls).toEqual([]);
  });
});

describe('RoomApp — agreedSeq from readContract RENDERS the ✓ agreed mark (AC2 seam)', () => {
  it('paints the AgreedMark on the converged post when readContract points at its seq', async () => {
    const bridge = reactBridge({ contract: CONTRACT_ON_7 });
    await mountApp(bridge, 'operator');
    // The converged message (seq 7) shows the ✓ agreed mark; bridge-client proves the NUMBER,
    // this proves it actually RENDERS in the mounted thread.
    expect(
      container.querySelector('[data-testid="agreed-mark-footer"]'),
    ).not.toBeNull();
  });

  it('renders NO agreed mark when readContract returns null (no converged message)', async () => {
    const bridge = reactBridge({ contract: NO_CONTRACT });
    await mountApp(bridge, 'operator');
    expect(
      container.querySelector('[data-testid="agreed-mark-footer"]'),
    ).toBeNull();
  });
});
