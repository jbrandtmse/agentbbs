// operator-handle resolution tests (Story 10.3) — the SAME canonicalization the web host uses
// (lowercased + trimmed; setting > AGENTBBS_OPERATOR > null). Discoverable by ROOT `pnpm test`.
//
// As of Story 13.5 `canonicalizeOperatorHandle` is the SHARED `@agentbbs/core` rule (no longer
// duplicated locally); this file's precedence wrapper `resolveOperatorHandle` delegates to it.
// The canonicalize cases below cover the extension's import of the shared rule; the rule itself
// is also pinned in `packages/core/src/identity/operator-handle.test.ts`.

import { canonicalizeOperatorHandle } from '@agentbbs/core';
import { describe, expect, it } from 'vitest';

import { resolveOperatorHandle } from './operator-handle.js';

describe('canonicalizeOperatorHandle', () => {
  it('lowercases + trims (the ledger form)', () => {
    expect(canonicalizeOperatorHandle('  Alice  ')).toBe('alice');
    expect(canonicalizeOperatorHandle('OPERATOR')).toBe('operator');
  });

  it('treats blank/undefined/null as watching-only (null)', () => {
    expect(canonicalizeOperatorHandle(undefined)).toBeNull();
    expect(canonicalizeOperatorHandle(null)).toBeNull();
    expect(canonicalizeOperatorHandle('')).toBeNull();
    expect(canonicalizeOperatorHandle('   ')).toBeNull();
  });
});

describe('resolveOperatorHandle — precedence', () => {
  it('the setting wins when present', () => {
    expect(resolveOperatorHandle('Alice', { AGENTBBS_OPERATOR: 'bob' })).toBe(
      'alice',
    );
  });

  it('falls back to AGENTBBS_OPERATOR when the setting is blank', () => {
    expect(resolveOperatorHandle('', { AGENTBBS_OPERATOR: 'Bob' })).toBe('bob');
    expect(resolveOperatorHandle(undefined, { AGENTBBS_OPERATOR: 'Bob' })).toBe(
      'bob',
    );
  });

  it('null (watching-only) when neither is set', () => {
    expect(resolveOperatorHandle(undefined, {})).toBeNull();
    expect(resolveOperatorHandle('  ', {})).toBeNull();
  });
});

// QA equivalence matrix (Story 13.5) — the extension's canonicalize import reproduces the
// DOCUMENTED pre-refactor operator-handle behavior across the canonical + edge cases, so the
// refactor introduced no drift on the VS Code side. Same behavior spec pinned in
// `packages/core/src/identity/operator-handle.test.ts` (OPERATOR_HANDLE_EQUIVALENCE_MATRIX) and
// the cli's `ui.test.ts` — duplicated as a SPEC, not imported, because the eslint leaf-app
// boundary forbids one file importing all three wrappers. Keep the copies identical.
const EXT_OPERATOR_HANDLE_MATRIX: ReadonlyArray<
  readonly [input: string | undefined | null, expected: string | null]
> = [
  ['alice', 'alice'], // already-canonical passthrough
  ['BOB', 'bob'], // mixed/upper → lowercased
  ['  Alice ', 'alice'], // leading + trailing space trimmed, lowercased
  ['\tAlice\n', 'alice'], // tab + newline whitespace trimmed
  [' \t \n MixedCase \r\n ', 'mixedcase'], // assorted whitespace trimmed, lowercased
  ['  Two Words  ', 'two words'], // internal whitespace PRESERVED
  ['a\tb', 'a\tb'], // internal tab preserved
  ['', null], // empty
  ['   ', null], // spaces-only
  ['\t\n\r ', null], // mixed-whitespace-only
  [undefined, null], // undefined
  [null, null], // null
];

describe('canonicalizeOperatorHandle — pre-refactor equivalence matrix (extension surface)', () => {
  it.each(EXT_OPERATOR_HANDLE_MATRIX)(
    'canonicalize(%o) === %o',
    (input, expected) => {
      expect(canonicalizeOperatorHandle(input)).toBe(expected);
    },
  );

  it('preserves internal whitespace (trims ends only)', () => {
    expect(canonicalizeOperatorHandle('  Two   Words  ')).toBe('two   words');
  });
});

// QA precedence edges (Story 13.5) — the extension's `resolveOperatorHandle(setting, env)`
// wrapper delegates canonicalization to the shared rule but owns the setting → env precedence.
// Confirm a NON-empty-but-whitespace setting (tab/newline, not just spaces) canonicalizes to
// null and so falls THROUGH to AGENTBBS_OPERATOR, and that the env value is itself canonicalized.
describe('resolveOperatorHandle — precedence edges (extension surface)', () => {
  it('a tab/newline-only setting falls through to AGENTBBS_OPERATOR', () => {
    expect(
      resolveOperatorHandle('\t\n', { AGENTBBS_OPERATOR: '  Bob  ' }),
    ).toBe('bob');
  });

  it('canonicalizes the env value when the setting is absent', () => {
    expect(
      resolveOperatorHandle(undefined, { AGENTBBS_OPERATOR: 'OPS ' }),
    ).toBe('ops');
  });

  it('a whitespace-only env (after a blank setting) is watching-only (null)', () => {
    expect(resolveOperatorHandle('', { AGENTBBS_OPERATOR: '   ' })).toBeNull();
  });

  it('the setting wins even when both would canonicalize to a value', () => {
    expect(
      resolveOperatorHandle('  Alice ', { AGENTBBS_OPERATOR: 'bob' }),
    ).toBe('alice');
  });
});
