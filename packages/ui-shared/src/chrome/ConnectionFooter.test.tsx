// DOM tests for the ConnectionFooter (Story 9.10, Task 5 — Rule 3 real-runtime evidence:
// asserts observable rendered DOM). Runs in the happy-dom project.
//
// Pins AC1/AC2: `● connected` (agreed-green LED) vs `○ reconnecting…` (inline, dim), the calm
// lowercase voice, and the LOAD-BEARING calm-posture invariant — the footer NEVER renders a
// modal/dialog role (disconnection is an inline state change, never a blocking alert).

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConnectionFooter } from './ConnectionFooter.js';

import type { ConnectionStatus } from './ConnectionFooter.js';
import type { Root } from 'react-dom/client';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(status: ConnectionStatus): void {
  act(() => {
    root = createRoot(container);
    root.render(<ConnectionFooter status={status} />);
  });
}

describe('ConnectionFooter — connected vs reconnecting (AC1)', () => {
  it('shows `● connected` with the agreed-green LED when connected', () => {
    render('connected');
    const footer = container.querySelector('[data-testid="connection-footer"]');
    expect(footer?.getAttribute('data-status')).toBe('connected');
    expect(
      footer?.querySelector('[data-testid="connection-footer-label"]')
        ?.textContent,
    ).toBe('connected');
    const led = footer?.querySelector('.connection-footer-led') as HTMLElement;
    expect(led.textContent).toBe('●');
    // The LED reads the agreed-green token (the "connected LED" — DESIGN), never red.
    expect(led.style.color).toBe('var(--agreed-green)');
  });

  it('shows `○ reconnecting…` inline (dim) when reconnecting', () => {
    render('reconnecting');
    const footer = container.querySelector('[data-testid="connection-footer"]');
    expect(footer?.getAttribute('data-status')).toBe('reconnecting');
    expect(
      footer?.querySelector('[data-testid="connection-footer-label"]')
        ?.textContent,
    ).toBe('reconnecting…');
    const led = footer?.querySelector('.connection-footer-led') as HTMLElement;
    expect(led.textContent).toBe('○');
    // Reconnecting is dim/calm — NOT red, NOT the agreed-green LED.
    expect(led.style.color).toBe('var(--text-dim)');
  });
});

describe('ConnectionFooter — calm posture: never a modal, never an alarm (AC1)', () => {
  function assertNoModal(): void {
    const footer = container.querySelector(
      '[data-testid="connection-footer"]',
    ) as HTMLElement;
    // No blocking dialog/alertdialog/alert anywhere — disconnection is an inline state change.
    expect(footer.querySelector('[role="dialog"]')).toBeNull();
    expect(footer.querySelector('[role="alertdialog"]')).toBeNull();
    expect(footer.querySelector('[role="alert"]')).toBeNull();
    expect(footer.getAttribute('role')).not.toBe('dialog');
    // No red color literal anywhere (calm, never an alarm).
    expect(footer.outerHTML.toLowerCase()).not.toContain('red');
  }

  it('renders NO modal/dialog/alert role when reconnecting (inline only)', () => {
    render('reconnecting');
    assertNoModal();
  });

  it('renders NO modal/dialog/alert role when connected (inline only)', () => {
    render('connected');
    assertNoModal();
  });
});
