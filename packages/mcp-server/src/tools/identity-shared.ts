// Shared identity-tool boundary helpers (Story 2.3).
//
// The `register` (2.2) and `login` (2.3) tools share the identical MCP boundary
// concerns: the canonical `handle` validation (charset + length) and the
// camelCase→snake_case identity wire mapping. Extracting them here keeps both thin
// tools to ONE source of truth — the handle contract and the wire shape cannot
// drift between register and login (or the later identity tools that reuse them).
//
// This is boundary plumbing (Zod shape + a field rename), NOT board logic — it
// stays in the mcp-server layer. core never sees snake_case (project wire rule).

import { z } from 'zod';

import type { Identity } from '@agentbbs/core';

/**
 * The canonical handle charset + form (architecture.md#Identifiers): lowercase
 * `[a-z0-9._@-]`, one or more chars. Uppercase and out-of-charset input is rejected
 * by this pattern at the boundary (AC #3) — anchored so the WHOLE string must match
 * (no partial/embedded match). The single source of truth shared by `register` and
 * `login`.
 */
export const HANDLE_PATTERN = /^[a-z0-9._@-]+$/;

/**
 * Max handle length — a defensive upper bound so a pathologically long handle is
 * rejected at the boundary rather than stored. Generous for `persona@project`
 * handles; not a product constraint beyond sanity.
 */
export const HANDLE_MAX_LENGTH = 128;

/**
 * The shared Zod validator for a canonical `handle` wire param: a non-empty,
 * length-bounded, canonical-charset string. The SDK validates against this and
 * rejects invalid input BEFORE the delegate runs, so an out-of-charset or
 * non-lowercase handle never reaches core.
 */
export const handleSchema = z
  .string()
  .min(1)
  .max(HANDLE_MAX_LENGTH)
  .regex(HANDLE_PATTERN, 'handle must be lowercase and use only [a-z0-9._@-]');

/** The snake_case identity payload returned on the wire (camelCase mapped here). */
export interface IdentityWire {
  handle: string;
  current_focus: string;
  created_at: string;
  last_seen: string;
}

/** Map the camelCase core {@link Identity} to its snake_case wire object. */
export function identityToWire(identity: Identity): IdentityWire {
  return {
    handle: identity.handle,
    current_focus: identity.currentFocus,
    created_at: identity.createdAt,
    last_seen: identity.lastSeen,
  };
}
