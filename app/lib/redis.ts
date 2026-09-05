import "server-only";
import { Redis } from "@upstash/redis";

import { getGlobal } from "@/lib/global";

export function getRedis(): Redis {
  return getGlobal("simon.dev/redis", () => Redis.fromEnv());
}
