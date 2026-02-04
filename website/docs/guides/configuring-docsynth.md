---
sidebar_position: 2
title: Configuring DocSynth
description: Complete guide to configuring DocSynth with .docsynth.json.
---

# Configuring DocSynth

DocSynth is configured through a `.docsynth.json` file in your repository root.

## Basic Configuration

Create with the CLI:

```bash
docsynth init
```

Or manually create `.docsynth.json`:

```json
{
  "version": 1,
  "triggers": {
    "onPRMerge": true,
    "branches": ["main", "master"]
  },
  "filters": {
    "includePaths": ["src/**/*", "lib/**/*"],
    "excludePaths": ["**/*.test.*", "**/*.spec.*"]
  },
  "docTypes": {
    "readme": true,
    "apiDocs": true,
    "changelog": true
  },
  "style": {
    "tone": "technical",
    "includeExamples": true
  }
}
```

## Configuration Sections

### Triggers

Control when documentation is generated:

```json
{
  "triggers": {
    "onPRMerge": true,
    "onPush": false,
    "branches": ["main", "master", "release/*"],
    "minImpact": "medium"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `onPRMerge` | boolean | `true` | Generate docs when PRs merge |
| `onPush` | boolean | `false` | Generate docs on direct pushes |
| `branches` | string[] | `["main"]` | Branches that trigger generation |
| `minImpact` | string | `"low"` | Minimum impact level to trigger |

### Filters

Control which files are analyzed:

```json
{
  "filters": {
    "includePaths": [
      "src/**/*",
      "lib/**/*",
      "packages/*/src/**/*"
    ],
    "excludePaths": [
      "**/*.test.*",
      "**/*.spec.*",
      "**/node_modules/**",
      "**/dist/**",
      "**/__mocks__/**"
    ]
  }
}
```

Patterns use [glob syntax](https://github.com/isaacs/minimatch).

### Doc Types

Enable/disable documentation types:

```json
{
  "docTypes": {
    "readme": true,
    "apiDocs": true,
    "changelog": true,
    "guides": false,
    "tutorials": false,
    "adr": false
  }
}
```

| Type | Description |
|------|-------------|
| `readme` | Project README updates |
| `apiDocs` | API reference documentation |
| `changelog` | CHANGELOG.md entries |
| `guides` | How-to guides |
| `tutorials` | Step-by-step tutorials |
| `adr` | Architecture Decision Records |

### Style

Configure documentation style:

```json
{
  "style": {
    "tone": "technical",
    "voice": "active",
    "person": "second",
    "includeExamples": true,
    "verbosity": "moderate",
    "exampleLanguage": "typescript",
    "guidelines": [
      "Use tables for parameters",
      "Include return types",
      "Add error handling examples"
    ]
  }
}
```

| Option | Values | Default |
|--------|--------|---------|
| `tone` | `technical`, `casual`, `formal` | `technical` |
| `voice` | `active`, `passive` | `active` |
| `person` | `first`, `second`, `third` | `second` |
| `verbosity` | `concise`, `moderate`, `verbose` | `moderate` |

### Output

Configure where docs are written:

```json
{
  "output": {
    "directory": "docs",
    "apiDocsPath": "docs/api",
    "guidesPath": "docs/guides",
    "changelogPath": "CHANGELOG.md",
    "format": "mdx"
  }
}
```

### LLM

Configure the language model:

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-3-sonnet",
    "temperature": 0.3,
    "maxTokens": 4096
  }
}
```

Supported providers:
- `anthropic` — Claude models
- `openai` — GPT models
- `copilot` — GitHub Copilot

### Context Sources

Configure external context sources:

```json
{
  "context": {
    "github": {
      "includeComments": true,
      "includeReviews": true,
      "includeLinkedIssues": true
    },
    "jira": {
      "enabled": true,
      "includeEpicContext": true
    },
    "slack": {
      "enabled": true,
      "searchDays": 14,
      "channels": ["engineering"]
    }
  }
}
```

### Advanced

Advanced configuration options:

```json
{
  "advanced": {
    "driftDetection": {
      "enabled": true,
      "scanFrequency": "daily"
    },
    "healthScoring": {
      "enabled": true,
      "freshnessThreshold": 90
    },
    "vectorIndex": {
      "enabled": true,
      "chunkSize": 500
    },
    "knowledgeGraph": {
      "enabled": false
    }
  }
}
```

## Environment Variables

Sensitive configuration should use environment variables:

```bash
# .env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA..."
GITHUB_CLIENT_ID=Iv1.xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_WEBHOOK_SECRET=xxx
SESSION_SECRET=xxx
JWT_SECRET=xxx

# Optional integrations
JIRA_BASE_URL=https://company.atlassian.net
JIRA_EMAIL=bot@company.com
JIRA_API_TOKEN=xxx

SLACK_BOT_TOKEN=xoxb-xxx
SLACK_DEFAULT_CHANNEL=C123456

LINEAR_API_KEY=lin_api_xxx
```

## Configuration Per Branch

Use different configs for different branches:

```json
{
  "branches": {
    "main": {
      "docTypes": {
        "readme": true,
        "apiDocs": true,
        "changelog": true
      }
    },
    "develop": {
      "docTypes": {
        "readme": false,
        "apiDocs": true,
        "changelog": false
      }
    }
  }
}
```

## Monorepo Configuration

For monorepos, configure per-package:

```json
{
  "monorepo": {
    "enabled": true,
    "packages": {
      "packages/core": {
        "docTypes": { "apiDocs": true }
      },
      "packages/cli": {
        "docTypes": { "readme": true, "apiDocs": true }
      },
      "apps/web": {
        "enabled": false
      }
    }
  }
}
```

## Validating Configuration

Check your configuration:

```bash
docsynth config --validate
```

Output:

```
✅ Configuration is valid

Summary:
  Version: 1
  Triggers: onPRMerge (main, master)
  Doc Types: readme, apiDocs, changelog
  Style: technical, active voice
  Context: GitHub, Jira
```

## Common Configurations

### TypeScript API Library

```json
{
  "version": 1,
  "triggers": { "onPRMerge": true, "branches": ["main"] },
  "filters": {
    "includePaths": ["src/**/*.ts"],
    "excludePaths": ["**/*.test.ts", "**/*.spec.ts"]
  },
  "docTypes": {
    "readme": true,
    "apiDocs": true,
    "changelog": true
  },
  "style": {
    "tone": "technical",
    "includeExamples": true,
    "exampleLanguage": "typescript"
  },
  "output": {
    "apiDocsPath": "docs/api"
  }
}
```

### Internal Application

```json
{
  "version": 1,
  "triggers": { "onPRMerge": true, "branches": ["main", "develop"] },
  "filters": {
    "includePaths": ["src/**/*"],
    "excludePaths": ["**/*.test.*"]
  },
  "docTypes": {
    "readme": true,
    "apiDocs": false,
    "changelog": true,
    "adr": true
  },
  "style": {
    "tone": "casual",
    "verbosity": "moderate"
  },
  "context": {
    "jira": { "enabled": true },
    "slack": { "enabled": true }
  }
}
```

## Next Steps

- [Configuration Schema](/docs/api-reference/configuration-schema) — Complete reference
- [Using the CLI](/docs/guides/using-the-cli) — Manage config via CLI
- [Integrations](/docs/guides/integrations) — Set up external sources
