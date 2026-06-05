// Resolve the operator handle for the extension (Story 10.3) — the SAME `--as`/
// `AGENTBBS_OPERATOR` concept the web host uses (a CLAIMED handle, not a registered "operator"
// type). Mirrors the web host's canonicalization EXACTLY (lowercased + trimmed — the form core
// stores `room.participant_added.handle` in) so the NEEDS YOU escalation match lands.
//
// THIN CLIENT (Rule 13): this is client-layer normalization, NOT board logic — the identical
// rule as `packages/cli/src/ui.ts#resolveOperatorHandle`, duplicated here because the extension
// is a separate thin client (the web host's helper lives in @agentbbs/cli, which the extension
// must not depend on — apps are leaf packages, no app↔app/app↔cli dependency).
//
// Sources (precedence): an explicit value (a VS Code setting `agentbbs.operatorHandle`, read
// by the host and passed in), else the `AGENTBBS_OPERATOR` env, else `null` (watching-only —
// an empty NEEDS YOU bucket; global read still works).

/**
 * Canonicalize a raw operator handle to the ledger form (lowercased + trimmed), or `null` if
 * none/blank. An empty/whitespace-only value → `null` (watching-only).
 *
 * @param raw The raw handle from the `agentbbs.operatorHandle` setting / `AGENTBBS_OPERATOR`
 *   env, or `undefined`.
 */
export function canonicalizeOperatorHandle(
  raw: string | undefined | null,
): string | null {
  if (raw === undefined || raw === null) return null;
  const canonical = raw.trim().toLowerCase();
  return canonical === '' ? null : canonical;
}

/**
 * Resolve the operator handle from the setting value (precedence) then the `AGENTBBS_OPERATOR`
 * env, canonicalized. `settingValue` is read host-side from `agentbbs.operatorHandle`.
 *
 * @param settingValue The `agentbbs.operatorHandle` configuration value (or `undefined`).
 * @param env The environment (defaults to `process.env`; injectable for tests).
 */
export function resolveOperatorHandle(
  settingValue: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromSetting = canonicalizeOperatorHandle(settingValue);
  if (fromSetting !== null) return fromSetting;
  return canonicalizeOperatorHandle(env.AGENTBBS_OPERATOR);
}
