import type { Env } from "@/lib/env";

/**
 * Centralized mock environment variables for tests.
 * Used in vitest.config.ts and tests to ensure consistent test data.
 */
export const mockEnv = {
  SESSION_SECRET: "test",
  DISCORD_BOT_TOKEN: "test-discord-bot-token",
  DISCORD_GUILD_ID: "test-discord-guild-id",
  DISCORD_CHANNEL_ID: "test-discord-channel-id",
  UPSTASH_REDIS_REST_URL: "https://test.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-redis-token",
  LAST_FM_API_KEY: "test-last-fm-api-key",
  ANTHROPIC_API_KEY: "test-anthropic-api-key",
} satisfies Env;
