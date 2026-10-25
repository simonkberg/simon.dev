import { NextResponse } from "next/server";

import { identifiers } from "@/lib/identifiers";
import { isDeniedRequest } from "@/lib/ipDenyList";
import { log } from "@/lib/log";
import { findSession, type Username } from "@/lib/session";
import { setTyping, stopTyping } from "@/lib/siteTyping";

async function typist(): Promise<Username | NextResponse> {
  const session = await findSession();
  if (!session) return new NextResponse(null, { status: 401 });

  const { ip } = await identifiers();
  if (isDeniedRequest(ip, "typing")) {
    return new NextResponse(null, { status: 403 });
  }
  return session.username;
}

// A bare ping, so the name comes from the session and the text never leaves the input.
export async function POST() {
  const username = await typist();
  if (username instanceof NextResponse) return username;

  try {
    await setTyping(username);
  } catch (err) {
    log.warn({ err }, "Failed to store typing");
    return new NextResponse(null, { status: 503 });
  }
  return new NextResponse(null, { status: 204 });
}

// The draft was cleared without posting.
export async function DELETE() {
  const username = await typist();
  if (username instanceof NextResponse) return username;

  await stopTyping(username);
  return new NextResponse(null, { status: 204 });
}
