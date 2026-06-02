// Story 10.2, AC1/AC3 — the in-host LEDGER probe (runs INSIDE the real VS Code Electron host).
//
// The Rule-12 real-runtime evidence for AC1 ("the host opens the shared DB via data-access and
// a read returns the real seeded ledger state") + AC3 ("the node:sqlite adapter satisfies the
// DataAccess port in the REAL Electron host"). Unlike the Task-1 GATE probe (dependency-free,
// raw node:sqlite), this exercises the ACTUAL production path: it imports @agentbbs/data-access
// (the node:sqlite-backed adapter the extension host uses) + @agentbbs/core, opens a ledger via
// `createDataAccessNodeSqlite` (AGENTBBS_DB → an isolated temp file the runner provides), seeds
// a project through the real core op, reads it back through `listProjects`, and writes the
// findings to AGENTBBS_PROBE_OUT for the runner to assert out-of-band.
//
// Because it imports workspace packages, it is BUNDLED by host-tests/build-host-tests.cjs
// (esbuild, format:cjs, node:sqlite external) into host-tests/dist/open-ledger.in-host.cjs —
// the file @vscode/test-electron loads as the extensionTestsPath. The Electron host calls its
// exported `run()`.

import { writeFileSync } from 'node:fs';

import { announceProject, listProjects, register } from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';

/**
 * Open the ledger via the data-access node:sqlite adapter IN THE ELECTRON HOST, seed + read a
 * project, and record the result. AGENTBBS_DB is set by the runner to an isolated temp path so
 * the probe never touches a real board. Writes the result JSON before any throw so the runner
 * always has the evidence.
 */
export async function run(): Promise<void> {
  const out = process.env.AGENTBBS_PROBE_OUT;
  const result: {
    opened: boolean;
    electron: string | null;
    modules: string | null;
    projects: unknown[] | null;
    seededProjectFound: boolean;
    error: string | null;
  } = {
    opened: false,
    electron: process.versions.electron || null,
    modules: process.versions.modules || null,
    projects: null,
    seededProjectFound: false,
    error: null,
  };

  let dataAccess: ReturnType<typeof createDataAccessNodeSqlite> | undefined;
  try {
    // Open through the SAME production factory the extension host uses (path from AGENTBBS_DB).
    dataAccess = createDataAccessNodeSqlite();
    result.opened = true;

    // Seed a project through the real core op (proves write works in-host), then read it back.
    await register(dataAccess, {
      handle: 'host-probe',
      currentFocus: 'in-host',
    });
    const project = await announceProject(dataAccess, 'host-probe', {
      title: 'In-Host Probe Project',
      description: 'seeded inside the real VS Code Electron host',
    });

    const projects = await listProjects(dataAccess);
    result.projects = projects;
    result.seededProjectFound = projects.some(
      (p) => p.projectId === project.projectId,
    );
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      dataAccess?.close();
    } catch {
      /* harmless on teardown */
    }
  }

  if (out) {
    writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
  }

  if (!result.opened || !result.seededProjectFound) {
    throw new Error(
      `LEDGER PROBE FAILED in the Electron host — opened=${result.opened} ` +
        `seededProjectFound=${result.seededProjectFound} error=${result.error || 'none'}`,
    );
  }
}
