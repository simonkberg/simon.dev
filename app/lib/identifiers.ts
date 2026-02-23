"use server";

import { headers } from "next/headers";

export async function identifiers() {
  const headersList = await headers();
  return {
    ip:
      headersList.get("cf-connecting-ip") ??
      headersList.get("x-forwarded-for")?.split(",")[0] ??
      headersList.get("x-real-ip") ??
      undefined,
    userAgent: headersList.get("user-agent") ?? undefined,
  } as const;
}
