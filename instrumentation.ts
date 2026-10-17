export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { startBotSubscription } = await import("@/lib/discord/bot");
    const { refreshIpDenyList } = await import("@/lib/ipDenyList");
    const { bridgeConsole, log } = await import("@/lib/log");
    const { runMigrationsUntilApplied } = await import("@/lib/migrations");
    const { markReady } = await import("@/lib/readiness");
    const { keepWarm } = await import("@/lib/turso");

    bridgeConsole();
    void refreshIpDenyList();
    keepWarm();

    // Not awaited, so /health can answer 503 while Turso is out.
    runMigrationsUntilApplied()
      .then(() => {
        markReady("migrations");
        // After migrations, so new bot code never meets an old schema.
        return startBotSubscription();
      })
      .then(() => markReady("bot"))
      .catch((err) => {
        log.error({ err }, "Failed to start bot subscription");
      });
  }
}
