import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";

// IPs on at least six public blocklists: the list @upstash/ratelimit's protection used.
export const IP_DENY_LIST_URL =
  "https://raw.githubusercontent.com/stamparm/ipsum/master/levels/6.txt";

const REFRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

type State = {
  ips: Set<string>;
  nextRefreshAt: number;
  refreshing: Promise<void> | undefined;
};

function state(): State {
  return getGlobal("simon.dev/ip-deny-list", () => ({
    ips: new Set<string>(),
    nextRefreshAt: 0,
    refreshing: undefined,
  }));
}

async function fetchList(): Promise<Set<string>> {
  const response = await fetch(IP_DENY_LIST_URL, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`IP deny list responded ${response.status}`);
  }
  const lines = (await response.text()).split("\n").map((line) => line.trim());
  return new Set(lines.filter((line) => line && !line.startsWith("#")));
}

export function refreshIpDenyList(): Promise<void> {
  const current = state();
  current.refreshing ??= fetchList()
    .then(
      (ips) => {
        current.ips = ips;
        current.nextRefreshAt = Date.now() + REFRESH_MS;
        log.info({ count: ips.size }, "Loaded the IP deny list");
      },
      (err: unknown) => {
        current.nextRefreshAt = Date.now() + RETRY_MS;
        log.warn({ err }, "Failed to load the IP deny list");
      },
    )
    .finally(() => {
      current.refreshing = undefined;
    });
  return current.refreshing;
}

// Fails open: until a list has loaded, nobody is denied.
export function isDeniedIp(ip: string): boolean {
  const current = state();
  if (Date.now() >= current.nextRefreshAt) void refreshIpDenyList();
  return current.ips.has(ip);
}
