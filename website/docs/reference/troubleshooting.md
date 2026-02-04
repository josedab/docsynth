---
sidebar_position: 1
title: Troubleshooting
description: Common issues and solutions.
---

# Troubleshooting

Solutions to common DocSynth issues.

## Installation Issues

### CLI: Command Not Found

```bash
# Check if installed
npm list -g @docsynth/cli

# Reinstall
npm install -g @docsynth/cli

# Or use npx
npx @docsynth/cli --version
```

### Docker: Services Won't Start

```bash
# Check logs
docker-compose logs

# Verify environment variables
docker-compose config

# Restart fresh
docker-compose down -v
docker-compose up -d
```

## Authentication Issues

### Login Failed

1. Clear stored credentials:
```bash
rm ~/.config/docsynth/token
```

2. Re-authenticate:
```bash
docsynth login
```

### Token Expired

Tokens expire after 30 days. Re-authenticate:

```bash
docsynth login
```

### GitHub App Not Authorized

1. Go to GitHub → Settings → Applications
2. Find DocSynth in "Authorized GitHub Apps"
3. Click "Revoke" then reinstall the app

## Webhook Issues

### Webhooks Not Received

1. **Check URL accessibility**
   ```bash
   curl -X POST https://your-api.com/webhooks/github
   # Should return 401 or 200, not connection refused
   ```

2. **Verify webhook secret**
   - Compare `GITHUB_WEBHOOK_SECRET` in your environment
   - With secret in GitHub App settings

3. **Check GitHub delivery logs**
   - GitHub App → Advanced → Recent Deliveries
   - Look for non-200 responses

### Webhook Signature Invalid

Ensure the secret is set correctly:

```bash
# .env
GITHUB_WEBHOOK_SECRET=your_secret_here
```

Restart the API server after changing.

## Generation Issues

### No Documentation Generated

1. **Check configuration exists**
   ```bash
   cat .docsynth.json
   ```

2. **Verify triggers match**
   - Branch in `triggers.branches`?
   - `minImpact` threshold met?

3. **Check job status**
   ```bash
   # Via CLI
   docsynth status
   
   # Via API
   curl https://api.docsynth.dev/jobs?repositoryId=repo_123
   ```

### Poor Quality Output

1. **Improve PR descriptions**
   - Add detailed "What" and "Why" sections
   - Link related issues

2. **Configure style**
   ```json
   {
     "style": {
       "tone": "technical",
       "verbosity": "moderate",
       "guidelines": ["Include code examples"]
     }
   }
   ```

3. **Provide example docs**
   ```json
   {
     "style": {
       "exampleDocs": ["docs/best-example.md"]
     }
   }
   ```

### Generation Timeout

Large repositories may timeout. Solutions:

1. **Narrow scope**
   ```json
   {
     "filters": {
       "includePaths": ["src/api/**/*"],
       "excludePaths": ["**/*.test.*", "**/vendor/**"]
     }
   }
   ```

2. **Increase timeout** (self-hosted)
   ```bash
   JOB_TIMEOUT=300000  # 5 minutes
   ```

## Database Issues

### Connection Refused

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Test connection
docker-compose exec postgres pg_isready

# Check connection string
echo $DATABASE_URL
```

### Migration Failed

```bash
# Reset and re-run migrations
docker-compose exec api npm run db:push

# If schema changed, generate client
docker-compose exec api npm run db:generate
```

## Redis Issues

### Queue Stuck

```bash
# Check queue depth
docker-compose exec redis redis-cli LLEN docsynth:queue:change-analysis

# View stuck jobs
docker-compose exec redis redis-cli LRANGE docsynth:queue:change-analysis 0 10

# Clear queue (caution!)
docker-compose exec redis redis-cli DEL docsynth:queue:change-analysis
```

### Connection Failed

```bash
# Check Redis is running
docker-compose ps redis

# Test connection
docker-compose exec redis redis-cli ping
```

## LLM API Issues

### Rate Limited

```
Error: 429 Too Many Requests
```

Solutions:
1. Wait and retry (automatic)
2. Upgrade API tier
3. Switch providers

### Invalid API Key

```bash
# Verify key is set
echo $ANTHROPIC_API_KEY

# Test key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-sonnet","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
```

## Dashboard Issues

### Page Not Loading

1. **Check API connectivity**
   ```bash
   curl http://localhost:3001/health
   ```

2. **Clear browser cache**
   - Hard refresh: `Cmd/Ctrl + Shift + R`

3. **Check console errors**
   - Open Developer Tools → Console

### Data Not Updating

WebSocket may be disconnected:
1. Refresh the page
2. Check WebSocket connection in Network tab

## VS Code Extension Issues

### Extension Not Loading

1. Check VS Code version (requires 1.80+)
2. Reload window: `Developer: Reload Window`
3. Check Output panel for errors

### Preview Not Updating

1. Save the file
2. Close and reopen preview
3. Check extension settings

## Getting Help

### Collect Debug Information

```bash
# System info
docsynth --version
node --version
npm --version

# Configuration
docsynth config --show

# Recent logs (self-hosted)
docker-compose logs --tail=100
```

### Support Channels

- [GitHub Issues](https://github.com/docsynth/docsynth/issues)
- [GitHub Discussions](https://github.com/docsynth/docsynth/discussions)
- [Discord](https://discord.gg/docsynth)
- Email: support@docsynth.dev
