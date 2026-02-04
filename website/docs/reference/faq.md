---
sidebar_position: 2
title: FAQ
description: Frequently asked questions about DocSynth.
---

# Frequently Asked Questions

## General

### What is DocSynth?

DocSynth is an AI-powered documentation tool that automatically generates and maintains documentation by observing code changes, understanding context from PRs and tickets, and producing human-quality technical writing.

### How does it work?

When you merge a PR, DocSynth:
1. Receives a webhook notification
2. Analyzes the code changes
3. Gathers context from the PR, linked issues, and team discussions
4. Generates documentation using AI
5. Creates a PR with the updated docs

### What programming languages does it support?

DocSynth works with any programming language. It analyzes code structure and changes to generate appropriate documentation. Full support for:
- TypeScript/JavaScript
- Python
- Go
- Java
- C#

Good support for:
- Rust
- Ruby
- PHP
- Kotlin
- Swift

Basic support (structure analysis only):
- C/C++
- Other languages

### Is my code sent to external servers?

Code is processed by DocSynth servers and sent to LLM providers (Anthropic/OpenAI) for generation. For maximum privacy:
- Self-host DocSynth with a private LLM
- Use the Enterprise plan with dedicated infrastructure

See our [Security documentation](/docs/reference/security) for details.

## Pricing & Limits

### Is there a free tier?

Yes! The free tier includes:
- 3 repositories
- 100 documents/month
- 2 translation languages
- Community support
- Basic drift detection

### How is usage calculated?

Usage is based on documents generated, not API calls or tokens. One document = one markdown file created or updated.

### What happens when I hit my limit?

When you reach your document limit:
- New generation requests are queued (not lost)
- You'll receive an email notification
- Upgrade or wait for the next billing cycle
- Enterprise plans have no hard limits

### Can I try it before paying?

Yes, start with the free tier. No credit card required. Upgrade when you need more capacity.

### Do you offer discounts for open source?

Yes! Open source projects with 100+ stars qualify for a free Pro plan. Contact us at opensource@docsynth.dev.

## Setup & Configuration

### How long does setup take?

About 5 minutes:
1. Install CLI (30 seconds)
2. Login (1 minute)
3. Initialize repo (1 minute)
4. Install GitHub App (2 minutes)

### Do I need to modify my code?

No. DocSynth works by observing your existing workflow. The only addition is a `.docsynth.json` configuration file in your repository root.

### Does it work with monorepos?

Yes! Configure per-package settings:

```json
{
  "monorepo": {
    "enabled": true,
    "packages": {
      "packages/core": { "docTypes": { "apiDocs": true } },
      "packages/cli": { "docTypes": { "readme": true } }
    }
  }
}
```

### What Git providers are supported?

- **GitHub** — Full support (Cloud and Enterprise Server)
- **GitLab** — Coming Q2 2026
- **Bitbucket** — Coming Q3 2026
- **Azure DevOps** — Coming Q4 2026

### Can I use DocSynth with GitLab/Bitbucket?

Not yet, but GitLab support is in development. Join our waitlist at docsynth.dev/waitlist.

## Usage & Features

### Can I edit generated documentation?

Absolutely! Generated docs are regular markdown files. Edit them as you would any documentation. DocSynth intelligently preserves your manual changes when updating—it won't overwrite custom sections.

### What if I don't like the generated docs?

Several options:
1. Request changes on the PR (like any code review)
2. Adjust style settings in `.docsynth.json`
3. Provide example docs for style learning
4. Add explicit guidelines in the config
5. Regenerate with `docsynth generate --feedback "more examples please"`

### How do I prevent generation for certain files?

Use `excludePaths` in your configuration:

```json
{
  "filters": {
    "excludePaths": [
      "**/internal/**",
      "**/deprecated/**",
      "**/*.test.ts"
    ]
  }
}
```

### Can I trigger generation manually?

Yes, multiple ways:

```bash
# CLI
docsynth generate

# Generate specific document
docsynth generate docs/api/users.md

# Dry run (preview without creating PR)
docsynth generate --dry-run
```

Or via API:
```bash
POST /api/v1/repositories/:id/generate
```

### Does DocSynth support diagrams?

Yes! DocSynth auto-generates:
- Architecture diagrams
- Sequence diagrams
- Class diagrams
- Entity relationship diagrams
- Dependency graphs

All in Mermaid format. See [Diagram Generation](/docs/advanced/diagram-generation).

### How does drift detection work?

DocSynth monitors for documentation drift by:
1. Tracking when docs were last updated
2. Comparing to related code changes
3. Using AI to detect semantic drift
4. Scoring freshness (0-100)

When drift is detected, you receive alerts via dashboard, Slack, or email. See [Drift Detection](/docs/advanced/drift-detection).

## Quality & Accuracy

### How accurate is the documentation?

DocSynth achieves 4.6/5 accuracy in human evaluations by:
- Analyzing actual code, not just comments
- Gathering context from multiple sources
- Running AI review before creating PRs
- Learning from your corrections

Always review generated PRs before merging—DocSynth is a tool to assist, not replace, human judgment.

### Does it understand business logic?

DocSynth understands business logic when you provide context through:
- Descriptive PR titles and descriptions
- Linked Jira/Linear tickets
- Slack discussions
- Existing documentation

The more context you provide, the better the documentation quality.

### Can it generate API documentation?

Yes! DocSynth generates comprehensive API docs from:
- Function signatures and types
- JSDoc/TSDoc comments
- OpenAPI/Swagger specs
- Request/response examples in tests
- Actual usage patterns in codebase

### Will it maintain my existing documentation style?

Yes. DocSynth's style learning feature analyzes your existing documentation to learn:
- Tone (technical, friendly, formal)
- Structure patterns
- Terminology preferences
- Example formats
- Heading conventions

Generated docs match your team's voice.

## Integration

### Does it work with my documentation platform?

DocSynth generates markdown, which works with:
- **Docusaurus** — Full support
- **GitBook** — Full support
- **MkDocs** — Full support
- **VuePress/VitePress** — Full support
- **Nextra** — Full support
- **Mintlify** — Full support
- **ReadMe** — Via export
- **Plain markdown on GitHub** — Full support

### Can I connect it to Notion?

- **Reading from Notion** — Yes, for gathering context
- **Writing to Notion** — Coming Q2 2026

Join the waitlist for Notion publishing at docsynth.dev/notion-waitlist.

### Does it support Confluence?

- **Reading from Confluence** — Yes, for context
- **Writing to Confluence** — Yes, Enterprise plan only

### Does it support private repositories?

Yes, the GitHub App requests only the necessary permissions. Your code stays private and is never stored permanently.

### Can I use it with GitHub Enterprise Server?

Yes, both cloud and self-hosted GitHub Enterprise Server are supported. Self-hosted requires the Enterprise plan.

## Translation & Internationalization

### How does translation work?

DocSynth uses AI-powered translation that:
- Understands technical context
- Preserves code blocks in original language
- Uses a customizable glossary
- Maintains formatting
- Achieves 4.3/5 human evaluation quality

See [Multi-Language Support](/docs/advanced/multi-language).

### What languages can it translate to?

Fully supported (16 languages):
English, Spanish, French, German, Japanese, Chinese (Simplified & Traditional), Korean, Portuguese, Italian, Russian, Dutch, Polish, Arabic, Hindi

Experimental (10+ additional languages).

### How much does translation cost?

Translation is metered by word count:
- **Free**: 10,000 words/month
- **Pro**: 100,000 words/month
- **Team**: 500,000 words/month
- **Enterprise**: Unlimited

## Security & Privacy

### Is my data secure?

Yes:
- All data encrypted in transit (TLS 1.3)
- Data encrypted at rest (AES-256)
- SOC 2 Type II compliant (Enterprise)
- GDPR compliant
- No data shared with third parties
- Regular security audits

### Can I self-host?

Yes! Self-hosting is available for all plans. See [Self-Hosting Guide](/docs/guides/self-hosting).

Benefits of self-hosting:
- Full data control
- Use your own LLM
- Air-gapped deployment option
- Custom security policies

### What data is stored?

**Stored:**
- Repository metadata (name, settings)
- Generated documentation
- Job history and logs
- User account information

**Processed but NOT stored:**
- Source code (analyzed in memory)
- PR content
- Chat messages

### Can I delete my data?

Yes. From the dashboard: Settings → Data → Delete All Data. This permanently removes all your data within 30 days (immediately on request for Enterprise).

## Troubleshooting

### Why isn't documentation being generated?

Common causes:
1. Branch not in `triggers.branches`
2. Changes don't match `includePaths`
3. Files in `excludePaths`
4. GitHub App not installed or missing permissions
5. Repository over document limit

Run `docsynth status` to diagnose.

### Why is the quality poor?

Improve quality by:
1. Writing better PR descriptions with context
2. Linking issues/tickets for business context
3. Providing style examples in existing docs
4. Adjusting tone and verbosity settings
5. Adding explicit guidelines in config

### Generation is slow. How can I speed it up?

1. Use specific `includePaths` (don't process entire repo)
2. Reduce `maxDepth` for knowledge graphs
3. Disable unused features (diagrams, translations)
4. Use a faster LLM model for non-critical docs

See [Performance & Benchmarks](/docs/reference/benchmarks).

### I'm getting rate limited. What do I do?

If you're hitting rate limits:
1. Check your current usage: `docsynth usage`
2. Upgrade your plan for higher limits
3. Batch small changes into fewer PRs
4. Use `excludePaths` to reduce processing

## Enterprise

### What's included in Enterprise?

- Unlimited repositories
- Unlimited documents
- Unlimited translations
- Priority support (4-hour SLA)
- Custom LLM integration
- SSO/SAML
- Audit logs
- Dedicated infrastructure option
- Custom contracts

### Do you offer on-premise deployment?

Yes, Enterprise includes:
- Self-hosted deployment support
- Air-gapped installation option
- Custom infrastructure configuration
- Dedicated support engineer

### Can I get a demo?

Yes! Schedule a demo at [docsynth.dev/demo](https://docsynth.dev/demo).

## More Questions?

- [GitHub Discussions](https://github.com/docsynth/docsynth/discussions) — Community Q&A
- [Discord](https://discord.gg/docsynth) — Real-time chat
- [Twitter/X](https://twitter.com/docsynthdev) — Updates and tips
- Email: support@docsynth.dev — Direct support
