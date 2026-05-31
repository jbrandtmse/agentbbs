// The reusable tool-registration helper (Story 2.1, Task 3 / AC #1, #2).
//
// `registerCoreTool` is the ONE production path every V1 identity tool (Stories
// 2.2–2.5) registers through. It encodes the thin-MCP-layer contract:
//
//     validate (Zod, by the SDK) -> call the core delegate -> map any error
//
// The handler body is deliberately tiny: it does NOT contain board logic, SQL, or
// projections. It calls the injected `delegate` (which calls `core`) and routes
// any thrown error through `error-map.ts` so the closed-code `{ code, message }`
// contract survives to the client.
//
// Input validation: the SDK validates the call's arguments against `inputSchema`
// and REJECTS invalid input BEFORE the handler body runs (verified against
// @modelcontextprotocol/sdk@1.29.0 server/mcp.js: `validateToolInput` throws an
// InvalidParams McpError before `executeToolHandler` is reached). So an
// invalid-input call NEVER reaches the delegate — this is what satisfies AC #1's
// "rejects invalid input before reaching core" and AC #3(b). The delegate
// therefore receives already-parsed, typed args.
//
// Types are taken from the SDK's own surface (`ToolCallback`, `ShapeOutput`,
// `ZodRawShapeCompat`) so the delegate's args type is EXACTLY what the SDK would
// infer and the wrapper is exactly the callback type `registerTool` expects — no
// re-derivation drift. The subpath imports resolve via the SDK `exports` map.

import type {
  McpServer,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  ShapeOutput,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { mapErrorToResult } from './error-map.js';

/** The per-call context the SDK threads to a handler (signal, auth, etc.). */
export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * The success-producing delegate for a tool. Receives the already-parsed, typed
 * args (validated by the SDK against the tool's `inputSchema`, typed exactly as
 * the SDK infers via {@link ShapeOutput}) plus the per-call {@link ToolExtra}.
 * Returns the success {@link CallToolResult} (sync or async).
 *
 * The delegate is where a later identity story calls `core`. It should THROW a
 * `BoardError` on a domain failure; `registerCoreTool` catches and maps it — the
 * delegate never builds an error result itself.
 */
export type CoreToolDelegate<Shape extends ZodRawShapeCompat> = (
  args: ShapeOutput<Shape>,
  extra: ToolExtra,
) => CallToolResult | Promise<CallToolResult>;

/** Static config for a registered tool (the input schema is a Zod raw shape). */
export interface CoreToolConfig<Shape extends ZodRawShapeCompat> {
  /** Human-readable description surfaced to clients in `tools/list`. */
  readonly description: string;
  /**
   * The tool's input schema as a Zod raw shape — a plain object whose values are
   * Zod validators, e.g. `{ handle: z.string(), current_focus: z.string() }`.
   * Param names are `snake_case` (the MCP wire boundary). The SDK validates input
   * against this and rejects invalid calls before the delegate runs.
   */
  readonly inputSchema: Shape;
  /** Optional title (display hint) forwarded to the SDK config. */
  readonly title?: string;
}

/**
 * Register a tool that follows the thin "validate -> delegate -> map-error"
 * pattern on the given server.
 *
 * The registered handler:
 *  1. (SDK) validates input against `config.inputSchema`; invalid input is
 *     rejected before the handler body — the delegate is never called.
 *  2. calls `delegate(args, extra)` with the parsed, typed args,
 *  3. returns the delegate's success result, or
 *  4. routes any thrown/rejected error through {@link mapErrorToResult} so a
 *     `BoardError` becomes the structured `{ code, message }` isError result.
 *
 * @param server The `McpServer` to register on.
 * @param name The tool name (the MCP wire identifier).
 * @param config Description + Zod raw-shape input schema.
 * @param delegate The success-producing core delegate.
 * @returns The SDK's `RegisteredTool` handle (enable/disable/remove/update).
 */
export function registerCoreTool<Shape extends ZodRawShapeCompat>(
  server: McpServer,
  name: string,
  config: CoreToolConfig<Shape>,
  delegate: CoreToolDelegate<Shape>,
): ReturnType<McpServer['registerTool']> {
  // The wrapper IS a ToolCallback<Shape> — exactly the callback type the SDK's
  // registerTool expects once it infers InputArgs = Shape from `inputSchema`.
  const handler: ToolCallback<Shape> = (async (
    args: ShapeOutput<Shape>,
    extra: ToolExtra,
  ): Promise<CallToolResult> => {
    try {
      return await delegate(args, extra);
    } catch (error) {
      // Explicit mapping (not throw-to-isError): preserves the closed `code`.
      return mapErrorToResult(error);
    }
  }) as ToolCallback<Shape>;

  return server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
    },
    handler,
  );
}
