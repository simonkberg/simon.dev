import { NextResponse } from "next/server";

import { identifiers } from "@/lib/identifiers";
import { isDeniedRequest } from "@/lib/ipDenyList";
import { log } from "@/lib/log";
import { findSession } from "@/lib/session";
import { setTyping } from "@/lib/siteTyping";

// A bare ping, so the name comes from the session and the text never leaves the input.
export async function POST() {
  const session = await findSession();
  if (!session) return new NextResponse(null, { status: 401 });

  const { ip } = await identifiers();
  if (isDeniedRequest(ip, "typing")) {
    return new NextResponse(null, { status: 403 });
  }

  try {
    await setTyping(session.username);
  } catch (err) {
    log.warn({ err }, "Failed to store typing");
    return new NextResponse(null, { status: 503 });
  }
  return new NextResponse(null, { status: 204 });
}
