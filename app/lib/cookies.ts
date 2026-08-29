const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Shared by the session cookie and the chat tip cookie. */
export const cookieOptions = {
  httpOnly: true,
  // Browsers silently drop a Secure cookie served over plain http, so
  // hardcoding it makes every cookie a no-op on a dev origin — always over a
  // LAN IP, and in Safari even on localhost.
  secure: process.env.NODE_ENV === "production",
  // Not "strict": both cookies are read while rendering a top-level GET, and
  // strict withholds them from a navigation that started on another site. The
  // cookie survives, but that first render can't see it — the tip comes back
  // and the session mints a new username. Lax still keeps them off cross-site
  // POSTs, which is the only thing worth protecting here.
  sameSite: "lax",
  maxAge: ONE_YEAR_SECONDS,
  path: "/",
} as const;
