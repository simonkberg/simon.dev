import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import { server } from "@/mocks/node";

import { IP_DENY_LIST_URL, isDeniedIp, refreshIpDenyList } from "./ipDenyList";

vi.mock(import("server-only"), () => ({}));

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function serveList(body: string, status = 200) {
  let requests = 0;
  server.use(
    http.get(IP_DENY_LIST_URL, () => {
      requests++;
      return new HttpResponse(body, { status });
    }),
  );
  return () => requests;
}

describe("isDeniedIp", () => {
  beforeEach(() => {
    resetGlobal("simon.dev/ip-deny-list");
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.spyOn(log, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should deny only listed IPs, skipping anything that isn't one", async () => {
    serveList("# ipsum\n1.2.3.4\n\n5.6.7.8\n<html>\n");

    await refreshIpDenyList();

    expect(isDeniedIp("1.2.3.4")).toBe(true);
    expect(isDeniedIp("5.6.7.8")).toBe(true);
    expect(isDeniedIp("9.9.9.9")).toBe(false);
    expect(isDeniedIp("# ipsum")).toBe(false);
    expect(isDeniedIp("<html>")).toBe(false);
  });

  it("should keep the last list when a refresh comes back without IPs", async () => {
    serveList("1.2.3.4\n");
    await refreshIpDenyList();
    serveList("<html>not a list</html>");

    await refreshIpDenyList();

    expect(isDeniedIp("1.2.3.4")).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to load the IP deny list",
    );
  });

  it("should let everyone through until the list has loaded, then load it", async () => {
    serveList("1.2.3.4\n");

    expect(isDeniedIp("1.2.3.4")).toBe(false);
    await vi.waitFor(() => expect(isDeniedIp("1.2.3.4")).toBe(true));
  });

  it("should share one fetch between concurrent refreshes", async () => {
    const requests = serveList("1.2.3.4\n");

    await Promise.all([refreshIpDenyList(), refreshIpDenyList()]);

    expect(requests()).toBe(1);
  });

  it("should refresh the list a day after loading it", async () => {
    serveList("1.2.3.4\n");
    await refreshIpDenyList();
    serveList("5.6.7.8\n");
    const fetches = vi.spyOn(globalThis, "fetch");

    vi.setSystemTime(24 * HOUR - 1);
    isDeniedIp("1.2.3.4");
    expect(fetches).not.toHaveBeenCalled();

    vi.setSystemTime(24 * HOUR);
    isDeniedIp("1.2.3.4");
    expect(fetches).toHaveBeenCalledTimes(1);

    await refreshIpDenyList();
    expect(isDeniedIp("1.2.3.4")).toBe(false);
    expect(isDeniedIp("5.6.7.8")).toBe(true);
  });

  it("should keep the last list when a refresh fails", async () => {
    serveList("1.2.3.4\n");
    await refreshIpDenyList();
    serveList("", 503);

    await refreshIpDenyList();

    expect(isDeniedIp("1.2.3.4")).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to load the IP deny list",
    );
  });

  it("should back off failed refreshes from a minute to an hour, then reset", async () => {
    serveList("", 503);
    const fetches = vi.spyOn(globalThis, "fetch");
    let now = 0;

    async function expectRetryAfter(delay: number) {
      fetches.mockClear();
      vi.setSystemTime(now + delay - 1);
      isDeniedIp("1.2.3.4");
      expect(fetches).not.toHaveBeenCalled();

      now += delay;
      vi.setSystemTime(now);
      isDeniedIp("1.2.3.4");
      expect(fetches).toHaveBeenCalledTimes(1);
      await refreshIpDenyList();
    }

    await refreshIpDenyList();
    for (const minutes of [1, 4, 16, 60, 60]) {
      await expectRetryAfter(minutes * MINUTE);
    }

    serveList("1.2.3.4\n");
    await expectRetryAfter(60 * MINUTE);
    expect(isDeniedIp("1.2.3.4")).toBe(true);

    serveList("", 503);
    await expectRetryAfter(24 * HOUR);
    await expectRetryAfter(MINUTE);
  });
});
