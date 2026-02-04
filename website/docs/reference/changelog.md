---
sidebar_position: 3
title: Changelog
description: Release history and version notes
---

# Changelog

All notable changes to DocSynth are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-01

### 🚀 Initial Beta Release

This is the first public beta release of DocSynth.

### Added

#### Core Features
- **AI-Powered Documentation Generation** — Automatic documentation from code changes using Anthropic Claude and OpenAI GPT
- **GitHub Integration** — GitHub App with webhook support for automatic triggers on PR merge
- **Multi-Source Context** — Context gathering from GitHub PRs, Jira, Slack, Linear, Confluence, and Notion
- **Style Learning** — Learn and match your team's documentation voice and style
- **Processing Pipeline** — Complete pipeline: Change Analysis → Intent Inference → Doc Generation → Review → PR Creation

#### Applications
- **REST API** (`apps/api`) — 40+ endpoints for programmatic access
- **Web Dashboard** (`apps/web`) — Next.js dashboard for configuration and monitoring
- **Background Worker** (`apps/worker`) — BullMQ-based job processor with 17+ job types
- **CLI** (`apps/cli`) — Command-line tool for local generation and project setup
- **VS Code Extension** (`apps/vscode-extension`) — IDE integration with real-time preview

#### Features
- **Drift Detection** — Detect when documentation falls out of sync with code
- **Health Scoring** — Track documentation freshness, completeness, and accuracy
- **Diagram Generation** — Auto-generate Mermaid architecture diagrams
- **Knowledge Graphs** — Build semantic relationships between documentation
- **Multi-Language Translation** — Translate documentation to multiple languages
- **Chat Interface** — RAG-powered Q&A about your codebase

#### Configuration
- `.docsynth.json` configuration file support
- Customizable triggers, filters, and doc types
- Style configuration with tone and example preferences

### Infrastructure
- PostgreSQL database with Prisma ORM
- Redis for job queue and caching
- Docker Compose for local development
- Turbo monorepo with shared packages

### Security
- JWT-based authentication
- GitHub App secure webhook validation
- API key management with scoping
- Rate limiting by tier

---

## Versioning

DocSynth follows semantic versioning:

- **MAJOR** versions include breaking changes
- **MINOR** versions add functionality in a backward-compatible manner
- **PATCH** versions include backward-compatible bug fixes

## Upgrade Guides

When upgrading between major versions, check the release notes above for breaking changes and upgrade instructions.

## Beta Notice

DocSynth is currently in **beta**. While we strive for stability, expect:

- API changes between minor versions
- New features rolling out regularly
- Occasional bugs that we'll fix quickly

We value your feedback during beta! Please report issues on [GitHub](https://github.com/docsynth/docsynth/issues).
