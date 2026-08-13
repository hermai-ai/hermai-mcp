# Hermai MCP

Dedicated Model Context Protocol server for Hermai.

Use this package when an agent runtime supports MCP and should call Hermai as native tools. The Hermai CLI is a separate human/operator tool and is not required for MCP.

## Install

Run directly with `npx`:

```bash
npx -y hermai-mcp
```

Or install globally:

```bash
npm install -g hermai-mcp
hermai-mcp
```

## MCP Client Config

```json
{
  "mcpServers": {
    "hermai": {
      "command": "npx",
      "args": ["-y", "hermai-mcp"]
    }
  }
}
```

Optional environment variables:

- `HERMAI_API_BASE` or `HERMAI_PLATFORM_URL`: API base URL. Defaults to `https://api.hermai.ai`.
- `HERMAI_API_KEY` or `HERMAI_PLATFORM_KEY`: API key for authenticated Hermai APIs. Public schema lookup and schema-request intake work without a key. Setting a key also unlocks the `fetch_schema` execution tool (see below).
- `HERMAI_FETCH_TIMEOUT_MS`: request timeout for `fetch_schema`. Defaults to `120000` (hosted fetch lanes can run tens of seconds).

## Claude Code workflow

Use the local MCP server when you want Claude Code to discover a schema, inspect
the available workflow, and make an authenticated read request. Hermai MCP is a
local stdio server. It is not a remote Claude connector.

Install Claude Code, then add Hermai to your personal Claude Code configuration:

```bash
export HERMAI_API_KEY='hm_sk_...'
claude mcp add --scope user hermai -e HERMAI_API_KEY="$HERMAI_API_KEY" -- npx -y hermai-mcp
unset HERMAI_API_KEY
```

The key is saved in your local Claude Code configuration. Do not put this command
in a repository, shared shell history, or a project scoped MCP configuration.

Confirm that Claude Code can see the server:

```bash
claude mcp list
```

Then start Claude Code and use this two step request:

```text
Use lookup_schema to find a verified public Hermai schema for [the source and task].
Before making a fetch, show me the site, endpoint, required parameters, and whether
the result can be retrieved with fetch_schema.
```

After you approve the selected workflow:

```text
Use fetch_schema with the site, endpoint, and parameters we selected. Return a short
summary of the records, then show credits_used, credits_remaining, and cached from
the response metadata.
```

`lookup_schema` is safe to use without a key. `fetch_schema` appears only when the
key is configured. It reads data through Hermai Cloud and consumes credits for a
successful request. Do not give the server browser cookies, bearer tokens, or a
request that changes data on another service.

For a full verification checklist and the expected failure paths, see
[the Claude Code guide](docs/claude-code.md).

## Tools

Always available (no key required):

- `lookup_schema` — search Hermai schemas by domain, task, category, or verification state.
- `list_public_schemas` — page through public schemas.
- `submit_schema_request` — submit the six-field intake for a brittle browser/API workflow.
- `classify_browser_workflow` — locally classify whether a workflow maps to direct API, hidden endpoint, browser-only, or owner/auth work.
- `check_schema_request_status` — check a schema request status.

Available only when `HERMAI_API_KEY` (or `HERMAI_PLATFORM_KEY`) is set:

- `fetch_schema` — execute a registered schema through hosted `/v1/fetch` and return live data. **Read-only data retrieval, and it consumes Hermai credits: a standard call costs 1 credit and some higher cost sites cost 5; only successful calls are billed.** Inputs: `site`, `endpoint` (resolve both with `lookup_schema` first; `endpoint` is case-sensitive), and optional `params`. The result includes the upstream `data` plus a meta summary (`credits_used`, `credits_remaining`, `latency_ms`, `cached`); failures surface the API `code` and `message`, plus `upgrade_to` and `upgrade_url` when a credit 402 offers an upgrade path. Use it for read workflows only — write/owner-approved workflows go through the Hermai CLI's signed-write path, not this tool.

Never submit cookies, bearer tokens, API keys, session IDs, or private session data through schema-request intake.
