// Accessibility-floor DOM tests (Story 9.10, Task 4 + Task 5 — Rule 3 real-runtime evidence).
// Runs in the happy-dom project. Asserts the rendered roles/attributes/keyboard behavior of
// the a11y floor: the tree (role=tree/treeitem/group + aria-expanded + roving tabindex +
// arrow-key traversal + Enter-to-open), the thread (role=list of listitems announcing
// handle/timestamp/agreed + a polite COALESCING aria-live region), and the composer (keyboard
// reachable + Esc returns focus). Focus-ring + reduced-motion live in chrome.css (asserted by
// the contrast test + the CSS presence test).

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavTree } from '../tree/NavTree.js';
import { MessageThread } from '../room/MessageThread.js';
import { Composer } from '../room/Composer.js';

import type { MessagePostModel } from '../room/MessagePost.js';
import type { NavTreeModel } from '../tree/NavTree.js';
import type { Root } from 'react-dom/client';
import type { ReactNode } from 'react';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render(node: ReactNode): void {
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
}

function fireKey(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

const treeModel: NavTreeModel = {
  operatorHandle: 'operator',
  activeRoomId: null,
  needsYou: [],
  projects: [
    {
      projectId: 'p1',
      title: 'Project One',
      announcementCount: 1,
      rooms: [
        {
          roomId: 'room-a',
          subject: 'Room A',
          unread: true,
          activityCount: 2,
          needsYou: false,
        },
        {
          roomId: 'room-b',
          subject: 'Room B',
          unread: false,
          activityCount: 0,
          needsYou: false,
        },
      ],
    },
  ],
};

describe('a11y — tree roles + aria-expanded (AC3)', () => {
  it('exposes a single role="tree" with role="treeitem" projects and role="group" room lists', () => {
    render(<NavTree model={treeModel} />);
    const trees = container.querySelectorAll('[role="tree"]');
    // Exactly one nav tree (the NEEDS YOU section is a role="list", not a second tree).
    expect(trees).toHaveLength(1);
    const project = container.querySelector(
      '[data-project-id="p1"]',
    ) as HTMLElement;
    expect(project.getAttribute('role')).toBe('treeitem');
    expect(project.getAttribute('aria-expanded')).toBe('true');
    expect(project.querySelector('[role="group"]')).not.toBeNull();
    // The room rows are treeitems.
    expect(
      container.querySelector('[data-room-id="room-a"]')?.getAttribute('role'),
    ).toBe('treeitem');
  });

  it('toggles aria-expanded when the project twisty is activated by keyboard (Enter)', () => {
    render(<NavTree model={treeModel} />);
    const project = container.querySelector(
      '[data-project-id="p1"]',
    ) as HTMLElement;
    expect(project.getAttribute('aria-expanded')).toBe('true');
    // Collapse via Enter on the project header.
    fireKey(project, 'Enter');
    expect(
      container
        .querySelector('[data-project-id="p1"]')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
    // Collapsed → the room group is gone (rooms removed from the tree).
    expect(container.querySelector('[data-room-id="room-a"]')).toBeNull();
  });

  it('ArrowLeft collapses an expanded project; ArrowRight re-expands it', () => {
    render(<NavTree model={treeModel} />);
    const project = () =>
      container.querySelector('[data-project-id="p1"]') as HTMLElement;
    fireKey(project(), 'ArrowLeft');
    expect(project().getAttribute('aria-expanded')).toBe('false');
    fireKey(project(), 'ArrowRight');
    expect(project().getAttribute('aria-expanded')).toBe('true');
  });

  it('uses a roving tabindex: exactly one tree row has tabindex=0, the rest -1', () => {
    render(<NavTree model={treeModel} />);
    const rows = [...container.querySelectorAll<HTMLElement>('[data-tree-id]')];
    expect(rows.length).toBeGreaterThan(1);
    const zero = rows.filter((r) => r.getAttribute('tabindex') === '0');
    const minusOne = rows.filter((r) => r.getAttribute('tabindex') === '-1');
    expect(zero).toHaveLength(1);
    expect(minusOne).toHaveLength(rows.length - 1);
  });

  it('Enter on a room row activates onSelectRoom (keyboard-openable)', () => {
    const onSelectRoom = vi.fn();
    render(<NavTree model={treeModel} onSelectRoom={onSelectRoom} />);
    const roomA = container.querySelector(
      '[data-room-id="room-a"]',
    ) as HTMLElement;
    fireKey(roomA, 'Enter');
    expect(onSelectRoom).toHaveBeenCalledWith('room-a');
  });

  it('a room row carries an aria-label announcing its id + read/needs-you state', () => {
    render(<NavTree model={treeModel} />);
    expect(
      container
        .querySelector('[data-room-id="room-a"]')
        ?.getAttribute('aria-label'),
    ).toBe('#room-a, unread');
    expect(
      container
        .querySelector('[data-room-id="room-b"]')
        ?.getAttribute('aria-label'),
    ).toBe('#room-b, read');
  });
});

describe('a11y — thread is an announced list with a coalescing live region (AC3)', () => {
  const messages: MessagePostModel[] = [
    {
      seq: 1,
      actor: 'alice',
      body: 'hello',
      kind: 'announcement',
      reactions: [],
      createdAt: '2026-06-01T08:00:00.000Z',
    },
    {
      seq: 2,
      actor: 'ops',
      body: 'world',
      kind: 'reply',
      reactions: ['ops'],
      createdAt: '2026-06-01T08:05:00.000Z',
    },
  ];

  it('renders the thread as role="list" of role="listitem" posts that announce handle/agreed', () => {
    render(<MessageThread messages={messages} agreedSeq={2} />);
    const list = container.querySelector('[data-testid="message-thread"]');
    expect(list?.getAttribute('role')).toBe('list');
    const items = container.querySelectorAll('[data-testid="message-post"]');
    expect(items).toHaveLength(2);
    for (const item of items)
      expect(item.getAttribute('role')).toBe('listitem');
    // The agreed post (seq 2) announces "agreed"; its handle is in the label.
    const post2 = container.querySelector('[data-message-seq="2"]');
    expect(post2?.getAttribute('aria-label')).toContain('@ops');
    expect(post2?.getAttribute('aria-label')).toContain('agreed');
    // The non-agreed post does not announce "agreed".
    expect(
      container
        .querySelector('[data-message-seq="1"]')
        ?.getAttribute('aria-label'),
    ).not.toContain('agreed');
  });

  it('exposes a polite aria-live region (empty on first render — no announcement of the initial load)', () => {
    render(<MessageThread messages={messages} />);
    const live = container.querySelector('[data-testid="thread-live-region"]');
    expect(live).not.toBeNull();
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.getAttribute('aria-atomic')).toBe('true');
    // The initial thread load is NOT "new posts" — the live region is silent.
    expect(live?.textContent).toBe('');
  });

  it('COALESCES a burst of new posts into ONE summary announcement (does not spam N)', () => {
    vi.useFakeTimers();
    // Render with the baseline, then re-render with MORE posts arriving in a burst.
    act(() => {
      root = createRoot(container);
      root.render(
        <MessageThread messages={messages} liveRegionDebounceMs={50} />,
      );
    });
    const more: MessagePostModel[] = [
      ...messages,
      {
        seq: 3,
        actor: 'alice',
        body: 'a',
        kind: 'reply',
        reactions: [],
        createdAt: '2026-06-01T08:06:00.000Z',
      },
      {
        seq: 4,
        actor: 'alice',
        body: 'b',
        kind: 'reply',
        reactions: [],
        createdAt: '2026-06-01T08:07:00.000Z',
      },
    ];
    act(() => {
      root.render(<MessageThread messages={more} liveRegionDebounceMs={50} />);
    });
    const live = container.querySelector('[data-testid="thread-live-region"]');
    // Before the debounce window elapses, NOTHING is announced (no spam).
    expect(live?.textContent).toBe('');
    // After the window: ONE coalesced summary for the 2 new posts.
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(
      container.querySelector('[data-testid="thread-live-region"]')
        ?.textContent,
    ).toBe('2 new posts');
  });

  it('coalesces a burst that arrives in SEPARATE re-renders across the window into ONE total summary (accumulation, not last-delta)', () => {
    // HARDENING (QA): the dev's coalesce test fires both new posts in a SINGLE re-render, so it
    // does not distinguish "announce the total of the burst" from "announce the latest delta".
    // Here the burst arrives as THREE separate re-renders (1, then +1, then +1), EACH inside the
    // debounce window (each resets the timer). The accumulator (`pendingDeltaRef`) must sum them
    // to ONE "3 new posts" — NOT "1 new post" (last delta) and NOT three separate announcements.
    vi.useFakeTimers();
    let seq = 2;
    const grow = (base: MessagePostModel[]): MessagePostModel[] => [
      ...base,
      {
        seq: ++seq,
        actor: 'alice',
        body: `m${seq}`,
        kind: 'reply',
        reactions: [],
        createdAt: '2026-06-01T08:06:00.000Z',
      },
    ];
    const live = () =>
      container.querySelector('[data-testid="thread-live-region"]')
        ?.textContent;

    act(() => {
      root = createRoot(container);
      root.render(
        <MessageThread messages={messages} liveRegionDebounceMs={50} />,
      );
    });
    let current = messages;
    // Three deltas, each ~20ms apart — all WITHIN the rolling 50ms window (timer keeps resetting).
    for (let i = 0; i < 3; i++) {
      current = grow(current);
      const next = current;
      act(() => {
        root.render(
          <MessageThread messages={next} liveRegionDebounceMs={50} />,
        );
      });
      // Nothing announced yet mid-burst (each re-render resets the debounce).
      expect(live()).toBe('');
      act(() => {
        vi.advanceTimersByTime(20);
      });
    }
    // Now let the window fully elapse: ONE announcement summing the whole burst (3), not 1.
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(live()).toBe('3 new posts');
  });
});

describe('a11y — composer keyboard reachable + Esc returns focus (AC3)', () => {
  it('the not-joined gate is a real keyboard-activatable button', () => {
    const onJoin = vi.fn();
    render(<Composer joined={false} onJoin={onJoin} />);
    const join = container.querySelector(
      '[data-testid="composer-join"]',
    ) as HTMLButtonElement;
    expect(join.tagName).toBe('BUTTON');
    act(() => join.click());
    expect(onJoin).toHaveBeenCalled();
  });

  it('the joined field is keyboard-reachable + Esc fires onEscape (return focus to thread)', () => {
    const onEscape = vi.fn();
    render(<Composer joined={true} onEscape={onEscape} />);
    const field = container.querySelector(
      '[data-testid="composer-field"]',
    ) as HTMLInputElement;
    expect(field.getAttribute('aria-label')).toBe('message');
    fireKey(field, 'Escape');
    expect(onEscape).toHaveBeenCalled();
  });
});
