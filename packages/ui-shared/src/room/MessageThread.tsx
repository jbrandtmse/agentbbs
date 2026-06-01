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
}

/**
 * Render the room's messages as a seq-ordered thread of {@link MessagePost}s. The input is
 * sorted ascending by `seq` here (defensive — the order does not depend on input ordering,
 * mirroring core's `roomMessages` fold), so message #1 (the announcement, lowest `seq`) is
 * always first.
 */
export function MessageThread({
  messages,
  collapseLineThreshold,
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
        />
      ))}
    </div>
  );
}
