// DOM tests for the per-message 👍 ReactionChip + the computed ✓ AgreedMark (Story 9.6
// Task 4, AC #1 + #2).
//
// Runs under the 'ui-shared-dom' Vitest project (happy-dom; IS_REACT_ACT_ENVIRONMENT set by
// test-setup-dom.ts). Renders into a real DOM and asserts the STRUCTURAL outcome:
//   - the chip shows the live count + the resting-vs-currently-👍'd visual state (the green
//     tint on 👍'd, the calm chip-bg/border on resting);
//   - a one-click toggle fires `onToggle` exactly once;
//   - a NON-participant (!canReact) chip is disabled + shows the "join to react" hand-off and
//     does NOT fire `onToggle` on click (no doomed write);
//   - the AgreedMark renders `✓ agreed` in agreed-green for both head + footer placements.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgreedMark } from './AgreedMark.js';
import { ReactionChip } from './ReactionChip.js';

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

describe('ReactionChip (AC #1 — live count + resting/reacted + one-click toggle)', () => {
  it('renders the live count with the 👍 glyph', () => {
    const el = render(
      <ReactionChip count={3} reacted={false} canReact={true} />,
    );
    const chip = el.querySelector('[data-testid="reaction-chip"]');
    expect(chip?.textContent).toContain('👍');
    expect(
      el.querySelector('[data-testid="reaction-chip-count"]')?.textContent,
    ).toBe('3');
  });

  it('RESTING state (not currently reacted): chip-bg + faint border, NOT the green tint', () => {
    const el = render(
      <ReactionChip count={0} reacted={false} canReact={true} />,
    );
    const chip = el.querySelector<HTMLElement>('[data-testid="reaction-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('resting');
    expect(chip?.getAttribute('aria-pressed')).toBe('false');
    // Resting uses --chip-bg + the faint --border; never the agreed-line green tint.
    expect(chip?.style.background).toContain('var(--chip-bg)');
    expect(chip?.style.borderColor).toBe('var(--border)');
    expect(chip?.style.borderColor).not.toContain('var(--agreed-line)');
  });

  it('CURRENTLY-reacted state: green-tinted bg + agreed-line border + brighter text', () => {
    const el = render(
      <ReactionChip count={1} reacted={true} canReact={true} />,
    );
    const chip = el.querySelector<HTMLElement>('[data-testid="reaction-chip"]');
    expect(chip?.getAttribute('data-state')).toBe('reacted');
    expect(chip?.getAttribute('aria-pressed')).toBe('true');
    // The green wash (DESIGN.md thumbs-up.has-bg) + the agreed-line border + brighter --text.
    // (Whitespace-tolerant: the DOM normalizes rgba() spacing on readback.)
    expect(chip?.style.background.replace(/\s/g, '')).toContain(
      'rgba(78,192,122,0.13)',
    );
    expect(chip?.style.borderColor).toBe('var(--agreed-line)');
    expect(chip?.style.color).toBe('var(--text)');
  });

  it('high-contrast drops the green WASH for a solid agreed-line border (no rgba wash)', () => {
    const el = render(
      <ReactionChip
        count={1}
        reacted={true}
        canReact={true}
        highContrast={true}
      />,
    );
    const chip = el.querySelector<HTMLElement>('[data-testid="reaction-chip"]');
    // HC: the green rgba wash is gone; the state still reads via the solid agreed-line border.
    expect(chip?.style.background.replace(/\s/g, '')).not.toContain(
      'rgba(78,192,122,0.13)',
    );
    expect(chip?.style.borderColor).toBe('var(--agreed-line)');
  });

  it('toggles in ONE click — fires onToggle exactly once', () => {
    const onToggle = vi.fn();
    const el = render(
      <ReactionChip
        count={0}
        reacted={false}
        canReact={true}
        onToggle={onToggle}
      />,
    );
    const chip = el.querySelector<HTMLButtonElement>(
      '[data-testid="reaction-chip"]',
    );
    act(() => {
      chip?.click();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('a NON-participant (!canReact) chip is DISABLED with a "join to react" hand-off and does NOT fire onToggle', () => {
    const onToggle = vi.fn();
    const el = render(
      <ReactionChip
        count={2}
        reacted={false}
        canReact={false}
        onToggle={onToggle}
      />,
    );
    const chip = el.querySelector<HTMLButtonElement>(
      '[data-testid="reaction-chip"]',
    );
    expect(chip?.getAttribute('data-state')).toBe('cannot-react');
    expect(chip?.disabled).toBe(true);
    // The open READ still shows the live count (FR9 — any reader sees it).
    expect(
      el.querySelector('[data-testid="reaction-chip-count"]')?.textContent,
    ).toBe('2');
    // The "join to react" hand-off (Story 9.7) is present.
    expect(chip?.textContent).toContain('join to react');
    // A click fires NO write (a disabled button never invokes onClick; assert no doomed write).
    act(() => {
      chip?.click();
    });
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('AgreedMark (AC #2 — ✓ agreed in agreed-green, head + footer)', () => {
  it('renders `✓ agreed` in agreed-green for the HEAD placement', () => {
    const el = render(<AgreedMark placement="head" />);
    const mark = el.querySelector<HTMLElement>(
      '[data-testid="agreed-mark-head"]',
    );
    expect(mark?.textContent).toContain('✓');
    expect(mark?.textContent).toContain('agreed');
    expect(mark?.style.color).toContain('var(--agreed-green)');
    expect(mark?.getAttribute('data-placement')).toBe('head');
  });

  it('renders the FOOTER placement variant', () => {
    const el = render(<AgreedMark placement="footer" />);
    const mark = el.querySelector<HTMLElement>(
      '[data-testid="agreed-mark-footer"]',
    );
    expect(mark?.getAttribute('data-placement')).toBe('footer');
    expect(mark?.style.color).toContain('var(--agreed-green)');
  });
});
