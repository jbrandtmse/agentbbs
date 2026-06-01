// DOM tests for the PostAnnouncementCompose affordance (Story 9.11 Task 4, AC #2).
//
// Runs under the 'ui-shared-dom' Vitest project (happy-dom; IS_REACT_ACT_ENVIRONMENT set by
// test-setup-dom.ts). Renders into a real DOM and asserts the prop-driven announcement compose:
//   - renders the subject + body fields + submit + cancel;
//   - typing both + submit fires onSubmit({ subject, body }) with TRIMMED values;
//   - an empty / whitespace-only subject OR body does NOT submit;
//   - the inline `error` slot renders the calm message (the BODY_TOO_LARGE surface) — no modal;
//   - joinFirst swaps the form for the `[ join this project first ]` CTA (AC2 handoff), firing
//     onJoinFirst (never a silent failure);
//   - pending disables the controls.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PostAnnouncementCompose } from './PostAnnouncementCompose.js';

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

/** Set a control's value + dispatch input so React's onChange fires (input OR textarea). */
function typeInto(
  field: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
): void {
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(field, value);
    field?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('PostAnnouncementCompose — compose form (AC #2)', () => {
  it('renders the subject + body fields + submit + cancel', () => {
    const el = render(<PostAnnouncementCompose />);
    const composer = el.querySelector(
      '[data-testid="post-announcement-compose"]',
    );
    expect(composer?.getAttribute('data-join-first')).toBe('false');
    expect(
      el.querySelector('[data-testid="post-announcement-subject"]'),
    ).not.toBeNull();
    expect(
      el.querySelector('[data-testid="post-announcement-body"]'),
    ).not.toBeNull();
    expect(
      el.querySelector('[data-testid="post-announcement-submit"]')?.textContent,
    ).toBe('[ post announcement ]');
  });

  it('typing subject + body + submit fires onSubmit with TRIMMED values', () => {
    let submitted: { subject: string; body: string } | undefined;
    const el = render(
      <PostAnnouncementCompose onSubmit={(input) => (submitted = input)} />,
    );
    typeInto(
      el.querySelector('[data-testid="post-announcement-subject"]'),
      '  Need a decision  ',
    );
    typeInto(
      el.querySelector('[data-testid="post-announcement-body"]'),
      '  who owns the retry budget?  ',
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="post-announcement-submit"]',
      )?.click();
    });
    expect(submitted).toEqual({
      subject: 'Need a decision',
      body: 'who owns the retry budget?',
    });
  });

  it('an EMPTY subject does NOT submit (submit disabled, onSubmit never fires)', () => {
    let fired = 0;
    const el = render(
      <PostAnnouncementCompose onSubmit={() => (fired += 1)} />,
    );
    typeInto(
      el.querySelector('[data-testid="post-announcement-body"]'),
      'a body',
    );
    const submit = el.querySelector<HTMLButtonElement>(
      '[data-testid="post-announcement-submit"]',
    );
    expect(submit?.disabled).toBe(true);
    act(() => submit?.click());
    expect(fired).toBe(0);
  });

  it('a WHITESPACE-only body does NOT submit (trimmed to empty)', () => {
    let fired = 0;
    const el = render(
      <PostAnnouncementCompose onSubmit={() => (fired += 1)} />,
    );
    typeInto(
      el.querySelector('[data-testid="post-announcement-subject"]'),
      'subject',
    );
    typeInto(el.querySelector('[data-testid="post-announcement-body"]'), '   ');
    const submit = el.querySelector<HTMLButtonElement>(
      '[data-testid="post-announcement-submit"]',
    );
    expect(submit?.disabled).toBe(true);
    act(() => submit?.click());
    expect(fired).toBe(0);
  });

  it('the inline `error` slot renders the calm message (BODY_TOO_LARGE surface), no modal', () => {
    const el = render(
      <PostAnnouncementCompose error="message body exceeds the size cap." />,
    );
    const errorEl = el.querySelector('[data-testid="post-announcement-error"]');
    expect(errorEl?.textContent).toContain('exceeds the size cap');
    // The form is STILL rendered (no modal; the draft stays).
    expect(
      el.querySelector('[data-testid="post-announcement-subject"]'),
    ).not.toBeNull();
  });

  it('cancel fires onCancel', () => {
    let cancelled = 0;
    const el = render(
      <PostAnnouncementCompose onCancel={() => (cancelled += 1)} />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="post-announcement-cancel"]',
      )?.click();
    });
    expect(cancelled).toBe(1);
  });

  it('pending disables the fields + submit (no double-submit)', () => {
    const el = render(<PostAnnouncementCompose pending />);
    expect(
      el.querySelector<HTMLInputElement>(
        '[data-testid="post-announcement-subject"]',
      )?.disabled,
    ).toBe(true);
    expect(
      el.querySelector<HTMLTextAreaElement>(
        '[data-testid="post-announcement-body"]',
      )?.disabled,
    ).toBe(true);
    expect(
      el.querySelector<HTMLButtonElement>(
        '[data-testid="post-announcement-submit"]',
      )?.disabled,
    ).toBe(true);
  });
});

describe('PostAnnouncementCompose — join-first handoff (AC #2, NOT_A_MEMBER, never silent)', () => {
  it('joinFirst swaps the form for the `[ join this project first ]` CTA (no compose fields)', () => {
    const el = render(<PostAnnouncementCompose joinFirst />);
    const composer = el.querySelector(
      '[data-testid="post-announcement-compose"]',
    );
    expect(composer?.getAttribute('data-join-first')).toBe('true');
    const cta = el.querySelector(
      '[data-testid="post-announcement-join-first"]',
    );
    expect(cta?.textContent).toBe('[ join this project first ]');
    // The compose fields are GONE — the operator must join before posting (never a silent fail).
    expect(
      el.querySelector('[data-testid="post-announcement-subject"]'),
    ).toBeNull();
    expect(
      el.querySelector('[data-testid="post-announcement-submit"]'),
    ).toBeNull();
  });

  it('clicking the join-first CTA fires onJoinFirst', () => {
    let joined = 0;
    const el = render(
      <PostAnnouncementCompose joinFirst onJoinFirst={() => (joined += 1)} />,
    );
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="post-announcement-join-first"]',
      )?.click();
    });
    expect(joined).toBe(1);
  });
});
