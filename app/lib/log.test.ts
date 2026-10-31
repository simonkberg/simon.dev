// @vitest-environment node

import { Writable } from "node:stream";

import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { bridgeConsole, epochTime } from "./log";

function bridged() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(String(chunk)));
      callback();
    },
  });
  const logger = pino(
    { level: "debug", formatters: { level: (label) => ({ level: label }) } },
    stream,
  );
  const target = {
    error: () => {},
    warn: () => {},
    info: () => {},
    log: () => {},
    debug: () => {},
  } as unknown as Console;
  bridgeConsole(target, logger);
  return { target, lines };
}

describe("bridgeConsole", () => {
  it("maps console methods to pino levels", () => {
    const { target, lines } = bridged();

    target.error("e");
    target.warn("w");
    target.info("i");
    target.log("l");
    target.debug("d");

    expect(lines.map(({ level, msg }) => [level, msg])).toEqual([
      ["error", "e"],
      ["warn", "w"],
      ["info", "i"],
      ["info", "l"],
      ["debug", "d"],
    ]);
  });

  it("formats arguments like console does", () => {
    const { target, lines } = bridged();

    target.log("use-cache: entry %s", "found", { tags: ["a"] }, 42);

    expect(lines[0]?.["msg"]).toBe(
      "use-cache: entry found { tags: [ 'a' ] } 42",
    );
  });

  it("keeps literal undefined arguments", () => {
    const { target, lines } = bridged();

    target.log("value:", undefined);
    target.log("%s and %s", undefined, "x");

    expect(lines.map(({ msg }) => msg)).toEqual([
      "value: undefined",
      "undefined and x",
    ]);
  });

  it("serializes an Error argument as err and keeps its extra fields", () => {
    const { target, lines } = bridged();

    const error = Object.assign(
      new SyntaxError("Unexpected end of JSON input"),
      { digest: "73438361" },
    );
    target.error(" ⨯", error);

    expect(lines[0]).toMatchObject({
      level: "error",
      msg: "⨯ Unexpected end of JSON input",
      err: {
        type: "SyntaxError",
        message: "Unexpected end of JSON input",
        digest: "73438361",
      },
    });
    expect(lines[0]?.["err"]).toHaveProperty("stack");
  });

  it("substitutes the error message into a placeholder", () => {
    const { target, lines } = bridged();

    target.error("Request failed: %s", new Error("boom"));

    expect(lines[0]).toMatchObject({
      msg: "Request failed: boom",
      err: { message: "boom" },
    });
  });

  it("does not parse a leading error message as a template", () => {
    const { target, lines } = bridged();

    target.error(new Error("Invalid config: %s"), "server.json");

    expect(lines[0]?.["msg"]).toBe("Invalid config: %s server.json");
  });

  it("attaches the first error and prints the others' messages", () => {
    const { target, lines } = bridged();

    target.error("failed both", new Error("one"), new Error("two"));

    expect(lines[0]).toMatchObject({
      msg: "failed both one two",
      err: { message: "one" },
    });
  });

  it("logs an empty message for a call without arguments", () => {
    const { target, lines } = bridged();

    target.log();

    expect(lines[0]?.["msg"]).toBe("");
  });

  it("uses the error message when nothing else was printed", () => {
    const { target, lines } = bridged();

    target.error(new Error("boom"));

    expect(lines[0]?.["msg"]).toBe("boom");
  });
});

describe("epochTime", () => {
  it("should give the epoch time without reading Date.now()", () => {
    const before = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now() in a prerender");
    });

    const time = Number(epochTime().replace(',"time":', ""));

    expect(time).toBeGreaterThanOrEqual(before - 1);
    expect(time).toBeLessThan(before + 1000);
  });
});
