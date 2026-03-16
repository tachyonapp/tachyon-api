import * as Sentry from "@sentry/node";

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    return; // no-op in local dev
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0, // error capture only — no performance tracing for MVP
    integrations: [],
  });
}
