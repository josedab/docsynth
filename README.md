# DocSynth

> AI-powered documentation that stays current with your code

DocSynth automatically generates and maintains documentation by observing code changes, understanding context from PRs and tickets, and producing human-quality technical writing.

## Features

- 🤖 **AI-Powered Generation** - Uses advanced LLMs to generate documentation from code changes
- 🔄 **Always Current** - Documentation updates automatically when code changes
- 🔗 **Multi-Source Context** - Gathers context from PRs, Jira, Slack to understand "why"
- ✍️ **Human Quality** - Produces documentation that reads naturally
- 🎨 **Style Learning** - Matches your team's existing documentation style

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for local development)
- GitHub account

### Installation

```bash
# Clone the repository
git clone https://github.com/docsynth/docsynth.git
cd docsynth

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Start development services
docker-compose up -d

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:push

# Start development servers
npm run dev
```

### Using the CLI

```bash
# Initialize DocSynth in a repository
docsynth init

# Generate documentation locally
docsynth generate

# Check status
docsynth status

# Login to DocSynth cloud
docsynth login
```

## Architecture

DocSynth is built as a monorepo with the following structure:

```
docsynth/
├── apps/
│   ├── api/          # REST API server (Hono)
│   ├── worker/       # Background job processor
│   ├── web/          # Dashboard (Next.js)
│   └── cli/          # CLI tool (Commander.js)
├── packages/
│   ├── types/        # Shared TypeScript types
│   ├── config/       # Configuration utilities
│   ├── database/     # Prisma client & schema
│   ├── github/       # GitHub API client
│   ├── queue/        # Job queue (BullMQ)
│   └── utils/        # Shared utilities
└── docker-compose.yml
```

### Processing Pipeline

```
PR Merged → Webhook → Change Analysis → Intent Inference → Doc Generation → PR Created
```

1. **Change Analysis**: Parses diffs, identifies semantic changes
2. **Intent Inference**: Gathers context from PRs, Jira, Slack
3. **Doc Generation**: Uses LLMs to generate documentation
4. **Review**: Creates a PR with generated docs for review

## Configuration

Create a `.docsynth.json` in your repository:

```json
{
  "version": 1,
  "triggers": {
    "onPRMerge": true,
    "branches": ["main"]
  },
  "filters": {
    "includePaths": ["src/**/*"],
    "excludePaths": ["**/*.test.*"]
  },
  "docTypes": {
    "readme": true,
    "apiDocs": true,
    "changelog": true
  },
  "style": {
    "tone": "technical",
    "includeExamples": true
  }
}
```

## Development

```bash
# Run all apps in development mode
npm run dev

# Run tests
npm run test

# Lint code
npm run lint

# Type check
npm run typecheck

# Build all packages
npm run build
```

### Environment Variables

See `.env.example` for all required environment variables.

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `GITHUB_APP_ID` - GitHub App ID
- `GITHUB_APP_PRIVATE_KEY` - GitHub App private key
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` - LLM API keys

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a PR.
