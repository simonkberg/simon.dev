import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { identifiers } from "@/lib/identifiers";
import { isDeniedIp } from "@/lib/ipDenyList";
import { log } from "@/lib/log";
import { findSession } from "@/lib/session";
import { setTyping } from "@/lib/siteTyping";

const BodySchema = z.object({ typing: z.boolean() });

// A ping, never the text, so the name comes from the session rather than the request.
export async function POST(request: NextRequest) {
  const session = await findSession();
  if (!session) return new NextResponse(null, { status: 401 });

  const { ip } = await identifiers();
  if (ip !== undefined && isDeniedIp(ip)) {
    return new NextResponse(null, { status: 403 });
  }

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return new NextResponse(null, { status: 400 });

  try {
    await setTyping(session.username, body.data.typing);
  } catch (err) {
    log.warn({ err }, "Failed to store typing");
    return new NextResponse(null, { status: 503 });
  }
  return new NextResponse(null, { status: 204 });
}
