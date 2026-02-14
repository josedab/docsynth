# DocSynth Examples

Runnable examples demonstrating how to interact with DocSynth programmatically.

## Quick Try (No Server Required)

```bash
# See the API example with mock data (no running services needed)
DEMO=true npx tsx examples/api-usage.ts

# See the SCM provider detection (no credentials needed)
npx tsx examples/scm-provider-usage.ts
```

## Full Examples (Requires Running Services)

Start the development environment first:

```bash
npm run quickstart   # One-command setup + start
```

Then in a separate terminal:

## Examples

### API Usage (`api-usage.ts`)

Demonstrates interacting with the DocSynth REST API (health check, list repos, search docs).

```bash
npx tsx examples/api-usage.ts
```

**Requires:** API server running at `http://localhost:3001` (started by `npm run dev`).

<details>
<summary>Expected output</summary>

```
DocSynth API Usage Example
Using API at: http://localhost:3001
==================================================

1. Checking API health...
   Status: { status: 'ok', version: '0.1.0', uptime: 12.345 }

2. Listing repositories...
   Repositories: [ { id: 1, name: "acme-app", fullName: "acme-corp/acme-app", ... } ]

3. Searching documents...
   Results: [ { id: 1, title: "Getting Started", ... } ]

4. Getting documentation health...
   Dashboard: { totalDocs: 5, freshDocs: 4, staleDocs: 1, coveragePercent: 80 }

Done! See full API docs at: http://localhost:3001/docs
```

</details>

### MCP Client (`mcp-client.ts`)

Demonstrates how an AI agent connects to the DocSynth MCP server and uses its tools, resources, and prompts.

```bash
npm run build                      # Build the MCP server first
npx tsx examples/mcp-client.ts
```

**Requires:** Project built (`npm run build`) and API server running. Optionally set `DOCSYNTH_API_TOKEN` for authenticated access.

<details>
<summary>Expected output</summary>

```
DocSynth MCP Client Example
==================================================

Connecting to DocSynth MCP server...
Connected!

1. Available Tools:
   - search-docs: Search documentation by query
   - check-doc-health: Check documentation health and freshness
   - generate-docs: Generate documentation for a repository
   - list-repositories: List connected repositories

2. Available Resources:
   - docsynth://docs: Documentation index
   - docsynth://health: Documentation health dashboard

3. Available Prompts:
   - review-docs: Review documentation for a code change
   - explain-code: Explain code using documentation context

4. Searching docs for "authentication"...
   Result: { content: [{ type: "text", text: "Found 2 results..." }] }

5. Checking documentation health...
   Result: { content: [{ type: "text", text: "Health: 4/5 docs fresh..." }] }

Done!
```

</details>

### SCM Provider Usage (`scm-provider-usage.ts`)

Demonstrates the multi-SCM provider abstraction layer for GitHub, GitLab, and Bitbucket. Runs the provider-detection example by default (no credentials needed). Uncomment individual examples in the file to test with real SCM credentials.

```bash
npx tsx examples/scm-provider-usage.ts
```

**Requires:** Project built (`npm run build`).

<details>
<summary>Expected output</summary>

```
GitHub: github
GitLab: gitlab
Bitbucket: bitbucket
Owner: facebook, Repo: react
```

</details>

### Config Templates (`config-templates/`)

Pre-built `.docsynth.json` configuration files for common project types. Copy one to your repository root:

| Template               | For                           |
| ---------------------- | ----------------------------- |
| `node-typescript.json` | Node.js / TypeScript projects |
| `python-fastapi.json`  | Python / FastAPI projects     |
| `go-module.json`       | Go module projects            |

```bash
cp examples/config-templates/node-typescript.json .docsynth.json
```
