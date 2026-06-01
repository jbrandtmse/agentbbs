// MessageThread — the scrolling, seq-ordered list of posts in a room (Story 9.5 / AC #1).
//
// Renders a room's complete message history as a top-to-bottom document (EXPERIENCE.md —
// "the room is a document"): the seeding announcement (#1) then every reply, EACH a
// `MessagePost`, ordered STRICTLY by `seq` (the authoritative total order — never
// `createdAt`; the display timestamp is decoration only). The announcement and replies
// both render as posts — `kind` distinguishes them, not their structure.
//
// a11y (Story 9.10 owns the full floor): the thread is a semantic list of posts (each post
// is an <article>), so 9.10 can enrich it with roles/landmarks without reshaping it.
//
// PRESENTATION-ONLY (NFR2): no core/data-access import; prop-driven. React 19 automatic
// JSX runtime.

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
}: MessageThreadProps) {
  // Order STRICTLY by `seq` (never `createdAt`) — a copy so the caller's array is untouched.
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);

  const threadStyle: CSSProperties = {
    padding: '0 var(--space-7)',
    overflowY: 'auto',
  };

  return (
    <div
      className="message-thread"
      data-testid="message-thread"
      style={threadStyle}
    >
      {ordered.map((post) => (
        <MessagePost
          key={post.seq}
          post={post}
          collapseLineThreshold={collapseLineThreshold}
          agreed={agreedSeq !== null && post.seq === agreedSeq}
          operatorReacted={
            operatorHandle !== null && post.reactions.includes(operatorHandle)
          }
          canReact={canReact}
          onToggleReaction={onToggleReaction}
          highContrast={highContrast}
        />
      ))}
    </div>
  );
}
