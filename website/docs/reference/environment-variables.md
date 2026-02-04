---
sidebar_position: 5
title: Environment Variables
description: Complete reference for DocSynth environment variables.
---

# Environment Variables

Complete reference for all DocSynth environment variables.

## Quick Start

Copy the example environment file and configure:

```bash
cp .env.example .env
```

## Required Variables

These must be set for DocSynth to function.

### Database

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/docsynth` |

```bash
DATABASE_URL="postgresql://docsynth:password@localhost:5432/docsynth?schema=public"
```

### Redis

| Variable | Description | Example |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

```bash
REDIS_URL="redis://localhost:6379"
```

### GitHub App

Required for GitHub integration (webhooks, PRs, OAuth):

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_APP_ID` | GitHub App ID | `123456` |
| `GITHUB_APP_PRIVATE_KEY` | Private key (PEM format) | `-----BEGIN RSA PRIVATE KEY-----...` |
| `GITHUB_CLIENT_ID` | OAuth client ID | `Iv1.abc123...` |
| `GITHUB_CLIENT_SECRET` | OAuth client secret | `abc123secret...` |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature secret | `whsec_random_string` |

```bash
GITHUB_APP_ID="123456"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
-----END RSA PRIVATE KEY-----"
GITHUB_CLIENT_ID="Iv1.abc123def456"
GITHUB_CLIENT_SECRET="abc123def456secret"
GITHUB_WEBHOOK_SECRET="whsec_your_webhook_secret"
```

:::tip Multi-line Keys
For the private key, you can either:
1. Include the full PEM with newlines
2. Base64 encode it and set `GITHUB_APP_PRIVATE_KEY_BASE64`
:::

### Security

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for signing JWTs | Random 32+ char string |
| `SESSION_SECRET` | Secret for session encryption | Random 32+ char string |

```bash
JWT_SECRET="your-super-secret-jwt-key-at-least-32-characters"
SESSION_SECRET="your-super-secret-session-key-at-least-32-characters"
```

:::caution
Generate these secrets securely:
```bash
openssl rand -base64 32
```
:::

## LLM Configuration

At least one LLM provider must be configured.

### Anthropic (Claude)

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `ANTHROPIC_MODEL` | Model to use | `claude-sonnet-4-20250514` |
| `ANTHROPIC_MAX_TOKENS` | Max output tokens | `4096` |

```bash
ANTHROPIC_API_KEY="sk-ant-api03-..."
ANTHROPIC_MODEL="claude-sonnet-4-20250514"
ANTHROPIC_MAX_TOKENS="4096"
```

### OpenAI

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | — |
| `OPENAI_MODEL` | Model to use | `gpt-4o` |
| `OPENAI_MAX_TOKENS` | Max output tokens | `4096` |

```bash
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-4o"
OPENAI_MAX_TOKENS="4096"
```

### GitHub Copilot SDK

| Variable | Description | Default |
|----------|-------------|---------|
| `COPILOT_API_KEY` | Copilot SDK API key | — |

```bash
COPILOT_API_KEY="ghu_..."
```

### LLM Selection

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | Primary provider | `anthropic` |
| `LLM_FALLBACK_PROVIDER` | Fallback if primary fails | `openai` |

```bash
LLM_PROVIDER="anthropic"
LLM_FALLBACK_PROVIDER="openai"
```

## Application Settings

### API Server

| Variable | Description | Default |
|----------|-------------|---------|
| `API_PORT` | API server port | `3001` |
| `API_HOST` | API server host | `0.0.0.0` |
| `API_URL` | Public API URL | `http://localhost:3001` |
| `CORS_ORIGINS` | Allowed CORS origins | `http://localhost:3000` |

```bash
API_PORT="3001"
API_HOST="0.0.0.0"
API_URL="https://api.docsynth.dev"
CORS_ORIGINS="https://app.docsynth.dev,https://docsynth.dev"
```

### Web Dashboard

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | API URL for browser | `http://localhost:3001` |
| `WEB_PORT` | Dashboard port | `3000` |

```bash
NEXT_PUBLIC_API_URL="https://api.docsynth.dev"
WEB_PORT="3000"
```

### Worker

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKER_CONCURRENCY` | Max concurrent jobs | `5` |
| `WORKER_MAX_RETRIES` | Max job retry attempts | `3` |
| `WORKER_RETRY_DELAY` | Delay between retries (ms) | `5000` |

```bash
WORKER_CONCURRENCY="10"
WORKER_MAX_RETRIES="3"
WORKER_RETRY_DELAY="5000"
```

## Optional Integrations

### Jira

| Variable | Description |
|----------|-------------|
| `JIRA_BASE_URL` | Jira instance URL |
| `JIRA_API_TOKEN` | API token for authentication |
| `JIRA_EMAIL` | Email associated with token |

```bash
JIRA_BASE_URL="https://your-org.atlassian.net"
JIRA_API_TOKEN="ATATT3xF..."
JIRA_EMAIL="your-email@company.com"
```

### Slack

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token |
| `SLACK_SIGNING_SECRET` | Webhook signing secret |

```bash
SLACK_BOT_TOKEN="xoxb-..."
SLACK_SIGNING_SECRET="..."
```

### Linear

| Variable | Description |
|----------|-------------|
| `LINEAR_API_KEY` | Linear API key |

```bash
LINEAR_API_KEY="lin_api_..."
```

### Confluence

| Variable | Description |
|----------|-------------|
| `CONFLUENCE_BASE_URL` | Confluence instance URL |
| `CONFLUENCE_API_TOKEN` | API token |
| `CONFLUENCE_EMAIL` | Email associated with token |

```bash
CONFLUENCE_BASE_URL="https://your-org.atlassian.net/wiki"
CONFLUENCE_API_TOKEN="ATATT3xF..."
CONFLUENCE_EMAIL="your-email@company.com"
```

### Notion

| Variable | Description |
|----------|-------------|
| `NOTION_API_TOKEN` | Notion integration token |

```bash
NOTION_API_TOKEN="secret_..."
```

## Billing (Optional)

### Stripe

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |

```bash
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PUBLISHABLE_KEY="pk_live_..."
```

## Observability

### Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Minimum log level | `info` |
| `LOG_FORMAT` | Log format | `json` |

```bash
LOG_LEVEL="debug"  # trace, debug, info, warn, error
LOG_FORMAT="json"  # json, pretty
```

### Sentry (Error Tracking)

| Variable | Description |
|----------|-------------|
| `SENTRY_DSN` | Sentry DSN |
| `SENTRY_ENVIRONMENT` | Environment name |

```bash
SENTRY_DSN="https://abc123@sentry.io/123456"
SENTRY_ENVIRONMENT="production"
```

### OpenTelemetry

| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint URL |
| `OTEL_SERVICE_NAME` | Service name |

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
OTEL_SERVICE_NAME="docsynth-api"
```

## Feature Flags

| Variable | Description | Default |
|----------|-------------|---------|
| `FEATURE_KNOWLEDGE_GRAPH` | Enable knowledge graphs | `true` |
| `FEATURE_TRANSLATIONS` | Enable translations | `true` |
| `FEATURE_DIAGRAMS` | Enable diagram generation | `true` |
| `FEATURE_CHAT` | Enable chat interface | `true` |
| `FEATURE_DRIFT_DETECTION` | Enable drift detection | `true` |

```bash
FEATURE_KNOWLEDGE_GRAPH="true"
FEATURE_TRANSLATIONS="true"
FEATURE_DIAGRAMS="true"
FEATURE_CHAT="true"
FEATURE_DRIFT_DETECTION="true"
```

## Rate Limiting

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_ENABLED` | Enable rate limiting | `true` |
| `RATE_LIMIT_WINDOW_MS` | Window in milliseconds | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `100` |

```bash
RATE_LIMIT_ENABLED="true"
RATE_LIMIT_WINDOW_MS="60000"
RATE_LIMIT_MAX_REQUESTS="100"
```

## Example .env File

Complete example for local development:

```bash
# Database
DATABASE_URL="postgresql://docsynth:password@localhost:5432/docsynth?schema=public"
REDIS_URL="redis://localhost:6379"

# GitHub App
GITHUB_APP_ID="123456"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
your-private-key-here
-----END RSA PRIVATE KEY-----"
GITHUB_CLIENT_ID="Iv1.abc123"
GITHUB_CLIENT_SECRET="abc123secret"
GITHUB_WEBHOOK_SECRET="whsec_development_secret"

# Security
JWT_SECRET="development-jwt-secret-at-least-32-chars"
SESSION_SECRET="development-session-secret-at-least-32-chars"

# LLM
ANTHROPIC_API_KEY="sk-ant-api03-..."
# Or: OPENAI_API_KEY="sk-..."

# Application
API_PORT="3001"
API_URL="http://localhost:3001"
NEXT_PUBLIC_API_URL="http://localhost:3001"

# Logging
LOG_LEVEL="debug"
LOG_FORMAT="pretty"

# Feature Flags (all enabled for dev)
FEATURE_KNOWLEDGE_GRAPH="true"
FEATURE_TRANSLATIONS="true"
FEATURE_DIAGRAMS="true"
FEATURE_CHAT="true"
FEATURE_DRIFT_DETECTION="true"
```

## Environment-Specific Configurations

### Development

```bash
NODE_ENV="development"
LOG_LEVEL="debug"
LOG_FORMAT="pretty"
```

### Staging

```bash
NODE_ENV="staging"
LOG_LEVEL="info"
LOG_FORMAT="json"
SENTRY_ENVIRONMENT="staging"
```

### Production

```bash
NODE_ENV="production"
LOG_LEVEL="info"
LOG_FORMAT="json"
SENTRY_ENVIRONMENT="production"
RATE_LIMIT_ENABLED="true"
```

## Validation

DocSynth validates environment variables on startup. Missing required variables will prevent the application from starting.

Check your configuration:

```bash
npm run env:check
```

This will:
1. Verify all required variables are set
2. Validate format (URLs, keys, etc.)
3. Test connectivity to external services

## Security Best Practices

1. **Never commit `.env` files** — Add to `.gitignore`
2. **Use secrets management** — AWS Secrets Manager, HashiCorp Vault, etc.
3. **Rotate secrets regularly** — Especially API keys and JWT secrets
4. **Use different secrets per environment** — Dev, staging, production
5. **Limit access** — Only grant access to those who need it
