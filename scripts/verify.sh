#!/usr/bin/env bash
set -uo pipefail

# =============================================================================
# DocSynth Verify — Smoke-test the running development environment
# Usage: npm run verify
#
# Checks that all services are up and responding correctly.
# Run this after 'npm run quickstart' or 'npm run dev' to confirm everything works.
# =============================================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL + 1)); }

API_URL="${API_URL:-http://localhost:3001}"
WEB_URL="${APP_URL:-http://localhost:3000}"
TIMEOUT=5

echo ""
echo -e "${BOLD}DocSynth Verify${NC}"
echo -e "${BOLD}===============${NC}"
echo ""

# ── API Health ────────────────────────────────────────────────────────────────

echo -e "${BOLD}Services${NC}"

API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "${API_URL}/health" 2>/dev/null)
if [ "$API_RESPONSE" = "200" ]; then
  pass "API server responding at ${API_URL}/health"
else
  fail "API server not responding at ${API_URL}/health (HTTP ${API_RESPONSE:-timeout})"
fi

WEB_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "${WEB_URL}" 2>/dev/null)
if [ "$WEB_RESPONSE" = "200" ]; then
  pass "Web dashboard responding at ${WEB_URL}"
else
  fail "Web dashboard not responding at ${WEB_URL} (HTTP ${WEB_RESPONSE:-timeout})"
fi

echo ""

# ── Infrastructure ────────────────────────────────────────────────────────────

echo -e "${BOLD}Infrastructure${NC}"

if docker compose exec -T postgres pg_isready -q -U docsynth 2>/dev/null; then
  pass "PostgreSQL accepting connections"
else
  fail "PostgreSQL not responding"
fi

if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
  pass "Redis responding"
else
  fail "Redis not responding"
fi

echo ""

# ── API Endpoint Checks ──────────────────────────────────────────────────────

echo -e "${BOLD}API Endpoints${NC}"

HEALTH_BODY=$(curl -s --max-time "$TIMEOUT" "${API_URL}/health" 2>/dev/null)
if echo "$HEALTH_BODY" | grep -q '"status"'; then
  pass "Health endpoint returns valid JSON"
else
  fail "Health endpoint returned unexpected body"
fi

DOCS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "${API_URL}/docs" 2>/dev/null)
if [ "$DOCS_RESPONSE" = "200" ] || [ "$DOCS_RESPONSE" = "301" ] || [ "$DOCS_RESPONSE" = "302" ]; then
  pass "API docs available at ${API_URL}/docs"
else
  fail "API docs not available at ${API_URL}/docs (HTTP ${DOCS_RESPONSE:-timeout})"
fi

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL))
echo -e "${BOLD}Summary${NC}"
echo -e "  ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC} (${TOTAL} checks)"
echo ""

if [ $FAIL -gt 0 ]; then
  echo -e "  ${YELLOW}Some checks failed. Make sure services are running:${NC}"
  echo "    npm run dev          # Start all services"
  echo "    npm run doctor       # Check environment health"
  echo ""
  exit 1
else
  echo -e "  ${GREEN}All services are healthy! 🎉${NC}"
  echo ""
fi
