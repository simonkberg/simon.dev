import "server-only";

import { type JWTPayload, jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { forbidden } from "next/navigation";
import { z } from "zod";

import { env } from "@/lib/env";
import { log } from "@/lib/log";

const sessionSchema = z.object({ username: z.string() });

export type Session = z.infer<typeof sessionSchema>;

const secretKey = env.SESSION_SECRET;
const encodedKey = new TextEncoder().encode(secretKey);

export async function encrypt(payload: Session) {
  return new SignJWT(payload satisfies JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(encodedKey);
}

export async function decrypt(session: string | undefined) {
  if (!session) return;

  try {
    const { payload } = await jwtVerify(session, encodedKey, {
      algorithms: ["HS256"],
    });
    return sessionSchema.parse(payload);
  } catch (err) {
    log.error({ err }, "Failed to verify session");
    return;
  }
}

export async function getSession() {
  const cookieJar = await cookies();
  const sessionCookie = cookieJar.get("session");
  const session = await decrypt(sessionCookie?.value);

  if (!session) {
    return forbidden();
  }

  return session;
}
