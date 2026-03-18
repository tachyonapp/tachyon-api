import pino from "pino";

const isProdOrStaging =
  process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: !isProdOrStaging
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
  base: {
    service: "tachyon-api",
    version: process.env.npm_package_version,
  },
});
