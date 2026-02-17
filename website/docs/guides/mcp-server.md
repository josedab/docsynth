---
sidebar_position: 9
title: MCP Server
description: Integrate DocSynth with AI coding agents via the Model Context Protocol.
---

# MCP Server

DocSynth includes an MCP (Model Context Protocol) server that exposes documentation capabilities to AI coding agents like Claude Code, Cursor, and Windsurf.

## What Is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard for connecting AI assistants to external tools and data sources. DocSynth's MCP server lets AI agents:

- Query documentation health and drift status
- Trigger documentation generation
- Search the knowledge graph
- Access repository documentation context

## Installation

The MCP server ships as part of the DocSynth monorepo:

```bash
# From the monorepo root
npm run build --filter=@docsynth/mcp-server
```

Or install the standalone binary:

```bash
npm install -g @docsynth/mcp-server
```

## Configuration

### Claude Code

Add DocSynth to your Claude Code MCP settings (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "docsynth": {
      "command": "docsynth-mcp",
      "env": {
        "DOCSYNTH_API_TOKEN": "your_api_token",
        "DOCSYNTH_API_URL": "https://api.docsynth.dev"
      }
    }
  }
}
```

### Cursor

In Cursor settings, add the MCP server:

```json
{
  "mcp": {
    "servers": {
      "docsynth": {
        "command": "docsynth-mcp",
        "env": {
          "DOCSYNTH_API_TOKEN": "your_api_token"
        }
      }
    }
  }
}
```

### Self-Hosted

Point the server at your own DocSynth instance:

```json
{
  "mcpServers": {
    "docsynth": {
      "command": "docsynth-mcp",
      "env": {
        "DOCSYNTH_API_TOKEN": "your_api_token",
        "DOCSYNTH_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

## Available Tools

The MCP server exposes these tools to AI agents:

### Documentation Tools

| Tool                | Description                                               |
| ------------------- | --------------------------------------------------------- |
| `docsynth_generate` | Generate documentation for a repository or specific files |
| `docsynth_health`   | Get documentation health scores and drift status          |
| `docsynth_search`   | Search the knowledge graph by natural language query      |
| `docsynth_status`   | Check the status of a generation job                      |

### Repository Tools

| Tool                  | Description                                   |
| --------------------- | --------------------------------------------- |
| `docsynth_list_repos` | List connected repositories                   |
| `docsynth_get_doc`    | Retrieve a specific documentation file        |
| `docsynth_drift`      | Check for documentation drift in a repository |

## Resources

The server also exposes MCP resources that agents can read:

| Resource        | URI Pattern                    | Description                        |
| --------------- | ------------------------------ | ---------------------------------- |
| Repository docs | `docsynth://repos/{id}/docs`   | All documentation for a repository |
| Health report   | `docsynth://repos/{id}/health` | Current health metrics             |
| Knowledge graph | `docsynth://repos/{id}/graph`  | Entity relationship data           |

## Prompt Templates

Built-in prompts help AI agents use DocSynth effectively:

| Prompt              | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `document_code`     | Generate documentation for selected code             |
| `explain_code`      | Explain what code does using existing docs           |
| `check_health`      | Review documentation health and suggest improvements |
| `find_undocumented` | Identify code that lacks documentation               |

## Usage Examples

### Generate Docs via AI Agent

When connected to an AI agent, you can say:

> "Use DocSynth to generate documentation for the authentication module"

The agent calls `docsynth_generate` with the relevant file paths and returns the generated documentation.

### Check Documentation Health

> "Check the documentation health for my project"

The agent calls `docsynth_health` and reports:

```
Documentation Health: 87/100

✅ Freshness: 92% — Most docs are up to date
⚠️ Coverage: 78% — 5 public exports lack documentation
✅ Link Health: 100% — No broken links
✅ Style: 91% — Consistent tone and formatting

Suggested actions:
1. Document UserService.updateProfile() in src/services/user.ts
2. Update docs/api/auth.md (14 days since last code change)
```

### Search Knowledge Graph

> "How does the payment processing flow work?"

The agent calls `docsynth_search` and synthesizes an answer from the knowledge graph, linking to relevant code and documentation.

## Environment Variables

| Variable             | Required | Description                                        |
| -------------------- | -------- | -------------------------------------------------- |
| `DOCSYNTH_API_TOKEN` | Yes      | API authentication token                           |
| `DOCSYNTH_API_URL`   | No       | API base URL (default: `https://api.docsynth.dev`) |
| `DOCSYNTH_LOG_LEVEL` | No       | Log level: `debug`, `info`, `warn`, `error`        |

## Architecture

The MCP server communicates over stdio and acts as a bridge between AI agents and the DocSynth API:

```
┌─────────────┐     stdio     ┌──────────────┐     HTTP     ┌──────────────┐
│  AI Agent   │──────────────▶│  MCP Server  │─────────────▶│  DocSynth    │
│  (Claude,   │◀──────────────│  (docsynth-  │◀─────────────│  API         │
│   Cursor)   │               │   mcp)       │              │  (:3001)     │
└─────────────┘               └──────────────┘              └──────────────┘
```

## Troubleshooting

### Server Not Starting

```bash
# Test the server directly
echo '{"jsonrpc":"2.0","method":"initialize","id":1}' | docsynth-mcp
```

If you get a JSON response, the server is working. Check your AI agent's MCP configuration.

### Authentication Errors

1. Verify your `DOCSYNTH_API_TOKEN` is valid
2. Check the token hasn't expired
3. Ensure the token has access to the repositories you're querying

### Connection Issues (Self-Hosted)

1. Verify `DOCSYNTH_API_URL` is correct and reachable
2. Check that the API server is running: `curl http://localhost:3001/health`
3. Ensure no firewall rules block the connection

## Next Steps

- [Getting Started](/docs/getting-started) — Set up DocSynth
- [API Reference](/docs/api-reference) — Full API documentation
- [Knowledge Graphs](/docs/advanced/knowledge-graphs) — Understand the graph search
- [VS Code Extension](/docs/guides/vscode-extension) — IDE integration
