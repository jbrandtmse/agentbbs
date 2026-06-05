// Cross-process registration race for the node:sqlite adapter (Story 10.2, AC3 / Rule 5) —
// THE FR1 ATOMIC PROOF for the SECOND NFR2 driver. N independent OS PROCESSES each attempt to
// `register` the SAME handle against ONE shared node:sqlite ledger, simultaneously. The
// regressable guarantee: EXACTLY ONE wins (one identity.registered), every other gets
// HANDLE_TAKEN — proving the node:sqlite adapter's `appendGuarded` check-then-insert is atomic
// across PROCESSES (the BEGIN IMMEDIATE transaction serializes writers, the same SQLite
// property the better-sqlite3 path relies on; Rule 5 requires a genuine forked race, not a
// sequential test, to prove a concurrency-claiming guarantee).
//
// Mirrors register-race.test.ts exactly, but forks the node:sqlite worker
// (dist/node-sqlite-register-race-worker.js). Why real processes (not worker_threads): see
// the worker header — only separate OS processes exercise cross-process WAL locking.
//
// Build dependency (Rule 8): the test forks a BUILT artifact. beforeAll rebuilds
// @agentbbs/data-access if the worker dist is missing/older than its source (same
// BUILD-IF-MISSING/STALE structure as register-race.test.ts). Named `*.test.ts`, co-located,
// in the default Vitest project; the `*-worker.ts` is NOT matched by the test glob.
//
// Hygiene: every DB lives under os.tmpdir(); the temp tree + spawned children are
// removed/killed in finally/afterEach — no orphans even on failure.

import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDataAccessNodeSqlite } from './node-sqlite/data-access-node-sqlite.js';

import type { NodeSqliteRaceWorkerResult } from './node-sqlite-register-race-worker.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../data-access/src
const PACKAGE_ROOT = resolve(HERE, '..'); // .../data-access
const WORKER_SRC = join(HERE, 'node-sqlite-register-race-worker.ts');
const WORKER_DIST = join(
  PACKAGE_ROOT,
  'dist',
  'node-sqlite-register-race-worker.js',
);

const N_WORKERS = 8;
const CONTESTED_HANDLE = 'contested-handle';
const TEST_TIMEOUT_MS = 60_000;

const liveChildren = new Set<ChildProcess>();

function forkWorker(
  args: { dbPath: string; workerId: number; handle: string },
  onReady: (child: ChildProcess) => void,
): Promise<NodeSqliteRaceWorkerResult> {
  return new Promise<NodeSqliteRaceWorkerResult>(
    (resolvePromise, rejectPromise) => {
      const child = fork(
        WORKER_DIST,
        [args.dbPath, String(args.workerId), args.handle],
        { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
      );
      liveChildren.add(child);

      let result: NodeSqliteRaceWorkerResult | undefined;
      let settled = false;

      child.on('message', (msg: unknown) => {
        if (typeof msg !== 'object' || msg === null) return;
        const tag = (msg as { type?: unknown }).type;
        if (tag === 'ready') {
          onReady(child);
        } else if (tag === 'done') {
          result = msg as NodeSqliteRaceWorkerResult;
        }
      });

      child.once('error', (err) => {
        liveChildren.delete(child);
        if (!settled) {
          settled = true;
          rejectPromise(err);
        }
      });

      child.once('exit', (code, signal) => {
        liveChildren.delete(child);
        if (settled) return;
        settled = true;
        if (code === 0 && result) {
          resolvePromise(result);
        } else {
          rejectPromise(
            new Error(
              `worker ${args.workerId} exited code=${String(code)} signal=${String(
                signal,
              )} resultReceived=${String(Boolean(result))}`,
            ),
          );
        }
      });
    },
  );
}

function reapChildren(): void {
  for (const child of liveChildren) {
    if (!child.killed) child.kill('SIGKILL');
  }
  liveChildren.clear();
}

function removeTempTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}

async function runRace(
  dbPath: string,
): Promise<{ results: NodeSqliteRaceWorkerResult[]; registeredCount: number }> {
  // Pre-create + migrate the shared ledger once (avoids a concurrent-migrate herd).
  const seed = createDataAccessNodeSqlite({ dbPath });
  seed.close();

  const readyChildren: ChildProcess[] = [];
  let resolveAllReady: () => void;
  const allReady = new Promise<void>((r) => {
    resolveAllReady = r;
  });
  const onReady = (child: ChildProcess): void => {
    readyChildren.push(child);
    if (readyChildren.length === N_WORKERS) resolveAllReady();
  };

  const workerPromises: Promise<NodeSqliteRaceWorkerResult>[] = [];
  for (let id = 0; id < N_WORKERS; id++) {
    workerPromises.push(
      forkWorker({ dbPath, workerId: id, handle: CONTESTED_HANDLE }, onReady),
    );
  }

  await Promise.race([allReady, Promise.all(workerPromises)]);
  for (const child of readyChildren) child.send({ type: 'go' });

  const results = await Promise.all(workerPromises);

  const reader = createDataAccessNodeSqlite({ dbPath });
  try {
    const events = await reader.eventsByType('identity.registered');
    const registeredCount = events.filter(
      (e) => e.actor === CONTESTED_HANDLE,
    ).length;
    return { results, registeredCount };
  } finally {
    reader.close();
  }
}

beforeAll(() => {
  const needsBuild =
    !existsSync(WORKER_DIST) ||
    statSync(WORKER_DIST).mtimeMs < statSync(WORKER_SRC).mtimeMs;
  if (needsBuild) {
    const tscBin = resolve(
      PACKAGE_ROOT,
      '..',
      '..',
      'node_modules',
      'typescript',
      'bin',
      'tsc',
    );
    execFileSync(process.execPath, [tscBin, '-b', '--force', 'tsconfig.json'], {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
    });
  }
  expect(existsSync(WORKER_DIST)).toBe(true);
}, TEST_TIMEOUT_MS);

afterEach(() => {
  reapChildren();
});

describe('node:sqlite adapter — cross-process registration race (AC3 / FR1 atomic uniqueness across processes)', () => {
  it(
    'N processes registering the SAME handle → EXACTLY ONE wins, the rest get HANDLE_TAKEN, ledger holds exactly one event',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-node-sqlite-race-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        const { results, registeredCount } = await runRace(dbPath);

        for (const r of results) {
          expect(r.won || r.handleTaken).toBe(true);
          expect(r.won && r.handleTaken).toBe(false);
        }

        const winners = results.filter((r) => r.won);
        const losers = results.filter((r) => r.handleTaken);

        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(N_WORKERS - 1);

        // The node:sqlite atomic guard prevented every concurrent duplicate (the core claim).
        expect(registeredCount).toBe(1);

        expect(typeof winners[0]?.createdAt).toBe('string');
        expect(new Date(winners[0]!.createdAt as string).toISOString()).toBe(
          winners[0]!.createdAt,
        );
      } finally {
        reapChildren();
        removeTempTree(dir);
      }
    },
  );
});
