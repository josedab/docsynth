---
sidebar_position: 3
title: Webhooks
description: DocSynth webhook events and payloads.
---

# Webhooks

DocSynth can send webhooks to notify your systems about documentation events.

## Setup

### Configure Webhook URL

1. Go to Settings → Webhooks in the dashboard
2. Click "Add Webhook"
3. Enter your endpoint URL
4. Select events to subscribe to
5. Copy the signing secret

### Endpoint Requirements

Your endpoint must:
- Accept `POST` requests
- Return `200` status within 30 seconds
- Handle retries (same event may be sent multiple times)

## Events

### Available Events

| Event | Description |
|-------|-------------|
| `job.started` | Documentation job started |
| `job.completed` | Job completed successfully |
| `job.failed` | Job failed |
| `document.created` | New document generated |
| `document.updated` | Existing document updated |
| `pr.created` | Documentation PR created |
| `health.alert` | Health score dropped below threshold |
| `drift.detected` | Documentation drift detected |

## Payload Format

All webhooks follow this format:

```json
{
  "id": "evt_abc123",
  "type": "job.completed",
  "createdAt": "2024-01-15T10:30:00Z",
  "data": { ... }
}
```

## Event Payloads

### job.started

```json
{
  "id": "evt_abc123",
  "type": "job.started",
  "createdAt": "2024-01-15T10:30:00Z",
  "data": {
    "jobId": "job_xyz789",
    "repositoryId": "repo_abc123",
    "repositoryName": "org/api-service",
    "trigger": "pr-merge",
    "pullRequestNumber": 42
  }
}
```

### job.completed

```json
{
  "id": "evt_def456",
  "type": "job.completed",
  "createdAt": "2024-01-15T10:31:15Z",
  "data": {
    "jobId": "job_xyz789",
    "repositoryId": "repo_abc123",
    "repositoryName": "org/api-service",
    "duration": 75,
    "documentsGenerated": 3,
    "pullRequestCreated": 43,
    "files": [
      "docs/api/auth.md",
      "docs/api/users.md",
      "CHANGELOG.md"
    ]
  }
}
```

### job.failed

```json
{
  "id": "evt_ghi789",
  "type": "job.failed",
  "createdAt": "2024-01-15T10:30:45Z",
  "data": {
    "jobId": "job_xyz789",
    "repositoryId": "repo_abc123",
    "repositoryName": "org/api-service",
    "error": {
      "code": "GENERATION_FAILED",
      "message": "LLM API rate limit exceeded",
      "stage": "doc-generation"
    }
  }
}
```

### document.created

```json
{
  "id": "evt_jkl012",
  "type": "document.created",
  "createdAt": "2024-01-15T10:31:00Z",
  "data": {
    "documentId": "doc_abc123",
    "repositoryId": "repo_xyz789",
    "path": "docs/api/auth.md",
    "title": "Authentication API",
    "type": "apiDocs",
    "jobId": "job_xyz789"
  }
}
```

### document.updated

```json
{
  "id": "evt_mno345",
  "type": "document.updated",
  "createdAt": "2024-01-15T10:31:00Z",
  "data": {
    "documentId": "doc_abc123",
    "repositoryId": "repo_xyz789",
    "path": "docs/api/users.md",
    "title": "Users API",
    "version": 3,
    "changes": "Added rate limiting section",
    "jobId": "job_xyz789"
  }
}
```

### pr.created

```json
{
  "id": "evt_pqr678",
  "type": "pr.created",
  "createdAt": "2024-01-15T10:31:10Z",
  "data": {
    "repositoryId": "repo_abc123",
    "repositoryName": "org/api-service",
    "pullRequestNumber": 43,
    "pullRequestUrl": "https://github.com/org/api-service/pull/43",
    "title": "docs: Update authentication documentation",
    "sourcePullRequest": 42,
    "jobId": "job_xyz789"
  }
}
```

### health.alert

```json
{
  "id": "evt_stu901",
  "type": "health.alert",
  "createdAt": "2024-01-15T00:00:00Z",
  "data": {
    "repositoryId": "repo_abc123",
    "repositoryName": "org/api-service",
    "previousScore": 85,
    "currentScore": 72,
    "threshold": 75,
    "issues": [
      {
        "type": "stale",
        "document": "docs/guides/setup.md",
        "message": "Not updated in 60 days"
      },
      {
        "type": "broken_link",
        "document": "docs/api/index.md",
        "message": "Link to /auth returns 404"
      }
    ]
  }
}
```

### drift.detected

```json
{
  "id": "evt_vwx234",
  "type": "drift.detected",
  "createdAt": "2024-01-15T00:00:00Z",
  "data": {
    "repositoryId": "repo_abc123",
    "repositoryName": "org/api-service",
    "documents": [
      {
        "path": "docs/api/users.md",
        "lastDocUpdate": "2024-01-01T00:00:00Z",
        "lastCodeChange": "2024-01-14T10:00:00Z",
        "affectedFiles": ["src/api/users.ts", "src/types/user.ts"]
      }
    ]
  }
}
```

## Verifying Webhooks

Verify webhook signatures to ensure authenticity:

### Signature Header

```
X-DocSynth-Signature: sha256=abc123...
```

### Verification Code

```typescript
import crypto from 'crypto';

function verifyWebhook(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return `sha256=${expected}` === signature;
}

// Express example
app.post('/webhooks/docsynth', (req, res) => {
  const signature = req.headers['x-docsynth-signature'];
  const payload = JSON.stringify(req.body);
  
  if (!verifyWebhook(payload, signature, WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process webhook
  const event = req.body;
  console.log(`Received ${event.type}`, event.data);
  
  res.status(200).send('OK');
});
```

## Retry Policy

Failed webhook deliveries are retried with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

After 5 failed attempts, the webhook is marked as failed and no further retries are attempted.

## Idempotency

Webhooks may be delivered multiple times. Use the `id` field to deduplicate:

```typescript
const processedEvents = new Set<string>();

function handleWebhook(event: WebhookEvent) {
  if (processedEvents.has(event.id)) {
    return; // Already processed
  }
  
  processedEvents.add(event.id);
  // Process event...
}
```

## Testing Webhooks

### Dashboard Testing

1. Go to Settings → Webhooks
2. Click "Test" on your webhook
3. Select an event type
4. View the test payload and response

### Local Development

Use a tunnel service for local testing:

```bash
# Using ngrok
ngrok http 3000

# Configure webhook URL
https://abc123.ngrok.io/webhooks/docsynth
```

## Webhook Management API

### List Webhooks

```http
GET /webhooks
```

### Create Webhook

```http
POST /webhooks
```

```json
{
  "url": "https://api.example.com/webhooks/docsynth",
  "events": ["job.completed", "pr.created"],
  "secret": "optional_custom_secret"
}
```

### Delete Webhook

```http
DELETE /webhooks/:id
```

## Next Steps

- [REST API](/docs/api-reference/rest-api) — Complete API reference
- [Configuration](/docs/api-reference/configuration-schema) — Config options
