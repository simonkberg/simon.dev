export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { startBotSubscription } = await import("@/lib/discord/bot");
    const { log } = await import("@/lib/log");

    startBotSubscription().catch((err) => {
      log.error({ err }, "Failed to start bot subscription");
    });
  }
}
