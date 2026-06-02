// Webview bridge-client + RoomViewModel builder tests (Story 10.4, AC2).
//
// Node tier (no DOM): the model BUILD logic mirrors apps/web's buildRoomViewModel — fed by a FAKE
// Bridge (the injectable transport seam) instead of HTTP. Proves the bridge `readRoom` +
// `readContract` results map to the SAME ui-shared RoomViewModel the web produces (posture +
// agreed seq + seq-ordered messages). Discoverable by ROOT `pnpm test` (co-located .test.ts →
// node project; Rule 8). The createPostMessageBridge `window`-channel path is exercised by the
// DOM-tier + real-host evidence; here we test the pure model logic.

import { describe, expect, it } from 'vitest';

import {
  buildRoomViewModel,
  loadRoomViewModel,
  type Bridge,
  type ReadContractResult,
  type ReadRoomResult,
} from './bridge-client.js';

/** A fake bridge that answers readRoom/readContract from a fixed map (the web's fetchImpl analogue). */
function fakeBridge(answers: Record<string, unknown>): Bridge {
  return {
    request<T = unknown>(op: string): Promise<T> {
      if (!(op in answers)) {
        return Promise.reject(new Error(`no fake answer for op "${op}"`));
      }
      return Promise.resolve(answers[op] as T);
    },
  };
}

const room: ReadRoomResult = {
  room: {
    roomId: 'calling-interface',
    projectId: 'acme',
    subject: 'Calling interface',
    body: 'Should we use REST?',
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
      body: 'Should we use REST?',
      kind: 'announcement',
      reactions: [],
    },
    {
      seq: 7,
      actor: 'bob',
      body: 'gRPC is faster',
      kind: 'reply',
      reactions: ['alice'],
    },
  ],
  participants: ['alice', 'bob'],
};

describe('buildRoomViewModel — mirrors apps/web mapping (AC2)', () => {
  it('maps the bridge readRoom result to the ui-shared RoomViewModel, seq order preserved', () => {
    const vm = buildRoomViewModel(room, 'alice');
    expect(vm.roomId).toBe('calling-interface');
    expect(vm.projectId).toBe('acme');
    expect(vm.subject).toBe('Calling interface');
    expect(vm.participants).toEqual(['alice', 'bob']);
    expect(vm.messages.map((m) => m.seq)).toEqual([5, 7]);
    expect(vm.messages[1]).toMatchObject({
      kind: 'reply',
      reactions: ['alice'],
    });
    expect(vm.operatorHandle).toBe('alice');
  });

  it('computes posture PEER when the operator is a participant', () => {
    const vm = buildRoomViewModel(room, 'bob');
    expect(vm.operatorPosture).toEqual({ kind: 'peer', handle: 'bob' });
  });

  it('computes posture WATCHING when the operator is NOT a participant (or null)', () => {
    expect(buildRoomViewModel(room, 'stranger').operatorPosture).toEqual({
      kind: 'watching',
    });
    expect(buildRoomViewModel(room, null).operatorPosture).toEqual({
      kind: 'watching',
    });
  });

  it('agreedSeq is the contract seq when a contract exists, else null', () => {
    const contract: ReadContractResult = {
      roomId: 'calling-interface',
      contract: {
        seq: 7,
        actor: 'bob',
        body: 'gRPC is faster',
        kind: 'reply',
        reactions: ['alice'],
      },
    };
    expect(buildRoomViewModel(room, 'alice', contract).agreedSeq).toBe(7);
    expect(
      buildRoomViewModel(room, 'alice', {
        roomId: 'calling-interface',
        contract: null,
      }).agreedSeq,
    ).toBeNull();
    expect(buildRoomViewModel(room, 'alice').agreedSeq).toBeNull();
  });
});

describe('loadRoomViewModel — one-call load over the bridge (AC2)', () => {
  it('requests readRoom + readContract and builds the model', async () => {
    const bridge = fakeBridge({
      readRoom: room,
      readContract: {
        roomId: 'calling-interface',
        contract: {
          seq: 7,
          actor: 'bob',
          body: 'gRPC is faster',
          kind: 'reply',
          reactions: ['alice'],
        },
      } satisfies ReadContractResult,
    });
    const vm = await loadRoomViewModel(bridge, 'calling-interface', 'bob');
    expect(vm.roomId).toBe('calling-interface');
    expect(vm.operatorPosture).toEqual({ kind: 'peer', handle: 'bob' });
    expect(vm.agreedSeq).toBe(7);
  });
});
