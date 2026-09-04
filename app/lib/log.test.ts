// @vitest-environment node

import { Writable } from "node:stream";

import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { bridgeConsole } from "./log";

function createLogger() {
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
  return { logger, lines };
}

function createConsole() {
  return {
    error: () => {},
    warn: () => {},
    info: () => {},
    log: () => {},
    debug: () => {},
  } as unknown as Console;
}

describe("bridgeConsole", () => {
  it("maps console methods to pino levels", () => {
    const { logger, lines } = createLogger();
    const target = createConsole();
    bridgeConsole(target, logger);

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
    const { logger, lines } = createLogger();
    const target = createConsole();
    bridgeConsole(target, logger);

    target.log("use-cache: entry %s", "found", { tags: ["a"] }, 42);

    expect(lines[0]?.["msg"]).toBe(
      "use-cache: entry found { tags: [ 'a' ] } 42",
    );
  });

  it("keeps literal undefined arguments", () => {
    const { logger, lines } = createLogger();
    const target = createConsole();
    bridgeConsole(target, logger);

    target.log("value:", undefined);
    target.log("%s and %s", undefined, "x");

    expect(lines.map(({ msg }) => msg)).toEqual([
      "value: undefined",
      "undefined and x",
    ]);
  });

  it("serializes an Error argument as err and keeps its extra fields", () => {
    const { logger, lines } = createLogger();
    const target = createConsole();
    bridgeConsole(target, logger);

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
    const { logger, lines } = createLogger();
    const target = createConsole();
    bridgeConsole(target, logger);

    target.error("Request failed: %s", new Error("boom"));

    expect(lines[0]).toMatchObject({
      msg: "Request failed: boom",
      err: { message: "boom" },
    });
  });

  it("uses the error message when nothing else was printed", () => {
    const { logger, lines } = createLogger();
    const target = createConsole();
    bridgeConsole(target, logger);

    target.error(new Error("boom"));

    expect(lines[0]?.["msg"]).toBe("boom");
  });
});
