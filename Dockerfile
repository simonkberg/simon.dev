# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv;error=true

FROM node:24.11.1-alpine@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7 AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm

# Use cache mount for pnpm store
RUN --mount=type=cache,id=s/ef8993ce-cfd2-4811-8cd1-005564b52ee4-/root/.local/share/pnpm/store,target=/root/.local/share/pnpm/store \
    pnpm i --frozen-lockfile

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

# Use cache mount for Next.js build cache
RUN --mount=type=cache,id=s/ef8993ce-cfd2-4811-8cd1-005564b52ee4-/app/.next/cache,target=/app/.next/cache \
    node --run build

# Production server
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
