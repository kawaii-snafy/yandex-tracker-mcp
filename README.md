# Yandex Tracker MCP

A stdio MCP server that puts the whole [Yandex Tracker REST API
v3](https://yandex.ru/support/tracker/en/llms.txt) in front of an LLM agent —
issues, comments, checklists, attachments, worklog, links and transitions; bulk
operations and imports from another tracker; queues, macros, local fields,
workflows, triggers and components; boards, columns and sprints; projects,
portfolios and goals; saved filters, dashboards, absences, users and the
reference dictionaries.

It is a thin wrapper on purpose: **one tool per documented endpoint** — 179 of
them — the API's own parameter names on the way in, the API's own JSON on the way
out, as `body` next to the response `headers` the documentation names. Every
endpoint's description links to the documentation page it was written from, so
the agent can always read the source of truth.

Those 179 do not go on the wire as 179 MCP tools, which would cost every
conversation ~55k tokens of argument schemas before a word is said. Three tools
do:

| Tool           | What it is for                                                                     |
| -------------- | ---------------------------------------------------------------------------------- |
| `tracker_api`  | The catalogue: sections in its description, endpoint lists and schemas on request. |
| `tracker_read` | Call an endpoint that only reads.                                                  |
| `tracker_call` | Call an endpoint that creates, edits or deletes.                                   |

An agent picks a section, asks `tracker_api` for its endpoints and then for the
schemas it needs, then calls. Same endpoints, same argument names, same
responses — **under 1k tokens** standing cost instead of 55k. The split between the two dispatchers is what keeps
reads cheap in a host: `tracker_read` is annotated read-only and can be granted a
standing permission, `tracker_call` is flagged destructive and gets confirmed.

The catalogue is also readable as a resource — `tracker://api` for all of it,
`tracker://api/issues` for one section, `tracker://api/tracker_get_issue` for one
endpoint's schema.

## Install

The package is not on npm. Every [release](https://github.com/kawaii-snafy/yandex-tracker-mcp/releases)
carries it as an archive, and `npx` runs it from there:

```sh
npx -y https://github.com/kawaii-snafy/yandex-tracker-mcp/releases/download/v1.2.0/yandex-tracker-mcp.tgz
```

Change `v1.2.0` in the URL to move to another release. The archive is already
compiled, so the install is the package and its two dependencies — no `git`, no
build.

To run unreleased code, install from the repository instead:
`npx -y github:kawaii-snafy/yandex-tracker-mcp` (append `#<branch>` for a
branch). npm then clones it, installs the dev dependencies and compiles `build/`
through `prepare`, so the first start is slower and needs `git`.

Whichever you use, keep the full URL or the `github:` prefix: a bare
`npx yandex-tracker-mcp` asks the npm registry, where that name belongs to
another package.

## Usage with Codex

Add the server to `~/.codex/config.toml`:

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

To run from a clone instead, build it (`npm run build`) and point the host at
the entry point:

```toml
command = "node"
args = ["/path/to/yandex-tracker-mcp/build/cli.js"]
```

For a non-cloud organization, use `YANDEX_TRACKER_ORG_ID` instead of
`YANDEX_TRACKER_CLOUD_ORG_ID`.

Restart Codex after changing the config. The server exposes tools named
`tracker_*`, such as `tracker_get_issue`, `tracker_search_issues`, and
`tracker_add_comment`.

## Usage with Claude Code

Add the server with the Claude Code CLI:

```sh
claude mcp add --transport stdio \
  --env YANDEX_TRACKER_TOKEN="..." \
  --env YANDEX_TRACKER_CLOUD_ORG_ID="..." \
  yandex-tracker \
  -- npx -y https://github.com/kawaii-snafy/yandex-tracker-mcp/releases/download/v1.2.0/yandex-tracker-mcp.tgz
```

For a non-cloud organization, use `--env YANDEX_TRACKER_ORG_ID="..."` instead
of `YANDEX_TRACKER_CLOUD_ORG_ID`.

Verify the Claude Code registration:

```sh
claude mcp list
claude mcp get yandex-tracker
```

Inside Claude Code, use `/mcp` to check the server connection and tools.

## Environment

Required:

- `YANDEX_TRACKER_TOKEN`: OAuth or IAM token.
- One organization id: `YANDEX_TRACKER_CLOUD_ORG_ID` for cloud organizations or
  `YANDEX_TRACKER_ORG_ID` for non-cloud organizations.

Optional:

- `YANDEX_TRACKER_AUTH_SCHEME`: `OAuth` by default. Use `Bearer` for IAM tokens.
- `YANDEX_TRACKER_BASE_URL`: `https://api.tracker.yandex.net` by default.
- `YANDEX_TRACKER_TIMEOUT`: `30` by default.

## Verify locally

Run the MCP server and ask for its tool list. MCP requires the `initialize`
handshake before any other request, so send it (and the `initialized`
notification) first:

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

The second response line should be a JSON-RPC object listing `tracker_api`,
`tracker_read` and `tracker_call`. The server is stdio-only, so stdout is
reserved for MCP JSON-RPC messages (logs go to stderr).

## Documentation

Deeper docs live in [`docs/`](docs/INDEX.md):

- [INTEGRATION.md](docs/INTEGRATION.md) — connect the server to a host.
- [TOOLS.md](docs/TOOLS.md) — the three tools, every endpoint, and its doc page.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the server works internally.
- [EXTENDING.md](docs/EXTENDING.md) — add tools, rules, and scaling notes.

## Development

```sh
git clone git@github.com:kawaii-snafy/yandex-tracker-mcp.git
cd yandex-tracker-mcp
npm install

npm run typecheck   # tsc --noEmit — Node strips the types without checking them
npm run build       # tsc → build/, then chmod +x build/cli.js
npm run lint        # eslint
npm run format      # prettier --write
npm run docs:tools  # regenerate the docs/TOOLS.md tables

node src/cli.ts     # run from source
node build/cli.js   # run the compiled entry point
```

### Releasing

Set the version in `package.json` and `SERVER_VERSION` in `src/server.ts`, merge,
then tag and push the tag:

```sh
git tag v1.2.0 && git push origin v1.2.0
```

`.github/workflows/release.yml` checks that the tag and both versions agree,
packs the archive, installs it on Node 20, runs the MCP handshake against it and
publishes the release with the archive as `yandex-tracker-mcp.tgz`. Then update
the version in the install URLs in this README and `docs/INTEGRATION.md`.

Node runs the TypeScript sources directly, so development needs Node 22.18 or
newer. **Running it does not**: `build/` is plain JavaScript and `build/cli.js` carries
a `#!/usr/bin/env node` shebang, so `npx` works on a machine with only Node 20+.
