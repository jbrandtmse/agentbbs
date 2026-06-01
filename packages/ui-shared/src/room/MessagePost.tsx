// MessagePost — one post in a room's message thread (Story 9.5 / AC #1).
//
// Renders a single message as part of the long-form "room is a document" surface
// (EXPERIENCE.md — "rendered full-height, not a bubble stream"): a header row of the
// author `@handle` (mono, accent-tinted) + a right-aligned display `timestamp`, then the
// body rendered INERT via the Story 9.2 `MarkdownView` within the reading measure
// (`--measure`). A hairline `--border-soft` divider separates posts (applied as the
// post's bottom border).
//
// FULL-HEIGHT by default (DESIGN.md components.message-post): a post is NOT capped — only
// a LONG post (> ~30 source lines) collapses to a "show more" preview, a WHOLE-POST
// collapse distinct from the Story 9.2 per-code-block line cap (that caps an individual
// fenced block; this caps the entire post's height). "show more" expands it in place.
//
// Story 9.6 owns the 👍 reaction chip + the ✓ agreed mark + the agreed rail/wash — this
// component leaves room for them (a footer/rail seam) but does NOT build them. The
// `reactions` handle array is carried in the model but not rendered here.
//
// PRESENTATION-ONLY (NFR2): no @agentbbs/core / @agentbbs/data-access import; prop-driven.
// React 19 automatic JSX runtime. The display timestamp is FORMATTED from the provided
// `createdAt` string (deterministic, locale-stable — see `formatTimestamp`); ordering of
// posts is the THREAD's concern (by `seq`), never this component's.

import { useState } from 'react';

import { MarkdownView } from '../markdown/MarkdownView.js';
import { formatTimestamp } from './format-timestamp.js';

import type { CSSProperties } from 'react';

/** The kind discriminator of a post — the seeding announcement (#1) vs a reply. */
export type MessagePostKind = 'announcement' | 'reply';

/** One message in a room thread — the prop-driven post model (surface-agnostic). */
export interface MessagePostModel {
  /** The message's `seq` — its identity + the THREAD's order key (never `createdAt`). */
  seq: number;
  /** The author handle (rendered `@handle`, mono accent-tinted). */
  actor: string;
  /** The raw, untrusted markdown body — rendered INERT via MarkdownView (Story 9.2). */
  body: string;
  /** Whether this is the seeding announcement (#1) or a reply. */
  kind: MessagePostKind;
  /**
   * The DISPLAY timestamp (ISO-8601 UTC string), formatted right-aligned. Optional: a model
   * lacking it (e.g. a surface that does not thread the host's host-layer `created_at`)
   * simply renders no timestamp. NEVER an ordering input.
   */
  createdAt?: string;
  /**
   * The handles holding a live 👍 on this message. Carried for Story 9.6 (the reaction chip)
   * — NOT rendered here. Present so the thread model is complete at the 9.5 boundary.
   */
  reactions: string[];
}

export interface MessagePostProps {
  /** The post to render. */
  post: MessagePostModel;
  /**
   * The source-line count above which the whole post collapses to a "show more" preview
   * (DESIGN.md "> ~30 lines"). Defaults to {@link POST_COLLAPSE_LINE_THRESHOLD}.
   */
  collapseLineThreshold?: number;
}

/** The default whole-post collapse threshold (DESIGN.md "> ~30 lines"). */
export const POST_COLLAPSE_LINE_THRESHOLD = 30;

/** Count a body's source lines (newline-delimited) — the whole-post collapse metric. */
function sourceLineCount(body: string): number {
  if (body.length === 0) return 0;
  return body.split('\n').length;
}

/**
 * Render one post: an `@handle` + right-aligned timestamp header, then the inert
 * MarkdownView body within the reading measure, with a hairline bottom divider. A post
 * longer than `collapseLineThreshold` source lines collapses to a clipped preview with a
 * "show more" toggle (whole-post collapse, distinct from the 9.2 per-code-block cap).
 */
export function MessagePost({
  post,
  collapseLineThreshold = POST_COLLAPSE_LINE_THRESHOLD,
}: MessagePostProps) {
  const isLong = sourceLineCount(post.body) > collapseLineThreshold;
  // Long posts start COLLAPSED (a calm preview); the operator opts in to the full body.
  const [expanded, setExpanded] = useState(false);
  const collapsed = isLong && !expanded;

  const articleStyle: CSSProperties = {
    padding: 'var(--space-5) 0',
    borderBottom: '1px solid var(--border-soft)',
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-2)',
  };

  const handleStyle: CSSProperties = {
    fontFamily: 'var(--handle-font)',
    fontSize: 'var(--handle-size)',
    fontWeight: 'var(--handle-weight)' as CSSProperties['fontWeight'],
    color: 'var(--accent-on-dark)',
  };

  const timestampStyle: CSSProperties = {
    fontFamily: 'var(--timestamp-font)',
    fontSize: 'var(--timestamp-size)',
    fontWeight: 'var(--timestamp-weight)' as CSSProperties['fontWeight'],
    letterSpacing: 'var(--timestamp-letter-spacing)',
    color: 'var(--text-muted)',
    flexShrink: 0,
  };

  // The collapsed preview clips the body to a calm fixed height; the full body renders at
  // natural (full) height. The clip is height-only (the inert markdown is untouched).
  const bodyStyle: CSSProperties = collapsed
    ? {
        maxHeight:
          'calc(var(--message-body-line-height) * var(--message-body-size) * 12)',
        overflow: 'hidden',
        maskImage: 'linear-gradient(to bottom, #000 70%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 70%, transparent)',
      }
    : {};

  const toggleStyle: CSSProperties = {
    background: 'transparent',
    border: 'none',
    padding: 'var(--space-2) 0 0',
    color: 'var(--accent)',
    fontFamily: 'var(--ui-label-font)',
    fontSize: 'var(--ui-label-size)',
    cursor: 'pointer',
  };

  const timestamp = post.createdAt ? formatTimestamp(post.createdAt) : '';

  return (
    <article
      className="message-post"
      data-testid="message-post"
      data-message-seq={post.seq}
      data-kind={post.kind}
      style={articleStyle}
    >
      <header className="message-post-head" style={headerStyle}>
        <span
          className="message-post-handle"
          data-testid="message-post-handle"
          style={handleStyle}
        >
          @{post.actor}
        </span>
        {timestamp.length > 0 && (
          <time
            className="message-post-timestamp"
            data-testid="message-post-timestamp"
            dateTime={post.createdAt}
            style={timestampStyle}
          >
            {timestamp}
          </time>
        )}
      </header>

      <div
        className={
          collapsed
            ? 'message-post-body message-post-body--collapsed'
            : 'message-post-body'
        }
        data-testid="message-post-body"
        data-collapsed={collapsed ? 'true' : 'false'}
        style={bodyStyle}
      >
        <MarkdownView body={post.body} />
      </div>

      {isLong && (
        <button
          type="button"
          className="message-post-toggle"
          data-testid="message-post-toggle"
          onClick={() => setExpanded((v) => !v)}
          style={toggleStyle}
        >
          {collapsed ? 'show more' : 'show less'}
        </button>
      )}
    </article>
  );
}
