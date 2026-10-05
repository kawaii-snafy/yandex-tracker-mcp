# Agent Notes

- **The official documentation is the only source of truth for Yandex Tracker.**
  Index of every page: <https://yandex.ru/support/tracker/en/llms.txt>; any page
  is markdown by appending `.md`
  (`https://yandex.ru/support/tracker/en/api/<section>/<page>.md`). Blogs, Stack
  Overflow, observed production behavior and model memory are **not** sources. A
  path, parameter or field that is not on a page from `llms.txt` does not go into
  the code.
- **Only documented REST API v3 endpoints.** Tracker is reached with `fetch`
  through `Tracker.request()` in `src/client.ts`. Do not add a second HTTP path,
  an SDK, or an abstraction layer on top of it. The MCP side stays on the
  official `@modelcontextprotocol/server`. There are no retries: a failed call
  goes back to the agent, which knows whether repeating it is safe. Every path
  with a value in it is built with the `path` tag, which escapes each value.
- **One tool per endpoint, nothing in between.** Parameter names are the API's
  own (`perPage`, `expand`, `markupType`), and the response body is returned exactly
  as Tracker sent it — no reshaping, no filtering, no client-side pagination —
  inside `{ headers, body }`, where `headers` holds only the documented ones.
- Tools are **data**: each is a `tool({ name, description, input, run })` entry in
  the array its `src/tools/<section>.ts` exports. `src/tools/index.ts` names every
  module in `sections` — one place, read by the catalogue, the `tracker://api`
  resource and the `docs/TOOLS.md` generator alike.
- **The host sees three tools, not 179.** `src/dispatch.ts` projects the registry:
  `tracker_api` indexes the sections in its description and hands out a
  section's catalogue lines and argument schemas on request, `tracker_read` runs the `read` endpoints and `tracker_call`
  the rest. Registering all 179 cost ~55k tokens of every context, two thirds of
  it argument schemas needed one at a time. A new endpoint still goes in
  `src/tools/` and appears in the catalogue automatically — never add a tool
  beside the dispatchers.
- Every tool ships a `title` and MCP annotations. Both are derived — the title
  from the name, `readOnlyHint` / `destructiveHint` from the method in the
  description — so add `effect` to a tool only when its method misleads (a
  `_search` POST, a GET that downloads to disk, a `_move`-style POST). `effect`
  now also picks the dispatcher, so a wrong one either hides a destructive call
  behind `tracker_read`'s standing permission or makes a read prompt every time.
- Keep dependencies minimal: only `@modelcontextprotocol/server` and `zod`. They
  are real `dependencies` — `tsc` compiles `src/` to `build/` and does not bundle
  — so a third one is a third thing every user downloads. HTTP is the built-in
  `fetch`; there is no HTTP library, and there is no bundler.
- **`any` is banned**, and so are `as` casts — the one that exists is in
  `src/tool.ts` and is explained there. Let types be inferred.
- Do not print logs to stdout; MCP stdio stdout must contain only JSON-RPC
  messages. Diagnostics go to stderr.
- **Node does not type-check.** It strips the types and runs, so `npm run
typecheck` — or `npm run build`, which is the same `tsc` with emit — is what
  actually validates a change.
- **Never smoke-test against a real organization.** Point
  `YANDEX_TRACKER_BASE_URL` at `npm run mock:tracker` with fake credentials; it
  logs every request the server would have sent.
- See `docs/` for the full guide: `EXTENDING.md` (adding tools, rules, scaling),
  `ARCHITECTURE.md` (internals), `TOOLS.md` (the tool index), `INTEGRATION.md`
  (connecting hosts). `docs/TOOLS.md` is generated — `npm run docs:tools`.
