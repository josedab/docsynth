---
sidebar_position: 4
title: Configuration Schema
description: Complete reference for .docsynth.json configuration.
---

# Configuration Schema

Complete reference for the `.docsynth.json` configuration file.

## Schema Version

```json
{
  "version": 1
}
```

Always include `version: 1` for compatibility.

## Complete Schema

```json
{
  "version": 1,
  "triggers": {
    "onPRMerge": true,
    "onPush": false,
    "branches": ["main", "master"],
    "minImpact": "low"
  },
  "filters": {
    "includePaths": ["src/**/*"],
    "excludePaths": ["**/*.test.*"]
  },
  "docTypes": {
    "readme": true,
    "apiDocs": true,
    "changelog": true,
    "guides": false,
    "tutorials": false,
    "adr": false
  },
  "style": {
    "tone": "technical",
    "voice": "active",
    "person": "second",
    "verbosity": "moderate",
    "includeExamples": true,
    "exampleLanguage": "typescript",
    "guidelines": []
  },
  "output": {
    "directory": "docs",
    "apiDocsPath": "docs/api",
    "guidesPath": "docs/guides",
    "changelogPath": "CHANGELOG.md",
    "format": "md"
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-3-sonnet",
    "temperature": 0.3,
    "maxTokens": 4096
  },
  "context": {
    "github": {
      "includeComments": true,
      "includeReviews": true,
      "includeLinkedIssues": true
    },
    "jira": {
      "enabled": false,
      "includeEpicContext": true
    },
    "slack": {
      "enabled": false,
      "searchDays": 14,
      "channels": []
    }
  },
  "advanced": {
    "driftDetection": {
      "enabled": true,
      "scanFrequency": "daily"
    },
    "healthScoring": {
      "enabled": true,
      "freshnessThreshold": 90
    }
  }
}
```

## Triggers

Control when documentation is generated.

### triggers.onPRMerge

| Type | Default | Description |
|------|---------|-------------|
| `boolean` | `true` | Generate docs when PRs are merged |

### triggers.onPush

| Type | Default | Description |
|------|---------|-------------|
| `boolean` | `false` | Generate docs on direct pushes |

### triggers.branches

| Type | Default | Description |
|------|---------|-------------|
| `string[]` | `["main"]` | Branches that trigger generation |

Supports glob patterns:

```json
{
  "branches": ["main", "release/*", "hotfix/*"]
}
```

### triggers.minImpact

| Type | Default | Description |
|------|---------|-------------|
| `string` | `"low"` | Minimum change impact to trigger |

Values: `"low"`, `"medium"`, `"high"`

## Filters

Control which files are analyzed.

### filters.includePaths

| Type | Default | Description |
|------|---------|-------------|
| `string[]` | `["src/**/*"]` | Paths to include in analysis |

### filters.excludePaths

| Type | Default | Description |
|------|---------|-------------|
| `string[]` | `["**/*.test.*"]` | Paths to exclude from analysis |

Patterns use [glob syntax](https://github.com/isaacs/minimatch).

## Doc Types

Enable/disable documentation types.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `readme` | boolean | `true` | README.md updates |
| `apiDocs` | boolean | `true` | API reference documentation |
| `changelog` | boolean | `true` | CHANGELOG.md entries |
| `guides` | boolean | `false` | How-to guides |
| `tutorials` | boolean | `false` | Step-by-step tutorials |
| `adr` | boolean | `false` | Architecture Decision Records |

## Style

Configure documentation style.

### style.tone

| Type | Default | Options |
|------|---------|---------|
| `string` | `"technical"` | `"technical"`, `"casual"`, `"formal"` |

### style.voice

| Type | Default | Options |
|------|---------|---------|
| `string` | `"active"` | `"active"`, `"passive"` |

### style.person

| Type | Default | Options |
|------|---------|---------|
| `string` | `"second"` | `"first"`, `"second"`, `"third"` |

### style.verbosity

| Type | Default | Options |
|------|---------|---------|
| `string` | `"moderate"` | `"concise"`, `"moderate"`, `"verbose"` |

### style.includeExamples

| Type | Default | Description |
|------|---------|-------------|
| `boolean` | `true` | Include code examples |

### style.exampleLanguage

| Type | Default | Description |
|------|---------|-------------|
| `string` | `"typescript"` | Default language for examples |

### style.guidelines

| Type | Default | Description |
|------|---------|-------------|
| `string[]` | `[]` | Custom style guidelines |

Example:

```json
{
  "style": {
    "guidelines": [
      "Use tables for parameters",
      "Always include return types",
      "Add error handling examples"
    ]
  }
}
```

## Output

Configure output paths and format.

### output.directory

| Type | Default | Description |
|------|---------|-------------|
| `string` | `"docs"` | Root documentation directory |

### output.apiDocsPath

| Type | Default | Description |
|------|---------|-------------|
| `string` | `"docs/api"` | API documentation path |

### output.guidesPath

| Type | Default | Description |
|------|---------|-------------|
| `string` | `"docs/guides"` | Guides path |

### output.changelogPath

| Type | Default | Description |
|------|---------|-------------|
| `string` | `"CHANGELOG.md"` | Changelog file path |

### output.format

| Type | Default | Options |
|------|---------|---------|
| `string` | `"md"` | `"md"`, `"mdx"` |

## LLM

Configure the language model.

### llm.provider

| Type | Default | Options |
|------|---------|---------|
| `string` | `"anthropic"` | `"anthropic"`, `"openai"`, `"copilot"` |

### llm.model

| Type | Default | Description |
|------|---------|-------------|
| `string` | `"claude-3-sonnet"` | Model name |

Available models by provider:

**Anthropic:**
- `claude-3-opus`
- `claude-3-sonnet`
- `claude-3-haiku`

**OpenAI:**
- `gpt-4-turbo`
- `gpt-4`
- `gpt-3.5-turbo`

### llm.temperature

| Type | Default | Range |
|------|---------|-------|
| `number` | `0.3` | `0.0` - `1.0` |

Lower values produce more consistent output.

### llm.maxTokens

| Type | Default | Description |
|------|---------|-------------|
| `number` | `4096` | Maximum tokens per generation |

## Context

Configure context sources.

### context.github

```json
{
  "context": {
    "github": {
      "includeComments": true,
      "includeReviews": true,
      "includeLinkedIssues": true
    }
  }
}
```

### context.jira

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

### context.slack

```json
{
  "context": {
    "slack": {
      "enabled": true,
      "searchDays": 14,
      "channels": ["engineering", "architecture"],
      "excludeChannels": ["random"]
    }
  }
}
```

### context.confluence

```json
{
  "context": {
    "confluence": {
      "enabled": true,
      "spaces": ["DOC", "ARCH"],
      "labels": ["api-design"],
      "maxPages": 10
    }
  }
}
```

## Advanced

Advanced configuration options.

### advanced.driftDetection

```json
{
  "advanced": {
    "driftDetection": {
      "enabled": true,
      "scanFrequency": "daily",
      "thresholdDays": 14
    }
  }
}
```

### advanced.healthScoring

```json
{
  "advanced": {
    "healthScoring": {
      "enabled": true,
      "freshnessThreshold": 90,
      "coverageThreshold": 80,
      "alertOnDrop": true
    }
  }
}
```

### advanced.vectorIndex

```json
{
  "advanced": {
    "vectorIndex": {
      "enabled": true,
      "chunkSize": 500,
      "overlap": 50
    }
  }
}
```

### advanced.knowledgeGraph

```json
{
  "advanced": {
    "knowledgeGraph": {
      "enabled": false,
      "extractRelationships": true
    }
  }
}
```

## Validation

Validate your configuration:

```bash
docsynth config --validate
```

## JSON Schema

For editor autocompletion, reference the schema:

```json
{
  "$schema": "https://docsynth.dev/schemas/config-v1.json",
  "version": 1
}
```

## Next Steps

- [Configuration Guide](/docs/guides/configuring-docsynth) — Practical examples
- [REST API](/docs/api-reference/rest-api) — API endpoints
