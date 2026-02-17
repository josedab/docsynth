# Architecture

This document describes DocSynth's internal architecture, data flow, and key design decisions. For setup instructions, see the [README](README.md). For contributing guidelines, see [CONTRIBUTING](CONTRIBUTING.md).

## System Overview

DocSynth is a monorepo built with **npm workspaces** and **Turborepo**. It follows an event-driven architecture: GitHub webhooks trigger an asynchronous processing pipeline that analyzes code changes, infers intent, generates documentation, and opens PRs.

```
PR Merged → Webhook → API → Redis Queue → Worker Pipeline → PR Created
```

## Applications

| App                     | Framework    | Purpose                                                                         |
| ----------------------- | ------------ | ------------------------------------------------------------------------------- |
| `apps/api`              | Hono         | REST API server (port 3001). Receives webhooks, serves endpoints, manages auth. |
| `apps/web`              | Next.js 16   | Dashboard (port 3000). Real-time status, health metrics, configuration UI.      |
| `apps/worker`           | BullMQ       | Background job processor. Runs the doc generation pipeline asynchronously.      |
| `apps/cli`              | Commander.js | CLI tool for local doc generation, status checks, and cloud login.              |
| `apps/mcp-server`       | MCP SDK      | Model Context Protocol server for AI agent integration.                         |
| `apps/vscode-extension` | VS Code API  | IDE integration for inline docs, previews, and health checks.                   |

## Shared Packages

| Package              | Purpose                                                         | Key Dependencies    |
| -------------------- | --------------------------------------------------------------- | ------------------- |
| `@docsynth/types`    | Domain types and interfaces. No runtime dependencies.           | None                |
| `@docsynth/config`   | Environment config (Zod-validated), feature flags, tier limits. | `zod`               |
| `@docsynth/database` | Prisma ORM client, schema, migrations. Repository pattern.      | `@prisma/client`    |
| `@docsynth/github`   | GitHub App/OAuth client, webhook handling.                      | `octokit`           |
| `@docsynth/queue`    | BullMQ queue definitions, job types, Redis connection.          | `bullmq`, `ioredis` |
| `@docsynth/utils`    | Logging (pino), error handling, retry logic, LLM clients.       | `pino`              |

### Build Order

Packages must be built before apps that depend on them. Turborepo handles this automatically via `dependsOn: ["^build"]` in `turbo.json`.

```
@docsynth/types        ← no dependencies, builds first
@docsynth/config       ← depends on types
@docsynth/utils        ← depends on types, config
@docsynth/database     ← depends on types (Prisma client must be generated)
@docsynth/github       ← depends on types, config, utils
@docsynth/queue        ← depends on types
    ↓
apps/api, apps/worker, apps/web, apps/cli, etc.
```

## Core Processing Pipeline

When a PR is merged, DocSynth runs a multi-stage pipeline. Each stage is a separate BullMQ job, enabling retries, monitoring, and independent scaling.

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  PR Webhook  │────▶│ Change Analysis  │────▶│ Intent Inference │
│  (API)       │     │ (Worker)         │     │ (Worker)         │
└──────────────┘     └──────────────────┘     └──────────────────┘
                            │                         │
                            ▼                         ▼
                     Parse diffs,              Gather context from
                     identify semantic         PR description, Jira,
                     changes (functions,       Slack, Linear to
                     classes, APIs)            understand "why"
                                                      │
                     ┌──────────────────┐              │
                     │  Doc Generation  │◀─────────────┘
                     │  (Worker)        │
                     └──────────────────┘
                            │
                            ▼
                     Generate docs via
                     LLM (Anthropic/OpenAI/
                     GitHub Copilot)
                            │
                     ┌──────────────────┐     ┌──────────────────┐
                     │   Doc Review     │────▶│  PR Creation     │
                     │   (Worker)       │     │  (Worker)        │
                     └──────────────────┘     └──────────────────┘
                            │                         │
                            ▼                         ▼
                     AI quality review,        Open a PR with
                     validation, style         generated docs
                     checking                  for human review
```

### Job Queue Categories

Jobs are defined in `packages/queue/src/types.ts`. Key categories:

| Category          | Queue Names                                                                         | Description                                                           |
| ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Core Pipeline** | `change-analysis`, `intent-inference`, `doc-generation`, `doc-review`, `pr-preview` | The primary doc generation flow triggered by webhooks.                |
| **Scanning**      | `drift-scan`, `health-scan`, `coverage-scan`, `compliance-scan`                     | Periodic jobs that check doc freshness, coverage, and compliance.     |
| **AI Features**   | `chat-rag`, `vector-index`, `knowledge-graph`, `citation-index`                     | RAG-powered search, embedding indexing, knowledge graph construction. |
| **Integrations**  | `notifications`, `bot-message`, `polling`                                           | Slack notifications, bot messages, external service polling.          |
| **Advanced**      | `diagram-generation`, `translation`, `adr-generation`, `example-validation`         | Diagram rendering, i18n, ADR generation, code example validation.     |

Workers are implemented in `apps/worker/src/workers/` — one file per job type.

## Data Model

The database schema is defined in `packages/database/prisma/schema.prisma` (131 models). Key entities:

```
Organization ──┬── User (members)
               ├── Repository ──┬── Document ── DocVersion (versioned content)
               │                ├── PREvent (webhook events)
               │                ├── ChangeAnalysis (diff parsing results)
               │                ├── GenerationJob (LLM generation tasks)
               │                └── HealthScoreSnapshot (doc health over time)
               ├── Subscription (billing tier)
               ├── Integration (Jira, Slack, Linear, etc.)
               └── ApiKey (API authentication)
```

### Core Entities

- **Organization** — Top-level tenant. Has users, repos, subscriptions.
- **Repository** — A connected GitHub/GitLab/Bitbucket repo. Stores config and installation ID.
- **Document** — A generated or tracked documentation file. Has versions.
- **PREvent** — A GitHub webhook event (PR opened, merged, etc.).
- **ChangeAnalysis** — Parsed diff results: which functions/classes/APIs changed.
- **IntentContext** — Inferred "why" from PR description, linked issues, Slack threads.
- **GenerationJob** — An LLM doc generation task with status, input, and output.
- **StyleProfile** — Customizable writing tone and style settings per repo.

## Infrastructure

| Component   | Technology          | Purpose                                          |
| ----------- | ------------------- | ------------------------------------------------ |
| Database    | PostgreSQL 16       | Primary data store (via Prisma ORM)              |
| Cache/Queue | Redis 7             | BullMQ job queue backend and caching             |
| Container   | Docker Compose      | Local development orchestration                  |
| Build       | Turborepo           | Monorepo build orchestration with caching        |
| Test        | Vitest              | Test framework across all workspaces             |
| Lint        | ESLint 9 + Prettier | Code quality and formatting                      |
| CI          | GitHub Actions      | Lint, typecheck, build, unit + integration tests |

## Key Design Decisions

For detailed rationale, see [ADR records](docs/adr/).

- **Hono over Express** — Lightweight, TypeScript-first, Web Standards compatible, excellent middleware ecosystem.
- **BullMQ over alternatives** — Redis-backed, battle-tested, built-in retries/priorities/rate-limiting, excellent TypeScript support.
- **Prisma over raw SQL** — Type-safe queries, auto-generated client, schema-as-code with migrations.
- **Monorepo with npm workspaces** — Shared types and config without publishing packages, Turborepo for fast cached builds.
- **ESM throughout** — All packages use `"type": "module"`. Node.js 20+ required.

## Directory Quick Reference

```
apps/api/src/
├── routes/           # 85 route files (one per feature area)
├── services/         # Business logic (one per route file)
├── handlers/         # Request handlers
├── middleware/        # Auth, error handling, rate limiting
├── schemas/          # Zod request/response schemas
├── docs/             # OpenAPI spec generation
└── __tests__/        # API tests

apps/worker/src/
├── workers/          # 61 worker files (one per job type)
├── services/         # Worker business logic
└── __tests__/        # Worker tests

packages/database/
├── prisma/
│   ├── schema.prisma # 131 models, ~3000 lines
│   └── seed.ts       # Sample data seeding
└── src/              # Repository pattern wrappers
```
