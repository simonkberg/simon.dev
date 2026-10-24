import { NextResponse } from "next/server";
import { z } from "zod";

import { leavePresence } from "@/lib/presence";
import { findSession } from "@/lib/session";

const StreamSchema = z.uuid();

/** The chat's `sendBeacon` as its page closes. */
export async function POST(request: Request) {
  const session = await findSession();
  const stream = StreamSchema.safeParse(await request.text());
  if (!session || !stream.success) {
    return new NextResponse(null, { status: 400 });
  }
  await leavePresence(stream.data, session.username);
  return new NextResponse(null, { status: 204 });
}
