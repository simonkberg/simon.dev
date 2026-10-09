export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { startBotSubscription } = await import("@/lib/discord/bot");
    const { refreshIpDenyList } = await import("@/lib/ipDenyList");
    const { bridgeConsole, log } = await import("@/lib/log");
    const { runMigrations } = await import("@/lib/migrations");
    const { markReady } = await import("@/lib/readiness");

    bridgeConsole();
    void refreshIpDenyList();

    try {
      await runMigrations();
      markReady("migrations");
    } catch (err) {
      log.error({ err }, "Failed to run migrations");
    }

    startBotSubscription()
      .then(() => markReady("bot"))
      .catch((err) => {
        log.error({ err }, "Failed to start bot subscription");
      });
  }
}
