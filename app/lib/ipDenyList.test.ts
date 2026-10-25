import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { server } from "@/mocks/node";

import {
  IP_DENY_LIST_URL,
  isDeniedIp,
  isDeniedRequest,
  refreshIpDenyList,
} from "./ipDenyList";

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

async function loadDenyList(...ips: string[]) {
  serveList(`${ips.join("\n")}\n`);
  await refreshIpDenyList();
}

describe("ipDenyList", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
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

  it.each([
    ["<html>not a list</html>", 200],
    ["", 503],
  ])(
    "should keep the last list when a refresh gets %j (%i)",
    async (body, status) => {
      await loadDenyList("1.2.3.4");
      serveList(body, status);

      await refreshIpDenyList();

      expect(isDeniedIp("1.2.3.4")).toBe(true);
      expect(log.warn).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        "Failed to load the IP deny list",
      );
    },
  );

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
    await loadDenyList("1.2.3.4");
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

describe("isDeniedRequest", () => {
  beforeEach(() => loadDenyList("6.6.6.6"));

  it("should deny a listed IP and log it", () => {
    expect(isDeniedRequest("6.6.6.6", "typing")).toBe(true);
    expect(log.info).toHaveBeenCalledWith(
      { ip: "6.6.6.6", action: "typing" },
      "Denied a listed IP",
    );
  });

  it.each(["1.1.1.1", undefined])("should let %s through", (ip) => {
    expect(isDeniedRequest(ip, "typing")).toBe(false);
    expect(log.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Denied a listed IP",
    );
  });
});
