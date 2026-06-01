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
