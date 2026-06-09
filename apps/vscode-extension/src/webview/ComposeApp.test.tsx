// DOM render test for the VS Code webview ComposeApp (Story 10.7, AC2/AC3).
//
// Runs in the happy-dom project (a cross-package DOM consumer of ui-shared — the compose webview
// mounts the SAME 4 INITIATE compose components the web does, BYTE-SHARED, Rule 13). A FAKE Bridge
// stands in for the host↔webview postMessage channel; it records the write op + args (the bridge
// dispatch itself is proven host-side in bridge.test.ts + the real Electron host). This is the
// Rule-12 NECESSARY-NOT-SUFFICIENT DOM tier; the load-bearing real-runtime proof is
// host-tests/compose-panel.in-host.ts (the panel opens, each write lands in the ledger, a posted
// announcement is navigable).
//
// COVERED:
//   - each of the 4 surfaces MOUNTS its ui-shared component (create-project / post-announcement /
//     join-project / focus) — byte-shared, not forked;
//   - a submit calls the RIGHT bridge op with the operator as actor (announceProject /
//     postAnnouncement / joinBoard / updateFocus);
//   - the watching-only gate is CONSISTENT across all 4 (focus disabled inert; create/post show the
//     calm host-surface line) — the 9.14 lesson;
//   - the post-announcement NOT_A_MEMBER → join-first handoff (never silent);
//   - NEVER a modal (the 9.10 invariant — no dialog/alert role).

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { ComposeApp, type ComposeKind } from './ComposeApp.js';

import type { Bridge } from './bridge-client.js';
import type { Root } from 'react-dom/client';

/** A recording fake bridge — captures each request + lets a test script a rejection per op. */
function recordingBridge(
  scripts: Partial<
    Record<string, (args: Record<string, unknown>) => unknown>
  > = {},
): Bridge & { calls: Array<{ op: string; args: Record<string, unknown> }> } {
  const calls: Array<{ op: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    request<T = unknown>(
      op: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      calls.push({ op, args });
      const script = scripts[op];
      if (script !== undefined) {
        try {
          return Promise.resolve(script(args) as T);
        } catch (err) {
          return Promise.reject(err);
        }
      }
      // Sensible defaults for the reads + writes used by the surfaces.
      switch (op) {
        case 'listProjects':
          return Promise.resolve({ projects: [] } as T);
        case 'boardDirectory':
          return Promise.resolve({ members: [] } as T);
        case 'whoami':
          return Promise.resolve({
            handle: (args['actor'] as string) ?? null,
            focus: null,
            registered: true,
          } as T);
        case 'announceProject':
          return Promise.resolve({
            project: { projectId: 'new-project' },
          } as T);
        case 'postAnnouncement':
          return Promise.resolve({ room: { roomId: 'new-room' } } as T);
        case 'joinBoard':
          return Promise.resolve({ project: { projectId: 'joined' } } as T);
        case 'updateFocus':
          return Promise.resolve({
            handle: args['actor'],
            focus: args['focus'],
          } as T);
        default:
          return Promise.reject(new Error(`unexpected op "${op}"`));
      }
    },
  };
}

/** A `BridgeClientError`-shaped rejection (the host's uniform `{ code, message }`). */
function bridgeError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

let container: HTMLElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(props: {
  bridge: Bridge;
  kind: ComposeKind;
  operatorHandle: string | null;
  projectId?: string | null;
  onSuccess?: (p?: { roomId?: string; projectId?: string }) => void;
  onClose?: () => void;
}): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ComposeApp {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function click(testid: string): void {
  const el = container.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (el === null) throw new Error(`no element [data-testid="${testid}"]`);
  act(() => el.click());
}

function fill(testid: string, value: string): void {
  const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-testid="${testid}"]`,
  );
  if (el === null) throw new Error(`no field [data-testid="${testid}"]`);
  const proto =
    el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ComposeApp — mounts the byte-shared compose surfaces fed by the bridge (AC2)', () => {
  it('create-project mounts CreateProjectCompose and submits announceProject with the operator actor', async () => {
    const bridge = recordingBridge();
    let succeeded: { projectId?: string } | undefined = undefined;
    await mount({
      bridge,
      kind: 'create-project',
      operatorHandle: 'operator',
      onSuccess: (p) => {
        succeeded = p;
      },
    });
    expect(
      container.querySelector('[data-testid="create-project-compose"]'),
    ).not.toBeNull();
    fill('create-project-title', 'My Project');
    fill('create-project-description', 'a real project');
    click('create-project-submit');
    await act(async () => {
      await Promise.resolve();
    });
    const call = bridge.calls.find((c) => c.op === 'announceProject');
    expect(call).toBeDefined();
    expect(call?.args).toMatchObject({
      actor: 'operator',
      title: 'My Project',
      description: 'a real project',
    });
    expect(succeeded).toMatchObject({ projectId: 'new-project' });
  });

  it('join-project mounts JoinProjectPicker and joinBoard fires on a choose', async () => {
    const bridge = recordingBridge({
      listProjects: () => ({
        projects: [{ projectId: 'acme', title: 'Acme' }],
      }),
      boardDirectory: () => ({ members: [] }), // operator is not a member → joinable
    });
    await mount({ bridge, kind: 'join-project', operatorHandle: 'operator' });
    expect(
      container.querySelector('[data-testid="join-project-picker"]'),
    ).not.toBeNull();
    // The joinable list resolved from the bridge reads.
    const choice = container.querySelector<HTMLElement>(
      '[data-testid="join-project-choice"]',
    );
    expect(choice).not.toBeNull();
    act(() => choice!.click());
    await act(async () => {
      await Promise.resolve();
    });
    const call = bridge.calls.find((c) => c.op === 'joinBoard');
    expect(call?.args).toMatchObject({ actor: 'operator', projectId: 'acme' });
  });

  it('focus mounts FocusAffordance and updateFocus fires with the trimmed focus', async () => {
    const bridge = recordingBridge();
    await mount({ bridge, kind: 'focus', operatorHandle: 'operator' });
    expect(
      container.querySelector('[data-testid="focus-affordance"]'),
    ).not.toBeNull();
    // Open the editor, type, submit.
    click('focus-edit');
    await act(async () => {
      await Promise.resolve();
    });
    fill('focus-field', 'reviewing the bridge');
    click('focus-submit');
    await act(async () => {
      await Promise.resolve();
    });
    const call = bridge.calls.find((c) => c.op === 'updateFocus');
    expect(call?.args).toMatchObject({
      actor: 'operator',
      focus: 'reviewing the bridge',
    });
  });

  it('post-announcement mounts PostAnnouncementCompose and submits postAnnouncement scoped to the project', async () => {
    const bridge = recordingBridge();
    let succeeded: { roomId?: string } | undefined = undefined;
    await mount({
      bridge,
      kind: 'post-announcement',
      operatorHandle: 'operator',
      projectId: 'acme',
      onSuccess: (p) => {
        succeeded = p;
      },
    });
    expect(
      container.querySelector('[data-testid="post-announcement-compose"]'),
    ).not.toBeNull();
    fill('post-announcement-subject', 'Need a hand');
    fill('post-announcement-body', 'who can take this?');
    click('post-announcement-submit');
    await act(async () => {
      await Promise.resolve();
    });
    const call = bridge.calls.find((c) => c.op === 'postAnnouncement');
    expect(call?.args).toMatchObject({
      actor: 'operator',
      projectId: 'acme',
      subject: 'Need a hand',
      body: 'who can take this?',
    });
    // AC3 — success surfaces the new room id (the initiate→respond loop handoff payload).
    expect(succeeded).toMatchObject({ roomId: 'new-room' });
  });

  it('post-announcement NOT_A_MEMBER flips to the calm join-first CTA (never silent)', async () => {
    const bridge = recordingBridge({
      postAnnouncement: () => {
        throw bridgeError('NOT_A_MEMBER', 'join the project first');
      },
    });
    await mount({
      bridge,
      kind: 'post-announcement',
      operatorHandle: 'operator',
      projectId: 'acme',
    });
    fill('post-announcement-subject', 's');
    fill('post-announcement-body', 'b');
    click('post-announcement-submit');
    await act(async () => {
      await Promise.resolve();
    });
    // The join-first CTA appears (not a silent failure).
    expect(
      container.querySelector('[data-testid="post-announcement-join-first"]'),
    ).not.toBeNull();
    // Clicking it runs joinBoard (the SAME op an agent uses).
    click('post-announcement-join-first');
    await act(async () => {
      await Promise.resolve();
    });
    expect(bridge.calls.some((c) => c.op === 'joinBoard')).toBe(true);
  });
});

describe('ComposeApp — JoinProjectPicker joinable filter seam (QA value-add, AC2)', () => {
  // QA value-add (Story 10.7 candidate a/e). The dev's join-project test uses members:[] so the
  // operator is NEVER a member — it proves the picker renders + joinBoard fires, but it does NOT
  // exercise the LOAD-BEARING filter: joinable = the global-read directory MINUS the projects the
  // operator already belongs to (canonical-handle compare, mirroring the web's handleJoinProject).
  // A mutation that drops the exclude-already-member filter (push every project) would pass the
  // dev's test but FAIL this one — so it is discriminating (Rule 7).

  it('EXCLUDES projects the operator already belongs to (canonical-handle compare)', async () => {
    const bridge = recordingBridge({
      listProjects: () => ({
        projects: [
          { projectId: 'joinable-one', title: 'Joinable One' },
          { projectId: 'already-in', title: 'Already In' },
          { projectId: 'joinable-two', title: 'Joinable Two' },
        ],
      }),
      // The operator (canonical 'operator') is a MEMBER of `already-in` only — note the directory
      // returns the handle in MIXED CASE to prove the compare is canonical (case-insensitive).
      boardDirectory: (args) =>
        args['projectId'] === 'already-in'
          ? { members: [{ handle: 'Operator' }] }
          : { members: [{ handle: 'someone-else' }] },
    });
    await mount({ bridge, kind: 'join-project', operatorHandle: 'operator' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const choices = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-testid="join-project-choice"]',
      ),
    ).map((el) => el.getAttribute('data-project-id'));
    // The two joinable projects are offered; the already-joined one is EXCLUDED.
    expect(choices).toContain('joinable-one');
    expect(choices).toContain('joinable-two');
    expect(choices).not.toContain('already-in');
  });

  it('shows the calm "no projects to join" empty state when the operator already belongs to all (NOT an error)', async () => {
    const bridge = recordingBridge({
      listProjects: () => ({
        projects: [{ projectId: 'only-one', title: 'Only One' }],
      }),
      boardDirectory: () => ({ members: [{ handle: 'operator' }] }), // operator is a member
    });
    await mount({ bridge, kind: 'join-project', operatorHandle: 'operator' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      container.querySelector('[data-testid="join-project-empty"]'),
    ).not.toBeNull();
    // The empty state is NOT surfaced as an error (calm chrome — the operator simply belongs to all).
    expect(
      container.querySelector('[data-testid="join-project-error"]'),
    ).toBeNull();
    // No phantom choices.
    expect(
      container.querySelector('[data-testid="join-project-choice"]'),
    ).toBeNull();
  });
});

describe('ComposeApp — watching-only/unregistered gate is CONSISTENT across all 4 (AC3, 9.14 lesson)', () => {
  it('focus is DISABLED inert with a calm reason for a watching-only operator (no edit control)', async () => {
    const bridge = recordingBridge();
    await mount({ bridge, kind: 'focus', operatorHandle: null });
    // Disabled: no [ edit ] control, a terse reason line — never a crash, never a modal.
    expect(container.querySelector('[data-testid="focus-edit"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="focus-disabled-reason"]'),
    ).not.toBeNull();
  });

  it('focus is DISABLED for a registered=false operator (unregistered handle)', async () => {
    const bridge = recordingBridge({
      whoami: (args) => ({
        handle: args['actor'],
        focus: null,
        registered: false,
      }),
    });
    await mount({ bridge, kind: 'focus', operatorHandle: 'ghost' });
    expect(container.querySelector('[data-testid="focus-edit"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="focus-disabled-reason"]'),
    ).not.toBeNull();
  });

  it('create-project shows the calm watching-only line (the gate) instead of crashing', async () => {
    const bridge = recordingBridge();
    await mount({ bridge, kind: 'create-project', operatorHandle: null });
    const errorEl = container.querySelector(
      '[data-testid="create-project-error"]',
    );
    expect(errorEl?.textContent ?? '').toMatch(/watching-only/);
  });

  it('NO surface renders a modal/dialog (the 9.10 calm-chrome invariant)', async () => {
    for (const kind of [
      'create-project',
      'post-announcement',
      'join-project',
      'focus',
    ] as ComposeKind[]) {
      const bridge = recordingBridge();
      await mount({
        bridge,
        kind,
        operatorHandle: 'operator',
        projectId: 'acme',
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(container.querySelector('dialog')).toBeNull();
      act(() => root.unmount());
      container.remove();
    }
    // Re-establish a container so the shared afterEach unmount is a harmless no-op.
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
});
