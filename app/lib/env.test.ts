import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  type Mock,
  vi,
} from "vitest";

import { mockEnv } from "@/mocks/env";

import type { Env } from "./env";

describe("env", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("successful validation", () => {
    it("should parse valid environment variables", async () => {
      const { env } = await import("./env");

      expect(env).toEqual(mockEnv);
    });

    it("should export Env type matching env object", async () => {
      const { env } = await import("./env");

      expectTypeOf<Env>(env).toEqualTypeOf<{
        SESSION_SECRET: string;
        SLACK_CHANNEL: string;
        SLACK_TOKEN: string;
        DISCORD_BOT_TOKEN: string;
        DISCORD_GUILD_ID: string;
        DISCORD_CHANNEL_ID: string;
        UPSTASH_REDIS_REST_URL: string;
        UPSTASH_REDIS_REST_TOKEN: string;
        LAST_FM_API_KEY: string;
      }>();
    });

    it("should use default SESSION_SECRET in development when not provided", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("SESSION_SECRET", undefined);

      const { env } = await import("./env");

      expect(env.SESSION_SECRET).toBe("unsafe_dev_secret");
    });

    it("should allow missing values when SKIP_ENV_VALIDATION is true", async () => {
      vi.stubEnv("SKIP_ENV_VALIDATION", "true");
      for (const key of Object.keys(mockEnv)) {
        vi.stubEnv(key, undefined);
      }

      const { env } = await import("./env");

      // When SKIP_ENV_VALIDATION is true, schema becomes partial
      // so undefined values are allowed
      expect(env).toBeDefined();

      // Type should still match Env even with partial validation
      expectTypeOf(env).toEqualTypeOf<Env>();
    });
  });

  describe("validation failures", () => {
    let consoleErrorSpy: Mock<Console["error"]>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("should throw when SESSION_SECRET is missing in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SESSION_SECRET", undefined);

      await expect(import("./env")).rejects.toThrow(
        "Invalid environment variables",
      );
    });

    it("should throw when SLACK_CHANNEL is missing", async () => {
      vi.stubEnv("SLACK_CHANNEL", undefined);

      await expect(import("./env")).rejects.toThrow(
        "Invalid environment variables",
      );
    });

    it("should throw when UPSTASH_REDIS_REST_URL is not a valid URL", async () => {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "not-a-url");

      await expect(import("./env")).rejects.toThrow(
        "Invalid environment variables",
      );
    });

    it("should throw when SLACK_TOKEN is empty string", async () => {
      vi.stubEnv("SLACK_TOKEN", "");

      await expect(import("./env")).rejects.toThrow(
        "Invalid environment variables",
      );
    });

    it("should throw when LAST_FM_API_KEY is missing", async () => {
      vi.stubEnv("LAST_FM_API_KEY", undefined);

      await expect(import("./env")).rejects.toThrow(
        "Invalid environment variables",
      );
    });
  });
});
