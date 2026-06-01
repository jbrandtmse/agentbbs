// DOM tests for the NavTree sidebar component (Story 9.4, Task 4 — Rule 3 real-runtime
// evidence for the UI surface: asserts observable rendered DOM, not internal state).
//
// Runs in the happy-dom project. NavTree is presentation-only (NFR2 — no core/data-access
// import); it takes a prop-driven tree model. These tests pin AC1 (tree structure + global
// read), AC2 (unread/read decorations + activity count), and AC3 (NEEDS YOU is flag-warm,
// never red — the EXACT token classes the rows carry, since the actual computed color
// depends on tokens.css which is not imported into this isolated component test).

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NavTree } from './NavTree.js';

import type { NavTreeModel } from './NavTree.js';
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

function render(model: NavTreeModel): void {
  act(() => {
    root = createRoot(container);
    root.render(<NavTree model={model} />);
  });
}

/** A representative model: two projects (global read), one escalated room, decorations. */
const model: NavTreeModel = {
  operatorHandle: 'ops',
  activeRoomId: 'design-sync',
  needsYou: [
    {
      roomId: 'need-a-decision',
      projectId: 'calling-interface',
      subject: 'Need a decision',
    },
  ],
  projects: [
    {
      projectId: 'calling-interface',
      title: 'Calling Interface',
      announcementCount: 2,
      rooms: [
        {
          roomId: 'need-a-decision',
          subject: 'Need a decision',
          unread: true,
          activityCount: 3,
          needsYou: true,
        },
        {
          roomId: 'design-sync',
          subject: 'Design sync',
          unread: false,
          activityCount: 0,
          needsYou: false,
        },
      ],
    },
    {
      projectId: 'payments',
      title: 'Payments',
      announcementCount: 0,
      rooms: [
        {
          roomId: 'ledger-rollover',
          subject: 'Ledger rollover',
          unread: true,
          activityCount: 1,
          needsYou: false,
        },
      ],
    },
  ],
};

describe('NavTree — structure + global read (AC1)', () => {
  it('renders the AgentBBS header, the operator (you) row, and a join action', () => {
    render(model);
    expect(
      container.querySelector('[data-testid="nav-header"]')?.textContent,
    ).toContain('AgentBBS');
    const me = container.querySelector('[data-testid="nav-operator"]');
    expect(me?.textContent).toContain('ops');
    expect(me?.textContent).toContain('(you)');
    expect(
      container.querySelector('[data-testid="nav-join-project"]'),
    ).not.toBeNull();
  });

  it('lists EVERY project and room (global read — FR28), regardless of membership', () => {
    render(model);
    expect(
      container.querySelector('[data-project-id="calling-interface"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-project-id="payments"]'),
    ).not.toBeNull();
    // Every room row is present across all projects.
    expect(
      container.querySelector('[data-room-id="need-a-decision"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-room-id="design-sync"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-room-id="ledger-rollover"]'),
    ).not.toBeNull();
  });

  it('shows an announcements bucket per project with a count', () => {
    render(model);
    const bucket = container.querySelector(
      '[data-project-id="calling-interface"] [data-testid="announcements-bucket"]',
    );
    expect(bucket).not.toBeNull();
    expect(bucket?.textContent).toContain('announcements');
  });

  it('omits the NEEDS YOU section entirely when n=0', () => {
    render({ ...model, needsYou: [] });
    expect(
      container.querySelector('[data-testid="needs-you-section"]'),
    ).toBeNull();
  });

  it('renders the NEEDS YOU section with the count when n>0', () => {
    render(model);
    const section = container.querySelector(
      '[data-testid="needs-you-section"]',
    );
    expect(section).not.toBeNull();
    expect(
      section?.querySelector('[data-testid="needs-you-label"]')?.textContent,
    ).toContain('(1)');
  });

  it('shows a watching-only posture (no (you) personalization) when operatorHandle is null', () => {
    render({ ...model, operatorHandle: null, needsYou: [] });
    // No operator row when there is no handle.
    expect(container.querySelector('[data-testid="nav-operator"]')).toBeNull();
    // Global read still works.
    expect(
      container.querySelector('[data-project-id="payments"]'),
    ).not.toBeNull();
  });
});

/** The room ROW (not the NEEDS YOU section item) for a room id, scoped to its project. */
function roomRow(roomId: string): Element {
  const el = container.querySelector(
    `[data-project-id] [data-room-id="${roomId}"]`,
  );
  if (el === null) throw new Error(`room row ${roomId} not found`);
  return el;
}

describe('NavTree — decorations (AC2)', () => {
  it('marks an unread room with the • accent glyph + activity count badge', () => {
    render(model);
    const row = roomRow('need-a-decision');
    const glyph = row.querySelector('[data-testid="unread-glyph"]');
    expect(glyph?.textContent).toBe('•');
    expect(glyph?.className).toContain('nav-glyph-unread');
    const badge = row.querySelector('[data-testid="unread-badge"]');
    expect(badge?.textContent).toBe('3');
  });

  it('marks a read room with the ° faint glyph and no badge', () => {
    render(model);
    const row = roomRow('design-sync');
    const glyph = row.querySelector('[data-testid="unread-glyph"]');
    expect(glyph?.textContent).toBe('°');
    expect(glyph?.className).toContain('nav-glyph-read');
    expect(row.querySelector('[data-testid="unread-badge"]')).toBeNull();
  });

  it('marks the active room with the selected rail class', () => {
    render(model);
    const active = roomRow('design-sync');
    expect(active.className).toContain('nav-row-selected');
    const inactive = roomRow('need-a-decision');
    expect(inactive.className).not.toContain('nav-row-selected');
  });
});

describe('NavTree — NEEDS YOU is flag-warm, NEVER red (AC3)', () => {
  it('renders the ! glyph with the flag-warm class on a needs-you room row', () => {
    render(model);
    const row = roomRow('need-a-decision');
    const needsGlyph = row.querySelector('[data-testid="needs-you-glyph"]');
    expect(needsGlyph?.textContent).toBe('!');
    expect(needsGlyph?.className).toContain('nav-glyph-needs');
  });

  it('styles the NEEDS YOU section item with flag-warm tokens and NOT red', () => {
    render(model);
    const item = container.querySelector(
      '[data-testid="needs-you-section"] [data-testid="needs-you-item"]',
    ) as HTMLElement | null;
    expect(item).not.toBeNull();
    // The icon reads --flag-warm; the text reads --flag-warm-text (DESIGN.md). The inline
    // styles reference the warm tokens by NAME — never a red color literal.
    const icon = item!.querySelector(
      '[data-testid="needs-you-icon"]',
    ) as HTMLElement;
    expect(icon.style.color).toBe('var(--flag-warm)');
    expect(item!.style.color).toBe('var(--flag-warm-text)');
    // Assert NOT red: no part of the needs-you item carries a red color.
    const html = item!.outerHTML.toLowerCase();
    expect(html).not.toContain('red');
    expect(html).not.toMatch(/#(f00|ff0000|e0|d0)0000/);
  });
});
