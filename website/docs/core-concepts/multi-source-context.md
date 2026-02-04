---
sidebar_position: 4
title: Multi-Source Context
description: How DocSynth gathers context from multiple sources to generate better documentation.
---

# Multi-Source Context

One of DocSynth's key differentiators is its ability to gather context from multiple sources, producing documentation that explains **why** changes were made, not just what changed.

## The Context Problem

Code diffs alone don't tell the whole story:

```diff
+ async function validateToken(token: string): Promise<boolean> {
+   const decoded = jwt.verify(token, process.env.JWT_SECRET);
+   return !!decoded;
+ }
```

This diff shows **what** was added, but not:
- Why JWT instead of sessions?
- What security considerations were made?
- How does this fit into the larger auth flow?

## Context Sources

DocSynth integrates with multiple tools via MCP (Model Context Protocol):

```mermaid
graph TD
    subgraph "Code Context"
        A[GitHub PR]
        B[GitHub Issues]
        C[Code Comments]
    end
    
    subgraph "Project Context"
        D[Jira]
        E[Linear]
        F[Confluence]
    end
    
    subgraph "Team Context"
        G[Slack]
        H[GitHub Discussions]
    end
    
    A --> I[DocSynth]
    B --> I
    C --> I
    D --> I
    E --> I
    F --> I
    G --> I
    H --> I
    
    I --> J[Rich Documentation]
```

## GitHub Integration

### Pull Request Context

DocSynth extracts from PRs:

| Field | Used For |
|-------|----------|
| Title | Summary of changes |
| Description | Detailed explanation |
| Comments | Discussion and decisions |
| Reviews | Feedback and concerns |
| Labels | Categorization |
| Linked Issues | Requirements context |

### Example

```markdown
## PR #42: Add JWT authentication

### Description
Implements JWT-based auth as discussed in the architecture review.
We chose JWT over sessions because our API is stateless and we need
to support multiple microservices.

### Security Considerations
- Using RS256 for token signing
- Tokens expire after 24 hours
- Refresh tokens stored securely

Closes #38
```

DocSynth extracts:
- **Intent**: JWT-based authentication
- **Decision**: JWT over sessions for stateless architecture
- **Security**: RS256, 24h expiry, secure refresh tokens

## Jira Integration

Connect Jira to pull in ticket context:

### Configuration

```bash
# .env
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=bot@company.com
JIRA_API_TOKEN=your_api_token
JIRA_PROJECT_KEY=PROJ
```

### What DocSynth Extracts

| Field | Description |
|-------|-------------|
| Summary | Ticket title |
| Description | Full requirements |
| Acceptance Criteria | What "done" looks like |
| Epic/Parent | Broader context |
| Comments | Stakeholder discussions |

### Example Context

```yaml
Ticket: PROJ-38
Summary: Implement user authentication
Description: |
  As a user, I want to authenticate with the API so that 
  I can access protected resources.
  
Acceptance Criteria:
  - Users can log in with email/password
  - JWT tokens issued with 24h expiry
  - Refresh token support for extended sessions
  - Rate limiting on login endpoint
  
Epic: PROJ-12 (Security Improvements)
```

## Linear Integration

For teams using Linear:

### Configuration

```bash
# .env
LINEAR_API_KEY=lin_api_your_key
LINEAR_TEAM_ID=your_team_id
```

### Extracted Context

- Issue title and description
- Project and cycle context
- Labels and priority
- Parent/sub-issue relationships

## Slack Integration

Capture architectural decisions and discussions:

### Configuration

```bash
# .env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_DEFAULT_CHANNEL=C123456
```

### How It Works

1. DocSynth searches Slack for messages related to the PR
2. Uses keywords from the PR title, linked issues, and file names
3. Extracts relevant discussions and decisions

### Example

When processing a PR about authentication, DocSynth might find:

```
#engineering (3 days ago)

@alice: Should we use JWT or sessions for the new auth system?

@bob: JWT makes more sense for our architecture - we're going 
stateless and need to support multiple services.

@alice: Good point. What about the signing algorithm?

@bob: RS256 is the standard for production. HS256 is fine for 
dev but not secure enough for prod.

@alice: Makes sense. I'll go with RS256.
```

This context is included in the documentation:

> JWT was chosen over session-based authentication to support 
> the stateless microservices architecture. RS256 is used for 
> token signing following security best practices.

## Confluence Integration

Pull existing documentation as context:

### Configuration

```bash
# .env
CONFLUENCE_BASE_URL=https://your-company.atlassian.net
CONFLUENCE_EMAIL=bot@company.com
CONFLUENCE_API_TOKEN=your_api_token
CONFLUENCE_SPACE_KEY=DOC
```

### Use Cases

- Reference architecture documents
- Include related guides
- Link to existing documentation
- Avoid duplicating content

## Context Synthesis

DocSynth combines context from all sources:

```typescript
interface SynthesizedContext {
  // From GitHub PR
  whatChanged: string;
  prDescription: string;
  
  // From tickets (Jira/Linear)
  requirements: string;
  acceptanceCriteria: string[];
  
  // From discussions (Slack)
  decisions: Decision[];
  rationale: string;
  
  // From existing docs (Confluence)
  relatedDocs: string[];
  
  // Synthesized
  summary: string;
  intent: string;
  userImpact: string;
}
```

## Privacy & Security

DocSynth handles context data carefully:

| Concern | How It's Addressed |
|---------|-------------------|
| **Access Control** | Uses your credentials, respects permissions |
| **Data Storage** | Context not persisted after generation |
| **Sensitive Data** | Automatically redacts secrets/tokens |
| **Audit Trail** | All context access logged |

### Sensitive Data Filtering

DocSynth automatically filters:

- API keys and tokens
- Passwords and secrets
- Personal information (when configured)
- Internal URLs (optional)

## Configuring Context Sources

In `.docsynth.json`:

```json
{
  "context": {
    "sources": {
      "github": {
        "enabled": true,
        "includeComments": true,
        "includeReviews": true
      },
      "jira": {
        "enabled": true,
        "includeEpicContext": true
      },
      "slack": {
        "enabled": true,
        "searchDays": 14,
        "channels": ["engineering", "architecture"]
      },
      "confluence": {
        "enabled": true,
        "spaces": ["DOC", "ARCH"]
      }
    },
    "synthesis": {
      "maxContextLength": 8000,
      "prioritize": ["pr", "ticket", "discussion"]
    }
  }
}
```

## Best Practices

### 1. Write Descriptive PRs

The more context in your PR, the better the docs:

```markdown
## What
Added JWT authentication to the API.

## Why
Users need secure access to protected endpoints. JWT was chosen 
over sessions for our stateless architecture.

## How
- AuthService handles token generation/validation
- Middleware validates tokens on protected routes
- Refresh tokens enable long-lived sessions

## Testing
- Unit tests for AuthService
- Integration tests for login flow
- Manual testing with Postman
```

### 2. Link Related Issues

Always link related tickets:

```markdown
Closes #38
Related to #35, #36
See also: JIRA-123
```

### 3. Use Consistent Keywords

DocSynth uses keywords to find related discussions. Consistent terminology helps:

- Use the same terms in PRs, tickets, and chat
- Tag discussions with feature names
- Reference ticket numbers in Slack

## Next Steps

- [Style Learning](/docs/core-concepts/style-learning) — How DocSynth learns your voice
- [Integrations](/docs/guides/integrations) — Detailed setup guides
- [Configuration](/docs/guides/configuring-docsynth) — All configuration options
