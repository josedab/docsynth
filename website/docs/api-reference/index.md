---
sidebar_position: 1
title: API Reference
description: Complete API documentation for DocSynth.
---

# API Reference

DocSynth provides a REST API for programmatic access to documentation features.

## Base URL

- **Cloud:** `https://api.docsynth.dev`
- **Self-hosted:** Your configured API URL (default: `http://localhost:3001`)

## Authentication

All API requests require authentication via Bearer token:

```bash
curl https://api.docsynth.dev/repositories \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

### Getting a Token

1. Log in to the [dashboard](https://app.docsynth.dev)
2. Go to Settings → API Keys
3. Create a new API key

## Quick Reference

### Repositories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/repositories` | List repositories |
| `GET` | `/repositories/:id` | Get repository |
| `PATCH` | `/repositories/:id` | Update repository |
| `POST` | `/repositories/:id/generate` | Trigger generation |

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/documents` | List documents |
| `GET` | `/documents/:id` | Get document |
| `GET` | `/documents/:id/history` | Get document history |

### Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/jobs` | List jobs |
| `GET` | `/jobs/:id` | Get job status |
| `POST` | `/jobs/:id/retry` | Retry failed job |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | API health check |
| `GET` | `/health/repository/:id` | Repository doc health |

## Response Format

All responses are JSON. Single resources return data directly:

```json
{
  "data": {
    "id": "repo_abc123",
    "name": "my-project",
    "fullName": "acme/my-project",
    "status": "active",
    "lastSyncedAt": "2026-01-15T10:30:00Z",
    "config": {
      "triggers": { "onPRMerge": true },
      "docTypes": { "readme": true, "apiDocs": true }
    }
  }
}
```

List endpoints include pagination metadata:

```json
{
  "data": [
    {
      "id": "repo_abc123",
      "name": "my-project",
      "fullName": "acme/my-project",
      "status": "active"
    },
    {
      "id": "repo_def456",
      "name": "another-repo",
      "fullName": "acme/another-repo",
      "status": "active"
    }
  ],
  "meta": {
    "page": 1,
    "perPage": 20,
    "total": 100
  }
}
```

### Error Responses

Errors follow a consistent structure:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token",
    "details": {
      "hint": "Generate a new API key from the dashboard"
    }
  }
}
```

**Common Error Codes:**

| Code | Description |
|------|-------------|
| `BAD_REQUEST` | Invalid request parameters |
| `UNAUTHORIZED` | Missing or invalid authentication |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource doesn't exist |
| `CONFLICT` | Resource already exists |
| `RATE_LIMITED` | Too many requests |
| `INTERNAL_ERROR` | Server error (contact support) |

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad request |
| `401` | Unauthorized |
| `403` | Forbidden |
| `404` | Not found |
| `429` | Rate limited |
| `500` | Server error |

## Pagination

List endpoints support pagination:

```bash
GET /repositories?page=2&perPage=20
```

Response includes pagination metadata:

```json
{
  "data": [...],
  "meta": {
    "page": 2,
    "perPage": 20,
    "total": 156,
    "totalPages": 8
  }
}
```

## Rate Limiting

- **Standard:** 1000 requests/hour
- **Pro/Team:** 5000 requests/hour
- **Enterprise:** Custom limits

Rate limit headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1704067200
```

## SDKs

Official SDKs:

```bash
# Node.js
npm install @docsynth/sdk

# Python
pip install docsynth
```

### Node.js Example

```typescript
import { DocSynth } from '@docsynth/sdk';

const client = new DocSynth({ token: 'YOUR_TOKEN' });

const repos = await client.repositories.list();
const doc = await client.documents.get('doc_123');
```

## Detailed Reference

- [REST API](/docs/api-reference/rest-api) — Complete endpoint documentation
- [Webhooks](/docs/api-reference/webhooks) — Webhook events and payloads
- [Configuration Schema](/docs/api-reference/configuration-schema) — .docsynth.json reference
