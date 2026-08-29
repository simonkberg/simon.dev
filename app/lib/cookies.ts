const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Shared by the session cookie and the chat tip cookie. */
export const cookieOptions = {
  httpOnly: true,
  // Browsers drop a Secure cookie served over plain http, dev origins included.
  secure: process.env.NODE_ENV === "production",
  // Strict withholds these from a navigation that started on another site,
  // where they are read to render the page.
  sameSite: "lax",
  maxAge: ONE_YEAR_SECONDS,
  path: "/",
} as const;
