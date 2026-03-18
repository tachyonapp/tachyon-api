import pino from "pino";

const env = process.env.NODE_ENV !== "production" || "staging";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: env
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
  base: {
    service: "tachyon-api",
    version: process.env.npm_package_version,
  },
});
