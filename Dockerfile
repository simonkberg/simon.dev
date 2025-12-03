# syntax=docker/dockerfile:1

FROM node:24.11.1-alpine@sha256:2867d550cf9d8bb50059a0fff528741f11a84d985c732e60e19e8e75c7239c43 AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Enable pnpm
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./

# Use cache mount for pnpm store
RUN --mount=type=cache,id=s/ef8993ce-cfd2-4811-8cd1-005564b52ee4-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm i --frozen-lockfile

# Build the app
FROM base AS builder
WORKDIR /app
ENV SKIP_ENV_VALIDATION=true

# Enable pnpm
RUN corepack enable pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Use cache mount for Next.js build cache
RUN --mount=type=cache,id=s/ef8993ce-cfd2-4811-8cd1-005564b52ee4-nextjs-cache,target=/root/.next/cache \
    pnpm run build

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
