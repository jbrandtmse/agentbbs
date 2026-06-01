// The apps/web client's thin JSON-API + SSE access (Story 9.3, Task 1).
//
// The web client speaks ONLY the host's local JSON API + SSE channel (NFR2): it never
// imports @agentbbs/core / @agentbbs/data-access and never speaks MCP or SQL. These
// helpers are the entire data seam — `fetchDirectory` reads the board directory over
// HTTP; `foldDelta` accumulates the SSE event deltas the host pushes (host → THIS
// operator browser; NFR5 — never an agent push). Both are PURE/transport-thin and unit-
// testable without a real server (the AC3 integration test proves the real wiring).
//
// The wire shapes mirror the host's JSON API (snake_case), which mirrors the MCP tool
// contract envelopes. Kept minimal for 9.3 — the rich tree/thread types ride on this in
// Stories 9.4/9.5.

/** A project (sub-board) as the JSON API returns it (snake_case). */
export interface ProjectWire {
  project_id: string;
  title: string;
  description: string;
  announcer: string;
  members: string[];
}

/** The `/api/directory` (and `/api/projects`) envelope. */
export interface DirectoryResponse {
  projects: ProjectWire[];
}

/** One SSE delta frame's event payload (snake_case), as the host pushes it. */
export interface EventWire {
  seq: number;
  type: string;
  actor: string;
  created_at: string;
  payload: Record<string, unknown>;
}

/**
 * Fetch the board directory from the host's JSON API. Throws on a non-2xx response
 * (the caller surfaces a calm error state — Story 9.10 enriches it).
 *
 * @param baseUrl The host origin (defaults to the current page origin). Injectable so
 *   a test can point at a bound test host.
 * @param fetchImpl The fetch implementation (defaults to global `fetch`). Injectable.
 */
export async function fetchDirectory(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): Promise<DirectoryResponse> {
  const response = await fetchImpl(`${baseUrl}/api/directory`);
  if (!response.ok) {
    throw new Error(`Directory fetch failed: HTTP ${response.status}`);
  }
  return (await response.json()) as DirectoryResponse;
}

/** The accumulated live state the SSE deltas fold into (minimal for 9.3). */
export interface LiveState {
  /** The highest event `seq` seen over SSE (the live high-water-mark). */
  lastSeq: number;
  /** The count of delta frames received (proves the pipe is live). */
  deltaCount: number;
  /** The most recent delta event (for the shell to display). */
  latest?: EventWire;
}

/** The initial (pre-SSE) live state. */
export const INITIAL_LIVE_STATE: LiveState = { lastSeq: 0, deltaCount: 0 };

/**
 * Fold one SSE delta event into the live state (PURE — the reducer the shell applies on
 * each `EventSource` message). Advances `lastSeq` to the max seen, increments the count,
 * and records the latest event. An out-of-order / already-seen `seq` does not regress
 * `lastSeq` (deltas are monotonic by construction, but the fold is defensive).
 *
 * @param state The current live state.
 * @param event The decoded delta event from an SSE `data:` frame.
 * @returns The next live state.
 */
export function foldDelta(state: LiveState, event: EventWire): LiveState {
  return {
    lastSeq: Math.max(state.lastSeq, event.seq),
    deltaCount: state.deltaCount + 1,
    latest: event,
  };
}

/**
 * Open an SSE connection to the host's event channel and invoke `onDelta` for each
 * delta frame. Returns a disposer that closes the `EventSource`. Uses the browser-global
 * `EventSource` (the web client runs in a real browser; the host serves
 * `text/event-stream`). NFR5: this is the operator browser's OWN live view — not an
 * agent push.
 *
 * @param onDelta Called with each decoded {@link EventWire}.
 * @param baseUrl The host origin (defaults to current origin).
 * @returns A function that closes the connection.
 */
export function openEventStream(
  onDelta: (event: EventWire) => void,
  baseUrl = '',
): () => void {
  const source = new EventSource(`${baseUrl}/api/events`);
  source.addEventListener('message', (ev: MessageEvent<string>) => {
    try {
      onDelta(JSON.parse(ev.data) as EventWire);
    } catch {
      // A malformed frame is ignored — the operator's view degrades gracefully.
    }
  });
  return () => source.close();
}
