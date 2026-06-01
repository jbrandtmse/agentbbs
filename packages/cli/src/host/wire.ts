// Wire mapping for the on-demand web host's JSON API (Story 9.3).
//
// The host is a THIN client over @agentbbs/core (NFR2) — the analogue of the
// stdio mcp-server, but speaking HTTP/JSON instead of MCP. Like every
// serialization boundary in the system, the JSON API speaks **snake_case** on the
// wire while core stays camelCase (project-context.md#Wire / serialization
// contract). The camelCase→snake_case conversion lives HERE, at this boundary —
// core never sees snake_case.
//
// These wire shapes MIRROR the MCP tool contract envelopes (docs/mcp-tool-contract.md
// §3) so the two operator/agent surfaces agree:
//   - project  → { project_id, title, description, announcer, members }
//   - member   → { handle, current_focus, last_seen }
//   - room     → { room_id, project_id, subject, body, posted_by, seq, active,
//                  activated_by?, activated_at_seq? }
//   - message  → { seq, actor, body, kind, reactions }
//   - event    → { seq, type, actor, created_at, payload }   (SSE delta frame)
//
// They are DEFINED here rather than imported from mcp-server because cli must not
// take a workspace dependency on mcp-server (NFR2 module boundary — clients are
// peers, not each other's dependencies). The shapes are pinned to the contract by
// the host's tests; a drift is a test failure.
//
// This is boundary plumbing (a field rename), NOT board logic — the host adds no
// board logic of its own; it validates/maps and delegates to core.

import type {
  DirectoryMember,
  Event,
  Project,
  Room,
  RoomMessage,
} from '@agentbbs/core';

/** The snake_case project payload (mirrors `list_projects` / `announce_project`). */
export interface ProjectWire {
  project_id: string;
  title: string;
  description: string;
  announcer: string;
  /** Member handles in join order (announcer first). A real array on the wire. */
  members: string[];
}

/** Map the camelCase core {@link Project} to its snake_case wire object. */
export function projectToWire(project: Project): ProjectWire {
  return {
    project_id: project.projectId,
    title: project.title,
    description: project.description,
    announcer: project.announcer,
    members: [...project.members],
  };
}

/** The snake_case member-directory row (mirrors `list_members`). */
export interface MemberWire {
  handle: string;
  current_focus: string;
  last_seen: string;
}

/** Map the camelCase core {@link DirectoryMember} to its snake_case wire object. */
export function memberToWire(member: DirectoryMember): MemberWire {
  return {
    handle: member.handle,
    current_focus: member.currentFocus,
    last_seen: member.lastSeen,
  };
}

/** The snake_case room payload (mirrors `list_rooms` / `read_room` / `reply`). */
export interface RoomWire {
  room_id: string;
  project_id: string;
  subject: string;
  body: string;
  posted_by: string;
  seq: number;
  active: boolean;
  /** Present (paired) iff the room is active — the actor of the min-`seq` reply. */
  activated_by?: string;
  /** Present (paired) iff the room is active — `seq` of the activating reply. */
  activated_at_seq?: number;
}

/**
 * Map the camelCase core {@link Room} to its snake_case wire object. The activator
 * fields are OMITTED for a still-proto room (the core `Room` carries them as
 * `undefined`), so a proto-room's wire object does not carry empty activator keys —
 * they appear exactly when `active === true` (mirrors mcp-server's `roomToWire`).
 */
export function roomToWire(room: Room): RoomWire {
  const wire: RoomWire = {
    room_id: room.roomId,
    project_id: room.projectId,
    subject: room.subject,
    body: room.body,
    posted_by: room.postedBy,
    seq: room.seq,
    active: room.active,
  };
  if (room.activatedBy !== undefined) {
    wire.activated_by = room.activatedBy;
  }
  if (room.activatedAtSeq !== undefined) {
    wire.activated_at_seq = room.activatedAtSeq;
  }
  return wire;
}

/** The snake_case room-message payload (mirrors `read_room` message objects). */
export interface MessageWire {
  seq: number;
  actor: string;
  body: string;
  kind: RoomMessage['kind'];
  reactions: string[];
}

/** Map the camelCase core {@link RoomMessage} to its snake_case wire object. */
export function messageToWire(message: RoomMessage): MessageWire {
  return {
    seq: message.seq,
    actor: message.actor,
    body: message.body,
    kind: message.kind,
    reactions: message.reactions,
  };
}

/**
 * The snake_case event payload carried in an SSE delta frame. The host pushes raw
 * folded {@link Event}s (the operator's live view derives its own UI from them);
 * `created_at` is the only multi-word field. The event `payload` is already stored
 * snake_case at rest (the wire contract), so it is forwarded verbatim — core's
 * `Event.payload` is the camelCase READ form, so the host maps the known payload
 * keys back to snake_case here. For Story 9.3 the SSE consumer (the apps/web shell)
 * only needs `seq` + `type` to prove the pipe; the full payload is carried as the
 * documented extension seam for richer live UI (Story 9.9).
 */
export interface EventWire {
  seq: number;
  type: Event['type'];
  actor: string;
  created_at: string;
  /** The event payload (snake_case keys). Shape varies by `type`. */
  payload: Record<string, unknown>;
}

/**
 * Map a camelCase core {@link Event} to its snake_case SSE-frame wire object.
 *
 * The payload keys are remapped camelCase→snake_case generically (the union of
 * payload fields across the closed event vocabulary is small and single-or-two-word),
 * so a `projectId` becomes `project_id`, `roomId` → `room_id`, `messageSeq` →
 * `message_seq`, `currentFocus` → `current_focus`, etc. Keys already single-word
 * (`handle`, `subject`, `body`, `title`, `description`) pass through unchanged. This
 * keeps the SSE frames consistent with the rest of the snake_case wire contract.
 */
export function eventToWire(event: Event): EventWire {
  return {
    seq: event.seq,
    type: event.type,
    actor: event.actor,
    created_at: event.createdAt,
    // The payload is a closed-union object; spread it to a plain record (via unknown,
    // since the union has no index signature) before the camel→snake key remap.
    payload: camelKeysToSnake({ ...event.payload } as unknown as Record<
      string,
      unknown
    >),
  };
}

/** Convert a single camelCase identifier to snake_case (`roomId` → `room_id`). */
function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Shallow-remap an object's keys camelCase→snake_case (payloads are flat). */
function camelKeysToSnake(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[camelToSnake(key)] = value;
  }
  return out;
}
