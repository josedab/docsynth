---
sidebar_position: 5
title: SDK Reference
description: Official SDKs for programmatic access to DocSynth.
---

# SDK Reference

Official SDKs for integrating DocSynth into your applications and workflows.

## Available SDKs

| Language | Package | Status |
|----------|---------|--------|
| **Node.js/TypeScript** | `@docsynth/sdk` | ✅ Stable |
| **Python** | `docsynth` | ✅ Stable |
| **Go** | `github.com/docsynth/docsynth-go` | 🚧 Beta |

## Node.js / TypeScript

### Installation

```bash
npm install @docsynth/sdk
# or
yarn add @docsynth/sdk
# or
pnpm add @docsynth/sdk
```

### Quick Start

```typescript
import { DocSynth } from '@docsynth/sdk';

const client = new DocSynth({
  token: process.env.DOCSYNTH_API_TOKEN,
});

// List repositories
const repos = await client.repositories.list();
console.log(repos);

// Get a specific document
const doc = await client.documents.get('doc_abc123');
console.log(doc.content);
```

### Configuration

```typescript
import { DocSynth } from '@docsynth/sdk';

const client = new DocSynth({
  // Required
  token: 'YOUR_API_TOKEN',
  
  // Optional
  baseUrl: 'https://api.docsynth.dev', // Default
  timeout: 30000,                       // Request timeout (ms)
  retries: 3,                           // Retry failed requests
  debug: false,                         // Enable debug logging
});
```

### Repositories

```typescript
// List all repositories
const repos = await client.repositories.list({
  page: 1,
  perPage: 20,
  status: 'active',
});

// Get a repository
const repo = await client.repositories.get('repo_abc123');

// Update repository settings
await client.repositories.update('repo_abc123', {
  config: {
    triggers: { onPRMerge: true },
    docTypes: { readme: true, apiDocs: true },
  },
});

// Trigger documentation generation
const job = await client.repositories.generateDocs('repo_abc123', {
  branch: 'main',
  paths: ['src/**/*.ts'],
  dryRun: false,
});
```

### Documents

```typescript
// List documents for a repository
const docs = await client.documents.list({
  repositoryId: 'repo_abc123',
  type: 'readme',
});

// Get a document
const doc = await client.documents.get('doc_xyz789');

// Get document history
const history = await client.documents.getHistory('doc_xyz789', {
  limit: 10,
});

// Regenerate a document
const job = await client.documents.regenerate('doc_xyz789');
```

### Jobs

```typescript
// List jobs
const jobs = await client.jobs.list({
  repositoryId: 'repo_abc123',
  status: 'completed',
});

// Get job status
const job = await client.jobs.get('job_123');

// Wait for job completion
const completedJob = await client.jobs.waitForCompletion('job_123', {
  timeout: 60000,      // Max wait time
  pollInterval: 2000,  // Check every 2 seconds
});

// Retry a failed job
await client.jobs.retry('job_123');
```

### Knowledge Graph

```typescript
// Query the knowledge graph
const graph = await client.knowledgeGraph.query({
  repositoryId: 'repo_abc123',
  entityType: 'class',
  depth: 2,
});

// Semantic search
const results = await client.knowledgeGraph.search({
  repositoryId: 'repo_abc123',
  query: 'authentication flow',
  limit: 10,
});

// Impact analysis
const impact = await client.knowledgeGraph.analyzeImpact({
  repositoryId: 'repo_abc123',
  entityId: 'AuthService',
});
```

### Diagrams

```typescript
// Generate a diagram
const diagram = await client.diagrams.generate({
  repositoryId: 'repo_abc123',
  type: 'architecture',
  options: {
    maxNodes: 25,
    groupByPackage: true,
  },
});

console.log(diagram.mermaid); // Mermaid source
console.log(diagram.svg);     // Rendered SVG
```

### Translations

```typescript
// Get translation status
const status = await client.translations.getStatus({
  repositoryId: 'repo_abc123',
  language: 'es',
});

// Trigger translation
await client.translations.generate({
  repositoryId: 'repo_abc123',
  documentPath: 'docs/getting-started.md',
  targetLanguages: ['es', 'fr', 'ja'],
});

// Get quality report
const quality = await client.translations.getQuality({
  repositoryId: 'repo_abc123',
  language: 'es',
});
```

### Health & Drift

```typescript
// Get repository health
const health = await client.health.getRepositoryHealth('repo_abc123');

// Get drift status
const drift = await client.health.getDrift({
  repositoryId: 'repo_abc123',
  severity: 'warning',
});

// Acknowledge drift
await client.health.acknowledgeDrift({
  repositoryId: 'repo_abc123',
  documentPath: 'docs/api/users.md',
  reason: 'Intentionally outdated - deprecation notice',
});
```

### Webhooks

```typescript
// Verify webhook signature
import { verifyWebhookSignature } from '@docsynth/sdk';

const isValid = verifyWebhookSignature({
  payload: requestBody,
  signature: request.headers['x-docsynth-signature'],
  secret: process.env.DOCSYNTH_WEBHOOK_SECRET,
});
```

### Error Handling

```typescript
import { DocSynth, DocSynthError, NotFoundError, RateLimitError } from '@docsynth/sdk';

try {
  const doc = await client.documents.get('doc_invalid');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log('Document not found');
  } else if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}s`);
  } else if (error instanceof DocSynthError) {
    console.log(`API error: ${error.code} - ${error.message}`);
  } else {
    throw error;
  }
}
```

### TypeScript Types

All types are exported:

```typescript
import type {
  Repository,
  Document,
  DocumentVersion,
  Job,
  JobStatus,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  DriftAlert,
  TranslationStatus,
} from '@docsynth/sdk';
```

---

## Python

### Installation

```bash
pip install docsynth
# or
poetry add docsynth
```

### Quick Start

```python
from docsynth import DocSynth

client = DocSynth(token="YOUR_API_TOKEN")

# List repositories
repos = client.repositories.list()
for repo in repos:
    print(repo.name)

# Get a document
doc = client.documents.get("doc_abc123")
print(doc.content)
```

### Configuration

```python
from docsynth import DocSynth

client = DocSynth(
    token="YOUR_API_TOKEN",
    base_url="https://api.docsynth.dev",  # Default
    timeout=30.0,                          # Request timeout (seconds)
    retries=3,                             # Retry failed requests
    debug=False,                           # Enable debug logging
)
```

### Async Support

```python
from docsynth import AsyncDocSynth
import asyncio

async def main():
    client = AsyncDocSynth(token="YOUR_API_TOKEN")
    
    # All methods are async
    repos = await client.repositories.list()
    doc = await client.documents.get("doc_abc123")
    
    await client.close()

asyncio.run(main())
```

### Context Manager

```python
from docsynth import DocSynth

with DocSynth(token="YOUR_API_TOKEN") as client:
    repos = client.repositories.list()
    # Connection is automatically closed
```

### Repositories

```python
# List repositories
repos = client.repositories.list(
    page=1,
    per_page=20,
    status="active"
)

# Get a repository
repo = client.repositories.get("repo_abc123")

# Update settings
client.repositories.update("repo_abc123", config={
    "triggers": {"onPRMerge": True},
    "docTypes": {"readme": True, "apiDocs": True}
})

# Trigger generation
job = client.repositories.generate_docs("repo_abc123", branch="main")
```

### Documents

```python
# List documents
docs = client.documents.list(
    repository_id="repo_abc123",
    type="readme"
)

# Get document
doc = client.documents.get("doc_xyz789")
print(doc.content)

# Get history
history = client.documents.get_history("doc_xyz789", limit=10)

# Regenerate
job = client.documents.regenerate("doc_xyz789")
```

### Knowledge Graph

```python
# Query graph
graph = client.knowledge_graph.query(
    repository_id="repo_abc123",
    entity_type="class",
    depth=2
)

for node in graph.nodes:
    print(f"{node.entity_id} ({node.type})")

# Semantic search
results = client.knowledge_graph.search(
    repository_id="repo_abc123",
    query="authentication flow"
)

# Impact analysis
impact = client.knowledge_graph.analyze_impact(
    repository_id="repo_abc123",
    entity_id="AuthService"
)
print(f"Affects {impact.summary['transitiveImpact']} entities")
```

### Error Handling

```python
from docsynth import DocSynth
from docsynth.exceptions import (
    DocSynthError,
    NotFoundError,
    RateLimitError,
    AuthenticationError
)

try:
    doc = client.documents.get("doc_invalid")
except NotFoundError:
    print("Document not found")
except RateLimitError as e:
    print(f"Rate limited. Retry after {e.retry_after}s")
except AuthenticationError:
    print("Invalid API token")
except DocSynthError as e:
    print(f"API error: {e.code} - {e.message}")
```

### Type Hints

The Python SDK includes full type hints:

```python
from docsynth.types import Repository, Document, Job

def process_repo(repo: Repository) -> None:
    print(repo.name)
    print(repo.config.triggers)
```

---

## Go (Beta)

### Installation

```bash
go get github.com/docsynth/docsynth-go
```

### Quick Start

```go
package main

import (
    "context"
    "fmt"
    "github.com/docsynth/docsynth-go"
)

func main() {
    client := docsynth.NewClient("YOUR_API_TOKEN")
    
    // List repositories
    repos, err := client.Repositories.List(context.Background(), nil)
    if err != nil {
        panic(err)
    }
    
    for _, repo := range repos.Data {
        fmt.Println(repo.Name)
    }
}
```

### Configuration

```go
client := docsynth.NewClient(
    "YOUR_API_TOKEN",
    docsynth.WithBaseURL("https://api.docsynth.dev"),
    docsynth.WithTimeout(30 * time.Second),
    docsynth.WithRetries(3),
)
```

### Repositories

```go
// List repositories
repos, err := client.Repositories.List(ctx, &docsynth.ListOptions{
    Page:    1,
    PerPage: 20,
})

// Get a repository
repo, err := client.Repositories.Get(ctx, "repo_abc123")

// Trigger generation
job, err := client.Repositories.GenerateDocs(ctx, "repo_abc123", &docsynth.GenerateOptions{
    Branch: "main",
})
```

### Error Handling

```go
import "github.com/docsynth/docsynth-go/errors"

doc, err := client.Documents.Get(ctx, "doc_invalid")
if err != nil {
    var notFound *errors.NotFoundError
    var rateLimit *errors.RateLimitError
    
    switch {
    case errors.As(err, &notFound):
        fmt.Println("Document not found")
    case errors.As(err, &rateLimit):
        fmt.Printf("Rate limited. Retry after %v\n", rateLimit.RetryAfter)
    default:
        fmt.Printf("Error: %v\n", err)
    }
}
```

---

## Common Patterns

### Pagination

All SDKs support automatic pagination:

**Node.js:**
```typescript
// Auto-paginate through all results
for await (const repo of client.repositories.listAll()) {
  console.log(repo.name);
}
```

**Python:**
```python
# Auto-paginate through all results
for repo in client.repositories.list_all():
    print(repo.name)
```

### Polling for Job Completion

**Node.js:**
```typescript
const job = await client.repositories.generateDocs('repo_123');
const completed = await client.jobs.waitForCompletion(job.id, {
  timeout: 120000,
  onProgress: (status) => console.log(`Status: ${status}`),
});
```

**Python:**
```python
job = client.repositories.generate_docs("repo_123")
completed = client.jobs.wait_for_completion(
    job.id,
    timeout=120,
    on_progress=lambda status: print(f"Status: {status}")
)
```

### Webhook Handler

**Node.js (Express):**
```typescript
import express from 'express';
import { verifyWebhookSignature, WebhookEvent } from '@docsynth/sdk';

const app = express();

app.post('/webhooks/docsynth', express.raw({ type: 'application/json' }), (req, res) => {
  const isValid = verifyWebhookSignature({
    payload: req.body,
    signature: req.headers['x-docsynth-signature'] as string,
    secret: process.env.DOCSYNTH_WEBHOOK_SECRET!,
  });

  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }

  const event: WebhookEvent = JSON.parse(req.body);
  
  switch (event.type) {
    case 'document.generated':
      console.log(`Document generated: ${event.data.path}`);
      break;
    case 'drift.detected':
      console.log(`Drift detected: ${event.data.documentPath}`);
      break;
  }

  res.status(200).send('OK');
});
```

**Python (Flask):**
```python
from flask import Flask, request
from docsynth import verify_webhook_signature

app = Flask(__name__)

@app.route('/webhooks/docsynth', methods=['POST'])
def handle_webhook():
    is_valid = verify_webhook_signature(
        payload=request.data,
        signature=request.headers.get('X-DocSynth-Signature'),
        secret=os.environ['DOCSYNTH_WEBHOOK_SECRET']
    )
    
    if not is_valid:
        return 'Invalid signature', 401
    
    event = request.json
    
    if event['type'] == 'document.generated':
        print(f"Document generated: {event['data']['path']}")
    elif event['type'] == 'drift.detected':
        print(f"Drift detected: {event['data']['documentPath']}")
    
    return 'OK', 200
```

---

## Rate Limits

SDK requests count against your API rate limits:

| Tier | Requests/Hour |
|------|---------------|
| Free | 1,000 |
| Pro | 5,000 |
| Team | 10,000 |
| Enterprise | Custom |

All SDKs automatically handle rate limiting with exponential backoff.

## Support

- **Node.js:** [GitHub Issues](https://github.com/docsynth/docsynth-js/issues)
- **Python:** [GitHub Issues](https://github.com/docsynth/docsynth-python/issues)
- **Go:** [GitHub Issues](https://github.com/docsynth/docsynth-go/issues)
- **Discord:** [#sdk-help](https://discord.gg/docsynth)
