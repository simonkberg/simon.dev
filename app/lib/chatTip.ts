import "server-only";

import { cookies } from "next/headers";

const COOKIE_NAME = "chatTipDismissed";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

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

  cookieJar.set(COOKIE_NAME, "true", {
    httpOnly: true,
    secure: true,
    expires: new Date(Date.now() + ONE_YEAR_MS),
    sameSite: "strict",
    path: "/",
  });
}
