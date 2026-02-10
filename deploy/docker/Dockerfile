# ============================================================================
# DocSynth Multi-Stage Production Dockerfile
# Supports self-hosted and air-gapped deployments
# ============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files for dependency caching
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/github/package.json packages/github/
COPY packages/queue/package.json packages/queue/
COPY packages/utils/package.json packages/utils/

# Install dependencies
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Generate Prisma client and build all packages
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma
RUN npm run build

# Stage 2: Production API
FROM node:20-alpine AS api

WORKDIR /app

RUN apk add --no-cache tini curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/index.js"]

# Stage 3: Production Worker
FROM node:20-alpine AS worker

WORKDIR /app

RUN apk add --no-cache tini

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/worker ./apps/worker
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/worker/dist/index.js"]
