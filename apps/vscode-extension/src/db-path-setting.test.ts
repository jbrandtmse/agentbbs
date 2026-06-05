// Tests for the in-plugin DB-path resolver (Epic 10 manual-smoke enhancement).
//
// Pins the PRECEDENCE (setting > AGENTBBS_DB env > workspace-folder walk-up) and the setting-value
// EXPANSION (${workspaceFolder} / ~ / relative-against-workspace / absolute). Discoverable by the
// ROOT `pnpm test`. The real workspace-folder behavior in a live extension host is the lead's
// real-host re-smoke (vscode.workspace can't be modelled here) — this pins the pure seam.

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  expandSettingPath,
  resolveExtensionDbPath,
} from './db-path-setting.js';

const WS = resolve('/tmp/ws');
const HOME = resolve('/home/op');
const CWD = resolve('/install/vscode');

describe('resolveExtensionDbPath — precedence', () => {
  it('the setting WINS over env and over the workspace walk-up', () => {
    const out = resolveExtensionDbPath({
      settingValue: '/explicit/board.db',
      env: { AGENTBBS_DB: '/env/board.db' },
      workspaceFolder: WS,
      cwd: CWD,
      home: HOME,
    });
    expect(out).toBe(resolve('/explicit/board.db'));
  });

  it('falls through to AGENTBBS_DB env when the setting is empty', () => {
    const out = resolveExtensionDbPath({
      settingValue: '',
      env: { AGENTBBS_DB: '/env/board.db' },
      workspaceFolder: WS,
      cwd: CWD,
      home: HOME,
    });
    // resolveDbPath returns AGENTBBS_DB verbatim.
    expect(out).toBe('/env/board.db');
  });

  it('whitespace-only setting is treated as empty → env wins', () => {
    const out = resolveExtensionDbPath({
      settingValue: '   ',
      env: { AGENTBBS_DB: '/env/board.db' },
      workspaceFolder: WS,
    });
    expect(out).toBe('/env/board.db');
  });

  it('falls through to the WORKSPACE-folder walk-up when neither setting nor env is set', () => {
    // WS has no markers above the stopless walk; resolveDbPath falls back to startDir/.agentbbs/.
    const out = resolveExtensionDbPath({
      settingValue: undefined,
      env: {},
      workspaceFolder: WS,
      cwd: CWD,
      home: HOME,
    });
    // The walk-up STARTS at the workspace folder (NOT cwd) — the core reliability fix.
    expect(out.startsWith(WS)).toBe(true);
    expect(out).not.toContain(CWD);
    expect(
      out.endsWith(resolve(WS, '.agentbbs', 'agentbbs.db').slice(WS.length)),
    ).toBe(true);
  });

  it('no-workspace falls back to CWD as the walk-up origin', () => {
    const out = resolveExtensionDbPath({
      settingValue: undefined,
      env: {},
      workspaceFolder: undefined,
      cwd: CWD,
      home: HOME,
    });
    expect(out.startsWith(CWD)).toBe(true);
  });
});

describe('expandSettingPath — token / ~ / relative expansion', () => {
  const opts = { workspaceFolder: WS, cwd: CWD, home: HOME };

  it('${workspaceFolder} alone expands to the workspace folder', () => {
    expect(expandSettingPath('${workspaceFolder}', opts)).toBe(WS);
  });

  it('${workspaceFolder}/sub/board.db resolves under the workspace folder', () => {
    expect(
      expandSettingPath('${workspaceFolder}/.agentbbs/board.db', opts),
    ).toBe(resolve(WS, '.agentbbs', 'board.db'));
  });

  it('a leading ~ expands to the home dir', () => {
    expect(expandSettingPath('~/boards/team.db', opts)).toBe(
      resolve(HOME, 'boards', 'team.db'),
    );
    expect(expandSettingPath('~', opts)).toBe(HOME);
  });

  it('a RELATIVE path resolves against the workspace folder', () => {
    expect(expandSettingPath('.agentbbs/board.db', opts)).toBe(
      resolve(WS, '.agentbbs', 'board.db'),
    );
  });

  it('a RELATIVE path resolves against CWD when no workspace folder', () => {
    expect(
      expandSettingPath('.agentbbs/board.db', {
        workspaceFolder: undefined,
        cwd: CWD,
        home: HOME,
      }),
    ).toBe(resolve(CWD, '.agentbbs', 'board.db'));
  });

  it('an ABSOLUTE path is used verbatim (normalized)', () => {
    expect(expandSettingPath('/var/data/board.db', opts)).toBe(
      resolve('/var/data/board.db'),
    );
  });
});

// Rule 7 mutation guard NOTE: these precedence tests are non-vacuous — flipping the precedence
// order in resolveExtensionDbPath (e.g. checking env before the setting) makes
// "the setting WINS over env" RED (it would return /env/board.db, not /explicit/board.db);
// removing the `workspaceFolder ?? cwd` start-dir makes "walk-up STARTS at the workspace folder"
// RED (it would walk from cwd). Verified by the dev (see Manual-smoke enhancement notes).
describe('resolveExtensionDbPath — non-vacuous precedence sentinel', () => {
  it('returns DISTINCT results for setting vs env vs walk-up given the same inputs', () => {
    const base = {
      env: { AGENTBBS_DB: '/env/board.db' },
      workspaceFolder: WS,
      cwd: CWD,
      home: HOME,
    };
    const viaSetting = resolveExtensionDbPath({
      ...base,
      settingValue: '/explicit/board.db',
    });
    const viaEnv = resolveExtensionDbPath({ ...base, settingValue: '' });
    const viaWalkUp = resolveExtensionDbPath({
      ...base,
      env: {},
      settingValue: '',
    });
    expect(new Set([viaSetting, viaEnv, viaWalkUp]).size).toBe(3);
  });
});
