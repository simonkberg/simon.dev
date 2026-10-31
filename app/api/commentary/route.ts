import { type NextRequest, NextResponse } from "next/server";

import { isBanned } from "@/lib/bans";
import {
  type CommentaryPage,
  getCommentary,
  parsePage,
  writeCommentary,
} from "@/lib/commentary";
import { identifiers, networkOf } from "@/lib/identifiers";
import { isDeniedRequest } from "@/lib/ipDenyList";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rateLimit";
import { getToday } from "@/lib/today";

const LIMITS = { limit: 20, windowMs: 60 * 60_000 };

async function pageOf(
  request: NextRequest,
): Promise<CommentaryPage | undefined> {
  return parsePage(request.nextUrl.searchParams.get("page"), await getToday());
}

const text = (value: string | undefined) =>
  value === undefined
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ text: value });

export async function GET(request: NextRequest) {
  const page = await pageOf(request);
  if (page === undefined) return new NextResponse(null, { status: 404 });

  const result = await getCommentary(page);
  if (result.status === "error") return new NextResponse(null, { status: 503 });
  return text(result.text);
}

// Writes one when none is stored; the client asks only after hydrating, so crawlers never do.
export async function POST(request: NextRequest) {
  const page = await pageOf(request);
  if (page === undefined) return new NextResponse(null, { status: 404 });

  const stored = await getCommentary(page);
  if (stored.status === "ok" && stored.text !== undefined) {
    return text(stored.text);
  }

  const { ip } = await identifiers();
  if (isDeniedRequest(ip, "commentary")) {
    return new NextResponse(null, { status: 403 });
  }
  if (ip !== undefined) {
    // It shares the API key with the chat, so a flood would stall simon-bot's replies too.
    const [banned, limited] = await Promise.all([
      isBanned(ip),
      rateLimit(`commentary:${networkOf(ip)}`, LIMITS),
    ]);
    if (banned) return new NextResponse(null, { status: 403 });
    if (!limited.success) {
      return new NextResponse(null, {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSeconds) },
      });
    }
  }

  try {
    return text(await writeCommentary(page));
  } catch (err) {
    log.error({ err, page }, "Failed to write commentary");
    return new NextResponse(null, { status: 503 });
  }
}
