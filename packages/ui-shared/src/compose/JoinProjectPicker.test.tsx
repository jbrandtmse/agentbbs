// DOM tests for the JoinProjectPicker affordance (Story 9.12 Task 3, AC #1, #2).
//
// Runs under the 'ui-shared-dom' Vitest project (happy-dom; IS_REACT_ACT_ENVIRONMENT set by
// test-setup-dom.ts). Renders into a real DOM and asserts the prop-driven join-project picker:
//   - renders the joinable list (one [ join ] row per project) carrying the project title + id;
//   - clicking a row fires onChoose(projectId);
//   - cancel fires onCancel (clean no-op — no board write at this layer);
//   - Esc fires onEscape (clean no-op);
//   - the EMPTY-list calm state ("no projects to join") renders — NOT an error;
//   - the inline `error` slot renders the calm message (the NO_OPERATOR surface) — no modal;
//   - pending disables the choose + cancel controls (basic disabled state).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JoinProjectPicker } from './JoinProjectPicker.js';

import type { JoinableProject } from './JoinProjectPicker.js';
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

const JOINABLE: JoinableProject[] = [
  { projectId: 'calling-interface', title: 'Calling Interface' },
  { projectId: 'payments', title: 'Payments' },
];

describe('JoinProjectPicker (AC #1, #2)', () => {
  it('renders the joinable list — one [ join ] row per project, carrying title + id', () => {
    const el = render(<JoinProjectPicker joinable={JOINABLE} />);
    expect(
      el.querySelector('[data-testid="join-project-picker"]'),
    ).not.toBeNull();
    const rows = el.querySelectorAll('[data-testid="join-project-choice"]');
    expect(rows.length).toBe(2);
    expect(rows[0]?.getAttribute('data-project-id')).toBe('calling-interface');
    expect(rows[0]?.textContent).toContain('Calling Interface');
    expect(rows[1]?.getAttribute('data-project-id')).toBe('payments');
    expect(rows[1]?.textContent).toContain('Payments');
  });

  it('clicking a row fires onChoose(projectId)', () => {
    let chosen: string | undefined;
    const el = render(
      <JoinProjectPicker
        joinable={JOINABLE}
        onChoose={(id) => (chosen = id)}
      />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-project-id="payments"][data-testid="join-project-choice"]',
      )?.click();
    });
    expect(chosen).toBe('payments');
  });

  it('cancel fires onCancel (clean no-op)', () => {
    let cancelled = 0;
    const el = render(
      <JoinProjectPicker
        joinable={JOINABLE}
        onCancel={() => (cancelled += 1)}
      />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="join-project-cancel"]',
      )?.click();
    });
    expect(cancelled).toBe(1);
  });

  it('Esc fires onEscape (clean no-op)', () => {
    let escaped = 0;
    const el = render(
      <JoinProjectPicker joinable={JOINABLE} onEscape={() => (escaped += 1)} />,
    );
    act(() => {
      el.querySelector<HTMLElement>(
        '[data-testid="join-project-picker"]',
      )?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(escaped).toBe(1);
  });

  it('the EMPTY-list calm state renders ("no projects to join") — NOT an error', () => {
    const el = render(<JoinProjectPicker joinable={[]} />);
    const empty = el.querySelector('[data-testid="join-project-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('no projects to join');
    // No choice rows, and the calm line is NOT the error slot.
    expect(el.querySelector('[data-testid="join-project-choice"]')).toBeNull();
    expect(el.querySelector('[data-testid="join-project-error"]')).toBeNull();
  });

  it('the inline `error` slot renders the calm message (NO_OPERATOR surface), no modal', () => {
    const el = render(
      <JoinProjectPicker
        joinable={JOINABLE}
        error="watching-only; pass --as <handle> to join."
      />,
    );
    const errorEl = el.querySelector('[data-testid="join-project-error"]');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('watching-only');
    // The picker (list) is STILL rendered (no modal; the panel stays).
    expect(
      el.querySelector('[data-testid="join-project-list"]'),
    ).not.toBeNull();
  });

  it('pending disables the choose rows + cancel (no double-submit)', () => {
    const el = render(<JoinProjectPicker joinable={JOINABLE} pending />);
    el.querySelectorAll<HTMLButtonElement>(
      '[data-testid="join-project-choice"]',
    ).forEach((row) => expect(row.disabled).toBe(true));
    expect(
      el.querySelector<HTMLButtonElement>('[data-testid="join-project-cancel"]')
        ?.disabled,
    ).toBe(true);
  });

  // --- QA value-add (Story 9.12) ---

  it('is NOT a modal — the panel is a role="group", with no role="dialog"/"alertdialog" anywhere (calm chrome, AC #2)', () => {
    // Calm-UX invariant asserted by ROLE, not by a substring. The picker is an inline panel
    // (Story 9.10 calm chrome), never a modal dialog. Assert positively that the container is a
    // labelled group AND negatively that no dialog role exists in the rendered subtree (a future
    // refactor to a <dialog>/role="dialog" must turn this RED). The error slot is likewise inline.
    const el = render(
      <JoinProjectPicker
        joinable={JOINABLE}
        error="watching-only; pass --as <handle> to join."
      />,
    );
    const panel = el.querySelector('[data-testid="join-project-picker"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('role')).toBe('group');
    expect(panel?.getAttribute('aria-label')).toBe('join a project');
    // No modal anywhere — neither dialog nor alertdialog, and no aria-modal.
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(el.querySelector('[role="alertdialog"]')).toBeNull();
    expect(el.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('renders the inline error slot WITH the joinable list intact AND fires NO onChoose/onCancel just from showing an error (no silent side effect)', () => {
    // A choose→postJoin failure (e.g. NO_OPERATOR) surfaces the calm inline error UNDER the list;
    // showing the error must not itself trigger any callback (the surface drives state). Pin that
    // the error renders, the list survives (panel stays — no modal swap), and no callback fired.
    let chose = 0;
    let cancelled = 0;
    const el = render(
      <JoinProjectPicker
        joinable={JOINABLE}
        error="no operator — pass --as <handle> to join."
        onChoose={() => (chose += 1)}
        onCancel={() => (cancelled += 1)}
      />,
    );
    const errorEl = el.querySelector('[data-testid="join-project-error"]');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('no operator');
    expect(errorEl?.getAttribute('role')).toBe('status');
    // The list is STILL present alongside the error (the panel did not collapse to an error view).
    expect(
      el.querySelectorAll('[data-testid="join-project-choice"]').length,
    ).toBe(2);
    // Merely rendering the error fired no callback.
    expect(chose).toBe(0);
    expect(cancelled).toBe(0);
  });

  it('a disabled (pending) choose row does NOT fire onChoose when clicked (no double-submit slips through)', () => {
    // Pinning the disabled state is BEHAVIORAL, not just an attribute: a click on a pending row
    // must not call onChoose (the browser suppresses click on a disabled button). This guards the
    // no-double-submit invariant under a real DOM click, not merely the `disabled` attribute.
    let chose = 0;
    const el = render(
      <JoinProjectPicker
        joinable={JOINABLE}
        pending
        onChoose={() => (chose += 1)}
      />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-project-id="payments"][data-testid="join-project-choice"]',
      )?.click();
    });
    expect(chose).toBe(0);
  });
});
