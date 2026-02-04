---
sidebar_position: 3
title: Quick Start
description: Generate your first documentation in 5 minutes.
---

# Quick Start

This guide walks you through generating documentation for your first repository.

## Prerequisites

- [DocSynth CLI installed](/docs/getting-started/installation)
- A GitHub repository you want to document
- Node.js 20+

## Step 1: Authenticate

Login to DocSynth:

```bash
docsynth login
```

This opens your browser to authenticate with GitHub. After authorizing, copy the token and paste it in your terminal.

```
🔐 DocSynth Login

To authenticate, visit the following URL in your browser:

https://docsynth.dev/auth/github?state=abc123

After authorizing, you will receive a token.
? Paste your token here: ********

✅ Logged in as your-username
```

## Step 2: Initialize Your Repository

Navigate to your repository and initialize DocSynth:

```bash
cd your-repo
docsynth init
```

The interactive setup asks a few questions:

```
🔧 Initializing DocSynth...

? Which documentation types do you want to generate?
  ◉ README
  ◉ API Reference
  ◉ Changelog
  ◯ Guides/Tutorials

? What tone should the documentation use?
  ❯ Technical (formal, precise)
    Casual (friendly, approachable)
    Formal (professional, enterprise)

? Which branches should trigger documentation? main, master

✅ DocSynth initialized successfully!

Configuration saved to: .docsynth.json
```

Or skip the interactive mode with defaults:

```bash
docsynth init --yes
```

## Step 3: Review Configuration

DocSynth creates a `.docsynth.json` file:

```json
{
  "version": 1,
  "triggers": {
    "onPRMerge": true,
    "branches": ["main", "master"]
  },
  "filters": {
    "includePaths": ["src/**/*", "lib/**/*"],
    "excludePaths": ["**/*.test.*", "**/*.spec.*", "**/node_modules/**"]
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

Commit this file to your repository:

```bash
git add .docsynth.json
git commit -m "chore: add DocSynth configuration"
git push
```

## Step 4: Generate Documentation Locally

Test documentation generation without waiting for a PR:

```bash
docsynth generate
```

Output:

```
📚 Generating documentation...

✔ Found 47 source files
✔ Found 23 exports

✅ Documentation generated successfully!

Files created:
  • docs/api-reference.md
```

### Dry Run Mode

Preview what would be generated without creating files:

```bash
docsynth generate --dry-run
```

```
📚 Generating documentation...

✔ Found 47 source files
✔ Found 23 exports

📋 Dry run - would generate:

  • README.md
  • docs/api-reference.md
  • CHANGELOG.md (entry)

Exports found:
  - UserService (class) from src/services/user.ts
  - createUser (function) from src/services/user.ts
  - User (interface) from src/types/user.ts
  ... and 20 more
```

## Step 5: Install the GitHub App

For automatic documentation on PR merges:

1. Go to [GitHub App Installation](https://github.com/apps/docsynth)
2. Click **Install**
3. Select the repositories to enable
4. Authorize the requested permissions

See [GitHub App Setup](/docs/getting-started/github-app-setup) for detailed instructions.

## Step 6: Merge a Pull Request

Create and merge any PR to your repository. DocSynth will:

1. Receive the webhook event
2. Analyze the changes
3. Gather context from the PR description and comments
4. Generate updated documentation
5. Open a new PR with the documentation changes

```
PR #42 merged → DocSynth processes → PR #43 created with docs
```

## Check Status

View DocSynth status for your repository:

```bash
docsynth status
```

```
📊 DocSynth Status

Configuration: ✓ Found

Settings:
  Triggers:
    • On PR merge: Yes
    • Branches: main, master
  Doc types:
    • readme: enabled
    • apiDocs: enabled
    • changelog: enabled
  Style:
    • Tone: technical
    • Include examples: Yes

Authentication: ✓ Logged in
Docs directory: ✓ Exists
  Found 3 markdown files
```

## What's Next?

- [GitHub App Setup](/docs/getting-started/github-app-setup) — Configure webhooks and permissions
- [Core Concepts](/docs/core-concepts) — Understand how DocSynth works
- [Configuration Reference](/docs/api-reference/configuration-schema) — All configuration options
- [Using the CLI](/docs/guides/using-the-cli) — Advanced CLI usage
