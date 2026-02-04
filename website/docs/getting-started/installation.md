---
sidebar_position: 2
title: Installation
description: Install DocSynth using npm, Docker, or self-host.
---

# Installation

DocSynth can be installed in several ways depending on your needs.

## CLI Installation (Recommended)

The fastest way to get started is with the DocSynth CLI:

```bash
npm install -g @docsynth/cli
```

Or with your preferred package manager:

```bash
# Yarn
yarn global add @docsynth/cli

# pnpm
pnpm add -g @docsynth/cli
```

Verify the installation:

```bash
docsynth --version
```

## Docker (Self-Hosted)

For self-hosted deployments, use Docker Compose:

```bash
# Clone the repository
git clone https://github.com/docsynth/docsynth.git
cd docsynth

# Copy environment configuration
cp .env.example .env

# Start all services
docker-compose up -d
```

This starts:
- **API server** on port 3001
- **Web dashboard** on port 3000
- **Worker** for background processing
- **PostgreSQL** database
- **Redis** for job queues

## Development Setup

For contributing or running locally:

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL and Redis)
- A GitHub account

### Steps

```bash
# Clone the repository
git clone https://github.com/docsynth/docsynth.git
cd docsynth

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Start database services
docker-compose up -d postgres redis

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:push

# Start all services in development mode
npm run dev
```

### Environment Variables

Key variables to configure in `.env`:

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `GITHUB_APP_ID` | GitHub App ID | Yes |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key | Yes |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | Yes |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | Yes |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature secret | Yes |
| `SESSION_SECRET` | Session encryption key | Yes |
| `JWT_SECRET` | JWT signing key | Yes |

See [Configuration](/docs/guides/configuring-docsynth) for the complete list.

## Cloud Hosted

DocSynth Cloud handles all infrastructure for you:

1. Sign up at [docsynth.dev](https://docsynth.dev)
2. Install the GitHub App on your repositories
3. Start generating documentation

No servers to manage, automatic updates, and enterprise-grade security.

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Node.js | 20.x | Latest LTS |
| Memory | 2 GB | 4 GB |
| Storage | 10 GB | 50 GB |
| PostgreSQL | 14.x | 16.x |
| Redis | 6.x | 7.x |

## Next Steps

- [Quick Start](/docs/getting-started/quick-start) — Generate your first docs
- [GitHub App Setup](/docs/getting-started/github-app-setup) — Configure the GitHub integration
- [Configuration](/docs/guides/configuring-docsynth) — Customize DocSynth behavior
