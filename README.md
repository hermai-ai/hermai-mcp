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
