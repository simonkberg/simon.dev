import { type NextRequest, NextResponse } from "next/server";

import { randomName } from "@/lib/randomName";
import { decrypt, encrypt, UsernameSchema } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const response = NextResponse.next();

  const cookie = request.cookies.get("session");
  const session = await decrypt(cookie?.value);

  response.cookies.set(
    "session",
    await encrypt(session ?? { username: UsernameSchema.parse(randomName()) }),
    {
      httpOnly: true,
      secure: true,
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      sameSite: "strict",
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
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
