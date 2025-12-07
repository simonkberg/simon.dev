# simon.dev

My personal website built with Next.js 16.

## Features

- Real-time chat powered by Discord
- AI-powered chat bot (simon-bot) using Claude
- Coding stats from WakaTime
- Recently played music from Last.fm
- Listening statistics (top tracks, artists, albums) from Last.fm
- Server-Sent Events for live updates

## Development

Requirements:

- Node.js 24
- Corepack enabled

```bash
# Enable corepack if not already enabled
corepack enable

# Install dependencies
pnpm install

# Start development server
pnpm dev

# Run tests
pnpm test

# Lint (ESLint + Prettier)
pnpm lint

# Auto-fix linting issues
pnpm lint:fix
```

## Environment Variables

Create a `.env.local` file with:

```
SESSION_SECRET=your-secret-key
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_GUILD_ID=your-guild-id
DISCORD_CHANNEL_ID=your-channel-id
UPSTASH_REDIS_REST_URL=your-redis-url
UPSTASH_REDIS_REST_TOKEN=your-redis-token
LAST_FM_API_KEY=your-lastfm-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

## Deployment

The site is containerized and deployed to Railway:

```bash
# Build Docker image
docker build -t simon.dev .

# Run locally
docker run -p 3000:3000 simon.dev
```

## License

MIT
