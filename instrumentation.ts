export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { startBotSubscription } = await import("@/lib/discord/bot");

    startBotSubscription().catch((err) => {
      console.error("Failed to start bot subscription:", err);
    });
  }
}
