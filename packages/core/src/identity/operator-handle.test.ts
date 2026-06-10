// Shared operator-handle canonicalization tests (Story 13.5) — pins the ONE rule both
// operator surfaces import (trim + lowercase → null on empty). Byte-identical to the behavior
// the web host (`@agentbbs/cli`) and the VS Code extension previously duplicated locally
// (Story 10.3). Mutation-tested non-vacuous (Rule 7): break the trim or the null-on-empty and
// these go RED. Discoverable by ROOT `pnpm test`.

import { describe, expect, it } from 'vitest';

import { canonicalizeOperatorHandle } from './operator-handle.js';

describe('canonicalizeOperatorHandle (shared operator-handle rule)', () => {
  it('lowercases + trims to the ledger form', () => {
    expect(canonicalizeOperatorHandle('  Alice ')).toBe('alice');
    expect(canonicalizeOperatorHandle('BOB')).toBe('bob');
    expect(canonicalizeOperatorHandle('OPERATOR')).toBe('operator');
  });

  it('passes an already-canonical handle through unchanged', () => {
    expect(canonicalizeOperatorHandle('alice')).toBe('alice');
  });

  it('treats empty / whitespace-only / undefined / null as watching-only (null)', () => {
    expect(canonicalizeOperatorHandle('')).toBeNull();
    expect(canonicalizeOperatorHandle('   ')).toBeNull();
    expect(canonicalizeOperatorHandle(undefined)).toBeNull();
    expect(canonicalizeOperatorHandle(null)).toBeNull();
  });
});

// QA equivalence matrix (Story 13.5) — the DOCUMENTED pre-refactor operator-handle behavior
// spec, the single source of truth both surface wrappers must reproduce byte-identically.
// Both the cli wrapper (`packages/cli/src/ui.test.ts`) and the extension wrapper
// (`apps/vscode-extension/src/tree/operator-handle.test.ts`) assert their delegating wrapper
// against THIS SAME table so any drift between the surfaces would surface as a red test on at
// least one side. The eslint leaf-app/no-client-from-core boundary forbids importing all three
// wrappers into one file, so the canonical table is duplicated as a behavior SPEC (not a shared
// symbol) in each surface's discoverable test; keep the three copies identical.
//
// Marquee risk for this pure refactor = BEHAVIORAL DRIFT. The matrix exercises the edges the
// canonical-cases test above does not: tab/newline/mixed whitespace (must be trimmed), and
// INTERNAL whitespace (must be PRESERVED — trim only strips the ends; the canonicalize does
// NOT collapse or strip interior spaces).
export const OPERATOR_HANDLE_EQUIVALENCE_MATRIX: ReadonlyArray<
  readonly [input: string | undefined | null, expected: string | null]
> = [
  // canonical happy path
  ['alice', 'alice'], // already-canonical passthrough
  ['BOB', 'bob'], // mixed/upper → lowercased
  ['  Alice ', 'alice'], // leading + trailing space trimmed, lowercased
  ['\tAlice\n', 'alice'], // tab + newline whitespace trimmed
  [' \t \n MixedCase \r\n ', 'mixedcase'], // assorted whitespace trimmed, lowercased
  // internal whitespace is PRESERVED (core canonicalize does NOT strip/collapse interior)
  ['  Two Words  ', 'two words'],
  ['a\tb', 'a\tb'],
  // watching-only (null)
  ['', null], // empty
  ['   ', null], // spaces-only
  ['\t\n\r ', null], // mixed-whitespace-only
  [undefined, null], // undefined
  [null, null], // null
] as const;

describe('canonicalizeOperatorHandle — pre-refactor equivalence matrix (single source of truth)', () => {
  it.each(OPERATOR_HANDLE_EQUIVALENCE_MATRIX)(
    'canonicalize(%o) === %o',
    (input, expected) => {
      expect(canonicalizeOperatorHandle(input)).toBe(expected);
    },
  );

  it('preserves internal whitespace (trims ends only, no interior collapse)', () => {
    expect(canonicalizeOperatorHandle('  Two   Words  ')).toBe('two   words');
  });
});
