import "server-only";

import { cookies } from "next/headers";

const COOKIE_NAME = "hasPosted";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Whether this visitor has sent a chat message before. */
export async function getHasPosted() {
  const cookieJar = await cookies();

  return cookieJar.get(COOKIE_NAME)?.value === "true";
}

/**
 * Records that the visitor has posted. Returns false when it was already
 * recorded, so callers can skip refreshing a tree that would render the same.
 */
export async function setHasPosted() {
  const cookieJar = await cookies();

  if (cookieJar.get(COOKIE_NAME)?.value === "true") {
    return false;
  }

  cookieJar.set(COOKIE_NAME, "true", {
    httpOnly: true,
    secure: true,
    expires: new Date(Date.now() + ONE_YEAR_MS),
    sameSite: "strict",
    path: "/",
  });

  return true;
}
