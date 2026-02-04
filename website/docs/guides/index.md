---
sidebar_position: 1
title: Guides
description: Practical guides for using DocSynth effectively.
---

# Guides

Step-by-step guides for common DocSynth tasks.

## Getting Productive

| Guide | Description |
|-------|-------------|
| [Configuring DocSynth](/docs/guides/configuring-docsynth) | Customize behavior with `.docsynth.json` |
| [Using the CLI](/docs/guides/using-the-cli) | Master the command-line interface |
| [Dashboard Overview](/docs/guides/dashboard-overview) | Navigate the web dashboard |
| [VS Code Extension](/docs/guides/vscode-extension) | IDE integration for real-time docs |

## Integrations

| Guide | Description |
|-------|-------------|
| [Integrations](/docs/guides/integrations) | Connect Jira, Slack, Confluence, Linear |
| [Self-Hosting](/docs/guides/self-hosting) | Deploy DocSynth on your infrastructure |

## Quick Links

### Configuration Essentials

```json
{
  "version": 1,
  "triggers": {
    "onPRMerge": true,
    "branches": ["main"]
  },
  "docTypes": {
    "readme": true,
    "apiDocs": true,
    "changelog": true
  }
}
```

→ [Full configuration reference](/docs/api-reference/configuration-schema)

### CLI Quick Reference

```bash
docsynth init          # Initialize repository
docsynth generate      # Generate docs locally
docsynth status        # Check configuration
docsynth config --show # View current config
docsynth login         # Authenticate
```

→ [Complete CLI guide](/docs/guides/using-the-cli)

### Common Tasks

- **Enable a new doc type** → Edit `.docsynth.json`, add to `docTypes`
- **Change documentation tone** → Set `style.tone` in config
- **Skip test files** → Add to `filters.excludePaths`
- **Connect Jira** → Add credentials to environment variables

## Best Practices

### 1. Start Small

Begin with a single repository:

```bash
cd my-important-repo
docsynth init --yes
docsynth generate --dry-run
```

### 2. Review First Few PRs Carefully

The first generated docs set the tone. Review them thoroughly and provide feedback.

### 3. Iterate on Configuration

Adjust settings based on results:

```json
{
  "style": {
    "tone": "technical",
    "includeExamples": true,
    "verbosity": "moderate"
  }
}
```

### 4. Connect Context Sources

Better context = better docs:

1. GitHub (automatic)
2. Jira or Linear (for requirements)
3. Slack (for decisions)

## Need Help?

- [Troubleshooting](/docs/reference/troubleshooting)
- [FAQ](/docs/reference/faq)
- [GitHub Discussions](https://github.com/docsynth/docsynth/discussions)
