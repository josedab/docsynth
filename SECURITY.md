# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in DocSynth, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

Email **security@docsynth.dev** with:

1. A description of the vulnerability
2. Steps to reproduce the issue
3. The potential impact
4. Any suggested fix (optional)

### What to Expect

- **Acknowledgment** within 48 hours of your report
- **Status update** within 5 business days with an assessment
- **Resolution timeline** communicated once the issue is confirmed

### Scope

The following are in scope:

- The DocSynth API server (`apps/api`)
- Authentication and authorization flows
- Webhook signature validation
- Secret handling (environment variables, API keys, tokens)
- Database access and injection vulnerabilities
- Dependency vulnerabilities in production packages

### Out of Scope

- Issues in demo mode with sample data
- Denial of service attacks against local development environments
- Social engineering attacks

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Security Best Practices for Contributors

- Never commit secrets, API keys, or credentials to the repository
- Use `openssl rand -hex 32` to generate secrets (never use placeholder values)
- Validate all user input using Zod schemas
- Use parameterized queries (Prisma handles this automatically)
- Verify webhook signatures before processing payloads
