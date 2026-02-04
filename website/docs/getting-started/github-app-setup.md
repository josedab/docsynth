---
sidebar_position: 4
title: GitHub App Setup
description: Configure the DocSynth GitHub App for automatic documentation.
---

# GitHub App Setup

The DocSynth GitHub App enables automatic documentation generation when PRs are merged.

## Installing the App

### Step 1: Visit the App Page

Go to [github.com/apps/docsynth](https://github.com/apps/docsynth) and click **Install**.

### Step 2: Select Repositories

Choose which repositories DocSynth can access:

- **All repositories** — DocSynth can document any repo in your account/org
- **Only select repositories** — Choose specific repos (recommended for trying it out)

### Step 3: Review Permissions

DocSynth requests these permissions:

| Permission | Access | Purpose |
|------------|--------|---------|
| **Contents** | Read & Write | Read code, create documentation files |
| **Pull requests** | Read & Write | Read PR context, create doc update PRs |
| **Issues** | Read | Gather context from linked issues |
| **Metadata** | Read | Repository metadata for configuration |
| **Webhooks** | - | Receive PR merge events |

### Step 4: Authorize

Click **Install & Authorize** to complete setup.

## Webhook Events

DocSynth subscribes to these webhook events:

| Event | Trigger |
|-------|---------|
| `pull_request.closed` (merged) | Main trigger for doc generation |
| `push` | Optional: trigger on direct pushes |
| `installation.created` | App installed on new repos |

## Creating Your Own GitHub App

For self-hosted deployments, create your own GitHub App:

### 1. Create the App

1. Go to **Settings → Developer settings → GitHub Apps**
2. Click **New GitHub App**
3. Fill in the details:

| Field | Value |
|-------|-------|
| App name | DocSynth (your-org) |
| Homepage URL | Your DocSynth dashboard URL |
| Webhook URL | `https://your-api.com/webhooks/github` |
| Webhook secret | Generate a secure random string |

### 2. Set Permissions

Under **Repository permissions**:

```
Contents: Read and write
Pull requests: Read and write
Issues: Read-only
Metadata: Read-only
```

### 3. Subscribe to Events

Check these events:
- Pull request
- Push
- Installation

### 4. Generate Private Key

1. Scroll to **Private keys**
2. Click **Generate a private key**
3. Save the downloaded `.pem` file securely

### 5. Configure DocSynth

Add these to your `.env`:

```bash
GITHUB_APP_ID=123456
GITHUB_CLIENT_ID=Iv1.abc123...
GITHUB_CLIENT_SECRET=abc123...
GITHUB_WEBHOOK_SECRET=your_webhook_secret
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...your key content...
-----END RSA PRIVATE KEY-----"
```

:::tip Multi-line Environment Variables
For the private key, you can either:
- Keep it as a single line with `\n` for newlines
- Use quotes and actual newlines as shown above
- Reference a file path: `GITHUB_APP_PRIVATE_KEY_PATH=/path/to/key.pem`
:::

## Verifying the Installation

### Check Repository Access

In your repository settings, go to **Integrations → GitHub Apps** to verify DocSynth is installed.

### Test the Webhook

1. Create a test branch and PR
2. Merge the PR
3. Check the DocSynth dashboard for the job
4. Wait for the documentation PR

### Webhook Delivery Logs

View webhook delivery history:

1. Go to your GitHub App settings
2. Click **Advanced** → **Recent Deliveries**
3. Verify deliveries show `200 OK`

## Organization Settings

For organization repositories:

### Require Approval

Organization owners can require approval before apps access repos:

1. Go to **Organization Settings → Third-party Access**
2. Set approval policy
3. Review pending requests

### Restrict App Installation

Limit who can install apps:

1. Go to **Organization Settings → GitHub Apps**
2. Configure installation policies

## Troubleshooting

### App Not Receiving Webhooks

1. Verify webhook URL is correct
2. Check webhook secret matches
3. Ensure your server is publicly accessible
4. Review webhook delivery logs for errors

### Permission Denied Errors

1. Verify app has required permissions
2. Check repository access settings
3. Re-authorize the app if permissions changed

### Rate Limiting

DocSynth respects GitHub's rate limits:

- 5,000 requests/hour for authenticated apps
- Automatically retries with backoff
- Prioritizes critical operations

See [Troubleshooting](/docs/reference/troubleshooting) for more solutions.

## Security Considerations

- **Webhook secrets** — Always use webhook secrets to verify payloads
- **Private key storage** — Never commit private keys; use environment variables or secret managers
- **Minimal permissions** — Only grant permissions DocSynth needs
- **Audit logs** — Review app activity in organization audit logs

## Next Steps

- [Configuration](/docs/guides/configuring-docsynth) — Customize documentation behavior
- [Core Concepts](/docs/core-concepts) — Understand how DocSynth processes changes
- [Integrations](/docs/guides/integrations) — Connect Jira, Slack, and more
