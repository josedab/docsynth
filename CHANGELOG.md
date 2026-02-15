# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-09

### Added

- **Core pipeline**: Change analysis → Intent inference → Doc generation → Doc review → PR creation
- **API server** (`apps/api`): REST API with 40+ endpoints built on Hono
- **Web dashboard** (`apps/web`): Next.js dashboard with real-time updates
- **Background worker** (`apps/worker`): BullMQ job processor with 17 worker types
- **CLI tool** (`apps/cli`): `docsynth init`, `generate`, `status`, `login`, `config` commands
- **MCP server** (`apps/mcp-server`): Model Context Protocol server for AI agent integration
- **VS Code extension** (`apps/vscode-extension`): Inline docs, preview, health dashboard
- **Multi-SCM support**: GitHub, GitLab, and Bitbucket provider abstraction
- **Multi-LLM support**: Anthropic Claude, OpenAI GPT, GitHub Copilot SDK
- **Integrations**: Jira, Slack, Linear, Confluence, Notion context gathering
- **Documentation health**: Freshness tracking, coverage scanning, drift detection
- **Chat interface**: RAG-powered Q&A about codebases
- **Demo mode**: Explore DocSynth without GitHub App credentials
- **Devcontainer support**: GitHub Codespaces and VS Code Dev Containers
- **Quickstart script**: One-command setup with prerequisite validation
- **Doctor script**: Environment health diagnostics
- **Verify script**: Post-setup smoke test for running services

### Infrastructure

- Monorepo with npm workspaces and Turborepo
- PostgreSQL 16 + Redis 7 via Docker Compose
- Prisma ORM with repository pattern
- Vitest test framework across 10 workspaces
- ESLint + Prettier for code quality
- GitHub Actions CI pipeline (lint, typecheck, build, unit + integration tests)
