export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { startBotSubscription } = await import("@/lib/discord/bot");
    const { log } = await import("@/lib/log");
    const { runMigrations } = await import("@/lib/migrations");

    try {
      await runMigrations();
    } catch (err) {
      log.error({ err }, "Failed to run migrations");
    }

    startBotSubscription().catch((err) => {
      log.error({ err }, "Failed to start bot subscription");
    });
  }
}
