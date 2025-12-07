import z from "zod";

export const env = parseAndValidateEnv({
  SESSION_SECRET: z.preprocess(
    (value) =>
      process.env.NODE_ENV === "development" && value == null
        ? "unsafe_dev_secret"
        : value,
    z.string().min(1, "SESSION_SECRET is required"),
  ),
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID is required"),
  DISCORD_CHANNEL_ID: z.string().min(1, "DISCORD_CHANNEL_ID is required"),
  UPSTASH_REDIS_REST_URL: z.url("UPSTASH_REDIS_REST_URL must be a valid URL"),
  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .min(1, "UPSTASH_REDIS_REST_TOKEN is required"),
  LAST_FM_API_KEY: z.string().min(1, "LAST_FM_API_KEY is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
});

export type Env = typeof env;

function parseAndValidateEnv<T extends Record<string, z.ZodTypeAny>>(
  schema: T,
) {
  const envSchema = z.object(schema);

  const skipEnvValidation = z
    .stringbool()
    .default(false)
    .parse(process.env["SKIP_ENV_VALIDATION"]);

  const result = (
    skipEnvValidation ? envSchema.partial() : envSchema
  ).safeParse(process.env) as z.ZodSafeParseResult<z.infer<typeof envSchema>>;

  if (!result.success) {
    console.error(
      `✖ Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );

    throw new Error(
      "Invalid environment variables. Check the console output above for details.",
    );
  }

  return result.data;
}
