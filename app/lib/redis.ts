// app/lib/redis.ts
import "server-only";

import { Redis } from "@upstash/redis";

let redis: Redis | undefined;

export function getRedis(): Redis {
  if (!redis) {
    redis = Redis.fromEnv();
  }
  return redis;
}
