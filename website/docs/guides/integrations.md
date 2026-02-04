---
sidebar_position: 6
title: Integrations
description: Connect DocSynth to Jira, Slack, Confluence, and Linear.
---

# Integrations

Connect external tools to give DocSynth richer context for better documentation.

## Why Integrate?

External tools provide context that code alone cannot:

| Source | Context Provided |
|--------|-----------------|
| **Jira** | Requirements, acceptance criteria, business context |
| **Slack** | Team discussions, architectural decisions |
| **Confluence** | Existing documentation, architecture docs |
| **Linear** | Issue context, project information |
| **Notion** | Knowledge base, design docs |

## Jira Integration

### Setup

1. **Create API Token**
   - Go to [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   - Click "Create API token"
   - Copy the token

2. **Configure Environment**

```bash
# .env
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=bot@company.com
JIRA_API_TOKEN=your_api_token
JIRA_PROJECT_KEY=PROJ
```

3. **Enable in Dashboard**
   - Go to Settings → Integrations
   - Click "Connect Jira"
   - Enter credentials

### What DocSynth Extracts

| Field | Used For |
|-------|----------|
| Summary | Understanding the feature |
| Description | Detailed requirements |
| Acceptance Criteria | What the feature should do |
| Epic/Parent | Broader context |
| Comments | Stakeholder discussions |
| Labels | Categorization |

### Configuration Options

```json
{
  "context": {
    "jira": {
      "enabled": true,
      "includeEpicContext": true,
      "includeComments": true,
      "maxCommentsPerTicket": 20,
      "projectKeys": ["PROJ", "API"]
    }
  }
}
```

### Linking Issues

Link Jira issues in your PR:

```markdown
## Description
Implements user authentication

Closes PROJ-123
Related: PROJ-124, PROJ-125
```

DocSynth automatically fetches context from linked issues.

## Slack Integration

### Setup

1. **Create Slack App**
   - Go to [Slack API](https://api.slack.com/apps)
   - Click "Create New App"
   - Choose "From scratch"

2. **Configure Permissions**
   
   Add these OAuth scopes:
   - `channels:history` — Read public channel messages
   - `channels:read` — List channels
   - `search:read` — Search messages
   - `users:read` — Get user info

3. **Install to Workspace**
   - Click "Install to Workspace"
   - Authorize the app
   - Copy the Bot Token (`xoxb-...`)

4. **Configure Environment**

```bash
# .env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_DEFAULT_CHANNEL=C123456
```

### What DocSynth Extracts

DocSynth searches Slack for relevant discussions:

- Messages mentioning PR numbers
- Discussions about features/tickets
- Architecture decisions
- Technical discussions

### Configuration Options

```json
{
  "context": {
    "slack": {
      "enabled": true,
      "searchDays": 14,
      "channels": ["engineering", "architecture", "product"],
      "excludeChannels": ["random", "social"],
      "minRelevanceScore": 0.7
    }
  }
}
```

### Best Practices

- Use consistent keywords in Slack discussions
- Reference ticket numbers (e.g., "PROJ-123")
- Tag relevant threads with feature names
- Keep technical decisions in dedicated channels

## Confluence Integration

### Setup

1. **Create API Token** (same as Jira)
   - [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)

2. **Configure Environment**

```bash
# .env
CONFLUENCE_BASE_URL=https://your-company.atlassian.net
CONFLUENCE_EMAIL=bot@company.com
CONFLUENCE_API_TOKEN=your_api_token
CONFLUENCE_SPACE_KEY=DOC
```

### What DocSynth Uses

| Content Type | Purpose |
|-------------|---------|
| Architecture docs | Technical context |
| Design documents | Feature specifications |
| Existing guides | Style reference |
| API documentation | Consistency |

### Configuration Options

```json
{
  "context": {
    "confluence": {
      "enabled": true,
      "spaces": ["DOC", "ARCH", "API"],
      "labels": ["architecture", "api-design"],
      "maxPages": 10
    }
  }
}
```

## Linear Integration

### Setup

1. **Create API Key**
   - Go to Linear → Settings → API
   - Create a personal API key

2. **Configure Environment**

```bash
# .env
LINEAR_API_KEY=lin_api_your_api_key
LINEAR_TEAM_ID=your_team_id
```

### What DocSynth Extracts

| Field | Used For |
|-------|----------|
| Issue title | Feature understanding |
| Description | Requirements |
| Project context | Broader scope |
| Labels | Categorization |
| Comments | Discussions |

### Configuration Options

```json
{
  "context": {
    "linear": {
      "enabled": true,
      "includeProjectContext": true,
      "includeComments": true,
      "teams": ["engineering", "platform"]
    }
  }
}
```

## Notion Integration

### Setup

1. **Create Integration**
   - Go to [Notion Integrations](https://www.notion.so/my-integrations)
   - Click "New integration"
   - Copy the Internal Integration Token

2. **Share Pages**
   - Open pages you want DocSynth to access
   - Click "Share" → "Invite"
   - Add your integration

3. **Configure Environment**

```bash
# .env
NOTION_API_TOKEN=secret_your_notion_token
NOTION_DATABASE_ID=your_database_id
```

### Configuration Options

```json
{
  "context": {
    "notion": {
      "enabled": true,
      "databases": ["docs_db_id", "specs_db_id"],
      "pages": ["architecture_page_id"]
    }
  }
}
```

## Integration Priority

Configure which sources to prioritize:

```json
{
  "context": {
    "priority": ["github", "jira", "slack", "confluence"],
    "maxContextLength": 8000
  }
}
```

Higher priority sources are used first when context length limits are reached.

## Privacy & Security

### Data Handling

| Concern | How Addressed |
|---------|--------------|
| Credentials | Stored encrypted, never logged |
| Data access | Uses your credentials, respects permissions |
| Data storage | Context not persisted after generation |
| Sensitive data | Auto-redaction of secrets/tokens |

### Permissions

DocSynth only accesses data your credentials allow. Use service accounts with minimal permissions:

- **Jira**: Read-only access to relevant projects
- **Slack**: Read-only access to specified channels
- **Confluence**: Read-only access to specified spaces

### Audit Trail

All integration accesses are logged:

```
[2024-01-15 10:23:45] Jira: Fetched PROJ-123
[2024-01-15 10:23:46] Slack: Searched #engineering (14 days)
[2024-01-15 10:23:47] Confluence: Fetched DOC/Architecture
```

## Troubleshooting

### Jira Connection Failed

1. Verify `JIRA_BASE_URL` format (include https://)
2. Check API token hasn't expired
3. Ensure email matches Atlassian account

### Slack Not Finding Messages

1. Verify bot is added to target channels
2. Check `searchDays` configuration
3. Ensure `search:read` scope is granted

### Confluence Access Denied

1. Verify space permissions
2. Check API token permissions
3. Ensure space key is correct

### Linear Rate Limiting

1. Reduce request frequency
2. Use team-specific queries
3. Contact Linear support if persistent

## Next Steps

- [Multi-Source Context](/docs/core-concepts/multi-source-context) — How context is used
- [Configuration](/docs/guides/configuring-docsynth) — All integration options
- [Self-Hosting](/docs/guides/self-hosting) — Enterprise deployment
