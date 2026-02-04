---
sidebar_position: 4
title: Security
description: Security practices and compliance information.
---

# Security

DocSynth is built with security as a priority.

## Data Handling

### What Data is Collected

| Data Type | Collected | Stored | Purpose |
|-----------|-----------|--------|---------|
| Repository metadata | ✅ | ✅ | Configuration and display |
| Code (for analysis) | ✅ | ❌ | Documentation generation |
| PR context | ✅ | ❌ | Context gathering |
| Generated docs | ✅ | ✅ | History and serving |
| User information | ✅ | ✅ | Authentication |

### Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   GitHub    │────>│  DocSynth   │────>│   LLM API   │
│  (your code)│     │  (process)  │     │ (generate)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Database   │
                    │  (metadata) │
                    └─────────────┘
```

### Data Retention

| Data | Retention |
|------|-----------|
| Job history | 90 days |
| Generated documents | Until deleted |
| Webhook logs | 30 days |
| Audit logs | 1 year |

## Infrastructure Security

### Encryption

- **In Transit:** TLS 1.3 for all connections
- **At Rest:** AES-256 encryption for database and storage

### Network Security

- VPC isolation
- Private subnets for databases
- WAF protection
- DDoS mitigation

### Access Control

- Role-based access control (RBAC)
- Principle of least privilege
- Regular access reviews

## Authentication

### GitHub OAuth

DocSynth uses GitHub OAuth for authentication:

1. No passwords stored
2. Tokens encrypted at rest
3. Tokens can be revoked via GitHub

### API Authentication

- JWT tokens with short expiry
- Refresh tokens for extended sessions
- Rate limiting per token

### Webhook Verification

All webhooks verified via HMAC-SHA256:

```typescript
const isValid = crypto.timingSafeEqual(
  Buffer.from(signature),
  Buffer.from(expectedSignature)
);
```

## GitHub App Permissions

DocSynth requests minimal permissions:

| Permission | Level | Purpose |
|------------|-------|---------|
| Contents | Read & Write | Read code, create docs |
| Pull requests | Read & Write | Read context, create PRs |
| Issues | Read | Linked issue context |
| Metadata | Read | Repository information |

### Why Write Access?

Write access is needed to:
- Create documentation files
- Open pull requests with generated docs

DocSynth only writes to documentation paths.

## Third-Party Services

### LLM Providers

DocSynth uses LLM APIs for generation:

| Provider | Data Sent | Data Retention |
|----------|-----------|----------------|
| Anthropic | Code context, prompts | Not retained for training |
| OpenAI | Code context, prompts | Not retained for training |

Both providers have enterprise agreements for data protection.

### Self-Hosted Option

For maximum control:
- Self-host DocSynth
- Use a self-hosted LLM (e.g., Ollama)
- Keep all data on your infrastructure

## Compliance

### SOC 2 Type II

DocSynth Cloud is SOC 2 Type II compliant:

- Security controls audited annually
- Report available under NDA

### GDPR

DocSynth is GDPR compliant:

- Data processing agreements available
- Right to deletion supported
- Data export available

### HIPAA

For healthcare customers:
- BAA available on Enterprise plan
- Additional security controls

## Vulnerability Management

### Security Scanning

- Daily dependency vulnerability scans
- Weekly penetration testing
- Continuous security monitoring

### Reporting Vulnerabilities

Report security issues to: security@docsynth.dev

We follow responsible disclosure:
1. Acknowledge within 24 hours
2. Assess severity
3. Fix critical issues within 72 hours
4. Credit researchers (if desired)

### Bug Bounty

We run a bug bounty program. See [docsynth.dev/security](https://docsynth.dev/security) for details.

## Best Practices

### For Users

1. **Use SSO** when available
2. **Review permissions** before installing
3. **Rotate API keys** regularly
4. **Monitor audit logs** for unusual activity

### For Self-Hosted

1. **Use secrets management** (Vault, AWS Secrets Manager)
2. **Enable audit logging**
3. **Keep dependencies updated**
4. **Use private networks** for databases
5. **Enable TLS** for all services

## Security Configuration

### Environment Variables

Never commit secrets. Use environment variables:

```bash
# Good
GITHUB_APP_PRIVATE_KEY=$SECRET_FROM_VAULT

# Bad - never do this
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA..."
```

### Network Policies

Restrict network access:

```yaml
# Kubernetes example
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: docsynth-api
spec:
  podSelector:
    matchLabels:
      app: docsynth-api
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: ingress
      ports:
        - port: 3001
```

## Contact

- Security issues: security@docsynth.dev
- Compliance questions: compliance@docsynth.dev
- Security documentation: [docsynth.dev/security](https://docsynth.dev/security)
