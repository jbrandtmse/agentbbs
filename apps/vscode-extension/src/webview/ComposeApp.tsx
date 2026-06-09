// ComposeApp — the webview React root that mounts ONE of the 4 byte-shared @agentbbs/ui-shared
// INITIATE compose surfaces (Story 10.7, AC2) and wires its write through the postMessage BRIDGE.
//
// THE VS CODE ANALOGUE of apps/web/src/App.tsx's compose wiring (handleCreateProject /
// handlePostAnnouncement / handleJoinProject+handleChooseJoin / handleSetFocus): the web client runs
// the writes over the HTTP JSON API; this runs them over the host↔webview postMessage bridge
// (src/bridge.ts → the SAME core ops an agent uses; Rule 13 — no fabricated op, no backdoor). The
// component is BYTE-SHARED with the web (it MOUNTS CreateProjectCompose/PostAnnouncementCompose/
// JoinProjectPicker/FocusAffordance, never forks them) and lives here (not in compose-main.tsx) so it
// is DOM-testable without the acquireVsCodeApi mount side effect — exactly the RoomApp.tsx discipline.
//
// PROP-DRIVEN (NFR2 / Rule 13): the only host dependency is the injectable {@link Bridge} (request →
// core op). No @agentbbs/core / @agentbbs/data-access import; no DOM/acquireVsCodeApi here. The
// surface owns: the in-flight `pending` + the calm inline `error` (NEVER a modal — the 9.10
// invariant), the join-first handoff on NOT_A_MEMBER (post-announcement), the joinable filter
// (directory MINUS the operator's memberships, canonical-handle compare), and the watching-only gate
// (a watching-only/unregistered operator sees the calm disabled/gate state, consistent across all 4).

import { useCallback, useEffect, useState } from 'react';

import {
  CreateProjectCompose,
  FocusAffordance,
  JoinProjectPicker,
  PostAnnouncementCompose,
  type JoinableProject,
} from '@agentbbs/ui-shared';

import type { Bridge } from './bridge-client.js';

/** The 4 INITIATE compose surfaces this root can mount (the `data-compose-kind` values). */
export type ComposeKind =
  | 'create-project'
  | 'post-announcement'
  | 'join-project'
  | 'focus';

/** Props for {@link ComposeApp}. */
export interface ComposeAppProps {
  /** The transport seam (request → core op over the bridge). Injectable for DOM tests. */
  bridge: Bridge;
  /** Which of the 4 surfaces to mount. */
  kind: ComposeKind;
  /** The resolved operator handle, or `null` (watching-only). The INITIATE actor + gate driver. */
  operatorHandle: string | null;
  /** The project scope for `post-announcement` (the target sub-board). `null` for the others. */
  projectId?: string | null;
  /**
   * Fired after a SUCCESSFUL write so the host can refresh the tree + (for post-announcement) the
   * surface can hand off to the navigable proto-room (the initiate→respond loop, AC3). The host
   * wires this to a tree refresh; the optional payload carries the created room/project id.
   */
  onSuccess?: (payload?: { roomId?: string; projectId?: string }) => void;
  /** Fired when the operator dismisses the surface (cancel / Esc) — the host closes the panel. */
  onClose?: () => void;
}

/** A `BridgeClientError`-shaped rejection (the host's uniform `{ code, message }`). */
function errorOf(err: unknown): { code: string; message: string } {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  ) {
    return {
      code: (err as { code: string }).code,
      message:
        err instanceof Error
          ? err.message
          : String((err as { message?: unknown }).message ?? ''),
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message:
      err instanceof Error ? err.message : 'The action could not be completed.',
  };
}

/** The watching-only / unregistered gate reason rendered calmly (consistent across all 4 surfaces). */
function gateReason(operatorHandle: string | null): string | null {
  if (operatorHandle === null) {
    return 'watching-only — set `agentbbs.operatorHandle` (or `AGENTBBS_OPERATOR`) to act.';
  }
  return null;
}

/**
 * Mount the requested INITIATE compose surface, wired to the bridge. Each surface runs its write
 * over the SAME core op an agent uses; pending/error drive the calm inline state; success fires
 * `onSuccess` (the host refreshes the tree / hands off to the navigable proto-room). A watching-only
 * operator gets the calm gate (disabled focus / the host-surface NO_OPERATOR line on the others) —
 * never a crash, never a modal.
 */
export function ComposeApp({
  bridge,
  kind,
  operatorHandle,
  projectId = null,
  onSuccess,
  onClose,
}: ComposeAppProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchingOnly = operatorHandle === null;
  const reason = gateReason(operatorHandle);

  switch (kind) {
    case 'create-project':
      return (
        <CreateProjectComposeSurface
          bridge={bridge}
          actor={operatorHandle}
          watchingOnly={watchingOnly}
          reason={reason}
          pending={pending}
          setPending={setPending}
          error={error}
          setError={setError}
          onSuccess={onSuccess}
          onClose={onClose}
        />
      );
    case 'post-announcement':
      return (
        <PostAnnouncementComposeSurface
          bridge={bridge}
          actor={operatorHandle}
          projectId={projectId}
          watchingOnly={watchingOnly}
          reason={reason}
          pending={pending}
          setPending={setPending}
          error={error}
          setError={setError}
          onSuccess={onSuccess}
          onClose={onClose}
        />
      );
    case 'join-project':
      return (
        <JoinProjectPickerSurface
          bridge={bridge}
          actor={operatorHandle}
          pending={pending}
          setPending={setPending}
          error={error}
          setError={setError}
          onSuccess={onSuccess}
          onClose={onClose}
        />
      );
    case 'focus':
      return (
        <FocusAffordanceSurface
          bridge={bridge}
          actor={operatorHandle}
          watchingOnly={watchingOnly}
          reason={reason}
          pending={pending}
          setPending={setPending}
          error={error}
          setError={setError}
          onSuccess={onSuccess}
          onClose={onClose}
        />
      );
  }
}

/** Shared internal surface-state props (the parent owns pending/error so the gate is uniform). */
interface SurfaceProps {
  bridge: Bridge;
  actor: string | null;
  pending: boolean;
  setPending: (p: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;
  onSuccess?: (payload?: { roomId?: string; projectId?: string }) => void;
  onClose?: () => void;
}

function CreateProjectComposeSurface({
  bridge,
  actor,
  watchingOnly,
  reason,
  pending,
  setPending,
  error,
  setError,
  onSuccess,
  onClose,
}: SurfaceProps & { watchingOnly: boolean; reason: string | null }) {
  // A watching-only operator cannot create; surface the calm gate as the inline error (the form
  // stays visible but the write fails at the gate). Consistent with the web's NO_OPERATOR line.
  const submit = useCallback(
    (input: { title: string; description: string }) => {
      setPending(true);
      setError(null);
      bridge
        .request<{ project: { projectId: string } }>('announceProject', {
          actor: actor ?? undefined,
          title: input.title,
          description: input.description,
        })
        .then((res) => {
          onSuccess?.({ projectId: res.project.projectId });
        })
        .catch((err: unknown) => setError(errorOf(err).message))
        .finally(() => setPending(false));
    },
    [bridge, actor, setPending, setError, onSuccess],
  );

  return (
    <CreateProjectCompose
      onSubmit={submit}
      onCancel={onClose}
      onEscape={onClose}
      pending={pending}
      error={watchingOnly && error === null ? reason : error}
    />
  );
}

function PostAnnouncementComposeSurface({
  bridge,
  actor,
  projectId,
  watchingOnly,
  reason,
  pending,
  setPending,
  error,
  setError,
  onSuccess,
  onClose,
}: SurfaceProps & {
  projectId: string | null;
  watchingOnly: boolean;
  reason: string | null;
}) {
  // AC2 join-first handoff: a non-member operator cannot post → core throws NOT_A_MEMBER; flip to
  // the calm join-first CTA (never a silent failure), mirroring the web's announceJoinFirst.
  const [joinFirst, setJoinFirst] = useState(false);

  const submit = useCallback(
    (input: { subject: string; body: string }) => {
      if (projectId === null) return;
      setPending(true);
      setError(null);
      setJoinFirst(false);
      bridge
        .request<{ room: { roomId: string } }>('postAnnouncement', {
          actor: actor ?? undefined,
          projectId,
          subject: input.subject,
          body: input.body,
        })
        .then((res) => {
          // The initiate→respond loop (AC3): the host refreshes the tree so the new proto-room
          // appears as a NAVIGABLE row the operator can open + reply-to-activate.
          onSuccess?.({ roomId: res.room.roomId, projectId });
        })
        .catch((err: unknown) => {
          const { code, message } = errorOf(err);
          if (code === 'NOT_A_MEMBER') {
            setJoinFirst(true);
            return;
          }
          setError(message);
        })
        .finally(() => setPending(false));
    },
    [bridge, actor, projectId, setPending, setError, onSuccess],
  );

  // The join-first CTA runs joinBoard (the SAME op an agent uses), then re-shows the form (the
  // draft lives in the component's own state) so the operator can post into the now-joined project.
  const joinThenRetry = useCallback(() => {
    if (projectId === null) return;
    setPending(true);
    setError(null);
    bridge
      .request('joinBoard', { actor: actor ?? undefined, projectId })
      .then(() => {
        setJoinFirst(false);
        onSuccess?.({ projectId });
      })
      .catch((err: unknown) => setError(errorOf(err).message))
      .finally(() => setPending(false));
  }, [bridge, actor, projectId, setPending, setError, onSuccess]);

  return (
    <PostAnnouncementCompose
      onSubmit={submit}
      onCancel={onClose}
      onEscape={onClose}
      joinFirst={joinFirst}
      onJoinFirst={joinThenRetry}
      projectLabel={projectId ?? undefined}
      pending={pending}
      error={watchingOnly && error === null ? reason : error}
    />
  );
}

function JoinProjectPickerSurface({
  bridge,
  actor,
  pending,
  setPending,
  error,
  setError,
  onSuccess,
  onClose,
}: SurfaceProps) {
  const [joinable, setJoinable] = useState<JoinableProject[]>([]);

  // Compute the JOINABLE set = the global-read directory MINUS the ones the operator already
  // belongs to (canonical-handle compare), mirroring the web's handleJoinProject. We fetch the
  // directory via listProjects + boardDirectory over the bridge (the SAME reads the tree builds
  // from). A watching-only operator (null actor) → everything is joinable (nothing to exclude), but
  // the choose then surfaces the host-surface NO_OPERATOR calmly.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { projects } = await bridge.request<{
          projects: Array<{ projectId: string; title: string }>;
        }>('listProjects');
        const operator = actor === null ? null : actor.toLowerCase();
        const next: JoinableProject[] = [];
        for (const p of projects) {
          if (operator === null) {
            next.push({ projectId: p.projectId, title: p.title });
            continue;
          }
          const { members } = await bridge.request<{
            members: Array<{ handle: string }>;
          }>('boardDirectory', { projectId: p.projectId });
          const belongs = members.some(
            (m) => m.handle.toLowerCase() === operator,
          );
          if (!belongs) next.push({ projectId: p.projectId, title: p.title });
        }
        if (!cancelled) setJoinable(next);
      } catch (err: unknown) {
        // Even on a read failure, keep the picker open with the calm inline error (never a crash).
        if (!cancelled) {
          setJoinable([]);
          setError(errorOf(err).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, actor, setError]);

  const choose = useCallback(
    (chosenProjectId: string) => {
      setPending(true);
      setError(null);
      bridge
        .request('joinBoard', {
          actor: actor ?? undefined,
          projectId: chosenProjectId,
        })
        .then(() => onSuccess?.({ projectId: chosenProjectId }))
        .catch((err: unknown) => setError(errorOf(err).message))
        .finally(() => setPending(false));
    },
    [bridge, actor, setPending, setError, onSuccess],
  );

  return (
    <JoinProjectPicker
      joinable={joinable}
      onChoose={choose}
      onCancel={onClose}
      onEscape={onClose}
      pending={pending}
      error={error}
    />
  );
}

function FocusAffordanceSurface({
  bridge,
  actor,
  watchingOnly,
  reason,
  pending,
  setPending,
  error,
  setError,
  onSuccess,
  onClose,
}: SurfaceProps & { watchingOnly: boolean; reason: string | null }) {
  const [focus, setFocus] = useState<string | null>(null);
  const [registered, setRegistered] = useState(true);

  // Read the operator's CURRENT focus + registration (the SAME fold /api/me uses on the web). A
  // watching-only OR unregistered operator → the FocusAffordance renders DISABLED inert with a calm
  // reason (the primary client-side gate, consistent with the create/post/join surfaces' gate).
  useEffect(() => {
    let cancelled = false;
    if (actor === null) {
      setFocus(null);
      setRegistered(false);
      return;
    }
    void (async () => {
      try {
        const me = await bridge.request<{
          handle: string | null;
          focus: string | null;
          registered: boolean;
        }>('whoami', { actor });
        if (!cancelled) {
          setFocus(me.focus);
          setRegistered(me.registered);
        }
      } catch {
        // A read failure leaves the resting placeholder; the write still gates on the host backstop.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, actor]);

  const submit = useCallback(
    (next: string) => {
      setPending(true);
      setError(null);
      bridge
        .request<{ handle: string; focus: string }>('updateFocus', {
          actor: actor ?? undefined,
          focus: next,
        })
        .then((res) => {
          setFocus(res.focus);
          onSuccess?.();
        })
        .catch((err: unknown) => setError(errorOf(err).message))
        .finally(() => setPending(false));
    },
    [bridge, actor, setPending, setError, onSuccess],
  );

  const disabled = watchingOnly || !registered;
  const disabledReason = watchingOnly
    ? reason
    : !registered
      ? 'handle not registered — register it (an agent op) before setting focus.'
      : null;

  return (
    <FocusAffordance
      focus={focus}
      onSubmit={submit}
      onCancel={onClose}
      onEscape={onClose}
      pending={pending}
      disabled={disabled}
      disabledReason={disabledReason}
      error={error}
    />
  );
}
