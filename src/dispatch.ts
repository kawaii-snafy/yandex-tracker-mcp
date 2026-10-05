/**
 * The surface the host sees: a catalogue and two ways to call it.
 *
 * The registry still holds one tool per documented endpoint — 179 of them — but
 * projecting all 179 into `tools/list` costs about 55k tokens of every context,
 * and two thirds of that is argument schemas an agent needs one at a time. So
 * the endpoints are exposed as *data* instead: `tracker_api` indexes the
 * sections in its description and hands out a section's endpoint lines or an
 * endpoint's schema on request, `tracker_read` and `tracker_call` run them. Same
 * endpoints, same arguments, same responses, under 1k tokens standing cost.
 *
 * Two dispatchers rather than one because `effect` has to survive as MCP
 * annotations: a host gives `tracker_read` a standing permission and confirms
 * `tracker_call`, which one dispatcher covering both could never express.
 *
 * Two and not three: `tracker_call` carries the `create` endpoints as well, so
 * they go out flagged destructive where on their own they would not be. Hosts
 * act on read versus write; the finer create/modify split is one they rarely
 * use, and a third dispatcher would cost every agent a three-way choice.
 */

import { z } from "zod";
import { RESPONSE_HEADERS, type Tracker } from "./client.ts";
import { parseEndpoint, tool, type ToolDef } from "./tool.ts";
import { sections, toolsByName } from "./tools/index.ts";

/** The tool a given endpoint is invoked through. */
function dispatcherFor(def: ToolDef): "tracker_read" | "tracker_call" {
  return def.effect === "read" ? "tracker_read" : "tracker_call";
}

/** The summary line every description opens with. */
function summaryOf(def: ToolDef): string {
  return def.description.split("\n", 1)[0]!;
}

/**
 * The arguments an endpoint cannot be called without, as `(issueId, …)` — the
 * `…` standing for optional ones, so `()` is left to the endpoints taking none.
 *
 * Nearly all of them are path placeholders, and those are the one kind of name
 * this server makes up (`<issue_ID>` → `issueId`), so the documentation page
 * cannot teach them. Out of sight, they get guessed — as `issue_id`, the way the
 * tool names and the page spell things — and the call bounces. Read off the same
 * JSON Schema `tracker_api` hands out, so "required" means the same in both.
 */
function signatureOf(def: ToolDef): string {
  const { required = [] } = z.toJSONSchema(z.object(def.input), { io: "input" });
  const more = Object.keys(def.input).length > required.length ? ["…"] : [];
  return `(${[...required, ...more].join(", ")})`;
}

/**
 * One endpoint as one catalogue line.
 *
 * This is what replaces a tool definition, so it carries exactly what choosing
 * an endpoint takes: the name and required arguments, what it does, and — as a
 * `(read)` mark — which dispatcher runs it. The optional arguments are spelled
 * as the API spells them and are left to the schema: listing them too would
 * more than double what the signatures cost, for names the documentation page
 * already teaches.
 */
function catalogueLine(def: ToolDef): string {
  const mark = def.effect === "read" ? " (read)" : "";
  return `${def.name}${signatureOf(def)}${mark} — ${summaryOf(def)}`;
}

/** Every endpoint as one line, grouped by documentation section. */
export function renderCatalogue(only?: readonly string[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    if (only && !only.includes(section.id)) continue;
    lines.push(`## ${section.id} — ${section.tools.length} endpoints`, section.blurb);
    lines.push(...section.tools.map(catalogueLine), "");
  }
  return lines.join("\n").trimEnd();
}

/**
 * The sections alone, one line each — what `tracker_api`'s description carries.
 *
 * Not the whole catalogue: hosts cut a tool description short (Claude Code at
 * 2048 characters), and the 18 KB catalogue lost everything after the first
 * seventeen issue endpoints — agents concluded that uploads did not exist.
 * `tracker_api` hands the lines of a section out on request instead.
 */
function renderIndex(): string {
  return sections
    .map((section) => `${section.id} (${section.tools.length}) — ${section.blurb}`)
    .join("\n");
}

/** One endpoint, fully: where it goes, how it is called, what it takes. */
export function describeTool(def: ToolDef): Record<string, unknown> {
  const endpoint = parseEndpoint(def.description);
  // Strict, because `invoke` is: the schema says `additionalProperties: false`
  // so an agent knows an extra key is an error before it tries one.
  const schema = z.toJSONSchema(z.strictObject(def.input), { io: "input" });
  // The draft URI is the same on all 179 and says nothing about the arguments.
  delete schema.$schema;
  return {
    tool: def.name,
    endpoint: endpoint ? `${endpoint.method} ${endpoint.path}` : undefined,
    call: dispatcherFor(def),
    description: def.description,
    arguments: schema,
  };
}

function unknownEndpoint(name: string): string {
  return `Unknown endpoint "${name}". List a section with tracker_api to see every name.`;
}

/**
 * Run one endpoint from the registry.
 *
 * `strictObject` rather than `object`: unknown keys are a typo in an argument
 * name, and stripping them silently would send a request quietly missing a
 * value. Validation happens here instead of at the MCP boundary — the same Zod
 * shape either way, just applied when the endpoint is known — and before the
 * client is built, so a malformed call is told what is wrong with it even when
 * the credentials are missing too.
 */
async function invoke(
  tracker: () => Tracker,
  through: "tracker_read" | "tracker_call",
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<unknown> {
  const def = toolsByName.get(name);
  if (!def) throw new Error(unknownEndpoint(name));
  if (dispatcherFor(def) !== through) {
    throw new Error(
      `"${name}" is a ${def.effect} endpoint — call it with ${dispatcherFor(def)}, not ${through}.`,
    );
  }
  const parsed = z.strictObject(def.input).safeParse(args ?? {});
  if (!parsed.success) {
    throw new Error(
      `Invalid arguments for ${name} — its schema is in tracker_api:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return def.run(tracker(), parsed.data);
}

/** What both dispatchers hand back, with the header list read off the client. */
const RETURNS = `Returns \`{headers, body}\`: \`body\` is the API's own JSON, untouched; \`headers\` holds whichever of ${RESPONSE_HEADERS.join(", ")} Tracker sent — the total, the next page, the scroll cursor.`;

const TOOL_ARG = z
  .string()
  .min(1)
  .describe("Endpoint name from the catalogue, e.g. `tracker_get_issue`.");

const ARGS_ARG = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    'Arguments for the endpoint, spelled exactly as the catalogue and the schema from tracker_api name them — camelCase, e.g. `{"issueId": "QUEUE-1"}`. Omit for an endpoint that takes none.',
  );

export const dispatchTools: readonly ToolDef<() => Tracker>[] = [
  tool({
    name: "tracker_api",
    description: `Find Yandex Tracker endpoints and their arguments. The endpoints are grouped into the sections below (endpoint count in parentheses).

1. Pass \`sections\` to list a section's endpoints: one line each, required arguments in parentheses, \`…\` marking optional ones.
2. Pass \`tools\` — several at once — to get those endpoints' JSON Schema (optional arguments included), HTTP method and documentation URL.
3. Run an endpoint marked \`(read)\` through tracker_read, any other through tracker_call.

${renderIndex()}`,
    effect: "read",
    input: {
      sections: z
        .array(z.enum(sections.map((section) => section.id)))
        .min(1)
        .optional()
        .describe("Sections whose endpoints to list."),
      tools: z
        .array(TOOL_ARG)
        .min(1)
        .optional()
        .describe("Endpoint names to describe. Ask for every endpoint you plan to use at once."),
    },
    run: async (_tracker, a) => {
      if (!a.sections && !a.tools) throw new Error("Pass `sections`, `tools`, or both.");
      return {
        catalogue: a.sections
          ? Object.fromEntries(
              sections
                .filter((section) => a.sections?.includes(section.id))
                .map((section) => [section.id, section.tools.map(catalogueLine)]),
            )
          : undefined,
        // One unknown name costs only its own entry, not the schemas asked for with it.
        schemas: a.tools?.map((name) => {
          const def = toolsByName.get(name);
          return def ? describeTool(def) : { tool: name, error: unknownEndpoint(name) };
        }),
      };
    },
  }),

  tool({
    name: "tracker_read",
    description: `Call a Yandex Tracker endpoint that only reads. Accepts the endpoints marked \`(read)\` in tracker_api's listing; anything that writes goes through tracker_call.

${RETURNS} Trim a large response with the endpoint's own \`fields\` and \`expand\` arguments.`,
    effect: "read",
    input: { tool: TOOL_ARG, args: ARGS_ARG },
    run: async (tracker, { tool: name, args }) => invoke(tracker, "tracker_read", name, args),
  }),

  tool({
    name: "tracker_call",
    description: `Call a Yandex Tracker endpoint that creates, edits or deletes something. Accepts every endpoint *not* marked \`(read)\` in tracker_api's listing.

Get the arguments from tracker_api first — this is the tool that changes data, and a wrong field name is rejected rather than dropped. ${RETURNS} A download returns where the file landed instead.`,
    effect: "modify",
    input: { tool: TOOL_ARG, args: ARGS_ARG },
    run: async (tracker, { tool: name, args }) => invoke(tracker, "tracker_call", name, args),
  }),
];
