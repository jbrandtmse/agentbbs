// @agentbbs/ui-shared — shared React core mounted twice (web + VS Code webview):
// room thread, inert markdown renderer, reaction/agreed marks, nav tree, join-gate
// composer. Per-surface deltas confined to theme/chrome. Populated by Epic 9.
//
// Story 9.1 ships the token core: the semantic design-token CSS (tokens.css,
// imported by consumers as a side-effecting stylesheet), the WCAG contrast
// utility, and the first token-consuming component (TokenProbe, the AC3
// integration probe). Presentation-only — no @agentbbs/core / @agentbbs/data-access
// import (NFR2).

/** Package name marker; retained as a stable barrel anchor. */
export const UI_SHARED_PACKAGE = '@agentbbs/ui-shared';

export { contrastRatio, relativeLuminance, hexToRgb } from './contrast.js';
export { TokenProbe } from './TokenProbe.js';
export type { TokenProbeProps } from './TokenProbe.js';

// Story 9.2 — inert Markdown rendering pipeline + components (NFR12).
export {
  renderMarkdown,
  renderMarkdownSync,
} from './markdown/render-markdown.js';
export {
  highlightToInertHtml,
  highlightToInertHtmlSync,
  prewarmHighlighter,
  isHighlighterWarm,
  HIGHLIGHT_LANGS,
} from './markdown/highlight.js';
export { MarkdownView } from './markdown/MarkdownView.js';
export type { MarkdownViewProps } from './markdown/MarkdownView.js';
export { CodeBlock, CODE_BLOCK_LINE_CAP } from './markdown/CodeBlock.js';
export type { CodeBlockProps } from './markdown/CodeBlock.js';

// Story 9.4 — the board navigation tree (sidebar): global-read project/room tree, live
// unread/activity decorations, and the explicit-escalation-only NEEDS YOU queue. Prop-driven
// + presentation-only (NFR2 — no core/data-access import); the surface builds the model.
export { NavTree } from './tree/NavTree.js';
export type {
  NavTreeModel,
  NavTreeProps,
  NavTreeProject,
  NavTreeRoom,
  NavTreeNeedsYou,
} from './tree/NavTree.js';
export { SidebarTreeItem } from './tree/SidebarTreeItem.js';
export type {
  SidebarTreeItemProps,
  ReadState,
} from './tree/SidebarTreeItem.js';
export { SectionLabel } from './tree/SectionLabel.js';
export type { SectionLabelProps } from './tree/SectionLabel.js';
export { UnreadBadge } from './tree/UnreadBadge.js';
export type { UnreadBadgeProps } from './tree/UnreadBadge.js';
export { NeedsYouItem } from './tree/NeedsYouItem.js';
export type { NeedsYouItemProps } from './tree/NeedsYouItem.js';

// Story 9.5 — the room main-column thread: the breadcrumb + joined-participants row +
// operator posture (RoomView), the seq-ordered thread (MessageThread), and each inert post
// (MessagePost) consuming the Story 9.2 MarkdownView. Prop-driven + presentation-only
// (NFR2). The display timestamp formatter is deterministic/locale-stable (Rule 3).
export {
  MessagePost,
  POST_COLLAPSE_LINE_THRESHOLD,
} from './room/MessagePost.js';
export type {
  MessagePostProps,
  MessagePostModel,
  MessagePostKind,
} from './room/MessagePost.js';
export { MessageThread } from './room/MessageThread.js';
export type { MessageThreadProps } from './room/MessageThread.js';
export { RoomView } from './room/RoomView.js';
export type {
  RoomViewProps,
  RoomViewModel,
  OperatorPosture,
} from './room/RoomView.js';
export { formatTimestamp } from './room/format-timestamp.js';

// Story 9.6 — the per-message 👍 reaction chip (live count + resting/👍'd + one-click
// toggle, FR21) + the computed ✓ agreed mark (head + footer, live from the room contract,
// never stored). Prop-driven + presentation-only (NFR2). MessagePost wires both into the
// post footer/head; the surface computes the converged-message seq + the operator's 👍 state.
export { ReactionChip, REACTION_CHIP_HAS_BG } from './room/ReactionChip.js';
export type { ReactionChipProps } from './room/ReactionChip.js';
export { AgreedMark } from './room/AgreedMark.js';
export type { AgreedMarkProps } from './room/AgreedMark.js';
export { AGREED_POST_WASH } from './room/MessagePost.js';

// Story 9.7 — the join-gate composer (two states: not-joined `[ join room to post ]` button →
// joined `✓ you joined` + field + send). The bottom of the RoomView stack; the operator's
// participate-as-peer write surface (Mode B, FR31). Prop-driven + presentation-only (NFR2).
export { Composer } from './room/Composer.js';
export type { ComposerProps } from './room/Composer.js';

// Story 9.8 — rooms as editor tabs: the web tab strip (TabStrip) + one open-room tab (RoomTab),
// active vs inactive styling, the background-tab unread `•`, and the trailing `×` close glyph.
// Closing a tab is a VIEW-ONLY action (drop the tab) — NEVER a board op (AC2). Prop-driven +
// presentation-only (NFR2). The model stays prop-driven for Epic 10 VS Code-native-tab reuse.
export { RoomTab } from './room/RoomTab.js';
export type { RoomTabProps, RoomTabModel } from './room/RoomTab.js';
export { TabStrip } from './room/TabStrip.js';
export type { TabStripProps } from './room/TabStrip.js';

// Story 9.10 — the calm/a11y capstone chrome: the quiet sidebar connection footer (the
// `● connected` / `○ reconnecting…` LED, NEVER a modal — DESIGN components.connection-footer).
// Prop-driven + presentation-only (NFR2); the surface maps the live transport to the status.
export { ConnectionFooter } from './chrome/ConnectionFooter.js';
export type {
  ConnectionFooterProps,
  ConnectionStatus,
} from './chrome/ConnectionFooter.js';

// Story 9.11 — the operator INITIATE-surface compose affordances: "start a project"
// (CreateProjectCompose → announce_project) + "open a room" (PostAnnouncementCompose →
// post_announcement, with the calm join-first handoff for a non-member). Prop-driven +
// presentation-only (NFR2 — no core/data-access import); the surface owns the writes + the live
// tree refresh. The operator initiates via the SAME core ops an agent uses (no operator backdoor).
export { CreateProjectCompose } from './compose/CreateProjectCompose.js';
export type { CreateProjectComposeProps } from './compose/CreateProjectCompose.js';
export { PostAnnouncementCompose } from './compose/PostAnnouncementCompose.js';
export type { PostAnnouncementComposeProps } from './compose/PostAnnouncementCompose.js';

// Story 9.12 — the operator "join a project" discovery picker: a calm inline panel (NOT a modal)
// listing the joinable projects (the global-read directory MINUS the ones the operator already
// belongs to); choosing one runs the SAME `join_board` op an agent uses. Prop-driven +
// presentation-only (NFR2 — no core/data-access import); the surface owns the directory filter,
// the join write, and the live tree refresh. Wires the previously-inert `＋ join a project…` row.
export { JoinProjectPicker } from './compose/JoinProjectPicker.js';
export type {
  JoinProjectPickerProps,
  JoinableProject,
} from './compose/JoinProjectPicker.js';

// Story 9.13 — the operator "set my focus" affordance: a calm inline edit on the `@operator (you)`
// identity row that sets the operator's OWN current focus via the SAME `update_focus` op an agent
// uses (no operator backdoor). Disabled inert (with a terse reason) when watching-only OR the handle
// is unregistered — never a crash. Prop-driven + presentation-only (NFR2 — no core/data-access
// import); the surface owns the updateFocus write + the live `/api/me` re-read.
export { FocusAffordance } from './compose/FocusAffordance.js';
export type { FocusAffordanceProps } from './compose/FocusAffordance.js';
