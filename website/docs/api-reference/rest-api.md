---
sidebar_position: 2
title: REST API
description: Complete REST API endpoint documentation.
---

# REST API

Complete reference for all DocSynth REST API endpoints.

## Repositories

### List Repositories

```http
GET /repositories
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `perPage` | number | Items per page (default: 20, max: 100) |
| `enabled` | boolean | Filter by enabled status |

**Response:**

```json
{
  "data": [
    {
      "id": "repo_abc123",
      "name": "api-service",
      "fullName": "org/api-service",
      "enabled": true,
      "defaultBranch": "main",
      "lastActivityAt": "2024-01-15T10:30:00Z",
      "config": { ... },
      "health": {
        "score": 92,
        "lastScan": "2024-01-15T00:00:00Z"
      }
    }
  ],
  "meta": {
    "page": 1,
    "perPage": 20,
    "total": 12
  }
}
```

### Get Repository

```http
GET /repositories/:id
```

**Response:**

```json
{
  "data": {
    "id": "repo_abc123",
    "name": "api-service",
    "fullName": "org/api-service",
    "enabled": true,
    "defaultBranch": "main",
    "installationId": 12345678,
    "lastActivityAt": "2024-01-15T10:30:00Z",
    "lastDriftScanAt": "2024-01-15T00:00:00Z",
    "config": {
      "version": 1,
      "triggers": { ... },
      "docTypes": { ... }
    },
    "health": {
      "score": 92,
      "freshness": 85,
      "coverage": 94,
      "linkHealth": 100
    },
    "stats": {
      "documentsCount": 24,
      "jobsLast30Days": 45
    }
  }
}
```

### Update Repository

```http
PATCH /repositories/:id
```

**Request Body:**

```json
{
  "enabled": true,
  "config": {
    "docTypes": {
      "readme": true,
      "apiDocs": true
    }
  }
}
```

**Response:**

```json
{
  "data": {
    "id": "repo_abc123",
    "enabled": true,
    "config": { ... }
  }
}
```

### Trigger Generation

```http
POST /repositories/:id/generate
```

Manually trigger documentation generation.

**Request Body:**

```json
{
  "branch": "main",
  "paths": ["src/api/**/*"],
  "docTypes": ["apiDocs"]
}
```

**Response:**

```json
{
  "data": {
    "jobId": "job_xyz789",
    "status": "queued"
  }
}
```

## Documents

### List Documents

```http
GET /documents
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `repositoryId` | string | Filter by repository |
| `type` | string | Filter by type (readme, apiDocs, etc.) |
| `page` | number | Page number |
| `perPage` | number | Items per page |

**Response:**

```json
{
  "data": [
    {
      "id": "doc_abc123",
      "repositoryId": "repo_xyz789",
      "path": "docs/api/users.md",
      "type": "apiDocs",
      "title": "Users API",
      "lastUpdatedAt": "2024-01-15T10:30:00Z",
      "health": {
        "score": 95,
        "freshness": 100,
        "lastCodeChange": "2024-01-15T08:00:00Z"
      }
    }
  ],
  "meta": { ... }
}
```

### Get Document

```http
GET /documents/:id
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `includeContent` | boolean | Include full content (default: false) |

**Response:**

```json
{
  "data": {
    "id": "doc_abc123",
    "repositoryId": "repo_xyz789",
    "path": "docs/api/users.md",
    "type": "apiDocs",
    "title": "Users API",
    "content": "# Users API\n\n...",
    "metadata": {
      "generatedFrom": "job_xyz789",
      "sourcePR": 42
    },
    "health": {
      "score": 95,
      "issues": []
    }
  }
}
```

### Get Document History

```http
GET /documents/:id/history
```

**Response:**

```json
{
  "data": [
    {
      "version": 3,
      "createdAt": "2024-01-15T10:30:00Z",
      "jobId": "job_xyz789",
      "changes": "Updated authentication section",
      "diff": "@@ -10,6 +10,8 @@..."
    },
    {
      "version": 2,
      "createdAt": "2024-01-10T14:20:00Z",
      "jobId": "job_abc123",
      "changes": "Added rate limiting docs"
    }
  ]
}
```

## Jobs

### List Jobs

```http
GET /jobs
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `repositoryId` | string | Filter by repository |
| `status` | string | Filter by status |
| `page` | number | Page number |

**Response:**

```json
{
  "data": [
    {
      "id": "job_abc123",
      "repositoryId": "repo_xyz789",
      "type": "pr-merge",
      "status": "completed",
      "pullRequestNumber": 42,
      "startedAt": "2024-01-15T10:30:00Z",
      "completedAt": "2024-01-15T10:31:15Z",
      "duration": 75,
      "documentsGenerated": 3
    }
  ],
  "meta": { ... }
}
```

### Job Status Values

| Status | Description |
|--------|-------------|
| `queued` | Waiting to process |
| `analyzing` | Analyzing code changes |
| `inferring` | Gathering context |
| `generating` | Generating documentation |
| `reviewing` | AI review in progress |
| `creating_pr` | Creating pull request |
| `completed` | Successfully completed |
| `failed` | Failed with error |

### Get Job

```http
GET /jobs/:id
```

**Response:**

```json
{
  "data": {
    "id": "job_abc123",
    "repositoryId": "repo_xyz789",
    "type": "pr-merge",
    "status": "completed",
    "pullRequestNumber": 42,
    "mergeCommitSha": "abc123def456",
    "stages": [
      { "name": "change-analysis", "status": "completed", "duration": 12 },
      { "name": "intent-inference", "status": "completed", "duration": 23 },
      { "name": "doc-generation", "status": "completed", "duration": 35 },
      { "name": "doc-review", "status": "completed", "duration": 5 }
    ],
    "output": {
      "documentsGenerated": 3,
      "pullRequestCreated": 43,
      "files": [
        "docs/api/auth.md",
        "docs/api/users.md",
        "CHANGELOG.md"
      ]
    },
    "startedAt": "2024-01-15T10:30:00Z",
    "completedAt": "2024-01-15T10:31:15Z"
  }
}
```

### Retry Job

```http
POST /jobs/:id/retry
```

Retry a failed job.

**Response:**

```json
{
  "data": {
    "jobId": "job_new123",
    "status": "queued"
  }
}
```

## Health

### API Health

```http
GET /health
```

**Response:**

```json
{
  "status": "healthy",
  "version": "1.2.3",
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "llm": "healthy"
  }
}
```

### Repository Health

```http
GET /health/repository/:id
```

**Response:**

```json
{
  "data": {
    "repositoryId": "repo_abc123",
    "overallScore": 92,
    "metrics": {
      "freshness": 85,
      "coverage": 94,
      "linkHealth": 100,
      "styleConsistency": 89
    },
    "issues": [
      {
        "severity": "warning",
        "type": "stale",
        "document": "docs/guides/setup.md",
        "message": "Not updated in 45 days"
      }
    ],
    "lastScan": "2024-01-15T00:00:00Z"
  }
}
```

## Analytics

### Usage Stats

```http
GET /analytics/usage
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | string | Start date (ISO 8601) |
| `endDate` | string | End date (ISO 8601) |
| `repositoryId` | string | Filter by repository |

**Response:**

```json
{
  "data": {
    "period": {
      "start": "2024-01-01T00:00:00Z",
      "end": "2024-01-31T23:59:59Z"
    },
    "documentsGenerated": 156,
    "jobsProcessed": 234,
    "avgGenerationTime": 45.2,
    "topRepositories": [
      { "id": "repo_abc", "name": "api-service", "docs": 45 }
    ]
  }
}
```

## Errors

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": {
      "field": "config.docTypes",
      "issue": "Must be an object"
    }
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

## Next Steps

- [Webhooks](/docs/api-reference/webhooks) — Receive events
- [Configuration Schema](/docs/api-reference/configuration-schema) — Config reference
