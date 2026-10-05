# Integration guide

How to connect Yandex Tracker MCP to an MCP host. For the endpoints themselves
see [TOOLS.md](TOOLS.md).

The server advertises **three** tools — `tracker_api` (the catalogue of all 179
Tracker endpoints, with their argument schemas on request), `tracker_read` and
`tracker_call` (which run them). A host that lets you allow or deny tools
individually only has those three to decide about: `tracker_read` is annotated
read-only and is the one worth a standing permission; `tracker_call` is flagged
destructive, so a host that confirms destructive calls will confirm every write.

## Transport

The server is **stdio-only**. It reads newline-delimited JSON-RPC 2.0 requests
from stdin and writes responses to stdout. There is no HTTP/SSE transport.
Because stdout is reserved for protocol traffic, all diagnostics go to stderr —
if you wrap the server, do not merge stderr into stdout.

## Environment

Configuration comes entirely from environment variables, read once when the
client is first built (`TrackerConfig.from_env`) and then reused for the life of
the process.

### Required

| Variable                      | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `YANDEX_TRACKER_TOKEN`        | OAuth or IAM token.                                  |
| `YANDEX_TRACKER_CLOUD_ORG_ID` | Cloud organization id. Use this **or** the next one. |
| `YANDEX_TRACKER_ORG_ID`       | Non-cloud organization id.                           |

Exactly one org id must be set; if neither is present the tool call fails with a
config error.

### Optional

| Variable                     | Default                          | Notes                                                                                      |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `YANDEX_TRACKER_AUTH_SCHEME` | `OAuth`                          | The `Authorization` header scheme. Set to `Bearer` for IAM tokens.                         |
| `YANDEX_TRACKER_BASE_URL`    | `https://api.tracker.yandex.net` | Host only — the client always appends `/v3`. A leftover `/v2` or `/v3` suffix is stripped. |
| `YANDEX_TRACKER_TIMEOUT`     | `30`                             | Request timeout in seconds.                                                                |

## Host configuration

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.yandex-tracker]
command = "npx"
args = [
  "-y",
  "https://github.com/kawaii-snafy/yandex-tracker-mcp/releases/download/v1.2.0/yandex-tracker-mcp.tgz",
]

[mcp_servers.yandex-tracker.env]
YANDEX_TRACKER_TOKEN = "..."
YANDEX_TRACKER_CLOUD_ORG_ID = "..."
```

To run from a clone instead of `npx`, build it (`npm run build`)
and set `command = "node"`, `args = ["/path/to/yandex-tracker-mcp/build/cli.js"]`.

Restart Codex after editing the config.

### Claude Code

```sh
claude mcp add --transport stdio \
  --env YANDEX_TRACKER_TOKEN="..." \
  --env YANDEX_TRACKER_CLOUD_ORG_ID="..." \
  yandex-tracker \
  -- npx -y https://github.com/kawaii-snafy/yandex-tracker-mcp/releases/download/v1.2.0/yandex-tracker-mcp.tgz
```

Verify with `claude mcp list`, `claude mcp get yandex-tracker`, and `/mcp`
inside the session. For a non-cloud org swap in `YANDEX_TRACKER_ORG_ID`.

### Any MCP host

Point the host at `npx -y https://github.com/kawaii-snafy/yandex-tracker-mcp/releases/download/v1.2.0/yandex-tracker-mcp.tgz`
— the archive attached to a GitHub release — or, from a clone, at
`node build/cli.js` after `npm run build`. For unreleased code,
`npx -y github:kawaii-snafy/yandex-tracker-mcp` installs from the repository and
compiles `build/` through `prepare`. Keep the full URL or the `github:` prefix:
the package is not on npm, and the bare name there belongs to someone else.

`build/` is plain JavaScript, `build/cli.js` carries a
`#!/usr/bin/env node` shebang, and the only two dependencies are
`@modelcontextprotocol/server` and `zod`, so a host needs nothing but Node 20 or
newer.

## Resources (@-mentions)

Besides the three tools, the server exposes read-only **resources** under the
`tracker://` scheme. In hosts that consume them (e.g. Claude Code), reference one
with an `@`-mention to attach it as context — the agent still uses the tools to
act:

- `@yandex-tracker:tracker://api` — the endpoint catalogue; `tracker://api/issues`
  for one section, `tracker://api/tracker_get_issue` for one endpoint's arguments.
  These reach no network and need no token.
- `@yandex-tracker:tracker://issue/TEST-123` — a single issue snapshot
- `@yandex-tracker:tracker://statuses` (also `priorities`, `issue-types`,
  `fields`, `queues`) — reference dictionaries

(Replace `yandex-tracker` with whatever name you gave the server in the host.)

## Smoke test without a host

MCP requires the `initialize` handshake before any other request, so pipe it
(and the `initialized` notification) in ahead of `tools/list`:

```sh
{ printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  sleep 5
} | YANDEX_TRACKER_TOKEN="..." YANDEX_TRACKER_CLOUD_ORG_ID="..." npx -y https://github.com/kawaii-snafy/yandex-tracker-mcp/releases/download/v1.2.0/yandex-tracker-mcp.tgz
```

The trailing `sleep` keeps stdin open: `printf` alone closes it immediately and
the server shuts down on EOF, often before it has answered `tools/list` — you
then get only the `initialize` reply.

`tools/list` needs no credentials, so it is the safest first check — a healthy
server returns a JSON-RPC object listing `tracker_api`, `tracker_read` and
`tracker_call`, the first of them carrying the section index in its
description. `tracker_api` itself needs no token either; the first call that
actually touches Tracker (e.g. `tracker_read` with `tracker_get_myself`) will
exercise the token and org id.

## Troubleshooting

| Symptom                                                                                     | Likely cause                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool result with `isError: true`, "Set YANDEX_TRACKER_TOKEN…"                               | Token or org id missing from the host's env for this server.                                                                                                                                          |
| `isError: true`, `Unknown endpoint "…"`                                                     | The name is not in the registry. Every one is listed by `tracker_api` with `sections` and under `tracker://api`.                                                                                      |
| `isError: true`, `"…" is a create endpoint — call it with tracker_call`                     | Right endpoint, wrong dispatcher. `(read)` in the catalogue means `tracker_read`; everything else is `tracker_call`.                                                                                  |
| `isError: true`, `Invalid arguments for …`                                                  | An argument missing, mistyped, or not in the endpoint's schema — an unknown key is rejected rather than dropped. Get the schema from `tracker_api`.                                                   |
| `isError: true` with `Yandex Tracker API error <status>`                                    | The request reached Tracker but came back non-2xx (auth, permissions, missing issue).                                                                                                                 |
| Host reports the server "crashed" or garbled                                                | Something wrote non-JSON to stdout. Only JSON-RPC may go to stdout.                                                                                                                                   |
| `isError: true`, `Yandex Tracker API error 0: Failed to reach Yandex Tracker…`              | The request never got a response — DNS, proxy, TLS or timeout.                                                                                                                                        |
| JSON-RPC `error` with code `-32601`/unsupported method                                      | The host called a method the server does not implement (see [ARCHITECTURE.md](ARCHITECTURE.md)).                                                                                                      |
| `resources/read` (a `tracker://…` @-mention) fails with only `Error reading resource <uri>` | An mcp older than this server's 2.1 floor got installed — 2.0 replaced the handler's message with that generic one. Check the resolved version; on 2.1+ the real Tracker/config detail comes through. |

Errors from Tracker or from bad tool arguments come back **inside** a successful
`tools/call` response with `isError: true` — they are not JSON-RPC errors. Only
protocol-level problems (parse errors, malformed requests, unknown methods) use
the JSON-RPC `error` channel. Resource reads differ in shape only: they fail as a
`ResourceError` rather than an `isError` payload, but it carries the same
diagnosable message.
