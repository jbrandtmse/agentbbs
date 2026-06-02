// The `agentbbs:` room URI scheme (Story 10.3) — the STABLE key that links a tree row's
// `TreeItem.resourceUri` to the `FileDecorationProvider` (which decorates by URI). A room's
// URI encodes its roomId in the path so the provider can recover it; vscode-free so the
// round-trip (build → parse) is unit-testable without the `vscode.Uri` class.
//
// Shape: `agentbbs://room/<roomId>` — the authority `room` distinguishes the resource kind
// (future kinds — projects, the needs-you bucket — get their own authority if they ever need
// decorating). The roomId is a slug (no scheme-illegal chars), encoded defensively anyway.

/** The custom URI scheme the tree's resources use (the FileDecorationProvider keys off it). */
export const AGENTBBS_URI_SCHEME = 'agentbbs';
/** The authority marking a room resource. */
export const ROOM_AUTHORITY = 'room';

/** Build the canonical string form of a room's `agentbbs:` URI. */
export function roomUriString(roomId: string): string {
  return `${AGENTBBS_URI_SCHEME}://${ROOM_AUTHORITY}/${encodeURIComponent(roomId)}`;
}

/**
 * Recover the roomId from an `agentbbs://room/<roomId>` URI string, or `undefined` if the
 * string is not a well-formed room URI of this scheme/authority. Used by the decoration
 * provider to map a decorate request back to a room's state.
 */
export function parseRoomUri(uri: string): string | undefined {
  const prefix = `${AGENTBBS_URI_SCHEME}://${ROOM_AUTHORITY}/`;
  if (!uri.startsWith(prefix)) return undefined;
  const encoded = uri.slice(prefix.length);
  if (encoded === '') return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}
