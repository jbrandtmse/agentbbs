// @agentbbs/cli host barrel (Story 9.3) — the on-demand web host's internal surface.
//
// The host (the HTTP thin client over core, the analogue of the stdio mcp-server) is
// composed here: the JSON API, the SSE channel, static serving of the apps/web build,
// and the server lifecycle. The CLI `ui` subcommand (../ui.ts) and the host tests
// consume these. The host is NOT a public package export — it is internal to cli.

export { handleApiRequest } from './json-api.js';
export type { JsonResponse } from './json-api.js';
export { createSseChannel, DEFAULT_SSE_POLL_INTERVAL_MS } from './sse.js';
export type { SseChannel, SseChannelOptions } from './sse.js';
export {
  createStaticServer,
  resolveWebDist,
  WEB_DIST_ENV,
} from './static-assets.js';
export type { StaticResult } from './static-assets.js';
export { createHost, startHost, SSE_PATH } from './server.js';
export type { CreateHostOptions, Host, RunningHost } from './server.js';
export {
  eventToWire,
  memberToWire,
  messageToWire,
  projectToWire,
  roomToWire,
} from './wire.js';
export type {
  EventWire,
  MemberWire,
  MessageWire,
  ProjectWire,
  RoomWire,
} from './wire.js';
