# Contributing to DocSynth

Thank you for your interest in contributing to DocSynth! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL and Redis)
- Git

### Quick Start

```bash
git clone https://github.com/docsynth/docsynth.git
cd docsynth
npm run quickstart
```

This checks prerequisites, installs dependencies, starts Docker services, sets up the database, and launches dev servers. See the [README](README.md#quick-start) for alternative setup methods.

### Verify your setup

```bash
npm run doctor    # Check that everything is configured correctly
npm run test:unit # Run unit tests (no Docker required)
npm run test      # Run all tests (requires Docker services)
```

## Project Structure

DocSynth is a monorepo managed with npm workspaces and Turborepo. For in-depth architecture details (data flow, worker pipeline, design decisions), see [ARCHITECTURE.md](ARCHITECTURE.md).

```
docsynth/
├── apps/                    # Runnable applications
│   ├── api/                 # REST API (Hono, port 3001)
│   ├── web/                 # Dashboard (Next.js, port 3000)
│   ├── worker/              # Background jobs (BullMQ)
│   ├── cli/                 # CLI tool (Commander.js)
│   ├── mcp-server/          # MCP server for AI agents
│   └── vscode-extension/    # VS Code extension
├── packages/                # Shared libraries
│   ├── types/               # TypeScript domain types (no runtime deps)
│   ├── config/              # Env config, feature flags, tier limits
│   ├── database/            # Prisma ORM, schema, migrations
│   ├── github/              # GitHub App/OAuth (Octokit)
│   ├── queue/               # BullMQ job queue + Redis
│   └── utils/               # Logging, errors, LLM clients
├── examples/                # Runnable example code
├── website/                 # Docusaurus documentation site
└── deploy/                  # Docker and Helm deployment configs
```

### Dependency Graph

```
apps/api ──────┐
apps/worker ───┤
apps/cli ──────┼── packages/config
apps/web ──────┤   packages/database
               │   packages/github
               │   packages/queue
               │   packages/types
               └── packages/utils
```

All apps depend on shared packages. Changes to `packages/types` or `packages/config` may affect every app. Changes within an app (e.g., `apps/api`) are isolated to that app.

## Common Development Tasks

### Adding a new API route

1. Create a route file in `apps/api/src/routes/`
2. Register it in `apps/api/src/routes/index.ts`
3. Add corresponding service logic in `apps/api/src/services/`
4. Add tests in `apps/api/src/__tests__/`

### Adding a new worker

1. Create a worker file in `apps/worker/src/workers/`
2. Import and start it in `apps/worker/src/index.ts`
3. Add the queue name to `packages/queue/src/index.ts` if needed

### Modifying the database schema

1. Edit `packages/database/prisma/schema.prisma`
2. Run `npm run db:push` to apply changes (development)
3. Run `npm run db:generate` to regenerate the Prisma client
4. For production, create a migration: `npm run db:migrate` in `packages/database`

### Adding a shared type

1. Add the type to `packages/types/src/index.ts`
2. Run `npm run build` in `packages/types` (or let Turbo handle it)
3. Import from `@docsynth/types` in any app or package

## Code Style

- **Formatter**: Prettier (100 char width, 2 spaces, single quotes, semicolons)
- **Linter**: ESLint with TypeScript support
- **Module system**: ESM (`"type": "module"`)
- **TypeScript**: Strict mode, ES2022 target

Run before committing:

```bash
npm run format     # Auto-format all files
npm run lint       # Check for lint errors
npm run typecheck  # Verify types
```

## Testing

### Test structure

Tests live in `src/__tests__/` within each package/app. The naming convention is `*.test.ts`.

### Running tests

```bash
npm run test:unit     # Unit tests only (no Docker needed, fast)
npm run test          # All tests (requires PostgreSQL + Redis via Docker)
npm run test:watch    # Watch mode for development
npm run test:integration  # Self-contained integration tests (starts its own Docker services on ports 5433/6380)
```

### Test categories

- **Unit tests** (`npm run test:unit`): No external dependencies. Tests pure logic, transformations, and utilities. Safe to run anywhere.
- **Integration tests** (`npm run test`): Requires PostgreSQL and Redis. Tests database queries, queue operations, and API routes with real services.
- **Self-contained integration tests** (`npm run test:integration`): Starts its own PostgreSQL (port 5433) and Redis (port 6380) via `docker-compose.test.yml`, runs all tests, then tears down. Won't conflict with your development database.

### Test coverage

Coverage is collected in CI using `@vitest/coverage-v8`. To generate coverage locally:

```bash
npx vitest run --coverage    # Run from any package or the root
```

Coverage reports are uploaded as CI artifacts on each run.

### Writing tests

- Use Vitest as the test framework
- Place unit tests (no external deps) in `src/__tests__/`
- Tests that need database or Redis should document this in a comment at the top

## Debugging

### Inspecting the database

```bash
make db-studio              # Opens Prisma Studio (visual DB browser) at http://localhost:5555
# Or directly:
cd packages/database && npx prisma studio
```

### Viewing logs

DocSynth uses [pino](https://github.com/pinojs/pino) for structured JSON logging. For human-readable output during development:

```bash
npm run dev:api | npx pino-pretty    # Pretty-print API logs
```

### Checking queue/worker status

Workers process jobs via BullMQ backed by Redis. To inspect:

```bash
# Check Redis connection
docker compose exec redis redis-cli ping

# View queue lengths
docker compose exec redis redis-cli keys "bull:*" | head -20

# Monitor Redis commands in real-time
docker compose exec redis redis-cli monitor
```

### Common debugging steps

1. **API returns 500**: Check API logs for the error ID, then search logs for that ID.
2. **Worker not processing jobs**: Verify Redis is running (`docker compose ps redis`), then check worker logs.
3. **Database errors**: Run `npm run doctor` to check connectivity, then `make db-studio` to inspect data.
4. **Type errors after schema changes**: Run `npm run db:generate` to regenerate the Prisma client.

## Pull Request Process

1. **Branch**: Create a feature branch from `main` (e.g., `feat/my-feature` or `fix/my-bug`)
2. **Code**: Make your changes, following the code style above
3. **Test**: Run `npm run test:unit` at minimum, `npm run test` if your changes touch database/queue logic
4. **Verify**: Run `npm run typecheck && npm run lint` to catch issues early
5. **Commit**: Write clear, descriptive commit messages
6. **PR**: Open a pull request against `main` with a description of what changed and why

### Commit messages

Use conventional-style messages:

```
feat(api): add endpoint for document search
fix(worker): handle missing PR body in change analysis
docs: update getting started guide
chore(deps): update Prisma to 5.10.0
```

## Versioning & Releases

This project follows [Semantic Versioning](https://semver.org/). Notable changes are documented in [CHANGELOG.md](CHANGELOG.md) using the [Keep a Changelog](https://keepachangelog.com/) format.

When contributing:

1. Add a summary of your change under the `[Unreleased]` section of `CHANGELOG.md`
2. Use the appropriate category: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or `Security`
3. Maintainers will assign version numbers and create releases

## Getting Help

- Check the [troubleshooting section](README.md#troubleshooting) in the README
- Run `npm run doctor` to diagnose environment issues
- Open an issue on GitHub for bugs or feature requests
