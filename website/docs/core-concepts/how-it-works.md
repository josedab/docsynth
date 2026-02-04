---
sidebar_position: 2
title: How It Works
description: A detailed walkthrough of how DocSynth generates documentation.
---

# How It Works

This page explains the complete flow from code change to generated documentation.

## The Trigger

Documentation generation starts when a pull request is merged:

```
┌──────────────────────────────────────────────────────────┐
│                     GitHub                               │
│  PR #42: "Add user authentication"                       │
│  ✓ Merged by @developer                                  │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
              Webhook sent to DocSynth
```

DocSynth receives a `pull_request.closed` webhook with `merged: true`.

## Step 1: Webhook Processing

The API server receives and validates the webhook:

```typescript
// Simplified webhook handler
async function handlePullRequest(payload: WebhookPayload) {
  if (payload.action !== 'closed' || !payload.pull_request.merged) {
    return; // Only process merged PRs
  }
  
  // Check if repo is enabled
  const repo = await db.repository.findByGitHubId(payload.repository.id);
  if (!repo?.enabled) return;
  
  // Queue the job
  await queue.add('change-analysis', {
    repositoryId: repo.id,
    pullRequestNumber: payload.pull_request.number,
    mergeCommitSha: payload.pull_request.merge_commit_sha,
  });
}
```

## Step 2: Change Analysis

The worker analyzes what changed:

```
┌─────────────────────────────────────────────────────────┐
│ Change Analysis                                          │
├─────────────────────────────────────────────────────────┤
│ Files changed: 12                                        │
│ Lines added: 247                                         │
│ Lines removed: 31                                        │
│                                                          │
│ Semantic changes detected:                               │
│  • New class: AuthService                                │
│  • New function: validateToken()                         │
│  • Modified: UserController.login()                      │
│  • New interface: AuthConfig                             │
│                                                          │
│ Documentation impact: HIGH                               │
│ Reason: New public API surface                           │
└─────────────────────────────────────────────────────────┘
```

The analysis includes:

| Analysis Type | What It Detects |
|--------------|-----------------|
| **Structural** | New files, renamed files, deleted files |
| **Semantic** | New exports, modified signatures, removed APIs |
| **Impact** | Breaking changes, deprecations, new features |
| **Scope** | Which documentation sections are affected |

## Step 3: Intent Inference

DocSynth gathers context from multiple sources:

### From GitHub

```
PR #42: Add user authentication

## Description
Implements JWT-based authentication for the API. Users can now 
login with email/password and receive a token for subsequent requests.

## Changes
- Add AuthService for token generation/validation
- Add login/logout endpoints
- Add middleware for protected routes

Closes #38
```

### From Jira (if connected)

```
PROJ-38: Implement user authentication

As a user, I want to authenticate with the API so that I can 
access protected resources.

Acceptance Criteria:
- JWT tokens with 24h expiry
- Refresh token support
- Rate limiting on login endpoint
```

### From Slack (if connected)

```
@alice: Should we use JWT or sessions for auth?
@bob: JWT makes sense for the API - stateless and works well 
      with our microservices architecture
@alice: Agreed. I'll use RS256 for the signing algorithm.
```

### Combined Context

```json
{
  "intent": "Implement JWT-based user authentication",
  "motivation": "Users need to access protected API resources",
  "technicalDecisions": [
    "JWT chosen over sessions for stateless architecture",
    "RS256 signing algorithm for security",
    "24-hour token expiry with refresh support"
  ],
  "relatedIssues": ["PROJ-38"],
  "affectedAreas": ["auth", "api", "middleware"]
}
```

## Step 4: Documentation Generation

The LLM generates documentation using the gathered context:

### Input to LLM

```
You are a technical writer. Generate documentation for these code changes.

## Code Changes
[diff of AuthService, login endpoint, etc.]

## Context
- Purpose: Implement JWT-based user authentication
- Motivation: Users need to access protected API resources
- Technical decisions: JWT over sessions, RS256 algorithm, 24h expiry
- Team's documentation style: Technical, concise, with code examples

## Existing Documentation
[relevant sections from current docs]

## Instructions
- Update the API reference with new endpoints
- Add an authentication guide
- Maintain the existing documentation style
```

### Generated Output

```markdown
## Authentication

DocSynth uses JWT (JSON Web Tokens) for API authentication.

### Getting a Token

```bash
curl -X POST https://api.example.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret"}'
```

Response:
```json
{
  "token": "eyJhbG...",
  "expiresIn": 86400,
  "refreshToken": "abc123..."
}
```

### Using the Token

Include the token in the Authorization header:

```bash
curl https://api.example.com/protected \
  -H "Authorization: Bearer eyJhbG..."
```

Tokens expire after 24 hours. Use the refresh token to obtain a new token.
```

## Step 5: Review PR Creation

DocSynth creates a pull request with the generated documentation:

```
┌──────────────────────────────────────────────────────────┐
│ PR #43: docs: Add authentication documentation           │
├──────────────────────────────────────────────────────────┤
│ This PR was automatically generated by DocSynth.         │
│                                                          │
│ ## Changes                                               │
│ - Added authentication guide                             │
│ - Updated API reference with login/logout endpoints      │
│ - Added code examples for token usage                    │
│                                                          │
│ ## Context                                               │
│ Generated from PR #42 (Add user authentication)          │
│                                                          │
│ ---                                                      │
│ Please review and merge, or request changes.             │
└──────────────────────────────────────────────────────────┘
```

## Step 6: Human Review

The team reviews the documentation PR:

- ✅ Accurate technical content
- ✅ Matches team style
- ✅ Complete coverage
- 💬 Request changes if needed

Once approved, merge the docs PR and they're live.

## Background Processes

In addition to PR-triggered generation, DocSynth runs background processes:

| Process | Frequency | Purpose |
|---------|-----------|---------|
| **Drift Scan** | Daily | Detect outdated documentation |
| **Health Scan** | Daily | Calculate documentation health scores |
| **Coverage Scan** | Weekly | Identify undocumented code |
| **Link Check** | Daily | Find broken internal/external links |

## What Makes This Different

| Traditional Docs | DocSynth |
|-----------------|----------|
| Written weeks later | Generated immediately |
| Manual updates | Automatic updates |
| Missing context | Rich multi-source context |
| Inconsistent style | Learned consistent style |
| Unknown freshness | Health monitoring |

## Next Steps

- [Processing Pipeline](/docs/core-concepts/processing-pipeline) — Deep dive into each stage
- [Multi-Source Context](/docs/core-concepts/multi-source-context) — Connecting external sources
- [Style Learning](/docs/core-concepts/style-learning) — How style matching works
