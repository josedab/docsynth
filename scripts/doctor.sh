#!/usr/bin/env bash
set -uo pipefail

# =============================================================================
# DocSynth Doctor - Check development environment health
# Usage: npm run doctor
# =============================================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

PASS=0
WARN=0
FAIL=0

pass() { echo -e "  ${GREEN}PASS${NC}  $1"; PASS=$((PASS + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; WARN=$((WARN + 1)); }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; FAIL=$((FAIL + 1)); }

echo ""
echo -e "${BOLD}DocSynth Doctor${NC}"
echo -e "${BOLD}===============${NC}"
echo ""

# ── Node.js ───────────────────────────────────────────────────────────────────

echo -e "${BOLD}Runtime${NC}"

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    pass "Node.js $(node -v)"
  else
    fail "Node.js $(node -v) - version 20+ required"
  fi
else
  fail "Node.js not installed"
fi

if command -v npm >/dev/null 2>&1; then
  pass "npm $(npm -v)"
else
  fail "npm not installed"
fi

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    pass "Docker daemon running"
  else
    fail "Docker installed but daemon not running - start Docker Desktop"
  fi
else
  fail "Docker not installed"
fi

echo ""

# ── Dependencies ──────────────────────────────────────────────────────────────

echo -e "${BOLD}Dependencies${NC}"

if [ -d "node_modules" ]; then
  pass "node_modules exists"
else
  fail "node_modules missing - run 'npm install'"
fi

if [ -d "node_modules/.prisma/client" ]; then
  pass "Prisma client generated"
else
  fail "Prisma client not generated - run 'npm run db:generate'"
fi

echo ""

# ── Environment ───────────────────────────────────────────────────────────────

echo -e "${BOLD}Environment${NC}"

if [ -f ".env" ]; then
  pass ".env file exists"

  # Check for placeholder values
  if grep -q "CHANGE_ME" .env 2>/dev/null; then
    fail "SESSION_SECRET or JWT_SECRET still has placeholder value - generate with: openssl rand -hex 32"
  else
    pass "Secrets configured"
  fi

  # Check DEMO_MODE
  if grep -q "DEMO_MODE=true" .env 2>/dev/null; then
    pass "Running in demo mode (GitHub App not required)"
  else
    # Check GitHub App config
    if grep -q "GITHUB_APP_ID=your_app_id" .env 2>/dev/null || grep -q "GITHUB_APP_ID=$" .env 2>/dev/null; then
      warn "GitHub App not configured - set DEMO_MODE=true or configure GitHub App credentials"
    else
      pass "GitHub App configured"
    fi
  fi
else
  fail ".env file missing - run 'cp .env.example .env'"
fi

echo ""

# ── Infrastructure ────────────────────────────────────────────────────────────

echo -e "${BOLD}Infrastructure${NC}"

if docker compose ps postgres 2>/dev/null | grep -q "running"; then
  pass "PostgreSQL container running"

  if docker compose exec -T postgres pg_isready -q -U docsynth 2>/dev/null; then
    pass "PostgreSQL accepting connections"
  else
    fail "PostgreSQL not accepting connections"
  fi
else
  fail "PostgreSQL container not running - run 'docker compose up -d'"
fi

if docker compose ps redis 2>/dev/null | grep -q "running"; then
  pass "Redis container running"

  if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    pass "Redis responding to ping"
  else
    fail "Redis not responding"
  fi
else
  fail "Redis container not running - run 'docker compose up -d'"
fi

echo ""

# ── Ports ─────────────────────────────────────────────────────────────────────

echo -e "${BOLD}Ports${NC}"

check_port() {
  local port=$1
  local service=$2
  if lsof -i :"$port" >/dev/null 2>&1; then
    local proc=$(lsof -i :"$port" -t 2>/dev/null | head -1)
    local pname=$(ps -p "$proc" -o comm= 2>/dev/null || echo "unknown")
    # Check if the port is held by our own Docker containers (not a conflict)
    if echo "$pname" | grep -qiE "com.docker|docker|vpnkit"; then
      pass "Port $port in use by Docker ($service) — managed by docker-compose"
    else
      warn "Port $port in use by $pname (needed for $service) — stop it with: lsof -i :$port -t | xargs kill"
    fi
  else
    pass "Port $port available ($service)"
  fi
}

check_port 3000 "Web Dashboard"
check_port 3001 "API Server"
check_port 5432 "PostgreSQL"
check_port 6379 "Redis"

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

echo -e "${BOLD}Summary${NC}"
TOTAL=$((PASS + WARN + FAIL))
echo -e "  ${GREEN}$PASS passed${NC}, ${YELLOW}$WARN warnings${NC}, ${RED}$FAIL failed${NC} ($TOTAL checks)"
echo ""

if [ $FAIL -gt 0 ]; then
  echo "  Run ./scripts/setup.sh to fix common issues."
  echo ""
  exit 1
fi
