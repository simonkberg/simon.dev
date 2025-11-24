import { pino } from "pino";

const isDev = process.env.NODE_ENV === "development";

export const log = pino({
  level: process.env["LOG_LEVEL"] ?? (isDev ? "debug" : "info"),
  formatters: { level: (label) => ({ level: label }) },
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
});
