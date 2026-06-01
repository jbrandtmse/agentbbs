// MessageThread — the scrolling, seq-ordered list of posts in a room (Story 9.5 / AC #1).
//
// Renders a room's complete message history as a top-to-bottom document (EXPERIENCE.md —
// "the room is a document"): the seeding announcement (#1) then every reply, EACH a
// `MessagePost`, ordered STRICTLY by `seq` (the authoritative total order — never
// `createdAt`; the display timestamp is decoration only). The announcement and replies
// both render as posts — `kind` distinguishes them, not their structure.
//
// a11y (Story 9.10 — THE FLOOR): the thread is a `role="list"` whose posts are `role="listitem"`
// (each announcing its `@handle` + timestamp + agreed state), PLUS a POLITE, COALESCING
// `aria-live` region. New posts/👍 arrive in frequent bursts, so the live region announces a
// debounced SUMMARY ("2 new posts") rather than spamming N separate announcements — it
// REPLACES its text once per burst (the APG/Research-First batch pattern: aria-atomic + text
// replacement = one announcement). Reading the thread itself is silent (the list is not the
// live region); the off-screen `.sr-only` region carries the summary.
//
// PRESENTATION-ONLY (NFR2): no core/data-access import; prop-driven. React 19 automatic
// JSX runtime.

import { useEffect, useRef, useState } from 'react';

import { MessagePost } from './MessagePost.js';

import type { MessagePostModel } from './MessagePost.js';
import type { CSSProperties } from 'react';

export interface MessageThreadProps {
  /** The room's messages. Rendered seq-ascending (this component sorts defensively). */
  messages: MessagePostModel[];
  /** Override the per-post whole-post collapse threshold (passes through to MessagePost). */
  collapseLineThreshold?: number;
  /**
   * The `seq` of the room's CURRENT CONTRACT — the converged message that carries the
   * `✓ agreed` mark (the highest-`seq` live-👍'd message, computed by the surface from
   * `/api/rooms/:id/contract`). `null`/absent → no converged message (no live 👍 anywhere).
   * COMPUTED, never stored (FR21): the surface re-derives + re-passes it on every 👍 change,
   * so the mark MOVES/DISAPPEARS as the contract changes.
   */
  agreedSeq?: number | null;
  /**
   * The resolved operator handle (`/api/me`), or `null`. Used to compute each post's
   * operator-👍'd state (operator ∈ post.reactions) for the chip.
   */
  operatorHandle?: string | null;
  /**
   * Whether the operator MAY toggle a 👍 (a room participant). Passed to each chip's
   * `canReact`; `false` → the disabled "join to react" hand-off (Story 9.7). Default `false`.
   */
  canReact?: boolean;
  /** Fired when the operator toggles a post's 👍 (carries the post `seq`). */
  onToggleReaction?: (seq: number) => void;
  /** High-contrast mode (passes through to each post). Default `false` (web V1). */
  highContrast?: boolean;
  /**
   * Story 9.9 — fired when the operator retries a FAILED optimistic post (carries its
   * `clientToken`). Passes through to each {@link MessagePost}; only a failed echo renders it.
   */
  onRetryPost?: (clientToken: string) => void;
  /**
   * Story 9.10 a11y — the debounce window (ms) the polite live region waits before announcing
   * a SUMMARY of newly-arrived posts. A burst of deltas within the window collapses to ONE
   * announcement ("n new posts") rather than n. Default 600ms. Set lower in tests.
   */
  liveRegionDebounceMs?: number;
}

/**
 * Render the room's messages as a seq-ordered thread of {@link MessagePost}s. The input is
 * sorted ascending by `seq` here (defensive — the order does not depend on input ordering,
 * mirroring core's `roomMessages` fold), so message #1 (the announcement, lowest `seq`) is
 * always first. The converged message (`agreedSeq`) gets the `✓ agreed` mark; each post's
 * 👍 chip reflects the live count + the operator's own state + the participation gate.
 */
export function MessageThread({
  messages,
  collapseLineThreshold,
  agreedSeq = null,
  operatorHandle = null,
  canReact = false,
  onToggleReaction,
  highContrast = false,
  onRetryPost,
  liveRegionDebounceMs = 600,
}: MessageThreadProps) {
  // Order STRICTLY by `seq` (never `createdAt`) — a copy so the caller's array is untouched.
  // Story 9.9: a pending/failed optimistic echo carries a synthetic LARGE seq (assigned by the
  // surface), so it sorts to the BOTTOM of the thread (after every confirmed post) until it
  // reconciles to its real seq. Confirmed posts keep their ledger seq order.
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);

  // --- Story 9.10 a11y — the POLITE, COALESCING live-region announcement. ---
  // Count CONFIRMED posts (a pending echo is the operator's own draft — not "new arrivals" to
  // announce). When that count GROWS, schedule a single debounced summary; a burst within the
  // window collapses to ONE announcement. We REPLACE the region text (not append) so assistive
  // tech announces it once (the APG batch pattern). The first render seeds the baseline silently.
  const confirmedCount = ordered.filter(
    (m) => m.pending !== true && m.failed !== true,
  ).length;
  const [announcement, setAnnouncement] = useState('');
  const prevCountRef = useRef<number | null>(null);
  const pendingDeltaRef = useRef(0);

  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = confirmedCount;
    // First observation seeds the baseline silently (the initial thread load is not "new").
    if (prev === null) return;
    const delta = confirmedCount - prev;
    if (delta <= 0) return;
    // Accumulate this burst's new-post count, then debounce a SINGLE summary announcement.
    pendingDeltaRef.current += delta;
    const handle = setTimeout(() => {
      const n = pendingDeltaRef.current;
      pendingDeltaRef.current = 0;
      if (n <= 0) return;
      setAnnouncement(n === 1 ? '1 new post' : `${n} new posts`);
    }, liveRegionDebounceMs);
    return () => clearTimeout(handle);
  }, [confirmedCount, liveRegionDebounceMs]);

  const threadStyle: CSSProperties = {
    padding: '0 var(--space-7)',
    overflowY: 'auto',
  };

  return (
    <div
      className="message-thread"
      data-testid="message-thread"
      role="list"
      aria-label="room thread"
      style={threadStyle}
    >
      {/* The polite, coalescing live region — off-screen (.sr-only) but announced. Replaces its
          text once per burst (aria-atomic so the whole summary is read). Reading the thread is
          silent; this carries only the "n new posts" summary. */}
      <div
        className="sr-only"
        data-testid="thread-live-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
      {ordered.map((post) => (
        <MessagePost
          // A pending/failed echo keys by its stable clientToken (its synthetic seq is
          // transient); a confirmed post keys by its ledger seq.
          key={post.clientToken ?? post.seq}
          post={post}
          collapseLineThreshold={collapseLineThreshold}
          agreed={agreedSeq !== null && post.seq === agreedSeq}
          operatorReacted={
            operatorHandle !== null && post.reactions.includes(operatorHandle)
          }
          canReact={canReact}
          onToggleReaction={onToggleReaction}
          highContrast={highContrast}
          onRetryPost={onRetryPost}
        />
      ))}
    </div>
  );
}
