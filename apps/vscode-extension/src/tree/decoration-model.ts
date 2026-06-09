// The decoration MODEL (Story 10.3, AC3) — the PURE mapping from a room's tree state
// (needsYou / unread / unreadCount) to a `FileDecoration`-shaped value, kept vscode-free so
// the badge 2-char-cap boundary + the needs-vs-unread-vs-read precedence are unit-testable.
// The `vscode`-facing FileDecorationProvider (decorations.ts) wraps this into a real
// `vscode.FileDecoration` (badge + ThemeColor + tooltip).
//
// THE BADGE 2-CHAR CAP (a REAL VS Code API constraint — `FileDecoration.badge` is "a very
// short string"; the editor truncates/warns past 2 chars): the unread COUNT therefore cannot
// be shown verbatim in the badge once it exceeds 2 digits. Past the threshold we collapse to a
// fixed ≤2-char glyph (`99+` is 3 chars, so we use the bullet `•` as the "many unread" badge);
// the EXACT count is carried in `TreeItem.description` instead (the provider sets that). Read
// rooms render calm (no decoration).
//
// PRECEDENCE: NEEDS YOU (the Mode-B escalation — `add_participant(@operator)`) outranks plain
// unread, since an escalation is the strongest call-to-action. A room that is BOTH escalated
// and unread shows the NEEDS-YOU decoration.

/** The wireframe-encoded decoration glyphs (wireframe-vscode-v1.md legend). */
export const NEEDS_YOU_BADGE = '!';
/** The bullet used for unread (also the "many unread" fallback when the count exceeds 2 chars). */
export const UNREAD_BADGE = '•';
/** The maximum length the VS Code `FileDecoration.badge` reliably renders (the API constraint). */
export const BADGE_MAX_LENGTH = 2;

/** The ThemeColor ids the decoration maps to (resolved to a real ThemeColor by the provider). */
export const NEEDS_YOU_COLOR_ID = 'agentbbs.needsYouForeground';
export const UNREAD_COLOR_ID = 'agentbbs.unreadForeground';

/** The room state the decoration is derived from. */
export interface RoomDecorationInput {
  needsYou: boolean;
  unread: boolean;
  unreadCount: number;
}

/** A vscode-free description of a `FileDecoration` (badge ≤2 chars, color id, tooltip). */
export interface DecorationSpec {
  /** A ≤{@link BADGE_MAX_LENGTH}-char badge glyph. */
  badge: string;
  /** The ThemeColor id to tint with. */
  colorId: string;
  /** The hover tooltip. */
  tooltip: string;
}

/**
 * Render the unread count for the BADGE within the 2-char cap. A 1–2 digit count is shown
 * verbatim (`1`..`99`); anything that would exceed the cap collapses to the `•` "many" glyph.
 * (The exact count is surfaced separately in `TreeItem.description`, which has no cap.)
 *
 * @param count The unread message count (must be ≥ 1 to produce a numeric badge).
 */
export function unreadBadge(count: number): string {
  const text = String(count);
  return text.length <= BADGE_MAX_LENGTH ? text : UNREAD_BADGE;
}

/**
 * Map a room's state to its decoration, or `undefined` for a CALM (read, no escalation) room —
 * which renders with no badge. NEEDS YOU outranks plain unread (precedence). The returned
 * `badge` is ALWAYS ≤{@link BADGE_MAX_LENGTH} chars (the API cap is honored here, not at the
 * call site).
 */
export function roomDecoration(
  input: RoomDecorationInput,
): DecorationSpec | undefined {
  if (input.needsYou) {
    return {
      badge: NEEDS_YOU_BADGE,
      colorId: NEEDS_YOU_COLOR_ID,
      tooltip: 'NEEDS YOU — you were pulled into this negotiation.',
    };
  }
  if (input.unread && input.unreadCount > 0) {
    return {
      badge: unreadBadge(input.unreadCount),
      colorId: UNREAD_COLOR_ID,
      tooltip:
        input.unreadCount === 1
          ? '1 unread message.'
          : `${input.unreadCount} unread messages.`,
    };
  }
  return undefined;
}
