# ═══════════════════════════════════════════════════════════
# M-CAP API - Production Dockerfile
# Build Context: Repository ROOT
# ═══════════════════════════════════════════════════════════

# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat wget

# ─── Dependencies ─────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
COPY turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN --mount=type=cache,target=/root/.npm npm ci

# ─── Builder ──────────────────────────────────────
FROM base AS builder

# Copy node_modules
COPY --from=deps /app/node_modules ./node_modules

# Copy root config
COPY package.json package-lock.json* turbo.json ./

# Copy source code
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

# ⚠️ IMPORTANT: Copy migrations folder
COPY migrations ./migrations

# Verify migrations copied
RUN echo "=== Verifying migrations folder ===" && \
    ls -la migrations/ && \
    echo "=== Migrations verified ==="

# Build
RUN --mount=type=cache,target=/app/.turbo npx turbo run build --filter=@mcap/api

# Verify build output
RUN echo "=== Verifying dist folder ===" && \
    ls -la apps/api/dist/

# ─── Runner (Production) ──────────────────────────
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 apiuser

# Copy from builder
COPY --from=builder --chown=apiuser:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=apiuser:nodejs /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=apiuser:nodejs /app/packages/shared ./packages/shared
COPY --from=builder --chown=apiuser:nodejs /app/migrations ./migrations
COPY --from=builder --chown=apiuser:nodejs /app/package.json ./
COPY --from=builder --chown=apiuser:nodejs /app/node_modules ./node_modules

USER apiuser

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-4000}/health || exit 1

CMD ["node", "apps/api/dist/index.js"]