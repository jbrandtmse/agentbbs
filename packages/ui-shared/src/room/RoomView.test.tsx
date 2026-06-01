// DOM tests for the room thread surface — MessagePost / MessageThread / RoomView
// (Story 9.5 Task 4, AC #1 + #2).
//
// Runs under the 'ui-shared-dom' Vitest project (happy-dom; IS_REACT_ACT_ENVIRONMENT set
// by test-setup-dom.ts). Renders into a real DOM and asserts the STRUCTURAL outcome:
//   - the breadcrumb renders `sub-board › #room`;
//   - a post shows `@handle` + a formatted timestamp + a rendered-markdown body that is the
//     Story 9.2 INERT MarkdownView output (a code block / link renders as inert HTML, NOT
//     raw text, and NEVER a live <script>);
//   - posts are separated by a hairline divider (border-bottom on each .message-post);
//   - the thread is ordered by `seq` even on an unsorted input (a later-seq EARLIER-
//     createdAt message still sorts after — order key is seq, not createdAt);
//   - a > ~30-line post collapses to "show more" and expands in place;
//   - the operator posture renders `you: watching` vs `you: @operator (peer)` from data.
//
// The render is async (Shiki highlighter loads once), so we prewarm it and flush
// microtasks before asserting (mirrors MarkdownView.test.tsx).
//
// INERT-IN-THREAD PROOF: a dedicated test renders a body carrying a markdown XSS vector
// inside the thread and asserts it is inert (no <script>, no live handler) — proving the
// thread pipes bodies through MarkdownView and does NOT string-interpolate them. Guards a
// future regression that bypasses the inert renderer.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  MessagePost,
  POST_COLLAPSE_LINE_THRESHOLD,
  type MessagePostModel,
} from './MessagePost.js';
import { MessageThread } from './MessageThread.js';
import { RoomView, type RoomViewModel } from './RoomView.js';
import { prewarmHighlighter } from '../markdown/highlight.js';

import type { ReactNode } from 'react';

let mountEl: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await prewarmHighlighter();
});

beforeEach(() => {
  mountEl = document.createElement('div');
  document.body.append(mountEl);
  root = createRoot(mountEl);
});

afterEach(() => {
  act(() => root.unmount());
  mountEl.remove();
});

/** Render `node` and flush the async MarkdownView render effect. */
async function render(node: ReactNode): Promise<HTMLElement> {
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return mountEl;
}

function post(over: Partial<MessagePostModel> = {}): MessagePostModel {
  return {
    seq: 1,
    actor: 'ada',
    body: 'a body',
    kind: 'reply',
    createdAt: '2026-06-01T12:04:51.000Z',
    reactions: [],
    ...over,
  };
}

function roomModel(over: Partial<RoomViewModel> = {}): RoomViewModel {
  return {
    roomId: 'need-a-reviewer',
    projectId: 'calling-interface',
    subject: 'Need a reviewer',
    participants: ['ada', 'bob'],
    messages: [
      post({
        seq: 1,
        actor: 'ada',
        body: 'announcement',
        kind: 'announcement',
      }),
      post({ seq: 2, actor: 'bob', body: 'a reply' }),
    ],
    operatorPosture: { kind: 'watching' },
    ...over,
  };
}

describe('MessagePost (AC #1)', () => {
  it('renders @handle + a formatted UTC timestamp + the inert markdown body', async () => {
    const el = await render(
      <MessagePost post={post({ actor: 'ada', body: '**bold** text' })} />,
    );
    expect(
      el.querySelector('[data-testid="message-post-handle"]')?.textContent,
    ).toBe('@ada');
    // Timestamp formatted deterministically from createdAt (UTC HH:MM:SS).
    expect(
      el.querySelector('[data-testid="message-post-timestamp"]')?.textContent,
    ).toBe('12:04:51');
    // Body rendered via MarkdownView → a real <strong> element (NOT the raw `**bold**`).
    const body = el.querySelector('[data-testid="message-post-body"]');
    expect(body?.querySelector('.markdown-view strong')?.textContent).toBe(
      'bold',
    );
  });

  it('omits the timestamp when the post has no createdAt', async () => {
    const el = await render(
      <MessagePost post={post({ createdAt: undefined })} />,
    );
    expect(
      el.querySelector('[data-testid="message-post-timestamp"]'),
    ).toBeNull();
  });

  it('renders FULL-HEIGHT (no collapse, no toggle) for a short post', async () => {
    const el = await render(<MessagePost post={post({ body: 'short' })} />);
    expect(el.querySelector('[data-testid="message-post-toggle"]')).toBeNull();
    expect(
      el
        .querySelector('[data-testid="message-post-body"]')
        ?.getAttribute('data-collapsed'),
    ).toBe('false');
  });

  it('does NOT collapse a post at EXACTLY the threshold (boundary: 30 lines is NOT > 30)', async () => {
    // The collapse predicate is `sourceLineCount > threshold` (strictly greater). A post of
    // exactly POST_COLLAPSE_LINE_THRESHOLD source lines must render FULL-HEIGHT (no toggle).
    // Pins the `>` boundary — an off-by-one to `>=` would wrongly collapse a 30-line post.
    const exactlyThreshold = Array.from(
      { length: POST_COLLAPSE_LINE_THRESHOLD },
      (_, i) => `line ${i}`,
    ).join('\n');
    const el = await render(
      <MessagePost post={post({ body: exactlyThreshold })} />,
    );
    expect(el.querySelector('[data-testid="message-post-toggle"]')).toBeNull();
    expect(
      el
        .querySelector('[data-testid="message-post-body"]')
        ?.getAttribute('data-collapsed'),
    ).toBe('false');
  });

  it('DOES collapse a post one line OVER the threshold (boundary: 31 lines IS > 30)', async () => {
    // One source line past the threshold flips collapse on — the other side of the `>`
    // boundary, so the pair brackets the exact line the predicate fires at.
    const overThreshold = Array.from(
      { length: POST_COLLAPSE_LINE_THRESHOLD + 1 },
      (_, i) => `line ${i}`,
    ).join('\n');
    const el = await render(
      <MessagePost post={post({ body: overThreshold })} />,
    );
    expect(
      el.querySelector('[data-testid="message-post-toggle"]')?.textContent,
    ).toBe('show more');
    expect(
      el
        .querySelector('[data-testid="message-post-body"]')
        ?.getAttribute('data-collapsed'),
    ).toBe('true');
  });

  it('collapses a > ~30-line post to "show more" and expands it in place', async () => {
    const longBody = Array.from({ length: 40 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    const el = await render(<MessagePost post={post({ body: longBody })} />);
    const toggle = el.querySelector<HTMLButtonElement>(
      '[data-testid="message-post-toggle"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toBe('show more');
    expect(
      el
        .querySelector('[data-testid="message-post-body"]')
        ?.getAttribute('data-collapsed'),
    ).toBe('true');

    // Expand in place.
    await act(async () => {
      toggle?.click();
    });
    expect(
      el.querySelector('[data-testid="message-post-toggle"]')?.textContent,
    ).toBe('show less');
    expect(
      el
        .querySelector('[data-testid="message-post-body"]')
        ?.getAttribute('data-collapsed'),
    ).toBe('false');
  });
});

describe('MessageThread (AC #1)', () => {
  it('orders posts strictly by seq even on an UNSORTED input (order key is seq, not createdAt)', async () => {
    // A later-seq message with an EARLIER createdAt must STILL sort after the earlier-seq
    // one — pins "order by seq, never createdAt".
    const messages = [
      post({
        seq: 3,
        actor: 'cleo',
        body: 'c',
        createdAt: '2026-06-01T08:00:00.000Z',
      }),
      post({
        seq: 1,
        actor: 'ada',
        body: 'a',
        kind: 'announcement',
        createdAt: '2026-06-01T09:00:00.000Z',
      }),
      post({
        seq: 2,
        actor: 'bob',
        body: 'b',
        createdAt: '2026-06-01T10:00:00.000Z',
      }),
    ];
    const el = await render(<MessageThread messages={messages} />);
    const seqs = [...el.querySelectorAll('[data-testid="message-post"]')].map(
      (n) => Number(n.getAttribute('data-message-seq')),
    );
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('separates posts with a hairline divider (each post carries a bottom border)', async () => {
    const el = await render(
      <MessageThread
        messages={[post({ seq: 1 }), post({ seq: 2 }), post({ seq: 3 })]}
      />,
    );
    const posts = el.querySelectorAll<HTMLElement>(
      '[data-testid="message-post"]',
    );
    expect(posts).toHaveLength(3);
    for (const p of posts) {
      // The divider is the post's bottom border (the inline style references --border-soft).
      expect(p.style.borderBottom).toContain('var(--border-soft)');
    }
  });

  it('renders the announcement (#1) and replies both as posts, kind-discriminated', async () => {
    const el = await render(
      <MessageThread
        messages={[
          post({ seq: 1, kind: 'announcement' }),
          post({ seq: 2, kind: 'reply' }),
        ]}
      />,
    );
    const kinds = [...el.querySelectorAll('[data-testid="message-post"]')].map(
      (n) => n.getAttribute('data-kind'),
    );
    expect(kinds).toEqual(['announcement', 'reply']);
  });
});

describe('RoomView layout (AC #1)', () => {
  it('renders the breadcrumb as `sub-board › #room`', async () => {
    const el = await render(<RoomView room={roomModel()} />);
    const crumb = el.querySelector('[data-testid="room-breadcrumb"]');
    expect(
      crumb?.querySelector('[data-testid="breadcrumb-board"]')?.textContent,
    ).toBe('calling-interface');
    expect(crumb?.textContent).toContain('›');
    expect(crumb?.textContent).toContain('#need-a-reviewer');
  });

  it('renders the joined-participants row with accent @handles', async () => {
    const el = await render(<RoomView room={roomModel()} />);
    const handles = [
      ...el.querySelectorAll('[data-testid="joined-participant"]'),
    ].map((n) => n.textContent);
    expect(handles).toEqual(['@ada', '@bob']);
  });

  it('renders the top-to-bottom stack: breadcrumb → joined-row → thread → composer seam', async () => {
    const el = await render(<RoomView room={roomModel()} />);
    expect(el.querySelector('[data-testid="room-breadcrumb"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="joined-row"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="message-thread"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="composer-seam"]')).not.toBeNull();
  });
});

describe('RoomView operator posture (AC #2 — Mode A→B signal)', () => {
  it('shows `you: watching` when the operator is NOT a participant', async () => {
    const el = await render(
      <RoomView room={roomModel({ operatorPosture: { kind: 'watching' } })} />,
    );
    const posture = el.querySelector('[data-testid="operator-posture"]');
    expect(posture?.textContent).toBe('you: watching');
    expect(posture?.getAttribute('data-posture')).toBe('watching');
  });

  it('shows `you: @operator (peer)` when the operator IS a participant', async () => {
    const el = await render(
      <RoomView
        room={roomModel({
          operatorPosture: { kind: 'peer', handle: 'ops' },
        })}
      />,
    );
    const posture = el.querySelector('[data-testid="operator-posture"]');
    expect(posture?.textContent).toBe('you: @ops (peer)');
    expect(posture?.getAttribute('data-posture')).toBe('peer');
  });
});

describe('MessagePost agreed-mark + reaction chip wiring (Story 9.6 AC #1, #2)', () => {
  it('the converged (agreed) post shows ✓ agreed in HEAD and FOOTER + the agreed rail', async () => {
    const el = await render(
      <MessagePost post={post({ seq: 2 })} agreed={true} canReact={true} />,
    );
    // The mark appears in BOTH the head mirror and the footer (beside the 👍).
    expect(el.querySelector('[data-testid="agreed-mark-head"]')).not.toBeNull();
    expect(
      el.querySelector('[data-testid="agreed-mark-footer"]'),
    ).not.toBeNull();
    // The agreed post carries the 2px agreed-green LEFT RAIL.
    const article = el.querySelector<HTMLElement>(
      '[data-testid="message-post"]',
    );
    expect(article?.getAttribute('data-agreed')).toBe('true');
    expect(article?.style.borderLeft).toContain('var(--agreed-green)');
  });

  it('a NON-agreed post shows neither the head nor footer agreed mark + no rail', async () => {
    const el = await render(
      <MessagePost post={post({ seq: 1 })} agreed={false} canReact={true} />,
    );
    expect(el.querySelector('[data-testid="agreed-mark-head"]')).toBeNull();
    expect(el.querySelector('[data-testid="agreed-mark-footer"]')).toBeNull();
    const article = el.querySelector<HTMLElement>(
      '[data-testid="message-post"]',
    );
    expect(article?.getAttribute('data-agreed')).toBe('false');
    expect(article?.style.borderLeft).toBe('');
  });

  it('the footer always carries the reaction chip with the live count (count = reactions.length)', async () => {
    const el = await render(
      <MessagePost
        post={post({ seq: 2, reactions: ['ada', 'bob'] })}
        canReact={true}
      />,
    );
    const footer = el.querySelector('[data-testid="message-post-footer"]');
    expect(
      footer?.querySelector('[data-testid="reaction-chip"]'),
    ).not.toBeNull();
    expect(
      footer?.querySelector('[data-testid="reaction-chip-count"]')?.textContent,
    ).toBe('2');
  });

  it('clicking the chip fires onToggleReaction with the post seq (participant operator)', async () => {
    let toggledSeq: number | undefined;
    const el = await render(
      <MessagePost
        post={post({ seq: 7 })}
        canReact={true}
        onToggleReaction={(s) => {
          toggledSeq = s;
        }}
      />,
    );
    const chip = el.querySelector<HTMLButtonElement>(
      '[data-testid="reaction-chip"]',
    );
    await act(async () => {
      chip?.click();
    });
    expect(toggledSeq).toBe(7);
  });

  it('a non-participant post chip is the disabled "join to react" hand-off (no toggle)', async () => {
    let fired = false;
    const el = await render(
      <MessagePost
        post={post({ seq: 1 })}
        canReact={false}
        onToggleReaction={() => {
          fired = true;
        }}
      />,
    );
    const chip = el.querySelector<HTMLButtonElement>(
      '[data-testid="reaction-chip"]',
    );
    expect(chip?.getAttribute('data-state')).toBe('cannot-react');
    expect(chip?.disabled).toBe(true);
    await act(async () => {
      chip?.click();
    });
    expect(fired).toBe(false);
  });
});

describe('RoomView agreed-mark + chip wiring through the thread (Story 9.6 AC #1, #2)', () => {
  it('marks ONLY the agreedSeq post with ✓ agreed and gates the chip toggle to a peer operator', async () => {
    const el = await render(
      <RoomView
        room={roomModel({
          messages: [
            post({ seq: 1, kind: 'announcement', reactions: [] }),
            post({ seq: 2, reactions: ['ops'] }),
          ],
          operatorPosture: { kind: 'peer', handle: 'ops' },
          operatorHandle: 'ops',
          agreedSeq: 2,
        })}
      />,
    );
    // Exactly ONE post carries the agreed mark (the agreedSeq=2 one), in head + footer.
    expect(
      el.querySelectorAll('[data-testid="agreed-mark-footer"]'),
    ).toHaveLength(1);
    const agreedPost = el.querySelector(
      '[data-message-seq="2"]',
    ) as HTMLElement;
    expect(agreedPost.getAttribute('data-agreed')).toBe('true');
    const nonAgreed = el.querySelector('[data-message-seq="1"]') as HTMLElement;
    expect(nonAgreed.getAttribute('data-agreed')).toBe('false');
    // A peer operator's chips are toggleable (not the disabled hand-off).
    const chips = el.querySelectorAll<HTMLButtonElement>(
      '[data-testid="reaction-chip"]',
    );
    for (const chip of chips) {
      expect(chip.disabled).toBe(false);
    }
    // The operator's own 👍 on post 2 (ops ∈ reactions) renders the currently-reacted state.
    const post2Chip = agreedPost.querySelector<HTMLElement>(
      '[data-testid="reaction-chip"]',
    );
    expect(post2Chip?.getAttribute('data-state')).toBe('reacted');
  });

  it('a WATCHING operator sees disabled "join to react" chips (no doomed write)', async () => {
    const el = await render(
      <RoomView
        room={roomModel({
          messages: [post({ seq: 1, kind: 'announcement' })],
          operatorPosture: { kind: 'watching' },
          operatorHandle: 'ops',
          agreedSeq: null,
        })}
      />,
    );
    const chip = el.querySelector<HTMLButtonElement>(
      '[data-testid="reaction-chip"]',
    );
    expect(chip?.getAttribute('data-state')).toBe('cannot-react');
    expect(chip?.disabled).toBe(true);
  });

  it('with agreedSeq null, NO post carries the agreed mark (mark gone — all 👍s retracted)', async () => {
    const el = await render(
      <RoomView
        room={roomModel({
          messages: [post({ seq: 1, kind: 'announcement' }), post({ seq: 2 })],
          agreedSeq: null,
        })}
      />,
    );
    expect(
      el.querySelectorAll('[data-testid="agreed-mark-footer"]'),
    ).toHaveLength(0);
    expect(
      el.querySelectorAll('[data-testid="agreed-mark-head"]'),
    ).toHaveLength(0);
  });
});

describe('inert-in-thread proof (AC #1 — bodies render through MarkdownView, never interpolated)', () => {
  it('a code block / link body renders as the 9.2 INERT output (real elements), not raw text', async () => {
    const el = await render(
      <MessageThread
        messages={[
          post({
            seq: 1,
            body: '```typescript\nconst x: number = 1;\n```\n\n[link](https://example.com)',
          }),
        ]}
      />,
    );
    // Code block → a .code-block panel with token class-spans (the 9.2 inert render).
    expect(el.querySelector('pre.code-block')).not.toBeNull();
    expect(
      el.querySelectorAll('.code-keyword, .code-type, .code-fn').length,
    ).toBeGreaterThan(0);
    // The safe link rendered as a real <a> (not the raw `[link](...)` markdown text).
    expect(el.querySelector('.markdown-view a')?.getAttribute('href')).toBe(
      'https://example.com',
    );
  });

  it('a body carrying a markdown XSS vector renders INERT in the thread (no <script>, no live handler)', async () => {
    const el = await render(
      <MessageThread
        messages={[
          post({
            seq: 1,
            body: 'hi <script>alert(1)</script> <img src=x onerror="alert(2)"> there',
          }),
        ]}
      />,
    );
    // The thread MUST pipe the body through MarkdownView's inert pipeline: no live script,
    // and the raw <script> survives only as inert TEXT (proving it was sanitized, not run).
    expect(el.querySelector('script')).toBeNull();
    // No element retains an onerror handler attribute (DOMPurify strips event handlers).
    expect(el.querySelector('[onerror]')).toBeNull();
    expect(
      el.querySelector('[data-testid="message-thread"]')?.textContent,
    ).toContain('<script>');
  });

  it('the XSS body is inert through the FULL RoomView path too (no wrapping layer interpolates it)', async () => {
    // The app renders RoomView → MessageThread → MessagePost → MarkdownView. The direct-
    // MessageThread test above proves the thread is inert; this proves NO intervening
    // RoomView layer (breadcrumb/joined-row/composer chrome) re-introduces a string-
    // interpolation path for the body. The whole composed surface stays inert (NFR12).
    const el = await render(
      <RoomView
        room={roomModel({
          messages: [
            post({
              seq: 1,
              kind: 'announcement',
              body: 'hi <script>alert(1)</script> <img src=x onerror="alert(2)">',
            }),
          ],
        })}
      />,
    );
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('[onerror]')).toBeNull();
    // The body still went through MarkdownView (a .markdown-view container exists) and the
    // raw <script> survives only as inert text.
    expect(el.querySelector('.markdown-view')).not.toBeNull();
    expect(
      el.querySelector('[data-testid="room-view"]')?.textContent,
    ).toContain('<script>');
  });
});
