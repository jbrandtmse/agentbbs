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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { prewarmHighlighter } from '@agentbbs/ui-shared';

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
  /** Story 9.10 — fire the SSE `open` (channel live → connected footer LED). */
  emitOpen(): void {
    for (const fn of this.listeners.open ?? []) {
      fn({} as MessageEvent<string>);
    }
  }
  /** Story 9.10 — fire the SSE `error` (dropped; auto-reconnect → reconnecting footer LED). */
  emitError(): void {
    for (const fn of this.listeners.error ?? []) {
      fn({} as MessageEvent<string>);
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
  // Story 9.5 — opening a room loads its thread (/api/rooms/:id → room + messages +
  // participants, each message carrying a display created_at). `ops` is a participant here
  // (it replied), so the operator posture resolves to peer.
  '/api/rooms/ledger-rollover': {
    room: {
      room_id: 'ledger-rollover',
      project_id: 'payments',
      subject: 'Ledger rollover',
      body: 'How do we roll the ledger?',
      posted_by: 'bob',
      seq: 9,
      active: true,
      activated_by: 'ops',
      activated_at_seq: 10,
    },
    messages: [
      {
        seq: 9,
        actor: 'bob',
        body: 'How do we roll the ledger?',
        kind: 'announcement',
        reactions: [],
        created_at: '2026-06-01T08:00:00.000Z',
      },
      {
        seq: 10,
        actor: 'ops',
        body: 'Let us **discuss**.',
        kind: 'reply',
        reactions: [],
        created_at: '2026-06-01T08:05:00.000Z',
      },
    ],
    participants: ['ops'],
  },
  // Story 9.6 — opening a room also fetches its CONTRACT (the ✓ agreed-mark seq). Start with
  // NO contract (no live 👍 yet); the toggle test drives a react then asserts the mark appears.
  '/api/rooms/ledger-rollover/contract': {
    room_id: 'ledger-rollover',
    contract: null,
  },
};

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  // Story 9.5 room-open test renders RoomView → MarkdownView; warm the highlighter so the
  // synchronous render path produces the inert body on first paint.
  await prewarmHighlighter();
});

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

describe('App shell — opening a room renders the thread (Story 9.5)', () => {
  /** Mount the shell + flush the board load. */
  async function mountAndLoad(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
  }

  it('shows the "Select a room" placeholder before any room is opened', async () => {
    await mountAndLoad();
    expect(container.querySelector('[data-testid="no-room"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="room-view"]')).toBeNull();
  });

  it('clicking a tree room opens its RoomView thread (breadcrumb + seq-ordered inert posts)', async () => {
    await mountAndLoad();

    // Click the payments room row in the tree (Story 9.4 selection → Story 9.5 open).
    const row = container.querySelector<HTMLElement>(
      '[data-project-id="payments"] [data-room-id="ledger-rollover"]',
    );
    expect(row).not.toBeNull();
    await act(async () => {
      row?.click();
    });
    await flush();

    const roomView = container.querySelector('[data-testid="room-view"]');
    expect(roomView).not.toBeNull();
    // Breadcrumb: payments › #ledger-rollover.
    const crumb = roomView?.querySelector('[data-testid="room-breadcrumb"]');
    expect(crumb?.textContent).toContain('payments');
    expect(crumb?.textContent).toContain('#ledger-rollover');
    // The two posts render seq-ordered (announcement #9 then reply #10).
    const seqs = [
      ...(roomView?.querySelectorAll('[data-testid="message-post"]') ?? []),
    ].map((n) => Number(n.getAttribute('data-message-seq')));
    expect(seqs).toEqual([9, 10]);
    // The reply body rendered inert via MarkdownView (a real <strong>, not raw markdown).
    expect(roomView?.querySelector('.markdown-view strong')?.textContent).toBe(
      'discuss',
    );
  });

  it('shows `you: @ops (peer)` posture because ops is a participant of the opened room', async () => {
    await mountAndLoad();
    const row = container.querySelector<HTMLElement>(
      '[data-project-id="payments"] [data-room-id="ledger-rollover"]',
    );
    await act(async () => {
      row?.click();
    });
    await flush();

    const posture = container.querySelector('[data-testid="operator-posture"]');
    expect(posture?.textContent).toBe('you: @ops (peer)');
    expect(posture?.getAttribute('data-posture')).toBe('peer');
  });
});

// --- Story 9.6 — the FULL toggle round-trip through the real App shell (Rule 3 real-runtime
// DOM evidence): open the room, click the 👍 chip on post #10, the shell POSTs react then
// REFETCHES the room + contract, and the chip flips to currently-👍'd + the ✓ agreed mark
// appears on post #10 (head + footer). A STATEFUL fetch stub models the host: the react POST
// flips post #10's reactions to ['ops'] and the contract to seq 10 (the agreed mark is
// COMPUTED from the re-fetched contract, never stored). ---
describe('App shell — 👍 toggle wires the write + recomputes the agreed mark (Story 9.6)', () => {
  let reactPosted: string | null;

  beforeEach(() => {
    reactPosted = null;
    // A stateful host model: before the react, post #10 has no 👍 and there is no contract;
    // after a POST .../messages/10/react, post #10 holds ops's 👍 and the contract is seq 10.
    const roomState = {
      reacted: false,
    };
    const roomEnvelope = () => ({
      room: {
        room_id: 'ledger-rollover',
        project_id: 'payments',
        subject: 'Ledger rollover',
        body: 'How do we roll the ledger?',
        posted_by: 'bob',
        seq: 9,
        active: true,
        activated_by: 'ops',
        activated_at_seq: 10,
      },
      messages: [
        {
          seq: 9,
          actor: 'bob',
          body: 'How do we roll the ledger?',
          kind: 'announcement',
          reactions: [],
          created_at: '2026-06-01T08:00:00.000Z',
        },
        {
          seq: 10,
          actor: 'ops',
          body: 'Let us **discuss**.',
          kind: 'reply',
          reactions: roomState.reacted ? ['ops'] : [],
          created_at: '2026-06-01T08:05:00.000Z',
        },
      ],
      participants: ['ops'],
    });
    const contractEnvelope = () => ({
      room_id: 'ledger-rollover',
      contract: roomState.reacted
        ? {
            seq: 10,
            actor: 'ops',
            body: 'Let us **discuss**.',
            kind: 'reply',
            reactions: ['ops'],
            created_at: '2026-06-01T08:05:00.000Z',
          }
        : null,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') {
          if (url.endsWith('/messages/10/react')) {
            reactPosted = url;
            roomState.reacted = true;
            return new Response(
              JSON.stringify({ message_seq: 10, reactions: ['ops'] }),
              { status: 200 },
            );
          }
          return new Response('nope', { status: 404 });
        }
        if (url === '/api/rooms/ledger-rollover') {
          return new Response(JSON.stringify(roomEnvelope()), { status: 200 });
        }
        if (url === '/api/rooms/ledger-rollover/contract') {
          return new Response(JSON.stringify(contractEnvelope()), {
            status: 200,
          });
        }
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

  async function openRoom(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    const row = container.querySelector<HTMLElement>(
      '[data-project-id="payments"] [data-room-id="ledger-rollover"]',
    );
    await act(async () => {
      row?.click();
    });
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  }

  it('clicking the 👍 chip POSTs react, refetches, and flips the chip + shows ✓ agreed on the contract post', async () => {
    await openRoom();
    const roomView = container.querySelector('[data-testid="room-view"]');
    expect(roomView).not.toBeNull();

    // Before the toggle: no agreed mark anywhere, post #10's chip resting.
    expect(
      container.querySelectorAll('[data-testid="agreed-mark-footer"]'),
    ).toHaveLength(0);
    const post10 = container.querySelector(
      '[data-message-seq="10"]',
    ) as HTMLElement;
    const chip10Before = post10.querySelector<HTMLButtonElement>(
      '[data-testid="reaction-chip"]',
    );
    expect(chip10Before?.getAttribute('data-state')).toBe('resting');
    expect(chip10Before?.disabled).toBe(false); // ops is a peer → can react

    // Click the 👍 on post #10.
    await act(async () => {
      chip10Before?.click();
    });
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    // The shell POSTed the react write to the right endpoint.
    expect(reactPosted).toBe('/api/rooms/ledger-rollover/messages/10/react');

    // After the refetch: post #10 now currently-👍'd (count 1) + carries the ✓ agreed mark.
    const post10After = container.querySelector(
      '[data-message-seq="10"]',
    ) as HTMLElement;
    expect(
      post10After
        .querySelector('[data-testid="reaction-chip"]')
        ?.getAttribute('data-state'),
    ).toBe('reacted');
    expect(
      post10After.querySelector('[data-testid="reaction-chip-count"]')
        ?.textContent,
    ).toBe('1');
    expect(post10After.getAttribute('data-agreed')).toBe('true');
    expect(
      post10After.querySelector('[data-testid="agreed-mark-footer"]'),
    ).not.toBeNull();
    expect(
      post10After.querySelector('[data-testid="agreed-mark-head"]'),
    ).not.toBeNull();
    // The non-contract announcement #9 does NOT carry the mark.
    const post9 = container.querySelector(
      '[data-message-seq="9"]',
    ) as HTMLElement;
    expect(post9.getAttribute('data-agreed')).toBe('false');
  });
});

// --- Story 9.7 — the MARQUEE Mode A→B end-to-end proof through the real App shell (Rule 3
// real-runtime DOM evidence): open a room the operator is NOT yet a participant of → the
// composer shows `[ join room to post ]` and the posture is `you: watching` → click join +
// send a reply → the operator's message appears in the thread authored by the operator handle
// → the posture flips to `you: @operator (peer)` → the 👍 chip + composer enable (participation
// established). A STATEFUL fetch stub models the host's grant-on-act: after the reply POST, the
// room's participants include `ops` (so the posture is peer) and `ops`'s message is in the
// thread — exactly what the SAME core `reply` would produce (no operator backdoor). ---
describe('App shell — join-gate composer + participate-as-peer (Story 9.7, Mode A→B)', () => {
  let replyPosted: { url: string; body: string } | null;
  let joinPosted: string | null;

  beforeEach(() => {
    replyPosted = null;
    joinPosted = null;
    // The room starts with ops as a NON-participant (watching). joining the sub-board does not
    // make ops a room participant (Design reconciliation); SENDING a reply does (grant-on-act):
    // after the reply POST, ops is in `participants` and authored a message in the thread.
    const state = { posted: false };
    const roomEnvelope = () => ({
      room: {
        room_id: 'open-room',
        project_id: 'calling-interface',
        subject: 'Need an operator call',
        body: 'Agents are split.',
        posted_by: 'alice',
        seq: 5,
        active: true,
        activated_by: 'alice',
        activated_at_seq: 6,
      },
      messages: [
        {
          seq: 5,
          actor: 'alice',
          body: 'Agents are split.',
          kind: 'announcement',
          reactions: [],
          created_at: '2026-06-01T08:00:00.000Z',
        },
        {
          seq: 6,
          actor: 'alice',
          body: 'Which way?',
          kind: 'reply',
          reactions: [],
          created_at: '2026-06-01T08:01:00.000Z',
        },
        // ops's posted message appears ONLY after the reply write (grant-on-act).
        ...(state.posted
          ? [
              {
                seq: 7,
                actor: 'ops',
                body: 'Go with option B.',
                kind: 'reply',
                reactions: [],
                created_at: '2026-06-01T08:02:00.000Z',
              },
            ]
          : []),
      ],
      // ops becomes a ROOM PARTICIPANT only after it SENDS (the reply grants participation).
      participants: state.posted ? ['alice', 'ops'] : ['alice'],
    });
    const responses: Record<string, unknown> = {
      '/api/me': { handle: 'ops' },
      '/api/needs-you': { rooms: [] },
      '/api/directory': {
        projects: [
          {
            project_id: 'calling-interface',
            title: 'Calling Interface',
            description: 'How agents dial in.',
            announcer: 'alice',
            members: ['alice'],
          },
        ],
      },
      '/api/projects/calling-interface/rooms': {
        rooms: [
          {
            room_id: 'open-room',
            project_id: 'calling-interface',
            subject: 'Need an operator call',
            body: 'Agents are split.',
            posted_by: 'alice',
            seq: 5,
            active: true,
          },
        ],
      },
      '/api/projects/calling-interface/announcements': { announcements: [] },
      '/api/rooms/open-room/contract': {
        room_id: 'open-room',
        contract: null,
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') {
          if (url === '/api/projects/calling-interface/join') {
            joinPosted = url;
            return new Response(
              JSON.stringify({
                project: {
                  project_id: 'calling-interface',
                  title: 'Calling Interface',
                  description: 'd',
                  announcer: 'alice',
                  members: ['alice', 'ops'],
                },
              }),
              { status: 200 },
            );
          }
          if (url === '/api/rooms/open-room/reply') {
            replyPosted = {
              url,
              body: typeof init?.body === 'string' ? init.body : '',
            };
            state.posted = true;
            return new Response(
              JSON.stringify({
                room: {
                  room_id: 'open-room',
                  project_id: 'calling-interface',
                  subject: 'Need an operator call',
                  body: 'Agents are split.',
                  posted_by: 'alice',
                  seq: 5,
                  active: true,
                },
              }),
              { status: 200 },
            );
          }
          return new Response('nope', { status: 404 });
        }
        if (url === '/api/rooms/open-room') {
          return new Response(JSON.stringify(roomEnvelope()), { status: 200 });
        }
        const body = responses[url];
        if (body === undefined) return new Response('nope', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
  });

  async function openRoom(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    const row = container.querySelector<HTMLElement>(
      '[data-project-id="calling-interface"] [data-room-id="open-room"]',
    );
    await act(async () => {
      row?.click();
    });
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  }

  async function flushWrites(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it('opens watching: composer shows `[ join room to post ]`, posture `you: watching`, chips are the join hand-off', async () => {
    await openRoom();
    const roomView = container.querySelector('[data-testid="room-view"]');
    expect(roomView).not.toBeNull();
    // Posture watching (ops is not a participant yet).
    expect(
      container.querySelector('[data-testid="operator-posture"]')?.textContent,
    ).toBe('you: watching');
    // The composer is the not-joined gate (a single join button, no field).
    const composer = container.querySelector('[data-testid="composer"]');
    expect(composer?.getAttribute('data-joined')).toBe('false');
    expect(
      container.querySelector('[data-testid="composer-join"]')?.textContent,
    ).toBe('[ join room to post ]');
    expect(
      container.querySelector('[data-testid="composer-field"]'),
    ).toBeNull();
    // A watching operator's 👍 chips are the disabled "join to react" hand-off (no doomed write).
    const chip = container.querySelector<HTMLButtonElement>(
      '[data-testid="reaction-chip"]',
    );
    expect(chip?.getAttribute('data-state')).toBe('cannot-react');
    expect(chip?.disabled).toBe(true);
  });

  it('join + send through the REAL composer: the operator posts a reply, the message appears authored by the operator, posture flips to peer, and the 👍 chip enables', async () => {
    await openRoom();

    // 1. Click `[ join room to post ]` → POSTs join + REVEALS the composer field (the
    // join-then-post flow; joinBoard grants sub-board membership in the background).
    const joinBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-join"]',
    );
    await act(async () => {
      joinBtn?.click();
    });
    await flushWrites();
    expect(joinPosted).toBe('/api/projects/calling-interface/join');
    // The field is now shown (joined intent) even before posture flips to peer.
    expect(
      container
        .querySelector('[data-testid="composer"]')
        ?.getAttribute('data-joined'),
    ).toBe('true');

    // 2. Type a first post + SEND through the real composer field → POST reply (grant-on-act).
    const field = container.querySelector<HTMLInputElement>(
      '[data-testid="composer-field"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'Go with option B.');
      field?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-send"]',
    );
    await act(async () => {
      send?.click();
    });
    await flushWrites();

    // The shell POSTed the reply (the SAME core reply op, actor=operator) with the typed body.
    expect(replyPosted?.url).toBe('/api/rooms/open-room/reply');
    expect(JSON.parse(replyPosted!.body)).toEqual({
      body: 'Go with option B.',
    });

    // 3. After the refetch: the operator is a PEER, their message is in the thread authored by
    // `ops`, and the 👍 chips are enabled (participation established — the Mode A→B flip).
    expect(
      container.querySelector('[data-testid="operator-posture"]')?.textContent,
    ).toBe('you: @ops (peer)');
    const opsPost = container.querySelector('[data-message-seq="7"]');
    expect(opsPost).not.toBeNull();
    expect(
      opsPost?.querySelector('[data-testid="message-post-handle"]')
        ?.textContent,
    ).toBe('@ops');
    const chips = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="reaction-chip"]',
    );
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.disabled).toBe(false);
    }
  });

  it('SAME-CORE proof: sending posts to /api/rooms/:id/reply with a { body } JSON payload (the same write an agent uses) — no operator-only path', async () => {
    await openRoom();
    // Join to reveal the field, then send through the composer.
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="composer-join"]')
        ?.click();
    });
    await flushWrites();
    const field = container.querySelector<HTMLInputElement>(
      '[data-testid="composer-field"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'operator peer post');
      field?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="composer-send"]')
        ?.click();
    });
    await flushWrites();
    // The operator posts via the SAME core reply endpoint (the host calls core `reply` with
    // actor=operator), not a special operator-only path.
    expect(replyPosted?.url).toBe('/api/rooms/open-room/reply');
    expect(JSON.parse(replyPosted!.body)).toEqual({
      body: 'operator peer post',
    });
  });
});

// --- Story 9.8 — ROOMS AS EDITOR TABS through the real App shell (Rule 3 real-runtime DOM
// evidence). A board with TWO rooms, both loadable. Proves: clicking two tree rooms opens two
// tabs side-by-side; the ACTIVE tab's RoomView renders; clicking an already-open room FOCUSES
// (does not duplicate) its tab; closing a tab REMOVES it + reactivates a neighbor + fires NO
// board write (the AC2 load-bearing assertion: closing ≠ leaving); a BACKGROUND tab with SSE
// activity shows the leading •, which CLEARS when the tab is focused. The fetch stub COUNTS
// every non-GET write so the close-fires-no-write assertion is mechanical. ---
describe('App shell — rooms as editor tabs (Story 9.8)', () => {
  /** Every POST/PUT/DELETE/PATCH (board WRITE) the shell issues — must stay empty across a close. */
  let writes: string[];

  function roomEnvelope(roomId: string, projectId: string, subject: string) {
    return {
      room: {
        room_id: roomId,
        project_id: projectId,
        subject,
        body: `${subject} body`,
        posted_by: 'alice',
        seq: 5,
        active: true,
        activated_by: 'alice',
        activated_at_seq: 6,
      },
      messages: [
        {
          seq: 5,
          actor: 'alice',
          body: `${subject} body`,
          kind: 'announcement',
          reactions: [],
          created_at: '2026-06-01T08:00:00.000Z',
        },
      ],
      // `ops` is a participant of both rooms (so the posture resolves cleanly; participation is
      // irrelevant to the tab open/close/unread mechanics this block proves).
      participants: ['ops'],
    };
  }

  const ROOM_RESPONSES: Record<string, unknown> = {
    '/api/me': { handle: 'ops' },
    '/api/needs-you': { rooms: [] },
    '/api/directory': {
      projects: [
        {
          project_id: 'calling-interface',
          title: 'Calling Interface',
          description: 'd',
          announcer: 'alice',
          members: ['alice', 'ops'],
        },
      ],
    },
    '/api/projects/calling-interface/rooms': {
      rooms: [
        {
          room_id: 'room-a',
          project_id: 'calling-interface',
          subject: 'Room A',
          body: '',
          posted_by: 'alice',
          seq: 5,
          active: true,
        },
        {
          room_id: 'room-b',
          project_id: 'calling-interface',
          subject: 'Room B',
          body: '',
          posted_by: 'alice',
          seq: 6,
          active: true,
        },
        {
          room_id: 'room-c',
          project_id: 'calling-interface',
          subject: 'Room C',
          body: '',
          posted_by: 'alice',
          seq: 7,
          active: true,
        },
      ],
    },
    '/api/projects/calling-interface/announcements': { announcements: [] },
    '/api/rooms/room-a': roomEnvelope('room-a', 'calling-interface', 'Room A'),
    '/api/rooms/room-a/contract': { room_id: 'room-a', contract: null },
    '/api/rooms/room-b': roomEnvelope('room-b', 'calling-interface', 'Room B'),
    '/api/rooms/room-b/contract': { room_id: 'room-b', contract: null },
    '/api/rooms/room-c': roomEnvelope('room-c', 'calling-interface', 'Room C'),
    '/api/rooms/room-c/contract': { room_id: 'room-c', contract: null },
  };

  beforeEach(() => {
    writes = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method !== 'GET') {
          // Any board write — record it so the close-fires-no-write assertion is mechanical.
          writes.push(`${method} ${url}`);
          return new Response('{}', { status: 200 });
        }
        const body = ROOM_RESPONSES[url];
        if (body === undefined) return new Response('nope', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
  });

  async function mountBoard(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
  }

  function clickRoom(roomId: string): Promise<void> {
    const row = container.querySelector<HTMLElement>(
      `[data-project-id="calling-interface"] [data-room-id="${roomId}"]`,
    );
    return act(async () => {
      row?.click();
    });
  }

  function tabs(): HTMLElement[] {
    return [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="tab-strip"] [data-testid="room-tab"]',
      ),
    ];
  }

  it('clicking two tree rooms opens two tabs side-by-side; the active tab RoomView renders', async () => {
    await mountBoard();
    await clickRoom('room-a');
    await flush();
    await clickRoom('room-b');
    await flush();

    // Two tabs, in open order.
    const ids = tabs().map((t) => t.getAttribute('data-room-id'));
    expect(ids).toEqual(['room-a', 'room-b']);
    // room-b is the ACTIVE tab (last opened) and its RoomView renders that room's breadcrumb.
    const activeTabs = tabs().filter(
      (t) => t.getAttribute('data-active') === 'true',
    );
    expect(activeTabs).toHaveLength(1);
    expect(activeTabs[0]?.getAttribute('data-room-id')).toBe('room-b');
    const crumb = container.querySelector('[data-testid="room-breadcrumb"]');
    expect(crumb?.textContent).toContain('#room-b');
  });

  it('clicking an already-open room FOCUSES (does not duplicate) its tab', async () => {
    await mountBoard();
    await clickRoom('room-a');
    await flush();
    await clickRoom('room-b');
    await flush();
    // Re-click room-a → it focuses (still 2 tabs, room-a now active).
    await clickRoom('room-a');
    await flush();

    const ids = tabs().map((t) => t.getAttribute('data-room-id'));
    expect(ids).toEqual(['room-a', 'room-b']); // no duplicate
    const active = tabs().find((t) => t.getAttribute('data-active') === 'true');
    expect(active?.getAttribute('data-room-id')).toBe('room-a');
    expect(
      container.querySelector('[data-testid="room-breadcrumb"]')?.textContent,
    ).toContain('#room-a');
  });

  it('AC2 — closing a tab removes it + reactivates a neighbor + fires NO board write (closing ≠ leaving)', async () => {
    await mountBoard();
    await clickRoom('room-a');
    await flush();
    await clickRoom('room-b');
    await flush();
    // Sanity: opening rooms is READ-ONLY (no board write fired by open/focus).
    expect(writes).toEqual([]);

    // Close the ACTIVE tab (room-b) via its ×.
    const closeB = tabs()
      .find((t) => t.getAttribute('data-room-id') === 'room-b')
      ?.querySelector<HTMLButtonElement>('[data-testid="room-tab-close"]');
    await act(async () => {
      closeB?.click();
    });
    await flush();

    // The tab is gone; room-a (the neighbor) is reactivated and its RoomView renders.
    const ids = tabs().map((t) => t.getAttribute('data-room-id'));
    expect(ids).toEqual(['room-a']);
    expect(
      container.querySelector('[data-testid="room-breadcrumb"]')?.textContent,
    ).toContain('#room-a');

    // AC2 LOAD-BEARING: closing fired NO board write — no leave/un-participate/any POST. The
    // board has no "leave room" op; closing is purely a VIEW state change.
    expect(writes).toEqual([]);

    // Reopening room-b re-fetches the SAME room (participation unchanged — `ops` still a peer).
    await clickRoom('room-b');
    await flush();
    expect(
      container.querySelector('[data-testid="operator-posture"]')?.textContent,
    ).toBe('you: @ops (peer)');
    // Still no board write across the whole close→reopen cycle.
    expect(writes).toEqual([]);
  });

  it('closing the active MIDDLE tab reactivates the RIGHT neighbor (right→left→none order)', async () => {
    // Harden the neighbor-pick (the existing AC2 test closes the LAST tab → left neighbor; the
    // close-last test → none. This exercises the RIGHT branch of Math.min(index, next-1): with a
    // tab to the right of the closed one, the right neighbor — not the left — becomes active.)
    await mountBoard();
    await clickRoom('room-a');
    await flush();
    await clickRoom('room-b');
    await flush();
    await clickRoom('room-c');
    await flush();
    // Focus the MIDDLE tab (room-b), so closing it must choose between left (room-a) and right
    // (room-c). The spec says right wins.
    await clickRoom('room-b');
    await flush();
    expect(
      tabs()
        .find((t) => t.getAttribute('data-room-id') === 'room-b')
        ?.getAttribute('data-active'),
    ).toBe('true');

    const closeB = tabs()
      .find((t) => t.getAttribute('data-room-id') === 'room-b')
      ?.querySelector<HTMLButtonElement>('[data-testid="room-tab-close"]');
    await act(async () => {
      closeB?.click();
    });
    await flush();

    // room-b gone; the RIGHT neighbor (room-c) is active — NOT the left (room-a).
    const ids = tabs().map((t) => t.getAttribute('data-room-id'));
    expect(ids).toEqual(['room-a', 'room-c']);
    const active = tabs().find((t) => t.getAttribute('data-active') === 'true');
    expect(active?.getAttribute('data-room-id')).toBe('room-c');
    expect(
      container.querySelector('[data-testid="room-breadcrumb"]')?.textContent,
    ).toContain('#room-c');
    expect(writes).toEqual([]);
  });

  it('closing an INACTIVE tab leaves the active tab unchanged (no spurious reactivation)', async () => {
    // The neighbor-pick only runs when the CLOSED tab was active. Closing a background tab must
    // not disturb which tab is active.
    await mountBoard();
    await clickRoom('room-a');
    await flush();
    await clickRoom('room-b');
    await flush();
    // room-b active; close the INACTIVE room-a.
    const closeA = tabs()
      .find((t) => t.getAttribute('data-room-id') === 'room-a')
      ?.querySelector<HTMLButtonElement>('[data-testid="room-tab-close"]');
    await act(async () => {
      closeA?.click();
    });
    await flush();

    const ids = tabs().map((t) => t.getAttribute('data-room-id'));
    expect(ids).toEqual(['room-b']);
    // room-b is STILL the active tab (closing a background tab does not change focus).
    const active = tabs().find((t) => t.getAttribute('data-active') === 'true');
    expect(active?.getAttribute('data-room-id')).toBe('room-b');
    expect(
      container.querySelector('[data-testid="room-breadcrumb"]')?.textContent,
    ).toContain('#room-b');
    expect(writes).toEqual([]);
  });

  it('an SSE delta for a room with NO open tab is ignored (no tab gains unread, fold is a no-op)', async () => {
    // foldTabUnread early-returns for a room that is not open. Only room-a is open; a delta for
    // room-b (closed) must not fabricate a tab or mark anything unread.
    await mountBoard();
    await clickRoom('room-a');
    await flush();
    await act(async () => {
      FakeEventSource.last?.emitMessage(
        JSON.stringify({
          seq: 40,
          type: 'room.replied',
          actor: 'alice',
          created_at: '2026-06-01T00:00:00.000Z',
          payload: { room_id: 'room-b', body: 'ping' },
        }),
      );
    });
    await flush();
    // Still exactly one tab (room-a), and it is not unread (the delta was for a non-open room).
    const ids = tabs().map((t) => t.getAttribute('data-room-id'));
    expect(ids).toEqual(['room-a']);
    expect(tabs()[0]?.getAttribute('data-unread')).toBe('false');
    expect(writes).toEqual([]);
  });

  it('closing the LAST tab clears the active room (back to the empty placeholder), still no write', async () => {
    await mountBoard();
    await clickRoom('room-a');
    await flush();
    const closeA = tabs()[0]?.querySelector<HTMLButtonElement>(
      '[data-testid="room-tab-close"]',
    );
    await act(async () => {
      closeA?.click();
    });
    await flush();
    expect(tabs()).toHaveLength(0);
    expect(container.querySelector('[data-testid="tab-strip"]')).toBeNull();
    expect(container.querySelector('[data-testid="room-view"]')).toBeNull();
    expect(container.querySelector('[data-testid="no-room"]')).not.toBeNull();
    expect(writes).toEqual([]);
  });

  it('a BACKGROUND tab gains a leading • on SSE activity, which CLEARS when focused', async () => {
    await mountBoard();
    await clickRoom('room-a');
    await flush();
    await clickRoom('room-b');
    await flush();
    // room-a is now a BACKGROUND tab (room-b active). It has no unread • yet.
    const tabA = () =>
      tabs().find((t) => t.getAttribute('data-room-id') === 'room-a');
    expect(tabA()?.getAttribute('data-unread')).toBe('false');

    // Push a reply delta for the background room-a over SSE.
    await act(async () => {
      FakeEventSource.last?.emitMessage(
        JSON.stringify({
          seq: 30,
          type: 'room.replied',
          actor: 'alice',
          created_at: '2026-06-01T00:00:00.000Z',
          payload: { room_id: 'room-a', body: 'ping' },
        }),
      );
    });

    // room-a's background tab now shows the leading • (data-unread true + the dot element).
    expect(tabA()?.getAttribute('data-unread')).toBe('true');
    expect(
      tabA()?.querySelector('[data-testid="room-tab-unread"]'),
    ).not.toBeNull();

    // Focus room-a → its unread • clears (focus-clears-unread).
    await clickRoom('room-a');
    await flush();
    expect(tabA()?.getAttribute('data-unread')).toBe('false');
    expect(tabA()?.querySelector('[data-testid="room-tab-unread"]')).toBeNull();
    // SSE-driven unread + focus-clear are pure VIEW state — no board write.
    expect(writes).toEqual([]);
  });

  it('the ACTIVE tab does NOT gain unread when its own room gets SSE activity (the operator is reading it)', async () => {
    await mountBoard();
    await clickRoom('room-a');
    await flush();
    // room-a is active. A reply delta for room-a must NOT mark it unread.
    await act(async () => {
      FakeEventSource.last?.emitMessage(
        JSON.stringify({
          seq: 31,
          type: 'room.replied',
          actor: 'alice',
          created_at: '2026-06-01T00:00:00.000Z',
          payload: { room_id: 'room-a', body: 'ping' },
        }),
      );
    });
    const tabA = tabs().find(
      (t) => t.getAttribute('data-room-id') === 'room-a',
    );
    expect(tabA?.getAttribute('data-unread')).toBe('false');
  });
});

// --- Story 9.9 — LIVE updates + OPTIMISTIC posting + reconciliation through the real App shell
// (Rule 3 real-runtime DOM evidence). A single room `live-room` the operator (`ops`) is already
// a participant of (so the composer is joined + 👍 chips enabled). A STATEFUL fetch stub models
// the host so a reply POST + refetch lands the confirmed message; a togglable `failPost`/
// `failReact` makes the write reject so the inline-failure paths are exercised. The fake
// EventSource drives SSE deltas so the live-fold into the OPEN thread is observable. ---
describe('App shell — live updates, optimistic posting + reconciliation (Story 9.9)', () => {
  // Test-controlled host behavior.
  let failPost: boolean;
  let failReact: boolean;
  let replyBodies: string[];

  function roomEnvelope(messages: unknown[], participants: string[]) {
    return {
      room: {
        room_id: 'live-room',
        project_id: 'calling-interface',
        subject: 'Live room',
        body: 'Seed.',
        posted_by: 'alice',
        seq: 5,
        active: true,
        activated_by: 'alice',
        activated_at_seq: 6,
      },
      messages,
      participants,
    };
  }

  // The host's confirmed message list grows as the operator posts (grant-on-act keeps ops a
  // participant). reactions on #6 mutate as the operator toggles 👍.
  let confirmed: {
    seq: number;
    actor: string;
    body: string;
    kind: string;
    reactions: string[];
    created_at: string;
  }[];

  beforeEach(() => {
    failPost = false;
    failReact = false;
    replyBodies = [];
    confirmed = [
      {
        seq: 5,
        actor: 'alice',
        body: 'Seed.',
        kind: 'announcement',
        reactions: [],
        created_at: '2026-06-01T08:00:00.000Z',
      },
      {
        seq: 6,
        actor: 'ops',
        body: 'First.',
        kind: 'reply',
        reactions: [],
        created_at: '2026-06-01T08:01:00.000Z',
      },
    ];
    let nextSeq = 7;

    const STATIC: Record<string, unknown> = {
      '/api/me': { handle: 'ops' },
      '/api/needs-you': { rooms: [] },
      '/api/directory': {
        projects: [
          {
            project_id: 'calling-interface',
            title: 'Calling Interface',
            description: 'd',
            announcer: 'alice',
            members: ['alice', 'ops'],
          },
        ],
      },
      '/api/projects/calling-interface/rooms': {
        rooms: [
          {
            room_id: 'live-room',
            project_id: 'calling-interface',
            subject: 'Live room',
            body: '',
            posted_by: 'alice',
            seq: 5,
            active: true,
          },
        ],
      },
      '/api/projects/calling-interface/announcements': { announcements: [] },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') {
          if (url === '/api/rooms/live-room/reply') {
            const parsed = JSON.parse(
              typeof init?.body === 'string' ? init.body : '{}',
            ) as { body: string };
            replyBodies.push(parsed.body);
            if (failPost) return new Response('nope', { status: 500 });
            // Grant-on-act: the confirmed message lands at a real seq.
            confirmed.push({
              seq: nextSeq++,
              actor: 'ops',
              body: parsed.body,
              kind: 'reply',
              reactions: [],
              created_at: '2026-06-01T08:05:00.000Z',
            });
            return new Response(
              JSON.stringify({
                room: {
                  room_id: 'live-room',
                  project_id: 'calling-interface',
                  subject: 'Live room',
                  body: 'Seed.',
                  posted_by: 'alice',
                  seq: 5,
                  active: true,
                },
              }),
              { status: 200 },
            );
          }
          const reactMatch = /\/messages\/(\d+)\/(react|unreact)$/.exec(url);
          if (reactMatch) {
            if (failReact) return new Response('nope', { status: 500 });
            const seq = Number(reactMatch[1]);
            const isReact = reactMatch[2] === 'react';
            const msg = confirmed.find((m) => m.seq === seq);
            if (msg) {
              if (isReact && !msg.reactions.includes('ops')) {
                msg.reactions.push('ops');
              } else if (!isReact) {
                msg.reactions = msg.reactions.filter((r) => r !== 'ops');
              }
            }
            return new Response(
              JSON.stringify({
                message_seq: seq,
                reactions: msg?.reactions ?? [],
              }),
              { status: 200 },
            );
          }
          return new Response('nope', { status: 404 });
        }
        if (url === '/api/rooms/live-room') {
          return new Response(
            JSON.stringify(roomEnvelope(confirmed, ['alice', 'ops'])),
            { status: 200 },
          );
        }
        if (url === '/api/rooms/live-room/contract') {
          // Contract = highest-seq message with a live 👍 (or null).
          const live = [...confirmed]
            .filter((m) => m.reactions.length > 0)
            .sort((a, b) => b.seq - a.seq)[0];
          return new Response(
            JSON.stringify({
              room_id: 'live-room',
              contract: live ?? null,
            }),
            { status: 200 },
          );
        }
        const body = STATIC[url];
        if (body === undefined) return new Response('nope', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
  });

  async function openLiveRoom(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
    const row = container.querySelector<HTMLElement>(
      '[data-project-id="calling-interface"] [data-room-id="live-room"]',
    );
    await act(async () => {
      row?.click();
    });
    await flush();
  }

  async function sendThroughComposer(text: string): Promise<void> {
    const field = container.querySelector<HTMLInputElement>(
      '[data-testid="composer-field"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field, text);
      field?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="composer-send"]')
        ?.click();
    });
  }

  function posts(): HTMLElement[] {
    return [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="message-post"]',
      ),
    ];
  }

  it('AC1 — an SSE room.replied for the OPEN room folds into the thread live (immutably)', async () => {
    await openLiveRoom();
    expect(posts().map((p) => p.getAttribute('data-message-seq'))).toEqual([
      '5',
      '6',
    ]);

    // Another client posts; the host pushes the room.replied delta to this operator's open view.
    await act(async () => {
      FakeEventSource.last?.emitMessage(
        JSON.stringify({
          seq: 8,
          type: 'room.replied',
          actor: 'alice',
          created_at: '2026-06-01T09:00:00.000Z',
          payload: { room_id: 'live-room', body: 'Live append from alice' },
        }),
      );
    });

    // The open thread updated live — the new post appended at seq 8.
    const live = posts();
    expect(live.map((p) => p.getAttribute('data-message-seq'))).toEqual([
      '5',
      '6',
      '8',
    ]);
    expect(
      container.querySelector('[data-message-seq="8"]')?.textContent,
    ).toContain('Live append from alice');
  });

  it('AC1 — an SSE message.reacted updates the chip count + re-derives the ✓ agreed mark live', async () => {
    await openLiveRoom();
    // No agreed mark initially.
    expect(
      container.querySelectorAll('[data-testid="agreed-mark-footer"]'),
    ).toHaveLength(0);

    await act(async () => {
      FakeEventSource.last?.emitMessage(
        JSON.stringify({
          seq: 20,
          type: 'message.reacted',
          actor: 'cleo',
          created_at: '2026-06-01T09:00:00.000Z',
          payload: { room_id: 'live-room', message_seq: 6 },
        }),
      );
    });

    const post6 = container.querySelector('[data-message-seq="6"]');
    // Chip count bumped to 1 live (no refetch needed).
    expect(
      post6?.querySelector('[data-testid="reaction-chip-count"]')?.textContent,
    ).toBe('1');
    // The ✓ agreed mark appeared on #6 (highest-seq live-👍'd message, FR21).
    expect(post6?.getAttribute('data-agreed')).toBe('true');
    expect(
      post6?.querySelector('[data-testid="agreed-mark-footer"]'),
    ).not.toBeNull();
  });

  it('AC2 — optimistic post: the echo appears PENDING immediately, then reconciles to confirmed (no duplicate)', async () => {
    await openLiveRoom();
    expect(posts()).toHaveLength(2);

    // Type the draft, then click send in a SYNCHRONOUS act so only the synchronous optimistic
    // append is flushed (the async POST/refetch has not run yet) — the pending echo is observable.
    const field = container.querySelector<HTMLInputElement>(
      '[data-testid="composer-field"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'Optimistic hello');
      field?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="composer-send"]')
        ?.click();
    });
    const pendingPost = container.querySelector('[data-pending="true"]');
    expect(pendingPost).not.toBeNull();
    expect(pendingPost?.textContent).toContain('Optimistic hello');
    expect(
      pendingPost?.querySelector('[data-testid="message-post-sending"]')
        ?.textContent,
    ).toBe('sending…');

    // Flush the POST + refetch → the pending echo reconciles to the confirmed post #7 (no dup).
    await flush();
    expect(container.querySelector('[data-pending="true"]')).toBeNull();
    const seqs = posts().map((p) => p.getAttribute('data-message-seq'));
    expect(seqs).toEqual(['5', '6', '7']);
    // Exactly ONE post carries the body (no duplicate echo + confirmed).
    const matches = posts().filter((p) =>
      p.textContent?.includes('Optimistic hello'),
    );
    expect(matches).toHaveLength(1);
    expect(replyBodies).toEqual(['Optimistic hello']);
  });

  it('AC2 — a redundant SSE room.replied for the operator OWN post does NOT double-append (de-dup by content) — SSE BEFORE refetch', async () => {
    await openLiveRoom();
    await sendThroughComposer('Dedup me');
    // BEFORE the POST resolves, the redundant SSE delta for the same post arrives.
    await act(async () => {
      FakeEventSource.last?.emitMessage(
        JSON.stringify({
          seq: 7,
          type: 'room.replied',
          actor: 'ops',
          created_at: '2026-06-01T08:05:00.000Z',
          payload: { room_id: 'live-room', body: 'Dedup me' },
        }),
      );
    });
    await flush();
    // The post 'Dedup me' appears EXACTLY once across the SSE-reconcile + POST-refetch paths.
    const matches = posts().filter((p) => p.textContent?.includes('Dedup me'));
    expect(matches).toHaveLength(1);
  });

  it('AC2 — de-dup holds in the OTHER interleaving: the POST refetch lands the confirmed post FIRST, then the redundant SSE delta arrives → still exactly one', async () => {
    await openLiveRoom();
    // Send + fully flush so the POST refetch reconciles the echo to the confirmed post #7.
    await sendThroughComposer('Order matters');
    await flush();
    expect(container.querySelector('[data-pending="true"]')).toBeNull();
    let seqs = posts().map((p) => p.getAttribute('data-message-seq'));
    expect(seqs).toEqual(['5', '6', '7']);

    // NOW the redundant SSE room.replied for the operator's own post arrives (late). Because the
    // confirmed message #7 is already present (and not pending), foldRoomDelta is idempotent by
    // seq → no double-append, no resurrection of a pending echo.
    await act(async () => {
      FakeEventSource.last?.emitMessage(
        JSON.stringify({
          seq: 7,
          type: 'room.replied',
          actor: 'ops',
          created_at: '2026-06-01T08:05:00.000Z',
          payload: { room_id: 'live-room', body: 'Order matters' },
        }),
      );
    });
    await flush();
    seqs = posts().map((p) => p.getAttribute('data-message-seq'));
    expect(seqs).toEqual(['5', '6', '7']); // no duplicate seq 7
    const matches = posts().filter((p) =>
      p.textContent?.includes('Order matters'),
    );
    expect(matches).toHaveLength(1);
    expect(container.querySelector('[data-pending="true"]')).toBeNull();
  });

  it('AC2 — post FAILURE: inline `post failed — retry`, draft preserved, retry re-sends + reconciles', async () => {
    await openLiveRoom();
    failPost = true;
    await sendThroughComposer('Will fail then retry');
    await flush();

    // The echo flipped to failed, inline (no modal), with the body (draft) preserved.
    const failedPost = container.querySelector('[data-failed="true"]');
    expect(failedPost).not.toBeNull();
    expect(failedPost?.textContent).toContain('Will fail then retry');
    expect(
      failedPost?.querySelector('[data-testid="message-post-failed"]')
        ?.textContent,
    ).toContain('post failed');
    // No modal/dialog anywhere.
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // Fix the host + click retry → re-sends the SAME body, reconciles to confirmed.
    failPost = false;
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="message-post-retry"]')
        ?.click();
    });
    await flush();
    expect(container.querySelector('[data-failed="true"]')).toBeNull();
    expect(container.querySelector('[data-pending="true"]')).toBeNull();
    // Re-sent the SAME preserved body (twice total: the failed attempt + the retry).
    expect(replyBodies).toEqual([
      'Will fail then retry',
      'Will fail then retry',
    ]);
    const matches = posts().filter((p) =>
      p.textContent?.includes('Will fail then retry'),
    );
    expect(matches).toHaveLength(1);
  });

  it('AC2 — 👍 FAILURE reverts the optimistic toggle inline with NO count drift', async () => {
    await openLiveRoom();
    failReact = true;
    const chip6 = () =>
      container
        .querySelector('[data-message-seq="6"]')
        ?.querySelector<HTMLButtonElement>('[data-testid="reaction-chip"]');
    // Resting, count 0.
    expect(chip6()?.getAttribute('data-state')).toBe('resting');
    expect(
      container
        .querySelector('[data-message-seq="6"]')
        ?.querySelector('[data-testid="reaction-chip-count"]')?.textContent,
    ).toBe('0');

    await act(async () => {
      chip6()?.click();
    });
    await flush();

    // After the failed write, the optimistic toggle REVERTED — back to resting + count 0 (no drift).
    expect(chip6()?.getAttribute('data-state')).toBe('resting');
    expect(
      container
        .querySelector('[data-message-seq="6"]')
        ?.querySelector('[data-testid="reaction-chip-count"]')?.textContent,
    ).toBe('0');
  });

  it('AC2 — 👍 SUCCESS keeps the optimistic toggle (authoritative ReactResult, count 1)', async () => {
    await openLiveRoom();
    const chip6 = () =>
      container
        .querySelector('[data-message-seq="6"]')
        ?.querySelector<HTMLButtonElement>('[data-testid="reaction-chip"]');
    await act(async () => {
      chip6()?.click();
    });
    await flush();
    expect(chip6()?.getAttribute('data-state')).toBe('reacted');
    expect(
      container
        .querySelector('[data-message-seq="6"]')
        ?.querySelector('[data-testid="reaction-chip-count"]')?.textContent,
    ).toBe('1');
  });

  it('AC2 — toggling 👍 on→off→on (each write succeeding) does NOT drift the count (settles at exactly 1, one reactor)', async () => {
    await openLiveRoom();
    const post6 = () => container.querySelector('[data-message-seq="6"]');
    const chip6 = () =>
      post6()?.querySelector<HTMLButtonElement>(
        '[data-testid="reaction-chip"]',
      );
    const count6 = () =>
      post6()?.querySelector('[data-testid="reaction-chip-count"]')
        ?.textContent;

    // ON.
    await act(async () => {
      chip6()?.click();
    });
    await flush();
    expect(chip6()?.getAttribute('data-state')).toBe('reacted');
    expect(count6()).toBe('1');

    // OFF.
    await act(async () => {
      chip6()?.click();
    });
    await flush();
    expect(chip6()?.getAttribute('data-state')).toBe('resting');
    expect(count6()).toBe('0');

    // ON again — settles at exactly one reactor (no leftover from the prior cycle, no drift).
    await act(async () => {
      chip6()?.click();
    });
    await flush();
    expect(chip6()?.getAttribute('data-state')).toBe('reacted');
    expect(count6()).toBe('1');
    // The host's authoritative reactor set is exactly ['ops'] (no duplicate accumulation).
    expect(confirmed.find((m) => m.seq === 6)?.reactions).toEqual(['ops']);
  });

  it('NFR5 — the live channel is operator→browser SSE only; no board write fires on a pure inbound delta', async () => {
    // Re-affirm: folding an inbound SSE delta into the operator's OWN open view is a pure client
    // reduction — it issues NO outbound write (agents stay pull-only; the host never pushes to
    // agents). Count every non-GET request; an inbound delta must add none.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await openLiveRoom();
    const writesBefore = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
    ).length;
    await act(async () => {
      FakeEventSource.last?.emitMessage(
        JSON.stringify({
          seq: 9,
          type: 'room.replied',
          actor: 'alice',
          created_at: '2026-06-01T09:00:00.000Z',
          payload: { room_id: 'live-room', body: 'inbound only' },
        }),
      );
    });
    await flush();
    const writesAfter = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
    ).length;
    expect(writesAfter).toBe(writesBefore); // no write triggered by the inbound delta
    // The delta still folded into the view (live, pull-only-preserving).
    expect(
      container.querySelector('[data-message-seq="9"]')?.textContent,
    ).toContain('inbound only');
  });
});

// --- Story 9.9 — JOIN FAILURE: NO half-joined state (AC2). A watching operator clicks
// `[ join room to post ]`; the join POST REJECTS. The composer must NOT show its joined
// (field) state — it returns to the `[ join room to post ]` gate, and a calm inline error
// surfaces. (The 9.9 stateful suite above has ops already a participant, so its composer is
// joined and never exercises the join gate; this suite isolates the watching-operator join.)
describe('App shell — join FAILURE shows inline retry, no half-joined state (Story 9.9)', () => {
  beforeEach(() => {
    const roomEnvelope = () => ({
      room: {
        room_id: 'join-room',
        project_id: 'calling-interface',
        subject: 'Join then fail',
        body: 'Agents are split.',
        posted_by: 'alice',
        seq: 5,
        active: true,
        activated_by: 'alice',
        activated_at_seq: 6,
      },
      messages: [
        {
          seq: 5,
          actor: 'alice',
          body: 'Agents are split.',
          kind: 'announcement',
          reactions: [],
          created_at: '2026-06-01T08:00:00.000Z',
        },
      ],
      // ops stays a NON-participant — the join never succeeds, so participation never grants.
      participants: ['alice'],
    });
    const responses: Record<string, unknown> = {
      '/api/me': { handle: 'ops' },
      '/api/needs-you': { rooms: [] },
      '/api/directory': {
        projects: [
          {
            project_id: 'calling-interface',
            title: 'Calling Interface',
            description: 'd',
            announcer: 'alice',
            members: ['alice'],
          },
        ],
      },
      '/api/projects/calling-interface/rooms': {
        rooms: [
          {
            room_id: 'join-room',
            project_id: 'calling-interface',
            subject: 'Join then fail',
            body: 'Agents are split.',
            posted_by: 'alice',
            seq: 5,
            active: true,
          },
        ],
      },
      '/api/projects/calling-interface/announcements': { announcements: [] },
      '/api/rooms/join-room/contract': { room_id: 'join-room', contract: null },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') {
          // The join write REJECTS (e.g. transient host failure).
          if (url === '/api/projects/calling-interface/join') {
            return new Response('nope', { status: 500 });
          }
          return new Response('nope', { status: 404 });
        }
        if (url === '/api/rooms/join-room') {
          return new Response(JSON.stringify(roomEnvelope()), { status: 200 });
        }
        const body = responses[url];
        if (body === undefined) return new Response('nope', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
  });

  it('AC2 — a failed join returns to the `[ join room to post ]` gate (no half-joined field) + a calm inline error', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
    const row = container.querySelector<HTMLElement>(
      '[data-project-id="calling-interface"] [data-room-id="join-room"]',
    );
    await act(async () => {
      row?.click();
    });
    await flush();

    // Watching: the composer shows the join gate, no field.
    expect(
      container
        .querySelector('[data-testid="composer"]')
        ?.getAttribute('data-joined'),
    ).toBe('false');
    expect(
      container.querySelector('[data-testid="composer-join"]')?.textContent,
    ).toBe('[ join room to post ]');

    // Click join → the POST rejects.
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="composer-join"]')
        ?.click();
    });
    await flush();

    // NO half-joined state: the composer is BACK to the gate (data-joined=false, the field is
    // NOT present, the `[ join room to post ]` button is shown again to retry).
    expect(
      container
        .querySelector('[data-testid="composer"]')
        ?.getAttribute('data-joined'),
    ).toBe('false');
    expect(
      container.querySelector('[data-testid="composer-field"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="composer-join"]')?.textContent,
    ).toBe('[ join room to post ]');
    // A calm inline error surfaced (not a modal). Story 9.10 voice: lowercase `couldn’t …`.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="room-error"]')?.textContent,
    ).toContain('couldn’t open the room');
  });
});

// --- Story 9.10 — CALM STATES + the CONNECTION FOOTER through the real App shell (Rule 3
// real-runtime DOM evidence). Three calm-posture proofs: (a) an EMPTY board renders
// `no projects yet` + the single `＋ join a project…` next action with NO full-app spinner;
// (b) a DISCONNECTED transport shows the inline `○ reconnecting…` footer while the
// already-loaded tree STAYS in the DOM (no modal/overlay), then recovers to `● connected`;
// (c) a quiet/idle room carries NO warning/nag decoration (healthy). ---
describe('App shell — calm states + connection footer (Story 9.10)', () => {
  const EMPTY_RESPONSES: Record<string, unknown> = {
    '/api/me': { handle: 'operator' },
    '/api/needs-you': { rooms: [] },
    '/api/directory': { projects: [] },
  };

  function stubFetch(responses: Record<string, unknown>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = responses[url];
        if (body === undefined) return new Response('nope', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
  }

  it('AC1 — an EMPTY board renders `no projects yet` + the single next action, with NO full-app spinner', async () => {
    stubFetch(EMPTY_RESPONSES);
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();

    // The empty-board calm copy + the single next action (the join row), inside the tree.
    expect(
      container.querySelector('[data-testid="nav-empty"]')?.textContent,
    ).toBe('no projects yet');
    expect(
      container.querySelector('[data-testid="nav-join-project"]'),
    ).not.toBeNull();
    // The loaded tree is present (no full-app blocking spinner / overlay over everything).
    expect(container.querySelector('[data-testid="tree-skeleton"]')).toBeNull();
    expect(container.querySelector('.nav-tree')).not.toBeNull();
    // No modal/dialog anywhere.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('AC1 — DISCONNECTED: the footer shows inline `○ reconnecting…`; already-loaded content stays; recovers to `● connected`', async () => {
    stubFetch(EMPTY_RESPONSES);
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();

    // The SSE channel opens → connected.
    await act(async () => {
      FakeEventSource.last?.emitOpen();
    });
    const footer = () =>
      container.querySelector('[data-testid="connection-footer"]');
    expect(footer()?.getAttribute('data-status')).toBe('connected');
    expect(
      footer()?.querySelector('[data-testid="connection-footer-label"]')
        ?.textContent,
    ).toBe('connected');

    // The transport drops → the footer flips to the INLINE reconnecting state.
    await act(async () => {
      FakeEventSource.last?.emitError();
    });
    expect(footer()?.getAttribute('data-status')).toBe('reconnecting');
    expect(
      footer()?.querySelector('[data-testid="connection-footer-label"]')
        ?.textContent,
    ).toBe('reconnecting…');
    // CALM POSTURE: no modal/overlay blocks the UI; the already-loaded tree stays readable.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container.querySelector('.nav-tree')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="nav-empty"]')?.textContent,
    ).toBe('no projects yet');

    // Reconnect → back to connected (the live fold resumes on the next open).
    await act(async () => {
      FakeEventSource.last?.emitOpen();
    });
    expect(footer()?.getAttribute('data-status')).toBe('connected');
  });

  it('AC1 — a quiet/idle room carries NO warning/nag/stalled decoration (healthy)', async () => {
    // A board with one room, no escalation, no activity — the "quiet = healthy" state.
    stubFetch({
      '/api/me': { handle: 'operator' },
      '/api/needs-you': { rooms: [] },
      '/api/directory': {
        projects: [
          {
            project_id: 'p1',
            title: 'Project One',
            description: 'd',
            announcer: 'alice',
            members: ['alice'],
          },
        ],
      },
      '/api/projects/p1/rooms': {
        rooms: [
          {
            room_id: 'quiet-room',
            project_id: 'p1',
            subject: 'Quiet room',
            body: '',
            posted_by: 'alice',
            seq: 5,
            active: true,
          },
        ],
      },
      '/api/projects/p1/announcements': { announcements: [] },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();

    const row = container.querySelector(
      '[data-room-id="quiet-room"]',
    ) as HTMLElement;
    expect(row).not.toBeNull();
    // A quiet room shows the READ (°) glyph — never a needs-you (!) flag, never a warning/nag.
    expect(row.querySelector('[data-testid="unread-glyph"]')?.textContent).toBe(
      '°',
    );
    expect(row.querySelector('[data-testid="needs-you-glyph"]')).toBeNull();
    // No NEEDS YOU section at all (a quiet board surfaces nothing).
    expect(
      container.querySelector('[data-testid="needs-you-section"]'),
    ).toBeNull();
    // No warning/alarm vocabulary or red decoration anywhere in the tree.
    const treeHtml = (
      container.querySelector('.nav-tree') as HTMLElement
    ).outerHTML.toLowerCase();
    expect(treeHtml).not.toContain('stalled');
    expect(treeHtml).not.toContain('warning');
    expect(treeHtml).not.toContain('red');
  });
});

// --- Story 9.10 — THE CALM-POSTURE INVARIANT: NO MODAL ANYWHERE, IN ANY STATE (QA hardening).
// The marquee brand guarantee (DESIGN §Elevation — "the elevation language has no modal scrim";
// Do/Don't — "never spam modal alerts"). The dev's per-state tests check `[role="dialog"]` (and
// sometimes `alertdialog`) piecemeal; the post-failure test checks ONLY `role="dialog"`. This
// suite pins the invariant STRUCTURALLY with ONE comprehensive sweep over EVERY modal affordance
// (`dialog`, `alertdialog`, `aria-modal`, the `alert` live-alarm, a backdrop/scrim overlay)
// across the full state matrix the app can enter: empty, cold-load-in-flight, disconnected, and
// post-failure. Disconnection + failure surface INLINE only; reading stays unobstructed. ---
describe('App shell — NO MODAL ANYWHERE, in any state (Story 9.10 calm-posture invariant)', () => {
  /** Assert the WHOLE rendered app contains no modal/blocking-alert affordance of any kind. */
  function assertNoModalAnywhere(): void {
    const root = container; // the entire mounted app subtree
    // No dialog/alertdialog role, no aria-modal, no `alert` (the blocking live-alarm role).
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(root.querySelector('[role="alertdialog"]')).toBeNull();
    expect(root.querySelector('[aria-modal="true"]')).toBeNull();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    // No <dialog> element (the native modal). No backdrop/scrim overlay class.
    expect(root.querySelector('dialog')).toBeNull();
    const html = root.innerHTML.toLowerCase();
    expect(html).not.toContain('modal');
    expect(html).not.toContain('backdrop');
    expect(html).not.toContain('scrim');
    expect(html).not.toContain('overlay');
  }

  it('EMPTY board → no modal; the calm tree is the whole UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = {
          '/api/me': { handle: 'operator' },
          '/api/needs-you': { rooms: [] },
          '/api/directory': { projects: [] },
        }[url];
        if (body === undefined) return new Response('nope', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
    expect(container.querySelector('[data-testid="nav-empty"]')).not.toBeNull();
    assertNoModalAnywhere();
  });

  it('COLD OPEN (board fetch in flight, not yet resolved) → no modal/blocking overlay, even before the tree loads', async () => {
    // Hold the directory fetch open so the app is mid-cold-load when we assert. A calm skeleton
    // is allowed; a modal/blocking overlay is NOT — reading must never be gated behind a scrim.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/directory') {
          await gate; // never resolves until we release → the app stays in its cold-load state
        }
        const body = {
          '/api/me': { handle: 'operator' },
          '/api/needs-you': { rooms: [] },
          '/api/directory': { projects: [] },
        }[url];
        if (body === undefined) return new Response('nope', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    // Let the synchronous mount + the resolvable fetches settle, but the directory is still pending.
    await act(async () => {
      for (let i = 0; i < 3; i++) await Promise.resolve();
    });
    // Mid-cold-load: NO modal/scrim blocks the (still-loading) UI.
    assertNoModalAnywhere();
    // Release so the test tears down cleanly.
    release?.();
    await flush();
  });

  it('DISCONNECTED → no modal; the already-loaded tree stays in the DOM behind the inline footer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = {
          '/api/me': { handle: 'operator' },
          '/api/needs-you': { rooms: [] },
          '/api/directory': { projects: [] },
        }[url];
        if (body === undefined) return new Response('nope', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
    await act(async () => {
      FakeEventSource.last?.emitOpen();
    });
    await act(async () => {
      FakeEventSource.last?.emitError(); // drop the transport → reconnecting
    });
    // The footer flipped INLINE; the tree is still present + readable; NO modal blocks it.
    expect(
      container
        .querySelector('[data-testid="connection-footer"]')
        ?.getAttribute('data-status'),
    ).toBe('reconnecting');
    expect(container.querySelector('.nav-tree')).not.toBeNull();
    assertNoModalAnywhere();
  });

  it('POST FAILURE → the failure is INLINE in the thread; NO modal/alertdialog/aria-modal anywhere', async () => {
    // A room ops already participates in; the reply POST rejects → the echo flips to inline
    // `post failed — retry`. The dev's 9.9 failure test only checks `[role="dialog"]`; here we
    // sweep the FULL modal surface (alertdialog/aria-modal/alert/scrim) to pin the invariant.
    const confirmed = [
      {
        seq: 5,
        actor: 'alice',
        body: 'Seed.',
        kind: 'announcement',
        reactions: [] as string[],
        created_at: '2026-06-01T08:00:00.000Z',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') {
          if (url === '/api/rooms/fail-room/reply')
            return new Response('nope', { status: 500 });
          return new Response('nope', { status: 404 });
        }
        if (url === '/api/rooms/fail-room') {
          return new Response(
            JSON.stringify({
              room: {
                room_id: 'fail-room',
                project_id: 'p1',
                subject: 'Fail room',
                body: 'Seed.',
                posted_by: 'alice',
                seq: 5,
                active: true,
                activated_by: 'alice',
                activated_at_seq: 6,
              },
              messages: confirmed,
              participants: ['alice', 'operator'],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/rooms/fail-room/contract') {
          return new Response(
            JSON.stringify({ room_id: 'fail-room', contract: null }),
            { status: 200 },
          );
        }
        const body = {
          '/api/me': { handle: 'operator' },
          '/api/needs-you': { rooms: [] },
          '/api/directory': {
            projects: [
              {
                project_id: 'p1',
                title: 'P1',
                description: 'd',
                announcer: 'alice',
                members: ['alice', 'operator'],
              },
            ],
          },
          '/api/projects/p1/rooms': {
            rooms: [
              {
                room_id: 'fail-room',
                project_id: 'p1',
                subject: 'Fail room',
                body: '',
                posted_by: 'alice',
                seq: 5,
                active: true,
              },
            ],
          },
          '/api/projects/p1/announcements': { announcements: [] },
        }[url];
        if (body === undefined) return new Response('nope', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
    await act(async () => {
      container
        .querySelector<HTMLElement>(
          '[data-project-id="p1"] [data-room-id="fail-room"]',
        )
        ?.click();
    });
    await flush();
    // Type + send → the POST rejects → inline failure.
    const field = container.querySelector<HTMLInputElement>(
      '[data-testid="composer-field"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'this will fail');
      field?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="composer-send"]')
        ?.click();
    });
    await flush();
    // The failure surfaced INLINE in the thread (post failed — retry), NOT in any modal.
    const failedPost = container.querySelector('[data-failed="true"]');
    expect(failedPost).not.toBeNull();
    expect(failedPost?.textContent).toContain('post failed');
    assertNoModalAnywhere();
  });
});

// --- Story 9.11 (POST-SMOKE REGRESSION GUARD) — AC2's PRIMARY path: a MEMBER of a ROOM-LESS
// project must be able to open its FIRST room. The lead's real-Chrome smoke caught that the
// `＋ open a room` compose was mounted ONLY inside `{activeRoom !== null}`, so a freshly-announced
// (zero-room) board could never post its first announcement — breaking operator↔agent parity (an
// agent CAN post_announcement into a room-less board it belongs to). The fix wires the NavTree
// `announcements (N)` bucket → a PROJECT-SCOPED `＋ open a room` compose rendered at SHELL level,
// independent of any open room. These tests pin the room-less reachability + the right projectId on
// the write, plus the non-member join-first handoff from the same room-less entry. ---
describe('App shell — open the FIRST room in a room-less project (Story 9.11, AC2 primary path)', () => {
  /** Every board WRITE the shell issues (method + url + parsed JSON body). */
  let writes: { url: string; body: unknown }[];
  /** Whether the host has a room yet (post_announcement flips it → the tree refresh shows it). */
  let hasRoom: boolean;
  /** Whether `ops` is a member of calling-interface (false → post_announcement → NOT_A_MEMBER). */
  let opsIsMember: boolean;

  function directory() {
    return {
      projects: [
        {
          project_id: 'calling-interface',
          title: 'Calling Interface',
          description: 'How agents dial in.',
          announcer: 'alice',
          members: opsIsMember ? ['alice', 'ops'] : ['alice'],
        },
      ],
    };
  }

  function callingInterfaceRooms() {
    return {
      rooms: hasRoom
        ? [
            {
              room_id: 'need-a-decision',
              project_id: 'calling-interface',
              subject: 'Need a decision',
              body: '',
              posted_by: 'ops',
              seq: 12,
              active: false,
            },
          ]
        : [],
    };
  }

  function callingInterfaceAnnouncements() {
    return {
      announcements: hasRoom
        ? [
            {
              room_id: 'need-a-decision',
              project_id: 'calling-interface',
              subject: 'Need a decision',
              body: 'who owns the retry budget?',
              posted_by: 'ops',
              seq: 12,
              active: false,
            },
          ]
        : [],
    };
  }

  beforeEach(() => {
    writes = [];
    hasRoom = false;
    opsIsMember = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') {
          const parsed =
            typeof init?.body === 'string' && init.body.length > 0
              ? (JSON.parse(init.body) as unknown)
              : undefined;
          writes.push({ url, body: parsed });
          if (url === '/api/projects/calling-interface/announcements') {
            if (!opsIsMember) {
              return new Response(
                JSON.stringify({
                  code: 'NOT_A_MEMBER',
                  message: 'ops is not a member of calling-interface.',
                }),
                { status: 403 },
              );
            }
            // post_announcement succeeds → the board now has a room (the tree refresh shows it).
            hasRoom = true;
            return new Response(
              JSON.stringify({
                room: {
                  room_id: 'need-a-decision',
                  project_id: 'calling-interface',
                  subject: 'Need a decision',
                  body: 'who owns the retry budget?',
                  posted_by: 'ops',
                  seq: 12,
                  active: false,
                },
              }),
              { status: 200 },
            );
          }
          if (url === '/api/projects/calling-interface/join') {
            opsIsMember = true;
            return new Response(
              JSON.stringify({
                project: {
                  project_id: 'calling-interface',
                  title: 'Calling Interface',
                  description: 'd',
                  announcer: 'alice',
                  members: ['alice', 'ops'],
                },
              }),
              { status: 200 },
            );
          }
          return new Response('nope', { status: 404 });
        }
        // GETs — dynamic so a post_announcement's tree refresh sees the new room.
        if (url === '/api/me') {
          return new Response(JSON.stringify({ handle: 'ops' }), {
            status: 200,
          });
        }
        if (url === '/api/needs-you') {
          return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
        }
        if (url === '/api/directory') {
          return new Response(JSON.stringify(directory()), { status: 200 });
        }
        if (url === '/api/projects/calling-interface/rooms') {
          return new Response(JSON.stringify(callingInterfaceRooms()), {
            status: 200,
          });
        }
        if (url === '/api/projects/calling-interface/announcements') {
          return new Response(JSON.stringify(callingInterfaceAnnouncements()), {
            status: 200,
          });
        }
        return new Response('nope', { status: 404 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
  });

  async function mountBoard(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
  }

  /** Click the project's `announcements (N)` bucket — the room-less entry to the open-a-room compose. */
  async function clickAnnouncementsBucket(): Promise<void> {
    const bucket = container.querySelector<HTMLElement>(
      '[data-project-id="calling-interface"] [data-testid="announcements-bucket"]',
    );
    await act(async () => {
      bucket?.click();
    });
    await flush();
  }

  it('the room-less board has NO open room, yet the `＋ open a room` compose is REACHABLE via the announcements bucket', async () => {
    await mountBoard();
    // Precondition: the board is room-less (no room rows) and nothing is open (no RoomView).
    expect(
      container.querySelector(
        '[data-project-id="calling-interface"] [data-room-id]',
      ),
    ).toBeNull();
    expect(container.querySelector('[data-testid="room-view"]')).toBeNull();
    // The open-a-room panel is NOT shown until the bucket is clicked.
    expect(
      container.querySelector('[data-testid="open-room-panel"]'),
    ).toBeNull();

    await clickAnnouncementsBucket();

    // The PROJECT-SCOPED compose panel is now mounted (independent of any open room), targeting
    // calling-interface — the exact gap the smoke caught.
    const panel = container.querySelector('[data-testid="open-room-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('data-project-id')).toBe('calling-interface');
    expect(
      container.querySelector('[data-testid="post-announcement-compose"]'),
    ).not.toBeNull();
    // Still no RoomView (we never opened a room — this is the room-less primary path).
    expect(container.querySelector('[data-testid="room-view"]')).toBeNull();
  });

  it('submitting the compose POSTs post_announcement with the RIGHT projectId + refreshes the tree (the new room appears live)', async () => {
    await mountBoard();
    await clickAnnouncementsBucket();

    // Fill subject + body and submit through the real compose form.
    const subject = container.querySelector<HTMLInputElement>(
      '[data-testid="post-announcement-subject"]',
    );
    const body = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="post-announcement-body"]',
    );
    await act(async () => {
      const inputSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      inputSetter?.call(subject, 'Need a decision');
      subject?.dispatchEvent(new Event('input', { bubbles: true }));
      const taSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      taSetter?.call(body, 'who owns the retry budget?');
      body?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="post-announcement-submit"]',
        )
        ?.click();
    });
    await flush();

    // The shell POSTed post_announcement to the SELECTED project's endpoint with the typed payload
    // — NOT derived from any open room (there was none).
    const annWrite = writes.find((w) =>
      w.url.endsWith('/api/projects/calling-interface/announcements'),
    );
    expect(annWrite).not.toBeUndefined();
    expect(annWrite?.body).toEqual({
      subject: 'Need a decision',
      body: 'who owns the retry budget?',
    });

    // On success the panel closes + the tree refreshed: the new room row now appears LIVE.
    expect(
      container.querySelector('[data-testid="open-room-panel"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-project-id="calling-interface"] [data-room-id="need-a-decision"]',
      ),
    ).not.toBeNull();
  });

  it('a NON-member opening the first room → the calm join-first handoff (never a silent failure), then join → back to the form', async () => {
    opsIsMember = false; // ops is NOT a member → post_announcement → NOT_A_MEMBER.
    await mountBoard();
    await clickAnnouncementsBucket();

    // Submit → core rejects NOT_A_MEMBER → the compose swaps to the join-first CTA (not silent).
    const subject = container.querySelector<HTMLInputElement>(
      '[data-testid="post-announcement-subject"]',
    );
    const body = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="post-announcement-body"]',
    );
    await act(async () => {
      const inputSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      inputSetter?.call(subject, 'sneak in');
      subject?.dispatchEvent(new Event('input', { bubbles: true }));
      const taSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      taSetter?.call(body, 'not a member yet');
      body?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="post-announcement-submit"]',
        )
        ?.click();
    });
    await flush();

    // The join-first CTA is shown (the handoff), the compose fields are gone — NOT a silent fail.
    const cta = container.querySelector<HTMLButtonElement>(
      '[data-testid="post-announcement-join-first"]',
    );
    expect(cta).not.toBeNull();
    expect(cta?.textContent).toBe('[ join this project first ]');

    // Click join-first → POSTs joinBoard for the SELECTED project, then drops back to the form.
    await act(async () => {
      cta?.click();
    });
    await flush();
    expect(
      writes.some((w) =>
        w.url.endsWith('/api/projects/calling-interface/join'),
      ),
    ).toBe(true);
    // Back to the compose form (now a member; the operator can re-submit to post).
    expect(
      container.querySelector('[data-testid="post-announcement-compose"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="post-announcement-join-first"]'),
    ).toBeNull();
  });
});

// --- Story 9.12 — JOIN A PROJECT FROM THE TREE. The previously-inert `＋ join a project…` row is
// now wired to the calm JoinProjectPicker → the EXISTING `POST /api/projects/:id/join`
// (`join_board`) + the EXISTING `fetchDirectory` read. These tests pin: clicking the row opens the
// picker listing the global-read directory MINUS the projects the operator ALREADY belongs to;
// choosing one POSTs join_board with the right id then refreshes the tree so membership shows live;
// closing without choosing writes nothing. The "minus already-member" filter is mutation-tested
// (Rule 7) — a member project must NOT appear in the picker. ---
describe('App shell — join a project from the tree (Story 9.12)', () => {
  /** Every board WRITE the shell issues (method + url + parsed JSON body). */
  let writes: { url: string; body: unknown }[];
  /** Whether `ops` is a member of `payments` (false initially → it's joinable; join flips it true). */
  let opsInPayments: boolean;

  function directory() {
    return {
      projects: [
        {
          project_id: 'calling-interface',
          title: 'Calling Interface',
          description: 'How agents dial in.',
          announcer: 'alice',
          // ops ALREADY belongs here → must NOT appear in the picker (the filter target).
          members: ['alice', 'ops'],
        },
        {
          project_id: 'payments',
          title: 'Payments',
          description: 'Money.',
          announcer: 'bob',
          // ops is NOT a member → it IS joinable, until the join flips it.
          members: opsInPayments ? ['bob', 'ops'] : ['bob'],
        },
      ],
    };
  }

  beforeEach(() => {
    writes = [];
    opsInPayments = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') {
          const parsed =
            typeof init?.body === 'string' && init.body.length > 0
              ? (JSON.parse(init.body) as unknown)
              : undefined;
          writes.push({ url, body: parsed });
          if (url === '/api/projects/payments/join') {
            opsInPayments = true; // the join lands → the tree refresh shows the membership.
            return new Response(
              JSON.stringify({
                project: {
                  project_id: 'payments',
                  title: 'Payments',
                  description: 'Money.',
                  announcer: 'bob',
                  members: ['bob', 'ops'],
                },
              }),
              { status: 200 },
            );
          }
          return new Response('nope', { status: 404 });
        }
        // GETs — dynamic so the post-join tree refresh + a re-open of the picker see the new state.
        if (url === '/api/me') {
          return new Response(JSON.stringify({ handle: 'ops' }), {
            status: 200,
          });
        }
        if (url === '/api/needs-you') {
          return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
        }
        if (url === '/api/directory') {
          return new Response(JSON.stringify(directory()), { status: 200 });
        }
        if (
          url === '/api/projects/calling-interface/rooms' ||
          url === '/api/projects/payments/rooms'
        ) {
          return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
        }
        if (
          url === '/api/projects/calling-interface/announcements' ||
          url === '/api/projects/payments/announcements'
        ) {
          return new Response(JSON.stringify({ announcements: [] }), {
            status: 200,
          });
        }
        return new Response('nope', { status: 404 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
  });

  async function mountBoard(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
  }

  /** Click the sidebar `＋ join a project…` row (opens the picker). */
  async function clickJoinRow(): Promise<void> {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="nav-join-project"]')
        ?.click();
    });
    await flush();
  }

  it('clicking `＋ join a project…` opens the picker listing the directory MINUS already-member projects', async () => {
    await mountBoard();
    // The picker is not shown until the row is clicked.
    expect(
      container.querySelector('[data-testid="join-project-picker"]'),
    ).toBeNull();

    await clickJoinRow();

    const picker = container.querySelector(
      '[data-testid="join-project-picker"]',
    );
    expect(picker).not.toBeNull();
    const choices = container.querySelectorAll(
      '[data-testid="join-project-choice"]',
    );
    // ONLY payments is joinable — calling-interface (ops already a member) is filtered OUT.
    // This is the Rule-7 mutation target: dropping the `!members.includes(operator)` filter makes
    // calling-interface appear here, turning this assertion RED.
    expect(choices.length).toBe(1);
    expect(choices[0]?.getAttribute('data-project-id')).toBe('payments');
    expect(
      container.querySelector(
        '[data-testid="join-project-choice"][data-project-id="calling-interface"]',
      ),
    ).toBeNull();
  });

  it('choosing a project POSTs join_board with the right id then refreshes the tree (membership live)', async () => {
    await mountBoard();
    await clickJoinRow();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="join-project-choice"][data-project-id="payments"]',
        )
        ?.click();
    });
    await flush();

    // The shell POSTed join_board to the chosen project's endpoint (path-only; no body).
    const joinWrite = writes.find((w) =>
      w.url.endsWith('/api/projects/payments/join'),
    );
    expect(joinWrite).not.toBeUndefined();

    // The picker closed on success.
    expect(
      container.querySelector('[data-testid="join-project-picker"]'),
    ).toBeNull();

    // The tree refreshed AND the membership is live: re-opening the picker no longer offers
    // payments (ops now belongs to BOTH projects → the joinable set is empty → calm empty state).
    await clickJoinRow();
    expect(
      container.querySelectorAll('[data-testid="join-project-choice"]').length,
    ).toBe(0);
    expect(
      container.querySelector('[data-testid="join-project-empty"]'),
    ).not.toBeNull();
  });

  it('closing the picker without choosing writes NOTHING (clean no-op)', async () => {
    await mountBoard();
    await clickJoinRow();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="join-project-cancel"]')
        ?.click();
    });
    await flush();

    // No board write was issued, and the picker is dismissed.
    expect(writes.length).toBe(0);
    expect(
      container.querySelector('[data-testid="join-project-picker"]'),
    ).toBeNull();
  });
});

// --- Story 9.12 QA value-add — the LOAD-BEARING joinable-filter + calm-UX semantics a naive test
// misses. The marquee semantic is the joinable filter: the global-read directory MINUS the projects
// the operator ALREADY belongs to, compared CANONICALLY (lowercased) — NOT a raw exact-match. We
// harden: (a) a project where the operator is a member under a DIFFERENT CASE of the handle is STILL
// excluded; (b) the null/watching-only operator path lists ALL projects (the host enforces the gate
// at choose-time); (c) the empty-joinable calm state (operator already in everything); (d) a
// choose→postJoin failure (NO_OPERATOR 403) surfaces the calm INLINE error with the picker STILL
// open — never a silent swallow, never a crash. The filter is mutation-tested in the dev block; this
// block sharpens the canonical compare + the failure path. ---
describe('App shell — join a project: filter + calm-UX hardening (Story 9.12 QA)', () => {
  /** Every board WRITE the shell issues (url + parsed body). */
  let writes: { url: string; body: unknown }[];
  /** Test-configurable `/api/me` handle (mixed-case allowed to prove canonical compare). */
  let meHandle: string | null;
  /** Test-configurable directory projects (members as the wire delivers them). */
  let dirProjects: {
    project_id: string;
    title: string;
    description: string;
    announcer: string;
    members: string[];
  }[];
  /** When set, a POST .../join returns this {status, body} instead of 200 success. */
  let joinFailure: { status: number; body: unknown } | null;

  beforeEach(() => {
    writes = [];
    meHandle = 'ops';
    joinFailure = null;
    dirProjects = [
      {
        project_id: 'calling-interface',
        title: 'Calling Interface',
        description: 'How agents dial in.',
        announcer: 'alice',
        members: ['alice', 'ops'],
      },
      {
        project_id: 'payments',
        title: 'Payments',
        description: 'Money.',
        announcer: 'bob',
        members: ['bob'],
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') {
          const parsed =
            typeof init?.body === 'string' && init.body.length > 0
              ? (JSON.parse(init.body) as unknown)
              : undefined;
          writes.push({ url, body: parsed });
          if (/^\/api\/projects\/[^/]+\/join$/.test(url)) {
            if (joinFailure !== null) {
              return new Response(JSON.stringify(joinFailure.body), {
                status: joinFailure.status,
              });
            }
            return new Response(JSON.stringify({ project: dirProjects[0] }), {
              status: 200,
            });
          }
          return new Response('nope', { status: 404 });
        }
        if (url === '/api/me') {
          return new Response(JSON.stringify({ handle: meHandle }), {
            status: 200,
          });
        }
        if (url === '/api/needs-you') {
          return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
        }
        if (url === '/api/directory') {
          return new Response(JSON.stringify({ projects: dirProjects }), {
            status: 200,
          });
        }
        if (/^\/api\/projects\/[^/]+\/rooms$/.test(url)) {
          return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
        }
        if (/^\/api\/projects\/[^/]+\/announcements$/.test(url)) {
          return new Response(JSON.stringify({ announcements: [] }), {
            status: 200,
          });
        }
        return new Response('nope', { status: 404 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
  });

  async function mountBoard(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
  }

  async function clickJoinRow(): Promise<void> {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="nav-join-project"]')
        ?.click();
    });
    await flush();
  }

  it('canonical compare — a project where the operator is a member under a DIFFERENT CASE is STILL excluded (not a raw match)', async () => {
    // The marquee semantic: the joinable filter compares the operator handle to members
    // CANONICALLY (lowercased on both sides), not by raw exact-match. Here the operator is `ops`
    // (canonical) but calling-interface lists the member as `Ops` (mixed case). A raw
    // `.includes('ops')` would FAIL to exclude it → calling-interface would wrongly appear as
    // joinable. The canonical compare excludes it. This is the regression this story's
    // "canonical-handle compare" claim must hold.
    meHandle = 'ops';
    dirProjects[0].members = ['alice', 'Ops']; // operator present under a DIFFERENT case.
    await mountBoard();
    await clickJoinRow();

    // calling-interface (operator is a member, mixed case) is NOT offered; only payments is.
    expect(
      container.querySelector(
        '[data-testid="join-project-choice"][data-project-id="calling-interface"]',
      ),
    ).toBeNull();
    const choices = container.querySelectorAll(
      '[data-testid="join-project-choice"]',
    );
    expect(choices.length).toBe(1);
    expect(choices[0]?.getAttribute('data-project-id')).toBe('payments');
  });

  it('watching-only host (operatorHandle === null) lists ALL projects — the host enforces the real gate at choose-time', async () => {
    // When there is no operator handle, the surface cannot compute a membership filter, so it
    // shows the WHOLE directory (Task 2 decision). The host returns NO_OPERATOR at choose-time;
    // the picker stays calm. Pin that BOTH projects are offered when watching-only.
    meHandle = null;
    await mountBoard();
    await clickJoinRow();

    const ids = Array.from(
      container.querySelectorAll('[data-testid="join-project-choice"]'),
    )
      .map((el) => el.getAttribute('data-project-id'))
      .sort();
    expect(ids).toEqual(['calling-interface', 'payments']);
  });

  it('empty-joinable calm state — operator already in EVERY project → the calm "no projects to join" line (not an error)', async () => {
    // The operator belongs to every directory project → the joinable set is empty → the picker
    // shows the CALM empty line, NOT the error slot and NOT a crash.
    meHandle = 'ops';
    dirProjects = dirProjects.map((p) => ({
      ...p,
      members: [...new Set([...p.members, 'ops'])],
    }));
    await mountBoard();
    await clickJoinRow();

    expect(
      container.querySelector('[data-testid="join-project-picker"]'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-testid="join-project-choice"]').length,
    ).toBe(0);
    expect(
      container.querySelector('[data-testid="join-project-empty"]'),
    ).not.toBeNull();
    // The calm empty state is NOT the error slot.
    expect(
      container.querySelector('[data-testid="join-project-error"]'),
    ).toBeNull();
  });

  it('choose → postJoin NO_OPERATOR (403) surfaces the calm INLINE error with the picker STILL open (no silent swallow, no crash)', async () => {
    // The watching-only / no-operator failure path: the operator opens the picker (watching-only
    // → all projects shown) and chooses one; the host returns 403 NO_OPERATOR. The shell must
    // surface that calmly in the inline error slot, keep the picker OPEN (never swap to a modal,
    // never silently swallow), and not crash. This is the calm-error invariant from AC #2.
    meHandle = null;
    joinFailure = {
      status: 403,
      body: {
        code: 'NO_OPERATOR',
        message: 'watching-only; pass --as <handle> to join.',
      },
    };
    await mountBoard();
    await clickJoinRow();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="join-project-choice"][data-project-id="payments"]',
        )
        ?.click();
    });
    await flush();

    // The join was attempted (no silent swallow at the call site)...
    expect(
      writes.some((w) => w.url.endsWith('/api/projects/payments/join')),
    ).toBe(true);
    // ...the picker is STILL open (not dismissed, not a modal)...
    expect(
      container.querySelector('[data-testid="join-project-picker"]'),
    ).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // ...and the calm inline error is shown to the operator.
    const errorEl = container.querySelector(
      '[data-testid="join-project-error"]',
    );
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it('re-opening the picker after a failed join still offers the project (the failure left the tree unchanged — no false membership)', async () => {
    // Idempotency/consistency corollary: a FAILED join must not optimistically flip membership.
    // After a NO_OPERATOR failure, re-opening the picker must STILL offer the project (the tree
    // was never refreshed to a joined state). Guards against a client-only optimistic membership
    // that would hide the project despite the join never landing.
    meHandle = null;
    joinFailure = {
      status: 403,
      body: {
        code: 'NO_OPERATOR',
        message: 'watching-only; pass --as <handle> to join.',
      },
    };
    await mountBoard();
    await clickJoinRow();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="join-project-choice"][data-project-id="payments"]',
        )
        ?.click();
    });
    await flush();

    // The picker stayed open; payments is still listed (the failed join did not flip membership).
    expect(
      container.querySelector(
        '[data-testid="join-project-choice"][data-project-id="payments"]',
      ),
    ).not.toBeNull();
  });
});

// --- Story 9.13: SET MY FOCUS wiring in the apps/web shell (Task 4 — Rule 3 real-runtime DOM
// evidence). A REGISTERED operator sees the affordance ENABLED on the `@operator (you)` row; setting
// focus POSTs /api/me/focus (the SAME core update_focus an agent uses) and reflects the new focus LIVE
// (re-read /api/me). A watching-only host (handle null) OR an UNREGISTERED operator (registered:false)
// sees the affordance DISABLED inline (no POST, no crash). ---
describe('App shell — set my focus (Story 9.13)', () => {
  /** Every board WRITE the shell issues (url + parsed body). */
  let writes: { url: string; body: unknown }[];
  /** Test-configurable /api/me: handle (null = watching-only), focus, registered. */
  let me: { handle: string | null; focus: string | null; registered: boolean };
  /** The focus the next GET /api/me reflects (the "live re-read" after a successful set). */
  let nextFocusAfterSet: string | null;

  beforeEach(() => {
    writes = [];
    me = { handle: 'ops', focus: 'initiating', registered: true };
    nextFocusAfterSet = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') {
          const parsed =
            typeof init?.body === 'string' && init.body.length > 0
              ? (JSON.parse(init.body) as { focus?: string })
              : undefined;
          writes.push({ url, body: parsed });
          if (url === '/api/me/focus') {
            // Disabled-state guard cases never reach here; an enabled set returns the new focus AND
            // arranges the next GET /api/me to reflect it (the live re-read the shell performs).
            const focus = parsed?.focus ?? '';
            nextFocusAfterSet = focus;
            return new Response(JSON.stringify({ handle: me.handle, focus }), {
              status: 200,
            });
          }
          return new Response('nope', { status: 404 });
        }
        if (url === '/api/me') {
          return new Response(
            JSON.stringify({
              handle: me.handle,
              focus: nextFocusAfterSet ?? me.focus,
              registered: me.registered,
            }),
            { status: 200 },
          );
        }
        if (url === '/api/needs-you') {
          return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
        }
        if (url === '/api/directory') {
          return new Response(JSON.stringify({ projects: [] }), {
            status: 200,
          });
        }
        if (/^\/api\/projects\/[^/]+\/rooms$/.test(url)) {
          return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
        }
        if (/^\/api\/projects\/[^/]+\/announcements$/.test(url)) {
          return new Response(JSON.stringify({ announcements: [] }), {
            status: 200,
          });
        }
        return new Response('nope', { status: 404 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      FakeEventSource as unknown as typeof EventSource,
    );
  });

  async function mountBoard(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();
  }

  it('a REGISTERED operator: the affordance is ENABLED + shows the current focus; setting it POSTs and reflects live', async () => {
    me = { handle: 'ops', focus: 'initiating', registered: true };
    await mountBoard();

    // The affordance shows the current focus (resting) and offers [ edit ] (enabled, not disabled).
    const affordance = container.querySelector(
      '[data-testid="focus-affordance"]',
    );
    expect(affordance).not.toBeNull();
    expect(
      container.querySelector('[data-testid="focus-current"]')?.textContent,
    ).toContain('initiating');
    expect(
      container.querySelector('[data-testid="focus-disabled-reason"]'),
    ).toBeNull();

    // Open the editor, type a new focus, submit.
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="focus-edit"]')
        ?.click();
    });
    const field = container.querySelector<HTMLInputElement>(
      '[data-testid="focus-field"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(field, 'reviewing the retry budget');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>('[data-testid="focus-affordance"]')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    await flush();

    // It POSTed /api/me/focus with the trimmed focus (the SAME core op — no backdoor).
    const focusWrite = writes.find((w) => w.url === '/api/me/focus');
    expect(focusWrite).toBeDefined();
    expect(focusWrite?.body).toEqual({ focus: 'reviewing the retry budget' });

    // The new focus reflects LIVE on the row (re-read /api/me returned the new value).
    expect(
      container.querySelector('[data-testid="focus-current"]')?.textContent,
    ).toContain('reviewing the retry budget');
  });

  it('a watching-only host (handle null): the affordance is DISABLED inline — no edit, no POST, no crash', async () => {
    me = { handle: null, focus: null, registered: false };
    await mountBoard();

    // The affordance is present but inert: no [ edit ] control, the terse watching-only reason shows.
    expect(
      container.querySelector('[data-testid="focus-affordance"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="focus-edit"]')).toBeNull();
    const reason = container.querySelector(
      '[data-testid="focus-disabled-reason"]',
    );
    expect(reason).not.toBeNull();
    expect(reason?.textContent).toContain('watching-only');
    // No focus write was issued (the gate is client-side primary).
    expect(writes.some((w) => w.url === '/api/me/focus')).toBe(false);
  });

  it('an UNREGISTERED operator (registered:false): the affordance is DISABLED inline — no edit, no POST, no crash', async () => {
    me = { handle: 'ghost', focus: null, registered: false };
    await mountBoard();

    expect(
      container.querySelector('[data-testid="focus-affordance"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="focus-edit"]')).toBeNull();
    const reason = container.querySelector(
      '[data-testid="focus-disabled-reason"]',
    );
    expect(reason).not.toBeNull();
    expect(reason?.textContent).toContain('handle not registered');
    expect(writes.some((w) => w.url === '/api/me/focus')).toBe(false);
  });
});
