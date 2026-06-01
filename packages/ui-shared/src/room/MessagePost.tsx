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
// Story 9.6 wires in the 👍 reaction chip + the computed ✓ agreed mark + the agreed
// rail/wash. The FOOTER carries the `ReactionChip` (the per-message 👍, live count + toggle);
// the converged post (the room's CURRENT CONTRACT, computed by the surface and passed in as
// `agreed` — NEVER a stored flag) additionally gets the `✓ agreed` mark in the head + footer,
// a `2px --agreed-green` left RAIL, and a faint green WASH (gated behind a non-HC check). The
// `reactions` handle array drives the chip count; the surface passes the operator's own
// 👍 state + the participant gate.
//
// PRESENTATION-ONLY (NFR2): no @agentbbs/core / @agentbbs/data-access import; prop-driven.
// React 19 automatic JSX runtime. The display timestamp is FORMATTED from the provided
// `createdAt` string (deterministic, locale-stable — see `formatTimestamp`); ordering of
// posts is the THREAD's concern (by `seq`), never this component's.

import { useState } from 'react';

import { MarkdownView } from '../markdown/MarkdownView.js';
import { AgreedMark } from './AgreedMark.js';
import { ReactionChip } from './ReactionChip.js';
import { formatTimestamp } from './format-timestamp.js';

import type { CSSProperties } from 'react';

/** The faint green wash behind the agreed post (DESIGN.md message-post.agreed-wash). */
export const AGREED_POST_WASH = 'rgba(78,192,122,0.07)';

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
  /**
   * Story 9.9 — OPTIMISTIC POST STATE. When the operator sends, the surface echoes the post
   * into the thread immediately in a `pending` state (dimmed + "sending…") with a synthetic
   * negative `seq` and a `clientToken`; on the POST response it RECONCILES (replaces the
   * pending echo with the confirmed message at its real `seq`). `pending` → a confirmed
   * message simply omits it (default `false`). A CONFIRMED message never carries a token.
   */
  pending?: boolean;
  /**
   * Story 9.9 — the optimistic post FAILED (the POST errored). The surface flips the pending
   * echo to `failed` (the draft is preserved — the body is still here) and shows an inline
   * `post failed — retry` affordance (no modal). Retry re-sends the SAME body. Default `false`.
   */
  failed?: boolean;
  /**
   * Story 9.9 — the client-side correlation token for an optimistic echo (a pending/failed
   * post). The surface uses it to reconcile (replace) the echo with the confirmed message and
   * to target a retry. Absent on a confirmed (server-derived) message.
   */
  clientToken?: string;
}

export interface MessagePostProps {
  /** The post to render. */
  post: MessagePostModel;
  /**
   * The source-line count above which the whole post collapses to a "show more" preview
   * (DESIGN.md "> ~30 lines"). Defaults to {@link POST_COLLAPSE_LINE_THRESHOLD}.
   */
  collapseLineThreshold?: number;
  /**
   * Whether THIS post is the room's CURRENT CONTRACT — the converged message (computed by
   * the surface from `/api/rooms/:id/contract`: the highest-`seq` live-👍'd message). When
   * `true`, the post shows the `✓ agreed` mark (head + footer) + the agreed rail + wash.
   * NEVER a stored flag (FR21) — the surface re-derives it on every 👍 change, so it MOVES
   * and DISAPPEARS as the contract changes. Defaults to `false`.
   */
  agreed?: boolean;
  /**
   * Whether the OPERATOR currently holds a live 👍 on this post (the FR21 currently-👍'd
   * state for the chip). The surface computes it as `operator ∈ post.reactions`. Default `false`.
   */
  operatorReacted?: boolean;
  /**
   * Whether the operator MAY toggle a 👍 (a room participant). `false` → the chip renders
   * the disabled "join to react" hand-off (Story 9.7). Defaults to `false`.
   */
  canReact?: boolean;
  /**
   * Fired when the operator toggles the 👍 on THIS post (carries the post `seq`). The surface
   * fires the react/unreact write then refetches (Story 9.9 adds optimism). Not fired when
   * `!canReact`.
   */
  onToggleReaction?: (seq: number) => void;
  /**
   * High-contrast mode — drops the green wash + chip tint for solid borders (DESIGN.md).
   * Defaults to `false` (web V1 is non-HC). Story 9.10 owns the real a11y/HC floor.
   */
  highContrast?: boolean;
  /**
   * Story 9.9 — fired when the operator clicks `retry` on a FAILED optimistic post (carries
   * the post's `clientToken`). The surface re-sends the same body. Only rendered/fired when
   * `post.failed` and a `clientToken` is present.
   */
  onRetryPost?: (clientToken: string) => void;
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
  agreed = false,
  operatorReacted = false,
  canReact = false,
  onToggleReaction,
  highContrast = false,
  onRetryPost,
}: MessagePostProps) {
  // Story 9.9 — optimistic post state. A pending echo is dimmed + "sending…"; a failed echo
  // shows the inline `post failed — retry` affordance (no modal; the draft body is preserved
  // right here in the post). Both are PRE-CONFIRMATION — they have no real seq yet, so the
  // 👍 chip + agreed mark are suppressed until reconciliation.
  const pending = post.pending === true;
  const failed = post.failed === true;
  const optimistic = pending || failed;
  const isLong = sourceLineCount(post.body) > collapseLineThreshold;
  // Long posts start COLLAPSED (a calm preview); the operator opts in to the full body.
  const [expanded, setExpanded] = useState(false);
  const collapsed = isLong && !expanded;

  // The agreed (converged-contract) post carries a 2px agreed-green LEFT RAIL + a faint
  // green WASH (the wash gated behind non-HC per DESIGN.md — HC keeps the rail only). The
  // left padding makes room for the rail so the body does not shift between states.
  const articleStyle: CSSProperties = {
    padding: agreed
      ? 'var(--space-5) 0 var(--space-5) var(--space-4)'
      : 'var(--space-5) 0',
    borderBottom: '1px solid var(--border-soft)',
    ...(agreed
      ? {
          borderLeft: '2px solid var(--agreed-green)',
          background: highContrast ? 'transparent' : AGREED_POST_WASH,
        }
      : {}),
    // A PENDING optimistic echo is dimmed (the small token-based "sending…" affordance —
    // DESIGN/EXPERIENCE.md "optimistic post echo"); a FAILED echo returns to full opacity so
    // the inline retry reads clearly. The dim is opacity-only (no layout shift on reconcile).
    ...(pending ? { opacity: 0.55 } : {}),
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

  const footerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    marginTop: 'var(--space-3)',
  };

  const timestamp = post.createdAt ? formatTimestamp(post.createdAt) : '';

  // Story 9.10 a11y — the screen-reader label announcing this post: its author `@handle`, the
  // display timestamp, and (only on the converged contract) the agreed state. A pending echo
  // announces "sending"; a failed echo announces "post failed". The visible body is read after.
  const ariaLabel = [
    `@${post.actor}`,
    timestamp.length > 0 ? timestamp : '',
    agreed && !optimistic ? 'agreed' : '',
    pending ? 'sending' : '',
    failed ? 'post failed' : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <article
      className={agreed ? 'message-post message-post--agreed' : 'message-post'}
      data-testid="message-post"
      data-message-seq={post.seq}
      data-kind={post.kind}
      data-agreed={agreed ? 'true' : 'false'}
      data-pending={pending ? 'true' : 'false'}
      data-failed={failed ? 'true' : 'false'}
      role="listitem"
      aria-label={ariaLabel}
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
        {/* The agreed-mark HEAD mirror (DESIGN.md) — only on the converged post (never on an
            optimistic echo, which has no real seq/contract yet). */}
        {agreed && !optimistic && <AgreedMark placement="head" />}
        {/* A PENDING echo shows a calm "sending…" affordance in place of the timestamp (the
            token-based pending style); a confirmed post shows its display timestamp. */}
        {pending && (
          <span
            className="message-post-sending"
            data-testid="message-post-sending"
            style={timestampStyle}
          >
            sending…
          </span>
        )}
        {!optimistic && timestamp.length > 0 && (
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

      {/* FOOTER: the per-message 👍 reaction chip, plus the agreed-mark on the converged
          post (beside the 👍). The chip RENDERS for any operator (open read); it toggles
          only for a participant (canReact) — else the disabled "join to react" hand-off.
          An OPTIMISTIC echo (pending/failed, no real seq) suppresses the chip + agreed mark:
          a pending post cannot be reacted to, and a failed post shows the inline retry. */}
      <footer
        className="message-post-footer"
        data-testid="message-post-footer"
        style={footerStyle}
      >
        {!optimistic && (
          <ReactionChip
            count={post.reactions.length}
            reacted={operatorReacted}
            canReact={canReact}
            onToggle={
              onToggleReaction ? () => onToggleReaction(post.seq) : undefined
            }
            highContrast={highContrast}
          />
        )}
        {agreed && !optimistic && <AgreedMark placement="footer" />}
        {/* INLINE failure-retry (AC2): no modal, no lost draft — the body above IS the
            preserved draft; `retry` re-sends the same post. Calm error text, not red-alarm. */}
        {failed && (
          <span
            className="message-post-failed"
            data-testid="message-post-failed"
            style={{
              fontFamily: 'var(--ui-label-font)',
              fontSize: 'var(--ui-label-size)',
              color: 'var(--text-muted)',
            }}
          >
            post failed —{' '}
            <button
              type="button"
              className="message-post-retry"
              data-testid="message-post-retry"
              onClick={
                onRetryPost && post.clientToken !== undefined
                  ? () => onRetryPost(post.clientToken as string)
                  : undefined
              }
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: 'var(--accent)',
                fontFamily: 'var(--ui-label-font)',
                fontSize: 'var(--ui-label-size)',
                cursor: 'pointer',
              }}
            >
              retry
            </button>
          </span>
        )}
      </footer>
    </article>
  );
}
