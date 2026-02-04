---
sidebar_position: 1
title: Contributing
description: How to contribute to DocSynth
---

# Contributing to DocSynth

Thank you for your interest in contributing to DocSynth! This guide will help you get started.

## Ways to Contribute

- **Report bugs** — Open an issue with reproduction steps
- **Suggest features** — Start a GitHub Discussion
- **Fix bugs** — Submit a pull request
- **Improve docs** — Documentation improvements are always welcome
- **Share feedback** — Tell us how you use DocSynth

## Development Setup

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Git
- A GitHub account

### Getting Started

```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/docsynth.git
cd docsynth

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Start infrastructure (PostgreSQL, Redis)
docker-compose up -d

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:push

# Start development servers
npm run dev
```

### Project Structure

```
docsynth/
├── apps/
│   ├── api/              # REST API (Hono)
│   ├── worker/           # Background jobs (BullMQ)
│   ├── web/              # Dashboard (Next.js)
│   ├── cli/              # CLI tool
│   └── vscode-extension/ # VS Code extension
├── packages/
│   ├── types/            # Shared TypeScript types
│   ├── config/           # Configuration
│   ├── database/         # Prisma ORM
│   ├── github/           # GitHub client
│   ├── queue/            # Job queue
│   └── utils/            # Utilities
└── website/              # Documentation (Docusaurus)
```

### Running Tests

```bash
# Run all tests
npm run test

# Run tests for a specific package
npm run test --filter=@docsynth/api

# Run tests in watch mode
npm run test -- --watch

# Run with coverage
npm run test -- --coverage
```

### Code Quality

```bash
# Lint all packages
npm run lint

# Fix linting issues
npm run lint -- --fix

# Type check
npm run typecheck

# Format code
npm run format
```

## Pull Request Process

### 1. Create a Branch

```bash
# For features
git checkout -b feature/your-feature-name

# For bug fixes
git checkout -b fix/issue-description

# For docs
git checkout -b docs/what-you-changed
```

### 2. Make Your Changes

- Follow existing code patterns
- Add tests for new functionality
- Update documentation if needed
- Keep commits focused and atomic

### 3. Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add drift detection for Python files
fix: resolve webhook signature validation
docs: update API reference for v2 endpoints
chore: upgrade TypeScript to 5.4
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation only
- `style` — Code style (formatting, semicolons)
- `refactor` — Code change that neither fixes a bug nor adds a feature
- `perf` — Performance improvement
- `test` — Adding or fixing tests
- `chore` — Build process or auxiliary tool changes

### 4. Submit Your PR

1. Push your branch to your fork
2. Open a pull request against `main`
3. Fill out the PR template
4. Wait for CI checks to pass
5. Request a review

### PR Requirements

- [ ] Tests pass (`npm run test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Types check (`npm run typecheck`)
- [ ] Documentation updated (if applicable)
- [ ] Changeset added (if applicable)

## Code Style

### TypeScript

- Use strict TypeScript (`strict: true`)
- Prefer `interface` over `type` for object shapes
- Use descriptive variable names
- Export types from `@docsynth/types`

```typescript
// Good
interface DocumentGenerationOptions {
  repositoryId: string;
  branch: string;
  dryRun?: boolean;
}

// Avoid
type Opts = { repoId: string; b: string; dr?: boolean };
```

### Error Handling

Use the shared error utilities:

```typescript
import { AppError, ErrorCode } from '@docsynth/utils';

throw new AppError(
  ErrorCode.NOT_FOUND,
  'Repository not found',
  { repositoryId }
);
```

### Logging

Use the structured logger:

```typescript
import { logger } from '@docsynth/utils';

logger.info('Processing webhook', {
  event: 'pull_request.merged',
  repositoryId,
});
```

## Testing Guidelines

### Unit Tests

Place unit tests next to the source files:

```
src/
  services/
    generation.ts
    generation.test.ts
```

### Integration Tests

Place integration tests in `__tests__` directories:

```
src/
  __tests__/
    api.integration.test.ts
```

### Test Utilities

Use the shared test utilities:

```typescript
import { createTestContext, mockRepository } from '@docsynth/test-utils';

describe('DocumentService', () => {
  const ctx = createTestContext();
  
  beforeEach(async () => {
    await ctx.setup();
  });
  
  afterEach(async () => {
    await ctx.teardown();
  });
});
```

## Documentation

### Website (Docusaurus)

```bash
cd website
npm run start    # Start dev server
npm run build    # Build for production
```

### API Documentation

API endpoints are documented with OpenAPI. Update the spec when adding/changing endpoints:

```
apps/api/src/openapi.ts
```

## Getting Help

- **Questions?** Start a [GitHub Discussion](https://github.com/docsynth/docsynth/discussions)
- **Found a bug?** [Open an issue](https://github.com/docsynth/docsynth/issues/new)
- **Chat?** Join our [Discord](https://discord.gg/docsynth)

## Recognition

Contributors are recognized in:
- The GitHub contributors page
- Release notes for significant contributions
- The project README

Thank you for contributing to DocSynth! 🎉
