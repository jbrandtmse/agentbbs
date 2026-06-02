// Voice / microcopy content-guard (Story 9.10, Task 3 + Task 5).
//
// Rule 10 — an agent/operator-consumed asset (the UI voice) ships WITH a content-guard pinning
// its load-bearing strings to the code's SOURCE OF TRUTH (the rendered components), so a future
// LOUD rewrite (`⚠ 1 ROOM NEEDS ATTENTION!`, `Welcome back, Operator! 👋`, `You're all set! 🎉`)
// is caught. The terse vs loud table is EXPERIENCE.md §Microcopy. This guard renders each
// component that carries load-bearing copy and asserts (a) the terse string is PRESENT and
// (b) NO loud/celebratory marker (`!`, emoji, Title-Cased nag) leaks in.
//
// MUTATION-TEST (Rule 7): swapping any pinned terse string to its loud variant in the component
// turns the matching assertion RED; restoring it byte-identically returns green. Proven once in
// the Dev Agent Record. Runs in the happy-dom project.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConnectionFooter } from './ConnectionFooter.js';
import { Composer } from '../room/Composer.js';
import { MessagePost } from '../room/MessagePost.js';
import { NavTree } from '../tree/NavTree.js';

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
});

function render(node: ReactNode): string {
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return container.textContent ?? '';
}

/** The LOUD markers that must NEVER appear in load-bearing chrome copy (EXPERIENCE.md). */
const LOUD_MARKERS = [
  '!', // no exclamation marks (pull-only informs, never nags)
  '🎉',
  '👋',
  '😢',
  '⚠',
  'ATTENTION',
  'Welcome back',
  'all set',
  'unlock',
  'securely connected',
];

function assertNoLoudCopy(text: string): void {
  for (const marker of LOUD_MARKERS) {
    expect(text).not.toContain(marker);
  }
}

describe('voice content-guard — connection footer (AC2)', () => {
  it('reads terse lowercase `connected` / `reconnecting…`, never loud', () => {
    const connectedText = render(<ConnectionFooter status="connected" />);
    expect(connectedText).toContain('connected');
    assertNoLoudCopy(connectedText);
    act(() => root.unmount());

    const reconnectingText = render(<ConnectionFooter status="reconnecting" />);
    expect(reconnectingText).toContain('reconnecting…');
    assertNoLoudCopy(reconnectingText);
  });
});

describe('voice content-guard — composer (AC2)', () => {
  it('not-joined reads terse `join room to post`, never `Join now to unlock posting!`', () => {
    const text = render(<Composer joined={false} />);
    expect(text).toContain('join room to post');
    assertNoLoudCopy(text);
  });

  it('joined reads terse `✓ you joined` + `type to post…` + `send`, never loud', () => {
    const text = render(<Composer joined={true} />);
    expect(text).toContain('you joined');
    expect(text).toContain('send');
    // The field placeholder carries `type to post…`.
    expect(
      container
        .querySelector('[data-testid="composer-field"]')
        ?.getAttribute('placeholder'),
    ).toBe('type to post…');
    assertNoLoudCopy(text);
  });
});

describe('voice content-guard — failed post (AC2)', () => {
  it('reads terse `post failed — retry`, never a loud error/alarm', () => {
    const failed: MessagePostModel = {
      seq: 5,
      actor: 'ops',
      body: 'hi',
      kind: 'reply',
      reactions: [],
      failed: true,
      clientToken: 't1',
    };
    const text = render(<MessagePost post={failed} />);
    expect(text).toContain('post failed');
    expect(text).toContain('retry');
    assertNoLoudCopy(text);
  });
});

describe('voice content-guard — nav tree (AC2)', () => {
  const baseModel: NavTreeModel = {
    operatorHandle: 'operator',
    activeRoomId: null,
    needsYou: [],
    projects: [],
  };

  it('empty board reads terse `no projects yet` + `＋ join a project…`, never `Looks empty in here 😢`', () => {
    const text = render(<NavTree model={baseModel} />);
    expect(text).toContain('no projects yet');
    expect(text).toContain('join a project');
    assertNoLoudCopy(text);
  });

  it('operator identity reads lowercase `@operator (you)`, never `Welcome back, Operator! 👋`', () => {
    const text = render(<NavTree model={baseModel} />);
    expect(text).toContain('@operator');
    expect(text).toContain('(you)');
    assertNoLoudCopy(text);
  });

  it('needs-you section reads terse lowercase `needs you (n)`, never `⚠ 1 ROOM NEEDS ATTENTION!`', () => {
    // Scope the loud-copy scan to the LABEL (the `!` flag glyph is decorative, aria-hidden —
    // Rule 10's corollary: a guard must not false-positive on the author's legit non-copy).
    render(
      <NavTree
        model={{
          ...baseModel,
          needsYou: [
            { roomId: 'r1', projectId: 'p1', subject: 'Need a decision' },
          ],
        }}
      />,
    );
    expect(
      container.querySelector('[data-testid="needs-you-label"]')?.textContent,
    ).toBe('needs you (1)');
    assertNoLoudCopy(
      container.querySelector('[data-testid="needs-you-label"]')?.textContent ??
        '',
    );
  });
});
