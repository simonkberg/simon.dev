// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { query } from "@/lib/turso";
import { failQuery, sqliteBeforeEach } from "@/mocks/sqlite";

import { ban, banPost, isBanned, isSpam, recordPost } from "./bans";
import { MIGRATIONS } from "./migrations";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

const sqlite = sqliteBeforeEach(query, MIGRATIONS);
const user = "test-user" as Username;

describe("isSpam", () => {
  it.each([
    [
      "the Calendly link",
      "Hoping to connect! https://calendly.com/melottogroup/30min",
      true,
    ],
    ["another Calendly link", "https://calendly.com/someone-else", false],
  ])("tells %s", (_, text, spam) => {
    expect(isSpam(text)).toBe(spam);
  });
});

describe("ban", () => {
  it("bans the address's network, once", async () => {
    await ban("2605:7380:8000:1000:78dc:f2ff:fefc:45c8");
    await ban("2605:7380:8000:1000:78dc:f2ff:fefc:45c8");

    expect(await isBanned("2605:7380:8000:1000::1")).toBe(true);
    expect(await isBanned("2605:7380:8000:1001::1")).toBe(false);
  });

  it("fails open", async () => {
    const error = new Error("boom");
    vi.mocked(query).mockImplementation(
      failQuery(sqlite(), "INSERT", { error }),
    );

    await ban("192.0.2.1");

    expect(log.warn).toHaveBeenCalledWith(
      { err: error, ip: "192.0.2.1", network: "192.0.2.1" },
      "Failed to ban a network",
    );
  });
});

describe("isBanned", () => {
  it("fails open", async () => {
    await ban("192.0.2.1");
    const error = new Error("boom");
    vi.mocked(query).mockImplementation(
      failQuery(sqlite(), "SELECT", { error }),
    );

    expect(await isBanned("192.0.2.1")).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      { err: error, ip: "192.0.2.1" },
      "Failed to check for a ban",
    );
  });
});

describe("banPost", () => {
  it("bans the network the post came from", async () => {
    await recordPost("1", user, "192.0.2.1");
    await recordPost("2", user, "192.0.2.2");

    expect(await banPost("1")).toBe(user);
    expect(await isBanned("192.0.2.1")).toBe(true);
    expect(await isBanned("192.0.2.2")).toBe(false);
  });

  it("bans nobody for a post without an IP", async () => {
    expect(await banPost("1")).toBeUndefined();
    expect((await query("SELECT * FROM banned_networks")).rows).toEqual([]);
  });
});

describe("recordPost", () => {
  it("keeps posts for 30 days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await recordPost("1", user, "192.0.2.1");
    vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await recordPost("2", user, "192.0.2.2");

    expect((await query("SELECT message_id FROM chat_posts")).rows).toEqual([
      { message_id: "2" },
    ]);
  });

  it("fails open", async () => {
    const error = new Error("boom");
    vi.mocked(query).mockImplementation(
      failQuery(sqlite(), "INSERT", { error }),
    );

    await recordPost("1", user, "192.0.2.1");

    expect(log.warn).toHaveBeenCalledWith(
      { err: error, messageId: "1" },
      "Failed to record a chat post",
    );
  });
});
