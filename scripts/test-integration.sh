#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# DocSynth Integration Tests — Self-Contained
# Usage: npm run test:integration
#
# Starts test-specific PostgreSQL (port 5433) and Redis (port 6380),
# runs all tests, then tears down the containers.
# =============================================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

COMPOSE_FILE="docker-compose.test.yml"
TEST_DATABASE_URL="postgresql://docsynth:docsynth_test@localhost:5433/docsynth_test"
TEST_REDIS_URL="redis://localhost:6380"

cleanup() {
  echo ""
  echo -e "${BOLD}Stopping test infrastructure...${NC}"
  docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans 2>/dev/null || true
}

trap cleanup EXIT

echo ""
echo -e "${BOLD}DocSynth Integration Tests${NC}"
echo -e "${BOLD}=========================${NC}"
echo ""

# ── Start test infrastructure ─────────────────────────────────────────────────

echo -e "${BOLD}Starting test infrastructure...${NC}"
docker compose -f "$COMPOSE_FILE" up -d --wait 2>&1

echo -e "${GREEN}  ✓ PostgreSQL (port 5433) and Redis (port 6380) ready${NC}"
echo ""

# ── Set up database ──────────────────────────────────────────────────────────

echo -e "${BOLD}Applying database schema...${NC}"
DATABASE_URL="$TEST_DATABASE_URL" npm run db:generate --silent
DATABASE_URL="$TEST_DATABASE_URL" npm run db:push --silent
echo -e "${GREEN}  ✓ Schema applied${NC}"
echo ""

# ── Run tests ─────────────────────────────────────────────────────────────────

echo -e "${BOLD}Running tests...${NC}"
echo ""

DATABASE_URL="$TEST_DATABASE_URL" \
REDIS_URL="$TEST_REDIS_URL" \
npm run test

TEST_EXIT=$?

echo ""
if [ $TEST_EXIT -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All tests passed!${NC}"
else
  echo -e "${RED}${BOLD}Some tests failed (exit code: $TEST_EXIT)${NC}"
fi

exit $TEST_EXIT
