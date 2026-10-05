# Extending & scaling

For anyone adding tools or changing behavior. Read [ARCHITECTURE.md](ARCHITECTURE.md)
first for the map of the request lifecycle.

## Non-negotiable rules

These are load-bearing; a change that breaks one is a regression.

1. **The official documentation is the only source of truth for Yandex Tracker.**
   Index of every page: <https://yandex.ru/support/tracker/en/llms.txt>; any page
   is markdown by appending `.md`
   (`https://yandex.ru/support/tracker/en/api/<section>/<page>.md`). Blogs, Stack
   Overflow, observed production behavior and model memory are **not** sources. A
   path, parameter or field that is not on a page from `llms.txt` does not go into
   the code. If a capability is genuinely needed and genuinely undocumented, that
   is a deviation: record it in [TOOLS.md](TOOLS.md) with the reason.
2. **Only documented REST API v3 endpoints.** Every call goes through
   `Tracker.request()` in `src/client.ts`. Do not add a second HTTP path, an HTTP
   library, or an abstraction on top of `fetch`. The MCP side stays on the
   official SDK.
3. **One tool per endpoint, nothing in between.** The API's parameter names go in,
   the API's JSON comes out. No projections, no renaming, no client-side
   pagination, no convenience tools that compose several calls. `src/dispatch.ts`
   is the single exception and stays one: it addresses the registry by name and
   passes arguments through, adding no semantics of its own. A new tool goes in
   `src/tools/`, never next to the dispatchers.
4. **No `any`, no `as`.** Let types be inferred — `tool()` derives the type of
   `run`'s arguments from `input`. The one cast in the project lives in
   `src/tool.ts` and is explained there.
5. **Never write to stdout.** stdout is the JSON-RPC channel. Diagnostics go to
   stderr. A stray `console.log` corrupts the stream and the host drops the
   connection.
6. **Keep dependencies minimal.** The server imports `@modelcontextprotocol/server`
   and `zod` and nothing else. `tsc` compiles rather than bundles, so both are
   real `dependencies` and anything you add lands in every user's install — add
   it only with a clear reason.
7. **Type-check after any behavior change.** Node strips the types without
   checking them, and there is no test suite to catch the difference:
   ```sh
   npm run typecheck        # or npm run build — the same tsc, with emit
   ```
   Then drive the server over stdio once; the smoke test is in the
   [README](../README.md#verify-locally).

## Adding a tool

A tool is one endpoint, so adding one starts by opening its page.

1. **Find the page** in <https://yandex.ru/support/tracker/en/llms.txt> and read
   the `.md` version. Note the method, the exact path (including whether the doc
   writes a trailing slash), every query parameter, and every body field.
2. **Add one entry** to the array in the `src/tools/` module that matches the
   page's section. A section with no module yet gets a new file exporting its own
   array, wired into `sections` in `src/tools/index.ts` — one place, which the
   catalogue, the `tracker://api` resource and `docs/TOOLS.md` all read.
   Transcribe the parameters — same names, documented types, descriptions taken
   from the page:

   ```ts
   tool({
     name: "tracker_get_comments",
     description: `Get the comments for an issue.

   GET /v3/issues/{issueId}/comments
   https://yandex.ru/support/tracker/en/api/issues/get-comments.md`,
     input: {
       issueId: z.string().min(1).describe("Issue ID or key."),
       expand: z.string().optional().describe("Additional fields: attachments, html, all."),
       perPage: z.number().int().optional().describe("Comments per page."),
     },
     run: (tracker, a) =>
       tracker.request("GET", path`/issues/${a.issueId}/comments`, {
         params: given({ expand: a.expand, perPage: a.perPage }),
       }),
   }),
   ```

   The description is always: summary line, blank line, `<METHOD> /v3/<path>`,
   the page URL. That summary line, after the name and the required arguments,
   is the endpoint's whole entry in the catalogue an agent chooses from, so it
   has to read as a complete answer to "what does this do" on its own. `z.toJSONSchema` derives the schema `tracker_api` hands
   out from `input`; `.describe()` is what the agent reads, so every parameter
   gets one.

   Conventions the whole package follows:
   - Path placeholders become camelCase fields (`<issue_ID>` → `issueId`).
   - `given({...})` drops what the caller left unset; use it for `params` and
     `body` alike, and omit the option entirely when there is nothing to send.
   - Required parameters carry no `.optional()`; optional ones do.
   - When a page documents `If-Match: "<version>"`, add a trailing optional
     `version` field and pass `headers: ifMatch(a.version)`. When it documents
     `version` as a query parameter, it belongs in `params` instead.
   - Body too open-ended to enumerate (the page says "the same format as when
     editing issues")? Take one `fields` record and spread it last.
   - **`effect` only when the method misleads.** `tool()` reads the method out of
     the description: GET is `read`, POST is `create`, PUT, PATCH and DELETE are
     `modify`. Add `effect: "read" | "create" | "modify"` after the description
     when that is wrong — a `_search` POST that only reads, a GET that downloads
     a file onto the caller's disk, a POST like `_move` or `_start` that acts on
     an object that already exists. `effect` decides which dispatcher accepts the
     endpoint and therefore whether the host asks the user, so getting it wrong
     either routes a destructive call through `tracker_read`'s standing
     permission, or makes a plain read prompt for confirmation every time.

3. **Regenerate the index**: `npm run docs:tools` rewrites the tables in
   [TOOLS.md](TOOLS.md) between its `<!-- tools:start -->` / `<!-- tools:end -->`
   markers and formats the result — commit whatever it changes. The preamble
   above the marker is hand-written; leave it alone. Do not copy Yandex's
   argument tables into the file either: the page is the reference.
4. **Check it yourself.** There is no test suite, so the description and the
   `run` body are kept in step by hand — re-read them together before you commit.
   `npm run build` proves it compiles; the README's smoke test proves the server
   still lists. A new endpoint does not show up in `tools/list` — it shows up in
   `tracker_api`'s listing of its section, so check it there and call it once through the
   dispatcher its `effect` selects.

## Checking a change

There is no automated suite; two seams make manual checking cheap.

- `new Tracker(config, fetchImpl)` takes a `fetch`, so the transport can be
  driven with a fake — URL building, auth and org headers, boolean spelling,
  repeated query keys, non-2xx → `TrackerApiError`, `204` → `null`.
- `npm run mock:tracker` stands in for the API host, so the whole tool surface —
  writes included — can be driven over stdio with fake credentials. It logs every
  request the server would have sent; see the smoke-test notes in `CLAUDE.md`.

For the end-to-end path, run the README's stdio smoke test against
`node build/cli.js` — that is the artifact users get.

## Scaling notes

- **Cached client.** `getTracker()` builds one `Tracker` lazily and reuses it, so
  the connection pool behind `fetch` is shared. The environment is read once, at
  first use — which is why a missing token is a tool error rather than a crash
  during the host's handshake.
- **Server factory.** `serveStdio` calls `buildServer` as a factory — the SDK
  pins one instance per protocol era per connection — so registration must happen
  inside it, never as an import side effect.
- **More primitives.** Read-only context lives in `src/resources.ts` as
  `registerResource` calls — add more the same way. For templated prompts, use
  `registerPrompt`.
- **Tool surface.** Three tools reach 179 endpoints, so the registry can keep
  growing without `tools/list` growing with it: a new endpoint costs one
  catalogue line (~95 bytes) instead of a full schema (~730 bytes on average).
  The description holds only the section index, because hosts cut a tool
  description at about 2 KB (Claude Code at 2048 characters); the full
  catalogue outgrew that long ago. Keep the index under it — a section blurb is
  one line, not a paragraph.
- **Response size.** Responses are raw Tracker JSON, and issue objects are large.
  Trim them with the API's own `fields` and `expand` parameters — never by
  filtering in the server.
- **Auth schemes.** OAuth vs IAM is decided in `authHeaders()` by `authScheme`.
  Add new schemes there, not in a tool.
- **Retries.** There are none, on purpose: a failed call is a tool error and the
  agent decides whether to send it again. Do not add them back per method — a
  lost DELETE response repeated is a false 404.
