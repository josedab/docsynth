---
slug: /
sidebar_position: 1
title: Introduction
description: DocSynth automatically generates and maintains documentation by observing code changes.
---

# Introduction

**DocSynth** is an AI-powered documentation tool that automatically generates and maintains documentation by observing code changes, understanding context from PRs and tickets, and producing human-quality technical writing.

## The Problem

Documentation is the first thing to become outdated when code changes. Studies show that **54% of documentation becomes stale within 3 months**. Teams struggle because:

- Writing docs is time-consuming and often deprioritized
- Context is lost when docs are written weeks after code changes
- Keeping docs in sync with code requires constant manual effort
- Inconsistent style makes documentation hard to navigate

## The Solution

DocSynth turns documentation into an **automatic byproduct of development**:

```
PR Merged → Change Analysis → Intent Inference → Doc Generation → PR Created
```

When you merge a PR, DocSynth:
1. Analyzes what changed in your code
2. Gathers context from the PR, linked tickets, and team discussions
3. Generates documentation that explains not just *what* changed, but *why*
4. Creates a PR with the generated docs for review

## Key Features

| Feature | Description |
|---------|-------------|
| **Multi-Source Context** | Pulls context from GitHub PRs, Jira, Slack, and Linear |
| **Style Learning** | Matches your team's existing documentation voice |
| **Always Current** | Docs update automatically when code changes |
| **Drift Detection** | Alerts you when docs fall out of sync |
| **IDE Integration** | VS Code extension for real-time doc generation |

## How It Works

```mermaid
graph LR
    A[PR Merged] --> B[Webhook]
    B --> C[Change Analysis]
    C --> D[Intent Inference]
    D --> E[Doc Generation]
    E --> F[Review PR]
```

DocSynth observes your development workflow through a GitHub App. When PRs are merged, it:

1. **Analyzes changes** — Parses diffs to understand semantic changes
2. **Infers intent** — Queries PRs, tickets, and chat to understand *why*
3. **Generates docs** — Uses LLMs to produce natural language documentation
4. **Creates PRs** — Opens a pull request with generated docs for review

## Quick Start

Get started in under 5 minutes:

```bash
npm install -g @docsynth/cli
docsynth login
docsynth init
```

Then merge a PR and watch the docs appear.

→ [Full Getting Started Guide](/docs/getting-started)

## Architecture Overview

DocSynth is built as a monorepo with these components:

| Component | Purpose |
|-----------|---------|
| **API** | REST API handling webhooks and requests |
| **Worker** | Background job processing for doc generation |
| **Web** | Dashboard for analytics and configuration |
| **CLI** | Command-line tool for local generation |
| **VS Code Extension** | IDE integration for real-time assistance |

→ [Architecture Deep Dive](/docs/advanced/architecture)
