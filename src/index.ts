import { createApp } from "./server";
import { initSentry } from "./sentry";

const REQUIRED_ENV_VARS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID_BYOK",
  "STRIPE_PRICE_ID_TACHYON_HOSTED",
];

const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

const PORT = parseInt(process.env.PORT ?? "4000", 10);

initSentry(); // no-op if SENTRY_DSN absent

createApp().then(({ app, apolloServer }) => {
  const httpServer = app.listen(PORT, () => {
    console.log(`tachyon-api listening on port ${PORT}`);
  });

  // Graceful shutdown: allow in-flight requests to complete before exit
  process.on("SIGTERM", async () => {
    await apolloServer.stop();
    httpServer.close(() => process.exit(0));
  });
});
