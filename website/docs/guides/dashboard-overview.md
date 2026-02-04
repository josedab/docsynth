---
sidebar_position: 4
title: Dashboard Overview
description: Navigate the DocSynth web dashboard.
---

# Dashboard Overview

The DocSynth dashboard provides visibility into documentation health, job status, and analytics.

## Accessing the Dashboard

- **Cloud:** [app.docsynth.dev](https://app.docsynth.dev)
- **Self-hosted:** Your configured URL (default: `http://localhost:3000`)

## Main Navigation

```
┌─────────────────────────────────────────────────────────────────┐
│ DocSynth                    [Search]              [User Menu]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📊 Dashboard      Overview and quick stats                     │
│  📄 Documents      All generated documentation                  │
│  📈 Analytics      Usage metrics and trends                     │
│  🏥 Health         Documentation health scores                  │
│  �� Repositories   Connected repositories                       │
│  ⚙️  Jobs          Processing queue status                      │
│  🔧 Settings       Configuration and integrations               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Dashboard Home

The main dashboard shows:

### Quick Stats

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│   Repos     │    Docs     │   Jobs      │   Health    │
│     12      │    156      │   24/hr     │    92%      │
│  Connected  │  Generated  │  Processed  │   Score     │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

### Recent Activity

| Time | Event |
|------|-------|
| 2m ago | Docs generated for `api-service` |
| 15m ago | PR #43 created with docs |
| 1h ago | Health scan completed |

### Health Alerts

```
⚠️ 3 documents need attention

• docs/api/users.md - Last updated 45 days ago
• README.md - Drift detected
• docs/guides/setup.md - Broken links found
```

## Documents

Browse all generated documentation:

### Document List

| Document | Repository | Last Updated | Health |
|----------|------------|--------------|--------|
| API Reference | api-service | 2 hours ago | 🟢 95 |
| README | api-service | 1 day ago | 🟢 88 |
| Changelog | api-service | 2 hours ago | 🟢 100 |
| Setup Guide | web-app | 30 days ago | 🟡 65 |

### Document Detail

View a specific document:

- **Content preview** — Rendered markdown
- **History** — All versions and changes
- **Health metrics** — Freshness, coverage, links
- **Related PRs** — Source PRs that generated this doc

## Analytics

Track documentation metrics:

### Generation Metrics

```
Documents Generated (Last 30 Days)
═══════════════════════════════════
     ▄▄▄▄
   ▄█████▄
  ▄███████▄    ▄▄
 ▄█████████▄  ▄██▄
▄███████████▄▄████▄▄▄
─────────────────────────
Week 1   Week 2   Week 3   Week 4
```

### Coverage Over Time

| Metric | 30 Days Ago | Today | Change |
|--------|-------------|-------|--------|
| Coverage | 67% | 84% | +17% |
| Avg Health | 78 | 91 | +13 |
| Docs Count | 89 | 156 | +67 |

### Top Contributors

| User | Docs Generated | PRs Merged |
|------|----------------|------------|
| @alice | 34 | 45 |
| @bob | 28 | 32 |
| @carol | 22 | 27 |

## Health Dashboard

Monitor documentation health:

### Health Score Breakdown

```
Overall Health: 92/100
═══════════════════════

Freshness     ████████░░  85%
Coverage      █████████░  92%
Link Health   ██████████  100%
Style Score   █████████░  91%
```

### Health Trends

```
Health Score (90 Days)
100 ┤                    ╭───
 90 ┤           ╭────────╯
 80 ┤    ╭──────╯
 70 ┤────╯
    └──────────────────────────
     Jan    Feb    Mar
```

### Issues by Category

| Category | Count | Priority |
|----------|-------|----------|
| Stale docs | 5 | Medium |
| Broken links | 2 | High |
| Missing sections | 8 | Low |
| Style inconsistency | 3 | Low |

### Drift Alerts

Documents that may be out of sync:

| Document | Last Doc Update | Last Code Change | Status |
|----------|-----------------|------------------|--------|
| api/users.md | 30 days ago | 2 days ago | ⚠️ Drift |
| api/auth.md | 5 days ago | 5 days ago | ✅ Synced |

## Repositories

Manage connected repositories:

### Repository List

| Repository | Status | Last Activity | Health |
|------------|--------|---------------|--------|
| api-service | ✅ Active | 2 hours ago | 92 |
| web-app | ✅ Active | 1 day ago | 85 |
| cli-tool | ⏸️ Paused | 30 days ago | 78 |

### Repository Settings

Per-repository configuration:

- **Enable/disable** documentation generation
- **Branch configuration** — Which branches trigger generation
- **Doc types** — Override global settings
- **Integrations** — Per-repo context sources

## Jobs

Monitor the processing queue:

### Active Jobs

| Job ID | Repository | Stage | Started | Progress |
|--------|------------|-------|---------|----------|
| job_abc | api-service | Generating | 30s ago | 60% |
| job_def | web-app | Analyzing | 1m ago | 25% |

### Job History

| Job ID | Repository | Status | Duration | Docs |
|--------|------------|--------|----------|------|
| job_123 | api-service | ✅ Complete | 45s | 3 |
| job_456 | web-app | ✅ Complete | 32s | 2 |
| job_789 | cli-tool | ❌ Failed | 12s | 0 |

### Job Detail

View job details:

- **Pipeline stages** — Progress through each stage
- **Logs** — Detailed processing logs
- **Output** — Generated documentation
- **Errors** — Failure details if failed

## Settings

Configure DocSynth:

### General

- Organization name
- Default documentation settings
- Notification preferences

### Integrations

Connect external services:

| Integration | Status | Actions |
|-------------|--------|---------|
| GitHub | ✅ Connected | Configure |
| Jira | ✅ Connected | Configure |
| Slack | ⚪ Not connected | Connect |
| Linear | ⚪ Not connected | Connect |

### Team

Manage team members:

| Member | Role | Repositories |
|--------|------|--------------|
| alice@example.com | Owner | All |
| bob@example.com | Admin | All |
| carol@example.com | Member | 5 repos |

### Billing

Subscription and usage:

```
Plan: Team
Usage: 234 / 500 docs this month
Renewal: Feb 1, 2024
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `g d` | Go to Dashboard |
| `g r` | Go to Repositories |
| `g j` | Go to Jobs |
| `/` | Focus search |
| `?` | Show all shortcuts |

## Mobile View

The dashboard is responsive and works on mobile devices with a simplified navigation menu.

## Next Steps

- [VS Code Extension](/docs/guides/vscode-extension) — IDE integration
- [Integrations](/docs/guides/integrations) — Connect external tools
- [Configuration](/docs/guides/configuring-docsynth) — Detailed settings
