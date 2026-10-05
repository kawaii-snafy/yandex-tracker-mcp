# Tool reference

This server is a thin wrapper over the [Yandex Tracker REST API
v3](https://yandex.ru/support/tracker/en/llms.txt): **one tool per documented
endpoint**, the API's own parameter names on the way in, the API's own JSON on
the way out — next to the response headers it documents.

That is why this page is an index rather than a copy of Yandex's argument tables.
The documentation is the reference — every row below links to the page its
endpoint was written from, and every endpoint repeats that link in its own
description, so an agent holding it already holds the way to the spec.

Naming follows the endpoint: path placeholders become camelCase arguments
(`<issue_ID>` → `issueId`), and query and body parameters keep the API's spelling
(`perPage`, `expand`, `markupType`).

The **Effect** column is what the endpoint tells your host about the call:
`read` changes nothing, `create` only adds, and `modify` edits or deletes
something that already exists. It follows the HTTP method except where the method
misleads — the six `_search` / `_count` endpoints are POSTs that read, the two
attachment downloads are GETs that write a file to your disk, and POSTs like
`tracker_move_issue`, `tracker_start_sprint` or the three `tracker_bulk_*`
operations act on objects that are already there. `read` endpoints are called
through `tracker_read`, the other two through `tracker_call`.

> Everything under [The endpoints](#the-endpoints) is generated from the tool
> registry: `npm run docs:tools` rewrites it. Edit the tools, not the tables.
> This section and the two below it are hand-written.

## Calling convention

Three tools reach the 179 endpoints below. The registry holds one tool per
endpoint, but putting all 179 in `tools/list` costs ~55k tokens of every context
— two thirds of it argument schemas an agent needs one at a time — so the
endpoints are exposed as data and three tools operate on them:

| Tool           | Arguments           | Returns                                                                                                                |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tracker_api`  | `sections`, `tools` | `catalogue`: each section's endpoint lines; `schemas`: for each tool its endpoint, doc URL, dispatcher and JSON Schema |
| `tracker_read` | `tool`, `args`      | `{headers, body}` of the endpoint's response. Accepts `read` endpoints only                                            |
| `tracker_call` | `tool`, `args`      | `{headers, body}` of the endpoint's response. Accepts `create` and `modify` endpoints                                  |

`tracker_api`'s own description carries only the section index — hosts cut a
tool description at about 2 KB, and the whole catalogue is 18 KB. Ask it for
`sections` to get the catalogue lines: every endpoint name with its required
arguments and a one-line summary, `(read)`-marked where `tracker_read` is the way
in —
`tracker_get_issue(issueId, …) (read) — Get the parameters of one issue.`, where
`…` stands for optional arguments. So an agent pays for a section's list only when it works in that section, and
for a schema only when it means to call something. Ask for every schema you need in one call.

The split into two dispatchers preserves the MCP annotations a host acts on:
`tracker_read` is `readOnlyHint` and can be granted a standing permission,
`tracker_call` is `destructiveHint` and gets confirmed. One dispatcher covering
both would force every read through a confirmation prompt.

Responses come back as a single JSON text block (`content[0].text`) holding
`{headers, body}`. `body` is the raw Tracker JSON, nothing stripped and nothing
reshaped; trim a large one with the API's own `fields` and `expand` parameters.

`headers` is the one place the wrapper is not literal. Some endpoints put part of
their answer in response headers, so the dispatchers pass on the ones the
documentation names, whenever Tracker sends them — and only those, since the
transport headers would cost every call tokens:

| Header                           | Documented in                                       | Carries                            |
| -------------------------------- | --------------------------------------------------- | ---------------------------------- |
| `X-Total-Count`, `X-Total-Pages` | common-format.md, search-issues.md                  | The size of a paginated result     |
| `Link`                           | get-changelog.md, get-comments.md, search-issues.md | The first and next page            |
| `X-Scroll-Id`, `X-Scroll-Token`  | search-issues.md                                    | The cursor of a scrollable search  |
| `ETag`                           | get-comment.md, get-component.md, get-version.md    | The version of the object returned |

The two attachment downloads are the exception: they return where the file
landed, `{path, name, size}`.

Business failures (bad arguments, an unknown endpoint name, the wrong dispatcher,
Tracker API errors, config problems) come back in the **same shape** with
`isError: true` and a plain-text message instead of JSON. Arguments are validated
against the endpoint's schema, strictly: a required string carries a minimum
length of 1, so `""` is rejected, and an argument name that is not in the schema
is an error rather than silently dropped.

An argument you leave out is absent from the request; it is never sent as `null`.

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "tracker_read",
    "arguments": {
      "tool": "tracker_get_issue",
      "args": { "issueId": "TEST-1", "expand": "attachments" }
    }
  }
}
```

The catalogue is a resource too, for a person: `tracker://api`,
`tracker://api/issues` for one section, `tracker://api/tracker_get_issue` for one
endpoint's schema.

## Where the wrapper is not literal

Seven places where an endpoint's arguments cannot be a byte-for-byte mirror of
the API's. There are no others.

| What                                                                                                                                      | Why                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `destDir` / `saveAs` on `tracker_get_attachment`, `tracker_get_attachment_preview`                                                        | Those endpoints return a file. An MCP result is text, so the tool streams the bytes to a local directory and returns `{"path", "name", "size"}`.                                                                                          |
| `filePath` on `tracker_post_attachment`, `tracker_post_temp_attachment`, `tracker_import_attachment`, `tracker_import_comment_attachment` | Those endpoints take `multipart/form-data`. The tool reads the local path and sends it as the documented part — `file` on the attachment endpoints, `file_data` on the import ones.                                                       |
| `version` on the board, column and sprint edits                                                                                           | Those pages document it as the `If-Match: "<version>"` header rather than a parameter. Elsewhere (`tracker_patch_issue`, the workflow / trigger / component / dictionary edits) `version` is a real query parameter and is passed as one. |
| `page` on `tracker_search_issues`, `tracker_get_users`, `tracker_get_queues`                                                              | Those pages describe the result as paginated and link to [common-format](https://yandex.ru/support/tracker/en/api/common-format.md) instead of repeating the parameters. `perPage` + `page` come from there.                              |
| The nine `relationship` values in `tracker_link_issue`'s description                                                                      | No endpoint in the API lists link types, so the values enumerated on [link-issue](https://yandex.ru/support/tracker/en/api/issues/link-issue.md) are the only place to learn them.                                                        |
| `commentId` on `tracker_entity_patch_comment`; the per-item body of `tracker_edit_checklist_item`                                         | Those two pages contradict themselves (summary vs resource table, example vs parameter table). Both tools follow the page's parameter table, which matches the path — and that is what the endpoint accepts in practice.                  |
| `scrolls` on `tracker_clear_scroll`                                                                                                       | That endpoint's body is a bare `{"<scrollId>": "<scrollToken>"}` map with no named parameters, and an MCP argument list needs a name. `scrolls` is sent as the whole body, nothing wrapping it.                                           |

Every other argument is spelled exactly as the API spells it, `from` included.

## The endpoints

<!-- tools:start -->

### Issues — 48 endpoints

Issues, comments, checklists, attachments, worklog, links, transitions and the field dictionary.

| Name                              | Endpoint                                                                  | Effect | Documentation                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `tracker_create_issue`            | `POST /v3/issues/`                                                        | create | [issues/create-issue](https://yandex.ru/support/tracker/en/api/issues/create-issue.md)                               |
| `tracker_get_issue`               | `GET /v3/issues/{issueId}`                                                | read   | [issues/get-issue](https://yandex.ru/support/tracker/en/api/issues/get-issue.md)                                     |
| `tracker_patch_issue`             | `PATCH /v3/issues/{issueId}`                                              | modify | [issues/patch-issue](https://yandex.ru/support/tracker/en/api/issues/patch-issue.md)                                 |
| `tracker_move_issue`              | `POST /v3/issues/{issueId}/_move`                                         | modify | [issues/move-issue](https://yandex.ru/support/tracker/en/api/issues/move-issue.md)                                   |
| `tracker_search_issues`           | `POST /v3/issues/_search`                                                 | read   | [issues/search-issues](https://yandex.ru/support/tracker/en/api/issues/search-issues.md)                             |
| `tracker_count_issues`            | `POST /v3/issues/_count`                                                  | read   | [issues/count-issues](https://yandex.ru/support/tracker/en/api/issues/count-issues.md)                               |
| `tracker_get_suggest`             | `GET /v3/issues/_suggest`                                                 | read   | [issues/get-suggest](https://yandex.ru/support/tracker/en/api/issues/get-suggest.md)                                 |
| `tracker_clear_scroll`            | `POST /v3/system/search/scroll/_clear`                                    | modify | [issues/search-release](https://yandex.ru/support/tracker/en/api/issues/search-release.md)                           |
| `tracker_get_changelog`           | `GET /v3/issues/{issueId}/changelog`                                      | read   | [issues/get-changelog](https://yandex.ru/support/tracker/en/api/issues/get-changelog.md)                             |
| `tracker_link_issue`              | `POST /v3/issues/{issueId}/links`                                         | create | [issues/link-issue](https://yandex.ru/support/tracker/en/api/issues/link-issue.md)                                   |
| `tracker_get_links`               | `GET /v3/issues/{issueId}/links`                                          | read   | [issues/get-links](https://yandex.ru/support/tracker/en/api/issues/get-links.md)                                     |
| `tracker_delete_link`             | `DELETE /v3/issues/{issueId}/links/{linkId}`                              | modify | [issues/delete-link-issue](https://yandex.ru/support/tracker/en/api/issues/delete-link-issue.md)                     |
| `tracker_get_external_links`      | `GET /v3/issues/{issueId}/remotelinks`                                    | read   | [issues/get-external-links](https://yandex.ru/support/tracker/en/api/issues/get-external-links.md)                   |
| `tracker_add_external_link`       | `POST /v3/issues/{issueId}/remotelinks`                                   | create | [issues/add-external-link](https://yandex.ru/support/tracker/en/api/issues/add-external-link.md)                     |
| `tracker_delete_external_link`    | `DELETE /v3/issues/{issueId}/remotelinks/{externalLinkId}`                | modify | [issues/delete-external-link](https://yandex.ru/support/tracker/en/api/issues/delete-external-link.md)               |
| `tracker_get_transitions`         | `GET /v3/issues/{issueId}/transitions`                                    | read   | [issues/get-transitions](https://yandex.ru/support/tracker/en/api/issues/get-transitions.md)                         |
| `tracker_new_transition`          | `POST /v3/issues/{issueId}/transitions/{transitionId}/_execute`           | modify | [issues/new-transition](https://yandex.ru/support/tracker/en/api/issues/new-transition.md)                           |
| `tracker_add_comment`             | `POST /v3/issues/{issueId}/comments`                                      | create | [issues/add-comment](https://yandex.ru/support/tracker/en/api/issues/add-comment.md)                                 |
| `tracker_get_comments`            | `GET /v3/issues/{issueId}/comments`                                       | read   | [issues/get-comments](https://yandex.ru/support/tracker/en/api/issues/get-comments.md)                               |
| `tracker_edit_comment`            | `PATCH /v3/issues/{issueId}/comments/{commentId}`                         | modify | [issues/edit-comment](https://yandex.ru/support/tracker/en/api/issues/edit-comment.md)                               |
| `tracker_delete_comment`          | `DELETE /v3/issues/{issueId}/comments/{commentId}`                        | modify | [issues/delete-comment](https://yandex.ru/support/tracker/en/api/issues/delete-comment.md)                           |
| `tracker_add_reaction_to_comment` | `POST /v3/issues/{issueId}/comments/{commentId}/reactions/{reactionName}` | create | [issues/add-reaction-to-comment](https://yandex.ru/support/tracker/en/api/issues/add-reaction-to-comment.md)         |
| `tracker_add_checklist_item`      | `POST /v3/issues/{issueId}/checklistItems`                                | create | [issues/add-checklist-item](https://yandex.ru/support/tracker/en/api/issues/add-checklist-item.md)                   |
| `tracker_get_checklist`           | `GET /v3/issues/{issueId}/checklistItems`                                 | read   | [issues/get-checklist](https://yandex.ru/support/tracker/en/api/issues/get-checklist.md)                             |
| `tracker_edit_checklist_item`     | `PATCH /v3/issues/{issueId}/checklistItems/{checklistItemId}`             | modify | [issues/edit-checklist](https://yandex.ru/support/tracker/en/api/issues/edit-checklist.md)                           |
| `tracker_delete_checklist`        | `DELETE /v3/issues/{issueId}/checklistItems`                              | modify | [issues/delete-checklist](https://yandex.ru/support/tracker/en/api/issues/delete-checklist.md)                       |
| `tracker_delete_checklist_item`   | `DELETE /v3/issues/{issueId}/checklistItems/{checklistItemId}`            | modify | [issues/delete-checklist-item](https://yandex.ru/support/tracker/en/api/issues/delete-checklist-item.md)             |
| `tracker_get_attachments`         | `GET /v3/issues/{issueId}/attachments`                                    | read   | [issues/get-attachments-list](https://yandex.ru/support/tracker/en/api/issues/get-attachments-list.md)               |
| `tracker_get_attachment`          | `GET /v3/issues/{issueId}/attachments/{fileId}/{fileName}`                | create | [issues/get-attachment](https://yandex.ru/support/tracker/en/api/issues/get-attachment.md)                           |
| `tracker_get_attachment_preview`  | `GET /v3/issues/{issueId}/thumbnails/{fileId}`                            | create | [issues/get-attachment-preview](https://yandex.ru/support/tracker/en/api/issues/get-attachment-preview.md)           |
| `tracker_post_attachment`         | `POST /v3/issues/{issueId}/attachments/`                                  | create | [issues/post-attachment](https://yandex.ru/support/tracker/en/api/issues/post-attachment.md)                         |
| `tracker_post_temp_attachment`    | `POST /v3/attachments/`                                                   | create | [issues/temp-attachment](https://yandex.ru/support/tracker/en/api/issues/temp-attachment.md)                         |
| `tracker_delete_attachment`       | `DELETE /v3/issues/{issueId}/attachments/{fileId}/`                       | modify | [issues/delete-attachment](https://yandex.ru/support/tracker/en/api/issues/delete-attachment.md)                     |
| `tracker_new_worklog`             | `POST /v3/issues/{issueId}/worklog`                                       | create | [issues/new-worklog](https://yandex.ru/support/tracker/en/api/issues/new-worklog.md)                                 |
| `tracker_get_issue_worklog`       | `GET /v3/issues/{issueId}/worklog`                                        | read   | [issues/issue-worklog](https://yandex.ru/support/tracker/en/api/issues/issue-worklog.md)                             |
| `tracker_patch_worklog`           | `PATCH /v3/issues/{issueId}/worklog/{recordId}`                           | modify | [issues/patch-worklog](https://yandex.ru/support/tracker/en/api/issues/patch-worklog.md)                             |
| `tracker_delete_worklog`          | `DELETE /v3/issues/{issueId}/worklog/{recordId}`                          | modify | [issues/delete-worklog](https://yandex.ru/support/tracker/en/api/issues/delete-worklog.md)                           |
| `tracker_get_worklog`             | `GET /v3/worklog`                                                         | read   | [issues/get-worklog](https://yandex.ru/support/tracker/en/api/issues/get-worklog.md)                                 |
| `tracker_search_worklog`          | `POST /v3/worklog/_search`                                                | read   | [issues/get-worklog](https://yandex.ru/support/tracker/en/api/issues/get-worklog.md)                                 |
| `tracker_get_global_fields`       | `GET /v3/fields`                                                          | read   | [issues/get-global-fields](https://yandex.ru/support/tracker/en/api/issues/get-global-fields.md)                     |
| `tracker_create_field`            | `POST /v3/fields`                                                         | create | [issues/create-field](https://yandex.ru/support/tracker/en/api/issues/create-field.md)                               |
| `tracker_get_field`               | `GET /v3/fields/{fieldId}`                                                | read   | [issues/get-issue-fields](https://yandex.ru/support/tracker/en/api/issues/get-issue-fields.md)                       |
| `tracker_patch_field`             | `PATCH /v3/fields/{fieldId}`                                              | modify | [issues/patch-issue-field-name](https://yandex.ru/support/tracker/en/api/issues/patch-issue-field-name.md)           |
| `tracker_create_field_category`   | `POST /v3/fields/categories`                                              | create | [issues/create-issue-field-category](https://yandex.ru/support/tracker/en/api/issues/create-issue-field-category.md) |
| `tracker_patch_field_category`    | `PATCH /v3/fields/categories/{categoryId}`                                | modify | [issues/patch-issue-field-category](https://yandex.ru/support/tracker/en/api/issues/patch-issue-field-category.md)   |
| `tracker_get_applications`        | `GET /v3/applications`                                                    | read   | [issues/get-applications](https://yandex.ru/support/tracker/en/api/issues/get-applications.md)                       |
| `tracker_create_report`           | `POST /v3/entities/report/`                                               | create | [issues/create-report](https://yandex.ru/support/tracker/en/api/issues/create-report.md)                             |
| `tracker_search_reports`          | `POST /v3/entities/report/_search`                                        | read   | [issues/search-reports](https://yandex.ru/support/tracker/en/api/issues/search-reports.md)                           |

### Queues — 37 endpoints

Queues, versions, tags, permissions, local fields, workflows, triggers, autoactions and components.

| Name                                 | Endpoint                                                             | Effect | Documentation                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `tracker_create_queue`               | `POST /v3/queues/`                                                   | create | [queues/create-queue](https://yandex.ru/support/tracker/en/api/queues/create-queue.md)                                       |
| `tracker_get_queues`                 | `GET /v3/queues/`                                                    | read   | [queues/get-queues](https://yandex.ru/support/tracker/en/api/queues/get-queues.md)                                           |
| `tracker_get_queue`                  | `GET /v3/queues/{queueId}`                                           | read   | [queues/get-queue](https://yandex.ru/support/tracker/en/api/queues/get-queue.md)                                             |
| `tracker_delete_queue`               | `DELETE /v3/queues/{queueId}`                                        | modify | [queues/delete-queue](https://yandex.ru/support/tracker/en/api/queues/delete-queue.md)                                       |
| `tracker_restore_queue`              | `POST /v3/queues/{queueId}/_restore`                                 | modify | [queues/restore-queue](https://yandex.ru/support/tracker/en/api/queues/restore-queue.md)                                     |
| `tracker_get_queue_fields`           | `GET /v3/queues/{queueId}/fields`                                    | read   | [queues/get-fields](https://yandex.ru/support/tracker/en/api/queues/get-fields.md)                                           |
| `tracker_get_queue_versions`         | `GET /v3/queues/{queueId}/versions`                                  | read   | [queues/get-versions](https://yandex.ru/support/tracker/en/api/queues/get-versions.md)                                       |
| `tracker_create_version`             | `POST /v3/versions/`                                                 | create | [queues/create-version](https://yandex.ru/support/tracker/en/api/queues/create-version.md)                                   |
| `tracker_get_queue_tags`             | `GET /v3/queues/{queueId}/tags`                                      | read   | [queues/get-tags](https://yandex.ru/support/tracker/en/api/queues/get-tags.md)                                               |
| `tracker_delete_queue_tag`           | `POST /v3/queues/{queueId}/tags/_remove`                             | modify | [queues/delete-tag](https://yandex.ru/support/tracker/en/api/queues/delete-tag.md)                                           |
| `tracker_patch_queue_permissions`    | `PATCH /v3/queues/{queueId}/permissions`                             | modify | [queues/manage-access](https://yandex.ru/support/tracker/en/api/queues/manage-access.md)                                     |
| `tracker_get_queue_user_access`      | `GET /v3/queues/{queueId}/permissions/users/{userId}`                | read   | [queues/get-user-access](https://yandex.ru/support/tracker/en/api/queues/get-user-access.md)                                 |
| `tracker_get_queue_group_access`     | `GET /v3/queues/{queueId}/permissions/groups/{groupId}`              | read   | [queues/get-group-access](https://yandex.ru/support/tracker/en/api/queues/get-group-access.md)                               |
| `tracker_create_local_field`         | `POST /v3/queues/{queueId}/localFields`                              | create | [queues/create-local-field](https://yandex.ru/support/tracker/en/api/queues/create-local-field.md)                           |
| `tracker_get_local_fields`           | `GET /v3/queues/{queueId}/localFields`                               | read   | [queues/get-local-fields](https://yandex.ru/support/tracker/en/api/queues/get-local-fields.md)                               |
| `tracker_get_local_field`            | `GET /v3/queues/{queueId}/localFields/{fieldKey}`                    | read   | [queues/get-info-local-field](https://yandex.ru/support/tracker/en/api/queues/get-info-local-field.md)                       |
| `tracker_patch_local_field`          | `PATCH /v3/queues/{queueId}/localFields/{fieldKey}`                  | modify | [queues/edit-local-field](https://yandex.ru/support/tracker/en/api/queues/edit-local-field.md)                               |
| `tracker_create_workflow`            | `POST /v3/workflows`                                                 | create | [queues/workflows/post-workflow](https://yandex.ru/support/tracker/en/api/queues/workflows/post-workflow.md)                 |
| `tracker_get_workflows`              | `GET /v3/workflows`                                                  | read   | [queues/workflows/get-workflows](https://yandex.ru/support/tracker/en/api/queues/workflows/get-workflows.md)                 |
| `tracker_get_workflow`               | `GET /v3/workflows/{workflowId}`                                     | read   | [queues/workflows/get-workflow](https://yandex.ru/support/tracker/en/api/queues/workflows/get-workflow.md)                   |
| `tracker_patch_workflow`             | `PATCH /v3/workflows/{workflowId}`                                   | modify | [queues/workflows/patch-workflow](https://yandex.ru/support/tracker/en/api/queues/workflows/patch-workflow.md)               |
| `tracker_patch_workflow_action`      | `PATCH /v3/workflows/{workflowId}/steps/{status}/actions/{actionId}` | modify | [queues/workflows/patch-workflow-action](https://yandex.ru/support/tracker/en/api/queues/workflows/patch-workflow-action.md) |
| `tracker_delete_workflow`            | `DELETE /v3/workflows/{workflowId}`                                  | modify | [queues/workflows/delete-workflow](https://yandex.ru/support/tracker/en/api/queues/workflows/delete-workflow.md)             |
| `tracker_create_autoaction`          | `POST /v3/queues/{queueId}/autoactions`                              | create | [queues/create-autoaction](https://yandex.ru/support/tracker/en/api/queues/create-autoaction.md)                             |
| `tracker_get_autoaction`             | `GET /v3/queues/{queueId}/autoactions/{autoactionId}`                | read   | [queues/get-autoaction](https://yandex.ru/support/tracker/en/api/queues/get-autoaction.md)                                   |
| `tracker_get_autoaction_logs`        | `GET /v3/queues/{queueId}/autoactions/{autoactionId}/logs`           | read   | [queues/view-autoaction-logs](https://yandex.ru/support/tracker/en/api/queues/view-autoaction-logs.md)                       |
| `tracker_get_autoaction_run_log`     | `GET /v3/queues/{queueId}/autoactions/{autoactionId}/logs/{runId}`   | read   | [queues/view-autoaction-logs](https://yandex.ru/support/tracker/en/api/queues/view-autoaction-logs.md)                       |
| `tracker_create_trigger`             | `POST /v3/queues/{queueId}/triggers`                                 | create | [queues/create-trigger](https://yandex.ru/support/tracker/en/api/queues/create-trigger.md)                                   |
| `tracker_get_triggers`               | `GET /v3/queues/{queueId}/triggers`                                  | read   | [queues/get-triggers](https://yandex.ru/support/tracker/en/api/queues/get-triggers.md)                                       |
| `tracker_get_trigger`                | `GET /v3/queues/{queueId}/triggers/{triggerId}`                      | read   | [queues/get-trigger](https://yandex.ru/support/tracker/en/api/queues/get-trigger.md)                                         |
| `tracker_patch_trigger`              | `PATCH /v3/queues/{queueId}/triggers/{triggerId}`                    | modify | [queues/change-trigger](https://yandex.ru/support/tracker/en/api/queues/change-trigger.md)                                   |
| `tracker_get_trigger_webhook_log`    | `GET /v3/queues/{queueId}/triggers/{triggerId}/webhooks/log`         | read   | [queues/view-trigger-logs](https://yandex.ru/support/tracker/en/api/queues/view-trigger-logs.md)                             |
| `tracker_get_components`             | `GET /v3/components`                                                 | read   | [queues/get-components](https://yandex.ru/support/tracker/en/api/queues/get-components.md)                                   |
| `tracker_create_component`           | `POST /v3/components`                                                | create | [queues/post-component](https://yandex.ru/support/tracker/en/api/queues/post-component.md)                                   |
| `tracker_patch_component`            | `PATCH /v3/components/{componentId}`                                 | modify | [queues/patch-component](https://yandex.ru/support/tracker/en/api/queues/patch-component.md)                                 |
| `tracker_get_component_user_access`  | `GET /v3/components/{componentId}/permissions/users/{userId}`        | read   | [queues/get-component-user-access](https://yandex.ru/support/tracker/en/api/queues/get-component-user-access.md)             |
| `tracker_get_component_group_access` | `GET /v3/components/{componentId}/permissions/groups/{groupId}`      | read   | [queues/get-component-group-access](https://yandex.ru/support/tracker/en/api/queues/get-component-group-access.md)           |

### Bulk operations — 5 endpoints

The same edit, move or transition applied to up to 10,000 issues, and the status of the operation.

| Name                             | Endpoint                                   | Effect | Documentation                                                                                              |
| -------------------------------- | ------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------- |
| `tracker_bulk_update_issues`     | `POST /v3/bulkchange/_update`              | modify | [bulkchange/bulk-update-issues](https://yandex.ru/support/tracker/en/api/bulkchange/bulk-update-issues.md) |
| `tracker_bulk_move_issues`       | `POST /v3/bulkchange/_move`                | modify | [bulkchange/bulk-move-issues](https://yandex.ru/support/tracker/en/api/bulkchange/bulk-move-issues.md)     |
| `tracker_bulk_transition_issues` | `POST /v3/bulkchange/_transition`          | modify | [bulkchange/bulk-transition](https://yandex.ru/support/tracker/en/api/bulkchange/bulk-transition.md)       |
| `tracker_get_bulkchange`         | `GET /v3/bulkchange/{bulkchangeId}`        | read   | [bulkchange/bulk-move-info](https://yandex.ru/support/tracker/en/api/bulkchange/bulk-move-info.md)         |
| `tracker_get_bulkchange_issues`  | `GET /v3/bulkchange/{bulkchangeId}/issues` | read   | [bulkchange/bulk-move-info](https://yandex.ru/support/tracker/en/api/bulkchange/bulk-move-info.md)         |

### Import — 6 endpoints

Issues, comments, links, worklog records and files brought in from another tracker with their original authors and dates.

| Name                                | Endpoint                                                             | Effect | Documentation                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| `tracker_import_issue`              | `POST /v3/issues/_import`                                            | create | [import/import-ticket](https://yandex.ru/support/tracker/en/api/import/import-ticket.md)           |
| `tracker_import_comment`            | `POST /v3/issues/{issueId}/comments/_import`                         | create | [import/import-comments](https://yandex.ru/support/tracker/en/api/import/import-comments.md)       |
| `tracker_import_link`               | `POST /v3/issues/{issueId}/links/_import`                            | create | [import/import-links](https://yandex.ru/support/tracker/en/api/import/import-links.md)             |
| `tracker_import_worklog`            | `POST /v3/issues/{issueId}/worklogs/_import`                         | create | [import/import-worklogs](https://yandex.ru/support/tracker/en/api/import/import-worklogs.md)       |
| `tracker_import_attachment`         | `POST /v3/issues/{issueId}/attachments/_import`                      | create | [import/import-attachments](https://yandex.ru/support/tracker/en/api/import/import-attachments.md) |
| `tracker_import_comment_attachment` | `POST /v3/issues/{issueId}/comments/{commentId}/attachments/_import` | create | [import/import-attachments](https://yandex.ru/support/tracker/en/api/import/import-attachments.md) |

### Saved filters — 3 endpoints

The issue filters saved in the Tracker interface.

| Name                    | Endpoint                       | Effect | Documentation                                                                              |
| ----------------------- | ------------------------------ | ------ | ------------------------------------------------------------------------------------------ |
| `tracker_get_filter`    | `GET /v3/filters/{filterId}`   | read   | [filters/get-filter](https://yandex.ru/support/tracker/en/api/filters/get-filter.md)       |
| `tracker_create_filter` | `POST /v3/filters/`            | create | [filters/create-filter](https://yandex.ru/support/tracker/en/api/filters/create-filter.md) |
| `tracker_update_filter` | `PATCH /v3/filters/{filterId}` | modify | [filters/update-filter](https://yandex.ru/support/tracker/en/api/filters/update-filter.md) |

### Queue macros — 5 endpoints

The macros a queue offers when working on an issue.

| Name                   | Endpoint                                       | Effect | Documentation                                                              |
| ---------------------- | ---------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| `tracker_get_macros`   | `GET /v3/queues/{queueId}/macros`              | read   | [get-macroses](https://yandex.ru/support/tracker/en/api/get-macroses.md)   |
| `tracker_get_macro`    | `GET /v3/queues/{queueId}/macros/{macroId}`    | read   | [get-macros](https://yandex.ru/support/tracker/en/api/get-macros.md)       |
| `tracker_create_macro` | `POST /v3/queues/{queueId}/macros`             | create | [post-macros](https://yandex.ru/support/tracker/en/api/post-macros.md)     |
| `tracker_patch_macro`  | `PATCH /v3/queues/{queueId}/macros/{macroId}`  | modify | [patch-macros](https://yandex.ru/support/tracker/en/api/patch-macros.md)   |
| `tracker_delete_macro` | `DELETE /v3/queues/{queueId}/macros/{macroId}` | modify | [delete-macros](https://yandex.ru/support/tracker/en/api/delete-macros.md) |

### Boards & sprints — 18 endpoints

Boards, their columns, and sprints.

| Name                          | Endpoint                                         | Effect | Documentation                                                                                        |
| ----------------------------- | ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------- |
| `tracker_get_boards`          | `GET /v3/boards`                                 | read   | [boards/get-boards](https://yandex.ru/support/tracker/en/api/boards/get-boards.md)                   |
| `tracker_get_boards_paginate` | `GET /v3/boards/_paginate`                       | read   | [boards/get-boards-paginate](https://yandex.ru/support/tracker/en/api/boards/get-boards-paginate.md) |
| `tracker_get_board`           | `GET /v3/boards/{boardId}`                       | read   | [boards/get-board](https://yandex.ru/support/tracker/en/api/boards/get-board.md)                     |
| `tracker_create_board`        | `POST /v3/boards/`                               | create | [boards/post-board](https://yandex.ru/support/tracker/en/api/boards/post-board.md)                   |
| `tracker_patch_board`         | `PATCH /v3/boards/{boardId}`                     | modify | [boards/patch-board](https://yandex.ru/support/tracker/en/api/boards/patch-board.md)                 |
| `tracker_delete_board`        | `DELETE /v3/boards/{boardId}`                    | modify | [boards/delete-board](https://yandex.ru/support/tracker/en/api/boards/delete-board.md)               |
| `tracker_get_board_columns`   | `GET /v3/boards/{boardId}/columns`               | read   | [boards/get-columns](https://yandex.ru/support/tracker/en/api/boards/get-columns.md)                 |
| `tracker_get_board_column`    | `GET /v3/boards/{boardId}/columns/{columnId}`    | read   | [boards/get-column](https://yandex.ru/support/tracker/en/api/boards/get-column.md)                   |
| `tracker_create_board_column` | `POST /v3/boards/{boardId}/columns/`             | create | [boards/post-column](https://yandex.ru/support/tracker/en/api/boards/post-column.md)                 |
| `tracker_patch_board_column`  | `PATCH /v3/boards/{boardId}/columns/{columnId}`  | modify | [boards/patch-column](https://yandex.ru/support/tracker/en/api/boards/patch-column.md)               |
| `tracker_delete_board_column` | `DELETE /v3/boards/{boardId}/columns/{columnId}` | modify | [boards/delete-column](https://yandex.ru/support/tracker/en/api/boards/delete-column.md)             |
| `tracker_get_board_sprints`   | `GET /v3/boards/{boardId}/sprints`               | read   | [boards/get-sprints](https://yandex.ru/support/tracker/en/api/boards/get-sprints.md)                 |
| `tracker_get_sprint`          | `GET /v3/sprints/{sprintId}`                     | read   | [boards/get-sprint](https://yandex.ru/support/tracker/en/api/boards/get-sprint.md)                   |
| `tracker_create_sprint`       | `POST /v3/sprints`                               | create | [boards/post-sprint](https://yandex.ru/support/tracker/en/api/boards/post-sprint.md)                 |
| `tracker_patch_sprint`        | `PATCH /v3/sprints/{sprintId}`                   | modify | [boards/patch-sprint](https://yandex.ru/support/tracker/en/api/boards/patch-sprint.md)               |
| `tracker_start_sprint`        | `POST /v3/sprints/{sprintId}/_start`             | modify | [boards/start-sprint](https://yandex.ru/support/tracker/en/api/boards/start-sprint.md)               |
| `tracker_archive_sprint`      | `POST /v3/sprints/{sprintId}/_archive`           | modify | [boards/archive-sprint](https://yandex.ru/support/tracker/en/api/boards/archive-sprint.md)           |
| `tracker_delete_sprint`       | `DELETE /v3/sprints/{sprintId}`                  | modify | [boards/delete-sprint](https://yandex.ru/support/tracker/en/api/boards/delete-sprint.md)             |

### Projects, portfolios & goals — 30 endpoints

The `entities` API, with their comments, checklists, attachments, links and permissions.

| Name                                        | Endpoint                                                                           | Effect | Documentation                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `tracker_create_entity`                     | `POST /v3/entities/{entityType}`                                                   | create | [entities/create-entity](https://yandex.ru/support/tracker/en/api/entities/create-entity.md)                                       |
| `tracker_get_entity`                        | `GET /v3/entities/{entityType}/{entityId}`                                         | read   | [entities/get-entity](https://yandex.ru/support/tracker/en/api/entities/get-entity.md)                                             |
| `tracker_update_entity`                     | `PATCH /v3/entities/{entityType}/{entityId}`                                       | modify | [entities/update-entity](https://yandex.ru/support/tracker/en/api/entities/update-entity.md)                                       |
| `tracker_delete_entity`                     | `DELETE /v3/entities/{entityType}/{entityId}`                                      | modify | [entities/delete-entity](https://yandex.ru/support/tracker/en/api/entities/delete-entity.md)                                       |
| `tracker_search_entities`                   | `POST /v3/entities/{entityType}/_search`                                           | read   | [entities/search-entities](https://yandex.ru/support/tracker/en/api/entities/search-entities.md)                                   |
| `tracker_bulkchange_entities`               | `POST /v3/entities/{entityType}/bulkchange/_update`                                | modify | [entities/bulkchange-entities](https://yandex.ru/support/tracker/en/api/entities/bulkchange-entities.md)                           |
| `tracker_get_entity_events`                 | `GET /v3/entities/{entityType}/{entityId}/events/_relative`                        | read   | [entities/get-events-relative](https://yandex.ru/support/tracker/en/api/entities/get-events-relative.md)                           |
| `tracker_entity_add_comment`                | `POST /v3/entities/{entityType}/{entityId}/comments`                               | create | [entities/comments/add-comment](https://yandex.ru/support/tracker/en/api/entities/comments/add-comment.md)                         |
| `tracker_entity_patch_comment`              | `PATCH /v3/entities/{entityType}/{entityId}/comments/{commentId}`                  | modify | [entities/comments/patch-comment](https://yandex.ru/support/tracker/en/api/entities/comments/patch-comment.md)                     |
| `tracker_entity_get_comments`               | `GET /v3/entities/{entityType}/{entityId}/comments`                                | read   | [entities/comments/get-all-comments](https://yandex.ru/support/tracker/en/api/entities/comments/get-all-comments.md)               |
| `tracker_entity_get_comments_relative`      | `GET /v3/entities/{entityType}/{entityId}/comments/_relative`                      | read   | [entities/comments/get-all-comments](https://yandex.ru/support/tracker/en/api/entities/comments/get-all-comments.md)               |
| `tracker_entity_get_comment`                | `GET /v3/entities/{entityType}/{entityId}/comments/{commentId}`                    | read   | [entities/comments/get-comment](https://yandex.ru/support/tracker/en/api/entities/comments/get-comment.md)                         |
| `tracker_entity_delete_comment`             | `DELETE /v3/entities/{entityType}/{entityId}/comments/{commentId}`                 | modify | [entities/comments/delete-comment](https://yandex.ru/support/tracker/en/api/entities/comments/delete-comment.md)                   |
| `tracker_entity_add_checklist_item`         | `POST /v3/entities/{entityType}/{entityId}/checklistItems`                         | create | [entities/checklists/add-checklist](https://yandex.ru/support/tracker/en/api/entities/checklists/add-checklist.md)                 |
| `tracker_entity_patch_checklist`            | `PATCH /v3/entities/{entityType}/{entityId}/checklistItems`                        | modify | [entities/checklists/patch-checklist](https://yandex.ru/support/tracker/en/api/entities/checklists/patch-checklist.md)             |
| `tracker_entity_patch_checklist_item`       | `PATCH /v3/entities/{entityType}/{entityId}/checklistItems/{checklistItemId}`      | modify | [entities/checklists/patch-checklist-item](https://yandex.ru/support/tracker/en/api/entities/checklists/patch-checklist-item.md)   |
| `tracker_entity_move_checklist_item`        | `POST /v3/entities/{entityType}/{entityId}/checklistItems/{checklistItemId}/_move` | modify | [entities/checklists/move-checklist-item](https://yandex.ru/support/tracker/en/api/entities/checklists/move-checklist-item.md)     |
| `tracker_entity_delete_checklist`           | `DELETE /v3/entities/{entityType}/{entityId}/checklistItems`                       | modify | [entities/checklists/delete-checklist](https://yandex.ru/support/tracker/en/api/entities/checklists/delete-checklist.md)           |
| `tracker_entity_delete_checklist_item`      | `DELETE /v3/entities/{entityType}/{entityId}/checklistItems/{checklistItemId}`     | modify | [entities/checklists/delete-checklist-item](https://yandex.ru/support/tracker/en/api/entities/checklists/delete-checklist-item.md) |
| `tracker_entity_get_attachments`            | `GET /v3/entities/{entityType}/{entityId}/attachments`                             | read   | [entities/attachments/get-all-attachments](https://yandex.ru/support/tracker/en/api/entities/attachments/get-all-attachments.md)   |
| `tracker_entity_get_attachment`             | `GET /v3/entities/{entityType}/{entityId}/attachments/{fileId}`                    | read   | [entities/attachments/get-attachment](https://yandex.ru/support/tracker/en/api/entities/attachments/get-attachment.md)             |
| `tracker_entity_add_attachment`             | `POST /v3/entities/{entityType}/{entityId}/attachments/{fileId}`                   | create | [entities/attachments/add-attachment](https://yandex.ru/support/tracker/en/api/entities/attachments/add-attachment.md)             |
| `tracker_entity_delete_attachment`          | `DELETE /v3/entities/{entityType}/{entityId}/attachments/{fileId}`                 | modify | [entities/attachments/delete-attachment](https://yandex.ru/support/tracker/en/api/entities/attachments/delete-attachment.md)       |
| `tracker_entity_add_links`                  | `POST /v3/entities/{entityType}/{entityId}/links`                                  | create | [entities/links/add-links](https://yandex.ru/support/tracker/en/api/entities/links/add-links.md)                                   |
| `tracker_entity_get_links`                  | `GET /v3/entities/{entityType}/{entityId}/links`                                   | read   | [entities/links/get-links](https://yandex.ru/support/tracker/en/api/entities/links/get-links.md)                                   |
| `tracker_entity_delete_link`                | `DELETE /v3/entities/{entityType}/{entityId}/links`                                | modify | [entities/links/delete-link](https://yandex.ru/support/tracker/en/api/entities/links/delete-link.md)                               |
| `tracker_entity_get_permissions`            | `GET /v3/entities/{entityType}/{entityId}/permissions`                             | read   | [entities/get-access](https://yandex.ru/support/tracker/en/api/entities/get-access.md)                                             |
| `tracker_entity_get_extended_permissions`   | `GET /v3/entities/{entityType}/{entityId}/extendedPermissions`                     | read   | [entities/get-access](https://yandex.ru/support/tracker/en/api/entities/get-access.md)                                             |
| `tracker_entity_patch_permissions`          | `PATCH /v3/entities/{entityType}/{entityId}/permissions`                           | modify | [entities/patch-access](https://yandex.ru/support/tracker/en/api/entities/patch-access.md)                                         |
| `tracker_entity_patch_extended_permissions` | `PATCH /v3/entities/{entityType}/{entityId}/extendedPermissions`                   | modify | [entities/patch-access](https://yandex.ru/support/tracker/en/api/entities/patch-access.md)                                         |

### Projects (older API) — 6 endpoints

The projects API that predates `entities`; every page recommends its entity counterpart.

| Name                         | Endpoint                              | Effect | Documentation                                                                                          |
| ---------------------------- | ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `tracker_get_projects`       | `GET /v3/projects`                    | read   | [projects/get-projects](https://yandex.ru/support/tracker/en/api/projects/get-projects.md)             |
| `tracker_get_project`        | `GET /v3/projects/{projectId}`        | read   | [projects/get-project](https://yandex.ru/support/tracker/en/api/projects/get-project.md)               |
| `tracker_get_project_queues` | `GET /v3/projects/{projectId}/queues` | read   | [projects/get-project-queues](https://yandex.ru/support/tracker/en/api/projects/get-project-queues.md) |
| `tracker_create_project`     | `POST /v3/projects/`                  | create | [projects/create-project](https://yandex.ru/support/tracker/en/api/projects/create-project.md)         |
| `tracker_update_project`     | `PUT /v3/projects/{projectId}`        | modify | [projects/update-project](https://yandex.ru/support/tracker/en/api/projects/update-project.md)         |
| `tracker_delete_project`     | `DELETE /v3/projects/{projectId}`     | modify | [projects/delete-project](https://yandex.ru/support/tracker/en/api/projects/delete-project.md)         |

### Dashboards — 2 endpoints

Dashboards and the Cycle time widget.

| Name                               | Endpoint                                              | Effect | Documentation                                                                                          |
| ---------------------------------- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `tracker_create_dashboard`         | `POST /v3/dashboards/`                                | create | [dashboards/create-dashboard](https://yandex.ru/support/tracker/en/api/dashboards/create-dashboard.md) |
| `tracker_create_cycle_time_widget` | `POST /v3/dashboards/{dashboardId}/widgets/cycleTime` | create | [dashboards/create-widget](https://yandex.ru/support/tracker/en/api/dashboards/create-widget.md)       |

### Absences — 3 endpoints

Employee absences: vacations, sick leaves and duty shifts.

| Name                  | Endpoint                | Effect | Documentation                                                                    |
| --------------------- | ----------------------- | ------ | -------------------------------------------------------------------------------- |
| `tracker_create_gaps` | `POST /v3/gaps`         | create | [gaps/post-gaps](https://yandex.ru/support/tracker/en/api/gaps/post-gaps.md)     |
| `tracker_search_gaps` | `POST /v3/gaps/_search` | read   | [gaps/search-gaps](https://yandex.ru/support/tracker/en/api/gaps/search-gaps.md) |
| `tracker_delete_gaps` | `DELETE /v3/gaps`       | modify | [gaps/delete-gaps](https://yandex.ru/support/tracker/en/api/gaps/delete-gaps.md) |

### Reference dictionaries — 12 endpoints

Issue types, statuses, resolutions and priorities.

| Name                        | Endpoint                               | Effect | Documentation                                                                                  |
| --------------------------- | -------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `tracker_get_issuetypes`    | `GET /v3/issuetypes`                   | read   | [admin/get-issue-types](https://yandex.ru/support/tracker/en/api/admin/get-issue-types.md)     |
| `tracker_create_issuetype`  | `POST /v3/issuetypes/`                 | create | [admin/create-issue-type](https://yandex.ru/support/tracker/en/api/admin/create-issue-type.md) |
| `tracker_patch_issuetype`   | `PATCH /v3/issuetypes/{issueTypeId}`   | modify | [admin/patch-issue-type](https://yandex.ru/support/tracker/en/api/admin/patch-issue-type.md)   |
| `tracker_get_statuses`      | `GET /v3/statuses`                     | read   | [admin/get-statuses](https://yandex.ru/support/tracker/en/api/admin/get-statuses.md)           |
| `tracker_create_status`     | `POST /v3/statuses/`                   | create | [admin/create-status](https://yandex.ru/support/tracker/en/api/admin/create-status.md)         |
| `tracker_patch_status`      | `PATCH /v3/statuses/{statusId}`        | modify | [admin/patch-status](https://yandex.ru/support/tracker/en/api/admin/patch-status.md)           |
| `tracker_get_resolutions`   | `GET /v3/resolutions`                  | read   | [admin/get-resolutions](https://yandex.ru/support/tracker/en/api/admin/get-resolutions.md)     |
| `tracker_create_resolution` | `POST /v3/resolutions/`                | create | [admin/create-resolution](https://yandex.ru/support/tracker/en/api/admin/create-resolution.md) |
| `tracker_patch_resolution`  | `PATCH /v3/resolutions/{resolutionId}` | modify | [admin/patch-resolution](https://yandex.ru/support/tracker/en/api/admin/patch-resolution.md)   |
| `tracker_get_priorities`    | `GET /v3/priorities`                   | read   | [admin/get-priorities](https://yandex.ru/support/tracker/en/api/admin/get-priorities.md)       |
| `tracker_create_priority`   | `POST /v3/priorities/`                 | create | [admin/create-priority](https://yandex.ru/support/tracker/en/api/admin/create-priority.md)     |
| `tracker_patch_priority`    | `PATCH /v3/priorities/{priorityId}`    | modify | [admin/patch-priority](https://yandex.ru/support/tracker/en/api/admin/patch-priority.md)       |

### Users — 4 endpoints

The organization's users and the token owner.

| Name                         | Endpoint                  | Effect | Documentation                                                                                    |
| ---------------------------- | ------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `tracker_get_myself`         | `GET /v3/myself`          | read   | [users/get-user-info](https://yandex.ru/support/tracker/en/api/users/get-user-info.md)           |
| `tracker_get_users`          | `GET /v3/users`           | read   | [users/get-users](https://yandex.ru/support/tracker/en/api/users/get-users.md)                   |
| `tracker_get_user`           | `GET /v3/users/{userId}`  | read   | [users/get-user](https://yandex.ru/support/tracker/en/api/users/get-user.md)                     |
| `tracker_get_users_relative` | `GET /v3/users/_relative` | read   | [users/get-users-relative](https://yandex.ru/support/tracker/en/api/users/get-users-relative.md) |

<!-- tools:end -->
