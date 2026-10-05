# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **stdio MCP server** that exposes the Yandex Tracker REST API v3 to LLM agents.
It is a deliberately thin wrapper: **one tool per documented endpoint** — 179 in
the registry — the API's own parameter names on the way in, the API's own JSON on
the way out (as `body`, next to the documented response `headers`). TypeScript on Node, compiled by `tsc` into plain JavaScript under
`build/`. It is not on npm (`private: true` keeps it off): pushing a `vX.Y.Z`
tag makes `.github/workflows/release.yml` attach the `npm pack` archive to a
GitHub release, and hosts run that URL with `npx`. `prepare` compiles `build/`
for installs from git. A release needs `package.json`'s `version` and
`SERVER_VERSION` in `src/server.ts` to match the tag — the workflow checks. There is no HTTP/SSE transport — one process serves
one client over stdin/stdout.

Those 179 reach the host as **three** MCP tools. `src/dispatch.ts` explains why in
full; the short version is that registering all 179 made `tools/list` ~55k tokens,
two thirds of it argument schemas an agent needs one at a time.

## The rule that governs every other decision

**The official documentation is the only source of truth for Yandex Tracker.**

- Index of every page: <https://yandex.ru/support/tracker/en/llms.txt>
- Any page is markdown by appending `.md`:
  `https://yandex.ru/support/tracker/en/api/<section>/<page>.md`

Blogs, Stack Overflow, observed production behavior, and model memory are **not**
sources. A path, parameter or field that is not on a page from `llms.txt` does
not go into the code. Before touching a tool, open its page — every tool's
description links to it. If something is genuinely needed and genuinely
undocumented, that is a deviation: record it in `docs/TOOLS.md` with the reason.

## Commands

```sh
npm install

npm run typecheck            # tsc --noEmit — Node strips the types, it does not check them
npm run build                # the same tsc with emit: src/ -> build/, then chmod +x
npm run lint                 # eslint
npm run format               # prettier --write
npm run docs:tools           # regenerate the docs/TOOLS.md tables
npm run mock:tracker         # fake Tracker on :8787 for smoke tests

node src/cli.ts              # run from source
node build/cli.js            # run the shipped artifact
```

Node runs the TypeScript sources directly by stripping the types, which needs
Node 22.18 or newer for development; the compiled `build/` still runs on Node 20.

There is no test suite: `npm run typecheck` (or `npm run build`) plus the
smoke-test below is what validates a change.

Smoke-test without a host — MCP requires the `initialize` handshake before any
other request, so send it (and the `initialized` notification) first:

```sh
{ printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  sleep 5
} | YANDEX_TRACKER_TOKEN="..." YANDEX_TRACKER_CLOUD_ORG_ID="..." node build/cli.js
```

The trailing `sleep` keeps stdin open: `printf` alone closes it immediately and
the server shuts down on EOF, often before it has answered `tools/list`.

**Never smoke-test against a real organization.** `tools/list` and `tracker_api`
need no credentials at all. Anything that reaches Tracker goes to
`npm run mock:tracker` instead: run the server with
`YANDEX_TRACKER_TOKEN=fake YANDEX_TRACKER_CLOUD_ORG_ID=fake YANDEX_TRACKER_BASE_URL=http://127.0.0.1:8787`,
and the mock logs the method, path, org header and body every call would have
sent — so `tracker_call` is safe to drive too. `MOCK_STATUS=503` exercises the
error path, `MOCK_DELAY` above `YANDEX_TRACKER_TIMEOUT` the timeout.

## Environment

`YANDEX_TRACKER_TOKEN` plus exactly one org id (`YANDEX_TRACKER_CLOUD_ORG_ID`
for cloud orgs, or `YANDEX_TRACKER_ORG_ID`) are required; a missing one surfaces
as a clean tool error, not a crash. Optional: `YANDEX_TRACKER_AUTH_SCHEME`
(`OAuth` default, `Bearer` for IAM tokens), `YANDEX_TRACKER_BASE_URL` (host only
— the client always appends `/v3`), `YANDEX_TRACKER_TIMEOUT` (seconds).

## Architecture

```
src/
  cli.ts       # serveStdio(() => buildServer())
  server.ts    # buildServer(): registers the three tools and the resources
  dispatch.ts  # tracker_api / tracker_read / tracker_call over the registry
  client.ts    # config, errors, Tracker over fetch — the whole Tracker side
  tool.ts      # the ToolDef type and the tool() helper
  resources.ts # the read-only tracker:// surface
  tools/       # issues.ts bulkchange.ts imports.ts filters.ts queues.ts
               # macros.ts boards.ts entities.ts projects.ts dashboards.ts
               # gaps.ts admin.ts users.ts
```

Tool modules mirror the sections of the documentation, so a doc page maps to
exactly one code file. `src/tools/index.ts` names each module in `sections` and
keys them into `toolsByName`.

`tsconfig.json` covers `src` only — it is both the type checker and the build,
and `rootDir`/`outDir` make `build/` mirror `src/`. Relative imports keep their
`.ts` extension so Node can run the sources directly; `rewriteRelativeImportExtensions`
turns them into `.js` on emit. `scripts/gen-tools-doc.ts` is outside that config
and is therefore not type-checked — it is a dev utility, run by Node directly.

Six cross-cutting mechanisms to know before editing:

- **Tools are data.** Each is a `tool({ name, description, input, run })` entry.
  `input` is a Zod shape; `tool()` infers the type of `run`'s `args` from it, so
  nothing is annotated by hand. The registry is read by `src/dispatch.ts`, by
  `src/resources.ts` and by `scripts/gen-tools-doc.ts` alike.
- **The registry is projected, not registered.** `src/dispatch.ts` puts the section
  index in `tracker_api`'s description (hosts truncate descriptions at ~2 KB, so
  never the full catalogue), answers `tracker_api` with a section's catalogue
  lines or `z.toJSONSchema` of the endpoint's `input`, and runs the
  endpoint from `tracker_read` (the `read` ones) or `tracker_call` (the rest),
  validating arguments with `z.strictObject(def.input)`. Two dispatchers rather
  than one because MCP annotations are per tool: that is what keeps reads out of
  the confirmation prompt. `buildServer` registers `dispatchTools` only.
- **The description is a contract.** Summary line, blank line,
  `<METHOD> /v3/<path>`, then the documentation URL. `tool()` reads the method
  back out of it to derive the tool's `effect` — `read`, `create` or `modify` —
  which `buildServer` turns into the MCP annotations (`readOnlyHint` /
  `destructiveHint`) a host uses to decide whether to ask the user. Twenty tools
  whose method misleads declare `effect` themselves. Nothing checks that the
  stated endpoint is the one `run` actually calls, so keep them in step by hand.
- **`Tracker.request(method, path, { params, body, headers })`** is the only way
  out. It builds `{baseUrl}/v3{path}`, maps a transport failure to
  `TrackerApiError(0, …)` and any non-2xx to `TrackerApiError(status, …)`, and
  returns `{ headers, body }` — the decoded body **untouched**, plus only the
  response headers the docs describe (`RESPONSE_HEADERS`). It never retries: a
  repeated DELETE after a lost response is a false 404, and the agent is the one
  that knows whether a call is safe to send again. `upload()` and `download()`
  are the two variants the wire format forces.
- **Paths are built with the `path` tag.** `` path`/issues/${a.issueId}` ``
  escapes every interpolated value with `encodeURIComponent` and refuses `""`,
  `.` and `..`; a bare template literal lets a `#`, `?`, `/` or dot-segment in
  an agent-supplied id address a different object.
- **Errors are thrown, not wrapped.** `@modelcontextprotocol/server` turns a
  thrown error into an `isError: true` tool result carrying its message, so no
  handler needs a try/catch.

## Non-negotiable rules

- **Documentation first** — the rule above. No undocumented endpoints, no guessed
  parameters.
- **One tool per endpoint, nothing in between.** No projections, no renaming, no
  client-side pagination, no convenience tools that compose several calls. If a
  response is too big, trim it with the API's own `fields` / `expand`. The three
  dispatch tools are the single exception and stay one: they address the registry
  by name and add no semantics. A new endpoint goes in `src/tools/`.
- **No second HTTP path.** All Tracker access goes through `Tracker.request()`.
  Imports stay at `@modelcontextprotocol/server` + `zod` — the only two
  `dependencies`, and there is no bundler, so a third one is a third thing every
  user downloads.
- **No `any`, no `as`.** The single cast in the project lives in `src/tool.ts`
  and is explained there.
- **stdout is protocol-only.** Never write to stdout — it corrupts the MCP stream.
- **Keep `docs/TOOLS.md` in sync**: `npm run docs:tools` after changing a tool.

## Adding a tool

Find the endpoint's page in `llms.txt`, read the `.md`, and add one `tool({...})`
entry to the matching `src/tools/` array — description as summary, blank line,
`<METHOD> /v3/<path>`, page URL. Then `npm run docs:tools`. Nothing else is
needed: the endpoint shows up in `tracker_api`'s catalogue by itself, addressed by
name, with its required arguments beside it. Its summary line is the rest of the
entry an agent chooses from, so it has to stand on its own. See `docs/EXTENDING.md` for the full pattern and the naming
conventions.

## Further docs

`docs/` has the deep guides: `ARCHITECTURE.md` (internals), `EXTENDING.md`
(adding tools, scaling), `TOOLS.md` (the generated tool index), and
`INTEGRATION.md` (connecting hosts). `AGENTS.md` mirrors the rules above.
