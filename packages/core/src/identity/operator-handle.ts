// Shared OPERATOR-handle canonicalization (Story 13.5) — the ONE rule both operator
// surfaces (the web host `@agentbbs/cli` and the `agentbbs-vscode-extension` app) import,
// closing the Story-10.3 duplication / drift risk (`10.3-operator-handle-dup`). Lives in
// `@agentbbs/core` because it is the only package BOTH surfaces already depend on (apps are
// leaf packages — no app↔app/app↔cli dependency; client→core is the allowed direction).
//
// THIN CLIENT (Rule 13): this is CLIENT-layer normalization, NOT board logic. The operator
// handle is a CLAIMED `--as`/`AGENTBBS_OPERATOR`/setting handle (not a registered board
// "operator" type). It is canonicalized to the ledger form (lowercased + trimmed — the form
// core stores `room.participant_added.handle` in) so the NEEDS YOU escalation match lands.
//
// DISTINCT from `register.ts#canonicalize` / `login.ts#canonicalize` (which only
// `toLowerCase()` already-Zod-validated input — NO trim, NO null). Those are NOT merged here:
// different semantics, different input contract.

/**
 * Canonicalize a raw operator handle to the ledger form (lowercased + trimmed), or `null` if
 * none/blank. An empty/whitespace-only / `undefined` / `null` value → `null` (watching-only).
 *
 * This is the SHARED operator-handle rule both operator surfaces import (Story 13.5) — the
 * web host (`@agentbbs/cli`) and the VS Code extension. Each surface keeps its OWN
 * `resolveOperatorHandle` precedence wrapper (signatures differ); only this canonicalize step
 * is shared.
 *
 * @param raw The raw handle from `--as` / the `agentbbs.operatorHandle` setting /
 *   `AGENTBBS_OPERATOR`, or `undefined`/`null`.
 * @returns The canonical handle, or `null` if none/blank.
 */
export function canonicalizeOperatorHandle(
  raw: string | undefined | null,
): string | null {
  if (raw === undefined || raw === null) return null;
  const canonical = raw.trim().toLowerCase();
  return canonical === '' ? null : canonical;
}
