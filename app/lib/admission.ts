import "server-only";
import { isBanned } from "@/lib/bans";
import { networkOf } from "@/lib/identifiers";
import { isDeniedRequest } from "@/lib/ipDenyList";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rateLimit";

export type Refusal =
  | { reason: "denied" }
  | { reason: "banned" }
  | { reason: "limited"; retryAfterSeconds: number };

/** Why a request may not go ahead, if it may not: a listed IP, a banned network, or one over its limit. */
export async function admit(
  action: string,
  ip: string | undefined,
  fallback: string,
  limits: { limit: number; windowMs: number },
): Promise<Refusal | undefined> {
  if (isDeniedRequest(ip, action)) return { reason: "denied" };

  const subject = ip === undefined ? fallback : networkOf(ip);
  const [banned, result] = await Promise.all([
    ip !== undefined && isBanned(ip),
    rateLimit(`${action}:${subject}`, limits),
  ]);
  if (banned) return { reason: "banned" };
  if (!result.success) {
    log.info(
      { action, subject, retryAfterSeconds: result.retryAfterSeconds },
      "Rate limited",
    );
    return { reason: "limited", retryAfterSeconds: result.retryAfterSeconds };
  }
  return undefined;
}
