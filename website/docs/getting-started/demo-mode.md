---
sidebar_position: 5
title: Demo Mode
description: Explore DocSynth without a GitHub App using built-in demo mode.
---

# Demo Mode

Demo mode lets you explore DocSynth's full feature set without configuring a GitHub App or connecting external services. It's the fastest way to evaluate DocSynth.

## What Demo Mode Provides

When `DEMO_MODE=true`, DocSynth:

- **Seeds sample data** — Repositories, documents, jobs, and health scores pre-populated
- **Simulates the pipeline** — Trigger mock documentation generation
- **Enables the full dashboard** — Browse all UI features with realistic data
- **Skips GitHub App** — No OAuth credentials needed
- **Works offline** — Only requires PostgreSQL and Redis (via Docker)

## Quick Start

The quickstart script enables demo mode automatically:

```bash
git clone https://github.com/docsynth/docsynth.git
cd docsynth
npm run quickstart
```

This single command:

1. Checks prerequisites (Node.js 20+, Docker)
2. Installs dependencies
3. Creates `.env` with `DEMO_MODE=true` and auto-generated secrets
4. Starts PostgreSQL and Redis via Docker
5. Applies the database schema and seeds sample data
6. Launches all development servers

Open:

- **Dashboard:** http://localhost:3000
- **API Docs:** http://localhost:3001/docs

## Manual Setup

If you prefer step-by-step control:

```bash
git clone https://github.com/docsynth/docsynth.git
cd docsynth
npm install

# Create .env with demo mode enabled
cp .env.example .env
```

Edit `.env` and set:

```bash
DEMO_MODE=true
SESSION_SECRET=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
```

Then start services:

```bash
docker compose up -d        # Start PostgreSQL and Redis
npm run db:generate          # Generate Prisma client
npm run db:push              # Apply schema
npm run db:seed              # Seed sample data
npm run dev                  # Start all servers
```

## What You'll See

### Dashboard

The seeded data includes:

| Data          | Count    | Description                                |
| ------------- | -------- | ------------------------------------------ |
| Repositories  | 3        | Sample repos with different configurations |
| Documents     | 24       | Generated documentation files              |
| Jobs          | 50+      | Completed and in-progress pipeline jobs    |
| Health scores | Per-repo | Freshness, coverage, and link health       |

### API

The API is fully functional at http://localhost:3001 with:

- All 40+ REST endpoints active
- OpenAPI/Swagger documentation at `/docs`
- Sample data in all endpoints

Try it:

```bash
# List repositories
curl http://localhost:3001/repositories

# Check API health
curl http://localhost:3001/health

# View documentation for a repository
curl http://localhost:3001/documents?repositoryId=demo-repo-1
```

### CLI

The CLI works in demo mode too:

```bash
# Check status (reads local .docsynth.json)
npx tsx apps/cli/src/index.ts status

# Generate docs locally (uses mock LLM responses)
npx tsx apps/cli/src/index.ts generate --dry-run
```

## Exploring Without Docker

If you don't have Docker and just want to browse the code:

```bash
npm install
npm run db:generate       # Generate Prisma client (for types)
npm run test:unit         # Run unit tests — no Docker needed
npm run typecheck         # Type-check all packages
```

Run example scripts with mock data:

```bash
DEMO=true npx tsx examples/api-usage.ts
npx tsx examples/scm-provider-usage.ts
```

## Switching to Production

When you're ready to connect real repositories:

1. Edit `.env` and set `DEMO_MODE=false`
2. Configure your [GitHub App credentials](/docs/getting-started/github-app-setup)
3. Restart the services: `npm run dev`

```bash
# In .env
DEMO_MODE=false
GITHUB_APP_ID=your_app_id
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_WEBHOOK_SECRET=your_webhook_secret
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
```

The database retains demo data. To start fresh:

```bash
npm run db:push -- --force-reset   # Reset database
npm run db:seed                     # Optional: re-seed demo data
```

## Environment Variables for Demo Mode

| Variable         | Value           | Notes                      |
| ---------------- | --------------- | -------------------------- |
| `DEMO_MODE`      | `true`          | Enables demo mode          |
| `DATABASE_URL`   | Auto-configured | Points to local PostgreSQL |
| `REDIS_URL`      | Auto-configured | Points to local Redis      |
| `SESSION_SECRET` | Auto-generated  | Min 32 characters          |
| `JWT_SECRET`     | Auto-generated  | Min 32 characters          |

All GitHub App and integration variables are optional in demo mode.

## Troubleshooting

### "Can't reach database server"

PostgreSQL isn't running. Start it:

```bash
docker compose up -d postgres
```

### "connect ECONNREFUSED 127.0.0.1:6379"

Redis isn't running. Start it:

```bash
docker compose up -d redis
```

### "Invalid environment configuration"

Run the doctor script to diagnose:

```bash
npm run doctor
```

Ensure `SESSION_SECRET` and `JWT_SECRET` are at least 32 characters.

### Empty dashboard

Seed data may not have been loaded:

```bash
npm run db:seed
```

## Next Steps

- [GitHub App Setup](/docs/getting-started/github-app-setup) — Connect real repositories
- [Configuration](/docs/guides/configuring-docsynth) — Customize `.docsynth.json`
- [Core Concepts](/docs/core-concepts) — Understand how DocSynth works
