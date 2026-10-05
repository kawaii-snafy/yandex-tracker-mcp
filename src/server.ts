/** The MCP surface: one server, built from the tool registry. */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Tracker } from "./client.ts";
import { dispatchTools } from "./dispatch.ts";
import { registerResources } from "./resources.ts";
import type { ToolEffect } from "./tool.ts";

export const SERVER_NAME = "yandex-tracker-mcp";
export const SERVER_VERSION = "1.2.0";

/**
 * How a tool's effect reads as MCP annotations.
 *
 * A host grants a read-only tool a standing permission and asks before a
 * destructive one, so this mapping is what decides whether the user is
 * interrupted on every search. `openWorldHint` is true throughout: every tool
 * here reaches a Tracker installation we know nothing about.
 */
const ANNOTATIONS: Record<ToolEffect, { readOnlyHint: boolean; destructiveHint: boolean }> = {
  read: { readOnlyHint: true, destructiveHint: false },
  create: { readOnlyHint: false, destructiveHint: false },
  modify: { readOnlyHint: false, destructiveHint: true },
};

let cached: Tracker | undefined;

/**
 * One client per process, built lazily.
 *
 * The environment is read on first use rather than at startup, so a missing
 * token surfaces as a clean tool error instead of killing the process before the
 * host has finished its handshake. The undici connection pool behind `fetch` is
 * shared across every call either way.
 */
export function getTracker(): Tracker {
  cached ??= new Tracker();
  return cached;
}

/**
 * Build a server with its tools and resources registered.
 *
 * Three tools go on the wire, not the registry's 179: `src/dispatch.ts` explains
 * why. `serveStdio` calls this as a factory — the SDK pins one instance per
 * protocol era per connection — so registration has to happen here rather than
 * as an import side effect.
 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const def of dispatchTools) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: z.object(def.input),
        // `title` above is the field a host reads first — the SDK's precedence
        // is title → annotations.title → name — so it is not repeated here.
        annotations: { openWorldHint: true, ...ANNOTATIONS[def.effect] },
      },
      async (args) => ({
        // One compact JSON text block and no outputSchema: that keeps responses
        // token-lean (no duplicating structuredContent) and Cyrillic intact.
        // A thrown TrackerApiError / TrackerConfigError / ZodError is turned
        // into an `isError: true` result by the SDK, message and all.
        // The dispatchers get the getter, not a client: `tracker_api` never
        // builds one, and the other two only after the arguments check out.
        content: [{ type: "text" as const, text: JSON.stringify(await def.run(getTracker, args)) }],
      }),
    );
  }

  registerResources(server, getTracker);
  return server;
}
