// Resolve the operator handle for the extension (Story 10.3) — the SAME `--as`/
// `AGENTBBS_OPERATOR` concept the web host uses (a CLAIMED handle, not a registered "operator"
// type). Uses the SAME canonicalization (lowercased + trimmed — the form core stores
// `room.participant_added.handle` in) so the NEEDS YOU escalation match lands.
//
// THIN CLIENT (Rule 13): this is client-layer normalization, NOT board logic. As of Story 13.5
// the canonicalization rule is NO LONGER duplicated — it lives ONCE in `@agentbbs/core`
// (`canonicalizeOperatorHandle`), which both this extension and the web host (`@agentbbs/cli`)
// import (closing `10.3-operator-handle-dup`). Core is the only package both surfaces depend on
// (apps are leaf packages — no app↔app/app↔cli dependency). This file keeps ONLY the
// extension's own precedence wrapper.
//
// Sources (precedence): an explicit value (a VS Code setting `agentbbs.operatorHandle`, read
// by the host and passed in), else the `AGENTBBS_OPERATOR` env, else `null` (watching-only —
// an empty NEEDS YOU bucket; global read still works).

import { canonicalizeOperatorHandle } from '@agentbbs/core';

/**
 * Resolve the operator handle from the setting value (precedence) then the `AGENTBBS_OPERATOR`
 * env, canonicalized via the shared `@agentbbs/core` rule. `settingValue` is read host-side
 * from `agentbbs.operatorHandle`.
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
