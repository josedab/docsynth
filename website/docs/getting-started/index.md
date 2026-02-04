---
sidebar_position: 1
title: Getting Started
description: Get DocSynth up and running in under 5 minutes.
---

# Getting Started

Get DocSynth generating documentation for your repository in under 5 minutes.

## Prerequisites

- **Node.js 20+** — [Download](https://nodejs.org/)
- **GitHub account** — For installing the DocSynth GitHub App
- A repository you want to document

## Quick Start

### 1. Install the CLI

```bash
npm install -g @docsynth/cli
```

### 2. Authenticate

```bash
docsynth login
```

This opens your browser to authenticate with GitHub.

### 3. Initialize Your Repository

Navigate to your repository and run:

```bash
cd your-repo
docsynth init
```

This creates a `.docsynth.json` configuration file and installs the GitHub App.

### 4. Generate Your First Docs

```bash
docsynth generate
```

DocSynth analyzes your codebase and generates initial documentation.

### 5. Merge a PR

Now merge any PR to your repository. DocSynth will:

1. Analyze the changes
2. Generate updated documentation
3. Open a PR with the new docs

## What's Next?

- [Installation Options](/docs/getting-started/installation) — Self-hosting, Docker, cloud
- [Quick Start](/docs/getting-started/quick-start) — Detailed walkthrough with examples
- [GitHub App Setup](/docs/getting-started/github-app-setup) — Permissions and configuration
- [Configuration](/docs/guides/configuring-docsynth) — Customize behavior with `.docsynth.json`

## Need Help?

- [Troubleshooting](/docs/reference/troubleshooting) — Common issues and solutions
- [FAQ](/docs/reference/faq) — Frequently asked questions
- [GitHub Discussions](https://github.com/docsynth/docsynth/discussions) — Ask the community
