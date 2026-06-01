// DOM render test for the web control-room shell (Story 9.4 — Rule 3 real-runtime evidence
// for the UI surface: asserts observable rendered DOM, not internal state).
//
// Runs in the happy-dom project. `fetch` and `EventSource` are stubbed at the global so the
// shell's mount-time JSON-API loads (operator, NEEDS YOU, directory, per-project rooms) and
// SSE open are driven deterministically. This proves the apps/web shell consumes the JSON
// API + SSE shapes the host emits, mounts the @agentbbs/ui-shared NavTree, lists EVERY
// project/room (global read), shows the escalated room under NEEDS YOU, and bumps a room's
// unread `•`/count live when an SSE reply delta arrives.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

import type { Root } from 'react-dom/client';

/** A controllable fake EventSource captured so the test can push a delta. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  listeners: Record<string, ((ev: MessageEvent<string>) => void)[]> = {};
  closed = false;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (ev: MessageEvent<string>) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  emitMessage(data: string): void {
    for (const fn of this.listeners.message ?? []) {
      fn({ data } as MessageEvent<string>);
    }
  }
  close(): void {
    this.closed = true;
  }
}

/** The JSON-API responses keyed by path — a small seeded board with one escalated room. */
const RESPONSES: Record<string, unknown> = {
  '/api/me': { handle: 'ops' },
  '/api/needs-you': {
    rooms: [
      {
        room_id: 'need-a-decision',
        project_id: 'calling-interface',
        subject: 'Need a decision',
        body: '',
        posted_by: 'alice',
        seq: 7,
        active: true,
      },
    ],
  },
  '/api/directory': {
    projects: [
      {
        project_id: 'calling-interface',
        title: 'Calling Interface',
        description: 'How agents dial in.',
        announcer: 'alice',
        members: ['alice'],
      },
      {
        project_id: 'payments',
        title: 'Payments',
        description: 'Money.',
        announcer: 'bob',
        members: ['bob'],
      },
    ],
  },
  '/api/projects/calling-interface/rooms': {
    rooms: [
      {
        room_id: 'need-a-decision',
        project_id: 'calling-interface',
        subject: 'Need a decision',
        body: '',
        posted_by: 'alice',
        seq: 7,
        active: true,
      },
    ],
  },
  '/api/projects/calling-interface/announcements': { announcements: [] },
  '/api/projects/payments/rooms': {
    rooms: [
      {
        room_id: 'ledger-rollover',
        project_id: 'payments',
        subject: 'Ledger rollover',
        body: '',
        posted_by: 'bob',
        seq: 9,
        active: true,
      },
    ],
  },
  '/api/projects/payments/announcements': { announcements: [] },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = RESPONSES[url];
      if (body === undefined) return new Response('nope', { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  vi.stubGlobal(
    'EventSource',
    FakeEventSource as unknown as typeof EventSource,
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  FakeEventSource.last = undefined;
});

/** Flush microtasks so the mount-time fetch chain resolves into the DOM. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

describe('App shell — NavTree from the JSON API + live SSE decorations (Story 9.4)', () => {
  it('mounts the ui-shared NavTree and lists EVERY project/room (global read)', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();

    // The shared NavTree is mounted in the web surface (cross-package).
    expect(container.querySelector('.nav-tree')).not.toBeNull();
    // Global read: both projects + their rooms are present.
    expect(
      container.querySelector('[data-project-id="calling-interface"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-project-id="payments"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-project-id="payments"] [data-room-id="ledger-rollover"]',
      ),
    ).not.toBeNull();
    // The operator (you) row reflects /api/me.
    expect(
      container.querySelector('[data-testid="nav-operator"]')?.textContent,
    ).toContain('ops');
  });

  it('renders the escalated room under NEEDS YOU (warm, not red)', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();

    const section = container.querySelector(
      '[data-testid="needs-you-section"]',
    );
    expect(section).not.toBeNull();
    const item = section?.querySelector('[data-testid="needs-you-item"]');
    expect(item?.textContent).toContain('Need a decision');
    expect(section?.outerHTML.toLowerCase()).not.toContain('red');
  });

  it('bumps a room unread • + activity count when an SSE reply delta arrives', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();

    const roomSel =
      '[data-project-id="payments"] [data-room-id="ledger-rollover"]';
    // Initially read (° faint glyph), no badge.
    expect(
      container.querySelector(`${roomSel} [data-testid="unread-glyph"]`)
        ?.textContent,
    ).toBe('°');
    expect(
      container.querySelector(`${roomSel} [data-testid="unread-badge"]`),
    ).toBeNull();

    // Push a reply delta for that room.
    await act(async () => {
      FakeEventSource.last?.emitMessage(
        JSON.stringify({
          seq: 20,
          type: 'room.replied',
          actor: 'bob',
          created_at: '2026-06-01T00:00:00.000Z',
          payload: { room_id: 'ledger-rollover', body: 'ping' },
        }),
      );
    });

    // Now unread (• accent glyph) with an activity badge of 1.
    expect(
      container.querySelector(`${roomSel} [data-testid="unread-glyph"]`)
        ?.textContent,
    ).toBe('•');
    expect(
      container.querySelector(`${roomSel} [data-testid="unread-badge"]`)
        ?.textContent,
    ).toBe('1');
  });
});
