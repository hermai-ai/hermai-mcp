# Hermai MCP Distribution

Canonical install:

```bash
npx -y hermai-mcp
```

MCP client config:

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

Official MCP Registry:

- Server: `io.github.hermai-ai/hermai-mcp`
- Package: `hermai-mcp`
- Status: active

Deprecated registry entry:

- Server: `io.github.hermai-ai/hermai-cli`
- Package: `hermai-cli`
- Status: deprecated
- Reason: MCP moved to the dedicated `hermai-mcp` package.

## Listing Copy

Short description:

> Hermai MCP exposes website API schema lookup, schema-request intake, and browser-workflow classification to agent runtimes.

Long description:

> Hermai is a registry of website API schemas for agents. The Hermai MCP server lets MCP-capable agents look up public schemas, page through the catalog, submit six-field schema requests for brittle browser/API workflows, classify whether a workflow maps to direct API, hidden endpoint, browser-only, or owner-auth paths, and check request status. Public lookup and request intake work without an API key.

Tags:

- MCP
- AI agents
- browser automation
- website APIs
- schema registry
- agent tools

Repository:

```text
https://github.com/hermai-ai/hermai-mcp
```

npm:

```text
https://www.npmjs.com/package/hermai-mcp
```

## Directory Checklist

Smithery:

- Submit `https://github.com/hermai-ai/hermai-mcp`.
- Use the listing copy above.
- If Smithery requires a hosted Streamable HTTP endpoint, do not submit this stdio package as a remote endpoint; use the official MCP Registry listing and revisit when Hermai ships a remote MCP gateway.

Glama:

- Add or claim `https://github.com/hermai-ai/hermai-mcp`.
- `glama.json` is present at repo root.
- Use the listing copy above.

PulseMCP:

- Wait for Official MCP Registry ingestion first.
- If not listed after seven days, manually submit `io.github.hermai-ai/hermai-mcp` and `https://github.com/hermai-ai/hermai-mcp`.

GitHub topics to keep on the repo:

- `mcp`
- `model-context-protocol`
- `ai-agents`
- `browser-automation`
- `schema-registry`
- `website-apis`
