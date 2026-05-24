# Hermai MCP

Dedicated Model Context Protocol server for Hermai.

Use this package when an agent runtime supports MCP and should call Hermai as native tools. The Hermai CLI is a separate human/operator tool and is not required for MCP.

## Install

Run directly with `npx`:

```bash
npx -y @hermai/mcp
```

Or install globally:

```bash
npm install -g @hermai/mcp
hermai-mcp
```

## MCP Client Config

```json
{
  "mcpServers": {
    "hermai": {
      "command": "npx",
      "args": ["-y", "@hermai/mcp"]
    }
  }
}
```

Optional environment variables:

- `HERMAI_API_BASE` or `HERMAI_PLATFORM_URL`: API base URL. Defaults to `https://api.hermai.ai`.
- `HERMAI_API_KEY` or `HERMAI_PLATFORM_KEY`: optional API key for authenticated Hermai APIs. Public schema lookup and schema-request intake work without a key.

## Tools

- `lookup_schema` — search Hermai schemas by domain, task, category, or verification state.
- `list_public_schemas` — page through public schemas.
- `submit_schema_request` — submit the six-field intake for a brittle browser/API workflow.
- `classify_browser_workflow` — locally classify whether a workflow maps to direct API, hidden endpoint, browser-only, or owner/auth work.
- `check_schema_request_status` — check a schema request status.

Never submit cookies, bearer tokens, API keys, session IDs, or private session data through schema-request intake.
