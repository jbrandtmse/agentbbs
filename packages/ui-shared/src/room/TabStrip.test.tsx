// DOM tests for the room editor TabStrip + RoomTab (Story 9.8 Task 3, AC #1 + #2).
//
// Runs under the 'ui-shared-dom' Vitest project (happy-dom; IS_REACT_ACT_ENVIRONMENT set by
// test-setup-dom.ts). Renders into a real DOM and asserts the STRUCTURAL outcome:
//   - multiple tabs render side-by-side (AC1 — rooms open like files);
//   - the ACTIVE tab is base-bg + strong text + the 2px accent TOP rail; INACTIVE tabs are
//     panel-bg + dim text (DESIGN room-tab);
//   - the trailing `×` (close glyph) is present; a background tab with `unread` shows the
//     leading `•` (accent), the active/read tab does not;
//   - `onSelect` fires with the room id on a tab-body click;
//   - `onClose` fires with the room id on a `×` click and does NOT also fire `onSelect`
//     (the close is a discrete VIEW action — AC2; the component-level guarantee that it is a
//     pure callback with no board write is asserted at the apps/web level).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoomTab } from './RoomTab.js';
import { TabStrip } from './TabStrip.js';

import type { RoomTabModel } from './RoomTab.js';
import type { ReactNode } from 'react';

let mountEl: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mountEl = document.createElement('div');
  document.body.append(mountEl);
  root = createRoot(mountEl);
});

afterEach(() => {
  act(() => root.unmount());
  mountEl.remove();
});

function render(node: ReactNode): HTMLElement {
  act(() => {
    root.render(node);
  });
  return mountEl;
}

const TABS: RoomTabModel[] = [
  { roomId: 'need-a-decision', label: 'need-a-decision' },
  { roomId: 'ledger-rollover', label: 'ledger-rollover', unread: true },
];

describe('TabStrip (AC #1 — rooms open as tabs side-by-side)', () => {
  it('renders multiple open tabs side-by-side, in order', () => {
    const el = render(<TabStrip tabs={TABS} activeRoomId="need-a-decision" />);
    const tabs = el.querySelectorAll('[data-testid="room-tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('data-room-id')).toBe('need-a-decision');
    expect(tabs[1]?.getAttribute('data-room-id')).toBe('ledger-rollover');
  });

  it('renders nothing when no rooms are open', () => {
    const el = render(<TabStrip tabs={[]} activeRoomId={null} />);
    expect(el.querySelector('[data-testid="tab-strip"]')).toBeNull();
  });

  it('ACTIVE tab = base bg + strong text + 2px accent TOP rail; INACTIVE = panel bg + dim text', () => {
    const el = render(<TabStrip tabs={TABS} activeRoomId="need-a-decision" />);
    const active = el.querySelector<HTMLElement>(
      '[data-room-id="need-a-decision"]',
    );
    const inactive = el.querySelector<HTMLElement>(
      '[data-room-id="ledger-rollover"]',
    );
    expect(active?.getAttribute('data-active')).toBe('true');
    expect(active?.style.background).toContain('var(--surface-base)');
    expect(active?.style.color).toContain('var(--text-strong)');
    // The 2px accent TOP rail (DESIGN room-tab active-rail = inset 0 2px 0 accent).
    expect(active?.style.boxShadow).toContain('var(--accent)');
    expect(active?.style.boxShadow).toContain('2px');

    expect(inactive?.getAttribute('data-active')).toBe('false');
    expect(inactive?.style.background).toContain('var(--surface-panel)');
    expect(inactive?.style.color).toContain('var(--text-dim)');
    expect(inactive?.style.boxShadow).toBe('none');
  });

  it('a background tab with unread shows the leading • (accent); the active/read tab does not', () => {
    // need-a-decision is active + has no unread → no dot; ledger-rollover is a background tab
    // with unread → leading •.
    const el = render(<TabStrip tabs={TABS} activeRoomId="need-a-decision" />);
    const activeTab = el.querySelector<HTMLElement>(
      '[data-room-id="need-a-decision"]',
    );
    const bgTab = el.querySelector<HTMLElement>(
      '[data-room-id="ledger-rollover"]',
    );
    expect(
      activeTab?.querySelector('[data-testid="room-tab-unread"]'),
    ).toBeNull();
    const dot = bgTab?.querySelector<HTMLElement>(
      '[data-testid="room-tab-unread"]',
    );
    expect(dot).not.toBeNull();
    expect(dot?.textContent).toBe('•');
    expect(dot?.style.color).toContain('var(--accent)');
  });

  it('every tab carries the trailing × close glyph', () => {
    const el = render(<TabStrip tabs={TABS} activeRoomId="need-a-decision" />);
    const closers = el.querySelectorAll('[data-testid="room-tab-close"]');
    expect(closers).toHaveLength(2);
    expect(closers[0]?.textContent).toBe('×');
  });

  it('a 1px --border divider sits between tabs (not before the first)', () => {
    const el = render(<TabStrip tabs={TABS} activeRoomId="need-a-decision" />);
    const wrappers = el.querySelectorAll<HTMLElement>(
      '[data-testid="tab-strip"] > div',
    );
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0]?.style.borderLeft).toBe('');
    expect(wrappers[1]?.style.borderLeft).toContain('var(--border)');
  });

  it('clicking a tab body fires onSelect with that room id', () => {
    const onSelect = vi.fn();
    const el = render(
      <TabStrip
        tabs={TABS}
        activeRoomId="need-a-decision"
        onSelect={onSelect}
      />,
    );
    const bgTab = el.querySelector<HTMLElement>(
      '[data-room-id="ledger-rollover"]',
    );
    act(() => {
      bgTab?.click();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('ledger-rollover');
  });

  it('clicking a tab × fires onClose with that room id and does NOT also fire onSelect', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const el = render(
      <TabStrip
        tabs={TABS}
        activeRoomId="need-a-decision"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const closeBtn = el
      .querySelector('[data-room-id="ledger-rollover"]')
      ?.querySelector<HTMLButtonElement>('[data-testid="room-tab-close"]');
    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('ledger-rollover');
    // The × click is stopped from bubbling into the tab body's onSelect.
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('RoomTab (active/inactive + unread, standalone)', () => {
  it('active tab sets aria-selected + role=tab', () => {
    const el = render(
      <RoomTab tab={{ roomId: 'r1', label: 'r1' }} active={true} />,
    );
    const tab = el.querySelector('[data-testid="room-tab"]');
    expect(tab?.getAttribute('role')).toBe('tab');
    expect(tab?.getAttribute('aria-selected')).toBe('true');
  });

  it('an unread active tab still shows the • (focus-clear is the surface concern)', () => {
    const el = render(
      <RoomTab
        tab={{ roomId: 'r1', label: 'r1', unread: true }}
        active={true}
      />,
    );
    expect(el.querySelector('[data-testid="room-tab-unread"]')).not.toBeNull();
  });
});
