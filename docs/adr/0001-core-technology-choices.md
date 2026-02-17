# ADR-0001: Core Technology Choices

**Date:** 2026-02-09  
**Status:** Accepted  
**Deciders:** DocSynth core team

## Context

DocSynth is an AI-powered documentation platform that processes GitHub webhooks, runs multi-stage LLM pipelines, and manages a large data model. We needed to choose technologies for the API server, background job processing, database access, and monorepo management that would support:

- High-throughput webhook processing with async job pipelines
- Type-safe development across 6 applications and 10 shared packages
- Rapid iteration with a small team
- Production-ready reliability (retries, observability, error handling)

## Decisions

### API Server: Hono

**Chosen over:** Express, Fastify, Koa

- **TypeScript-first** — Built in TypeScript with excellent type inference for routes, middleware, and handlers.
- **Web Standards** — Uses the Fetch API (`Request`/`Response`), making it portable across Node.js, Deno, Bun, and Cloudflare Workers.
- **Lightweight** — Minimal overhead compared to Express. No legacy baggage.
- **Middleware ecosystem** — Built-in OpenAPI generation, Zod validation, CORS, auth helpers.
- **Performance** — Consistently benchmarks faster than Express while offering a similar developer experience.

### Background Jobs: BullMQ + Redis

**Chosen over:** Agenda (MongoDB), pg-boss (PostgreSQL), custom queue

- **Battle-tested** — Used in production by thousands of companies. Well-documented with active maintenance.
- **Redis-backed** — Fast, reliable, and provides pub/sub for real-time job status updates.
- **Built-in features** — Retries with backoff, job priorities, rate limiting, delayed jobs, repeatable jobs, and job dependencies — all needed for our multi-stage pipeline.
- **TypeScript support** — First-class TypeScript types for job data and handlers.
- **Observability** — Job lifecycle events, completion/failure callbacks, and stalled job detection.

### Database Access: Prisma ORM

**Chosen over:** Drizzle, TypeORM, Kysely, raw SQL

- **Schema-as-code** — The Prisma schema (`schema.prisma`) is the single source of truth for the data model. Changes are tracked in version control.
- **Auto-generated client** — Type-safe query builder generated from the schema. No manual type definitions needed.
- **Migrations** — Built-in migration system for production schema changes.
- **Developer experience** — Prisma Studio for visual DB browsing, excellent error messages, and IntelliSense.
- **Trade-off acknowledged** — Prisma can be slower than raw SQL for complex queries. We accept this trade-off for development speed and type safety. Performance-critical queries can use `$queryRaw` if needed.

### Monorepo: npm Workspaces + Turborepo

**Chosen over:** pnpm workspaces, Yarn PnP, Nx, Lerna

- **npm workspaces** — Zero additional tooling. Works with the standard Node.js package manager. No lock file format changes.
- **Turborepo** — Adds build caching, parallel execution, and dependency-aware task orchestration on top of npm workspaces. Minimal config (`turbo.json`).
- **Simplicity** — Developers only need `npm` — no additional CLI tools to install.
- **Trade-off acknowledged** — npm hoists differently than pnpm, leading to larger `node_modules`. We accept this for ecosystem compatibility and simplicity.

### Test Framework: Vitest

**Chosen over:** Jest, Node.js built-in test runner

- **ESM-native** — Works with our `"type": "module"` setup without configuration hacks.
- **Vite-powered** — Fast test execution with native TypeScript support (no separate compilation step).
- **Jest-compatible API** — Familiar `describe`/`it`/`expect` API. Easy migration path.
- **Workspace support** — Built-in workspace configuration for monorepo testing.

## Consequences

### Positive

- Consistent TypeScript experience across the entire stack
- Fast development iteration with cached builds and hot reload
- Reliable async processing with BullMQ's retry and monitoring capabilities
- Type-safe database access without manual type definitions

### Negative

- Prisma's generated client adds to install/build time
- BullMQ requires Redis as an additional infrastructure dependency
- npm workspace hoisting can cause larger `node_modules` than pnpm
- Hono is newer than Express, so some middleware may not exist yet

### Risks

- Prisma major version upgrades may require schema migration adjustments
- BullMQ is Redis-specific — switching queue backends would be a significant refactor
