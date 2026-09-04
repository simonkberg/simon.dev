import { format } from "node:util";

import { type Level, type Logger, pino } from "pino";

const isDev = process.env.NODE_ENV === "development";

export const log = pino({
  level: process.env["LOG_LEVEL"] ?? (isDev ? "debug" : "info"),
  formatters: { level: (label) => ({ level: label }) },
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
});

const consoleLevels = [
  ["error", "error"],
  ["warn", "warn"],
  ["info", "info"],
  ["log", "info"],
  ["debug", "debug"],
] as const satisfies ReadonlyArray<readonly [keyof Console, Level]>;

function formatArgs(args: unknown[]): string {
  const [first, ...rest] = args;
  return args.length === 0 ? "" : format(first, ...rest).trim();
}

/** Next.js and dependencies print through `console`; Railway only indexes JSON lines. */
export function bridgeConsole(target: Console = console, logger: Logger = log) {
  for (const [method, level] of consoleLevels) {
    target[method] = (...args: unknown[]) => {
      const err = args.find((arg): arg is Error => arg instanceof Error);
      if (!err) {
        logger[level](formatArgs(args));
        return;
      }
      const messages = args.map((arg) =>
        arg instanceof Error ? arg.message : arg,
      );
      // A message in the template slot must not be parsed for % directives
      const template =
        args[0] instanceof Error ? ["%s", ...messages] : messages;
      logger[level]({ err }, formatArgs(template));
    };
  }
}
