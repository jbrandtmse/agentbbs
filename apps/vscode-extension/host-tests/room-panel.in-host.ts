// Story 10.4, AC1/AC2/AC4 — the in-host ROOM-PANEL probe (runs INSIDE the real VS Code Electron
// host). The Rule-12 real-runtime evidence that:
//   - AC1: `RoomPanelManager.openRoom` creates a GENUINE `vscode.window.createWebviewPanel` (a real
//     WebviewPanel with a real `webview` + `cspSource` + `asWebviewUri`), and re-opening the SAME
//     room REVEALS the existing panel (the map keeps ONE panel per room — no duplicate);
//   - AC2: the panel's HTML shell is set (nonce CSP, the bundle + theme CSS linked via asWebviewUri,
//     the mount root carrying the room id) — the data path the webview bundle mounts against;
//   - AC4 (Rule 15 respond-parity): a real `reply` through the panel's bridge ACTIVATES a
//     PROTO-ROOM — the room flips active:false → true, asserted OUT-OF-BAND via a fresh
//     data-access read (NOT the write's own return). The MUTATION-non-vacuity of this semantic is
//     proven in the headless tier (src/bridge.test.ts, Rule 7); here it is proven on the REAL host.
//
// It bundles @agentbbs/core + @agentbbs/data-access + the RoomPanelManager (the SAME host-side
// code the extension wires) — see build-host-tests.cjs. Writes findings to AGENTBBS_PROBE_OUT for
// the runner to assert out-of-band. The real WEBVIEW→host round-trip (the webview JS posting a
// readRoom request) needs the bundle loaded + the panel painted — that is the lead's
// chrome-devtools/manual smoke; here we assert the panel surface + drive the bridge dispatch over
// the REAL node:sqlite handle (proving the host path runs in-host) + the real reply activation.

import { writeFileSync } from 'node:fs';

import { announceProject, postAnnouncement, register } from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import * as vscode from 'vscode';

import {
  createBridge,
  dispatchRequest,
  type Messaging,
} from '../src/bridge.js';
import { RoomPanelManager, type PanelLike } from '../src/room-panel.js';
import { createRoomPanelSerializer } from '../src/serializer.js';
import { webviewThemeKind } from '../src/webview/theme-kind.js';

export async function run(): Promise<void> {
  const out = process.env.AGENTBBS_PROBE_OUT;
  const result: {
    opened: boolean;
    electron: string | null;
    node: string | null;
    panelCreated: boolean;
    panelHasWebview: boolean;
    htmlHasNonceCsp: boolean;
    htmlHasRoomId: boolean;
    htmlNoUnsafe: boolean;
    // Story 10.5 — the STRICT CSP holds in a real webview.
    cspStrict: boolean;
    cspString: string | null;
    revealNotDuplicate: boolean;
    protoInactiveBefore: boolean;
    activeAfterReply: boolean;
    activatedByOperator: boolean;
    // Story 10.5 — the serializer is registered + a deserialize round-trip re-attaches a panel.
    serializerRegistered: boolean;
    deserializeReattached: boolean;
    // Story 10.6 (AC2) — ColorThemeKind is readable in-host + flows into the panel HTML;
    // postThemeKind pushes a real frame to a real webview.
    themeKindRead: string | null;
    htmlHasThemeKind: boolean;
    themeKindPushed: boolean;
    // Story 10.6 (AC1) — the bridge MAX(seq) poll PUSHES a delta host→webview when a real event is
    // appended (the live-fold producer half), proven over the REAL node:sqlite handle.
    livePollPushedDelta: boolean;
    error: string | null;
  } = {
    opened: false,
    electron: process.versions.electron || null,
    node: process.versions.node || null,
    panelCreated: false,
    panelHasWebview: false,
    htmlHasNonceCsp: false,
    htmlHasRoomId: false,
    htmlNoUnsafe: false,
    cspStrict: false,
    cspString: null,
    revealNotDuplicate: false,
    protoInactiveBefore: false,
    activeAfterReply: false,
    activatedByOperator: false,
    serializerRegistered: false,
    deserializeReattached: false,
    themeKindRead: null,
    htmlHasThemeKind: false,
    themeKindPushed: false,
    livePollPushedDelta: false,
    error: null,
  };

  let dataAccess: ReturnType<typeof createDataAccessNodeSqlite> | undefined;
  const createdPanels: vscode.WebviewPanel[] = [];
  try {
    dataAccess = createDataAccessNodeSqlite();
    result.opened = true;

    // Seed: a project + a PROTO-ROOM (announced, no reply yet → inactive), and a replier identity.
    await register(dataAccess, { handle: 'alice', currentFocus: 'seeding' });
    await register(dataAccess, {
      handle: 'operator',
      currentFocus: 'responding',
    });
    const project = await announceProject(dataAccess, 'alice', {
      title: 'In-Host Room Project',
      description: 'seeded inside the real VS Code Electron host',
    });
    const proto = await postAnnouncement(dataAccess, 'alice', {
      projectId: project.projectId,
      subject: 'Proto subject',
      body: 'A proto-room **announcement** with no reply yet.',
    });

    // The extension dir is the development path; resolve the (built) bundle/css refs the same way
    // extension.ts does — they need not exist on disk for asWebviewUri to produce a uri.
    const extUri = vscode.Uri.file(process.cwd());
    const distRoot = vscode.Uri.joinPath(extUri, 'dist');
    const manager = new RoomPanelManager({
      dataAccess,
      assetUris: {
        script: vscode.Uri.joinPath(distRoot, 'webview', 'main.js'),
        styles: [vscode.Uri.joinPath(distRoot, 'webview', 'main.css')],
      },
      iconPath: new vscode.ThemeIcon('comment-discussion'),
      resolveOperatorHandle: () => 'operator',
      // Story 10.6 (AC2) — resolve the INITIAL theme-kind from the REAL active color theme.
      resolveThemeKind: () =>
        webviewThemeKind(vscode.window.activeColorTheme.kind),
      createPanel: (roomId, title): PanelLike => {
        const panel = vscode.window.createWebviewPanel(
          'agentbbs.room',
          title,
          vscode.ViewColumn.Active,
          { enableScripts: true, localResourceRoots: [distRoot] },
        );
        createdPanels.push(panel);
        return panel as unknown as PanelLike;
      },
    });

    // AC1 — open the proto-room: a genuine WebviewPanel is created with a real webview.
    const panel = manager.openRoom(
      proto.roomId,
    ) as unknown as vscode.WebviewPanel;
    result.panelCreated = createdPanels.length === 1;
    result.panelHasWebview =
      typeof panel.webview === 'object' &&
      typeof panel.webview.cspSource === 'string' &&
      typeof panel.webview.asWebviewUri === 'function';

    // AC2 — the HTML shell: nonce CSP, the room id on the mount root, NO unsafe-inline/eval.
    const html = panel.webview.html;
    result.htmlHasNonceCsp =
      html.includes('Content-Security-Policy') && html.includes('nonce-');
    result.htmlHasRoomId = html.includes(`data-room-id="${proto.roomId}"`);
    result.htmlNoUnsafe =
      !html.includes('unsafe-inline') && !html.includes('unsafe-eval');

    // Story 10.6 (AC2) — ColorThemeKind is readable in the real host + flows into the panel HTML as
    // the initial data-theme-kind. (The light/dark/HC value depends on the host's active theme; we
    // only assert the kind is one of the known tokens AND the HTML carries it — the HC PAINT is the
    // lead's manual theme-switch smoke, Rule 12.)
    const themeKind = webviewThemeKind(vscode.window.activeColorTheme.kind);
    result.themeKindRead = themeKind;
    result.htmlHasThemeKind = html.includes(`data-theme-kind="${themeKind}"`);

    // Story 10.5 AC1 — the STRICT CSP holds in a REAL webview. The REAL `webview.cspSource` on a
    // modern VS Code build is NOT a single `vscode-webview://` origin — it is the host's own-asset
    // allowlist, e.g. `'self' https://*.vscode-cdn.net` (asWebviewUri rewrites local resources onto
    // the vscode-cdn.net CDN). So we assert each source directive is pinned to EXACTLY `cspSource`
    // (img/font) or `cspSource` + the nonce (style) — i.e. NO token BEYOND what VS Code itself
    // requires for the webview's own assets (no `data:`, no extra wildcard the extension added).
    // (The fixture tests in webview-html.csp.test.ts pin the literal-string shape with a synthetic
    // single-origin cspSource; THIS proves it against the real host's actual cspSource value.)
    const cspMatch = html.match(
      /content="(default-src[^"]*)"\s*\/>\s*<meta name="viewport"/,
    );
    const cspRaw = (cspMatch?.[1] ?? '').replace(/&#39;|&apos;|&#x27;/giu, "'");
    result.cspString = cspRaw;
    const cspSrc = panel.webview.cspSource;
    const dirMap = new Map<string, string>();
    for (const part of cspRaw.split(';')) {
      const t = part.trim();
      if (t.length === 0) continue;
      const sp = t.indexOf(' ');
      dirMap.set(sp === -1 ? t : t.slice(0, sp), t);
    }
    result.cspStrict =
      dirMap.get('default-src') === `default-src 'none'` &&
      // script-src: ONLY the per-load nonce (no host, no unsafe-*).
      /^script-src 'nonce-[0-9a-f]+'$/u.test(dirMap.get('script-src') ?? '') &&
      // img-src / font-src: EXACTLY the host's own-asset cspSource — nothing more.
      dirMap.get('img-src') === `img-src ${cspSrc}` &&
      dirMap.get('font-src') === `font-src ${cspSrc}` &&
      // style-src: the cspSource + the per-load nonce, nothing more.
      new RegExp(
        `^style-src ${cspSrc.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} 'nonce-[0-9a-f]+'$`,
        'u',
      ).test(dirMap.get('style-src') ?? '') &&
      dirMap.get('connect-src') === `connect-src 'none'` &&
      // No unsafe-* and no data: anywhere (own-origin only; the inert markdown emits no images).
      !cspRaw.includes('unsafe-inline') &&
      !cspRaw.includes('unsafe-eval') &&
      !cspRaw.includes('data:');

    // AC1 — re-open the SAME room: REVEAL, not a duplicate (still ONE created panel).
    manager.openRoom(proto.roomId);
    result.revealNotDuplicate =
      createdPanels.length === 1 && manager.openCount === 1;

    // AC4 — the proto-room is INACTIVE before any reply.
    const before = await dispatchRequest(dataAccess, {
      id: 'b',
      op: 'readRoom',
      args: { roomId: proto.roomId },
    });
    result.protoInactiveBefore =
      (before.result as { room: { active: boolean } } | undefined)?.room
        .active === false;

    // AC4 — a real reply through the panel's bridge ACTIVATES the proto-room (the Epic-4 min-seq
    // activator; the SAME core reply an agent uses). Dispatch through the bridge dispatcher over
    // the REAL node:sqlite handle (the exact path the panel's bridge uses for an inbound request).
    const replyRes = await dispatchRequest(dataAccess, {
      id: 'r',
      op: 'reply',
      args: {
        actor: 'operator',
        roomId: proto.roomId,
        body: 'I will take this.',
      },
    });
    if (!replyRes.ok) {
      throw new Error(
        `reply through the bridge failed: ${replyRes.error?.code ?? 'unknown'}`,
      );
    }

    // Assert ACTIVATION out-of-band via a fresh read (not the write's own return).
    const after = await dispatchRequest(dataAccess, {
      id: 'a',
      op: 'readRoom',
      args: { roomId: proto.roomId },
    });
    const room = (
      after.result as { room: { active: boolean; activatedBy?: string } }
    ).room;
    result.activeAfterReply = room.active === true;
    result.activatedByOperator = room.activatedBy === 'operator';

    // Story 10.6 (AC2) — postThemeKind pushes a real themeKind frame to the OPEN real webview panel.
    // We wrap the panel's webview.postMessage to capture the pushed frame (the real postMessage is a
    // real method on the real webview; wrapping it proves the host→its-own-webview push reaches it).
    const themeFrames: unknown[] = [];
    const realPostMessage = panel.webview.postMessage.bind(panel.webview);
    (
      panel.webview as { postMessage: (m: unknown) => Thenable<boolean> }
    ).postMessage = (m: unknown) => {
      themeFrames.push(m);
      return realPostMessage(m as never);
    };
    manager.postThemeKind('high-contrast');
    result.themeKindPushed = themeFrames.some(
      (f) =>
        typeof f === 'object' &&
        f !== null &&
        (f as { type?: string }).type === 'themeKind' &&
        (f as { kind?: string }).kind === 'high-contrast',
    );

    // Story 10.5 AC2 — register the WebviewPanelSerializer in the real host (proves the API is
    // accepted + returns a Disposable). Registering a SECOND serializer for the same viewType throws
    // ("Only a single serializer may be registered"). When this probe runs inside an ALREADY-ACTIVATED
    // dev host (the --extensionDevelopmentPath extension's activate() registered the serializer first
    // — which is the CORRECT production behavior), that throw is EXPECTED and itself proves the API is
    // live + the production path already registered it. So we tolerate the "already registered" case
    // as success (Story 10.6: the added live-poll wait below widened the window for activate's lazy
    // registration to win the race — the registration capability is still proven either way).
    const serializer = createRoomPanelSerializer(manager);
    let serializerReg: vscode.Disposable | undefined;
    try {
      serializerReg = vscode.window.registerWebviewPanelSerializer(
        'agentbbs.room',
        serializer,
      );
      result.serializerRegistered = typeof serializerReg.dispose === 'function';
    } catch (regErr) {
      // The dev extension's activate() already registered it (the production path) → API proven.
      result.serializerRegistered =
        /already registered|single serializer/iu.test(
          regErr instanceof Error ? regErr.message : String(regErr),
        );
    }

    // Story 10.5 AC2 — a serialize→deserialize ROUND-TRIP: simulate a reload by handing the
    // serializer a FRESH real WebviewPanel + the persisted state ({ roomId }). The serializer must
    // re-attach it (adoptPanel) so the manager maps the panel to the room. We assert the manager
    // now holds the room AND a subsequent openRoom REVEALS the restored panel (no duplicate). NOTE:
    // a TRUE window-reload restore (VS Code persisting + reviving across an actual reload) cannot be
    // triggered headlessly in @vscode/test-electron; that half is a manual lead-reload smoke step.
    // This proves the deserialize→re-attach logic on a REAL panel + the real registration API.
    const restoredPanel = vscode.window.createWebviewPanel(
      'agentbbs.room',
      `#${proto.roomId}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [distRoot],
      },
    );
    createdPanels.push(restoredPanel);
    // The manager currently holds the original panel for this room; the manager.dispose() below
    // tears everything down, but adoptPanel replaces the held entry with the restored one.
    await serializer.deserializeWebviewPanel(
      restoredPanel as unknown as vscode.WebviewPanel,
      { roomId: proto.roomId },
    );
    const restoredHtml = restoredPanel.webview.html;
    const reattachedHasRoom = restoredHtml.includes(
      `data-room-id="${proto.roomId}"`,
    );
    const revealedAfterRestore = manager.openRoom(proto.roomId);
    result.deserializeReattached =
      manager.has(proto.roomId) &&
      reattachedHasRoom &&
      // reveal-not-duplicate post-restore: opening the room returns the SAME restored panel.
      (revealedAfterRestore as unknown as vscode.WebviewPanel) ===
        restoredPanel;

    // Story 10.6 (AC1) — the bridge MAX(seq) poll PUSHES a delta host→webview when a real event is
    // appended (the live-fold PRODUCER half). Bind a bridge over a RECORDING messaging channel against
    // the SAME real node:sqlite handle, seed it (first tick = live maxSeq), append a real reply, then
    // wait for the next tick to push the delta. (Runs AFTER the serializer assertions so its waits do
    // not widen the activate()-lazy-registration race window.)
    const pushed: Array<{ type: string }> = [];
    const recording: Messaging = {
      postMessage: (m) => pushed.push(m as { type: string }),
      onMessage: () => () => {},
    };
    const pollBridge = createBridge({
      dataAccess,
      messaging: recording,
      pollIntervalMs: 40,
    });
    try {
      // Wait for the seed tick (the bridge seeds lastSentSeq to the live maxSeq on the FIRST tick).
      await new Promise((r) => setTimeout(r, 120));
      // Append a real event (a reply to the now-active room) — the poll should push it next tick.
      await dispatchRequest(dataAccess, {
        id: 'live',
        op: 'reply',
        args: { actor: 'operator', roomId: proto.roomId, body: 'live ping' },
      });
      // Wait for a poll tick to pick it up + push the delta host→webview.
      await new Promise((r) => setTimeout(r, 200));
      result.livePollPushedDelta = pushed.some((f) => f.type === 'delta');
    } finally {
      pollBridge.dispose();
    }

    serializerReg?.dispose();
    manager.dispose();
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    for (const p of createdPanels) {
      try {
        p.dispose();
      } catch {
        /* harmless on teardown */
      }
    }
    try {
      dataAccess?.close();
    } catch {
      /* harmless on teardown */
    }
  }

  if (out) {
    writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
  }

  if (
    !result.opened ||
    !result.panelCreated ||
    !result.panelHasWebview ||
    !result.htmlHasNonceCsp ||
    !result.htmlHasRoomId ||
    !result.htmlNoUnsafe ||
    !result.cspStrict ||
    !result.revealNotDuplicate ||
    !result.protoInactiveBefore ||
    !result.activeAfterReply ||
    !result.activatedByOperator ||
    !result.serializerRegistered ||
    !result.deserializeReattached ||
    result.themeKindRead === null ||
    !result.htmlHasThemeKind ||
    !result.themeKindPushed ||
    !result.livePollPushedDelta
  ) {
    throw new Error(
      `ROOM-PANEL PROBE FAILED in the Electron host — ${JSON.stringify(result)}`,
    );
  }
}
