import { createApp } from "./server";
import { initSentry } from "./sentry";

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
