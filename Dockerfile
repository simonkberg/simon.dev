# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89
# check=skip=SecretsUsedInArgOrEnv;error=true

FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS base

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
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Use cache mount for Next.js build cache, then copy it out of the
# mount so it's available in the layer for the runner stage.
RUN --mount=type=cache,id=s/ef8993ce-cfd2-4811-8cd1-005564b52ee4-/app/.next/cache,target=/app/.next/cache \
    node --run build && \
    cp -r /app/.next/cache /app/.next/build-cache

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
