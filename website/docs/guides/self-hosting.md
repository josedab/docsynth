---
sidebar_position: 7
title: Self-Hosting
description: Deploy DocSynth on your own infrastructure.
---

# Self-Hosting

Deploy DocSynth on your own infrastructure for full control over your data.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Load Balancer                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   API (3001)  │   │   Web (3000)  │   │    Worker     │
│    (Hono)     │   │   (Next.js)   │   │   (BullMQ)    │
└───────┬───────┘   └───────────────┘   └───────┬───────┘
        │                                       │
        └───────────────────┬───────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  PostgreSQL   │   │     Redis     │   │   LLM API     │
│   (Database)  │   │    (Queue)    │   │ (Anthropic/   │
│               │   │               │   │   OpenAI)     │
└───────────────┘   └───────────────┘   └───────────────┘
```

## Quick Start with Docker

### Prerequisites

- Docker 20+
- Docker Compose 2+
- 4GB RAM minimum
- GitHub App created ([instructions](/docs/getting-started/github-app-setup))

### Steps

```bash
# Clone the repository
git clone https://github.com/docsynth/docsynth.git
cd docsynth

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# (see Configuration section below)

# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### Services Started

| Service | Port | Description |
|---------|------|-------------|
| `api` | 3001 | REST API server |
| `web` | 3000 | Dashboard |
| `worker` | - | Background processor |
| `postgres` | 5432 | Database |
| `redis` | 6379 | Job queue |

### Verify Installation

```bash
# Check API health
curl http://localhost:3001/health

# Open dashboard
open http://localhost:3000
```

## Configuration

### Required Environment Variables

```bash
# Node
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://docsynth:password@postgres:5432/docsynth

# Redis
REDIS_URL=redis://redis:6379

# GitHub App (required)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
GITHUB_CLIENT_ID=Iv1.abc123
GITHUB_CLIENT_SECRET=abc123
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# Security
SESSION_SECRET=generate_32_char_secret
JWT_SECRET=generate_32_char_secret

# URLs
APP_URL=https://docsynth.yourcompany.com
API_URL=https://api.docsynth.yourcompany.com
```

### LLM Configuration

Choose your LLM provider:

```bash
# Anthropic (recommended)
ANTHROPIC_API_KEY=sk-ant-...

# OR OpenAI
OPENAI_API_KEY=sk-...

# OR GitHub Copilot
COPILOT_API_KEY=...
```

### Optional Integrations

```bash
# Jira
JIRA_BASE_URL=https://company.atlassian.net
JIRA_EMAIL=bot@company.com
JIRA_API_TOKEN=...

# Slack
SLACK_BOT_TOKEN=xoxb-...

# Linear
LINEAR_API_KEY=lin_api_...
```

## Production Deployment

### Docker Compose (Production)

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  api:
    image: ghcr.io/docsynth/docsynth-api:latest
    restart: always
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    ports:
      - "3001:3001"
    depends_on:
      - postgres
      - redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  web:
    image: ghcr.io/docsynth/docsynth-web:latest
    restart: always
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    ports:
      - "3000:3000"
    depends_on:
      - api

  worker:
    image: ghcr.io/docsynth/docsynth-worker:latest
    restart: always
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16
    restart: always
    environment:
      POSTGRES_USER: docsynth
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: docsynth
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U docsynth"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

### Kubernetes

Helm chart available:

```bash
helm repo add docsynth https://charts.docsynth.dev
helm install docsynth docsynth/docsynth \
  --set github.appId=123456 \
  --set github.clientId=Iv1.abc123 \
  --set-file github.privateKey=./private-key.pem \
  --set anthropic.apiKey=sk-ant-...
```

### AWS Deployment

Using Terraform:

```hcl
module "docsynth" {
  source = "github.com/docsynth/terraform-aws-docsynth"

  vpc_id     = var.vpc_id
  subnet_ids = var.private_subnet_ids

  github_app_id     = var.github_app_id
  github_client_id  = var.github_client_id
  github_private_key = file("./private-key.pem")

  anthropic_api_key = var.anthropic_api_key

  domain_name = "docsynth.yourcompany.com"
}
```

## Database Management

### Migrations

```bash
# Run migrations
docker-compose exec api npm run db:migrate

# Generate Prisma client
docker-compose exec api npm run db:generate
```

### Backup

```bash
# Backup database
docker-compose exec postgres pg_dump -U docsynth docsynth > backup.sql

# Restore database
docker-compose exec -T postgres psql -U docsynth docsynth < backup.sql
```

## Scaling

### Horizontal Scaling

Scale workers for higher throughput:

```bash
docker-compose up -d --scale worker=3
```

### Database Scaling

For high-volume deployments:

- Use managed PostgreSQL (RDS, Cloud SQL)
- Enable connection pooling (PgBouncer)
- Configure read replicas

### Redis Scaling

- Use Redis Cluster for HA
- Or managed Redis (ElastiCache, Memorystore)

## Monitoring

### Health Checks

```bash
# API health
curl http://localhost:3001/health

# Worker health (via Redis)
redis-cli LLEN docsynth:queue:change-analysis
```

### Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f worker

# JSON logs for production
docker-compose logs -f --format json
```

### Metrics

DocSynth exposes Prometheus metrics:

```bash
curl http://localhost:3001/metrics
```

Key metrics:
- `docsynth_jobs_processed_total`
- `docsynth_jobs_failed_total`
- `docsynth_generation_duration_seconds`
- `docsynth_queue_depth`

## Security

### Network Security

- Run behind a reverse proxy (nginx, Traefik)
- Use HTTPS everywhere
- Restrict database access to internal network

### Secrets Management

- Use environment variables or secrets manager
- Never commit secrets to git
- Rotate credentials regularly

### Example nginx Configuration

```nginx
server {
    listen 443 ssl;
    server_name docsynth.yourcompany.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    location / {
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api {
        proxy_pass http://api:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /webhooks {
        proxy_pass http://api:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Troubleshooting

### Services Won't Start

```bash
# Check logs
docker-compose logs api

# Verify environment variables
docker-compose config

# Restart services
docker-compose restart
```

### Database Connection Failed

```bash
# Check PostgreSQL is running
docker-compose exec postgres pg_isready

# Verify connection string
docker-compose exec api env | grep DATABASE_URL
```

### Webhooks Not Received

1. Verify webhook URL is publicly accessible
2. Check GitHub App webhook settings
3. Review webhook delivery logs in GitHub

### Jobs Stuck in Queue

```bash
# Check queue depth
docker-compose exec redis redis-cli LLEN docsynth:queue:change-analysis

# Clear stuck jobs (caution!)
docker-compose exec redis redis-cli FLUSHDB
```

## Upgrades

### Updating DocSynth

```bash
# Pull latest images
docker-compose pull

# Run migrations
docker-compose exec api npm run db:migrate

# Restart services
docker-compose up -d
```

### Version Compatibility

Check the [changelog](https://github.com/docsynth/docsynth/releases) for breaking changes before upgrading.

## Next Steps

- [GitHub App Setup](/docs/getting-started/github-app-setup) — Configure GitHub integration
- [Configuration](/docs/guides/configuring-docsynth) — Customize behavior
- [Integrations](/docs/guides/integrations) — Connect external tools
