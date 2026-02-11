#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# DocSynth Development Environment Setup
# Usage: ./scripts/setup.sh
# =============================================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info()  { echo -e "${BOLD}$1${NC}"; }
ok()    { echo -e "${GREEN}  $1${NC}"; }
warn()  { echo -e "${YELLOW}  $1${NC}"; }
fail()  { echo -e "${RED}  $1${NC}"; exit 1; }

echo ""
info "DocSynth Development Setup"
info "=========================="
echo ""

# ── Check prerequisites ──────────────────────────────────────────────────────

info "Checking prerequisites..."

command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node.js 20+ from https://nodejs.org"
NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js 20+ required (found $(node -v)). Update at https://nodejs.org"
fi
ok "Node.js $(node -v)"

command -v npm >/dev/null 2>&1 || fail "npm is not installed"
ok "npm $(npm -v)"

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install Docker from https://docs.docker.com/get-docker/"
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# Check Docker daemon early — before slow npm install
docker info >/dev/null 2>&1 || fail "Docker daemon is not running. Start Docker Desktop or the Docker service, then re-run this script."
ok "Docker daemon is running"

echo ""

# ── Install dependencies (runs only after all prerequisites pass) ─────────────

info "Installing dependencies..."
npm install
ok "Dependencies installed"
echo ""

# ── Environment file ─────────────────────────────────────────────────────────

info "Setting up environment..."

if [ ! -f .env ]; then
  cp .env.example .env

  # Generate secrets automatically
  SESSION_SECRET=$(openssl rand -hex 32)
  JWT_SECRET=$(openssl rand -hex 32)

  # Use portable sed (works on both macOS and Linux)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|SESSION_SECRET=.*|SESSION_SECRET=${SESSION_SECRET}|" .env
    sed -i '' "s|JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
  else
    sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=${SESSION_SECRET}|" .env
    sed -i "s|JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
  fi

  # Ensure DEMO_MODE is enabled so the app starts without GitHub App setup
  # (already true in .env.example, but verify)
  if ! grep -q "^DEMO_MODE=true" .env 2>/dev/null; then
    echo "DEMO_MODE=true" >> .env
  fi
  if ! grep -q "^NEXT_PUBLIC_DEMO_MODE=true" .env 2>/dev/null; then
    echo "NEXT_PUBLIC_DEMO_MODE=true" >> .env
  fi

  ok "Created .env with auto-generated secrets (DEMO_MODE enabled)"
else
  ok ".env already exists, skipping"
fi

echo ""

# ── Start infrastructure ─────────────────────────────────────────────────────

info "Starting infrastructure services..."
docker compose up -d postgres redis
ok "PostgreSQL and Redis containers started"

# Wait for PostgreSQL to be healthy
echo -n "  Waiting for PostgreSQL"
RETRIES=30
until docker compose exec -T postgres pg_isready -q -U docsynth 2>/dev/null; do
  echo -n "."
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo ""
    fail "PostgreSQL failed to start. Run 'docker compose logs postgres' to debug."
  fi
  sleep 1
done
echo ""
ok "PostgreSQL is ready"

# Wait for Redis to be healthy
echo -n "  Waiting for Redis"
RETRIES=30
until docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; do
  echo -n "."
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo ""
    fail "Redis failed to start. Run 'docker compose logs redis' to debug."
  fi
  sleep 1
done
echo ""
ok "Redis is ready"

echo ""

# ── Database setup ────────────────────────────────────────────────────────────

info "Setting up database..."
npm run db:generate
npm run db:push
ok "Database schema applied"

# Seed sample data when running in demo mode
if grep -q "DEMO_MODE=true" .env 2>/dev/null; then
  info "Seeding sample data (DEMO_MODE)..."
  npm run db:seed
  ok "Sample data loaded"
fi

echo ""

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
info "Setup complete!"
echo ""

if grep -q "DEMO_MODE=true" .env 2>/dev/null; then
  echo -e "  ${YELLOW}Running in DEMO MODE with sample data.${NC}"
  echo "  To connect a real GitHub App, edit .env and set DEMO_MODE=false."
  echo ""
fi

echo "  Next steps:"
echo ""
echo "    npm run dev          Start all services in development mode"
echo "    npm run test:unit    Run unit tests (no Docker required)"
echo "    npm run test         Run all tests"
echo ""
echo "  Services will be available at:"
echo ""
echo "    Web Dashboard:  http://localhost:3000"
echo "    API Server:     http://localhost:3001"
echo "    API Docs:       http://localhost:3001/docs"
echo ""
