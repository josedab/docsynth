.DEFAULT_GOAL := help

.PHONY: help setup dev dev-api dev-web dev-worker test test-unit test-watch lint typecheck format build \
        db-generate db-push db-seed db-studio \
        docker-up docker-down docker-full doctor verify clean docs

help: ## Show available commands
	@echo ""
	@echo "DocSynth Development Commands"
	@echo "============================="
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ── Setup & Run ──────────────────────────────────────────────────────────────

setup: ## One-command setup (deps, Docker, DB, seed data)
	bash scripts/setup.sh

dev: ## Start all services in dev mode
	npm run dev

dev-api: ## Start only the API server in dev mode
	npm run dev:api

dev-web: ## Start only the web dashboard in dev mode
	npm run dev:web

dev-worker: ## Start only the worker in dev mode
	npm run dev:worker

quickstart: ## Validate environment, then start dev
	bash scripts/quickstart.sh

# ── Testing ──────────────────────────────────────────────────────────────────

test: ## Run all tests (requires Docker services)
	npm run test

test-unit: ## Run unit tests only (no Docker needed)
	npm run test:unit

test-watch: ## Run tests in watch mode
	npm run test:watch

test-integration: ## Run integration tests with self-contained Docker
	bash scripts/test-integration.sh

# ── Code Quality ─────────────────────────────────────────────────────────────

lint: ## Run ESLint
	npm run lint

typecheck: ## Type-check all packages
	npm run typecheck

format: ## Auto-format all files with Prettier
	npm run format

# ── Build ────────────────────────────────────────────────────────────────────

build: ## Build all packages and apps
	npm run build

clean: ## Remove build artifacts and node_modules
	npm run clean

# ── Database ─────────────────────────────────────────────────────────────────

db-generate: ## Generate Prisma client
	npm run db:generate

db-push: ## Apply database schema changes
	npm run db:push

db-seed: ## Seed sample data
	npm run db:seed

db-studio: ## Open Prisma Studio (DB browser)
	cd packages/database && npx prisma studio

# ── Docker ───────────────────────────────────────────────────────────────────

docker-up: ## Start PostgreSQL and Redis containers
	docker compose up -d postgres redis

docker-down: ## Stop all Docker containers
	docker compose down

docker-full: ## Start full-stack Docker dev environment (no Node.js needed)
	docker compose -f docker-compose.dev.yml up

# ── Docs & Diagnostics ──────────────────────────────────────────────────────

docs: ## Start documentation site locally
	npm run docs

doctor: ## Check environment health
	npm run doctor

verify: ## Smoke-test the running development environment
	npm run verify
