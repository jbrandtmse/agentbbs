// operator-handle resolution tests (Story 10.3) — the SAME canonicalization the web host uses
// (lowercased + trimmed; setting > AGENTBBS_OPERATOR > null). Discoverable by ROOT `pnpm test`.

import { describe, expect, it } from 'vitest';

import {
  canonicalizeOperatorHandle,
  resolveOperatorHandle,
} from './operator-handle.js';

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
