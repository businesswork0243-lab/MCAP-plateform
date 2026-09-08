# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY package.json package-lock.json* turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* turbo.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# .next/cache is excluded by .dockerignore, so without these mounts every
# deploy was a cold Next build. The mounts persist the webpack and turbo
# caches across builds without shipping them in the image.
RUN --mount=type=cache,target=/app/apps/web/.next/cache \
    --mount=type=cache,target=/app/.turbo \
    npx turbo run build --filter=@mcap/web

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# next.config sets output:'standalone' but the old runner ignored it and
# copied the whole monorepo node_modules plus apps/web (including the
# freshly built .next/cache). Standalone ships only what the server needs.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
