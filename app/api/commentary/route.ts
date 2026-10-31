import { type NextRequest, NextResponse } from "next/server";

import { admit } from "@/lib/admission";
import {
  type CommentaryPage,
  getCommentary,
  parsePage,
  writeCommentary,
} from "@/lib/commentary";
import { identifiers } from "@/lib/identifiers";
import { log } from "@/lib/log";

const LIMITS = { limit: 20, windowMs: 60 * 60_000 };

const pageOf = (request: NextRequest): CommentaryPage | undefined =>
  parsePage(request.nextUrl.searchParams.get("page"), new Date());

const text = (value: string | undefined) =>
  value === undefined
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ text: value });

export async function GET(request: NextRequest) {
  const page = pageOf(request);
  if (page === undefined) return new NextResponse(null, { status: 404 });

  const result = await getCommentary(page);
  if (result.status === "error") return new NextResponse(null, { status: 503 });
  return text(result.text);
}

// Writes one when none is stored; the client asks only after hydrating, so crawlers never do.
export async function POST(request: NextRequest) {
  const page = pageOf(request);
  if (page === undefined) return new NextResponse(null, { status: 404 });

  const stored = await getCommentary(page);
  if (stored.status === "ok" && stored.text !== undefined) {
    return text(stored.text);
  }

  const { ip } = await identifiers();
  // It shares the API key with the chat, so a flood would stall simon-bot's replies too.
  const refusal = await admit("commentary", ip, "unknown", LIMITS);
  if (refusal?.reason === "limited") {
    return new NextResponse(null, {
      status: 429,
      headers: { "Retry-After": String(refusal.retryAfterSeconds) },
    });
  }
  if (refusal) return new NextResponse(null, { status: 403 });

  try {
    return text(await writeCommentary(page, { signal: request.signal }));
  } catch (err) {
    log.error({ err, page }, "Failed to write commentary");
    return new NextResponse(null, { status: 503 });
  }
}
