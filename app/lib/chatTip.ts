import "server-only";
import { cookies } from "next/headers";

const COOKIE_NAME = "chatTipDismissed";

/**
 * Whether the "mention simon bot" tip has been dismissed, either by sending a
 * message or by clicking it away.
 */
export async function getChatTipDismissed() {
  const cookieJar = await cookies();

  return cookieJar.get(COOKIE_NAME)?.value === "true";
}

/** Dismisses the tip, leaving an already-dismissed cookie untouched. */
export async function setChatTipDismissed() {
  if (await getChatTipDismissed()) {
    return;
  }

  const cookieJar = await cookies();

  cookieJar.set(COOKIE_NAME, "true");
}
