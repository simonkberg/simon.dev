# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# check=skip=SecretsUsedInArgOrEnv;error=true

FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY --from=ghcr.io/pnpm/pnpm:12.15.0-alpine@sha256:f164ca19f7736a0994dae195b81756cd969542a93ef692f5ab466759d06c1da9 /opt/pnpm /opt/pnpm
ENV PATH=/opt/pnpm:$PATH
WORKDIR /app
COPY package.json pnpm-lock.yaml ./

# Cache the pnpm store and pnpm's metadata, which remembers verified lockfile entries.
# The base image already has the Node that devEngines.runtime pins.
RUN --mount=type=cache,id=s/ef8993ce-cfd2-4811-8cd1-005564b52ee4-/root/.local/share/pnpm/store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=s/ef8993ce-cfd2-4811-8cd1-005564b52ee4-/root/.cache/pnpm,target=/root/.cache/pnpm \
    pnpm i --frozen-lockfile --ignore-scripts --no-runtime

# Build the app
FROM base AS builder
WORKDIR /app
ARG SESSION_SECRET
ARG DISCORD_BOT_TOKEN
ARG DISCORD_GUILD_ID
ARG DISCORD_CHANNEL_ID
ARG LAST_FM_API_KEY
ARG ANTHROPIC_API_KEY
ARG TURSO_DATABASE_URL
ARG TURSO_AUTH_TOKEN
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ARG RAILWAY_ENVIRONMENT_ID
ARG RAILWAY_ENVIRONMENT_NAME
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A tab still running an older deploy's JS then reloads instead of crashing on navigation.
ARG RAILWAY_GIT_COMMIT_SHA
ENV NEXT_DEPLOYMENT_ID=${RAILWAY_GIT_COMMIT_SHA}

# Use cache mount for Next.js build cache, then copy it out of the
# mount so it's available in the layer for the runner stage. The
# Turbopack cache is build-only and would just bloat the image.
# Keyed by environment, since PR previews building into one cache corrupt it.
RUN --mount=type=cache,id=s/ef8993ce-cfd2-4811-8cd1-005564b52ee4-${RAILWAY_ENVIRONMENT_ID}-/app/.next/cache,target=/app/.next/cache \
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
