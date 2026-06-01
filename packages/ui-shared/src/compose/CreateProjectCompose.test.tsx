// DOM tests for the CreateProjectCompose affordance (Story 9.11 Task 4, AC #1).
//
// Runs under the 'ui-shared-dom' Vitest project (happy-dom; IS_REACT_ACT_ENVIRONMENT set by
// test-setup-dom.ts). Renders into a real DOM and asserts the prop-driven create-project compose:
//   - renders the title + description fields + submit + cancel;
//   - typing both + submit fires onSubmit({ title, description }) with TRIMMED values;
//   - an empty / whitespace-only title OR description does NOT submit (no empty projects);
//   - the inline `error` slot renders the calm message (the PROJECT_EXISTS surface) — no modal;
//   - cancel fires onCancel;
//   - pending disables the controls (basic disabled state).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CreateProjectCompose } from './CreateProjectCompose.js';

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

/** Set a field's value + dispatch input so React's onChange fires (happy-dom controlled input). */
function typeInto(field: HTMLInputElement | null, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(field, value);
    field?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CreateProjectCompose (AC #1)', () => {
  it('renders the title + description fields + submit + cancel', () => {
    const el = render(<CreateProjectCompose />);
    expect(
      el.querySelector('[data-testid="create-project-compose"]'),
    ).not.toBeNull();
    expect(
      el.querySelector('[data-testid="create-project-title"]'),
    ).not.toBeNull();
    expect(
      el.querySelector('[data-testid="create-project-description"]'),
    ).not.toBeNull();
    expect(
      el.querySelector('[data-testid="create-project-submit"]')?.textContent,
    ).toBe('[ create project ]');
    expect(
      el.querySelector('[data-testid="create-project-cancel"]'),
    ).not.toBeNull();
  });

  it('typing title + description + submit fires onSubmit with TRIMMED values', () => {
    let submitted: { title: string; description: string } | undefined;
    const el = render(
      <CreateProjectCompose onSubmit={(input) => (submitted = input)} />,
    );
    typeInto(
      el.querySelector('[data-testid="create-project-title"]'),
      '  Calling Interface  ',
    );
    typeInto(
      el.querySelector('[data-testid="create-project-description"]'),
      '  How agents dial in.  ',
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="create-project-submit"]',
      )?.click();
    });
    expect(submitted).toEqual({
      title: 'Calling Interface',
      description: 'How agents dial in.',
    });
  });

  it('an EMPTY title does NOT submit (submit disabled, onSubmit never fires)', () => {
    let fired = 0;
    const el = render(<CreateProjectCompose onSubmit={() => (fired += 1)} />);
    // Only the description is filled.
    typeInto(
      el.querySelector('[data-testid="create-project-description"]'),
      'a description',
    );
    const submit = el.querySelector<HTMLButtonElement>(
      '[data-testid="create-project-submit"]',
    );
    expect(submit?.disabled).toBe(true);
    act(() => submit?.click());
    expect(fired).toBe(0);
  });

  it('a WHITESPACE-only description does NOT submit (trimmed to empty)', () => {
    let fired = 0;
    const el = render(<CreateProjectCompose onSubmit={() => (fired += 1)} />);
    typeInto(el.querySelector('[data-testid="create-project-title"]'), 'Title');
    typeInto(
      el.querySelector('[data-testid="create-project-description"]'),
      '    ',
    );
    const submit = el.querySelector<HTMLButtonElement>(
      '[data-testid="create-project-submit"]',
    );
    expect(submit?.disabled).toBe(true);
    act(() => submit?.click());
    expect(fired).toBe(0);
  });

  it('the inline `error` slot renders the calm message (PROJECT_EXISTS surface), no modal', () => {
    const el = render(
      <CreateProjectCompose error='a project with title "Calling Interface" (id "calling-interface") already exists.' />,
    );
    const errorEl = el.querySelector('[data-testid="create-project-error"]');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('already exists');
    // The form is STILL rendered (no modal; the draft stays).
    expect(
      el.querySelector('[data-testid="create-project-title"]'),
    ).not.toBeNull();
  });

  it('cancel fires onCancel', () => {
    let cancelled = 0;
    const el = render(
      <CreateProjectCompose onCancel={() => (cancelled += 1)} />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="create-project-cancel"]',
      )?.click();
    });
    expect(cancelled).toBe(1);
  });

  it('pending disables the fields + submit + cancel (no double-submit)', () => {
    const el = render(<CreateProjectCompose pending />);
    expect(
      el.querySelector<HTMLInputElement>('[data-testid="create-project-title"]')
        ?.disabled,
    ).toBe(true);
    expect(
      el.querySelector<HTMLInputElement>(
        '[data-testid="create-project-description"]',
      )?.disabled,
    ).toBe(true);
    expect(
      el.querySelector<HTMLButtonElement>(
        '[data-testid="create-project-submit"]',
      )?.disabled,
    ).toBe(true);
    expect(
      el.querySelector<HTMLButtonElement>(
        '[data-testid="create-project-cancel"]',
      )?.disabled,
    ).toBe(true);
  });
});
