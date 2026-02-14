#!/usr/bin/env bash
set -uo pipefail

# =============================================================================
# DocSynth Quickstart — Validate environment and start development
# Usage: npm run quickstart
#
# Combines doctor checks with setup and dev server start.
# =============================================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${BOLD}$1${NC}"; }
ok()    { echo -e "${GREEN}  ✓ $1${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail()  { echo -e "${RED}  ✗ $1${NC}"; }

echo ""
info "DocSynth Quickstart"
info "==================="
echo ""

ERRORS=0

# ── 1. Check prerequisites ───────────────────────────────────────────────────

info "Checking prerequisites..."

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js not installed — https://nodejs.org"
  ERRORS=$((ERRORS + 1))
else
  NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
  if [ "$NODE_MAJOR" -lt 20 ]; then
    fail "Node.js 20+ required (found $(node -v))"
    ERRORS=$((ERRORS + 1))
  else
    ok "Node.js $(node -v)"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  fail "Docker not installed — https://docs.docker.com/get-docker/"
  ERRORS=$((ERRORS + 1))
elif ! docker info >/dev/null 2>&1; then
  fail "Docker daemon not running — start Docker Desktop"
  ERRORS=$((ERRORS + 1))
else
  ok "Docker running"
fi

echo ""

# ── 2. Check dependencies ────────────────────────────────────────────────────

info "Checking dependencies..."

if [ ! -d "node_modules" ]; then
  warn "node_modules missing — installing..."
  npm install --loglevel=warn
  ok "Dependencies installed"
else
  ok "node_modules present"
fi

if [ ! -d "node_modules/.prisma/client" ]; then
  warn "Prisma client not generated — generating..."
  npm run db:generate --silent
  ok "Prisma client generated"
else
  ok "Prisma client ready"
fi

echo ""

# ── 3. Check environment ─────────────────────────────────────────────────────

info "Checking environment..."

if [ ! -f ".env" ]; then
  warn ".env missing — running setup..."
  bash scripts/setup.sh
  ok "Setup complete"
  echo ""
else
  ok ".env exists"

  if grep -q "CHANGE_ME" .env 2>/dev/null; then
    warn "SESSION_SECRET or JWT_SECRET has placeholder value — auto-generating..."
    SESSION_SECRET=$(openssl rand -hex 32)
    JWT_SECRET=$(openssl rand -hex 32)
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|SESSION_SECRET=.*|SESSION_SECRET=${SESSION_SECRET}|" .env
      sed -i '' "s|JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
    else
      sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=${SESSION_SECRET}|" .env
      sed -i "s|JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
    fi
    ok "Auto-generated SESSION_SECRET and JWT_SECRET"
  else
    ok "Secrets configured"
  fi
fi

echo ""

# ── 4. Check infrastructure ──────────────────────────────────────────────────

info "Checking infrastructure..."

if ! docker compose ps postgres 2>/dev/null | grep -q "running"; then
  warn "PostgreSQL not running — starting..."
  docker compose up -d postgres redis --quiet-pull 2>/dev/null
  echo -n "  Waiting for services"
  RETRIES=30
  until docker compose exec -T postgres pg_isready -q -U docsynth 2>/dev/null; do
    echo -n "."
    RETRIES=$((RETRIES - 1))
    if [ $RETRIES -le 0 ]; then
      echo ""
      fail "PostgreSQL failed to start"
      ERRORS=$((ERRORS + 1))
      break
    fi
    sleep 1
  done
  echo ""
  ok "PostgreSQL started"
else
  ok "PostgreSQL running"
fi

if ! docker compose ps redis 2>/dev/null | grep -q "running"; then
  warn "Redis not running — starting..."
  docker compose up -d redis --quiet-pull 2>/dev/null
  sleep 2
  ok "Redis started"
else
  ok "Redis running"
fi

echo ""

# ── 5. Check for errors ──────────────────────────────────────────────────────

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo -e "${RED}${BOLD}Cannot start: $ERRORS issue(s) found above.${NC}"
  echo "  Fix the issues and run this command again."
  echo ""
  exit 1
fi

# ── 6. Start development ─────────────────────────────────────────────────────

echo ""
info "Starting development servers..."
echo ""

# Start dev servers in the background so we can wait for readiness
npm run dev &
DEV_PID=$!

# Wait for API server to be ready
echo -n "  Waiting for services to start"
RETRIES=60
API_READY=false
until curl -s -o /dev/null --max-time 2 http://localhost:3001/health 2>/dev/null; do
  echo -n "."
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo ""
    warn "Timed out waiting for API. Services may still be starting."
    break
  fi
  sleep 2
done

if curl -s -o /dev/null --max-time 2 http://localhost:3001/health 2>/dev/null; then
  API_READY=true
fi
echo ""
echo ""

if [ "$API_READY" = true ]; then
  echo -e "${GREEN}${BOLD}  ✓ DocSynth is ready!${NC}"
else
  echo -e "${YELLOW}${BOLD}  ⏳ DocSynth is starting...${NC}"
fi
echo ""
echo "  ┌───────────────────────────────────────────────┐"
echo "  │  Web Dashboard:  http://localhost:3000         │"
echo "  │  API Server:     http://localhost:3001         │"
echo "  │  API Docs:       http://localhost:3001/docs    │"
echo "  │                                               │"
echo "  │  Verify:         npm run verify               │"
echo "  │  Run tests:      npm run test:unit            │"
echo "  │  All commands:   make                         │"
echo "  │  Stop:           Ctrl+C                       │"
echo "  └───────────────────────────────────────────────┘"
echo ""

# Bring dev servers back to foreground
wait $DEV_PID
