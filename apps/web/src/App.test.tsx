// DOM render test for the web control-room shell (Story 9.3, Task 4 — Rule 3
// real-runtime evidence for the UI surface: asserts observable rendered DOM, not
// internal state).
//
// Runs in the happy-dom project (browser-like DOM). `fetch` and `EventSource` are
// stubbed at the global so the shell's mount-time JSON-API fetch + SSE open are driven
// deterministically: the directory fetch resolves real-shaped board data and the shell
// renders the project list from it; an injected SSE delta advances the live counter in
// the DOM. This proves the apps/web client consumes the JSON-API + SSE shapes the host
// emits (the same shapes the AC3 integration test proves the host produces) and that it
// mounts @agentbbs/ui-shared (the TokenProbe) in a real web surface.

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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            projects: [
              {
                project_id: 'calling-interface',
                title: 'Calling Interface',
                description: 'How agents dial in.',
                announcer: 'alice',
                members: ['alice'],
              },
            ],
          }),
          { status: 200 },
        ),
    ),
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

/** Flush microtasks so the mount-time fetch promise resolves into the DOM. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App shell — renders real JSON-API data + SSE deltas', () => {
  it('renders the project list from the JSON API and mounts the ui-shared TokenProbe', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();

    // The ui-shared design-token core is mounted in the web surface (cross-package).
    expect(
      container.querySelector('[data-testid="token-probe"]'),
    ).not.toBeNull();

    // The project list is rendered from the (stubbed) real-shaped directory response.
    const list = container.querySelector('[data-testid="project-list"]');
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain('Calling Interface');
    expect(
      container.querySelector('[data-project-id="calling-interface"]'),
    ).not.toBeNull();
  });

  it('advances the live delta counter when an SSE delta arrives', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();

    expect(
      container.querySelector('[data-testid="live-count"]')?.textContent,
    ).toBe('0');

    // Push an SSE delta through the captured fake EventSource.
    await act(async () => {
      FakeEventSource.last?.emitMessage(
        JSON.stringify({
          seq: 42,
          type: 'announcement.posted',
          actor: 'alice',
          created_at: '2026-06-01T00:00:00.000Z',
          payload: {},
        }),
      );
    });

    expect(
      container.querySelector('[data-testid="live-seq"]')?.textContent,
    ).toBe('42');
    expect(
      container.querySelector('[data-testid="live-count"]')?.textContent,
    ).toBe('1');
  });
});
