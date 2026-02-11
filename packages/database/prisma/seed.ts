import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...\n');

  // ── Organization ────────────────────────────────────────────────────────

  const org = await prisma.organization.upsert({
    where: { githubOrgId: 100000001 },
    update: {},
    create: {
      name: 'Acme Corp',
      githubOrgId: 100000001,
      subscriptionTier: 'FREE',
      settings: {
        defaultBranch: 'main',
        autoGenerate: true,
      },
    },
  });
  console.log(`  Organization: ${org.name} (${org.id})`);

  // ── Users ───────────────────────────────────────────────────────────────

  const owner = await prisma.user.upsert({
    where: { githubUserId: 200000001 },
    update: {},
    create: {
      githubUserId: 200000001,
      githubUsername: 'alice-dev',
      email: 'alice@acme.example',
      role: 'OWNER',
      organizationId: org.id,
    },
  });

  const member = await prisma.user.upsert({
    where: { githubUserId: 200000002 },
    update: {},
    create: {
      githubUserId: 200000002,
      githubUsername: 'bob-eng',
      email: 'bob@acme.example',
      role: 'MEMBER',
      organizationId: org.id,
    },
  });
  console.log(`  Users: ${owner.githubUsername} (owner), ${member.githubUsername} (member)`);

  // ── Memberships ─────────────────────────────────────────────────────────

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: owner.id, organizationId: org.id } },
    update: {},
    create: { userId: owner.id, organizationId: org.id, role: 'OWNER' },
  });

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: member.id, organizationId: org.id } },
    update: {},
    create: { userId: member.id, organizationId: org.id, role: 'MEMBER' },
  });

  // ── Repositories ────────────────────────────────────────────────────────

  const repo1 = await prisma.repository.upsert({
    where: { githubRepoId: 300000001 },
    update: {},
    create: {
      organizationId: org.id,
      githubRepoId: 300000001,
      githubFullName: 'acme-corp/api-gateway',
      name: 'api-gateway',
      fullName: 'acme-corp/api-gateway',
      defaultBranch: 'main',
      enabled: true,
      installationId: 400000001,
      config: {
        triggers: { onPRMerge: true, branches: ['main'] },
        docTypes: { readme: true, apiDocs: true, changelog: true },
        style: { tone: 'technical', includeExamples: true },
      },
    },
  });

  const repo2 = await prisma.repository.upsert({
    where: { githubRepoId: 300000002 },
    update: {},
    create: {
      organizationId: org.id,
      githubRepoId: 300000002,
      githubFullName: 'acme-corp/frontend-app',
      name: 'frontend-app',
      fullName: 'acme-corp/frontend-app',
      defaultBranch: 'main',
      enabled: true,
      installationId: 400000001,
      config: {
        triggers: { onPRMerge: true, branches: ['main'] },
        docTypes: { readme: true, changelog: true, guides: true },
        style: { tone: 'casual', includeExamples: true },
      },
    },
  });
  console.log(`  Repositories: ${repo1.name}, ${repo2.name}`);

  // ── Documents ───────────────────────────────────────────────────────────

  const readmeDoc = await prisma.document.upsert({
    where: { repositoryId_path: { repositoryId: repo1.id, path: 'README.md' } },
    update: {},
    create: {
      repositoryId: repo1.id,
      path: 'README.md',
      type: 'README',
      title: 'API Gateway',
      version: 2,
      content: `# API Gateway

A high-performance API gateway built with Node.js and Express.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| POST | /api/v1/users | Create user |
| GET | /api/v1/users/:id | Get user by ID |
| PUT | /api/v1/users/:id | Update user |
| DELETE | /api/v1/users/:id | Delete user |

## Architecture

The gateway uses a middleware pipeline for request processing:

1. **Authentication** - JWT token validation
2. **Rate Limiting** - Per-client rate limits
3. **Routing** - Path-based routing to upstream services
4. **Caching** - Response caching with Redis

## Configuration

Set environment variables in \`.env\`:

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| REDIS_URL | Redis connection | redis://localhost:6379 |
| JWT_SECRET | JWT signing key | (required) |
`,
    },
  });

  const apiDoc = await prisma.document.upsert({
    where: { repositoryId_path: { repositoryId: repo1.id, path: 'docs/api-reference.md' } },
    update: {},
    create: {
      repositoryId: repo1.id,
      path: 'docs/api-reference.md',
      type: 'API_REFERENCE',
      title: 'API Reference',
      version: 1,
      content: `# API Reference

## Authentication

All API requests require a Bearer token in the Authorization header.

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Users API

### POST /api/v1/users

Create a new user.

**Request Body:**
\`\`\`json
{
  "email": "user@example.com",
  "name": "Jane Doe",
  "role": "member"
}
\`\`\`

**Response (201):**
\`\`\`json
{
  "id": "usr_abc123",
  "email": "user@example.com",
  "name": "Jane Doe",
  "role": "member",
  "createdAt": "2026-01-15T10:30:00Z"
}
\`\`\`

### GET /api/v1/users/:id

Retrieve a user by ID.

**Response (200):**
\`\`\`json
{
  "id": "usr_abc123",
  "email": "user@example.com",
  "name": "Jane Doe",
  "role": "member",
  "createdAt": "2026-01-15T10:30:00Z"
}
\`\`\`
`,
    },
  });

  const changelogDoc = await prisma.document.upsert({
    where: { repositoryId_path: { repositoryId: repo1.id, path: 'CHANGELOG.md' } },
    update: {},
    create: {
      repositoryId: repo1.id,
      path: 'CHANGELOG.md',
      type: 'CHANGELOG',
      title: 'Changelog',
      version: 3,
      content: `# Changelog

## [0.3.0] - 2026-02-01

### Added
- Rate limiting middleware with per-client configuration
- Redis-backed response caching
- Health check endpoint with dependency status

### Changed
- Upgraded authentication to support JWT RS256 algorithm
- Improved error responses with request IDs

## [0.2.0] - 2026-01-15

### Added
- User CRUD endpoints
- JWT authentication middleware
- Request logging with correlation IDs

### Fixed
- Connection pool exhaustion under high load

## [0.1.0] - 2026-01-01

### Added
- Initial API gateway with Express
- Basic routing and middleware pipeline
- Docker Compose development setup
`,
    },
  });

  const guideDoc = await prisma.document.upsert({
    where: { repositoryId_path: { repositoryId: repo2.id, path: 'docs/getting-started.md' } },
    update: {},
    create: {
      repositoryId: repo2.id,
      path: 'docs/getting-started.md',
      type: 'GUIDE',
      title: 'Getting Started Guide',
      version: 1,
      content: `# Getting Started with Frontend App

## Prerequisites

- Node.js 20+
- npm or yarn

## Installation

\`\`\`bash
git clone https://github.com/acme-corp/frontend-app.git
cd frontend-app
npm install
npm run dev
\`\`\`

## Project Structure

\`\`\`
src/
├── components/    # Reusable UI components
├── pages/         # Route-based pages
├── hooks/         # Custom React hooks
├── utils/         # Helper functions
└── styles/        # Global styles and theme
\`\`\`

## Development

The app uses Next.js with hot module replacement. Edit any file in \`src/\` and see changes instantly.

### Running Tests

\`\`\`bash
npm test           # Run all tests
npm test -- --watch # Watch mode
\`\`\`
`,
    },
  });

  const frontendReadme = await prisma.document.upsert({
    where: { repositoryId_path: { repositoryId: repo2.id, path: 'README.md' } },
    update: {},
    create: {
      repositoryId: repo2.id,
      path: 'README.md',
      type: 'README',
      title: 'Frontend App',
      version: 1,
      content: `# Frontend App

A modern React application built with Next.js and TypeScript.

## Features

- Server-side rendering with Next.js
- Type-safe development with TypeScript
- Tailwind CSS for styling
- SWR for data fetching
- Comprehensive test suite with Vitest

## Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) to view the app.
`,
    },
  });

  console.log(
    `  Documents: ${[readmeDoc, apiDoc, changelogDoc, guideDoc, frontendReadme].length} created`
  );

  // ── Doc Versions ────────────────────────────────────────────────────────

  await prisma.docVersion.createMany({
    skipDuplicates: true,
    data: [
      {
        documentId: readmeDoc.id,
        content: readmeDoc.content,
        version: 2,
        prSha: 'abc1234',
      },
      {
        documentId: readmeDoc.id,
        content:
          '# API Gateway\n\nA Node.js API gateway.\n\n## Getting Started\n\n```bash\nnpm install\nnpm start\n```\n',
        version: 1,
        prSha: 'def5678',
      },
      {
        documentId: changelogDoc.id,
        content: changelogDoc.content,
        version: 3,
        prSha: 'abc1234',
      },
    ],
  });
  console.log(`  Doc Versions: 3 created`);

  // ── Subscription ────────────────────────────────────────────────────────

  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      tier: 'FREE',
      status: 'ACTIVE',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-12-31'),
    },
  });
  console.log(`  Subscription: FREE tier (active)`);

  console.log('\nSeed complete!\n');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
