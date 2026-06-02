// DOM tests for the join-gate Composer (Story 9.7 Task 4, AC #1).
//
// Runs under the 'ui-shared-dom' Vitest project (happy-dom; IS_REACT_ACT_ENVIRONMENT set by
// test-setup-dom.ts). Renders into a real DOM and asserts the two-state join-gate behavior
// (DESIGN components.join-gate-composer / EXPERIENCE — "the one gate between reading and
// posting"):
//   - NOT JOINED: shows ONLY `[ join room to post ]`; clicking it fires onJoin; no text field.
//   - JOINED: shows `✓ you joined` + a text field + send; typing + send fires onSend(trimmed);
//     an empty / whitespace-only body does NOT send; send clears the field.
//   - pending disables the controls (basic disabled state — optimistic/retry is 9.9).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Composer } from './Composer.js';

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

describe('Composer — not-joined state (AC #1)', () => {
  it('shows ONLY the `[ join room to post ]` button (no text field, no send)', () => {
    const el = render(<Composer joined={false} />);
    const composer = el.querySelector('[data-testid="composer"]');
    expect(composer?.getAttribute('data-joined')).toBe('false');
    const joinBtn = el.querySelector('[data-testid="composer-join"]');
    expect(joinBtn?.textContent).toBe('[ join room to post ]');
    // No posting affordances until joined.
    expect(el.querySelector('[data-testid="composer-field"]')).toBeNull();
    expect(el.querySelector('[data-testid="composer-send"]')).toBeNull();
    expect(el.querySelector('[data-testid="composer-joined-ok"]')).toBeNull();
  });

  it('clicking `[ join room to post ]` fires onJoin', () => {
    let joined = 0;
    const el = render(<Composer joined={false} onJoin={() => (joined += 1)} />);
    const joinBtn = el.querySelector<HTMLButtonElement>(
      '[data-testid="composer-join"]',
    );
    act(() => {
      joinBtn?.click();
    });
    expect(joined).toBe(1);
  });

  it('pending disables the join button (no double-submit)', () => {
    let joined = 0;
    const el = render(
      <Composer joined={false} pending onJoin={() => (joined += 1)} />,
    );
    const joinBtn = el.querySelector<HTMLButtonElement>(
      '[data-testid="composer-join"]',
    );
    expect(joinBtn?.disabled).toBe(true);
    act(() => {
      joinBtn?.click();
    });
    expect(joined).toBe(0);
  });
});

describe('Composer — joined state (AC #1)', () => {
  it('shows `✓ you joined` + a text field + a send button', () => {
    const el = render(<Composer joined={true} />);
    const composer = el.querySelector('[data-testid="composer"]');
    expect(composer?.getAttribute('data-joined')).toBe('true');
    expect(
      el.querySelector('[data-testid="composer-joined-ok"]')?.textContent,
    ).toBe('✓ you joined');
    expect(el.querySelector('[data-testid="composer-field"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="composer-send"]')).not.toBeNull();
    // The not-joined gate is gone.
    expect(el.querySelector('[data-testid="composer-join"]')).toBeNull();
  });

  it('typing + send fires onSend with the body and clears the field', () => {
    let sent: string | undefined;
    const el = render(<Composer joined={true} onSend={(b) => (sent = b)} />);
    const field = el.querySelector<HTMLInputElement>(
      '[data-testid="composer-field"]',
    );
    const send = el.querySelector<HTMLButtonElement>(
      '[data-testid="composer-send"]',
    );
    // Type a body (set value + dispatch input so React's onChange fires).
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'I think we should ship.');
      field?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      send?.click();
    });
    expect(sent).toBe('I think we should ship.');
    // The field is cleared after a successful send.
    expect(
      el.querySelector<HTMLInputElement>('[data-testid="composer-field"]')
        ?.value,
    ).toBe('');
  });

  it('an EMPTY body does NOT send (send disabled, onSend never fires)', () => {
    let fired = 0;
    const el = render(<Composer joined={true} onSend={() => (fired += 1)} />);
    const send = el.querySelector<HTMLButtonElement>(
      '[data-testid="composer-send"]',
    );
    // No text typed → send is disabled.
    expect(send?.disabled).toBe(true);
    act(() => {
      send?.click();
    });
    expect(fired).toBe(0);
  });

  it('a WHITESPACE-only body does NOT send (trimmed to empty)', () => {
    let fired = 0;
    const el = render(<Composer joined={true} onSend={() => (fired += 1)} />);
    const field = el.querySelector<HTMLInputElement>(
      '[data-testid="composer-field"]',
    );
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field, '    ');
      field?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const send = el.querySelector<HTMLButtonElement>(
      '[data-testid="composer-send"]',
    );
    expect(send?.disabled).toBe(true);
    act(() => {
      send?.click();
    });
    expect(fired).toBe(0);
  });

  it('pending disables the field + send (no double-submit during an in-flight write)', () => {
    const el = render(<Composer joined={true} pending />);
    expect(
      el.querySelector<HTMLInputElement>('[data-testid="composer-field"]')
        ?.disabled,
    ).toBe(true);
    expect(
      el.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')
        ?.disabled,
    ).toBe(true);
  });
});
