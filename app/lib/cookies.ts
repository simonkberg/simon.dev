const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Shared by the session cookie and the chat tip cookie. */
export const cookieOptions = {
  httpOnly: true,
  // Browsers silently drop a Secure cookie served over plain http, so
  // hardcoding it makes every cookie a no-op on a dev origin — always over a
  // LAN IP, and in Safari even on localhost.
  secure: process.env.NODE_ENV === "production",
  maxAge: ONE_YEAR_SECONDS,
  sameSite: "strict",
  path: "/",
} as const;
