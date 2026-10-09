import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";

// IPs on at least six public blocklists: the list @upstash/ratelimit's protection used.
export const IP_DENY_LIST_URL =
  "https://raw.githubusercontent.com/stamparm/ipsum/master/levels/6.txt";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const REFRESH_MS = 24 * HOUR;
const TIMEOUT_MS = 10_000;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

type State = {
  ips: Set<string>;
  nextRefreshAt: number;
  failures: number;
  refreshing: Promise<void> | undefined;
};

function state(): State {
  return getGlobal("simon.dev/ip-deny-list", () => ({
    ips: new Set<string>(),
    nextRefreshAt: 0,
    failures: 0,
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
  const ips = new Set(lines.filter((line) => IPV4.test(line)));
  // An empty list would let everyone through for a day: retry it like a failure.
  if (ips.size === 0) throw new Error("IP deny list was empty");
  return ips;
}

export function refreshIpDenyList(): Promise<void> {
  const current = state();
  current.refreshing ??= fetchList()
    .then(
      (ips) => {
        current.ips = ips;
        current.nextRefreshAt = Date.now() + REFRESH_MS;
        current.failures = 0;
        log.info({ count: ips.size }, "Loaded the IP deny list");
      },
      (err: unknown) => {
        // 1, 4 and 16 minutes, then hourly: a boot during an outage soon gets a list.
        current.nextRefreshAt =
          Date.now() + Math.min(MINUTE * 4 ** current.failures, HOUR);
        current.failures++;
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
