---
sidebar_position: 10
title: GitHub Action
description: Run DocSynth directly in your CI/CD pipeline with the official GitHub Action.
---

# GitHub Action

The DocSynth GitHub Action runs documentation generation directly in your CI/CD pipeline — no separate server required.

## Quick Start

Add this workflow to your repository:

```yaml
# .github/workflows/docsynth.yml
name: DocSynth
on:
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  generate-docs:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docsynth/docsynth-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

That's it. When a PR is merged to `main`, DocSynth analyzes the changes and generates updated documentation.

## How It Works

1. **Trigger** — The action runs when a PR is merged (or on any event you configure)
2. **Analysis** — Analyzes the code diff to identify documentation-relevant changes
3. **Generation** — Uses an LLM to generate or update documentation
4. **Output** — Posts results as a PR comment, commits changes, or outputs JSON

## Inputs

| Input               | Required | Default            | Description                                       |
| ------------------- | -------- | ------------------ | ------------------------------------------------- |
| `github-token`      | Yes      | —                  | GitHub token for API access                       |
| `doc-types`         | No       | `readme,changelog` | Comma-separated doc types to generate             |
| `output-mode`       | No       | `comment`          | Output mode: `comment`, `commit`, or `json`       |
| `dry-run`           | No       | `false`            | Preview changes without writing                   |
| `llm-provider`      | No       | `anthropic`        | LLM provider: `anthropic`, `openai`, or `copilot` |
| `anthropic-api-key` | No       | —                  | Anthropic API key (if using Claude)               |
| `openai-api-key`    | No       | —                  | OpenAI API key (if using GPT)                     |

## Outputs

| Output            | Description                              |
| ----------------- | ---------------------------------------- |
| `impact-score`    | Impact score (0-100) of the code changes |
| `changed-docs`    | Number of documentation files affected   |
| `generated-files` | JSON array of generated file paths       |

## Output Modes

### Comment Mode (Default)

Posts generated documentation as a PR comment:

```yaml
- uses: docsynth/docsynth-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    output-mode: comment
```

The action adds a comment to the merged PR with the generated documentation changes.

### Commit Mode

Commits documentation changes directly to the repository:

```yaml
- uses: docsynth/docsynth-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    output-mode: commit
```

Creates a commit like `docs: update documentation for PR #42` on the target branch.

### JSON Mode

Outputs raw JSON for use in downstream workflow steps:

```yaml
- uses: docsynth/docsynth-action@v1
  id: docsynth
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    output-mode: json

- name: Use DocSynth output
  run: |
    echo "Impact score: ${{ steps.docsynth.outputs.impact-score }}"
    echo "Changed docs: ${{ steps.docsynth.outputs.changed-docs }}"
```

## Configuration Examples

### Generate API Docs and Changelog

```yaml
- uses: docsynth/docsynth-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    doc-types: apiDocs,changelog
    llm-provider: anthropic
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Dry Run on Pull Requests

Preview documentation changes before merging:

```yaml
name: DocSynth Preview
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  preview-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docsynth/docsynth-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          dry-run: true
          output-mode: comment
```

### Conditional Generation

Only generate docs when source code changes:

```yaml
name: DocSynth
on:
  pull_request:
    types: [closed]
    branches: [main]
    paths:
      - 'src/**'
      - 'lib/**'
      - '!**/*.test.*'

jobs:
  generate-docs:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docsynth/docsynth-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          doc-types: readme,apiDocs,changelog
```

## Using with Self-Hosted DocSynth

The GitHub Action uses `@docsynth/core` internally and doesn't require a running DocSynth server. However, if you want to integrate with your self-hosted instance:

```yaml
- uses: docsynth/docsynth-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
  env:
    DOCSYNTH_API_URL: https://docsynth.internal.company.com
    DOCSYNTH_API_TOKEN: ${{ secrets.DOCSYNTH_TOKEN }}
```

## Comparison: Action vs Webhook

| Feature              |  GitHub Action  |  Webhook (GitHub App)  |
| -------------------- | :-------------: | :--------------------: |
| Requires server      |       ❌        |           ✅           |
| Multi-source context |       ❌        | ✅ (Jira, Slack, etc.) |
| Dashboard            |       ❌        |           ✅           |
| Health monitoring    |       ❌        |           ✅           |
| Setup complexity     |       Low       |         Medium         |
| Best for             | Simple projects |   Teams, enterprise    |

**Use the GitHub Action** when you want zero-infrastructure documentation generation.
**Use the GitHub App** when you need multi-source context, the dashboard, and drift detection.

## Troubleshooting

### Action Fails with Permission Error

Ensure your `GITHUB_TOKEN` has write access to the repository:

```yaml
permissions:
  contents: write
  pull-requests: write
```

### No Documentation Generated

The action only generates docs when it detects meaningful changes. Check the action logs for the impact score — if it's below the threshold, no docs are generated.

### LLM API Errors

1. Verify your API key is set correctly in repository secrets
2. Check the LLM provider is spelled correctly (`anthropic`, `openai`, or `copilot`)
3. Ensure your API key has sufficient quota

## Next Steps

- [Getting Started](/docs/getting-started) — Full DocSynth setup
- [Configuration](/docs/guides/configuring-docsynth) — `.docsynth.json` options
- [Using the CLI](/docs/guides/using-the-cli) — Local generation with the CLI
