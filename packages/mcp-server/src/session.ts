// The per-connection session-identity holder (Story 2.3, Task 2).
//
// FR2: `login` re-establishes an existing identity FOR A SESSION. The stdio MCP
// server is ONE PROCESS PER AGENT (architecture.md#Infrastructure), so a "session"
// is a per-process/per-connection notion. This holder is the mcp-server layer's
// memory of WHICH handle the connection is currently acting as: a mutable "current
// handle" set by the `login` and `register` tools and read by the identity-scoped
// tools that follow (`update_focus` 2.4, `identity.seen` 2.5) as the acting actor.
//
// It is CONNECTION/SESSION STATE, deliberately NOT board state and NOT in `core`:
//   - the ledger holds board state; this holder holds none of it (no event, no
//     projection) — it is a single nullable string the server owns;
//   - `core` stays storage- AND session-agnostic (the thin-handler / module-boundary
//     rules): board resolution returns an Identity; the SERVER decides that resolved
//     handle is now the session actor and records it here.
// Threaded to the tool closures exactly like `deps` (each tool closes over it), so a
// set in one tool is observable to the others through the shared reference.

/**
 * The per-connection session identity. A mutable holder of the handle the
 * connection is currently acting as — `null` until the agent establishes itself
 * via `register` or `login`. Held by reference and shared across a server's tool
 * closures; mutating `handle` is how a tool records (and later tools read) the
 * acting identity.
 */
export interface SessionIdentity {
  /** The current session handle (canonical lowercased form), or `null` if none yet. */
  handle: string | null;
}

/**
 * Create a fresh, unauthenticated session-identity holder (`handle: null`).
 * One is created per `createBoardServer` (one server == one agent == one session);
 * `login`/`register` set it, the identity-scoped tools read it.
 */
export function createSessionIdentity(): SessionIdentity {
  return { handle: null };
}
