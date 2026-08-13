# Claude Code guide

This guide verifies one complete Hermai workflow in Claude Code. The result is a
repeatable way for Claude to discover a supported source, inspect its request
contract, fetch data with your approval, and report the useful result metadata.

## What this supports

The `hermai-mcp` package runs as a local stdio MCP server. Claude Code starts it
on your machine. Hermai does not currently expose a remote MCP connector or an
OAuth sign in flow for Claude.

The server exposes these tools without a Hermai key:

* `lookup_schema`
* `list_public_schemas`
* `classify_browser_workflow`
* `submit_schema_request`
* `check_schema_request_status`

With `HERMAI_API_KEY` or `HERMAI_PLATFORM_KEY`, it also exposes `fetch_schema`.
That tool only retrieves data. It cannot write to a source website, but a
successful request consumes Hermai credits.

## Setup

1. Install Claude Code using Anthropic's current instructions.
2. Sign in at Hermai and create a personal API key.
3. Add the MCP server to your personal Claude Code configuration:

```bash
export HERMAI_API_KEY='hm_sk_...'
claude mcp add --scope user hermai -e HERMAI_API_KEY="$HERMAI_API_KEY" -- npx -y hermai-mcp
unset HERMAI_API_KEY
```

4. Run `claude mcp list`. It must show `hermai` before you open a Claude Code
   session.

Use `--scope user` for a personal key. Do not use project scope, commit a key,
or paste a key into the Claude conversation.

## Verify the tools

Start Claude Code and send this prompt:

```text
List the Hermai tools available to you. Do not make a request.
```

Expected result:

* The five discovery and request intake tools are present.
* `fetch_schema` is present only when the key was configured.

If `fetch_schema` is absent, remove and add the MCP server again with a valid
personal key. Do not add the key to a repository file.

## Discover before fetching

Ask Claude to resolve the source and request contract first:

```text
I need [a real data task]. Use lookup_schema to find a verified public source.
Do not fetch yet. Show the exact site, endpoint, parameters, and why this source
fits the task. If no source is ready, tell me whether submit_schema_request is the
right next step.
```

Check the answer before you approve a fetch:

* The site and endpoint came from `lookup_schema`.
* Required parameters are explicit.
* The request is read only.
* The expected output matches the task.
* The agent does not claim a source is supported when lookup found no usable
  endpoint.

## Fetch with a bounded result

When the source and parameters are correct, send this prompt:

```text
Use fetch_schema with the exact site, endpoint, and parameters we selected.
Return a short summary of the data. Then report credits_used, credits_remaining,
and cached from the response metadata. Do not call any other tools.
```

This verifies all four parts of the workflow:

1. Claude discovered the source through Hermai.
2. You inspected the request before it ran.
3. Claude made one authenticated data request.
4. Claude exposed the response metadata needed to verify the call.

## Expected failure paths

* No key configured: `fetch_schema` is absent. Add a personal key through
  Claude Code user scope.
* No schema found: Claude does not invent an endpoint. Use
  `submit_schema_request` with the real workflow details.
* Insufficient credits: the tool returns a 402 response with an upgrade path
  when available. Add credits or choose a different verified source.
* Source requires a write action: Claude does not use `fetch_schema`. Use the
  Hermai CLI only after the user authorizes the real action.
* Request needs browser cookies: Claude does not paste or collect private
  session data. Stop and use the documented local session path only with the
  owner's authorization.

## Release gate

Treat this workflow as ready to promote only when all of these are true:

* A new Claude Code installation lists the MCP server.
* A keyless installation exposes discovery tools but not `fetch_schema`.
* A key configured in user scope exposes `fetch_schema`.
* A real supported read workflow returns data and its metadata.
* A missing source produces a schema request path instead of a fabricated answer.
* No API key, cookie, or private session value appears in repository files,
  screenshots, or example transcripts.

Anthropic's [MCP overview](https://docs.anthropic.com/en/docs/mcp) documents
MCP support across Claude products. This local server workflow is for Claude
Code. A remote connector needs its own OAuth and remote transport design before
it can be offered in Claude settings.
