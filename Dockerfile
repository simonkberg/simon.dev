# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=SecretsUsedInArgOrEnv;error=true

FROM node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm

# Use cache mount for pnpm store
RUN --mount=type=cache,id=s/ef8993ce-cfd2-4811-8cd1-005564b52ee4-/root/.local/share/pnpm/store,target=/root/.local/share/pnpm/store \
    pnpm i --frozen-lockfile --ignore-scripts

# Build the app
FROM base AS builder
WORKDIR /app
ARG SESSION_SECRET
ARG DISCORD_BOT_TOKEN
ARG DISCORD_GUILD_ID
ARG DISCORD_CHANNEL_ID
ARG UPSTASH_REDIS_REST_URL
ARG UPSTASH_REDIS_REST_TOKEN
ARG LAST_FM_API_KEY
ARG ANTHROPIC_API_KEY
ARG TURSO_DATABASE_URL
ARG TURSO_AUTH_TOKEN
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Use cache mount for Next.js build cache, then copy it out of the
# mount so it's available in the layer for the runner stage. The
# Turbopack cache is build-only and would just bloat the image.
RUN --mount=type=cache,id=s/ef8993ce-cfd2-4811-8cd1-005564b52ee4-/app/.next/cache,target=/app/.next/cache \
    node --run build && \
    cp -r /app/.next/cache /app/.next/build-cache && \
    rm -rf /app/.next/build-cache/turbopack

# Production server
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Set the correct permission for prerender cache
RUN mkdir .next && chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/.next/build-cache ./.next/cache

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
