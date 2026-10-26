import { type NextRequest, NextResponse } from "next/server";

import { randomName } from "@/lib/randomName";
import { decrypt, encrypt, UsernameSchema } from "@/lib/session";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export async function proxy(request: NextRequest) {
  const cookie = request.cookies.get("session");
  const session = await decrypt(cookie?.value);
  const token = await encrypt(
    session ?? { username: UsernameSchema.parse(randomName()) },
  );

  // Forwarded too, so the request that mints a session already renders with it.
  request.cookies.set("session", token);
  const response = NextResponse.next({ request: { headers: request.headers } });

  response.cookies.set("session", token, {
    httpOnly: true,
    secure: true,
    maxAge: ONE_YEAR_SECONDS,
    // Strict withholds this on a link into the site from elsewhere, and the
    // miss mints a new username over the old one.
    sameSite: "lax",
    path: "/",
  });

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt, opengraph-image (metadata files)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|(?:.*/)?opengraph-image$).*)",
  ],
};
