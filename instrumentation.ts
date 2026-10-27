export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { startBotSubscription } = await import("@/lib/discord/bot");
    const { watchOnline } = await import("@/lib/discord/online");
    const { refreshIpDenyList } = await import("@/lib/ipDenyList");
    const { localOrigin, warmCovers } = await import("@/lib/covers");
    const { bridgeConsole, log } = await import("@/lib/log");
    const { runMigrationsUntilApplied } = await import("@/lib/migrations");
    const { markReady } = await import("@/lib/readiness");
    const { startScrobbleSync } = await import("@/lib/scrobbles");
    const { keepWarm } = await import("@/lib/turso");

    bridgeConsole();
    void refreshIpDenyList();

    // Not awaited, so /health can answer 503 while Turso is out.
    runMigrationsUntilApplied()
      .then(() => {
        markReady("migrations");
        keepWarm();
        startScrobbleSync();
        watchOnline();
        // After migrations, so new bot code never meets an old schema.
        return startBotSubscription();
      })
      .then(() => {
        markReady("bot");
        warmCovers(localOrigin);
      })
      .catch((err) => {
        log.error({ err }, "Failed to start bot subscription");
      });
  }
}
