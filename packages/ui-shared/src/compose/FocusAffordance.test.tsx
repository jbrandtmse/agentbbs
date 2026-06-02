// DOM tests for the FocusAffordance (Story 9.13 Task 3, AC #1).
//
// Runs under the 'ui-shared-dom' Vitest project (happy-dom; IS_REACT_ACT_ENVIRONMENT set by
// test-setup-dom.ts). Renders into a real DOM and asserts the prop-driven set-my-focus affordance:
//   - resting: the current focus renders (or the `set your focus…` placeholder when absent);
//   - `[ edit ]` reveals the field pre-filled with the current focus; submit fires onSubmit(trimmed);
//   - empty/whitespace does NOT submit (no empty focus);
//   - the inline `error` slot renders (no modal); cancel/Esc fire their callbacks;
//   - DISABLED renders inert — the `[ edit ]` control is GONE, the terse reason renders, the current
//     focus stays visible (watching-only / unregistered) — never a crash;
//   - NFR2: imports React only (asserted indirectly — the component module has no core import).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FocusAffordance } from './FocusAffordance.js';

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

/** Type a value into the focus field (fires React's onChange via the native input setter). */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('FocusAffordance (AC #1)', () => {
  it('resting: renders the current focus (italic line)', () => {
    const el = render(<FocusAffordance focus="reviewing the retry budget" />);
    expect(el.querySelector('[data-testid="focus-affordance"]')).not.toBeNull();
    const current = el.querySelector('[data-testid="focus-current"]');
    expect(current).not.toBeNull();
    expect(current?.textContent).toContain('reviewing the retry budget');
    // No placeholder when a focus is present.
    expect(el.querySelector('[data-testid="focus-placeholder"]')).toBeNull();
  });

  it('resting with NO focus: renders the calm `set your focus…` placeholder', () => {
    const el = render(<FocusAffordance focus={null} />);
    const placeholder = el.querySelector('[data-testid="focus-placeholder"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toContain('set your focus');
    expect(el.querySelector('[data-testid="focus-current"]')).toBeNull();
  });

  it('an empty-string focus is treated as the placeholder (no empty italic line)', () => {
    const el = render(<FocusAffordance focus="   " />);
    expect(
      el.querySelector('[data-testid="focus-placeholder"]'),
    ).not.toBeNull();
    expect(el.querySelector('[data-testid="focus-current"]')).toBeNull();
  });

  it('[ edit ] reveals the field pre-filled with the current focus', () => {
    const el = render(<FocusAffordance focus="wiring 9.13" />);
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="focus-edit"]',
      )?.click();
    });
    const field = el.querySelector<HTMLInputElement>(
      '[data-testid="focus-field"]',
    );
    expect(field).not.toBeNull();
    expect(field?.value).toBe('wiring 9.13');
  });

  it('submit fires onSubmit with the TRIMMED value', () => {
    let submitted: string | undefined;
    const el = render(
      <FocusAffordance focus={null} onSubmit={(f) => (submitted = f)} />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="focus-edit"]',
      )?.click();
    });
    const field = el.querySelector<HTMLInputElement>(
      '[data-testid="focus-field"]',
    )!;
    typeInto(field, '  drafting the spec  ');
    act(() => {
      el.querySelector<HTMLFormElement>(
        '[data-testid="focus-affordance"]',
      )?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    expect(submitted).toBe('drafting the spec');
  });

  it('empty/whitespace does NOT submit (no empty focus)', () => {
    let submits = 0;
    const el = render(
      <FocusAffordance focus={null} onSubmit={() => (submits += 1)} />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="focus-edit"]',
      )?.click();
    });
    const field = el.querySelector<HTMLInputElement>(
      '[data-testid="focus-field"]',
    )!;
    typeInto(field, '   ');
    // The submit button is disabled, and a form submit attempt does not call onSubmit.
    expect(
      el.querySelector<HTMLButtonElement>('[data-testid="focus-submit"]')
        ?.disabled,
    ).toBe(true);
    act(() => {
      el.querySelector<HTMLFormElement>(
        '[data-testid="focus-affordance"]',
      )?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    expect(submits).toBe(0);
  });

  it('the inline `error` slot renders the calm message (no modal)', () => {
    const el = render(
      <FocusAffordance focus={null} error="could not set your focus." />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="focus-edit"]',
      )?.click();
    });
    const errorEl = el.querySelector('[data-testid="focus-error"]');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('could not set your focus');
    expect(errorEl?.getAttribute('role')).toBe('status');
    // No modal dialog anywhere (calm chrome).
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(el.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('a live SET failure (error while RESTING, editor closed) still surfaces the calm inline error', () => {
    // The submit handler closes the editor synchronously; on a failed async write the parent passes
    // the `error` prop while the affordance is back in the resting view. The error must NOT be
    // swallowed (it previously only rendered inside the open editor) — a real POST failure would be
    // silent otherwise. Calm inline message, no modal.
    const el = render(
      <FocusAffordance focus="prior focus" error="could not set your focus." />,
    );
    // Resting view (no field open), but the error line is still shown.
    expect(el.querySelector('[data-testid="focus-field"]')).toBeNull();
    const errorEl = el.querySelector('[data-testid="focus-error"]');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('could not set your focus');
    expect(errorEl?.getAttribute('role')).toBe('status');
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('a DISABLED affordance does NOT show the error line (the terse reason owns that slot)', () => {
    const el = render(
      <FocusAffordance
        focus={null}
        disabled
        disabledReason="handle not registered"
        error="should be suppressed while disabled"
      />,
    );
    // While disabled, the calm reason owns the line; the error is not also rendered.
    expect(el.querySelector('[data-testid="focus-error"]')).toBeNull();
    expect(
      el.querySelector('[data-testid="focus-disabled-reason"]')?.textContent,
    ).toContain('handle not registered');
  });

  it('cancel fires onCancel (closes the editor)', () => {
    let cancelled = 0;
    const el = render(
      <FocusAffordance focus={null} onCancel={() => (cancelled += 1)} />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="focus-edit"]',
      )?.click();
    });
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="focus-cancel"]',
      )?.click();
    });
    expect(cancelled).toBe(1);
    // The editor closed — back to the resting view.
    expect(el.querySelector('[data-testid="focus-field"]')).toBeNull();
  });

  it('Esc in the field fires onEscape', () => {
    let escaped = 0;
    const el = render(
      <FocusAffordance focus={null} onEscape={() => (escaped += 1)} />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="focus-edit"]',
      )?.click();
    });
    act(() => {
      el.querySelector<HTMLInputElement>(
        '[data-testid="focus-field"]',
      )?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(escaped).toBe(1);
  });

  // --- DISABLED state (AC1 — watching-only / unregistered → inert, never a crash) ---

  it('disabled (watching-only): the [ edit ] control is GONE and the terse reason renders', () => {
    const el = render(
      <FocusAffordance
        focus={null}
        disabled
        disabledReason="watching-only — start `agentbbs ui --as <handle>`"
      />,
    );
    // No edit control + no field — the affordance is inert.
    expect(el.querySelector('[data-testid="focus-edit"]')).toBeNull();
    expect(el.querySelector('[data-testid="focus-field"]')).toBeNull();
    const reason = el.querySelector('[data-testid="focus-disabled-reason"]');
    expect(reason).not.toBeNull();
    expect(reason?.textContent).toContain('watching-only');
  });

  it('disabled (unregistered) STILL shows the current focus (if any) alongside the reason — no crash', () => {
    const el = render(
      <FocusAffordance
        focus="some earlier focus"
        disabled
        disabledReason="handle not registered"
      />,
    );
    // The current focus stays readable; the reason explains why it cannot be edited.
    expect(
      el.querySelector('[data-testid="focus-current"]')?.textContent,
    ).toContain('some earlier focus');
    expect(
      el.querySelector('[data-testid="focus-disabled-reason"]')?.textContent,
    ).toContain('handle not registered');
    expect(el.querySelector('[data-testid="focus-edit"]')).toBeNull();
  });

  it('a disabled (pending) edit button does NOT open the editor on click (no double-submit slips through)', () => {
    // pending disables the [ edit ] button; a real DOM click on a disabled button is suppressed,
    // so the editor never opens. Guards the no-interaction-while-writing invariant behaviorally.
    const el = render(<FocusAffordance focus="x" pending />);
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="focus-edit"]',
      )?.click();
    });
    expect(el.querySelector('[data-testid="focus-field"]')).toBeNull();
  });
});
