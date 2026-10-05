/**
 * Read-only context the user can @-mention in a host.
 *
 * Resources are a *user*-facing surface (pulled into a prompt via @-mention and
 * attached as context), not something the agent reads autonomously mid-task —
 * `tracker_api` and the two dispatchers remain the agent's path to the same
 * data. These add a natural way to drop the endpoint catalogue, an issue
 * snapshot or a reference dictionary into the conversation.
 */

import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import { path, type Tracker } from "./client.ts";
import { describeTool, renderCatalogue } from "./dispatch.ts";
import { sections, toolsByName } from "./tools/index.ts";

const DICTIONARIES = [
  ["queues", "tracker://queues", "/queues/", "The Yandex Tracker queue list."],
  ["statuses", "tracker://statuses", "/statuses", "The global Yandex Tracker status dictionary."],
  [
    "priorities",
    "tracker://priorities",
    "/priorities",
    "The global Yandex Tracker priority dictionary.",
  ],
  [
    "issue-types",
    "tracker://issue-types",
    "/issuetypes",
    "The global Yandex Tracker issue-type dictionary.",
  ],
  ["fields", "tracker://fields", "/fields", "Yandex Tracker fields, including custom fields."],
] as const;

export function registerResources(server: McpServer, tracker: () => Tracker): void {
  // The same catalogue `tracker_api` hands out by section, reachable by a
  // person: `tracker://api` for all of it, `tracker://api/queues` for one
  // section. Nothing here reaches Tracker — it is the registry, rendered.
  server.registerResource(
    "api",
    "tracker://api",
    {
      description: "Every Yandex Tracker endpoint this server covers, by section.",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [{ uri: "tracker://api", mimeType: "text/markdown", text: renderCatalogue() }],
    }),
  );

  server.registerResource(
    "api-section",
    new ResourceTemplate("tracker://api/{section}", {
      list: async () => ({
        resources: sections.map((section) => ({
          uri: `tracker://api/${section.id}`,
          name: section.id,
          description: section.blurb,
          mimeType: "text/markdown",
        })),
      }),
    }),
    {
      // No mimeType here: a section is markdown, an endpoint is JSON, and each
      // read says which in its own contents.
      description:
        "One section of the endpoint catalogue (e.g. tracker://api/issues), or one endpoint by name (tracker://api/tracker_get_issue) with its argument schema.",
    },
    async (uri, { section }) => {
      const id = String(section);
      const def = toolsByName.get(id);
      if (!def && !sections.some((candidate) => candidate.id === id)) {
        throw new Error(`No catalogue section or endpoint named "${id}". See tracker://api.`);
      }
      return {
        contents: [
          def
            ? {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify(describeTool(def)),
              }
            : { uri: uri.href, mimeType: "text/markdown", text: renderCatalogue([id]) },
        ],
      };
    },
  );

  server.registerResource(
    "issue",
    new ResourceTemplate("tracker://issue/{key}", { list: undefined }),
    {
      description: "A single Yandex Tracker issue by key (e.g. tracker://issue/TEST-123).",
      mimeType: "application/json",
    },
    async (uri, { key }) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify((await tracker().request("GET", path`/issues/${String(key)}`)).body),
        },
      ],
    }),
  );

  for (const [name, uri, endpoint, description] of DICTIONARIES) {
    server.registerResource(name, uri, { description, mimeType: "application/json" }, async () => ({
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify((await tracker().request("GET", endpoint)).body),
        },
      ],
    }));
  }
}
