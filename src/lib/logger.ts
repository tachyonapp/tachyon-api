import pino from "pino";

const isProdOrStaging =
  process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";

// pino-pretty spawns a thread-stream worker. Skip it in test env to avoid
// Jest open-handle warnings caused by unreferenced worker threads.
const useTransport = !isProdOrStaging && process.env.NODE_ENV !== "test";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: useTransport
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
  base: {
    service: "tachyon-api",
    version: process.env.npm_package_version,
  },
});
