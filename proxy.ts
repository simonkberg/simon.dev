import { type NextRequest, NextResponse } from "next/server";

import {
  savedOption,
  themePreference,
  variantPreference,
} from "@/lib/preferences";
import { randomName } from "@/lib/randomName";
import { decrypt, encrypt, UsernameSchema } from "@/lib/session";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export async function proxy(request: NextRequest) {
  const variant = savedOption(
    variantPreference,
    request.cookies.get(variantPreference.name)?.value,
  );
  const theme = savedOption(
    themePreference,
    request.cookies.get(themePreference.name)?.value,
  );
  const url = request.nextUrl.clone();
  url.pathname = `/${variant}/${theme}${url.pathname}`;
  const response = NextResponse.rewrite(url);

  const cookie = request.cookies.get("session");
  const session = await decrypt(cookie?.value);

  response.cookies.set(
    "session",
    await encrypt(session ?? { username: UsernameSchema.parse(randomName()) }),
    {
      httpOnly: true,
      secure: true,
      maxAge: ONE_YEAR_SECONDS,
      // Strict withholds this on a link into the site from elsewhere, and the
      // miss mints a new username over the old one.
      sameSite: "lax",
      path: "/",
    },
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - health (readiness route)
     * - _next, __nextjs (Next.js internals)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!api|health|_next|__nextjs|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
